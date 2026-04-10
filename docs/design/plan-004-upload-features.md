# Plan 004: Upload Features for GeminiRAG Electron UI

**Date**: 2026-04-10
**Status**: Draft
**Prerequisites**: Plan 003 (Electron UI) fully implemented
**Related Documents**:
- Specification: `docs/reference/refined-request-upload-features.md`
- Investigation: `docs/reference/investigation-upload-features.md`
- Codebase scan: `docs/reference/codebase-scan-electron-ui.md`
- Architecture: `docs/design/project-design.md` Section 15

---

## 1. Overview

Add five write operations to the currently read-only Electron UI:
1. Create workspace (from sidebar)
2. Upload local file (via native file picker)
3. Upload from URL (web page extraction)
4. Upload YouTube video (transcript extraction with optional AI notes)
5. Add personal note (free-text entry)

All operations already exist in the CLI service layer (`src/`). No modifications to `src/` are needed. All changes are within `electron-ui/`.

---

## 2. Phase Breakdown

### Phase 1: Foundation -- IPC Types and Dependencies
### Phase 2: Main Process -- IPC Handlers
### Phase 3: Preload Layer -- API Bridge
### Phase 4: Store -- Zustand State and Actions
### Phase 5: UI Components -- Dialogs and Triggers
### Phase 6: Integration Testing and Polish

**Parallelization:**
- Phases 1 is a prerequisite for all others.
- Phase 2 and Phase 3 can run in parallel (both depend only on Phase 1).
- Phase 4 depends on Phase 3 (needs preload API shape).
- Phase 5 depends on Phase 4 (needs store actions).
- Phase 6 depends on all prior phases.

```
Phase 1 ──┬──> Phase 2 ──┐
           └──> Phase 3 ──┴──> Phase 4 ──> Phase 5 ──> Phase 6
```

---

## 3. Phase 1: Foundation -- IPC Types and Dependencies

### Objective
Define the 6 new IPC channel type signatures, the shared `UploadResultIpc` type, and install the `uuid` dependency.

### Files to Modify

| File | Change |
|------|--------|
| `electron-ui/src/shared/ipc-types.ts` | Add 6 IPC channel entries to `IpcChannelMap`; add `UploadResultIpc` interface |
| `electron-ui/package.json` | Add `uuid` dependency + `@types/uuid` devDependency |

### Detailed Changes

**`electron-ui/src/shared/ipc-types.ts`** -- Add after existing `IpcChannelMap` entries:

```typescript
export interface UploadResultIpc {
  id: string;
  title: string;
  sourceType: string;
}
```

Add to `IpcChannelMap`:

```typescript
'workspace:create': {
  input: { name: string };
  output: { name: string; storeName: string };
};
'dialog:openFile': {
  input: void;
  output: { filePath: string; fileName: string } | null;
};
'upload:file': {
  input: { workspace: string; filePath: string };
  output: UploadResultIpc;
};
'upload:url': {
  input: { workspace: string; url: string };
  output: UploadResultIpc;
};
'upload:youtube': {
  input: { workspace: string; url: string; withNotes: boolean };
  output: UploadResultIpc;
};
'upload:note': {
  input: { workspace: string; text: string };
  output: UploadResultIpc;
};
```

### Commands

```bash
cd electron-ui && npm install uuid && npm install -D @types/uuid
```

### Acceptance Criteria

- [ ] `UploadResultIpc` interface exported from `ipc-types.ts`
- [ ] All 6 new channel entries present in `IpcChannelMap`
- [ ] `uuid` appears in `electron-ui/package.json` dependencies
- [ ] `@types/uuid` appears in `electron-ui/package.json` devDependencies
- [ ] TypeScript compiles without errors: `cd electron-ui && npx tsc --noEmit`

### Verification

```bash
cd electron-ui && npx tsc --noEmit
```

---

## 4. Phase 2: Main Process -- IPC Handlers

### Objective
Implement the 6 new `ipcMain.handle()` registrations in the main process, following the existing `wrapError` pattern.

### Files to Modify

| File | Change |
|------|--------|
| `electron-ui/src/main/ipc-handlers.ts` | Add 6 new handler registrations with imports |
| `electron-ui/electron.vite.config.ts` | Add `@mozilla/readability` to externals list (imported transitively via `content-extractor.ts`) |

### New Imports Needed in `ipc-handlers.ts`

```typescript
import { addWorkspace, addUpload } from '@cli/services/registry.js';
import { createStore, deleteStore, uploadContent, deleteDocument } from '@cli/services/file-search.js';
import { extractDiskFile, extractWebPage, extractYouTubeEnhanced, extractNote } from '@cli/services/content-extractor.js';
import { validateWorkspaceName, validateUrl, extractYouTubeVideoId } from '@cli/utils/validation.js';
import { v4 as uuidv4 } from 'uuid';
```

### Handler Specifications

#### 2a. `workspace:create`

```
1. validateWorkspaceName(name)
2. workspaces = listWorkspaces(); check length < 10
3. Check no workspace with same name exists
4. storeName = await createStore(ai, name)
5. addWorkspace(name, storeName)
6. Return { name, storeName }
Rollback: if addWorkspace fails after createStore succeeds, call deleteStore(ai, storeName)
```

#### 2b. `dialog:openFile`

```
1. dialog.showOpenDialog({ properties: ['openFile'], filters: [...] })
2. If cancelled, return null
3. Return { filePath, fileName: path.basename(filePath) }
```

File filter extensions must match `SUPPORTED_MIME_TYPES` from `src/utils/validation.ts`:
`pdf, txt, md, html, csv, doc, docx, xls, xlsx, pptx, json, sql, py, js, java, c, zip`

#### 2c. `upload:file`

```
1. workspace = getWorkspace(workspace)
2. extracted = extractDiskFile(filePath)
3. Build customMetadata: [{ key: 'source_type', stringValue: 'file' }, { key: 'source_url', stringValue: filePath }]
4. docName = await uploadContent(ai, storeName, extracted.content, extracted.isFilePath, extracted.mimeType, extracted.title, customMetadata)
5. id = uuidv4()
6. entry = { id, documentName: docName, title: extracted.title, timestamp: new Date().toISOString(), sourceType: 'file', sourceUrl: filePath, expirationDate: null, flags: [] }
7. addUpload(workspace, entry)
8. Return { id, title: extracted.title, sourceType: 'file' }
Rollback: if addUpload fails, call deleteDocument(ai, storeName, docName)
```

#### 2d. `upload:url`

```
1. validateUrl(url)
2. workspace = getWorkspace(workspace)
3. extracted = await extractWebPage(url)
4. Build customMetadata: [{ key: 'source_type', stringValue: 'web' }, { key: 'source_url', stringValue: url }]
5. docName = await uploadContent(ai, storeName, extracted.content, false, extracted.mimeType, extracted.title, customMetadata)
6. id = uuidv4()
7. entry = { id, documentName: docName, title: extracted.title, timestamp: new Date().toISOString(), sourceType: 'web', sourceUrl: url, expirationDate: null, flags: [] }
8. addUpload(workspace, entry)
9. Return { id, title: extracted.title, sourceType: 'web' }
Rollback: if addUpload fails, call deleteDocument(ai, storeName, docName)
```

#### 2e. `upload:youtube`

```
1. extractYouTubeVideoId(url) -- validates URL
2. workspace = getWorkspace(workspace)
3. config = getConfig()
4. extracted = await extractYouTubeEnhanced(url, { withNotes, ai: getClient(), model: config.geminiModel, youtubeApiKey: config.youtubeDataApiKey })
5. Build customMetadata: [{ key: 'source_type', stringValue: 'youtube' }, { key: 'source_url', stringValue: url }]
6. docName = await uploadContent(ai, storeName, extracted.content, false, extracted.mimeType, extracted.title, customMetadata)
7. id = uuidv4()
8. entry = { id, documentName: docName, title: extracted.title, timestamp: new Date().toISOString(), sourceType: 'youtube', sourceUrl: url, expirationDate: null, flags: [] }
9. addUpload(workspace, entry)
10. Return { id, title: extracted.title, sourceType: 'youtube' }
Rollback: if addUpload fails, call deleteDocument(ai, storeName, docName)
```

#### 2f. `upload:note`

```
1. extracted = extractNote(text) -- validates non-empty
2. workspace = getWorkspace(workspace)
3. Build customMetadata: [{ key: 'source_type', stringValue: 'note' }]
4. docName = await uploadContent(ai, storeName, extracted.content, false, extracted.mimeType, extracted.title, customMetadata)
5. id = uuidv4()
6. entry = { id, documentName: docName, title: extracted.title, timestamp: new Date().toISOString(), sourceType: 'note', sourceUrl: null, expirationDate: null, flags: [] }
7. addUpload(workspace, entry)
8. Return { id, title: extracted.title, sourceType: 'note' }
Rollback: if addUpload fails, call deleteDocument(ai, storeName, docName)
```

### Externals Update

`electron.vite.config.ts` -- add `@mozilla/readability` to the `external` array:

```typescript
external: ['bufferutil', 'utf-8-validate', 'canvas', 'jsdom', 'youtube-transcript-plus', '@mozilla/readability']
```

**Rationale:** `content-extractor.ts` imports `@mozilla/readability` at the top level. When electron-vite bundles the main process, it tries to bundle this dependency. Since `jsdom` is already externalized, `@mozilla/readability` must also be externalized because it depends on the DOM environment that `jsdom` provides. Both packages exist in the parent project's `node_modules` and will be resolved at runtime.

### Acceptance Criteria

- [ ] All 6 handlers registered and follow the `wrapError` / `IpcResult<T>` pattern
- [ ] Rollback logic present on all handlers that call Gemini API before registry writes
- [ ] `@mozilla/readability` added to externals in `electron.vite.config.ts`
- [ ] TypeScript compiles: `cd electron-ui && npx tsc --noEmit`
- [ ] Application starts without import errors: `cd electron-ui && npm run dev`

### Verification

```bash
cd electron-ui && npx tsc --noEmit
cd electron-ui && npm run dev
# Manually verify no crash on startup
```

---

## 5. Phase 3: Preload Layer -- API Bridge

### Objective
Expose the 6 new IPC channels to the renderer through the preload API.

### Files to Modify

| File | Change |
|------|--------|
| `electron-ui/src/preload/api.ts` | Add methods to `workspace`, `upload`, and new `dialog` namespace |

### Detailed Changes

Add to the `workspace` namespace:
```typescript
create: (name: string) => ipcRenderer.invoke('workspace:create', { name }),
```

Add to the `upload` namespace:
```typescript
uploadFile: (workspace: string, filePath: string) => ipcRenderer.invoke('upload:file', { workspace, filePath }),
uploadUrl: (workspace: string, url: string) => ipcRenderer.invoke('upload:url', { workspace, url }),
uploadYoutube: (workspace: string, url: string, withNotes: boolean) => ipcRenderer.invoke('upload:youtube', { workspace, url, withNotes }),
uploadNote: (workspace: string, text: string) => ipcRenderer.invoke('upload:note', { workspace, text }),
```

Add new `dialog` namespace:
```typescript
dialog: {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
},
```

### Note on `index.d.ts`

The file `electron-ui/src/preload/index.d.ts` uses `typeof import('./api').api` so it auto-reflects new methods. **No changes needed** to `index.d.ts`.

### Acceptance Criteria

- [ ] All 6 new methods accessible via `window.api.*` in renderer
- [ ] TypeScript compiles: `cd electron-ui && npx tsc --noEmit`

### Verification

```bash
cd electron-ui && npx tsc --noEmit
```

---

## 6. Phase 4: Store -- Zustand State and Actions

### Objective
Add workspace creation and upload mutation state plus actions to the Zustand store.

### Files to Modify

| File | Change |
|------|--------|
| `electron-ui/src/renderer/src/store/index.ts` | Add creation/upload state fields and action methods |

### New State Fields

```typescript
// Workspace creation
isCreatingWorkspace: boolean;       // default: false
createWorkspaceError: string | null; // default: null

// Upload operations
isUploading: boolean;               // default: false
uploadError: string | null;         // default: null
```

### New Actions

```typescript
createWorkspace: (name: string) => Promise<boolean>;
uploadFile: (filePath: string) => Promise<boolean>;
uploadUrl: (url: string) => Promise<boolean>;
uploadYoutube: (url: string, withNotes: boolean) => Promise<boolean>;
uploadNote: (text: string) => Promise<boolean>;
clearUploadError: () => void;
clearCreateWorkspaceError: () => void;
```

### Action Implementation Pattern

Each upload action:
1. Sets `isUploading: true`, `uploadError: null`
2. Reads `selectedWorkspace` from store state; throws if null
3. Calls `window.api.upload.*` with workspace name and input
4. Checks `IpcResult.success`
5. On success: sets `isUploading: false`, calls `loadUploads()` and `loadWorkspaces()`, returns `true`
6. On error: sets `isUploading: false`, `uploadError: message`, returns `false`

The `createWorkspace` action:
1. Sets `isCreatingWorkspace: true`, `createWorkspaceError: null`
2. Calls `window.api.workspace.create(name)`
3. On success: sets `isCreatingWorkspace: false`, calls `loadWorkspaces()`, then `selectWorkspace(name)`, returns `true`
4. On error: sets `isCreatingWorkspace: false`, `createWorkspaceError: message`, returns `false`

### File Picker Integration

The file picker (`dialog:openFile`) is NOT part of the store. It is called directly from the `AddContentDialog` component. The returned `filePath` is held in local component state until the user clicks Upload.

### Acceptance Criteria

- [ ] Store interface includes all new fields and actions
- [ ] All actions follow the pattern: set loading, call API, handle result, refresh lists
- [ ] `createWorkspace` auto-selects the new workspace on success
- [ ] TypeScript compiles: `cd electron-ui && npx tsc --noEmit`

### Verification

```bash
cd electron-ui && npx tsc --noEmit
```

---

## 7. Phase 5: UI Components -- Dialogs and Triggers

### Objective
Create the two new dialog components and add trigger buttons to existing components.

### Files to Create

| File | Purpose |
|------|---------|
| `electron-ui/src/renderer/src/components/CreateWorkspaceDialog.tsx` | Modal dialog for workspace name input + creation |
| `electron-ui/src/renderer/src/components/AddContentDialog.tsx` | Modal dialog with 4 tabs for upload operations |

### Files to Modify

| File | Change |
|------|--------|
| `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx` | Add "+" icon button next to existing refresh button |
| `electron-ui/src/renderer/src/components/UploadsTab.tsx` | Add "Add Content" button above filter bar |

### Component Design

#### 5a. `CreateWorkspaceDialog.tsx`

- **Props:** `open: boolean`, `onOpenChange: (open: boolean) => void`
- **State:** `name: string` (local)
- **Uses:** `ui/dialog`, `ui/input`, `ui/button`, `LoadingSpinner`
- **Behavior:**
  - Text input for workspace name
  - Client-side validation: `/^[a-zA-Z0-9_-]+$/` on change, non-empty on submit
  - Calls `store.createWorkspace(name)` on submit
  - Shows `store.isCreatingWorkspace` spinner (non-dismissable while loading)
  - Shows `store.createWorkspaceError` as inline red text
  - On success (return `true`), closes dialog and clears input
  - Escape/close disabled while `isCreatingWorkspace` is true
  - Descriptive loading text: "Creating workspace..."

#### 5b. `AddContentDialog.tsx`

- **Props:** `open: boolean`, `onOpenChange: (open: boolean) => void`
- **State:**
  - `activeTab: string` (default: `'file'`, remembered within session)
  - Tab-specific local state: `filePath`, `fileName`, `url`, `youtubeUrl`, `withNotes`, `noteText`
- **Uses:** `ui/dialog`, `ui/tabs`, `ui/input`, `ui/textarea`, `ui/button`, `LoadingSpinner`
- **Tabs:**

  **File Tab:**
  - "Browse..." button calls `window.api.dialog.openFile()` directly
  - Displays selected `fileName` with a change/clear button
  - Upload button disabled until a file is selected
  - Submit: calls `store.uploadFile(filePath)`

  **Web Page Tab:**
  - URL `Input` with placeholder `"https://example.com/article"`
  - Client-side validation: non-empty, starts with `http://` or `https://`
  - Submit: calls `store.uploadUrl(url)`

  **YouTube Tab:**
  - URL `Input` with placeholder `"https://www.youtube.com/watch?v=..."`
  - Checkbox: "Generate AI notes" (default unchecked)
  - Info text when checked: "AI notes generation adds 1-2 minutes to upload time"
  - Client-side validation: YouTube URL pattern regex
  - Submit: calls `store.uploadYoutube(youtubeUrl, withNotes)`

  **Note Tab:**
  - `Textarea` with `rows={6}` and placeholder `"Type your note here..."`
  - Live title preview below: "Title: {first 60 chars}..."
  - Submit: calls `store.uploadNote(noteText)`

- **Shared behavior:**
  - `store.isUploading` disables all inputs, tabs, and close button
  - `store.uploadError` shown as red text at top of dialog, below tabs
  - Non-dismissable during upload (prevent Escape and outside click)
  - Elapsed time counter displayed during upload: "(12s elapsed)"
  - Context-specific loading messages:
    - File: "Uploading file to Gemini..."
    - URL: "Fetching page content and uploading..."
    - YouTube (no notes): "Fetching transcript and uploading..."
    - YouTube (with notes): "Fetching transcript, generating AI notes, and uploading... This may take 1-2 minutes."
    - Note: "Saving note..."
  - On success (action returns `true`), dialog closes and all tab state is cleared

#### 5c. `WorkspaceSidebar.tsx` Modification

- Add a `Plus` icon button (from `lucide-react`) in the header, next to the existing refresh button
- Manages `useState<boolean>` for `CreateWorkspaceDialog` open state
- Renders `<CreateWorkspaceDialog open={...} onOpenChange={...} />`

#### 5d. `UploadsTab.tsx` Modification

- Add an "Add Content" button (using `Plus` icon from `lucide-react` + text) above the `UploadsFilterBar`
- Button disabled when `store.selectedWorkspace` is null
- Manages `useState<boolean>` for `AddContentDialog` open state
- Renders `<AddContentDialog open={...} onOpenChange={...} />`

### Acceptance Criteria

- [ ] "+" button visible in `WorkspaceSidebar` header
- [ ] "Add Content" button visible in `UploadsTab` (disabled when no workspace selected)
- [ ] `CreateWorkspaceDialog` opens, validates input, creates workspace, auto-selects it
- [ ] `AddContentDialog` has 4 tabs: File, Web Page, YouTube, Note
- [ ] File tab opens native file picker via `dialog:openFile`
- [ ] All tabs submit correctly and refresh upload list on success
- [ ] Dialog is non-dismissable during loading, shows elapsed time counter
- [ ] Error messages display inline, dialog stays open for retry
- [ ] Upload list and workspace list refresh after successful operations
- [ ] TypeScript compiles: `cd electron-ui && npx tsc --noEmit`

### Verification

```bash
cd electron-ui && npx tsc --noEmit
cd electron-ui && npm run dev
# Manual test scenarios (see Phase 6)
```

---

## 8. Phase 6: Integration Testing and Polish

### Objective
Verify all features end-to-end and polish the UI.

### Manual Test Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Create workspace with valid name | Appears in sidebar, auto-selected |
| 2 | Create workspace with invalid name (spaces) | Client-side validation error |
| 3 | Create workspace with duplicate name | Server-side error displayed in dialog |
| 4 | Create 11th workspace (if 10 exist) | "Maximum 10 workspaces" error |
| 5 | Upload supported file (.pdf, .txt, .md) | Appears in upload table with "file" source type |
| 6 | Upload unsupported file type | Error message displayed |
| 7 | Cancel file picker | Dialog remains open, no error |
| 8 | Upload from valid URL | Appears with "web" source type, title extracted from page |
| 9 | Upload from invalid/unreachable URL | Error displayed |
| 10 | Upload YouTube video with transcript | Appears with "youtube" source type |
| 11 | Upload YouTube video without transcript | "Transcript not available" error |
| 12 | Upload YouTube video with "Generate AI notes" | Upload takes longer, notes included |
| 13 | Add personal note | Appears with "note" source type, auto-generated title |
| 14 | Add empty note | Validation error |
| 15 | Upload while no workspace selected | "Add Content" button disabled |
| 16 | Verify sidebar upload counts update after each upload | Counts increment |
| 17 | Close dialog with Escape during idle state | Dialog closes |
| 18 | Press Escape during upload | Dialog remains open (non-dismissable) |
| 19 | Upload large content (~30s) | Elapsed time counter visible and incrementing |
| 20 | Error during upload, retry | Error clears on retry, upload succeeds |

### Acceptance Criteria

- [ ] All 20 manual test scenarios pass
- [ ] No console errors in renderer DevTools during normal operations
- [ ] No main process crashes during error scenarios
- [ ] Application starts cleanly: `cd electron-ui && npm run dev`
- [ ] Production build succeeds: `cd electron-ui && npm run build`

### Verification

```bash
cd electron-ui && npm run build
cd electron-ui && npm run dev
```

---

## 9. Complete File Change Summary

### New Files (2)

| File | Phase |
|------|-------|
| `electron-ui/src/renderer/src/components/CreateWorkspaceDialog.tsx` | Phase 5 |
| `electron-ui/src/renderer/src/components/AddContentDialog.tsx` | Phase 5 |

### Modified Files (7)

| File | Phase | Change Summary |
|------|-------|---------------|
| `electron-ui/src/shared/ipc-types.ts` | Phase 1 | Add 6 IPC channels + `UploadResultIpc` type |
| `electron-ui/package.json` | Phase 1 | Add `uuid` + `@types/uuid` |
| `electron-ui/src/main/ipc-handlers.ts` | Phase 2 | Add 6 handler registrations + new imports |
| `electron-ui/electron.vite.config.ts` | Phase 2 | Add `@mozilla/readability` to externals |
| `electron-ui/src/preload/api.ts` | Phase 3 | Add 6 new API methods |
| `electron-ui/src/renderer/src/store/index.ts` | Phase 4 | Add creation/upload state + 7 actions |
| `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx` | Phase 5 | Add "+" button + dialog integration |
| `electron-ui/src/renderer/src/components/UploadsTab.tsx` | Phase 5 | Add "Add Content" button + dialog integration |

### Unchanged Files

| File | Reason |
|------|--------|
| All files under `src/` (CLI) | Service layer reused as-is; no modifications |
| `electron-ui/src/preload/index.d.ts` | Uses `typeof import('./api').api`; auto-reflects |
| `electron-ui/src/main/service-bridge.ts` | Already provides `getClient()` and `getConfig()` |
| `electron-ui/src/main/main.ts` | No changes needed |

---

## 10. Risks and Mitigations

### Risk 1: `@mozilla/readability` + `jsdom` Bundling

**Risk:** Importing `extractWebPage` from `content-extractor.ts` pulls in `jsdom` and `@mozilla/readability` at the top level. electron-vite will try to bundle them, which fails for native modules.

**Mitigation:** Both `jsdom` and `@mozilla/readability` are already listed (or will be added) in the `external` array in `electron.vite.config.ts`. They resolve from the parent project's `node_modules` at runtime. This is the same pattern used for `youtube-transcript-plus`.

**Verification:** Start the app with `npm run dev` and trigger a URL upload. If the import fails at runtime, the error will be visible immediately.

### Risk 2: `uuid` Package Resolution

**Risk:** The `uuid` package is installed in the parent project but not in `electron-ui/`. The electron-vite bundler may not resolve it from the parent.

**Mitigation:** Explicitly install `uuid` in `electron-ui/package.json` (Phase 1). This ensures the bundler can resolve it regardless of hoisting behavior.

### Risk 3: Long Upload Times Without Progress Feedback

**Risk:** YouTube uploads with AI notes can take 30-120 seconds. Users may think the app is frozen.

**Mitigation:** Non-dismissable dialog with context-specific loading messages and an elapsed time counter (seconds). The investigation recommended this approach and confirmed that true progress reporting would require an architectural change to the IPC pattern (switching from `handle`/`invoke` to event-based communication).

### Risk 4: Gemini API 503 Errors for Large Files

**Risk:** `uploadContent()` may hit 503 errors. The 503 fallback path in `file-search.ts` does NOT work for `isFilePath: true` uploads -- it throws instead of falling back.

**Mitigation:** This is a CLI-level limitation, not an Electron UI concern. The error will propagate naturally through the IPC handler and display in the dialog. Users can retry. If this becomes frequent, it requires a fix in `src/services/file-search.ts`.

### Risk 5: Content Extractor Top-Level Imports

**Risk:** Importing from `@cli/services/content-extractor.js` brings in all four extractors even if only one is needed. If any dependency fails to load, all upload types break.

**Mitigation:** This is acceptable because:
1. All dependencies (`jsdom`, `@mozilla/readability`, `youtube-transcript-plus`) are already externalized.
2. They all exist in the parent `node_modules`.
3. If a dependency is missing, the error is immediate and obvious at startup.
4. Dynamic imports would add complexity without meaningful benefit since the main process loads once.

### Risk 6: Rollback Failures

**Risk:** If `addUpload()` or `addWorkspace()` fails after a Gemini API call succeeds, and the subsequent `deleteStore()` / `deleteDocument()` rollback also fails, we have an orphaned Gemini resource.

**Mitigation:** The rollback is best-effort. The CLI has the same pattern. Orphaned resources can be cleaned up manually via `geminirag delete` or through the Gemini console. The error message from the original failure is still returned to the user.

---

## 11. Dependencies Between This Plan and Existing Code

| Dependency | Status | Notes |
|------------|--------|-------|
| `src/services/registry.ts` exports `addWorkspace`, `addUpload` | Available | Used by CLI commands today |
| `src/services/file-search.ts` exports `createStore`, `deleteStore`, `uploadContent`, `deleteDocument` | Available | Used by CLI commands today |
| `src/services/content-extractor.ts` exports all 4 extractors | Available | Used by CLI `upload` command today |
| `src/utils/validation.ts` exports validators | Available | Used by CLI commands today |
| `electron-ui/src/main/service-bridge.ts` exports `getClient()`, `getConfig()` | Available | Provides cached Gemini client and config |
| `@cli` path alias in `electron.vite.config.ts` | Configured | Resolves to `../src` |
| shadcn/ui components: `dialog`, `tabs`, `input`, `textarea`, `button` | Available | Already installed in electron-ui |
| `lucide-react` `Plus` icon | Available | Package already installed |

---

## 12. Estimated Effort

| Phase | Estimate | Notes |
|-------|----------|-------|
| Phase 1: IPC Types + Dependencies | 0.5 hours | Type definitions + npm install |
| Phase 2: IPC Handlers | 2-3 hours | 6 handlers, each ~40-60 lines with error handling and rollback |
| Phase 3: Preload API | 0.5 hours | Mechanical additions |
| Phase 4: Zustand Store | 1-1.5 hours | State fields + 7 action implementations |
| Phase 5: UI Components | 3-4 hours | 2 new components + 2 modifications; the AddContentDialog has 4 tabs |
| Phase 6: Integration Testing | 1-2 hours | 20 manual test scenarios |
| **Total** | **8-11 hours** | |

# Investigation: Write Operations for GeminiRAG Electron UI

## 1. IPC Channels: Mapping to Existing Service Functions

### Current State

The existing IPC layer (`electron-ui/src/main/ipc-handlers.ts`) already demonstrates the pattern: `ipcMain.handle()` handlers call CLI service functions, wrap results in `IpcResult<T>`, and use the `wrapError()` helper for error handling. The service bridge (`service-bridge.ts`) provides `getClient()` and `getConfig()` for cached Gemini API access.

### Required New IPC Channels

| IPC Channel | Input | Output | CLI Service Functions Used |
|---|---|---|---|
| `workspace:create` | `{ name: string }` | `{ name: string; storeName: string }` | `validateWorkspaceName()`, `listWorkspaces()`, `createStore()`, `addWorkspace()`, `deleteStore()` (rollback) |
| `dialog:openFile` | `void` | `{ filePath: string; fileName: string } \| null` | None (Electron `dialog.showOpenDialog`) |
| `upload:file` | `{ workspace: string; filePath: string }` | `UploadResultIpc` | `getWorkspace()`, `extractDiskFile()`, `uploadContent()`, `addUpload()`, `deleteDocument()` (rollback) |
| `upload:url` | `{ workspace: string; url: string }` | `UploadResultIpc` | `getWorkspace()`, `validateUrl()`, `extractWebPage()`, `uploadContent()`, `addUpload()`, `deleteDocument()` (rollback) |
| `upload:youtube` | `{ workspace: string; url: string; withNotes: boolean }` | `UploadResultIpc` | `getWorkspace()`, `extractYouTubeVideoId()`, `extractYouTubeEnhanced()`, `uploadContent()`, `addUpload()`, `deleteDocument()` (rollback) |
| `upload:note` | `{ workspace: string; text: string }` | `UploadResultIpc` | `getWorkspace()`, `extractNote()`, `uploadContent()`, `addUpload()`, `deleteDocument()` (rollback) |

### New Shared Type

```typescript
export interface UploadResultIpc {
  id: string;
  title: string;
  sourceType: string;
}
```

### Import Requirements for `ipc-handlers.ts`

New imports needed (all from the existing CLI `src/` tree, already accessible via the `@cli` path alias):

- `addWorkspace`, `addUpload` from `@cli/services/registry.js`
- `createStore`, `deleteStore`, `uploadContent`, `deleteDocument` from `@cli/services/file-search.js`
- `extractDiskFile`, `extractWebPage`, `extractYouTubeEnhanced`, `extractNote` from `@cli/services/content-extractor.js`
- `validateWorkspaceName`, `validateUrl`, `extractYouTubeVideoId` from `@cli/utils/validation.js`
- `v4 as uuidv4` from `uuid`
- `dialog` from `electron` (already imported)

### Recommendation

**Follow the existing pattern exactly.** Each handler calls service-layer functions directly (never command-layer functions which call `process.exit()`), wraps errors via `wrapError()`, and returns `IpcResult<T>`. The handler logic mirrors `src/commands/upload.ts` lines 48-121 and `src/commands/workspace.ts` lines 23-50 but without `loadConfig()`/`createGeminiClient()` calls (those are replaced by `getClient()`/`getConfig()` from the service bridge).

All six handlers follow the same rollback pattern already present in the CLI: if `addUpload()` or `addWorkspace()` fails after a successful Gemini API call, clean up the Gemini resource.

---

## 2. File Picking: Electron `dialog.showOpenDialog`

### Options Evaluated

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A: Separate `dialog:openFile` IPC channel** | Renderer calls `dialog:openFile` to get path, then calls `upload:file` with that path | Decoupled; file picker reusable elsewhere; renderer can display file name before upload starts | Two IPC round-trips |
| **B: File picker inside `upload:file` handler** | The upload handler itself opens the file dialog before proceeding | Single IPC call | Couples UI dialog to upload logic; harder to show selected file before upload; cannot cancel after seeing file name |

### Recommendation: Option A (separate `dialog:openFile` channel)

**Justification:**
1. The specification explicitly recommends this approach (refined-request lines 113-117).
2. The existing codebase already uses `dialog.showSaveDialog` in the `upload:download` handler (line 203 of `ipc-handlers.ts`), so the pattern is established.
3. The renderer can display the selected file name and let the user confirm before initiating the upload, which is the expected UX for file upload dialogs.
4. The two-round-trip cost is negligible (dialog:openFile is instant; the upload is the slow part).

### Implementation Detail

```typescript
// In ipc-handlers.ts
ipcMain.handle('dialog:openFile', async (): Promise<IpcResult<{ filePath: string; fileName: string } | null>> => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Supported Files', extensions: ['pdf', 'txt', 'md', 'html', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'pptx', 'json', 'sql', 'py', 'js', 'java', 'c', 'zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, data: null };
    }
    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    return { success: true, data: { filePath, fileName } };
  } catch (error) {
    return wrapError(error);
  }
});
```

**Key detail:** The file filter extensions should match `SUPPORTED_MIME_TYPES` from `src/utils/validation.ts`. The "All Files" fallback allows users to select files that `mime-types` might still resolve correctly even if the extension is not in the filter list. The actual MIME type validation happens in `extractDiskFile()` via `validateMimeType()`.

---

## 3. YouTube Upload UX: Flow Design

### Options Evaluated

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A: Simple form with indeterminate progress** | URL input + checkbox + Upload button; shows spinner with static "Uploading..." text | Simple to implement | YouTube uploads can take 30-120s; user has no idea what's happening |
| **B: Form with phased progress messages** | Same form, but progress text updates: "Fetching transcript...", "Generating notes...", "Uploading to Gemini..." | Better UX; user knows the operation is progressing | Requires progress reporting from main process to renderer |
| **C: Multi-step wizard** | Step 1: validate URL + show video title; Step 2: confirm + start upload | Most informative; user sees video title before committing | Over-engineered for a single-field form; adds latency (extra API call before upload) |

### Recommendation: Option A with enhanced loading text (minimal Option B)

**Justification:**
1. The `extractYouTubeEnhanced()` function is a single async call from the IPC handler's perspective. There is no intermediate progress event mechanism in the current IPC setup (Electron `ipcMain.handle()` returns a single Promise).
2. Implementing true progress reporting would require switching to `ipcMain.on()` with `event.sender.send()` callbacks, which is a significant architectural change to the existing pattern.
3. A pragmatic middle ground: the dialog shows a static but descriptive loading message based on the `withNotes` checkbox state:
   - Without notes: "Fetching transcript and uploading to Gemini..."
   - With notes: "Fetching transcript, generating AI notes, and uploading to Gemini... This may take 1-2 minutes."
4. An elapsed-time counter (simple `setInterval` in the React component) provides reassurance that the operation is still running.

### YouTube URL Validation

Client-side validation before submission should use a regex pattern matching the same formats as `extractYouTubeVideoId()`:
- `https://www.youtube.com/watch?v=...`
- `https://youtu.be/...`
- `https://youtube.com/embed/...`
- `https://youtube.com/v/...`

This is a convenience check only; the definitive validation happens server-side via `extractYouTubeVideoId()`.

---

## 4. Note Input UX: Multi-Line Text Entry

### Options Evaluated

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A: Standard textarea** | Use existing `ui/textarea` component with auto-resize | Consistent with existing UI toolkit; handles multi-line natively | Limited formatting options |
| **B: Rich text editor** | Markdown editor with preview | Notes could be formatted | Over-engineered; notes upload as plain text anyway; adds dependency |

### Recommendation: Option A (standard textarea)

**Justification:**
1. The `extractNote()` function accepts plain text and treats it as `text/plain` (line 338 of `content-extractor.ts`). There is no Markdown processing for notes.
2. The `ui/textarea` component already exists in the project (`src/renderer/src/components/ui/textarea.tsx`).
3. The textarea should have:
   - `rows={6}` minimum height (adjustable via CSS `min-h-[150px]`)
   - `placeholder="Type your note here..."` for discoverability
   - Auto-generated title preview below the textarea showing the first 60 characters (matching `generateNoteTitle()` logic) so the user knows what title will be assigned
4. Client-side validation: disable Submit when textarea is empty or whitespace-only (matching `extractNote()` validation).

---

## 5. Workspace Creation UX: Form with Name Validation

### Options Evaluated

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A: Modal dialog** | Dedicated `CreateWorkspaceDialog` component using `ui/dialog` | Standard pattern; focused UX; consistent with AddContentDialog | Extra component |
| **B: Inline editable item in sidebar** | Click "+", an editable text field appears in the workspace list | Feels more integrated | Complex focus management; harder to show errors; no room for loading state |
| **C: Popover from the "+" button** | Small popover with input + Create button | Compact; doesn't take over the screen | Limited space for error messages; awkward on small windows |

### Recommendation: Option A (modal dialog)

**Justification:**
1. The specification explicitly calls for a dialog (refined-request lines 46-53).
2. The `ui/dialog` component already exists and is well-suited for this.
3. A dialog provides clear space for: input field, validation errors, loading spinner, and action buttons.
4. Consistent with the `AddContentDialog` pattern -- both are modal operations that block other interaction during creation.

### Validation Rules (from `validateWorkspaceName()`)

- Non-empty after trim
- Matches `/^[a-zA-Z0-9_-]+$/` (alphanumeric, hyphens, underscores only)
- Client-side: validate on change and on submit; show inline error below input
- Server-side: workspace name uniqueness and max-10-workspaces limit are checked in the IPC handler

### Trigger Location

A "+" icon button in the `WorkspaceSidebar` header, positioned next to the existing refresh button (line 98-106 of `WorkspaceSidebar.tsx`). The `Plus` icon from lucide-react is the natural choice, consistent with the existing icon usage.

---

## 6. Progress/Loading States: Handling Slow Operations

### Timing Characteristics

| Operation | Typical Duration | Bottleneck |
|---|---|---|
| Create workspace | 2-5 seconds | `createStore()` Gemini API call |
| Upload file | 3-30 seconds | `uploadContent()` depends on file size; polling with 1s intervals |
| Upload URL | 5-20 seconds | `extractWebPage()` fetch + `uploadContent()` |
| Upload YouTube (no notes) | 5-30 seconds | Transcript fetch + `uploadContent()` |
| Upload YouTube (with notes) | 30-120 seconds | Transcript + `generateNotes()` AI call + `uploadContent()` |
| Upload note | 2-5 seconds | Small content, fast upload |

### Recommended Loading State Design

1. **Non-dismissable dialog during upload:** While `isUploading` is true, the dialog's close button (X) and Escape key should be disabled. The `DialogContent` component accepts `onInteractOutside` and `onEscapeKeyDown` event handlers that can call `e.preventDefault()`. The radix `Dialog` also accepts `onOpenChange` which can be suppressed.

2. **Descriptive loading text:** Each upload type shows a context-specific message:
   - File: "Uploading file to Gemini..."
   - URL: "Fetching page content and uploading..."
   - YouTube: "Fetching transcript and uploading..." or "Fetching transcript, generating AI notes, and uploading... This may take 1-2 minutes."
   - Note: "Saving note..."
   - Create workspace: "Creating workspace..."

3. **Elapsed time display:** A simple counter rendered by a `useEffect` with `setInterval` that increments every second. Format: "(12s elapsed)". This is trivial to implement and provides reassurance.

4. **All inputs disabled during upload:** The shared `isUploading` boolean disables all form inputs, tab switches, and submit buttons.

5. **No cancellation support:** Gemini API calls are not cancellable. Adding an AbortController would only abort the renderer's wait, not the server-side operation. Simpler to let it complete.

---

## 7. Upload Form: Dialog vs Sidebar Panel vs New Tab

### Options Evaluated

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A: Modal dialog with tabs** | Single `AddContentDialog` with 4 tabs (File, Web Page, YouTube, Note) | Focused interaction; doesn't displace existing content; familiar pattern; matches CreateWorkspaceDialog | Blocks interaction with the rest of the UI (acceptable for an upload operation) |
| **B: Sidebar panel** | Collapsible panel that slides in from the right | User can still see uploads list while filling the form | Takes permanent screen real estate; complex layout changes; conflicts with existing upload detail panel |
| **C: New tab alongside "Uploads" and "Ask"** | Persistent "Add" tab in the main content area | Always accessible | Wastes a tab for an infrequent operation; clutters the tab bar; content area shows empty form most of the time |
| **D: Dropdown menu with sub-dialogs** | "Add Content" button opens a dropdown to pick type, then a type-specific dialog | Each dialog is simpler (no tabs) | More components to build and maintain; extra click to reach the form |

### Recommendation: Option A (modal dialog with tabs)

**Justification:**
1. The specification explicitly recommends a "single 'Add Content' dialog with a tab or mode selector" (refined-request line 79).
2. The `ui/tabs` component already exists in the project.
3. Modal dialogs are the established pattern in this codebase (the download dialog uses `dialog.showSaveDialog`; the UI's `ui/dialog` component is ready).
4. Four tabs (File, Web Page, YouTube, Note) keep the dialog compact. Each tab has at most 2-3 form fields.
5. The dialog only appears when the user explicitly clicks "Add Content", so it doesn't consume space otherwise.
6. Tab state should default to "File" (most common operation) but remember the last-used tab within the session via local React state.

### Trigger Button Placement

An "Add Content" button in `UploadsTab` above or alongside the `UploadsFilterBar`. The button should be:
- Disabled when no workspace is selected (the component already guards for this with a "Select a workspace" message)
- Positioned to the right of the filter bar or above it, using the `Plus` icon + "Add Content" text
- Styled as a primary button (`variant="default"`) to make it visually prominent

---

## 8. Handling `extractDiskFile` with `isFilePath: true`

### The Problem

`extractDiskFile()` returns `ExtractedContent` with `isFilePath: true` and `content` set to the absolute file path (not the file contents). This is because the Gemini SDK's `uploadToFileSearchStore()` can accept either a file path string or a Blob. The `uploadContent()` function in `file-search.ts` (line 165-167) handles this:

```typescript
const file: string | Blob = isFilePath
  ? content          // pass the file path directly to the SDK
  : new Blob([content], { type: mimeType });  // wrap text content as a Blob
```

### Why This Matters for Electron

Since the file picker runs in the main process (via `dialog:openFile`) and returns a file path to the renderer, and the renderer then passes that path back to the main process via `upload:file`, the flow is:

1. Renderer calls `dialog:openFile` IPC -> main process opens native dialog -> returns `{ filePath, fileName }`
2. Renderer displays file name, user clicks Upload
3. Renderer calls `upload:file` IPC with `{ workspace, filePath }` -> main process calls `extractDiskFile(filePath)`
4. `extractDiskFile` validates the file exists, checks MIME type, returns `{ content: absolutePath, isFilePath: true, ... }`
5. Main process calls `uploadContent(ai, storeName, absolutePath, true, mimeType, title, metadata)`
6. `uploadContent` passes the path string directly to the Gemini SDK

### Assessment

**No special handling needed.** The flow works naturally because:
- The file path is always absolute (resolved by `extractDiskFile` via `path.resolve()`)
- The file is read by the Gemini SDK, not by our code
- The main process has filesystem access (it runs in Node.js, not in the sandboxed renderer)
- The renderer never needs to read the file contents

The only consideration is that the file must still exist on disk when `uploadContent()` runs. Since the user selects the file and immediately clicks Upload (or within seconds), this is not a practical concern.

### 503 Fallback Note

The 503 fallback path in `uploadContent()` (line 216) explicitly checks `!isFilePath` before attempting the Files API fallback. This means if a file upload gets a 503, it will **not** fall back -- it will throw. This is acceptable because:
1. The 503 fallback is for large text content that exceeds the direct upload limit
2. Disk files are typically within limits (the SDK handles streaming)
3. If this becomes an issue, it would require reading the file into memory as a Blob, which is a CLI-level fix, not an Electron UI concern

---

## 9. Files to Modify and Create

### Modified Files

| File | Changes |
|---|---|
| `electron-ui/src/shared/ipc-types.ts` | Add 6 IPC channel entries to `IpcChannelMap`; add `UploadResultIpc` interface |
| `electron-ui/src/main/ipc-handlers.ts` | Add 6 `ipcMain.handle()` registrations with new imports |
| `electron-ui/src/preload/api.ts` | Add `create` to `workspace` namespace; add `uploadFile`, `uploadUrl`, `uploadYoutube`, `uploadNote` to `upload` namespace; add `dialog.openFile` |
| `electron-ui/src/preload/index.d.ts` | No changes needed -- it uses `typeof import('./api').api` which auto-reflects |
| `electron-ui/src/renderer/src/store/index.ts` | Add workspace creation state + actions; add upload mutation state + actions |
| `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx` | Add "+" button in header next to refresh button |
| `electron-ui/src/renderer/src/components/UploadsTab.tsx` | Add "Add Content" button above filter bar |

### New Files

| File | Purpose |
|---|---|
| `electron-ui/src/renderer/src/components/CreateWorkspaceDialog.tsx` | Modal dialog for workspace name input + creation |
| `electron-ui/src/renderer/src/components/AddContentDialog.tsx` | Modal dialog with 4 tabs for upload operations |

### No Changes Required

| File | Reason |
|---|---|
| `electron-ui/src/preload/index.d.ts` | Uses `typeof import('./api').api` -- auto-reflects new methods |
| All files under `src/` (CLI) | Service layer is reused as-is; no modifications needed |
| `electron-ui/src/main/service-bridge.ts` | Already provides `getClient()` and `getConfig()` |

---

## 10. Zustand Store Additions

### New State Fields

```typescript
// Workspace creation
isCreatingWorkspace: boolean;
createWorkspaceError: string | null;

// Upload operations  
isUploading: boolean;
uploadError: string | null;
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

### Action Pattern

Each action:
1. Sets loading flag true, error null
2. Calls `window.api.upload.*` or `window.api.workspace.create`
3. On success: clears loading flag, calls `loadUploads()` and `loadWorkspaces()` to refresh, returns `true`
4. On error: clears loading flag, sets error message, returns `false`
5. The `createWorkspace` action additionally auto-selects the new workspace via `selectWorkspace(name)` and triggers `loadUploads()` on success

### File Picker Integration

The file picker (`dialog:openFile`) is **not** part of the store. It is called directly from the `AddContentDialog` component because it is a UI interaction (open native dialog, get path) not application state. The returned `filePath` is held in local component state until the user clicks Upload.

---

## 11. Component Design Details

### CreateWorkspaceDialog

- **Open state:** Managed by parent (`WorkspaceSidebar`) via `useState<boolean>`
- **Form fields:** Single `Input` for workspace name
- **Validation:** Real-time on-change: checks `/^[a-zA-Z0-9_-]*$/`; shows error below input if invalid characters are typed. Submit-time: checks non-empty.
- **Submit:** Calls `store.createWorkspace(name)`; on `true` return, closes dialog
- **Loading:** `store.isCreatingWorkspace` disables all controls, shows spinner
- **Error:** `store.createWorkspaceError` displayed as red text below the input or at the top of the dialog

### AddContentDialog

- **Open state:** Managed by parent (`UploadsTab`) via `useState<boolean>`
- **Tabs:** Uses `ui/tabs` with `TabsList` + `TabsTrigger` + `TabsContent` for File, Web Page, YouTube, Note
- **Tab memory:** `useState<string>('file')` defaults to "file", persists within session
- **Shared loading:** When `store.isUploading` is true, all tabs and the close button are disabled
- **Shared error:** `store.uploadError` shown at the top of the dialog (below the tabs, above the form content)
- **Auto-close:** Each tab's submit handler checks the boolean return from the store action; if `true`, calls the `onClose` prop

#### File Tab
- "Browse..." button calls `window.api.dialog.openFile()`
- Selected file displayed as `<fileName>` with a change/clear button
- Upload button disabled until a file is selected

#### Web Page Tab
- URL `Input` with `placeholder="https://example.com/article"`
- Client validation: non-empty, starts with `http://` or `https://`

#### YouTube Tab
- URL `Input` with `placeholder="https://www.youtube.com/watch?v=..."`
- Checkbox: "Generate AI notes" (default unchecked)
- Note below checkbox: "AI notes generation adds 1-2 minutes to upload time"

#### Note Tab
- `Textarea` with `rows={6}` and `placeholder="Type your note here..."`
- Live title preview: "Title: <first 60 chars>..." shown below textarea in muted text

---

## Technical Research Guidance

Research needed: No

All questions have been resolved with sufficient detail from the existing codebase:

1. **IPC pattern** -- fully established in `ipc-handlers.ts` with `wrapError()` and `IpcResult<T>`.
2. **Service functions** -- all 5 operations have clear, reusable service-layer functions with well-documented signatures.
3. **File picker** -- `dialog.showOpenDialog` is already used (via `showSaveDialog`) in the codebase; Electron docs are well-known.
4. **UI components** -- `ui/dialog`, `ui/tabs`, `ui/input`, `ui/textarea`, `ui/button` all exist and are ready.
5. **Zustand pattern** -- fully established in the existing store with async actions and loading/error states.
6. **`isFilePath` handling** -- understood; no special treatment needed in the Electron layer.
7. **Preload type reflection** -- `index.d.ts` uses `typeof import('./api').api` so no manual type updates are needed.
8. **uuid dependency** -- confirmed that `uuid` is NOT in `electron-ui/package.json`. It must be added (`npm install uuid` + `npm install -D @types/uuid`) before implementing the upload handlers, since each upload generates a UUID for the `UploadEntry.id`. Alternatively, since the electron-ui main process can resolve packages from the parent project's `node_modules` (the CLI already has `uuid` installed), it may resolve at runtime -- but explicitly adding it is the safer approach.

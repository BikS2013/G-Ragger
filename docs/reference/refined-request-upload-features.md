# Refined Request: Write Operations for GeminiRAG Electron UI

## Summary

Add five write operations to the currently read-only Electron UI:

1. **Create workspace** -- from the sidebar
2. **Upload local file** -- via native file picker
3. **Upload from URL** -- web page content extraction
4. **Upload YouTube video** -- transcript extraction with optional AI notes
5. **Add personal note** -- free-text entry

All five operations already exist in the CLI service layer and must be reused as-is. The work is purely about exposing them through the Electron IPC bridge and building React UI components.

---

## Scope and Boundaries

### In Scope

- New IPC channels for workspace creation and the four upload types
- New React UI components (dialogs/panels) for each write operation
- Integration with the existing Zustand store (`src/renderer/src/store/index.ts`)
- Automatic refresh of workspace list and upload table after mutations
- Error display for failed operations
- Loading/progress indicators during async operations (Gemini uploads can take 10-120 seconds)

### Out of Scope

- Workspace deletion from the UI (not requested)
- Upload metadata editing (title, flags, expiration) from the UI (not requested)
- Upload removal from the UI (not requested)
- Channel-scan from the UI (not requested)
- Drag-and-drop file upload (nice-to-have but not required)
- Batch/multi-file upload (each upload is a single operation)

---

## Feature Specifications

### Feature 1: Create New Workspace

**Trigger:** A "+" or "New Workspace" button in the `WorkspaceSidebar` header, next to the existing refresh button.

**UI Flow:**
1. User clicks the button.
2. A dialog opens with a single text input for the workspace name.
3. User types a name and clicks "Create" (or presses Enter).
4. Validation runs client-side first (non-empty, alphanumeric + hyphens + underscores only, matching `validateWorkspaceName` rules).
5. The dialog shows a loading spinner during the Gemini API call (`createStore` + `addWorkspace`).
6. On success: dialog closes, workspace list refreshes, the new workspace is auto-selected.
7. On error: the error message is displayed inline in the dialog; the dialog remains open.

**IPC Channel:**
```
'workspace:create': {
  input: { name: string };
  output: { name: string; storeName: string };
}
```

**Main-process handler logic (mirrors CLI `src/commands/workspace.ts` lines 23-57):**
1. Call `validateWorkspaceName(name)`.
2. Call `listWorkspaces()` and check `length < 10` (Gemini API limit).
3. Check no workspace with the same name exists.
4. Call `createStore(ai, name)` to create the Gemini File Search Store.
5. Call `addWorkspace(name, storeName)` to register in the local registry.
6. Return `{ name, storeName }`.

**Rollback:** If `addWorkspace` fails after `createStore` succeeds, call `deleteStore(ai, storeName)` to clean up.

---

### Feature 2: Upload Local File

**Trigger:** An "Upload" button in the `UploadsTab` toolbar (above the filter bar), or an "Add Content" button that opens a modal with tabs/options for each upload type. The recommended approach is a single "Add Content" dialog with a tab or mode selector.

**UI Flow:**
1. User clicks "Add Content" (requires a workspace to be selected; button is disabled otherwise).
2. Dialog opens. User selects the "File" tab/option.
3. A "Browse..." button opens the native Electron file picker (`dialog.showOpenDialog`).
4. The selected file path and name are displayed.
5. User clicks "Upload".
6. Progress indicator shows during extraction + Gemini upload.
7. On success: dialog closes, upload list refreshes, success toast or inline message.
8. On error: error message shown inline, dialog stays open for retry.

**IPC Channel:**
```
'upload:file': {
  input: { workspace: string; filePath: string };
  output: UploadResultIpc;
}
```

Where `UploadResultIpc`:
```typescript
export interface UploadResultIpc {
  id: string;
  title: string;
  sourceType: SourceType;
}
```

**Main-process handler logic (mirrors CLI `src/commands/upload.ts`):**
1. Validate workspace exists via `getWorkspace(workspace)`.
2. Call `extractDiskFile(filePath)` to get `ExtractedContent`.
3. Build `customMetadata` array with `source_type` and `source_url` entries.
4. Call `uploadContent(ai, storeName, content, isFilePath, mimeType, displayName, customMetadata)`.
5. Generate UUID, build `UploadEntry`, call `addUpload(workspace, entry)`.
6. Return `{ id, title, sourceType }`.

**File picker:** The file picker dialog should run in the main process (not renderer). The IPC handler should either:
- Accept a file path string (simplest -- the renderer calls a separate `dialog:openFile` IPC to get the path, then calls `upload:file` with that path), OR
- The `upload:file` handler itself opens the file picker before proceeding. 

Recommended: separate `dialog:openFile` channel for the file picker, keeping upload logic decoupled from UI dialogs. This allows re-use if file selection is needed elsewhere.

**Additional IPC Channel (file picker):**
```
'dialog:openFile': {
  input: void;
  output: { filePath: string; fileName: string } | null;  // null if cancelled
}
```

---

### Feature 3: Upload from URL

**Trigger:** "Add Content" dialog, "Web Page" tab/option.

**UI Flow:**
1. User selects "Web Page" mode.
2. A text input for the URL is shown.
3. User pastes/types a URL and clicks "Upload".
4. Client-side validation: non-empty, starts with `http://` or `https://`.
5. Progress indicator during fetch + extraction + Gemini upload.
6. On success: dialog closes, upload list refreshes. Title is auto-derived from the page's `<title>` tag.
7. On error: error message inline (e.g., "Failed to fetch URL", "Could not extract content").

**IPC Channel:**
```
'upload:url': {
  input: { workspace: string; url: string };
  output: UploadResultIpc;
}
```

**Main-process handler logic:**
1. Call `validateUrl(url)`.
2. Call `extractWebPage(url)` for content extraction (uses Readability + Turndown for HTML-to-Markdown).
3. Build metadata, upload to Gemini, register in registry (same pattern as Feature 2).

---

### Feature 4: Upload YouTube Video

**Trigger:** "Add Content" dialog, "YouTube" tab/option.

**UI Flow:**
1. User selects "YouTube" mode.
2. A text input for the YouTube URL is shown.
3. A checkbox: "Generate AI notes" (default: unchecked).
4. User pastes a YouTube URL and clicks "Upload".
5. Client-side validation: non-empty, recognized YouTube URL pattern.
6. Progress indicator with informational text (e.g., "Fetching transcript...", "Uploading to Gemini..."). YouTube uploads are typically slower due to transcript fetch + optional notes generation.
7. On success: dialog closes, upload list refreshes.
8. On error: error message inline (common: "Transcript not available for this video").

**IPC Channel:**
```
'upload:youtube': {
  input: { workspace: string; url: string; withNotes: boolean };
  output: UploadResultIpc;
}
```

**Main-process handler logic:**
1. Call `extractYouTubeVideoId(url)` for validation.
2. Call `extractYouTubeEnhanced(url, { withNotes, ai, model, youtubeApiKey })`.
3. Build metadata, upload to Gemini, register in registry.

**Note:** The `withNotes` option requires the Gemini client (for AI generation), which is already available via `getClient()` in the service bridge. The `youtubeApiKey` comes from `getConfig().youtubeDataApiKey`.

---

### Feature 5: Add Personal Note

**Trigger:** "Add Content" dialog, "Note" tab/option.

**UI Flow:**
1. User selects "Note" mode.
2. A multi-line textarea is shown (using the existing `ui/textarea` component).
3. User types their note and clicks "Save" or "Upload".
4. Client-side validation: non-empty after trim.
5. Brief progress indicator (notes are small, upload is fast).
6. On success: dialog closes, upload list refreshes.
7. On error: error message inline.

**IPC Channel:**
```
'upload:note': {
  input: { workspace: string; text: string };
  output: UploadResultIpc;
}
```

**Main-process handler logic:**
1. Call `extractNote(text)` -- validates non-empty, generates title from first 60 chars.
2. Build metadata (source_type only; sourceUrl is null for notes).
3. Upload to Gemini, register in registry.

---

## Architecture Details

### IPC Layer Changes

**File: `src/shared/ipc-types.ts`**

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

Add new type:
```typescript
export interface UploadResultIpc {
  id: string;
  title: string;
  sourceType: string;
}
```

**File: `src/main/ipc-handlers.ts`**

Add six new `ipcMain.handle()` registrations. Each handler follows the existing `wrapError` pattern returning `IpcResult<T>`.

New imports needed:
- `addWorkspace`, `addUpload` from `@cli/services/registry.js`
- `createStore`, `deleteStore` from `@cli/services/file-search.js`
- `extractDiskFile`, `extractWebPage`, `extractYouTubeEnhanced`, `extractNote` from `@cli/services/content-extractor.js`
- `validateWorkspaceName`, `validateUrl`, `extractYouTubeVideoId` from `@cli/utils/validation.js`
- `v4 as uuidv4` from `uuid`

**File: `src/preload/api.ts`**

Add corresponding methods in the `api` object:
```typescript
workspace: {
  // ...existing...
  create: (name: string) => ipcRenderer.invoke('workspace:create', { name }),
},
upload: {
  // ...existing...
  uploadFile: (workspace: string, filePath: string) => ...,
  uploadUrl: (workspace: string, url: string) => ...,
  uploadYoutube: (workspace: string, url: string, withNotes: boolean) => ...,
  uploadNote: (workspace: string, text: string) => ...,
},
dialog: {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
},
```

**File: `src/preload/index.d.ts`**

Update the `window.api` type declaration to include the new methods.

### Zustand Store Changes

**File: `src/renderer/src/store/index.ts`**

Add to `AppStore` interface:
```typescript
// Workspace creation
isCreatingWorkspace: boolean;
createWorkspaceError: string | null;
createWorkspace: (name: string) => Promise<boolean>;

// Upload operations
isUploading: boolean;
uploadError: string | null;
uploadFile: (filePath: string) => Promise<boolean>;
uploadUrl: (url: string) => Promise<boolean>;
uploadYoutube: (url: string, withNotes: boolean) => Promise<boolean>;
uploadNote: (text: string) => Promise<boolean>;
clearUploadError: () => void;
```

Each upload action:
1. Sets `isUploading: true, uploadError: null`.
2. Calls the corresponding `window.api.upload.*` method.
3. On success: sets `isUploading: false`, calls `loadUploads()` and `loadWorkspaces()` (to update counts).
4. On error: sets `isUploading: false, uploadError: message`.
5. Returns `boolean` indicating success.

The `createWorkspace` action similarly calls `loadWorkspaces()` on success and auto-selects the new workspace.

### React Component Changes

**New component: `src/renderer/src/components/CreateWorkspaceDialog.tsx`**

- Modal dialog (using existing `ui/dialog` component).
- Contains: text input for name, Create button, Cancel button.
- Shows loading spinner when `isCreatingWorkspace` is true.
- Shows inline error from `createWorkspaceError`.
- Client-side validation before submit: non-empty, alphanumeric/hyphen/underscore pattern.

**New component: `src/renderer/src/components/AddContentDialog.tsx`**

- Modal dialog with four tabs or a mode selector:
  - **File** -- "Browse" button + file path display + "Upload" button
  - **Web Page** -- URL text input + "Upload" button
  - **YouTube** -- URL text input + "Generate AI notes" checkbox + "Upload" button
  - **Note** -- Textarea + "Save" button
- Each tab has its own submit handler calling the appropriate store action.
- Shared loading state (`isUploading`) disables all inputs and shows a spinner.
- Shared error display (`uploadError`) shows at the top of the dialog.
- Dialog closes automatically on successful upload.

**Modified component: `src/renderer/src/components/WorkspaceSidebar.tsx`**

- Add a "+" icon button next to the existing refresh button in the header.
- Clicking it opens the `CreateWorkspaceDialog`.

**Modified component: `src/renderer/src/components/UploadsTab.tsx`**

- Add an "Add Content" button in the toolbar area (above or alongside the filter bar).
- Button is disabled when no workspace is selected.
- Clicking it opens the `AddContentDialog`.

---

## Error Handling

All errors follow the existing `IpcResult<T>` wrapper pattern. Specific error scenarios:

| Scenario | Error Source | User Message |
|---|---|---|
| Workspace name invalid | `validateWorkspaceName` | "Only alphanumeric characters, hyphens, and underscores are allowed." |
| Workspace name taken | `addWorkspace` | "Workspace 'X' already exists" |
| Max 10 workspaces | CLI validation | "Maximum 10 workspaces reached..." |
| File not found | `extractDiskFile` | "File not found: '/path/to/file'" |
| Unsupported file type | `validateMimeType` | "Unsupported file type 'application/x-foo'..." |
| URL fetch failed | `extractWebPage` | "Failed to fetch URL..." |
| Content extraction failed | Readability | "Failed to extract content from URL..." |
| YouTube transcript unavailable | `extractYouTubeEnhanced` | "Transcript not available for YouTube video..." |
| Empty note | `extractNote` | "Note text cannot be empty" |
| Gemini API error | `uploadContent` | "Upload failed: ..." |
| Gemini 503 (large content) | `uploadContent` | Handled internally via 503 fallback (Files API + Import) |
| Registry write failure after Gemini upload | `addUpload` | Error + automatic Gemini document cleanup |

---

## UI/UX Considerations

1. **Loading states:** Gemini uploads can take 10-120 seconds. The dialog must show a clear, non-dismissable loading state. Consider adding elapsed time or a descriptive message ("Uploading to Gemini...").

2. **Dialog stacking:** The file picker (`dialog.showOpenDialog`) is a native OS dialog that opens on top of the Electron window. It should not conflict with the React dialog.

3. **Workspace auto-selection:** After creating a workspace, automatically select it so the user can immediately start uploading content.

4. **Upload list refresh:** After any successful upload, call `loadUploads()` to refresh the table. Also call `loadWorkspaces()` to update the upload count badges in the sidebar.

5. **Tab state:** The dialog should remember the last-used tab within a session (not persisted). Alternatively, always open on the most relevant tab.

6. **Keyboard support:** Enter to submit forms, Escape to close dialogs (standard shadcn/ui dialog behavior).

---

## Service Layer Dependencies (No Changes Required)

The following CLI services are reused directly -- no modifications needed:

| Service | Functions Used |
|---|---|
| `src/services/registry.ts` | `addWorkspace`, `addUpload`, `listWorkspaces`, `getWorkspace` |
| `src/services/file-search.ts` | `createStore`, `deleteStore`, `uploadContent` |
| `src/services/content-extractor.ts` | `extractDiskFile`, `extractWebPage`, `extractYouTubeEnhanced`, `extractNote` |
| `src/utils/validation.ts` | `validateWorkspaceName`, `validateUrl`, `extractYouTubeVideoId` |
| `src/services/gemini-client.ts` | (already used via service-bridge) |
| `electron-ui/src/main/service-bridge.ts` | `getClient()`, `getConfig()`, `initialize()` |

---

## File Change Summary

| File | Change Type |
|---|---|
| `electron-ui/src/shared/ipc-types.ts` | Modify -- add 6 IPC channels + `UploadResultIpc` type |
| `electron-ui/src/main/ipc-handlers.ts` | Modify -- add 6 handler registrations + new imports |
| `electron-ui/src/preload/api.ts` | Modify -- add 6 new API methods |
| `electron-ui/src/preload/index.d.ts` | Modify -- update window.api type |
| `electron-ui/src/renderer/src/store/index.ts` | Modify -- add create/upload state + actions |
| `electron-ui/src/renderer/src/components/CreateWorkspaceDialog.tsx` | New file |
| `electron-ui/src/renderer/src/components/AddContentDialog.tsx` | New file |
| `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx` | Modify -- add "+" button |
| `electron-ui/src/renderer/src/components/UploadsTab.tsx` | Modify -- add "Add Content" button |

---

## Testing Considerations

Manual testing scenarios:
1. Create workspace with valid name -- verify it appears in sidebar and is auto-selected.
2. Create workspace with invalid name (spaces, special chars) -- verify client-side validation error.
3. Create workspace with duplicate name -- verify server-side error displayed.
4. Upload a supported file (.pdf, .txt, .md) -- verify it appears in upload table.
5. Upload an unsupported file type -- verify error message.
6. Upload from a valid URL -- verify title is extracted from page, appears in table.
7. Upload from an invalid/unreachable URL -- verify error.
8. Upload a YouTube video with transcript -- verify it appears with "youtube" source type.
9. Upload a YouTube video without transcript -- verify "Transcript not available" error.
10. Upload a YouTube video with "Generate AI notes" checked -- verify notes are included.
11. Add a personal note -- verify it appears with "note" source type and auto-generated title.
12. Add an empty note -- verify validation error.
13. Upload while no workspace selected -- verify button is disabled.
14. Create 10th workspace -- should succeed. Create 11th -- verify "Maximum 10 workspaces" error.
15. Verify upload counts in sidebar update after each upload.

# Refined Request: GeminiRAG Electron UI

## 1. Objective

Build an Electron-based desktop UI for the GeminiRAG project that provides a graphical interface for exploring workspaces, browsing uploads, inspecting content/metadata, downloading files, querying workspaces with natural language, and filtering query results by metadata. The UI must live in a separate `electron-ui/` folder within the GeminiRAG project and must reuse the existing TypeScript service layer rather than duplicating business logic.

---

## 2. Functional Requirements

### FR-01: Workspace Explorer

| ID | Requirement |
|----|-------------|
| FR-01.1 | Display a list of all workspaces with: name, creation date, and upload count. |
| FR-01.2 | Selecting a workspace navigates to its upload list (FR-02). |
| FR-01.3 | Show workspace statistics: total uploads, breakdown by source type (file, web, youtube, note), expired count, expiring-soon count. |
| FR-01.4 | Provide a refresh action to reload workspace data from the registry. |

**Data source**: `listWorkspaces()` from `services/registry.ts`, `formatWorkspaceInfo()` logic from `utils/format.ts`.

### FR-02: Upload Browser

| ID | Requirement |
|----|-------------|
| FR-02.1 | Display all uploads in the selected workspace as a table/list with columns: ID (short), title, source type, date, flags, expiration status. |
| FR-02.2 | Support filtering uploads by: source type (file/web/youtube/note), flags (completed/urgent/inactive), expiration status (expired/expiring_soon/active). |
| FR-02.3 | Support sorting by timestamp (ascending/descending). |
| FR-02.4 | Clicking an upload opens the detail/inspection view (FR-03). |
| FR-02.5 | Show visual indicators for expiration status (expired = red, expiring soon = orange). |
| FR-02.6 | Show visual badges or tags for flags (completed, urgent, inactive). |

**Data source**: `getWorkspace()` from `services/registry.ts`, filter/sort logic from `commands/uploads.ts`.

### FR-03: Upload Detail / Content Inspection

| ID | Requirement |
|----|-------------|
| FR-03.1 | Display full metadata for the selected upload: ID, title, source type, source URL (clickable if present), upload timestamp, expiration date, flags, Gemini document name. |
| FR-03.2 | Fetch and display the document content retrieved via the Gemini File Search grounding approach. |
| FR-03.3 | Show a loading state while content is being fetched from Gemini. |
| FR-03.4 | Display the truncation warning if the content was truncated. |
| FR-03.5 | Render content in a scrollable, monospace or markdown-rendered panel. |

**Data source**: `getDocumentContent()` from `services/file-search.ts`, metadata from `UploadEntry` type.

### FR-04: File Download

| ID | Requirement |
|----|-------------|
| FR-04.1 | Provide a "Download" button in the upload detail view. |
| FR-04.2 | When clicked, open an Electron native "Save As" dialog. |
| FR-04.3 | Save the retrieved document content (the text fetched via FR-03.2) to the user-selected path. |
| FR-04.4 | Default the filename to `{upload.title}.md` (sanitized for filesystem safety). |

**Implementation**: Use Electron's `dialog.showSaveDialog()` API combined with Node.js `fs.writeFileSync()`.

### FR-05: Workspace Query (Ask)

| ID | Requirement |
|----|-------------|
| FR-05.1 | Provide a query input area within the workspace context (text field + submit button). |
| FR-05.2 | Execute the query against the selected workspace's Gemini store. |
| FR-05.3 | Display the natural language answer in a styled response area. |
| FR-05.4 | Display citations as a list below the answer, each showing: citation number, document title, document URI, and text excerpt. |
| FR-05.5 | Each citation should be clickable, navigating to the corresponding upload's detail view (FR-03) if it matches a local registry entry. |
| FR-05.6 | Show a loading/spinner state while the query is executing. |
| FR-05.7 | Support querying across multiple workspaces (optional multi-select). |

**Data source**: `query()` from `services/file-search.ts`, filter logic from `commands/query.ts`.

### FR-06: Query Filter Panel

| ID | Requirement |
|----|-------------|
| FR-06.1 | Provide a filter panel accessible before/during query submission. |
| FR-06.2 | Support Gemini-side filters (sent with the query): `source_type` (dropdown: file/web/youtube/note), `source_url` (text input). |
| FR-06.3 | Support client-side filters (applied to citations after query returns): `flags` (multi-select: completed/urgent/inactive), `expiration_status` (dropdown: expired/expiring_soon/active). |
| FR-06.4 | Clearly distinguish between Gemini-side filters (affect which documents are searched) and client-side filters (affect which citations are shown). |
| FR-06.5 | Filters should be clearable/resettable. |

**Data source**: Filter parsing and application logic from `commands/query.ts` (parseFilter, buildMetadataFilter, passesClientFilters).

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Separate folder**: All Electron UI code lives in `electron-ui/` under the GeminiRAG project root. It has its own `package.json`, `tsconfig.json`, and build scripts. |
| NFR-02 | **Service reuse**: The Electron main process imports and calls functions directly from the existing `../src/` service layer (registry, file-search, gemini-client, config). No duplication of business logic. |
| NFR-03 | **Configuration**: Uses the same configuration mechanism as the CLI (`loadConfig()` from `config/config.ts`). No fallback values -- missing config raises an error displayed in the UI. |
| NFR-04 | **Technology stack**: Electron (latest stable), TypeScript, React for the renderer process. IPC bridge (contextBridge/preload) for secure main-renderer communication. |
| NFR-05 | **Responsive layout**: The UI adapts to window resizing. Minimum supported window size: 900x600 pixels. |
| NFR-06 | **Modern appearance**: Clean, minimal design. Use a component library (e.g., Tailwind CSS or a lightweight React component library). Dark mode support is desirable but not required for initial release. |
| NFR-07 | **Error handling**: All service-layer errors (config missing, workspace not found, Gemini API errors) are caught and displayed as user-friendly error messages in the UI, not silent failures. |
| NFR-08 | **Performance**: Workspace listing and upload listing are synchronous (registry is a JSON file). Only Gemini API calls (content retrieval, queries) are async and must show loading indicators. |
| NFR-09 | **No auto-updates**: The app is run locally; no auto-update mechanism required. |
| NFR-10 | **Build**: A single `npm run build` command produces a runnable Electron app. A `npm run dev` command runs in development mode with hot reload for the renderer. |

---

## 4. Architecture Constraints

| ID | Constraint |
|----|-----------|
| AC-01 | The Electron **main process** handles all Node.js / Gemini API operations by importing from `../src/services/`, `../src/config/`, and `../src/types/`. |
| AC-02 | The **renderer process** (React) communicates with the main process exclusively through a typed IPC bridge (preload script with `contextBridge.exposeInMainWorld`). |
| AC-03 | The renderer process must NOT have direct access to Node.js APIs or the filesystem (context isolation enabled, nodeIntegration disabled). |
| AC-04 | The `electron-ui/package.json` must declare `../src` files as part of its TypeScript compilation (via `tsconfig.json` paths or references) rather than copying them. |
| AC-05 | The existing CLI (`src/cli.ts`) must remain fully functional and unmodified. The Electron UI is an additive, parallel entry point. |
| AC-06 | No fallback values for configuration. If `GEMINI_API_KEY` or `GEMINI_MODEL` are not configured, the UI must display the error message from `loadConfig()` and prevent further operations. |

---

## 5. IPC Contract (Main <-> Renderer)

The preload script exposes a typed API object. Below is the contract for all IPC channels:

### Workspace Operations
| Channel | Direction | Input | Output |
|---------|-----------|-------|--------|
| `workspace:list` | renderer -> main | none | `WorkspaceData[]` |
| `workspace:get` | renderer -> main | `{ name: string }` | `WorkspaceData` |

### Upload Operations
| Channel | Direction | Input | Output |
|---------|-----------|-------|--------|
| `upload:list` | renderer -> main | `{ workspace: string, filters?: {key,value}[], sort?: string }` | `UploadEntry[]` |
| `upload:getContent` | renderer -> main | `{ workspace: string, uploadId: string }` | `{ metadata: UploadEntry, content: string }` |
| `upload:download` | renderer -> main | `{ workspace: string, uploadId: string }` | `{ success: boolean, path?: string }` |

### Query Operations
| Channel | Direction | Input | Output |
|---------|-----------|-------|--------|
| `query:ask` | renderer -> main | `{ workspaces: string[], question: string, geminiFilters?: {key,value}[], clientFilters?: {key,value}[] }` | `QueryResult` (with citations potentially filtered client-side) |

### Config Operations
| Channel | Direction | Input | Output |
|---------|-----------|-------|--------|
| `config:validate` | renderer -> main | none | `{ valid: boolean, error?: string }` |

---

## 6. UI Layout

```
+-----------------------------------------------------------+
| [GeminiRAG]                                    [Settings]  |
+------------+----------------------------------------------+
|            |                                              |
| Workspaces |  Content Area                                |
|            |                                              |
| > research |  [Upload List | Query Tab]                   |
|   notes    |                                              |
|   archive  |  +------------------------------------------+|
|            |  | Filter bar: [Source] [Flags] [Expiration] ||
|            |  +------------------------------------------+|
|            |  | ID   | Title      | Source | Date | Flags ||
|            |  | abc1 | Article... | web    | 04-10| urgent||
|            |  | def2 | Video...   | yt     | 04-09|       ||
|            |  +------------------------------------------+|
|            |                                              |
+------------+----------------------------------------------+
```

- **Left sidebar**: Workspace list (always visible).
- **Main area**: Tabbed view -- "Uploads" tab (default) and "Ask" tab.
- **Uploads tab**: Filter bar at top, upload table below. Clicking a row opens a detail panel (slide-in or modal).
- **Ask tab**: Question input, filter panel (collapsible), answer display area with citations list.
- **Detail panel**: Full metadata, content viewer, download button.

---

## 7. Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-01 | User can launch the Electron app, see all workspaces from `~/.g-ragger/registry.json`, and select one. |
| AC-02 | User can view all uploads in a workspace, filter by source type, flags, and expiration status, and sort by date. |
| AC-03 | User can click an upload and see its full metadata and content fetched from Gemini. |
| AC-04 | User can download the content of an upload to a local file via a native Save dialog. |
| AC-05 | User can type a question, submit it, and see the answer with clickable citations linking to upload details. |
| AC-06 | User can apply Gemini-side and client-side filters before/after querying and see filtered citation results. |
| AC-07 | If configuration is missing (`GEMINI_API_KEY`, `GEMINI_MODEL`), the app displays the exact error from `loadConfig()` on startup and blocks API-dependent operations. |
| AC-08 | The existing CLI (`npx tsx src/cli.ts`) continues to work without any changes. |
| AC-09 | The app builds and runs with `cd electron-ui && npm install && npm run dev`. |

---

## 8. Assumptions

| ID | Assumption |
|----|-----------|
| A-01 | The user has Node.js 18+ installed. |
| A-02 | The user has a valid `~/.g-ragger/config.json` or environment variables with `GEMINI_API_KEY` and `GEMINI_MODEL`. |
| A-03 | The `~/.g-ragger/registry.json` file exists (created by prior CLI usage). If not, the app shows an empty workspace list. |
| A-04 | The Electron app is for local development/personal use -- no packaging for distribution (e.g., DMG/installer) is required in the first version. |
| A-05 | The existing service layer functions (`services/registry.ts`, `services/file-search.ts`, etc.) are stable and can be imported as-is by the Electron main process. |
| A-06 | "Download" means saving the text content retrieved via Gemini grounding to a local file, not downloading the original binary file (since originals may be web pages, YouTube transcripts, or notes that only exist as indexed Gemini documents). |

---

## 9. Out of Scope (First Version)

| ID | Item |
|----|------|
| OOS-01 | Creating, deleting, or modifying workspaces from the UI (read-only workspace management). |
| OOS-02 | Uploading new content (files, URLs, YouTube, notes) from the UI. |
| OOS-03 | Editing metadata (title, flags, expiration) from the UI. |
| OOS-04 | Channel scan functionality. |
| OOS-05 | DMG/installer packaging for distribution. |
| OOS-06 | Dark mode (desirable but not required). |
| OOS-07 | Multi-workspace query (UI shows single-workspace query; multi-workspace is a stretch goal). |

---

## 10. Reusable Service Layer Mapping

The following existing modules will be imported by the Electron main process:

| Electron Feature | Existing Module | Functions Used |
|-----------------|----------------|----------------|
| Workspace list | `services/registry.ts` | `listWorkspaces()`, `getWorkspace()` |
| Upload list + filters | `services/registry.ts` | `getWorkspace()` (then filter/sort in main process, reusing logic from `commands/uploads.ts`) |
| Content retrieval | `services/file-search.ts` | `getDocumentContent()` |
| Query execution | `services/file-search.ts` | `query()` |
| Gemini client init | `services/gemini-client.ts` | `createGeminiClient()` |
| Configuration | `config/config.ts` | `loadConfig()` |
| Types | `types/index.ts` | All exported types/interfaces |
| Expiration logic | `utils/format.ts` | `getExpirationIndicator()` |

---

## 11. File Structure

```
GeminiRAG/
  electron-ui/
    package.json
    tsconfig.json
    electron-builder.json          (optional, for future packaging)
    src/
      main/
        main.ts                    (Electron main process entry)
        ipc-handlers.ts            (IPC handler registrations)
        preload.ts                 (contextBridge API)
      renderer/
        index.html
        index.tsx                  (React entry)
        App.tsx
        components/
          WorkspaceSidebar.tsx
          UploadTable.tsx
          UploadDetail.tsx
          QueryPanel.tsx
          FilterBar.tsx
          CitationList.tsx
          ErrorBanner.tsx
          LoadingSpinner.tsx
        hooks/
          useWorkspaces.ts
          useUploads.ts
          useQuery.ts
        types/
          ipc.ts                   (Typed IPC contract interfaces)
        styles/
          global.css
    vite.config.ts                 (or equivalent bundler config for renderer)
  src/                             (existing CLI source -- unchanged)
  ...
```

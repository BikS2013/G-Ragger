# Plan 003: GeminiRAG Electron UI

**Date**: 2026-04-10
**Status**: Proposed
**Dependencies**: Plan 001 (CLI implementation), Plan 002 (v2 enhancements)
**Scope**: Electron desktop application for GeminiRAG workspace exploration, upload browsing, content inspection, file download, semantic querying, and query filtering.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Phase Summary](#3-phase-summary)
4. [Phase 0: Filter/Sort Utility Extraction (Prerequisite)](#4-phase-0-filtersort-utility-extraction-prerequisite)
5. [Phase 1: Electron-Vite Project Scaffolding](#5-phase-1-electron-vite-project-scaffolding)
6. [Phase 2: Main Process -- Service Bridge and IPC Handlers](#6-phase-2-main-process----service-bridge-and-ipc-handlers)
7. [Phase 3: Preload Script and Typed API](#7-phase-3-preload-script-and-typed-api)
8. [Phase 4: Renderer -- Foundation and Layout Shell](#8-phase-4-renderer----foundation-and-layout-shell)
9. [Phase 5: Renderer -- Workspace Explorer (FR-01)](#9-phase-5-renderer----workspace-explorer-fr-01)
10. [Phase 6: Renderer -- Upload Browser (FR-02)](#10-phase-6-renderer----upload-browser-fr-02)
11. [Phase 7: Renderer -- Upload Detail / Content Inspection (FR-03) and File Download (FR-04)](#11-phase-7-renderer----upload-detail--content-inspection-fr-03-and-file-download-fr-04)
12. [Phase 8: Renderer -- Workspace Query (FR-05) and Query Filter Panel (FR-06)](#12-phase-8-renderer----workspace-query-fr-05-and-query-filter-panel-fr-06)
13. [Phase 9: Integration, Polish, and Verification](#13-phase-9-integration-polish-and-verification)
14. [Dependency Graph](#14-dependency-graph)
15. [Parallelization Strategy](#15-parallelization-strategy)
16. [File Inventory](#16-file-inventory)
17. [Risks and Mitigations](#17-risks-and-mitigations)

---

## 1. Overview

This plan details the implementation of an Electron-based desktop UI for GeminiRAG. The UI lives in `electron-ui/` under the GeminiRAG project root and reuses the existing TypeScript service layer via IPC. The renderer uses React + Tailwind CSS + shadcn/ui + Zustand, and the main process is bundled to CJS by electron-vite (Rollup) to resolve the ESM compatibility gap with the existing pure-ESM service layer.

**Key architectural decisions** (from investigation):
- **electron-vite** for unified build (main + preload + renderer)
- **esbuild/Rollup** bundles main process to CJS, resolving all `../src/` ESM imports at build time
- **shadcn/ui + @tanstack/react-table** for the upload DataTable
- **Zustand** for lightweight state management
- **Pattern 3 (shared interface contract)** for typed IPC between preload and renderer
- **Thin service bridge** in main process for Gemini client lifecycle and error normalization

---

## 2. Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Desktop runtime | Electron | ^41.0.0 |
| Build tool | electron-vite | ^5.0.0 |
| Renderer framework | React | ^18.0.0 |
| CSS | Tailwind CSS 4.x + @tailwindcss/vite | ^4.0.0 |
| UI components | shadcn/ui (Radix UI primitives) | Latest |
| Data table | @tanstack/react-table | ^8.0.0 |
| State management | Zustand | ^5.0.0 |
| Icons | lucide-react | Latest |
| Language | TypeScript | ^5.0.0 |

---

## 3. Phase Summary

| Phase | Name | Dependencies | Parallelizable With | Estimated Effort |
|-------|------|-------------|---------------------|-----------------|
| 0 | Filter/Sort Utility Extraction | None | None (must complete first) | Small |
| 1 | Electron-Vite Project Scaffolding | None | Phase 0 | Medium |
| 2 | Main Process: Service Bridge + IPC | Phase 0, 1 | Phase 3 | Medium |
| 3 | Preload Script + Typed API | Phase 1 | Phase 2 | Small |
| 4 | Renderer: Foundation + Layout Shell | Phase 1 | Phases 2, 3 | Medium |
| 5 | Renderer: Workspace Explorer | Phases 2, 3, 4 | Phase 6 (partially) |  Small |
| 6 | Renderer: Upload Browser | Phases 2, 3, 4 | Phase 5 (partially) | Medium |
| 7 | Renderer: Detail + Download | Phases 2, 3, 4 | Phase 8 | Medium |
| 8 | Renderer: Query + Filter Panel | Phases 2, 3, 4 | Phase 7 | Medium |
| 9 | Integration, Polish, Verification | All above | None | Medium |

---

## 4. Phase 0: Filter/Sort Utility Extraction (Prerequisite)

### Objective

Extract private filter, sort, and lookup functions from `commands/uploads.ts`, `commands/query.ts`, and `commands/get.ts` into a shared utility module `src/utils/filters.ts`. This is a pure refactor -- the CLI must remain fully functional with zero behavioral changes.

### Files Created

| File | Purpose |
|------|---------|
| `src/utils/filters.ts` | Shared filter/sort/lookup utilities |

### Files Modified

| File | Change |
|------|--------|
| `src/commands/uploads.ts` | Import `parseListingFilter`, `applyFilters`, `sortUploads` from `../utils/filters.js` instead of declaring them privately |
| `src/commands/query.ts` | Import `parseFilter`, `buildMetadataFilter`, `findUploadByDocumentUri`, `passesClientFilters` from `../utils/filters.js` |
| `src/commands/get.ts` | Import `findUploadById` from `../utils/filters.js` |

### Functions to Extract

From `commands/uploads.ts`:
- `parseListingFilter(filterStr: string): { key: string; value: string }` (line 9)
- `applyFilters(uploads: UploadEntry[], filters: { key: string; value: string }[]): UploadEntry[]` (line 33)
- `sortUploads(uploads: UploadEntry[], sortField?: string): UploadEntry[]` (line 74)

From `commands/query.ts`:
- Constants: `GEMINI_FILTER_KEYS`, `CLIENT_FILTER_KEYS` (lines 10-13)
- `parseFilter(filterStr: string): ParsedFilter` (line 18)
- `buildMetadataFilter(geminiFilters: ParsedFilter[]): string | undefined` (line 44)
- `findUploadByDocumentUri(workspaceNames: string[], documentUri: string): UploadEntry | undefined` (line 55)
- `passesClientFilters(upload: UploadEntry | undefined, clientFilters: ParsedFilter[]): boolean` (line 74)

From `commands/get.ts`:
- `findUploadById(uploads: Record<string, UploadEntry>, uploadId: string): UploadEntry | undefined` (line 13)

### Acceptance Criteria

- [ ] All extracted functions are exported from `src/utils/filters.ts` with JSDoc comments
- [ ] All three command files import from `../utils/filters.js` instead of declaring private functions
- [ ] Existing CLI tests pass without changes: `npx tsx test_scripts/test-*.ts`
- [ ] `npx tsc --noEmit` succeeds with no new errors
- [ ] No behavioral changes to any CLI command

### Verification Commands

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/GeminiRAG
npx tsc --noEmit
npx tsx test_scripts/test-validation.ts
npx tsx test_scripts/test-config.ts
npx tsx test_scripts/test-registry.ts
npx tsx test_scripts/test-format.ts
```

---

## 5. Phase 1: Electron-Vite Project Scaffolding

### Objective

Create the `electron-ui/` directory with all build configuration, package.json, tsconfig.json, and electron-vite config. The goal is a minimal runnable Electron app that opens a blank window.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/package.json` | Project manifest (no `"type": "module"`) |
| `electron-ui/tsconfig.json` | TypeScript configuration (`"module": "CommonJS"`, `"moduleResolution": "Node"`) |
| `electron-ui/tsconfig.node.json` | TypeScript config for electron-vite config file |
| `electron-ui/electron.vite.config.ts` | electron-vite unified build config (main + preload + renderer) |
| `electron-ui/src/main/main.ts` | Minimal Electron main process (BrowserWindow + load renderer) |
| `electron-ui/src/preload/preload.ts` | Minimal preload (empty contextBridge) |
| `electron-ui/src/renderer/index.html` | HTML entry for renderer |
| `electron-ui/src/renderer/src/main.tsx` | React entry point (renders `<div>Hello</div>`) |
| `electron-ui/src/renderer/src/App.tsx` | Placeholder App component |
| `electron-ui/src/renderer/src/app.css` | Global CSS with Tailwind import |
| `electron-ui/src/renderer/tsconfig.json` | Renderer-specific TypeScript config |
| `electron-ui/components.json` | shadcn/ui configuration file |
| `electron-ui/.gitignore` | Ignore `node_modules/`, `out/`, `dist/` |

### Key Configuration Details

**`electron.vite.config.ts`**:
- Main entry: `src/main/main.ts`
- Preload entry: `src/preload/preload.ts`
- Renderer root: `src/renderer`
- Renderer entry: `src/renderer/index.html`
- Main process `resolve.alias`: `@cli` -> `../src`
- Main process `build.watch.include`: `['src/**', '../src/**']`
- Main process `build.sourcemap`: `true`

**`package.json`**:
- `"main": "out/main/index.js"`
- No `"type": "module"` field
- Scripts: `dev`, `build`, `preview`
- devDependencies: `electron`, `electron-vite`, `typescript`, `@types/node`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/vite`, `autoprefixer`

**`tsconfig.json`**:
- `"module": "CommonJS"`, `"moduleResolution": "Node"`
- `"paths": { "@cli/*": ["../src/*"] }`
- `"include": ["src/**/*"]`, `"exclude": ["node_modules", "out"]`

### Acceptance Criteria

- [ ] `cd electron-ui && npm install` completes without errors
- [ ] `cd electron-ui && npm run build` produces files in `electron-ui/out/`
- [ ] `cd electron-ui && npm run dev` opens a blank Electron window
- [ ] No changes to any files under `src/` (existing CLI tree)
- [ ] TypeScript compilation of `electron-ui/` succeeds: `cd electron-ui && npx tsc --noEmit`

### Verification Commands

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/GeminiRAG/electron-ui
npm install
npm run build
# Visual check: npm run dev (opens window)
```

---

## 6. Phase 2: Main Process -- Service Bridge and IPC Handlers

### Objective

Implement the service bridge (`service-bridge.ts`) that manages Gemini client lifecycle, config loading, and error normalization. Implement all IPC handlers (`ipc-handlers.ts`) that dispatch to the service layer. Define shared IPC type contract.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/shared/ipc-types.ts` | IPC channel map, input/output types, `IpcResult<T>` wrapper |
| `electron-ui/src/main/service-bridge.ts` | Thin facade: `initialize()`, `getClient()`, `getConfig()`, console.warn interception |
| `electron-ui/src/main/ipc-handlers.ts` | `ipcMain.handle()` registrations for all 6 channels |

### Files Modified

| File | Change |
|------|--------|
| `electron-ui/src/main/main.ts` | Import and call `registerIpcHandlers()` and `initializeServiceBridge()` at startup |

### IPC Channel Definitions

```typescript
// electron-ui/src/shared/ipc-types.ts

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

interface IpcChannelMap {
  'workspace:list': { input: void; output: WorkspaceSummary[] };
  'workspace:get': { input: { name: string }; output: WorkspaceDetail };
  'upload:list': { input: { workspace: string; filters?: { key: string; value: string }[]; sort?: string }; output: UploadEntry[] };
  'upload:getContent': { input: { workspace: string; uploadId: string }; output: { metadata: UploadEntry; content: string } };
  'upload:download': { input: { workspace: string; uploadId: string }; output: { success: boolean; path?: string } };
  'query:ask': { input: QueryInput; output: QueryResult };
  'config:validate': { input: void; output: { valid: boolean; error?: string; warnings?: string[] } };
}
```

### Service Bridge Design

```
service-bridge.ts
  ├── initialize(): IpcResult<ConfigValidation>
  │     Calls loadConfig(), creates GoogleGenAI client, intercepts console.warn
  │     Caches config + client for reuse
  │     Returns config status (valid/invalid) + any warnings
  ├── getClient(): GoogleGenAI
  │     Returns cached client (throws if not initialized)
  ├── getConfig(): AppConfig
  │     Returns cached config (throws if not initialized)
  └── shutdown(): void
        Cleanup (if needed)
```

### IPC Handler Logic

| Channel | Handler Logic |
|---------|--------------|
| `workspace:list` | Call `listWorkspaces()`, map to summary objects (name, createdAt, upload count, source type breakdown) |
| `workspace:get` | Call `getWorkspace(name)`, compute statistics (expired count, expiring-soon count, source type counts) |
| `upload:list` | Call `getWorkspace()`, extract uploads, apply `applyFilters()` + `sortUploads()` from `utils/filters.ts` |
| `upload:getContent` | Call `findUploadById()`, then `getDocumentContent()` via service bridge client |
| `upload:download` | Call `findUploadById()`, `getDocumentContent()`, show `dialog.showSaveDialog()`, write to file |
| `query:ask` | Parse filters with `parseFilter()`/`buildMetadataFilter()`, call `query()`, apply `passesClientFilters()` |
| `config:validate` | Call `initialize()` on service bridge, return result |

### Acceptance Criteria

- [ ] All 7 IPC channels are registered with `ipcMain.handle()`
- [ ] `IpcChannelMap` type is complete and used by both handler and preload sides
- [ ] `IpcResult<T>` wrapper is used for all handler return values
- [ ] Service bridge creates and caches a single GoogleGenAI instance
- [ ] Service bridge intercepts `console.warn` during `loadConfig()` to capture expiration warnings
- [ ] Missing config results in `{ success: false, error: "..." }`, not a crash
- [ ] All handlers import filter/sort functions from `../../src/utils/filters.js` (not from commands)
- [ ] `cd electron-ui && npm run build` succeeds (main process compiles)

### Verification Commands

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/GeminiRAG/electron-ui
npm run build
# Check out/main/index.js exists and is valid CJS
```

---

## 7. Phase 3: Preload Script and Typed API

### Objective

Implement the preload script that exposes a typed `window.api` object via `contextBridge.exposeInMainWorld`. Create the type declaration file so the renderer gets full IntelliSense.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/preload/api.ts` | API implementation: typed functions wrapping `ipcRenderer.invoke()` for each channel |
| `electron-ui/src/preload/index.d.ts` | Global `Window` augmentation with `api` type derived from `api.ts` |

### Files Modified

| File | Change |
|------|--------|
| `electron-ui/src/preload/preload.ts` | Import `api` from `./api`, call `contextBridge.exposeInMainWorld('api', api)` |
| `electron-ui/src/renderer/tsconfig.json` | Add `../preload/index.d.ts` to `include` array |

### API Object Shape

```typescript
// electron-ui/src/preload/api.ts
export const api = {
  workspace: {
    list: (): Promise<IpcResult<WorkspaceSummary[]>> => 
      ipcRenderer.invoke('workspace:list'),
    get: (name: string): Promise<IpcResult<WorkspaceDetail>> =>
      ipcRenderer.invoke('workspace:get', { name }),
  },
  upload: {
    list: (workspace: string, filters?, sort?): Promise<IpcResult<UploadEntry[]>> =>
      ipcRenderer.invoke('upload:list', { workspace, filters, sort }),
    getContent: (workspace: string, uploadId: string): Promise<IpcResult<...>> =>
      ipcRenderer.invoke('upload:getContent', { workspace, uploadId }),
    download: (workspace: string, uploadId: string): Promise<IpcResult<...>> =>
      ipcRenderer.invoke('upload:download', { workspace, uploadId }),
  },
  query: {
    ask: (input: QueryInput): Promise<IpcResult<QueryResult>> =>
      ipcRenderer.invoke('query:ask', input),
  },
  config: {
    validate: (): Promise<IpcResult<ConfigValidation>> =>
      ipcRenderer.invoke('config:validate'),
  },
}
```

### Type Declaration Pattern

Uses **Pattern 3 (shared interface contract)** from the preload types research. The `IpcChannelMap` in `shared/ipc-types.ts` serves as the contract. The preload `api.ts` is typed against it, and the renderer declaration derives from `typeof import('./api').api`.

### Acceptance Criteria

- [ ] `window.api` is fully typed in the renderer (IntelliSense works for all methods)
- [ ] Preload script compiles without errors in electron-vite build
- [ ] Context isolation is enabled (`contextIsolation: true` in BrowserWindow config)
- [ ] `nodeIntegration` is `false` in BrowserWindow config
- [ ] All API methods return `Promise<IpcResult<T>>` (no raw promise rejections)
- [ ] `cd electron-ui && npm run build` succeeds

### Verification Commands

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/GeminiRAG/electron-ui
npm run build
```

---

## 8. Phase 4: Renderer -- Foundation and Layout Shell

### Objective

Set up the React renderer with Tailwind CSS, shadcn/ui component library, Zustand store, and the master layout (sidebar + content area with tabs). All components are shells with placeholder content.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/renderer/src/lib/utils.ts` | shadcn/ui `cn()` utility (Tailwind class merging) |
| `electron-ui/src/renderer/src/components/ui/button.tsx` | shadcn/ui Button |
| `electron-ui/src/renderer/src/components/ui/badge.tsx` | shadcn/ui Badge |
| `electron-ui/src/renderer/src/components/ui/input.tsx` | shadcn/ui Input |
| `electron-ui/src/renderer/src/components/ui/select.tsx` | shadcn/ui Select |
| `electron-ui/src/renderer/src/components/ui/table.tsx` | shadcn/ui Table |
| `electron-ui/src/renderer/src/components/ui/tabs.tsx` | shadcn/ui Tabs |
| `electron-ui/src/renderer/src/components/ui/dialog.tsx` | shadcn/ui Dialog |
| `electron-ui/src/renderer/src/components/ui/scroll-area.tsx` | shadcn/ui ScrollArea |
| `electron-ui/src/renderer/src/components/ui/separator.tsx` | shadcn/ui Separator |
| `electron-ui/src/renderer/src/components/ui/textarea.tsx` | shadcn/ui Textarea |
| `electron-ui/src/renderer/src/components/ui/skeleton.tsx` | shadcn/ui Skeleton (loading states) |
| `electron-ui/src/renderer/src/components/ErrorBanner.tsx` | Error display banner |
| `electron-ui/src/renderer/src/components/LoadingSpinner.tsx` | Loading indicator |
| `electron-ui/src/renderer/src/store/index.ts` | Zustand store definition |
| `electron-ui/src/renderer/src/layout/AppLayout.tsx` | Master layout: sidebar + content area |

### Files Modified

| File | Change |
|------|--------|
| `electron-ui/src/renderer/src/App.tsx` | Wire up AppLayout, config validation on mount, ErrorBanner for config errors |
| `electron-ui/src/renderer/src/app.css` | Tailwind base + shadcn/ui CSS variables for theming |

### Zustand Store Shape

```typescript
interface AppStore {
  // Config
  configValid: boolean;
  configError: string | null;
  configWarnings: string[];
  validateConfig: () => Promise<void>;

  // Workspaces
  workspaces: WorkspaceSummary[];
  selectedWorkspace: string | null;
  loadWorkspaces: () => Promise<void>;
  selectWorkspace: (name: string) => void;

  // Uploads
  uploads: UploadEntry[];
  uploadsLoading: boolean;
  uploadFilters: { key: string; value: string }[];
  uploadSort: string;
  loadUploads: () => Promise<void>;
  setUploadFilters: (filters: { key: string; value: string }[]) => void;
  setUploadSort: (sort: string) => void;

  // Selected upload (detail view)
  selectedUpload: UploadEntry | null;
  uploadContent: string | null;
  contentLoading: boolean;
  selectUpload: (upload: UploadEntry) => void;
  clearSelectedUpload: () => void;
  loadUploadContent: (workspace: string, uploadId: string) => Promise<void>;

  // Query
  queryResult: QueryResult | null;
  isQuerying: boolean;
  queryError: string | null;
  executeQuery: (workspaces: string[], question: string, geminiFilters?: ..., clientFilters?: ...) => Promise<void>;
  clearQueryResult: () => void;

  // Active tab
  activeTab: 'uploads' | 'ask';
  setActiveTab: (tab: 'uploads' | 'ask') => void;
}
```

### Layout Structure

```
+-----------------------------------------------------------+
| GeminiRAG                                                  |
+------------------+----------------------------------------+
|                  |                                        |
| Sidebar          |  Content Area                          |
| (WorkspaceList)  |  [Uploads Tab] [Ask Tab]               |
|                  |                                        |
| [Refresh btn]    |  {tab content placeholder}             |
|                  |                                        |
| > workspace1     |                                        |
|   workspace2     |                                        |
|   workspace3     |                                        |
|                  |                                        |
+------------------+----------------------------------------+
```

### Acceptance Criteria

- [ ] App renders with sidebar + content area layout
- [ ] Tabs switch between "Uploads" and "Ask" views
- [ ] Zustand store is defined with all slices
- [ ] Config validation runs on app mount; error banner shows if config is invalid
- [ ] shadcn/ui components render correctly (Tailwind configured)
- [ ] Minimum window size enforced: 900x600
- [ ] `cd electron-ui && npm run build` succeeds
- [ ] `cd electron-ui && npm run dev` shows the layout shell

### Verification Commands

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/GeminiRAG/electron-ui
npm run build
```

---

## 9. Phase 5: Renderer -- Workspace Explorer (FR-01)

### Objective

Implement the workspace sidebar component that displays all workspaces with name, creation date, and upload count. Selecting a workspace loads its uploads. Shows workspace statistics.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx` | Workspace list with selection, stats, refresh |

### Files Modified

| File | Change |
|------|--------|
| `electron-ui/src/renderer/src/layout/AppLayout.tsx` | Integrate `WorkspaceSidebar` into sidebar slot |

### Component Requirements

- Display each workspace: name, creation date (formatted), upload count
- Highlight selected workspace
- Show statistics for selected workspace: total uploads, by source type (file/web/youtube/note), expired count, expiring-soon count
- Refresh button calls `loadWorkspaces()` on store
- If no workspaces exist, show "No workspaces found" message

### Acceptance Criteria

- [ ] FR-01.1: Workspace list shows name, creation date, upload count
- [ ] FR-01.2: Clicking a workspace sets it as selected, triggers upload loading
- [ ] FR-01.3: Workspace statistics displayed (total, by source type, expired, expiring-soon)
- [ ] FR-01.4: Refresh button reloads workspace data
- [ ] Empty state handled gracefully

---

## 10. Phase 6: Renderer -- Upload Browser (FR-02)

### Objective

Implement the upload table with @tanstack/react-table, filter bar, and sorting. Uses shadcn/ui DataTable pattern.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/renderer/src/components/uploads-table/columns.tsx` | Column definitions with custom cell renderers (badges, expiration indicators) |
| `electron-ui/src/renderer/src/components/uploads-table/data-table.tsx` | DataTable component using @tanstack/react-table + shadcn/ui Table |
| `electron-ui/src/renderer/src/components/UploadsFilterBar.tsx` | Filter controls: source type dropdown, flags dropdown, expiration status dropdown, clear button |
| `electron-ui/src/renderer/src/components/UploadsTab.tsx` | Orchestrates filter bar + data table + row click handling |

### Column Definitions

| Column | Accessor | Cell Renderer |
|--------|----------|--------------|
| ID | `id` | Truncated to first 8 chars, monospace |
| Title | `title` | Font medium |
| Source | `sourceType` | Badge with variant per type |
| Date | `timestamp` | Formatted date |
| Flags | `flags` | Badge array (urgent = destructive, completed = secondary, inactive = outline) |
| Expiration | `expirationDate` | Color-coded: red (expired), orange (expiring soon), muted (none) |

### Filter Bar

- Source type: Select dropdown (All / file / web / youtube / note)
- Flags: Select dropdown (All / urgent / completed / inactive)
- Expiration: Select dropdown (All / expired / expiring_soon / active)
- Clear button: resets all filters
- Filters update the Zustand store, which triggers re-fetch via IPC

### Acceptance Criteria

- [ ] FR-02.1: Upload table shows ID (short), title, source type, date, flags, expiration status
- [ ] FR-02.2: Filtering by source type, flags, and expiration status works
- [ ] FR-02.3: Sorting by timestamp (click column header) works
- [ ] FR-02.4: Clicking a row triggers upload detail view
- [ ] FR-02.5: Expired uploads show red indicator; expiring-soon shows orange
- [ ] FR-02.6: Flags display as colored badges
- [ ] Empty state: "No uploads in this workspace"

---

## 11. Phase 7: Renderer -- Upload Detail / Content Inspection (FR-03) and File Download (FR-04)

### Objective

Implement the upload detail panel (slide-in or dialog) showing full metadata and fetched document content, plus the download button.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/renderer/src/components/UploadDetail.tsx` | Full metadata display + content viewer + download button |
| `electron-ui/src/renderer/src/components/ContentViewer.tsx` | Scrollable content display (monospace/markdown-rendered panel) |

### Metadata Display

- ID (full UUID, copyable)
- Title
- Source type (badge)
- Source URL (clickable link if present; opens in external browser via `shell.openExternal`)
- Upload timestamp (formatted)
- Expiration date (with color indicator)
- Flags (badge array)
- Gemini document name (monospace, for debugging)

### Content Loading

- On opening detail view, call `window.api.upload.getContent(workspace, uploadId)`
- Show Skeleton/loading state while fetching
- Display content in a scrollable, monospace panel
- If content was truncated, show a warning banner: "Note: This content may be truncated by the model's output limit."

### Download Button

- Click triggers `window.api.upload.download(workspace, uploadId)`
- Main process shows native Save dialog (`dialog.showSaveDialog`) with default filename `{title}.md`
- Success: show confirmation toast/message
- Failure: show error message

### Acceptance Criteria

- [ ] FR-03.1: Full metadata displayed for selected upload
- [ ] FR-03.2: Document content fetched and displayed
- [ ] FR-03.3: Loading state shown while content fetches
- [ ] FR-03.4: Truncation warning displayed when applicable
- [ ] FR-03.5: Content rendered in scrollable panel
- [ ] FR-04.1: Download button present in detail view
- [ ] FR-04.2: Native Save dialog opens on click
- [ ] FR-04.3: Content saved to selected path
- [ ] FR-04.4: Default filename is `{title}.md` (sanitized)

---

## 12. Phase 8: Renderer -- Workspace Query (FR-05) and Query Filter Panel (FR-06)

### Objective

Implement the "Ask" tab with query input, filter panel, answer display, and citations list.

### Files Created

| File | Purpose |
|------|---------|
| `electron-ui/src/renderer/src/components/QueryPanel.tsx` | Query input area + submit button + answer display |
| `electron-ui/src/renderer/src/components/QueryFilterPanel.tsx` | Gemini-side and client-side filter controls |
| `electron-ui/src/renderer/src/components/CitationList.tsx` | Citations display with clickable navigation to upload detail |
| `electron-ui/src/renderer/src/components/AskTab.tsx` | Orchestrates query panel + filter panel + citation list |

### Query Panel

- Text area for question input
- Submit button (disabled when empty or while querying)
- Loading spinner during query execution
- Answer display area (styled text block)
- Error display if query fails

### Filter Panel (Collapsible)

- **Gemini-side filters** (labeled "Search Filters -- applied during search"):
  - Source type: Select dropdown
  - Source URL: Text input
- **Client-side filters** (labeled "Citation Filters -- applied to results"):
  - Flags: Multi-select (completed / urgent / inactive)
  - Expiration status: Select dropdown (expired / expiring_soon / active)
- Clear/Reset button

### Citation List

- Each citation shows: citation number, document title, text excerpt
- Clickable: navigating to upload detail view (FR-03) if the citation matches a local registry entry
- Non-matching citations (no local entry) show title and excerpt without click navigation

### Acceptance Criteria

- [ ] FR-05.1: Query input with submit button
- [ ] FR-05.2: Query executes against selected workspace
- [ ] FR-05.3: Answer displayed in styled area
- [ ] FR-05.4: Citations listed with number, title, URI, excerpt
- [ ] FR-05.5: Clickable citations navigate to upload detail
- [ ] FR-05.6: Loading state during query execution
- [ ] FR-05.7: Multi-workspace query (stretch goal -- skip for v1, note in UI as "coming soon")
- [ ] FR-06.1: Filter panel accessible
- [ ] FR-06.2: Gemini-side filters (source_type, source_url) sent with query
- [ ] FR-06.3: Client-side filters (flags, expiration_status) applied to citations
- [ ] FR-06.4: Clear distinction between Gemini-side and client-side filters
- [ ] FR-06.5: Filters clearable/resettable

---

## 13. Phase 9: Integration, Polish, and Verification

### Objective

End-to-end testing, visual polish, error handling review, and final verification against all acceptance criteria.

### Tasks

1. **End-to-end flow testing**: Launch app, validate config, browse workspaces, browse uploads, inspect content, download, query, filter
2. **Error handling audit**: Test with missing config, empty registry, non-existent workspace, failed Gemini calls
3. **UI polish**: Consistent spacing, responsive layout at different window sizes, loading states everywhere, empty states
4. **CLI regression**: Verify all existing CLI commands still work: `npx tsx src/cli.ts list`, `npx tsx src/cli.ts uploads <ws>`, etc.
5. **Performance check**: Ensure workspace/upload listing is snappy (sync registry reads), only Gemini API calls show loading
6. **Source URL links**: Verify `shell.openExternal` opens source URLs in the default browser

### Files Modified

| File | Change |
|------|--------|
| Various renderer components | Visual polish, edge case handling |
| `electron-ui/src/main/main.ts` | Window title, minimum size enforcement, app icon (optional) |

### Acceptance Criteria (from refined request)

- [ ] AC-01: Launch app, see all workspaces from `~/.g-ragger/registry.json`, select one
- [ ] AC-02: View uploads, filter by source type/flags/expiration, sort by date
- [ ] AC-03: Click upload, see metadata + content from Gemini
- [ ] AC-04: Download content via native Save dialog
- [ ] AC-05: Type question, submit, see answer with clickable citations
- [ ] AC-06: Apply Gemini-side and client-side filters for query
- [ ] AC-07: Missing config shows error from `loadConfig()` and blocks API operations
- [ ] AC-08: CLI still works: `npx tsx src/cli.ts --help`
- [ ] AC-09: App builds and runs: `cd electron-ui && npm install && npm run dev`

### Verification Commands

```bash
# CLI regression
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/GeminiRAG
npx tsc --noEmit
npx tsx src/cli.ts --help

# Electron build
cd electron-ui
npm run build

# Electron dev (visual check)
npm run dev
```

---

## 14. Dependency Graph

```
Phase 0 (filter extraction)
    |
    v
Phase 1 (scaffolding) ----+
    |                      |
    v                      v
Phase 2 (IPC/bridge)   Phase 3 (preload)   Phase 4 (renderer foundation)
    |                      |                     |
    +----------+-----------+---------------------+
               |
    +----------+-----------+-----------+
    |          |           |           |
    v          v           v           v
 Phase 5   Phase 6     Phase 7     Phase 8
 (sidebar) (table)     (detail)    (query)
    |          |           |           |
    +----------+-----------+-----------+
               |
               v
          Phase 9 (integration)
```

Note: Phase 0 must complete before Phase 2 (IPC handlers need filter utils). Phase 1 can run in parallel with Phase 0 since scaffolding does not depend on filter extraction.

---

## 15. Parallelization Strategy

The following groups of work can be assigned to separate coding agents working simultaneously, with no file overlap.

### Batch 1 (can run in parallel)

| Agent | Phase | Files Touched |
|-------|-------|--------------|
| Agent A | Phase 0: Filter extraction | `src/utils/filters.ts` (new), `src/commands/uploads.ts`, `src/commands/query.ts`, `src/commands/get.ts` |
| Agent B | Phase 1: Scaffolding | All files under `electron-ui/` (new directory) |

**No overlap**: Agent A works in `src/`, Agent B works in `electron-ui/`.

### Batch 2 (after Batch 1, can run in parallel)

| Agent | Phase | Files Touched |
|-------|-------|--------------|
| Agent C | Phase 2: Service bridge + IPC | `electron-ui/src/main/service-bridge.ts`, `electron-ui/src/main/ipc-handlers.ts`, `electron-ui/src/shared/ipc-types.ts`, modifies `electron-ui/src/main/main.ts` |
| Agent D | Phase 3: Preload | `electron-ui/src/preload/api.ts`, `electron-ui/src/preload/preload.ts`, `electron-ui/src/preload/index.d.ts` |
| Agent E | Phase 4: Renderer foundation | `electron-ui/src/renderer/src/` (all renderer files: components/ui/*, store/*, layout/*, App.tsx, app.css) |

**Minimal overlap**: Agents C, D, and E work in different subdirectories (`main/`, `preload/`, `renderer/`). Agent D needs `shared/ipc-types.ts` from Agent C -- Agent D can use the type file as a contract established in advance or wait for Agent C to create it first.

**Recommended**: Agent C creates `shared/ipc-types.ts` first (15 min), then Agents C, D, E proceed in parallel.

### Batch 3 (after Batch 2, can run in parallel)

| Agent | Phase | Files Touched |
|-------|-------|--------------|
| Agent F | Phase 5: Workspace sidebar | `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx`, modifies `AppLayout.tsx` |
| Agent G | Phase 6: Upload browser | `electron-ui/src/renderer/src/components/uploads-table/*`, `UploadsFilterBar.tsx`, `UploadsTab.tsx` |
| Agent H | Phase 7: Detail + download | `electron-ui/src/renderer/src/components/UploadDetail.tsx`, `ContentViewer.tsx` |
| Agent I | Phase 8: Query + filters | `electron-ui/src/renderer/src/components/QueryPanel.tsx`, `QueryFilterPanel.tsx`, `CitationList.tsx`, `AskTab.tsx` |

**No overlap**: Each agent works on distinct component files. They all read from the shared Zustand store (defined in Phase 4) but do not modify it.

**Store modification risk**: If any component needs new store actions, the store file becomes a contention point. Mitigation: Phase 4 must define ALL store actions/slices in advance, so Batch 3 agents only consume the store, never modify it.

### Batch 4 (after Batch 3)

| Agent | Phase | Files Touched |
|-------|-------|--------------|
| Agent J | Phase 9: Integration | Cross-cutting: any file may be modified for polish |

**Sequential**: This phase is inherently serial and should be done by a single agent.

---

## 16. File Inventory

### New Files (created by this plan)

```
src/utils/filters.ts                                    [Phase 0]

electron-ui/
  package.json                                           [Phase 1]
  tsconfig.json                                          [Phase 1]
  tsconfig.node.json                                     [Phase 1]
  electron.vite.config.ts                                [Phase 1]
  components.json                                        [Phase 1]
  .gitignore                                             [Phase 1]
  src/
    shared/
      ipc-types.ts                                       [Phase 2]
    main/
      main.ts                                            [Phase 1, modified Phase 2]
      service-bridge.ts                                  [Phase 2]
      ipc-handlers.ts                                    [Phase 2]
    preload/
      preload.ts                                         [Phase 1, modified Phase 3]
      api.ts                                             [Phase 3]
      index.d.ts                                         [Phase 3]
    renderer/
      index.html                                         [Phase 1]
      tsconfig.json                                      [Phase 1, modified Phase 3]
      src/
        main.tsx                                         [Phase 1]
        App.tsx                                          [Phase 1, modified Phase 4]
        app.css                                          [Phase 1, modified Phase 4]
        lib/
          utils.ts                                       [Phase 4]
        store/
          index.ts                                       [Phase 4]
        layout/
          AppLayout.tsx                                  [Phase 4, modified Phase 5]
        components/
          ui/
            button.tsx                                   [Phase 4]
            badge.tsx                                    [Phase 4]
            input.tsx                                    [Phase 4]
            select.tsx                                   [Phase 4]
            table.tsx                                    [Phase 4]
            tabs.tsx                                     [Phase 4]
            dialog.tsx                                   [Phase 4]
            scroll-area.tsx                              [Phase 4]
            separator.tsx                                [Phase 4]
            textarea.tsx                                 [Phase 4]
            skeleton.tsx                                 [Phase 4]
          ErrorBanner.tsx                                [Phase 4]
          LoadingSpinner.tsx                             [Phase 4]
          WorkspaceSidebar.tsx                           [Phase 5]
          uploads-table/
            columns.tsx                                  [Phase 6]
            data-table.tsx                               [Phase 6]
          UploadsFilterBar.tsx                           [Phase 6]
          UploadsTab.tsx                                 [Phase 6]
          UploadDetail.tsx                               [Phase 7]
          ContentViewer.tsx                              [Phase 7]
          QueryPanel.tsx                                 [Phase 8]
          QueryFilterPanel.tsx                           [Phase 8]
          CitationList.tsx                               [Phase 8]
          AskTab.tsx                                     [Phase 8]
```

### Modified Files (existing)

```
src/commands/uploads.ts                                  [Phase 0]
src/commands/query.ts                                    [Phase 0]
src/commands/get.ts                                      [Phase 0]
```

### Unchanged Files

All other files under `src/`, including `src/cli.ts`, `src/services/*`, `src/config/*`, `src/types/*`, `src/utils/format.ts`, `src/utils/validation.ts`.

---

## 17. Risks and Mitigations

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| R1 | ESM imports from `../src/` fail during Rollup bundle | High | Low | electron-vite's Rollup handles `.js`-to-`.ts` resolution automatically. If issues arise, add explicit alias. Verified in research doc. |
| R2 | `@google/genai` fails to bundle (native bindings or dynamic imports) | Medium | Low | Mark as external in `rollupOptions.external` and install in `electron-ui/package.json` dependencies. |
| R3 | Filter extraction (Phase 0) introduces regression in CLI | Low | Low | Pure refactor: functions moved without modification. Verify with existing tests. |
| R4 | `console.warn` from service layer not surfaced to UI | Low | High | Service bridge intercepts `console.warn` during `loadConfig()`. Return warnings in `config:validate` response. |
| R5 | Zustand store shape changes needed during Batch 3 | Medium | Medium | Phase 4 defines ALL store actions upfront based on the complete IPC contract. Batch 3 agents only consume. |
| R6 | TypeScript path resolution: `electron-ui/tsconfig.json` vs. root `tsconfig.json` conflict | Medium | Medium | `electron-ui/tsconfig.json` uses `CommonJS`/`Node` resolution (different from root's `NodeNext`). They are independent -- Rollup handles the root's ESM files at build time, not `tsc`. |
| R7 | Hot reload does not detect `../src/` changes | Medium | Medium | `build.watch.include: ['../src/**']` configured in `electron.vite.config.ts`. |
| R8 | Large workspace with many uploads causes slow rendering | Low | Low | @tanstack/react-table handles client-side rendering efficiently for < 1000 rows. Pagination can be added later if needed. |
| R9 | Electron Accessibility permissions needed (macOS) | Low | Low | Not applicable -- this app does not use Accessibility APIs (unlike Jumpee). Standard window rendering only. |

---

## Appendix A: shadcn/ui Components Required

Install via `npx shadcn@latest add <component>` from within `electron-ui/`:

```
button badge input select table tabs dialog scroll-area separator textarea skeleton
```

Plus `@tanstack/react-table` and `lucide-react` via npm.

## Appendix B: npm Dependencies

### devDependencies

```
electron
electron-vite
typescript
@types/node
react
react-dom
@types/react
@types/react-dom
tailwindcss
@tailwindcss/vite
autoprefixer
```

### dependencies

```
zustand
@tanstack/react-table
lucide-react
class-variance-authority
clsx
tailwind-merge
@radix-ui/react-dialog
@radix-ui/react-select
@radix-ui/react-tabs
@radix-ui/react-scroll-area
@radix-ui/react-separator
@radix-ui/react-slot
```

Note: `@radix-ui/*` packages are installed automatically when adding shadcn/ui components. The above list is indicative; the exact set depends on which shadcn/ui components are added.

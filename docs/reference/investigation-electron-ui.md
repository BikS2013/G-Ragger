# Investigation: GeminiRAG Electron UI - Technical Approach

## Executive Summary

**Recommended stack**: Electron (manual setup with electron-vite) + React + Tailwind CSS + shadcn/ui + Vite (renderer) + esbuild (main process) + Zustand (state) + typed IPC via contextBridge.

The critical risk area is ESM compatibility between the existing pure-ESM service layer and Electron's main process. The recommended mitigation is to **bundle the main process with esbuild**, which resolves ESM imports from `../src/` at build time and outputs a single CJS bundle that Electron can load without friction. This approach has been proven in the sibling Gitter project (which also uses ESM + Electron) and avoids runtime ESM headaches entirely.

A thin adapter/facade layer in `electron-ui/src/main/service-bridge.ts` should wrap service calls to handle error normalization, Gemini client lifecycle, and console.warn interception -- keeping the IPC handlers clean.

---

## 1. Electron Setup

### Option A: Electron Forge

| Aspect | Assessment |
|--------|-----------|
| What it is | Official Electron scaffolding + packaging toolkit from the Electron team |
| Pros | Well-maintained, opinionated project structure, built-in Vite/webpack templates, handles packaging and code signing |
| Cons | Heavy scaffolding with many generated files; the default templates assume a self-contained app structure; integrating an external `../src/` service layer requires custom configuration; packaging features (DMG/installer) are out of scope per OOS-05 |
| Fit for this project | Moderate. The scaffolding overhead is not justified since we do not need packaging/distribution. The Vite template is convenient but ties us to Forge's plugin system for build customization. |

### Option B: electron-builder

| Aspect | Assessment |
|--------|-----------|
| What it is | Community-driven packaging/distribution tool for Electron apps |
| Pros | Mature, wide adoption, cross-platform packaging, good docs |
| Cons | Primarily a packaging tool -- does not help with development workflow (no dev server integration, no HMR setup). Would still need a separate bundler setup for dev. Packaging is out of scope. |
| Fit for this project | Low. Its main value proposition (packaging) is explicitly out of scope. |

### Option C: electron-vite (manual setup)

| Aspect | Assessment |
|--------|-----------|
| What it is | A build tool specifically designed for Electron, providing unified Vite-based configuration for main process, preload scripts, and renderer |
| Pros | Single `electron.vite.config.ts` handles all three Electron entry points; built-in HMR for renderer; uses esbuild under the hood for main process; first-class TypeScript support; minimal boilerplate; can add electron-builder later for packaging |
| Cons | Smaller community than Forge; v5 is relatively recent; one more dependency |
| Fit for this project | **High**. Matches the project needs precisely: dev mode with HMR, TypeScript compilation for main/preload/renderer, esbuild for the main process (solving the ESM problem), and no packaging overhead. |

### Recommendation: **electron-vite (Option C)**

electron-vite provides the tightest integration between Vite (renderer) and esbuild (main process) with minimal configuration. It handles the three Electron entry points (main, preload, renderer) in a single config file. When packaging is needed later, electron-builder can be added incrementally.

**Alternative considered**: A fully manual setup (raw Vite for renderer + separate esbuild script for main process + npm scripts to orchestrate) would also work and has zero extra dependencies. However, electron-vite eliminates the orchestration boilerplate and provides a proven dev workflow with HMR. The marginal dependency cost is justified.

---

## 2. Renderer Framework / UI Library

### Option A: React + Tailwind CSS + shadcn/ui

| Aspect | Assessment |
|--------|-----------|
| What it is | Utility-first CSS framework + copy-paste component library built on Radix UI primitives |
| Pros | Full control over styling; components are copied into the project (no runtime dependency); excellent for tables, dialogs, dropdowns, tabs, badges -- all needed by this UI; tree-shakeable; modern aesthetic by default; TypeScript-first |
| Cons | Initial setup requires installing Tailwind + copying components; no built-in data table (but there is a DataTable recipe using @tanstack/react-table); requires more assembly than a batteries-included library |
| Bundle size | Minimal -- only used components are included since they are source code, not a library |
| Fit for data-management UI | **High**. The DataTable recipe with @tanstack/react-table provides sorting, filtering, and pagination. Tabs, badges, dialogs, and sidebar layout components map directly to the required UI. |

### Option B: Ant Design (antd)

| Aspect | Assessment |
|--------|-----------|
| What it is | Enterprise-grade React component library from Alibaba |
| Pros | Batteries-included: Table with built-in sorting/filtering/pagination, Tabs, Layout with Sider, Modal, Tag, Badge; minimal assembly required; strong TypeScript support |
| Cons | Large bundle size (~300-500KB gzipped depending on usage); opinionated visual style that is harder to customize; heavier runtime; the "enterprise" aesthetic may feel heavy for a personal desktop tool |
| Bundle size | Significant, though tree-shaking has improved in v5 |
| Fit for data-management UI | High functionality, but overweight for a personal-use local app with ~8 views. |

### Option C: Material UI (MUI)

| Aspect | Assessment |
|--------|-----------|
| What it is | Google's Material Design implementation for React |
| Pros | Comprehensive component library; DataGrid component is powerful; well-known; good TypeScript support |
| Cons | Large bundle; Material Design aesthetic is very "Google" and may not suit a macOS desktop app; runtime CSS-in-JS (Emotion) adds overhead; MUI DataGrid (the advanced table) requires a separate premium license for some features |
| Bundle size | Large (~200-400KB) |
| Fit for data-management UI | Moderate. The aesthetic is web-oriented rather than desktop-native. |

### Recommendation: **React + Tailwind CSS + shadcn/ui (Option A)**

For a local desktop tool with a defined set of views, shadcn/ui provides the best balance of control, aesthetics, and bundle efficiency. The DataTable pattern with @tanstack/react-table covers the upload browser requirements (sorting, filtering, column customization). The component library directly provides: Tabs (uploads/ask), Table, Badge (flags), Dialog (upload detail), Sidebar (workspaces), Input/Button (query), Select/Dropdown (filters), and Spinner.

The trade-off of slightly more initial assembly work is acceptable because:
1. The UI has a fixed, well-defined set of views (not an evolving enterprise dashboard)
2. shadcn/ui components are TypeScript source code we fully control
3. Tailwind is an excellent fit for responsive desktop layouts with `min-w` and `flex`

---

## 3. Bundler Strategy

### Renderer Process

**Vite** is the clear choice. It provides:
- Near-instant HMR during development
- First-class React + TypeScript + Tailwind support
- Optimized production builds via Rollup
- The renderer is a standard web app; Vite handles this perfectly

No meaningful alternatives need evaluation for the renderer. webpack would work but is slower and more complex to configure. esbuild alone lacks HMR.

### Main Process + Preload

| Option | Assessment |
|--------|-----------|
| **esbuild** (via electron-vite) | Bundles the main process TypeScript into a single CJS file. Resolves all imports from `../src/` at build time. Handles the `.js` extension imports in the existing ESM codebase. Sub-second build times. |
| **tsc** (standalone compile) | Would require the main process to also be ESM, which creates Electron compatibility issues. Does not bundle -- leaves import resolution to runtime. |
| **webpack** | Overkill for the main process. Slower than esbuild. No advantage. |

**Recommendation**: **esbuild** (via electron-vite's built-in main process handling).

The key insight: esbuild resolves `import { loadConfig } from '../config/config.js'` at build time, following the TypeScript source, and bundles everything into a single output file. This completely eliminates runtime ESM resolution issues in Electron's main process.

---

## 4. IPC Pattern

### Architecture

The IPC pattern must satisfy AC-02 and AC-03: context isolation enabled, nodeIntegration disabled, all communication through `contextBridge.exposeInMainWorld`.

### Recommended Pattern: Typed invoke/handle with a channel map

```
Renderer (React)                    Preload                           Main (Node.js)
                                                                      
window.api.workspace.list()  --->   contextBridge                ---> ipcMain.handle('workspace:list')
  returns Promise<T>                  exposeInMainWorld('api',...)       calls service layer
                                      wraps ipcRenderer.invoke()        returns result or throws
```

**Three-layer design:**

1. **IPC type definitions** (`electron-ui/src/shared/ipc-types.ts`): A single file defining the channel names, input types, and output types as a TypeScript interface map. Shared by main and renderer (imported at build time by both).

2. **Preload script** (`electron-ui/src/preload/preload.ts`): Uses `contextBridge.exposeInMainWorld('api', { ... })` to expose typed async functions. Each function calls `ipcRenderer.invoke(channel, args)`. The preload script is minimal -- it is a pass-through.

3. **IPC handlers** (`electron-ui/src/main/ipc-handlers.ts`): Registers `ipcMain.handle(channel, handler)` for each channel. Handlers call the service bridge (see section 6) and catch/normalize errors.

### Type Safety Approach

Define a channel map type:

```typescript
interface IpcChannelMap {
  'workspace:list': { input: void; output: WorkspaceData[] };
  'workspace:get': { input: { name: string }; output: WorkspaceData };
  'upload:list': { input: { workspace: string; filters?: ...; sort?: string }; output: UploadEntry[] };
  // ... etc per the IPC contract in the refined request
}
```

Then create typed wrapper functions for both the preload (invoke side) and main (handle side) that enforce these types at compile time. This ensures the renderer always sends the correct input and receives the correct output type for each channel.

### Error Handling Convention

All IPC handlers should catch errors from the service layer and return a structured result:

```typescript
type IpcResult<T> = { success: true; data: T } | { success: false; error: string };
```

This prevents unhandled promise rejections in the renderer and allows the React layer to display user-friendly error messages (per NFR-07).

### Alternative Considered: trpc-electron

trpc-electron wraps tRPC over Electron IPC, providing automatic type inference. While elegant, it adds a dependency (tRPC + adapter) and abstracts away the IPC layer. For a project with ~6 IPC channels, the overhead is not justified. The manual typed invoke/handle pattern is straightforward and keeps Electron's IPC model explicit.

---

## 5. ESM Compatibility

### The Problem

GeminiRAG is a pure ESM project (`"type": "module"` in package.json, `NodeNext` module resolution, `.js` extensions in imports). Electron's main process has historically expected CommonJS. While Electron 28+ supports ESM in the main process, this support has caveats:
- The main process entry file must use `.mjs` extension or the package.json must have `"type": "module"`
- Dynamic imports may behave differently
- Some Electron internals and native modules may not work correctly with ESM
- The `electron-ui/` has its own `package.json`, so it controls its own module type independently

### Option A: Native ESM in Electron's Main Process

| Aspect | Assessment |
|--------|-----------|
| Approach | Set `"type": "module"` in `electron-ui/package.json`, use ESM imports directly |
| Pros | No build step for main process during development; aligns with existing codebase style |
| Cons | Electron's ESM support, while functional, is less battle-tested than CJS; requires careful handling of `__dirname`/`__filename` (not available in ESM -- must use `import.meta.url`); preload scripts have additional ESM restrictions; some Electron ecosystem tools expect CJS |
| Risk | **Medium-High**. Edge cases with ESM in preload scripts and native module loading could cause hard-to-debug issues. |

### Option B: Bundle Main Process to CJS with esbuild (Recommended)

| Aspect | Assessment |
|--------|-----------|
| Approach | Use esbuild to bundle the main process TypeScript (which imports ESM modules from `../src/`) into a single CJS output file |
| Pros | Completely sidesteps ESM runtime issues; the bundled CJS file works reliably in all Electron versions; resolves `.js` extension imports at build time; sub-second builds; the sibling Gitter project already uses CJS for its Electron main process |
| Cons | Adds a build step for development (but electron-vite automates this with watch mode); debugging requires source maps (which esbuild generates) |
| Risk | **Low**. This is a well-established pattern. esbuild handles the ESM-to-CJS conversion transparently. |

### Option C: Compile `../src/` to CJS Separately

| Aspect | Assessment |
|--------|-----------|
| Approach | Add a parallel `tsc` compilation with CJS output targeting the existing `src/` files |
| Pros | No bundling needed |
| Cons | Requires maintaining a separate `tsconfig.cjs.json`; pollutes the existing project with CJS artifacts; may conflict with the existing ESM build; does not solve the `.js` extension import issue (CJS does not use `.js` extensions the same way) |
| Risk | **High**. Invasive to the existing project structure. Fragile. |

### Recommendation: **Option B -- Bundle to CJS with esbuild**

This is the proven, lowest-risk approach. electron-vite does this automatically when configured with `format: 'cjs'` for the main process build. The esbuild step:
1. Reads the TypeScript entry point (`electron-ui/src/main/main.ts`)
2. Follows all imports, including into `../src/services/`, `../src/config/`, `../src/types/`
3. Resolves `.js` extension imports by finding the corresponding `.ts` source files
4. Bundles everything into a single `main.js` (CJS format)
5. Generates a source map for debugging

The `electron-ui/package.json` should **not** set `"type": "module"`. It should either omit the field (defaulting to CJS) or explicitly set `"type": "commonjs"`.

### Important Detail: External Modules

When bundling the main process, `electron` itself and Node.js built-in modules (`node:fs`, `node:path`, etc.) must be marked as externals in the esbuild configuration. electron-vite handles this automatically. Third-party dependencies used by the service layer (e.g., `@google/genai`, `dotenv`) will be bundled into the output, which is fine for a local-only app.

---

## 6. Service Reuse Strategy

### Option A: Direct Import (No Adapter)

| Aspect | Assessment |
|--------|-----------|
| Approach | IPC handlers import and call service functions directly |
| Pros | Simplest; no extra layer |
| Cons | IPC handlers become cluttered with Gemini client lifecycle management, error normalization, console.warn interception, and filter logic; harder to test; mixes IPC concerns with service orchestration |

### Option B: Thin Service Bridge/Facade (Recommended)

| Aspect | Assessment |
|--------|-----------|
| Approach | Create `electron-ui/src/main/service-bridge.ts` that wraps service calls with app-level concerns |
| Pros | Clean separation: IPC handlers are thin dispatchers, the bridge handles client lifecycle and error formatting; single place to manage the GoogleGenAI instance; can intercept `console.warn` for expiration warnings and surface them to the renderer |
| Cons | One additional file (~100-150 lines) |

### Option C: Full Abstraction Layer

| Aspect | Assessment |
|--------|-----------|
| Approach | Create a complete service abstraction that re-exports all service functions with modified signatures |
| Pros | Maximum decoupling |
| Cons | Overkill; duplicates function signatures unnecessarily; the existing service layer is already well-factored with clean function signatures |

### Recommendation: **Option B -- Thin Service Bridge**

The service bridge handles exactly three cross-cutting concerns:

1. **Gemini client lifecycle**: Creates and caches a single `GoogleGenAI` instance at startup (rather than per-call as the CLI does). Exposes it to IPC handlers.

2. **Error normalization**: Catches service-layer errors and converts them to structured `{ success, data/error }` responses for the IPC layer.

3. **Console.warn interception**: Temporarily intercepts `console.warn` during `loadConfig()` to capture expiration warnings and return them alongside the config validation result.

The bridge does NOT re-implement or wrap individual service functions. It provides:
- `initialize()` -- calls `loadConfig()`, creates Gemini client, returns config status
- `getClient()` -- returns the cached GoogleGenAI instance
- `getConfig()` -- returns the cached AppConfig

Individual IPC handlers still call service functions directly (e.g., `listWorkspaces()`, `getWorkspace(name)`) -- the bridge just provides the shared resources they need.

### Filter Logic Extraction

The codebase scan identifies private filter/sort functions in `commands/uploads.ts` and `commands/query.ts` that need to be shared. The recommended approach:

**Extract to `src/utils/filters.ts`** (new file in the existing `src/` tree):
- `parseListingFilter()`, `applyFilters()`, `sortUploads()` from `commands/uploads.ts`
- `parseFilter()`, `buildMetadataFilter()`, `findUploadByDocumentUri()`, `passesClientFilters()` from `commands/query.ts`
- `findUploadById()` from `commands/get.ts`

The command modules would then import from `../utils/filters.js` instead of having private copies. This is a pure refactor -- the CLI behavior is unchanged (satisfying AC-05). The Electron main process can then import from `../../src/utils/filters.js`.

**Note**: This is the one change required to files under `src/`. The refined request acknowledges this need ("Some filter/sort utility functions need to be extracted from command modules to be shared"). The refactor is safe: functions are moved from private scope to exported module scope with zero behavioral changes.

---

## 7. State Management

### Option A: React Context + useReducer

| Aspect | Assessment |
|--------|-----------|
| Approach | Built-in React state management with context providers |
| Pros | Zero dependencies; familiar to all React developers; sufficient for small apps |
| Cons | Can cause unnecessary re-renders if not carefully structured with multiple contexts; boilerplate for complex state; no built-in devtools; context nesting gets messy with 4+ providers |
| Fit | The app has ~4 state domains (workspaces, uploads, query, config). Context would require 3-4 nested providers. Workable but slightly clumsy. |

### Option B: Zustand

| Aspect | Assessment |
|--------|-----------|
| Approach | Lightweight state management library (~1KB) with hooks-based API |
| Pros | Minimal boilerplate; no providers/wrappers; selector-based subscriptions prevent unnecessary re-renders; built-in devtools middleware; TypeScript-first; can easily split into slices; `create()` stores are just plain objects with functions |
| Cons | External dependency (tiny); less familiar to developers who only know Redux |
| Fit | **Excellent** for this scale. A single store with slices (workspace, uploads, query, ui) covers all state needs. The functional style aligns with the project's coding conventions (no classes). |

### Option C: Redux Toolkit (RTK)

| Aspect | Assessment |
|--------|-----------|
| Approach | Official Redux with simplified API and built-in async handling (createAsyncThunk) |
| Pros | Very mature; excellent devtools; RTK Query could handle the async Gemini API calls; well-documented patterns |
| Cons | Heavyweight for an app with ~6 async operations and ~4 state domains; significant boilerplate even with RTK; the slice/reducer pattern is more ceremony than needed here; adds ~30KB to the bundle |
| Fit | Overkill. RTK shines in large apps with complex state interactions, caching needs, and many developers. This is a single-user desktop tool with straightforward state flows. |

### Recommendation: **Zustand (Option B)**

Zustand is the ideal fit for this project's scale and conventions:

1. **Minimal boilerplate**: A store is a plain function that returns an object -- aligns with the project's functional style.
2. **No providers**: Components subscribe to state slices directly via hooks. No context wrapper nesting.
3. **Selective re-rendering**: `useStore(state => state.selectedWorkspace)` only re-renders when that specific value changes.
4. **Async actions**: Store actions can be async and call `window.api.*` (the IPC bridge) directly.

Example store shape:
```typescript
interface AppStore {
  // Workspace state
  workspaces: WorkspaceData[];
  selectedWorkspace: string | null;
  loadWorkspaces: () => Promise<void>;
  selectWorkspace: (name: string) => void;

  // Upload state
  uploads: UploadEntry[];
  filters: { key: string; value: string }[];
  loadUploads: () => Promise<void>;
  setFilters: (filters: ...) => void;

  // Query state
  queryResult: QueryResult | null;
  isQuerying: boolean;
  executeQuery: (question: string, filters: ...) => Promise<void>;

  // Config state
  configValid: boolean;
  configError: string | null;
  validateConfig: () => Promise<void>;
}
```

---

## 8. Risk Assessment

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| R1 | ESM imports from `../src/` fail at runtime in Electron | High | Low (mitigated by esbuild bundling) | Bundle main process to CJS with esbuild. If any import fails, esbuild reports it at build time, not runtime. |
| R2 | `@google/genai` SDK has issues when bundled by esbuild | Medium | Low | Mark as external if problems arise; install it as a direct dependency in `electron-ui/package.json` and let Node.js resolve it at runtime. |
| R3 | Preload script TypeScript compilation issues | Medium | Low | electron-vite handles preload compilation with its own esbuild pass. Preload scripts are simple and have minimal imports. |
| R4 | `console.warn` from service layer not surfaced to UI | Low | High (will happen) | Service bridge intercepts console.warn during config loading and expiration checks. Return warnings alongside data in IPC responses. |
| R5 | Filter logic extraction modifies existing `src/` files | Low | Certain (required) | Pure refactor: move private functions to exports. Run existing CLI tests (`npm test`) to verify no behavioral changes. |
| R6 | TypeScript path resolution between `electron-ui/` and `../src/` | Medium | Medium | esbuild resolves paths at build time. The `electron-ui/tsconfig.json` needs `paths` or `references` only for editor IntelliSense, not for runtime. |
| R7 | Electron version compatibility with Node.js APIs used by services | Low | Low | Electron 41.x ships with Node.js 22.x, which is compatible with the project's ES2022 target. |
| R8 | Hot reload does not detect changes in `../src/` during development | Medium | Medium | Configure electron-vite's watch to include `../src/` in addition to `electron-ui/src/`. |

---

## 9. Dependency Summary

### electron-ui/package.json dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `electron` | Runtime | Dev only (binary) |
| `electron-vite` | Build orchestration (main + preload + renderer) | Dev only |
| `react` + `react-dom` | UI framework | ~45KB gzipped |
| `tailwindcss` + `@tailwindcss/vite` | Utility CSS | Dev only (purged in production) |
| `@radix-ui/*` (via shadcn/ui) | Accessible UI primitives | ~5-15KB per component |
| `@tanstack/react-table` | Headless table for upload browser | ~15KB |
| `zustand` | State management | ~1KB |
| `lucide-react` | Icons (used by shadcn/ui) | Tree-shakeable |

**Total renderer bundle estimate**: ~150-200KB gzipped (well within acceptable limits for a desktop app).

---

## 10. Technical Research Guidance

Research needed: Yes

### Topic 1: electron-vite Configuration for External Source Directory

- Why: The project has a unique setup where the Electron app's main process imports from a sibling directory (`../src/`) rather than from its own source tree or installed npm packages. While esbuild can handle this, the specific electron-vite configuration needed (custom `resolve.alias`, `build.rollupOptions.external`, watch paths for `../src/`) needs to be validated against electron-vite v5's actual config schema.
- Focus: electron-vite `electron.vite.config.ts` -- how to configure the `main` build to include `../src/` as resolvable source, how to configure the watch mode to detect changes in `../src/`, and how to handle the `.js` extension imports that TypeScript's NodeNext resolution produces.
- Depth: moderate

### Topic 2: shadcn/ui DataTable Pattern with @tanstack/react-table

- Why: The upload browser (FR-02) requires a table with client-side filtering, sorting, and visual indicators (badges, color-coded expiration). The shadcn/ui DataTable recipe provides a starting point, but the specific column definitions, filter integration, and row click behavior need to be planned.
- Focus: The shadcn/ui DataTable recipe's current API, how to integrate external filter controls (the FilterBar component) with @tanstack/react-table's column filtering, and how to handle row click for navigation to detail view.
- Depth: brief

### Topic 3: Preload Script Type Declaration for Renderer

- Why: The renderer needs TypeScript type definitions for `window.api` (exposed via `contextBridge.exposeInMainWorld`). The standard approach is to create a `.d.ts` file that declares the global `window.api` type. The exact pattern that works cleanly with Vite's type resolution in the renderer needs verification.
- Focus: How to declare `window.api` types so that React components get full IntelliSense, and whether electron-vite provides any built-in support for this.
- Depth: brief

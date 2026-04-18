# Codebase Scan: GeminiRAG (for Electron UI Integration)

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| Language | TypeScript (strict mode) |
| Module system | ESM (`"type": "module"`, `NodeNext` resolution) |
| Target | ES2022 |
| Build | `tsc` (vanilla TypeScript compiler, no bundler) |
| Output | `dist/` with declarations + source maps |
| Runtime | Node.js 18+ |
| CLI framework | Commander.js 12.x |
| Gemini SDK | `@google/genai` ^1.49.0 |
| Test framework | Custom (no Jest/Vitest -- hand-rolled assert/test helpers run with `npx tsx`) |
| Package manager | npm (lockfile v3) |

### Directory Layout

```
GeminiRAG/
  src/
    cli.ts                          # CLI entry point (Commander program)
    types/index.ts                  # All shared interfaces and types
    config/config.ts                # loadConfig() -- env > .env > ~/.g-ragger/config.json
    services/
      gemini-client.ts              # createGeminiClient(config) -> GoogleGenAI
      file-search.ts                # Gemini File Search operations (CRUD, query, getDocumentContent)
      registry.ts                   # Local JSON registry CRUD (~/.g-ragger/registry.json)
      content-extractor.ts          # Extract content from files, URLs, YouTube, notes
      notes-generator.ts            # AI-powered note generation
      youtube-data-api.ts           # YouTube Data API integration
    commands/
      workspace.ts                  # create, list, delete, info commands
      upload.ts                     # upload command (file, url, youtube, note)
      uploads.ts                    # uploads listing with filters and sorting
      query.ts                      # ask command with Gemini-side and client-side filters
      get.ts                        # get command (retrieve document content)
      metadata.ts                   # update-title, flag, set-expiration, clear-expiration, labels
      channel-scan.ts               # YouTube channel scan command
    utils/
      validation.ts                 # Input validation helpers
      format.ts                     # Terminal formatting (tables, metadata headers, expiration indicators)
  test_scripts/                     # Hand-rolled tests (npx tsx test_scripts/test-*.ts)
  docs/
  dist/                             # Compiled output
```

---

## 2. Module Map

### Entry Point
- **`src/cli.ts`** -- Creates a Commander `program`, registers all command modules, calls `program.parse()`. This file must remain unchanged per AC-05.

### Types (`src/types/index.ts`)
All types are centralized in a single file. Key types for the Electron UI:

| Type | Purpose |
|------|---------|
| `SourceType` | `'file' \| 'web' \| 'youtube' \| 'note'` |
| `Flag` | `'completed' \| 'urgent' \| 'inactive'` |
| `UploadEntry` | Upload metadata (id, documentName, title, timestamp, sourceType, sourceUrl, expirationDate, flags) |
| `WorkspaceData` | Workspace (name, storeName, createdAt, uploads: Record<string, UploadEntry>) |
| `Registry` | Root object (workspaces: Record<string, WorkspaceData>) |
| `AppConfig` | Config (geminiApiKey, geminiModel, optional expiration dates, optional youtubeDataApiKey) |
| `QueryResult` | Query answer + citations array |
| `Citation` | text, documentTitle, documentUri, optional customMetadata |
| `ParsedFilter` | key, value, layer ('gemini' \| 'client') |

### Services (the reusable layer)

| Module | Key Exports | Notes |
|--------|------------|-------|
| `services/registry.ts` | `loadRegistry()`, `saveRegistry()`, `addWorkspace()`, `removeWorkspace()`, `getWorkspace()`, `listWorkspaces()`, `addUpload()`, `removeUpload()`, `updateUpload()` | Synchronous. Reads/writes `~/.g-ragger/registry.json`. Atomic writes via tmp+rename. |
| `services/file-search.ts` | `createStore()`, `deleteStore()`, `listStores()`, `uploadContent()`, `deleteDocument()`, `getDocumentContent()`, `query()` | Async. Requires `GoogleGenAI` instance + model name. Handles 503 fallback, polling bugs. |
| `services/gemini-client.ts` | `createGeminiClient(config)` | Returns `new GoogleGenAI({ apiKey })`. Stateless factory, no caching. |
| `config/config.ts` | `loadConfig()` | Synchronous. Priority: env vars > .env > `~/.g-ragger/config.json`. Throws on missing `GEMINI_API_KEY` or `GEMINI_MODEL`. Warns to stderr on expiring keys. |

### Commands (CLI-specific, not reusable as-is)

| Module | Registration Function | Reusable Logic |
|--------|----------------------|----------------|
| `commands/query.ts` | `registerQueryCommand()` | `parseFilter()`, `buildMetadataFilter()`, `findUploadByDocumentUri()`, `passesClientFilters()` -- all private functions. These need to be extracted or reimplemented for the Electron IPC layer. |
| `commands/uploads.ts` | `registerUploadsCommand()` | `parseListingFilter()`, `applyFilters()`, `sortUploads()` -- all private functions. Same extraction need. |
| `commands/get.ts` | `registerGetCommand()` | `findUploadById()` -- private. Partial-ID matching logic. |

### Utils

| Module | Key Exports | Notes |
|--------|------------|-------|
| `utils/format.ts` | `getExpirationIndicator()`, `formatWorkspaceTable()`, `formatUploadTable()`, `formatQueryResult()`, `formatUploadMetadataHeader()`, `formatWorkspaceInfo()`, `formatChannelScanSummary()` | Terminal-oriented formatting. The Electron UI will use `getExpirationIndicator()` and `formatWorkspaceInfo()` logic but not the table formatters. |
| `utils/validation.ts` | Input validators | Used by commands for CLI input validation. |

---

## 3. Conventions

### Coding Style
- **Imports**: ESM with `.js` extensions (required by NodeNext resolution), e.g. `import { loadConfig } from '../config/config.js'`
- **Error handling**: Try/catch in command actions; errors formatted as `Error: <message>` to stderr with `process.exit(1)`. Service layer throws plain `Error` objects with descriptive messages.
- **Naming**: camelCase for functions and variables, PascalCase for types/interfaces, SCREAMING_SNAKE for constants.
- **No classes**: Entire codebase uses plain functions and interfaces (functional style).
- **JSDoc**: All exported functions have JSDoc with `@param` and `@returns`/`@throws`.

### Configuration Pattern
- `loadConfig()` is called at the start of each command action that needs API access.
- Returns `AppConfig` or throws with a detailed help message.
- No singleton/caching -- called fresh each time.
- The Electron app should call it once on startup and pass the config around.

### Testing Pattern
- No test framework -- custom `assert()`, `expectThrow()`, and `test()` helpers.
- Tests run via `npx tsx test_scripts/test-*.ts`.
- Tests import directly from `../src/...` (relative paths).
- Pattern: setup, run, assert, teardown. Each test file self-contained.

### Import/Export Pattern
- All types exported from `types/index.ts` (single barrel).
- Services export individual functions (no default exports, no classes).
- Commands export a single `register*Command()` function that takes a Commander `program`.

---

## 4. Integration Points for Electron UI

### Direct Imports (ready to use from `electron-ui/src/main/`)

| Electron Need | Import From | Function(s) |
|--------------|-------------|-------------|
| List workspaces | `../src/services/registry.js` | `listWorkspaces()` |
| Get workspace details | `../src/services/registry.js` | `getWorkspace(name)` |
| Load config | `../src/config/config.js` | `loadConfig()` |
| Create Gemini client | `../src/services/gemini-client.js` | `createGeminiClient(config)` |
| Retrieve doc content | `../src/services/file-search.js` | `getDocumentContent(ai, model, storeName, docName, title)` |
| Execute query | `../src/services/file-search.js` | `query(ai, model, storeNames, question, metadataFilter?)` |
| Expiration indicator | `../src/utils/format.js` | `getExpirationIndicator(expirationDate)` |
| Workspace statistics | `../src/utils/format.js` | `formatWorkspaceInfo(workspace)` (or reimplement the counting logic in the renderer) |
| All types | `../src/types/index.js` | `UploadEntry`, `WorkspaceData`, `AppConfig`, `QueryResult`, `Citation`, `ParsedFilter`, etc. |

### Logic That Needs Extraction or Reimplementation

The following logic is currently trapped inside `commands/` as private functions. The Electron IPC handler layer will need to either:
1. **Extract** these to a shared utility module (e.g., `src/utils/filters.ts`), or
2. **Reimplement** the logic in `electron-ui/src/main/ipc-handlers.ts`.

Option 1 (extraction) is preferred for DRY compliance.

| Logic | Current Location | Functions |
|-------|-----------------|-----------|
| Upload filtering | `commands/uploads.ts` (lines 9-66) | `parseListingFilter()`, `applyFilters()` |
| Upload sorting | `commands/uploads.ts` (lines 74-85) | `sortUploads()` |
| Query filter parsing | `commands/query.ts` (lines 10-50) | `parseFilter()`, `buildMetadataFilter()` |
| Client-side citation filtering | `commands/query.ts` (lines 54-111) | `findUploadByDocumentUri()`, `passesClientFilters()` |
| Upload ID lookup (partial match) | `commands/get.ts` (lines 13-37) | `findUploadById()` |

### TypeScript Configuration Considerations

The existing `tsconfig.json` uses:
- `"module": "NodeNext"` with `"moduleResolution": "NodeNext"`
- `"rootDir": "src"`, `"outDir": "dist"`
- Strict mode enabled

The Electron UI's `tsconfig.json` will need to reference `../src` via TypeScript project references or path mappings. Key constraint: the existing project uses `.js` extensions in imports, which is required by NodeNext resolution. The Electron build chain (likely Vite or esbuild for the renderer) must handle this correctly.

### Files That Must NOT Be Modified

Per AC-05 of the refined request:
- `src/cli.ts` and all files under `src/` must remain unchanged.
- The Electron UI is an additive, parallel entry point.

If filter/sort logic is extracted from `commands/` to shared utils, this would technically modify existing files. However, if done as a pure refactor (moving private functions to exports without changing behavior), it preserves CLI functionality while enabling reuse.

### Key API Signatures for IPC Handler Implementation

```typescript
// Synchronous (registry is a JSON file)
listWorkspaces(): WorkspaceData[]
getWorkspace(name: string): WorkspaceData  // throws if not found
loadConfig(): AppConfig                     // throws if missing required keys

// Async (Gemini API calls)
getDocumentContent(ai, model, storeName, documentName, displayName?): Promise<string>
query(ai, model, storeNames[], question, metadataFilter?): Promise<QueryResult>

// Utility
getExpirationIndicator(expirationDate: string | null): string  // returns "[EXPIRED]", "[EXPIRING SOON]", or ""
createGeminiClient(config: AppConfig): GoogleGenAI
```

---

## 5. Risks and Considerations

1. **ESM + Electron**: The project is pure ESM (`"type": "module"`). Electron's main process historically has had friction with ESM. The Electron main process must be configured to support ESM imports or use a bundler (e.g., esbuild) to transpile imports from `../src/`.

2. **Console warnings**: `loadConfig()` and `getExpirationIndicator()` use `console.warn()` for expiration warnings. In Electron, these will go to the main process console, not the UI. The IPC layer should capture config warnings and surface them to the renderer.

3. **process.exit()**: Command modules call `process.exit(1)` on errors. The Electron IPC handlers must NOT call the command-layer functions directly; they should call the service-layer functions and handle errors gracefully.

4. **No singleton client**: `createGeminiClient()` creates a new instance each time. The Electron main process should create one instance at startup and reuse it across IPC calls for efficiency.

5. **Private filter functions**: The most significant integration gap. Extracting `parseFilter`, `buildMetadataFilter`, `applyFilters`, `sortUploads`, `passesClientFilters`, and `findUploadById` to a shared module would be the cleanest approach.

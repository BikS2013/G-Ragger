# Plan 001: GeminiRAG Implementation

**Date**: 2026-04-10
**Status**: Draft
**Project**: GeminiRAG -- Workspace-based document management and semantic search CLI powered by Google Gemini File Search API

---

## 1. Overview

This plan breaks the GeminiRAG project into 7 implementation phases, ordered by dependency. Each phase produces a testable increment. The project is a greenfield TypeScript CLI with no existing codebase.

### Key Technical Constraints (from Research)

| Constraint | Source | Impact |
|-----------|--------|--------|
| Polling bug #1211: `operations.get()` returns incomplete object | research-operation-polling.md | Must use workaround: check `response.documentName` from initial `uploadToFileSearchStore` response; add hard timeout to all polling loops |
| 503 errors for files >~10KB via `uploadToFileSearchStore` | research-operation-polling.md | Must implement fallback: try direct upload first, catch 503, retry via `files.upload` + `importFile` pathway |
| `string_list_value` not filterable at query time | research-string-list-filters.md | Flags must remain local-only in registry; filtering by flags/expiration is client-side post-processing |
| 10 File Search Stores per project limit | investigation | Maximum 10 workspaces; must document clearly |
| Documents are immutable after upload | investigation | Mutable metadata (title, flags, expiration) stored in local registry only |
| `force: true` required for document deletion | research-sdk-document-api.md | Must pass `config: { force: true }` when deleting ACTIVE documents |
| Blob upload supported natively | research-blob-upload.md | In-memory content (web/youtube/note) uploaded as Blob directly, no temp files |

### Dependency Graph

```
Phase 1 (Project Setup)
    |
Phase 2 (Config & Registry)
    |
    +---> Phase 3 (Gemini Service Layer)
    |         |
    |         +---> Phase 4 (Content Extractors)
    |         |         |
    |         |         +---> Phase 5 (CLI Commands - Upload, Workspace, Metadata)
    |         |                   |
    |         +---> Phase 5       |
    |                             |
    +---> Phase 5                 |
                                  |
                            Phase 6 (Query & Listing Commands)
                                  |
                            Phase 7 (Polish, Edge Cases, Documentation)
```

---

## 2. Phase 1: Project Scaffolding

**Goal**: Set up the TypeScript project structure, package.json, tsconfig, and all dependencies so that subsequent phases can build immediately.

### Files to Create

| File | Purpose |
|------|---------|
| `package.json` | Project metadata, scripts, dependencies |
| `tsconfig.json` | TypeScript compiler configuration (target ES2022, module NodeNext) |
| `src/cli.ts` | Entry point -- Commander.js setup, command registration (skeleton) |
| `src/types/index.ts` | Shared TypeScript interfaces (Workspace, UploadEntry, Config, etc.) |
| `src/utils/format.ts` | CLI output formatting helpers (tables, colors, warnings) -- skeleton |
| `src/utils/validation.ts` | Input validation helpers -- skeleton |

### Dependencies to Install

**Runtime:**
- `@google/genai` (^1.49.0)
- `commander` (^12.x)
- `dotenv` (^16.x)
- `uuid` (^10.x)
- `jsdom` (^25.x)
- `@mozilla/readability` (^0.5.x)
- `turndown` (^7.x)
- `turndown-plugin-gfm` (^1.x)
- `youtube-transcript` (^1.3.x)
- `mime-types` (^2.x)

**Dev:**
- `typescript` (^5.x)
- `tsx` (^4.x)
- `@types/node` (^22.x)
- `@types/jsdom` (^21.x)
- `@types/turndown` (^5.x)
- `@types/mime-types` (^2.x)
- `@types/uuid` (^10.x)

### Type Definitions (src/types/index.ts)

```typescript
export type SourceType = 'file' | 'web' | 'youtube' | 'note';
export type Flag = 'completed' | 'urgent' | 'inactive';

export interface UploadEntry {
  id: string;
  documentName: string;
  title: string;
  timestamp: string;       // ISO 8601 UTC
  sourceType: SourceType;
  sourceUrl: string | null;
  expirationDate: string | null;  // ISO 8601 date
  flags: Flag[];
}

export interface WorkspaceData {
  name: string;
  storeName: string;       // Gemini File Search Store resource name
  createdAt: string;       // ISO 8601 UTC
  uploads: Record<string, UploadEntry>;  // keyed by upload ID
}

export interface Registry {
  workspaces: Record<string, WorkspaceData>;  // keyed by workspace name
}

export interface AppConfig {
  geminiApiKey: string;
  geminiModel: string;
  geminiApiKeyExpiration?: string;  // ISO 8601 date, optional
}
```

### Acceptance Criteria

- [ ] `npm install` completes without errors
- [ ] `npx tsx src/cli.ts --help` prints help text
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] All type definitions in `src/types/index.ts` compile

### Verification Commands

```bash
cd GeminiRAG && npm install
npx tsc --noEmit
npx tsx src/cli.ts --help
```

### Parallelization

- `package.json`, `tsconfig.json` can be created simultaneously
- `src/types/index.ts` depends on nothing and can be written in parallel with `src/cli.ts`

### Estimated Effort: Small

---

## 3. Phase 2: Configuration & Local Registry

**Goal**: Implement config loading (env > .env > config file, no fallbacks) and the local JSON registry with atomic writes.

### Files to Create

| File | Purpose |
|------|---------|
| `src/config/config.ts` | Config loading: env vars > `.env` > `~/.g-ragger/config.json`. Throws on missing required values. API key expiration warning. |
| `src/services/registry.ts` | Local registry CRUD at `~/.g-ragger/registry.json`. Atomic writes (write to temp, rename). |

### Config Loading Rules (from Refined Request)

1. Priority: environment variables > `.env` file > `~/.g-ragger/config.json`
2. `GEMINI_API_KEY` -- **required**; throw: "GEMINI_API_KEY is required. Obtain it from https://aistudio.google.com/apikey"
3. `GEMINI_MODEL` -- **required**; throw: "GEMINI_MODEL is required. Set it in config or environment."
4. `GEMINI_API_KEY_EXPIRATION` -- optional; if set and within 7 days, print warning at startup
5. **No fallback values** for any setting (per project conventions)

### Registry Operations

| Operation | Method | Notes |
|-----------|--------|-------|
| Load registry | `loadRegistry()` | Creates `~/.g-ragger/` dir and empty registry if not exists |
| Save registry | `saveRegistry(registry)` | Atomic write: write to `.tmp`, rename to `registry.json` |
| Add workspace | `addWorkspace(name, storeName)` | Adds entry, saves |
| Remove workspace | `removeWorkspace(name)` | Removes entry + all uploads, saves |
| Get workspace | `getWorkspace(name)` | Returns workspace or throws |
| Add upload | `addUpload(workspace, entry)` | Adds upload entry, saves |
| Remove upload | `removeUpload(workspace, uploadId)` | Removes entry, saves |
| Update upload | `updateUpload(workspace, uploadId, partial)` | Partial update (title, flags, expiration), saves |
| List workspaces | `listWorkspaces()` | Returns all workspace names and metadata |

### Acceptance Criteria

- [ ] Missing `GEMINI_API_KEY` throws descriptive error with instructions
- [ ] Missing `GEMINI_MODEL` throws descriptive error
- [ ] API key expiration warning appears when date is within 7 days
- [ ] Registry is created at `~/.g-ragger/registry.json` on first use
- [ ] Registry writes are atomic (temp file + rename)
- [ ] All CRUD operations work correctly

### Verification Commands

```bash
# Test missing config
unset GEMINI_API_KEY && npx tsx test_scripts/test-config.ts 2>&1 | grep "GEMINI_API_KEY is required"

# Test registry operations
npx tsx test_scripts/test-registry.ts
```

### Test Scripts to Create

- `test_scripts/test-config.ts` -- Validates config loading, missing key errors, expiration warning
- `test_scripts/test-registry.ts` -- Validates all registry CRUD operations

### Parallelization

- `config.ts` and `registry.ts` are independent and can be developed in parallel

### Estimated Effort: Small

---

## 4. Phase 3: Gemini Service Layer

**Goal**: Build the wrapper around the `@google/genai` SDK that handles store management, document upload (with polling bug workaround and 503 fallback), and document operations.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/gemini-client.ts` | SDK initialization, singleton client |
| `src/services/file-search.ts` | Store CRUD, document upload (with workarounds), document delete, query execution |

### gemini-client.ts

- Initialize `GoogleGenAI` with API key from config
- Export singleton `ai` instance
- No fallback for API key (uses config module)

### file-search.ts -- Core Operations

| Operation | Method Signature | Notes |
|-----------|-----------------|-------|
| Create store | `createStore(displayName: string): Promise<string>` | Returns store resource name |
| Delete store | `deleteStore(storeName: string): Promise<void>` | `force: true` to delete all documents |
| List stores | `listStores(): Promise<StoreInfo[]>` | For reconciliation/debugging |
| Upload file (disk) | `uploadFile(storeName, filePath, displayName, metadata): Promise<string>` | Returns document name |
| Upload blob (in-memory) | `uploadBlob(storeName, content, mimeType, displayName, metadata): Promise<string>` | For web/youtube/note content |
| Delete document | `deleteDocument(documentName: string): Promise<void>` | `force: true` required |
| Query | `query(storeNames, question, metadataFilter?): Promise<QueryResult>` | Wraps `generateContent` with FileSearch tool |

### Upload Strategy (Critical -- Accounts for Known Bugs)

The upload flow must handle two known SDK issues:

**Bug 1: Polling bug #1211**
```
1. Call uploadToFileSearchStore()
2. Check initial response for response.documentName (workaround)
3. If documentName present -> upload complete, return it
4. If not -> enter polling loop with HARD TIMEOUT (120s)
5. If timeout reached -> throw error (do NOT loop indefinitely)
```

**Bug 2: 503 for large files (>~10KB)**
```
1. Try uploadToFileSearchStore() first
2. If HTTP 503 error:
   a. Fall back to files.upload() + fileSearchStores.importFile()
   b. importFile polling uses time-bounded loop (120s timeout)
   c. If polling times out, proceed optimistically and warn
3. Return document name
```

### Upload Implementation Skeleton

```typescript
async function uploadContent(
  storeName: string,
  file: string | Blob,
  displayName: string,
  customMetadata: CustomMetadata[],
  maxWaitMs = 120_000,
  pollIntervalMs = 3_000
): Promise<string> {
  try {
    // Primary path: direct upload
    return await directUpload(storeName, file, displayName, customMetadata, maxWaitMs, pollIntervalMs);
  } catch (error) {
    // Fallback for 503 errors on large content
    if (is503Error(error) && file instanceof Blob) {
      console.warn('Direct upload returned 503. Falling back to Files API + Import...');
      return await importPathUpload(storeName, file, displayName, customMetadata, maxWaitMs, pollIntervalMs);
    }
    throw error;
  }
}
```

### Query Result Type

```typescript
interface QueryResult {
  answer: string;
  citations: Array<{
    text: string;
    documentTitle: string;
    documentUri: string;
    customMetadata?: Record<string, string>;
  }>;
}
```

### Acceptance Criteria

- [ ] Store creation returns a valid resource name
- [ ] Store deletion succeeds (including with existing documents when force=true)
- [ ] File upload (disk file path) returns a document name
- [ ] Blob upload (in-memory content) returns a document name
- [ ] Upload does not loop indefinitely (timeout enforced)
- [ ] 503 error triggers fallback to import pathway
- [ ] Document deletion succeeds with `force: true`
- [ ] Query returns answer text and citation data
- [ ] Multi-store query works (multiple store names)

### Verification Commands

```bash
# Requires GEMINI_API_KEY and GEMINI_MODEL set
npx tsx test_scripts/test-gemini-service.ts
```

### Test Scripts to Create

- `test_scripts/test-gemini-service.ts` -- End-to-end: create store, upload file, upload blob, query, delete document, delete store. Validates polling workaround.

### Dependencies

- Phase 2 (config module for API key)

### Risks

- **SDK bug may be fixed in a newer version**: The workaround code is harmless if the bug is fixed (it just skips polling if documentName is already available). No need to remove it.
- **503 error may be intermittent**: The fallback path handles this gracefully.
- **importFile polling may also be affected by bug #1211**: Time-bounded polling with optimistic continuation mitigates this.

### Estimated Effort: Medium

---

## 5. Phase 4: Content Extractors

**Goal**: Build the content extraction services for each source type (disk file, web page, YouTube, personal note).

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/content-extractor.ts` | Unified content extraction dispatcher + individual extractors |

### Extractor Specifications

#### Disk File Extractor
- **Input**: File path
- **Validation**: File exists (`fs.access`), MIME type is in supported list (`mime-types` package)
- **Title**: `path.basename(filePath)`
- **Output**: File path string (uploaded directly via SDK)
- **Metadata**: `source_type: "file"`, `source_url: <absolute-file-path>`

#### Web Page Extractor
- **Input**: URL
- **Process**: Fetch HTML -> parse with JSDOM -> extract with Readability -> convert to Markdown with Turndown
- **Title**: HTML `<title>` tag; fallback: `hostname + pathname`
- **Output**: Markdown string (uploaded as Blob)
- **Metadata**: `source_type: "web"`, `source_url: <url>`
- **Error handling**: Network errors, Readability extraction failure, empty content

#### YouTube Transcript Extractor
- **Input**: YouTube URL
- **Process**: Extract video ID -> fetch title via oEmbed -> fetch transcript via `youtube-transcript` -> combine segments into plain text
- **Title**: Video title from oEmbed endpoint (`https://www.youtube.com/oembed?url=<url>&format=json`)
- **Output**: Plain text string (uploaded as Blob)
- **Metadata**: `source_type: "youtube"`, `source_url: <url>`
- **Error handling**: Invalid URL, no transcript available (FR-20: abort with clear error)

#### Personal Note Extractor
- **Input**: Text string (CLI argument)
- **Process**: Take text as-is
- **Title**: First 60 characters trimmed to word boundary + "..."
- **Output**: Plain text string (uploaded as Blob)
- **Metadata**: `source_type: "note"`

### Supported MIME Types List

Define in `src/utils/validation.ts`:
```
text/plain, text/markdown, text/html, text/csv,
application/pdf,
application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document,
application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
application/vnd.openxmlformats-officedocument.presentationml.presentation,
application/json, application/sql,
text/x-python, text/javascript, text/x-java-source, text/x-c,
application/zip
```

### Acceptance Criteria

- [ ] Disk file: validates file existence and MIME type; rejects unsupported types with clear error listing supported types (AC-08)
- [ ] Web page: fetches URL, extracts title from `<title>`, produces markdown content
- [ ] Web page: falls back to hostname+path for title when `<title>` is missing
- [ ] YouTube: extracts transcript, uses video title from oEmbed
- [ ] YouTube: produces clear error when transcript unavailable (AC-09)
- [ ] Note: generates title from first 60 chars trimmed to word boundary
- [ ] All extractors return content, title, source type, and source URL

### Verification Commands

```bash
npx tsx test_scripts/test-extractors.ts
```

### Test Scripts to Create

- `test_scripts/test-extractors.ts` -- Tests each extractor: disk file (valid + invalid MIME), web page (with title + without), YouTube (valid + no-transcript), note (short + long)

### Dependencies

- Phase 1 (types, utilities)
- No dependency on Phase 2 or 3 (extractors are pure data transformation)

### Parallelization

- **Can be developed in parallel with Phase 3** (Gemini Service Layer). The extractors produce content; the Gemini service consumes it. They meet at Phase 5 (CLI Commands).

### Estimated Effort: Medium

---

## 6. Phase 5: CLI Commands -- Workspace, Upload, Metadata

**Goal**: Wire up the Commander.js CLI with all workspace management, upload, and metadata commands.

### Files to Create / Modify

| File | Purpose |
|------|---------|
| `src/cli.ts` | Commander program setup, command registration |
| `src/commands/workspace.ts` | `create`, `list`, `delete`, `info` commands |
| `src/commands/upload.ts` | `upload` command with `--file`, `--url`, `--youtube`, `--note` options |
| `src/commands/metadata.ts` | `update-title`, `remove`, `set-expiration`, `clear-expiration`, `flag`, `labels` commands |

### Command Specifications

#### Workspace Commands

| Command | Arguments/Options | Behavior |
|---------|-------------------|----------|
| `geminirag create <name>` | name: string | Create Gemini store + registry entry |
| `geminirag list` | (none) | List all workspaces with summary |
| `geminirag delete <name>` | name: string | Delete Gemini store (force) + registry entry |
| `geminirag info <name>` | name: string | Show workspace details: name, created date, upload count, labels in use |

#### Upload Command

| Command | Options | Behavior |
|---------|---------|----------|
| `geminirag upload <workspace>` | `--file <path>` | Extract + upload disk file |
| | `--url <url>` | Extract + upload web page |
| | `--youtube <url>` | Extract + upload YouTube transcript |
| | `--note <text>` | Upload personal note |

Upload flow:
1. Load config (validates API key, model)
2. Load registry, get workspace
3. Call appropriate extractor
4. Call Gemini upload (file path or Blob)
5. Register upload in local registry with all metadata
6. Display success with upload ID and title

#### Metadata Commands

| Command | Arguments | Behavior |
|---------|-----------|----------|
| `geminirag update-title <workspace> <upload-id> <new-title>` | | Update title in local registry |
| `geminirag remove <workspace> <upload-id>` | | Delete Gemini document + remove from registry |
| `geminirag set-expiration <workspace> <upload-id> <date>` | date: ISO 8601 | Set expiration in registry |
| `geminirag clear-expiration <workspace> <upload-id>` | | Clear expiration in registry |
| `geminirag flag <workspace> <upload-id>` | `--add <flags...>`, `--remove <flags...>` | Add/remove flags in registry |
| `geminirag labels <workspace>` | | List all distinct metadata keys across uploads |

### Acceptance Criteria

- [ ] AC-01: `geminirag create my-research` creates workspace + store; `geminirag list` shows it
- [ ] AC-02: `geminirag delete my-research` removes workspace, store, and registry data
- [ ] AC-03: `geminirag info my-research` displays name, creation date, upload count, labels
- [ ] AC-04: `geminirag upload my-research --file ./report.pdf` uploads; listing shows "report.pdf" as title
- [ ] AC-05: `geminirag upload my-research --url <url>` fetches page, extracts title, uploads
- [ ] AC-06: `geminirag upload my-research --youtube <url>` extracts transcript, uses video title
- [ ] AC-07: `geminirag upload my-research --note "Meeting notes..."` creates upload with auto-title
- [ ] AC-08: Unsupported MIME type produces error listing supported types
- [ ] AC-09: YouTube without transcript produces clear error
- [ ] AC-10: `update-title` changes title in listing
- [ ] AC-11: `remove` deletes document and registry entry
- [ ] AC-12: `set-expiration` sets date visible in listing
- [ ] AC-13: `flag --add urgent` adds flag visible in listing
- [ ] AC-14: `labels` lists all metadata keys
- [ ] AC-19: Missing API key produces descriptive error
- [ ] AC-20: Missing model produces descriptive error

### Verification Commands

```bash
# Full CLI integration test
npx tsx test_scripts/test-cli-commands.ts
```

### Test Scripts to Create

- `test_scripts/test-cli-commands.ts` -- Integration test that exercises all commands end-to-end

### Dependencies

- Phase 2 (config, registry)
- Phase 3 (Gemini service)
- Phase 4 (content extractors)

### Estimated Effort: Medium-Large

---

## 7. Phase 6: Query & Listing Commands

**Goal**: Implement the `ask` (query) and `uploads` (listing) commands with filtering, sorting, and citation display.

### Files to Create / Modify

| File | Purpose |
|------|---------|
| `src/commands/query.ts` | `ask` command -- single and multi-workspace query |
| `src/commands/uploads.ts` | `uploads` listing command with filters and sorting |
| `src/utils/format.ts` | Finalize output formatting: tables, citations, expiration warnings |

### Query Command

| Command | Arguments/Options | Behavior |
|---------|-------------------|----------|
| `geminirag ask <workspaces...> <question>` | `--filter key=value` (repeatable) | Query with optional metadata filter |

**Filter handling (dual-layer)**:
1. Gemini-side filters: `source_type` and `source_url` -- translated to AIP-160 syntax and passed as `metadataFilter`
2. Local-only filters: `flags`, `expiration_date` -- applied client-side after Gemini returns results
3. Filter syntax: `--filter source_type=web` (Gemini-side), `--filter flags=urgent` (client-side)

**Citation display**:
- Extract `groundingChunks` from response
- Display document title, relevant text excerpt, and source metadata
- Cross-reference with local registry for mutable metadata (title overrides, flags)

**Multi-workspace query**:
- Pass multiple store names in `fileSearchStoreNames` array (supported natively per investigation)

### Uploads Listing Command

| Command | Options | Behavior |
|---------|---------|----------|
| `geminirag uploads <workspace>` | `--filter source_type=web` | Filter by metadata |
| | `--filter flags=urgent` | Filter by flag (local) |
| | `--sort timestamp` / `--sort -timestamp` | Sort ascending/descending |

**Expiration warnings** (FR-30, AC-15):
- Uploads with `expirationDate` in the past: show `[EXPIRED]` indicator
- Uploads with `expirationDate` within configurable window (default 7 days): show `[EXPIRING SOON]`

### Acceptance Criteria

- [ ] AC-16: `geminirag ask my-research "What are the main findings?"` returns answer with citations
- [ ] AC-17: `geminirag ask my-research "..." --filter source_type=web` filters to web uploads only
- [ ] AC-18: `geminirag ask ws1 ws2 "Compare findings"` queries across both workspaces
- [ ] AC-15: Expired uploads show `[EXPIRED]` marker in listings
- [ ] Listing supports `--sort timestamp` and `--sort -timestamp`
- [ ] Listing supports `--filter` for source_type, flags, expiration status

### Verification Commands

```bash
npx tsx test_scripts/test-query.ts
npx tsx test_scripts/test-uploads-listing.ts
```

### Test Scripts to Create

- `test_scripts/test-query.ts` -- Query integration test (requires API key and populated workspace)
- `test_scripts/test-uploads-listing.ts` -- Tests listing filters, sorting, expiration markers

### Dependencies

- Phase 5 (workspace and upload commands must exist to populate data)

### Estimated Effort: Medium

---

## 8. Phase 7: Polish, Edge Cases, Documentation

**Goal**: Handle edge cases, finalize error messages, create configuration guide, update CLAUDE.md, and write the project design document.

### Files to Create / Modify

| File | Purpose |
|------|---------|
| `docs/design/project-design.md` | Complete project design document |
| `docs/design/configuration-guide.md` | Configuration guide per conventions |
| `CLAUDE.md` | Update with tool documentation |
| `Issues - Pending Items.md` | Create at project root |

### Edge Cases to Handle

| Edge Case | Handling |
|-----------|---------|
| Workspace name already exists | Error: "Workspace '<name>' already exists" |
| Workspace not found | Error: "Workspace '<name>' not found" |
| Upload ID not found | Error: "Upload '<id>' not found in workspace '<name>'" |
| Invalid flag value | Error: "Invalid flag '<flag>'. Allowed: completed, urgent, inactive" |
| Invalid expiration date format | Error: "Invalid date format. Use ISO 8601 (YYYY-MM-DD)" |
| Network failure during upload | Error with details; no partial registry entry |
| Empty web page content | Error: "Failed to extract content from URL" |
| YouTube URL not a valid video | Error: "Invalid YouTube URL" |
| Note text is empty | Error: "Note text cannot be empty" |
| 10 workspace limit reached | Error: "Maximum 10 workspaces reached (Gemini API limit)" |

### CLAUDE.md Tool Documentation

Update with `<GeminiRAG>` tool block documenting all commands, parameters, and examples.

### Acceptance Criteria

- [ ] AC-21: API key expiration warning when within 7 days
- [ ] All error messages are clear and actionable
- [ ] `docs/design/project-design.md` is complete and accurate
- [ ] `docs/design/configuration-guide.md` covers all config variables per conventions
- [ ] `CLAUDE.md` has tool documentation in required XML format
- [ ] `Issues - Pending Items.md` exists at project root

### Estimated Effort: Small-Medium

---

## 9. Complete File Inventory

### Source Files (src/)

| File | Phase | Purpose |
|------|-------|---------|
| `src/cli.ts` | 1, 5 | Commander.js entry point |
| `src/types/index.ts` | 1 | Shared TypeScript interfaces |
| `src/config/config.ts` | 2 | Configuration loading |
| `src/services/registry.ts` | 2 | Local JSON registry |
| `src/services/gemini-client.ts` | 3 | SDK initialization |
| `src/services/file-search.ts` | 3 | Store/document operations, upload with workarounds |
| `src/services/content-extractor.ts` | 4 | Content extraction for all source types |
| `src/commands/workspace.ts` | 5 | Workspace management commands |
| `src/commands/upload.ts` | 5 | Upload command |
| `src/commands/metadata.ts` | 5 | Metadata management commands |
| `src/commands/query.ts` | 6 | Query command |
| `src/commands/uploads.ts` | 6 | Uploads listing command |
| `src/utils/format.ts` | 1, 6 | Output formatting |
| `src/utils/validation.ts` | 1, 4 | Input validation |

### Test Scripts (test_scripts/)

| File | Phase | Tests |
|------|-------|-------|
| `test_scripts/test-config.ts` | 2 | Config loading, missing values, expiration warning |
| `test_scripts/test-registry.ts` | 2 | Registry CRUD operations |
| `test_scripts/test-gemini-service.ts` | 3 | Store/document lifecycle, polling workaround |
| `test_scripts/test-extractors.ts` | 4 | All content extractors |
| `test_scripts/test-cli-commands.ts` | 5 | Full CLI command integration |
| `test_scripts/test-query.ts` | 6 | Query with filters and citations |
| `test_scripts/test-uploads-listing.ts` | 6 | Listing, filters, sorting, expiration markers |

### Documentation (docs/)

| File | Phase | Purpose |
|------|-------|---------|
| `docs/design/plan-001-geminirag-implementation.md` | Pre | This plan |
| `docs/design/project-design.md` | 7 | Complete project design |
| `docs/design/project-functions.md` | Pre | Functional requirements registry |
| `docs/design/configuration-guide.md` | 7 | Configuration guide |

### Root Files

| File | Phase | Purpose |
|------|-------|---------|
| `package.json` | 1 | Project dependencies and scripts |
| `tsconfig.json` | 1 | TypeScript configuration |
| `CLAUDE.md` | 7 | Updated tool documentation |
| `Issues - Pending Items.md` | 7 | Issues tracker |

---

## 10. Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|------|-----------|--------|------------|-------|
| R1 | Polling bug #1211 still present in SDK 1.49.0 | Medium | High (infinite loop) | Check `response.documentName` from initial response; hard 120s timeout on all polling loops | 3 |
| R2 | 503 error for files >10KB | Low-Medium | High (upload failure) | Fallback to `files.upload` + `importFile` pathway; catch 503 specifically | 3 |
| R3 | `string_list_value` not filterable | Confirmed | Low (design already accounts) | Flags stored local-only; client-side post-filtering | 2, 6 |
| R4 | 10 store limit per project | Confirmed | Medium (workspace limit) | Document clearly; suggest multiple Google Cloud projects for more | 5, 7 |
| R5 | `youtube-transcript` library breaks (YouTube page changes) | Medium | Medium (YouTube uploads fail) | Clear error handling; document limitation; library is actively maintained | 4 |
| R6 | Web content extraction quality varies by site | Medium | Low (degraded content) | Readability is robust for most sites; log warnings for low-quality extractions | 4 |
| R7 | Local registry data loss | Low | High (metadata lost) | Atomic writes (temp + rename); could add `sync` command in future | 2 |
| R8 | `importFile` polling also affected by bug #1211 | Medium | Medium (import may time out) | Time-bounded polling with optimistic continuation; warn user | 3 |
| R9 | Gemini 2.0 model EOL (June 2026) | Confirmed | Medium (breakage for old configs) | Model is a required config value; no defaults; document recommended models | 2, 7 |
| R10 | `text/markdown` MIME type not indexed differently from `text/plain` | Low | Low (content still indexed) | Functional either way; markdown is more structured for the LLM | 4 |

---

## 11. Implementation Timeline

| Phase | Description | Depends On | Can Parallelize With | Est. Effort |
|-------|-------------|-----------|---------------------|-------------|
| 1 | Project Scaffolding | None | -- | Small |
| 2 | Config & Registry | Phase 1 | -- | Small |
| 3 | Gemini Service Layer | Phase 2 | Phase 4 | Medium |
| 4 | Content Extractors | Phase 1 | Phase 3 | Medium |
| 5 | CLI Commands (Workspace, Upload, Metadata) | Phase 2, 3, 4 | -- | Medium-Large |
| 6 | Query & Listing Commands | Phase 5 | -- | Medium |
| 7 | Polish & Documentation | Phase 6 | -- | Small-Medium |

**Critical path**: Phase 1 -> Phase 2 -> Phase 3 -> Phase 5 -> Phase 6 -> Phase 7

**Parallel opportunity**: Phase 3 and Phase 4 can proceed simultaneously after Phase 1 (Phase 4 only needs types from Phase 1, not the config/registry from Phase 2).

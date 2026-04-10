# GeminiRAG - Technical Design Document

**Date**: 2026-04-10
**Version**: 1.0
**Status**: Approved for Implementation
**Author**: Technical Architecture Team

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Technology Choices](#3-technology-choices)
4. [File Structure and Module Organization](#4-file-structure-and-module-organization)
5. [Data Models and TypeScript Interfaces](#5-data-models-and-typescript-interfaces)
6. [Local Registry Schema](#6-local-registry-schema)
7. [CLI Command Structure](#7-cli-command-structure)
8. [Key Algorithms](#8-key-algorithms)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Configuration Loading](#10-configuration-loading)
11. [Interface Contracts Between Modules](#11-interface-contracts-between-modules)
12. [Integration Points](#12-integration-points)
13. [Implementation Units](#13-implementation-units)
14. [Architectural Decision Records](#14-architectural-decision-records)
15. [Electron Desktop UI -- Detailed Technical Design](#15-electron-desktop-ui----detailed-technical-design)
16. [Electron UI Upload Features -- Detailed Technical Design](#16-electron-ui-upload-features----detailed-technical-design)

---

## 1. System Overview

GeminiRAG is a TypeScript CLI tool that provides workspace-based document management and semantic search powered by the Google Gemini File Search API. Users create named workspaces (backed by Gemini File Search stores), upload content from multiple sources (local files, web pages, YouTube videos, personal notes), and query those workspaces using natural language with optional metadata filtering.

### Core Capabilities

- Workspace lifecycle management (create, list, delete, info)
- Multi-source content upload (disk file, web page, YouTube transcript, personal note)
- Mutable upload metadata management (title, flags, expiration date)
- Semantic querying with Gemini-side and client-side filtering
- Cross-workspace querying
- Expiration tracking and warnings

### Key Constraints

| Constraint | Source | Impact |
|-----------|--------|--------|
| SDK polling bug #1211 | research-operation-polling.md | Must check `response.documentName` from initial upload response; enforce 120s hard timeout |
| 503 errors for files >10KB | research-operation-polling.md | Must implement fallback: direct upload -> catch 503 -> retry via `files.upload` + `importFile` |
| `string_list_value` not filterable at query time | research-string-list-filters.md | Flags remain local-only; flag filtering is client-side post-processing |
| 10 File Search Stores per project | investigation | Maximum 10 workspaces; enforced with clear error message |
| Documents are immutable after upload | investigation | Mutable metadata stored in local registry only |
| `force: true` required for document deletion | research-sdk-document-api.md | Must pass `config: { force: true }` on all delete calls |
| Blob upload supported natively | research-blob-upload.md | In-memory content (web/youtube/note) uploaded as Blob; no temp files |
| No fallback configuration values | project conventions | All missing config throws descriptive exception |

---

## 2. Architecture

### 2.1 System Architecture Diagram

```
+------------------------------------------------------------------+
|                          CLI Layer (Commander.js)                  |
|                                                                    |
|  src/cli.ts  -->  src/commands/workspace.ts                       |
|                   src/commands/upload.ts                           |
|                   src/commands/metadata.ts                         |
|                   src/commands/query.ts                            |
|                   src/commands/uploads.ts                          |
+-----+------+------+------+------+------+------+------+-----------+
      |      |      |      |      |      |      |
      v      v      v      v      v      v      v
+------------------------------------------------------------------+
|                        Service Layer                              |
|                                                                    |
|  src/services/file-search.ts    (Gemini Store/Document/Query)     |
|  src/services/content-extractor.ts  (4 source extractors)         |
|  src/services/registry.ts       (Local JSON registry CRUD)        |
|  src/services/gemini-client.ts  (SDK initialization singleton)    |
+-----+------+------+------+------+------+------+---------+--------+
      |      |      |      |                               |
      v      v      v      v                               v
+------------------------------------+    +--------------------------+
|  External Dependencies             |    |  Local Storage           |
|                                    |    |                          |
|  @google/genai SDK                 |    |  ~/.geminirag/           |
|  jsdom + Readability + Turndown    |    |    registry.json         |
|  youtube-transcript                |    |    config.json (optional) |
|  Native fetch (Node.js 18+)       |    |    .env (optional)       |
+------------------------------------+    +--------------------------+
      |
      v
+------------------------------------+
|  Google Gemini API                 |
|                                    |
|  File Search Stores               |
|  Documents (upload/delete/list)    |
|  Models (generateContent + tools)  |
|  Files API (fallback for >10KB)    |
|  Operations (polling)              |
+------------------------------------+
```

### 2.2 Component Interaction Diagram

```
User Input
    |
    v
+----------+     +-----------+     +----------------+
| CLI      | --> | Config    | --> | Gemini Client  |
| Commands |     | Loader    |     | (singleton)    |
+----------+     +-----------+     +-------+--------+
    |                                      |
    +----> Registry Service                |
    |      (local JSON CRUD)               |
    |                                      v
    +----> Content Extractor ---------> File Search Service
           (disk/web/yt/note)           (stores/docs/queries)
                                           |
                                           v
                                     Gemini API
```

### 2.3 Data Flow: Upload Pipeline

```
User: geminirag upload my-research --url https://example.com
    |
    v
[1] Config.loadConfig()  -->  validates GEMINI_API_KEY, GEMINI_MODEL
    |
    v
[2] Registry.getWorkspace("my-research")  -->  returns storeName
    |
    v
[3] ContentExtractor.extractWeb(url)
    |   - fetch HTML
    |   - JSDOM parse
    |   - Readability extract
    |   - Turndown to Markdown
    |   - Extract <title> or fallback to hostname+path
    |
    v
    Returns: { content: string, title: string, mimeType: "text/markdown",
               sourceType: "web", sourceUrl: url }
    |
    v
[4] FileSearch.uploadContent(storeName, blob, displayName, metadata)
    |
    |   [4a] Try uploadToFileSearchStore() with Blob
    |   [4b] Check initial response for documentName (polling bug workaround)
    |   [4c] If 503 error -> fallback to files.upload() + importFile()
    |   [4d] Time-bounded polling (120s max)
    |
    v
    Returns: documentName (Gemini resource name)
    |
    v
[5] Registry.addUpload("my-research", {
        id: uuid(),
        documentName,
        title: extractedTitle,
        timestamp: new Date().toISOString(),
        sourceType: "web",
        sourceUrl: url,
        expirationDate: null,
        flags: []
    })
    |
    v
[6] Display success: "Uploaded: <title> (ID: <uuid>)"
```

### 2.4 Data Flow: Query Pipeline

```
User: geminirag ask my-research "What are the findings?" --filter source_type=web --filter flags=urgent
    |
    v
[1] Parse filters into two buckets:
    - Gemini-side: source_type=web  -->  metadataFilter: 'source_type="web"'
    - Client-side: flags=urgent     -->  post-filter on local registry
    |
    v
[2] Registry.getWorkspace("my-research")  -->  returns storeName
    |
    v
[3] FileSearch.query([storeName], question, 'source_type="web"')
    |   - ai.models.generateContent({
    |       model: config.geminiModel,
    |       contents: question,
    |       config: { tools: [{ fileSearch: {
    |           fileSearchStoreNames: [storeName],
    |           metadataFilter: 'source_type="web"'
    |       }}]}
    |   })
    |
    v
[4] Parse response:
    - answer = response.text
    - citations = response.candidates[0].groundingMetadata.groundingChunks
    |
    v
[5] Client-side filter: If flags=urgent specified,
    cross-reference citation document names against local registry
    entries that have "urgent" flag. Annotate/filter display accordingly.
    |
    v
[6] Display: answer text + formatted citations table
```

---

## 3. Technology Choices

### 3.1 Runtime Dependencies

| Package | Version | Purpose | Justification |
|---------|---------|---------|---------------|
| `@google/genai` | ^1.49.0 | Gemini API SDK | Official TypeScript-first SDK; full File Search Store support including `documents.*` methods |
| `commander` | ^12.x | CLI framework | Zero dependencies, 18ms startup, 152M+ weekly downloads, used in sibling project (Gitter) |
| `dotenv` | ^16.x | .env file loading | Standard, minimal, well-maintained |
| `uuid` | ^10.x | Upload ID generation | RFC-compliant UUID v4 generation |
| `jsdom` | ^25.x | DOM parsing | Required by @mozilla/readability; provides full DOM environment |
| `@mozilla/readability` | ^0.5.x | Web content extraction | Same algorithm as Firefox Reader View; extracts article content reliably |
| `turndown` | ^7.x | HTML to Markdown | Standard conversion library; extensible with plugins |
| `turndown-plugin-gfm` | ^1.x | GFM support | Tables, strikethrough, task lists in converted Markdown |
| `youtube-transcript` | ^1.3.x | YouTube transcript extraction | No API key required, TypeScript support, 90+ dependents |
| `mime-types` | ^2.x | MIME type detection | File upload validation against supported types |

### 3.2 Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.x | TypeScript compiler |
| `tsx` | ^4.x | TypeScript execution for dev and test |
| `@types/node` | ^22.x | Node.js type definitions |
| `@types/jsdom` | ^21.x | jsdom type definitions |
| `@types/turndown` | ^5.x | turndown type definitions |
| `@types/mime-types` | ^2.x | mime-types type definitions |
| `@types/uuid` | ^10.x | uuid type definitions |

### 3.3 Alternatives Rejected

| Alternative | Reason Rejected |
|-------------|----------------|
| Yargs (CLI) | 7 dependencies, 850KB install, lower maintenance score; Commander sufficient |
| LangChain | Unnecessary abstraction; direct SDK gives better control and debugging |
| web-to-markdown (npm) | Wraps readability+turndown but hides error handling; prefer direct control |
| youtube-transcript-sdk | Requires paid API key; `youtube-transcript` is free |
| Pinecone/ChromaDB | Unnecessary; Gemini File Search is a fully managed vector DB |
| SQLite for registry | JSON file is simpler for single-user tool; no query complexity needed |

---

## 4. File Structure and Module Organization

```
GeminiRAG/
  package.json                  # Project metadata, scripts, dependencies
  tsconfig.json                 # TypeScript: target ES2022, module NodeNext
  CLAUDE.md                     # Tool documentation
  Issues - Pending Items.md     # Issues tracker
  src/
    cli.ts                      # Entry point: Commander.js program setup, command registration
    types/
      index.ts                  # All shared TypeScript interfaces and type definitions
    config/
      config.ts                 # Config loading: env > .env > config.json; no fallbacks
    services/
      gemini-client.ts          # GoogleGenAI SDK singleton initialization
      file-search.ts            # Store CRUD, document upload (with workarounds), delete, query
      content-extractor.ts      # Content extraction dispatcher + 4 source extractors
      registry.ts               # Local JSON registry CRUD with atomic writes
    commands/
      workspace.ts              # create, list, delete, info subcommands
      upload.ts                 # upload command with --file, --url, --youtube, --note
      metadata.ts               # update-title, remove, set-expiration, clear-expiration, flag, labels
      query.ts                  # ask command (single + multi-workspace)
      uploads.ts                # uploads listing command with filters and sorting
    utils/
      format.ts                 # CLI output formatting: tables, colors, expiration warnings, citations
      validation.ts             # Input validation: MIME types, dates, flags, workspace names
  test_scripts/
    test-config.ts              # Config loading, missing values, expiration warning
    test-registry.ts            # Registry CRUD operations
    test-gemini-service.ts      # Store/document lifecycle, polling workaround
    test-extractors.ts          # All content extractors
    test-cli-commands.ts        # Full CLI command integration
    test-query.ts               # Query with filters and citations
    test-uploads-listing.ts     # Listing, filters, sorting, expiration markers
  docs/
    design/
      project-design.md         # This document
      project-functions.md      # Functional requirements registry
      plan-001-geminirag-implementation.md  # Implementation plan
      configuration-guide.md    # Configuration guide (Phase 7)
    reference/
      refined-request.md        # Original refined specification
      investigation-gemini-file-search.md  # API investigation
      research-sdk-document-api.md
      research-operation-polling.md
      research-string-list-filters.md
      research-blob-upload.md
```

### 4.1 Module Responsibilities

#### `src/cli.ts` -- Entry Point

- Import and configure Commander.js `program`
- Register all subcommands from `src/commands/*`
- Handle global error boundary (catch unhandled rejections)
- Check API key expiration warning on startup (before any command runs)
- Parse arguments and dispatch to command handlers

#### `src/types/index.ts` -- Type Definitions

- All shared TypeScript interfaces, enums, and type aliases
- No runtime code; pure type declarations
- Single source of truth for data shapes across all modules

#### `src/config/config.ts` -- Configuration

- Load configuration from three sources with priority: env vars > `.env` > `~/.geminirag/config.json`
- Throw descriptive exceptions for missing required values
- Check API key expiration and emit warning if within 7 days
- Export `loadConfig(): AppConfig` function
- No caching; config is loaded fresh on each CLI invocation

#### `src/services/gemini-client.ts` -- SDK Initialization

- Initialize `GoogleGenAI` instance with API key from config
- Export a factory function (not a singleton global) to keep testability
- No business logic; pure SDK wrapper

#### `src/services/file-search.ts` -- Gemini File Search Operations

- Store lifecycle: create, delete, list
- Document upload with dual-path strategy (direct + 503 fallback)
- Document upload polling with bug #1211 workaround
- Document deletion with `force: true`
- Query execution via `generateContent` with FileSearch tool
- Parse grounding metadata into structured citations
- Metadata filter construction (AIP-160 syntax)

#### `src/services/content-extractor.ts` -- Content Extraction

- Dispatcher function that routes to the correct extractor based on source type
- Four extractors: disk file, web page, YouTube transcript, personal note
- Each extractor returns a uniform `ExtractedContent` result
- No Gemini API interaction; pure content transformation

#### `src/services/registry.ts` -- Local Registry

- JSON file CRUD at `~/.geminirag/registry.json`
- Atomic writes (write to temp file, rename)
- Auto-create directory and empty registry on first use
- Workspace operations: add, remove, get, list
- Upload operations: add, remove, update (partial)
- No Gemini API interaction; pure local storage

#### `src/commands/workspace.ts` -- Workspace Commands

- `create <name>`: call FileSearch.createStore + Registry.addWorkspace
- `list`: call Registry.listWorkspaces, format as table
- `delete <name>`: call FileSearch.deleteStore + Registry.removeWorkspace
- `info <name>`: call Registry.getWorkspace, compute derived stats, format

#### `src/commands/upload.ts` -- Upload Command

- Parse `--file`, `--url`, `--youtube`, `--note` options (mutually exclusive)
- Route to appropriate extractor
- Call FileSearch.uploadContent with extracted content
- Register in local registry
- Display success message with upload ID and title

#### `src/commands/metadata.ts` -- Metadata Commands

- `update-title`: Registry.updateUpload with new title
- `remove`: FileSearch.deleteDocument + Registry.removeUpload
- `set-expiration`: validate ISO 8601 date, Registry.updateUpload
- `clear-expiration`: Registry.updateUpload with null
- `flag --add/--remove`: validate flag values, Registry.updateUpload
- `labels`: iterate workspace uploads, collect distinct keys

#### `src/commands/query.ts` -- Query Command

- Parse workspace names (variadic) and question (last positional argument)
- Parse `--filter` options into Gemini-side and client-side buckets
- Resolve workspace store names from registry
- Call FileSearch.query with store names and Gemini-side filter
- Apply client-side filters (flags, expiration) to citations
- Format and display answer + citations

#### `src/commands/uploads.ts` -- Uploads Listing

- List uploads from local registry for a workspace
- Apply `--filter` options client-side
- Apply `--sort` option (timestamp ascending/descending)
- Format as table with expiration indicators ([EXPIRED], [EXPIRING SOON])

#### `src/utils/format.ts` -- Output Formatting

- Table formatting for workspace lists, upload lists
- Citation formatting for query results
- Expiration warning formatting ([EXPIRED], [EXPIRING SOON])
- Color output helpers (if terminal supports it)
- Consistent column alignment

#### `src/utils/validation.ts` -- Input Validation

- Supported MIME types list and validation
- ISO 8601 date format validation
- Flag value validation (`completed`, `urgent`, `inactive`)
- Workspace name validation (non-empty, no special characters)
- YouTube URL format validation
- URL format validation

---

## 5. Data Models and TypeScript Interfaces

All types are defined in `src/types/index.ts`. This is the single source of truth.

```typescript
// ===== Enums and Type Aliases =====

export type SourceType = 'file' | 'web' | 'youtube' | 'note';

export type Flag = 'completed' | 'urgent' | 'inactive';

export const VALID_FLAGS: Flag[] = ['completed', 'urgent', 'inactive'];

// ===== Upload Entry =====

export interface UploadEntry {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Gemini File Search document resource name (e.g., "fileSearchStores/.../documents/...") */
  documentName: string;
  /** Human-readable title (auto-generated, user-editable) */
  title: string;
  /** ISO 8601 UTC datetime of upload creation */
  timestamp: string;
  /** Content source type */
  sourceType: SourceType;
  /** Original URL/path for web/youtube/file sources; null for notes */
  sourceUrl: string | null;
  /** ISO 8601 date for expiration; null if no expiration set */
  expirationDate: string | null;
  /** Status flags array */
  flags: Flag[];
}

// ===== Workspace =====

export interface WorkspaceData {
  /** Workspace name (user-provided, unique) */
  name: string;
  /** Gemini File Search Store resource name (e.g., "fileSearchStores/abc123") */
  storeName: string;
  /** ISO 8601 UTC datetime of workspace creation */
  createdAt: string;
  /** Uploads keyed by upload ID (UUID) */
  uploads: Record<string, UploadEntry>;
}

// ===== Registry (Root) =====

export interface Registry {
  /** Workspaces keyed by workspace name */
  workspaces: Record<string, WorkspaceData>;
}

// ===== Configuration =====

export interface AppConfig {
  /** Google Gemini API key (required) */
  geminiApiKey: string;
  /** Gemini model name, e.g. "gemini-2.5-flash" (required) */
  geminiModel: string;
  /** ISO 8601 date for API key expiration (optional) */
  geminiApiKeyExpiration?: string;
}

// ===== Content Extraction =====

export interface ExtractedContent {
  /** The content to upload (text string for blob upload, or file path for disk files) */
  content: string;
  /** Whether content is a file path (true) or in-memory text (false) */
  isFilePath: boolean;
  /** Auto-generated title */
  title: string;
  /** MIME type for the content */
  mimeType: string;
  /** Source type classification */
  sourceType: SourceType;
  /** Source URL or file path (null for notes) */
  sourceUrl: string | null;
}

// ===== Gemini Custom Metadata =====

export interface CustomMetadataEntry {
  key: string;
  stringValue?: string;
  numericValue?: number;
  stringListValue?: { values: string[] };
}

// ===== Query Result =====

export interface Citation {
  /** Relevant text excerpt from the source document */
  text: string;
  /** Document title (from Gemini displayName or custom metadata) */
  documentTitle: string;
  /** Document resource URI */
  documentUri: string;
  /** Custom metadata returned with the citation */
  customMetadata?: Record<string, string>;
}

export interface QueryResult {
  /** Natural language answer from the model */
  answer: string;
  /** Citations from grounding metadata */
  citations: Citation[];
}

// ===== Filter Types =====

/** Gemini-side filter keys that can be passed in metadataFilter (AIP-160) */
export type GeminiFilterKey = 'source_type' | 'source_url';

/** Client-side filter keys that are applied after Gemini returns results */
export type ClientFilterKey = 'flags' | 'expiration_date' | 'expiration_status';

export interface ParsedFilter {
  key: string;
  value: string;
  layer: 'gemini' | 'client';
}

// ===== Store Info =====

export interface StoreInfo {
  /** Store resource name */
  name: string;
  /** Human-readable display name */
  displayName: string;
}

// ===== Upload Options (CLI) =====

export interface UploadOptions {
  file?: string;
  url?: string;
  youtube?: string;
  note?: string;
}

// ===== Listing Options (CLI) =====

export interface ListingOptions {
  filter?: string[];
  sort?: string;
}
```

---

## 6. Local Registry Schema

The registry is stored at `~/.geminirag/registry.json`. It is the single mutable metadata store for the application.

### 6.1 JSON Schema

```json
{
  "workspaces": {
    "<workspace-name>": {
      "name": "<workspace-name>",
      "storeName": "fileSearchStores/<store-id>",
      "createdAt": "2026-04-10T12:00:00.000Z",
      "uploads": {
        "<uuid-v4>": {
          "id": "<uuid-v4>",
          "documentName": "fileSearchStores/<store-id>/documents/<doc-id>",
          "title": "report.pdf",
          "timestamp": "2026-04-10T12:01:00.000Z",
          "sourceType": "file",
          "sourceUrl": "/absolute/path/to/report.pdf",
          "expirationDate": null,
          "flags": []
        },
        "<uuid-v4>": {
          "id": "<uuid-v4>",
          "documentName": "fileSearchStores/<store-id>/documents/<doc-id>",
          "title": "Example Article - WebDev Blog",
          "timestamp": "2026-04-10T12:05:00.000Z",
          "sourceType": "web",
          "sourceUrl": "https://example.com/article",
          "expirationDate": "2026-06-01",
          "flags": ["urgent"]
        }
      }
    }
  }
}
```

### 6.2 Invariants

1. Workspace names are unique (enforced by `Record<string, WorkspaceData>` key)
2. Upload IDs are UUID v4, globally unique
3. `documentName` is the full Gemini resource path (stable reference for API calls)
4. `storeName` is the full Gemini store resource path
5. All timestamps are ISO 8601 UTC
6. `expirationDate` is ISO 8601 date (YYYY-MM-DD) or null
7. `flags` is always an array (empty array, not null, when no flags)
8. `sourceUrl` is null only for `note` source type

### 6.3 Atomic Write Strategy

```
1. Serialize registry to JSON string
2. Write to ~/.geminirag/registry.json.tmp
3. Rename ~/.geminirag/registry.json.tmp -> ~/.geminirag/registry.json
```

This ensures that a crash during write does not corrupt the registry file. The rename operation is atomic on POSIX filesystems.

---

## 7. CLI Command Structure

### 7.1 Command Tree

```
geminirag
  |-- create <name>                              # Create workspace
  |-- list                                       # List all workspaces
  |-- delete <name>                              # Delete workspace
  |-- info <name>                                # Workspace details
  |
  |-- upload <workspace>                         # Upload content
  |     --file <path>                            #   from disk file
  |     --url <url>                              #   from web page
  |     --youtube <url>                          #   from YouTube video
  |     --note <text>                            #   personal note
  |
  |-- uploads <workspace>                        # List uploads
  |     --filter <key=value>  (repeatable)       #   filter by metadata
  |     --sort <field>                           #   sort (timestamp, -timestamp)
  |
  |-- update-title <workspace> <upload-id> <title>  # Change upload title
  |-- remove <workspace> <upload-id>                # Delete upload
  |-- set-expiration <workspace> <upload-id> <date> # Set expiration
  |-- clear-expiration <workspace> <upload-id>      # Clear expiration
  |-- flag <workspace> <upload-id>                  # Manage flags
  |     --add <flags...>                            #   add flags
  |     --remove <flags...>                         #   remove flags
  |-- labels <workspace>                            # List metadata labels
  |
  |-- ask <workspaces...> <question>             # Query workspace(s)
        --filter <key=value>  (repeatable)       #   metadata filter
```

### 7.2 Argument Specifications

#### `geminirag create <name>`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Workspace name; must be non-empty, no special characters beyond hyphens/underscores |

**Validations**:
- Name must not already exist in registry
- Total workspace count must be < 10 (Gemini store limit)

#### `geminirag upload <workspace> [options]`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--file <path>` | string | One of four | Local file path |
| `--url <url>` | string | One of four | Web page URL |
| `--youtube <url>` | string | One of four | YouTube video URL |
| `--note <text>` | string | One of four | Note text content |

**Validations**:
- Exactly one of `--file`, `--url`, `--youtube`, `--note` must be provided
- `--file`: file must exist, MIME type must be supported
- `--url`: must be a valid HTTP/HTTPS URL
- `--youtube`: must be a valid YouTube URL
- `--note`: must be non-empty

#### `geminirag ask <workspaces...> <question> [options]`

| Parameter/Option | Type | Required | Description |
|-----------------|------|----------|-------------|
| `workspaces` | string[] | Yes (1+) | One or more workspace names |
| `question` | string | Yes | Natural language question (last positional arg) |
| `--filter <key=value>` | string[] | No | Metadata filters (repeatable) |

**Note on argument parsing**: The last positional argument is the question; all preceding positional arguments are workspace names. Commander.js variadic arguments handle this with a custom parser.

#### `geminirag flag <workspace> <upload-id> [options]`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--add <flags...>` | string[] | At least one | Flags to add: `completed`, `urgent`, `inactive` |
| `--remove <flags...>` | string[] | At least one | Flags to remove |

**Validations**:
- Each flag must be one of: `completed`, `urgent`, `inactive`
- At least one of `--add` or `--remove` must be provided

#### `geminirag uploads <workspace> [options]`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--filter <key=value>` | string[] | No | Filters: `source_type=web`, `flags=urgent`, `expiration_status=expired` |
| `--sort <field>` | string | No | Sort field: `timestamp` (ascending) or `-timestamp` (descending) |

---

## 8. Key Algorithms

### 8.1 Upload Pipeline with Polling Bug Workaround and 503 Fallback

This is the most critical algorithm in the system. It handles two known SDK bugs.

```
FUNCTION uploadContent(storeName, content, isFilePath, displayName, customMetadata):
    // Prepare the upload input
    IF isFilePath:
        file = content  // string path passed directly to SDK
    ELSE:
        file = new Blob([content], { type: mimeType })
    END IF

    TRY:
        // === Primary Path: Direct Upload ===
        operation = await ai.fileSearchStores.uploadToFileSearchStore({
            file: file,
            fileSearchStoreName: storeName,
            config: { displayName, customMetadata }
        })

        // === Polling Bug #1211 Workaround ===
        // The initial response often contains documentName even though done is undefined
        rawResponse = (operation as any).response
        IF rawResponse?.documentName:
            RETURN rawResponse.documentName  // Upload already complete
        END IF

        // === Standard Polling with Hard Timeout ===
        deadline = Date.now() + 120_000  // 120 seconds max
        WHILE NOT operation.done:
            IF Date.now() > deadline:
                THROW TimeoutError("Upload timed out after 120s. Operation: ${operation.name}")
            END IF
            await sleep(3000)  // 3 second intervals
            operation = await ai.operations.get({ operation })
        END WHILE

        IF operation.error:
            THROW Error("Upload failed: ${operation.error}")
        END IF

        RETURN operation.response.document.name

    CATCH error:
        // === 503 Fallback for Large Content ===
        IF is503Error(error) AND NOT isFilePath:
            console.warn("Direct upload returned 503. Falling back to Files API + Import...")

            // Step 1: Upload to Files API (temporary 48-hour storage)
            uploadedFile = await ai.files.upload({
                file: file,
                config: { displayName }
            })

            // Step 2: Import into File Search Store
            importOp = await ai.fileSearchStores.importFile({
                fileSearchStoreName: storeName,
                fileName: uploadedFile.name,
                config: { customMetadata }
            })

            // Step 3: Time-bounded polling (importFile has no documentName workaround)
            deadline = Date.now() + 120_000
            WHILE NOT importOp.done:
                IF Date.now() > deadline:
                    // Optimistic continuation: document may already be indexed
                    console.warn("Import polling timed out. Proceeding optimistically.")
                    BREAK
                END IF
                await sleep(5000)
                importOp = await ai.operations.get({ operation: importOp })
            END WHILE

            IF importOp.error:
                THROW Error("Import failed: ${importOp.error}")
            END IF

            // Discover document name via listing (since importFile response is empty)
            documentName = await findDocumentByDisplayName(storeName, displayName)
            RETURN documentName

        ELSE:
            THROW error  // Re-throw non-503 errors
        END IF
    END CATCH
END FUNCTION
```

### 8.2 503 Error Detection

```typescript
function is503Error(error: unknown): boolean {
  if (error instanceof Error) {
    // The SDK may throw with status code in the message or in a nested property
    const message = error.message.toLowerCase();
    if (message.includes('503') || message.includes('service unavailable')) {
      return true;
    }
    // Check for nested status code
    const anyError = error as Record<string, unknown>;
    if (anyError.status === 503 || anyError.statusCode === 503) {
      return true;
    }
    if (anyError.httpStatusCode === 503) {
      return true;
    }
  }
  return false;
}
```

### 8.3 Document Discovery After Import (Fallback Path)

When using the `files.upload` + `importFile` fallback, the `importFile` response does not contain a `documentName`. We must discover the document by listing:

```
FUNCTION findDocumentByDisplayName(storeName, displayName):
    pager = await ai.fileSearchStores.documents.list({ parent: storeName })

    FOR EACH doc IN pager:
        IF doc.displayName === displayName:
            RETURN doc.name
        END IF
    END FOR

    THROW Error("Document not found after import: ${displayName}")
END FUNCTION
```

### 8.4 Content Extraction: Web Page

```
FUNCTION extractWeb(url):
    // Fetch HTML
    response = await fetch(url)
    IF NOT response.ok:
        THROW Error("Failed to fetch URL: ${response.status} ${response.statusText}")
    END IF
    html = await response.text()

    // Parse with JSDOM
    dom = new JSDOM(html, { url })

    // Extract title
    titleElement = dom.window.document.querySelector('title')
    IF titleElement AND titleElement.textContent.trim():
        title = titleElement.textContent.trim()
    ELSE:
        parsedUrl = new URL(url)
        title = parsedUrl.hostname + parsedUrl.pathname
    END IF

    // Extract content with Readability
    reader = new Readability(dom.window.document)
    article = reader.parse()
    IF NOT article OR NOT article.content:
        THROW Error("Failed to extract content from URL: ${url}")
    END IF

    // Convert to Markdown
    turndownService = new TurndownService()
    turndownService.use(gfm)
    markdown = turndownService.turndown(article.content)

    IF NOT markdown.trim():
        THROW Error("Extracted content from URL is empty: ${url}")
    END IF

    RETURN {
        content: markdown,
        isFilePath: false,
        title: title,
        mimeType: "text/markdown",
        sourceType: "web",
        sourceUrl: url
    }
END FUNCTION
```

### 8.5 Content Extraction: YouTube Transcript

```
FUNCTION extractYouTube(url):
    // Validate and extract video ID
    videoId = extractVideoId(url)
    IF NOT videoId:
        THROW Error("Invalid YouTube URL: ${url}")
    END IF

    // Fetch video title via oEmbed (no API key needed)
    oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    oembedResponse = await fetch(oembedUrl)
    IF NOT oembedResponse.ok:
        THROW Error("Failed to fetch YouTube video info for: ${url}")
    END IF
    oembedData = await oembedResponse.json()
    title = oembedData.title

    // Fetch transcript
    TRY:
        transcriptItems = await YoutubeTranscript.fetchTranscript(videoId)
    CATCH:
        THROW Error("Transcript not available for YouTube video: ${url}. Only videos with captions are supported.")
    END TRY

    IF NOT transcriptItems OR transcriptItems.length === 0:
        THROW Error("Transcript is empty for YouTube video: ${url}")
    END IF

    // Combine transcript segments into plain text
    transcript = transcriptItems.map(item => item.text).join(' ')

    RETURN {
        content: transcript,
        isFilePath: false,
        title: title,
        mimeType: "text/plain",
        sourceType: "youtube",
        sourceUrl: url
    }
END FUNCTION
```

### 8.6 Content Extraction: Personal Note Title Generation

```
FUNCTION generateNoteTitle(noteText):
    // Trim and take first 60 characters
    trimmed = noteText.trim()

    IF trimmed.length <= 60:
        RETURN trimmed
    END IF

    // Find last space within first 60 characters to avoid word splitting
    truncated = trimmed.substring(0, 60)
    lastSpace = truncated.lastIndexOf(' ')

    IF lastSpace > 20:  // Ensure we keep at least 20 chars
        RETURN truncated.substring(0, lastSpace) + "..."
    ELSE:
        RETURN truncated + "..."
    END IF
END FUNCTION
```

### 8.7 Query with Dual-Layer Filtering

```
FUNCTION executeQuery(workspaceNames, question, filters):
    // Step 1: Parse filters into Gemini-side and client-side buckets
    geminiFilters = []   // source_type, source_url
    clientFilters = []   // flags, expiration_date, expiration_status

    FOR EACH filter IN filters:
        { key, value } = parseFilter(filter)  // parse "key=value"
        IF key IN ['source_type', 'source_url']:
            geminiFilters.push({ key, value })
        ELSE IF key IN ['flags', 'expiration_date', 'expiration_status']:
            clientFilters.push({ key, value })
        ELSE:
            THROW Error("Unknown filter key: ${key}")
        END IF
    END FOR

    // Step 2: Build AIP-160 metadataFilter string
    metadataFilter = null
    IF geminiFilters.length > 0:
        parts = geminiFilters.map(f => `${f.key}="${f.value}"`)
        metadataFilter = parts.join(' AND ')
    END IF

    // Step 3: Resolve store names from registry
    storeNames = []
    FOR EACH wsName IN workspaceNames:
        workspace = registry.getWorkspace(wsName)
        storeNames.push(workspace.storeName)
    END FOR

    // Step 4: Execute Gemini query
    result = await fileSearch.query(storeNames, question, metadataFilter)

    // Step 5: Apply client-side filters to citations
    IF clientFilters.length > 0:
        // Cross-reference citation document URIs with local registry
        FOR EACH citation IN result.citations:
            localEntry = findUploadByDocumentName(citation.documentUri)
            IF localEntry:
                citation.localMetadata = localEntry
            END IF
        END FOR

        // Filter citations by client-side criteria
        result.citations = result.citations.filter(c => {
            FOR EACH filter IN clientFilters:
                IF filter.key === 'flags':
                    IF NOT c.localMetadata?.flags.includes(filter.value):
                        RETURN false
                    END IF
                ELSE IF filter.key === 'expiration_status':
                    IF filter.value === 'expired':
                        IF NOT isExpired(c.localMetadata?.expirationDate):
                            RETURN false
                        END IF
                    END IF
                END IF
            END FOR
            RETURN true
        })
    END IF

    RETURN result
END FUNCTION
```

### 8.8 Expiration Status Calculation

```
FUNCTION getExpirationStatus(expirationDate, warningDays = 7):
    IF expirationDate IS null:
        RETURN null  // No expiration set
    END IF

    expDate = new Date(expirationDate)
    now = new Date()
    diffMs = expDate.getTime() - now.getTime()
    diffDays = diffMs / (1000 * 60 * 60 * 24)

    IF diffDays < 0:
        RETURN "EXPIRED"
    ELSE IF diffDays <= warningDays:
        RETURN "EXPIRING_SOON"
    ELSE:
        RETURN null  // Not expired, not soon
    END IF
END FUNCTION
```

---

## 9. Error Handling Strategy

### 9.1 Principles

1. **No fallback values for configuration** -- every missing config throws a descriptive exception with instructions
2. **Fail fast, fail loud** -- validate inputs before calling external APIs
3. **No partial state** -- if upload to Gemini succeeds but registry write fails, attempt to clean up the Gemini document
4. **Actionable error messages** -- every error tells the user what went wrong and how to fix it
5. **No silent failures** -- warnings are printed to stderr, errors throw exceptions

### 9.2 Error Categories

#### Configuration Errors (thrown by `config.ts`)

| Condition | Error Message |
|-----------|---------------|
| Missing `GEMINI_API_KEY` | `"GEMINI_API_KEY is required. Obtain it from https://aistudio.google.com/apikey and set it as an environment variable, in .env file, or in ~/.geminirag/config.json"` |
| Missing `GEMINI_MODEL` | `"GEMINI_MODEL is required. Set it in config or environment. Recommended: gemini-2.5-flash or gemini-2.5-flash-lite"` |

#### Validation Errors (thrown by `validation.ts` or command handlers)

| Condition | Error Message |
|-----------|---------------|
| Workspace already exists | `"Workspace '<name>' already exists"` |
| Workspace not found | `"Workspace '<name>' not found"` |
| Upload ID not found | `"Upload '<id>' not found in workspace '<name>'"` |
| Invalid flag value | `"Invalid flag '<flag>'. Allowed values: completed, urgent, inactive"` |
| Invalid date format | `"Invalid date format '<input>'. Use ISO 8601 format: YYYY-MM-DD"` |
| Unsupported MIME type | `"Unsupported file type '<mime>'. Supported types: text/plain, text/markdown, application/pdf, ..."` |
| No upload option provided | `"One of --file, --url, --youtube, or --note must be provided"` |
| Multiple upload options | `"Only one of --file, --url, --youtube, or --note can be provided"` |
| File not found | `"File not found: '<path>'"` |
| Empty note text | `"Note text cannot be empty"` |
| Invalid YouTube URL | `"Invalid YouTube URL: '<url>'"` |
| Max workspaces reached | `"Maximum 10 workspaces reached (Gemini API limit). Delete a workspace before creating a new one."` |

#### API Errors (thrown by `file-search.ts`)

| Condition | Error Message |
|-----------|---------------|
| Upload timeout | `"Upload timed out after 120s. Operation: <name>. The file may still be indexing."` |
| Upload failure | `"Upload failed: <error details>"` |
| Import failure | `"Import failed: <error details>"` |
| Store deletion failure | `"Failed to delete store '<name>': <error details>"` |
| Document deletion failure | `"Failed to delete document '<name>': <error details>"` |
| Query failure | `"Query failed: <error details>"` |

#### Content Extraction Errors (thrown by `content-extractor.ts`)

| Condition | Error Message |
|-----------|---------------|
| Web fetch failure | `"Failed to fetch URL '<url>': <status> <statusText>"` |
| Empty web content | `"Failed to extract content from URL: '<url>'"` |
| YouTube no transcript | `"Transcript not available for YouTube video: '<url>'. Only videos with captions are supported."` |
| YouTube fetch failure | `"Failed to fetch YouTube video info for: '<url>'"` |

### 9.3 Error Propagation

```
Command Handler (catches all)
    |
    +---> Service Call (may throw)
    |       |
    |       +---> External API Call (may throw)
    |
    +---> catch (error)
            |
            +---> Print error message to stderr
            +---> Exit with non-zero code (process.exit(1))
```

Each command handler wraps its logic in a try/catch. The catch block prints the error message to `stderr` using `console.error()` and exits with code 1. The `cli.ts` global error handler catches any unhandled rejections as a safety net.

### 9.4 Rollback on Partial Upload Failure

```
FUNCTION uploadWithRollback(workspace, content, ...):
    TRY:
        documentName = await fileSearch.uploadContent(...)

        TRY:
            registry.addUpload(workspace, uploadEntry)
        CATCH registryError:
            // Registry write failed after Gemini upload succeeded
            // Attempt to clean up the Gemini document
            TRY:
                await fileSearch.deleteDocument(documentName)
            CATCH:
                // Log but don't mask the original error
                console.error("Warning: Failed to clean up Gemini document after registry error")
            END TRY
            THROW registryError
        END TRY

    CATCH error:
        THROW error  // No Gemini cleanup needed if upload itself failed
    END TRY
END FUNCTION
```

---

## 10. Configuration Loading

### 10.1 Load Priority

```
Priority (highest wins):
  1. Environment variables (GEMINI_API_KEY, GEMINI_MODEL, GEMINI_API_KEY_EXPIRATION)
  2. .env file (in current working directory)
  3. Config file (~/.geminirag/config.json)
```

### 10.2 Config File Format (`~/.geminirag/config.json`)

```json
{
  "GEMINI_API_KEY": "AIza...",
  "GEMINI_MODEL": "gemini-2.5-flash",
  "GEMINI_API_KEY_EXPIRATION": "2026-07-01"
}
```

### 10.3 Loading Algorithm

```
FUNCTION loadConfig(): AppConfig
    // Step 1: Load .env file (adds to process.env, does NOT override existing env vars)
    dotenv.config()

    // Step 2: Load config file
    configFilePath = path.join(os.homedir(), '.geminirag', 'config.json')
    fileConfig = {}
    IF fs.existsSync(configFilePath):
        fileConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'))
    END IF

    // Step 3: Resolve values with priority (env > .env [already in env] > config file)
    geminiApiKey = process.env.GEMINI_API_KEY ?? fileConfig.GEMINI_API_KEY
    geminiModel = process.env.GEMINI_MODEL ?? fileConfig.GEMINI_MODEL
    geminiApiKeyExpiration = process.env.GEMINI_API_KEY_EXPIRATION ?? fileConfig.GEMINI_API_KEY_EXPIRATION

    // Step 4: Validate required values -- NO FALLBACKS
    IF NOT geminiApiKey:
        THROW Error("GEMINI_API_KEY is required. Obtain it from https://aistudio.google.com/apikey ...")
    END IF
    IF NOT geminiModel:
        THROW Error("GEMINI_MODEL is required. Set it in config or environment. ...")
    END IF

    // Step 5: Check API key expiration warning
    IF geminiApiKeyExpiration:
        daysUntilExpiry = daysBetween(new Date(), new Date(geminiApiKeyExpiration))
        IF daysUntilExpiry <= 0:
            console.warn("WARNING: GEMINI_API_KEY has expired! Renew at https://aistudio.google.com/apikey")
        ELSE IF daysUntilExpiry <= 7:
            console.warn(`WARNING: GEMINI_API_KEY expires in ${daysUntilExpiry} day(s). Renew at https://aistudio.google.com/apikey`)
        END IF
    END IF

    RETURN { geminiApiKey, geminiModel, geminiApiKeyExpiration }
END FUNCTION
```

### 10.4 No-Fallback Rule

Per project conventions, **no configuration setting may have a fallback or default value**. If a required setting is missing, the tool MUST throw a descriptive exception. The only optional setting is `GEMINI_API_KEY_EXPIRATION`.

---

## 11. Interface Contracts Between Modules

This section defines the function signatures and contracts that form the boundaries between modules. These contracts are critical for parallel implementation -- each implementation unit must adhere to these signatures exactly.

### 11.1 Config Module (`src/config/config.ts`)

```typescript
/**
 * Load application configuration from env vars > .env > config file.
 * Throws if GEMINI_API_KEY or GEMINI_MODEL is missing.
 * Prints warning to stderr if API key expiration is within 7 days.
 *
 * @returns Fully validated AppConfig object
 * @throws Error if required configuration is missing
 */
export function loadConfig(): AppConfig;
```

**Consumers**: All command handlers call `loadConfig()` at the start of execution.

### 11.2 Registry Service (`src/services/registry.ts`)

```typescript
/**
 * Load the registry from ~/.geminirag/registry.json.
 * Creates the directory and an empty registry file if they don't exist.
 *
 * @returns The current registry state
 */
export function loadRegistry(): Registry;

/**
 * Save the registry atomically (write to .tmp, rename).
 *
 * @param registry - The complete registry state to save
 */
export function saveRegistry(registry: Registry): void;

/**
 * Add a workspace to the registry.
 *
 * @param name - Workspace name (must not already exist)
 * @param storeName - Gemini File Search Store resource name
 * @throws Error if workspace name already exists
 */
export function addWorkspace(name: string, storeName: string): void;

/**
 * Remove a workspace and all its uploads from the registry.
 *
 * @param name - Workspace name
 * @throws Error if workspace not found
 */
export function removeWorkspace(name: string): void;

/**
 * Get a workspace by name.
 *
 * @param name - Workspace name
 * @returns WorkspaceData object
 * @throws Error if workspace not found
 */
export function getWorkspace(name: string): WorkspaceData;

/**
 * List all workspaces.
 *
 * @returns Array of WorkspaceData objects
 */
export function listWorkspaces(): WorkspaceData[];

/**
 * Add an upload entry to a workspace.
 *
 * @param workspaceName - Target workspace
 * @param entry - Complete UploadEntry object
 * @throws Error if workspace not found
 */
export function addUpload(workspaceName: string, entry: UploadEntry): void;

/**
 * Remove an upload entry from a workspace.
 *
 * @param workspaceName - Target workspace
 * @param uploadId - Upload UUID to remove
 * @throws Error if workspace or upload not found
 */
export function removeUpload(workspaceName: string, uploadId: string): void;

/**
 * Partially update an upload entry.
 *
 * @param workspaceName - Target workspace
 * @param uploadId - Upload UUID to update
 * @param updates - Partial UploadEntry with fields to update
 * @throws Error if workspace or upload not found
 */
export function updateUpload(
  workspaceName: string,
  uploadId: string,
  updates: Partial<Pick<UploadEntry, 'title' | 'expirationDate' | 'flags'>>
): void;
```

**Consumers**: All command handlers. Content extractors do NOT consume the registry.

### 11.3 Gemini Client (`src/services/gemini-client.ts`)

```typescript
import { GoogleGenAI } from '@google/genai';

/**
 * Create a GoogleGenAI SDK instance from the provided config.
 * Does not cache -- returns a new instance each time.
 *
 * @param config - AppConfig with geminiApiKey
 * @returns Initialized GoogleGenAI instance
 */
export function createGeminiClient(config: AppConfig): GoogleGenAI;
```

**Consumers**: `file-search.ts` only. Command handlers do not call this directly.

### 11.4 File Search Service (`src/services/file-search.ts`)

```typescript
import { GoogleGenAI } from '@google/genai';
import { CustomMetadataEntry, QueryResult, StoreInfo } from '../types/index.js';

/**
 * Create a new Gemini File Search Store.
 *
 * @param ai - GoogleGenAI instance
 * @param displayName - Human-readable store name
 * @returns Store resource name (e.g., "fileSearchStores/abc123")
 */
export async function createStore(ai: GoogleGenAI, displayName: string): Promise<string>;

/**
 * Delete a Gemini File Search Store and all its documents.
 *
 * @param ai - GoogleGenAI instance
 * @param storeName - Store resource name
 */
export async function deleteStore(ai: GoogleGenAI, storeName: string): Promise<void>;

/**
 * List all Gemini File Search Stores.
 *
 * @param ai - GoogleGenAI instance
 * @returns Array of store info objects
 */
export async function listStores(ai: GoogleGenAI): Promise<StoreInfo[]>;

/**
 * Upload content to a File Search Store.
 * Handles polling bug #1211 workaround and 503 fallback.
 *
 * @param ai - GoogleGenAI instance
 * @param storeName - Target store resource name
 * @param content - File path (string) or in-memory content (string for blob)
 * @param isFilePath - True if content is a file path
 * @param mimeType - MIME type for blob content
 * @param displayName - Document display name
 * @param customMetadata - Gemini custom metadata entries
 * @returns Document resource name (e.g., "fileSearchStores/.../documents/...")
 */
export async function uploadContent(
  ai: GoogleGenAI,
  storeName: string,
  content: string,
  isFilePath: boolean,
  mimeType: string,
  displayName: string,
  customMetadata: CustomMetadataEntry[]
): Promise<string>;

/**
 * Delete a document from a File Search Store.
 *
 * @param ai - GoogleGenAI instance
 * @param documentName - Full document resource name
 */
export async function deleteDocument(ai: GoogleGenAI, documentName: string): Promise<void>;

/**
 * Query one or more File Search Stores with a natural language question.
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name (e.g., "gemini-2.5-flash")
 * @param storeNames - Array of store resource names
 * @param question - Natural language question
 * @param metadataFilter - Optional AIP-160 filter string (Gemini-side only)
 * @returns QueryResult with answer and citations
 */
export async function query(
  ai: GoogleGenAI,
  model: string,
  storeNames: string[],
  question: string,
  metadataFilter?: string
): Promise<QueryResult>;
```

**Consumers**: Command handlers (`workspace.ts`, `upload.ts`, `metadata.ts`, `query.ts`).

### 11.5 Content Extractor (`src/services/content-extractor.ts`)

```typescript
import { ExtractedContent } from '../types/index.js';

/**
 * Extract content from a disk file.
 *
 * @param filePath - Absolute or relative path to the file
 * @returns ExtractedContent with isFilePath=true
 * @throws Error if file not found or MIME type unsupported
 */
export async function extractDiskFile(filePath: string): Promise<ExtractedContent>;

/**
 * Extract content from a web page URL.
 *
 * @param url - HTTP/HTTPS URL
 * @returns ExtractedContent with markdown content and isFilePath=false
 * @throws Error if fetch fails or content extraction fails
 */
export async function extractWebPage(url: string): Promise<ExtractedContent>;

/**
 * Extract transcript from a YouTube video.
 *
 * @param url - YouTube video URL
 * @returns ExtractedContent with transcript text and isFilePath=false
 * @throws Error if URL invalid, transcript unavailable, or fetch fails
 */
export async function extractYouTube(url: string): Promise<ExtractedContent>;

/**
 * Create upload content from a personal note.
 *
 * @param text - Note text content
 * @returns ExtractedContent with plain text and isFilePath=false
 * @throws Error if text is empty
 */
export function extractNote(text: string): ExtractedContent;
```

**Consumers**: `upload.ts` command handler only. No other module calls extractors directly.

### 11.6 Validation Utilities (`src/utils/validation.ts`)

```typescript
import { Flag, SourceType } from '../types/index.js';

/**
 * List of MIME types supported by the Gemini File Search API.
 */
export const SUPPORTED_MIME_TYPES: string[];

/**
 * Validate that a MIME type is supported for upload.
 *
 * @param mimeType - MIME type string to validate
 * @returns true if supported
 * @throws Error with list of supported types if not supported
 */
export function validateMimeType(mimeType: string): boolean;

/**
 * Validate an ISO 8601 date string (YYYY-MM-DD format).
 *
 * @param dateStr - Date string to validate
 * @returns true if valid
 * @throws Error with format instructions if invalid
 */
export function validateDate(dateStr: string): boolean;

/**
 * Validate one or more flag values.
 *
 * @param flags - Array of flag strings to validate
 * @returns true if all valid
 * @throws Error listing valid flags if any are invalid
 */
export function validateFlags(flags: string[]): flags is Flag[];

/**
 * Validate a workspace name.
 *
 * @param name - Workspace name to validate
 * @returns true if valid
 * @throws Error if name is empty or contains invalid characters
 */
export function validateWorkspaceName(name: string): boolean;

/**
 * Validate a URL string.
 *
 * @param url - URL to validate
 * @returns true if valid HTTP/HTTPS URL
 * @throws Error if invalid
 */
export function validateUrl(url: string): boolean;

/**
 * Validate and extract YouTube video ID from URL.
 *
 * @param url - YouTube URL
 * @returns Video ID string
 * @throws Error if URL is not a valid YouTube video URL
 */
export function extractYouTubeVideoId(url: string): string;
```

### 11.7 Formatting Utilities (`src/utils/format.ts`)

```typescript
import { WorkspaceData, UploadEntry, QueryResult, Citation } from '../types/index.js';

/**
 * Format workspaces as a table for terminal output.
 */
export function formatWorkspaceTable(workspaces: WorkspaceData[]): string;

/**
 * Format uploads as a table with expiration indicators.
 */
export function formatUploadTable(uploads: UploadEntry[]): string;

/**
 * Format a query result with answer and citations.
 */
export function formatQueryResult(result: QueryResult): string;

/**
 * Format workspace info display.
 */
export function formatWorkspaceInfo(workspace: WorkspaceData): string;

/**
 * Get expiration status indicator string.
 *
 * @returns "[EXPIRED]", "[EXPIRING SOON]", or empty string
 */
export function getExpirationIndicator(expirationDate: string | null): string;
```

---

## 12. Integration Points

### 12.1 CLI -> Config

Every command handler begins by calling `loadConfig()`. The config module handles `.env` loading, config file reading, and validation. If config is invalid, the command never reaches the service layer.

### 12.2 CLI -> Registry

Command handlers call registry functions to read/write local state. The registry module is self-contained and performs atomic file I/O. It has no dependency on the Gemini SDK.

### 12.3 CLI -> Content Extractor -> File Search

The upload command calls the content extractor first (pure data transformation), then passes the result to the file search service (API communication). These two services never communicate directly; the command handler is the orchestrator.

### 12.4 File Search Service -> Gemini SDK

The file search service is the only module that interacts with the `@google/genai` SDK. It receives a `GoogleGenAI` instance (created by `gemini-client.ts`) and performs all store, document, and query operations through it.

### 12.5 Query Command -> Registry + File Search

The query command is unique in that it consumes both the file search service (for the Gemini query) and the registry service (for client-side filtering). It cross-references Gemini citation document names with local registry entries.

---

## 13. Implementation Units

These units are designed to be built in parallel by independent developers. Each unit has clear boundaries and interface contracts. No two units modify the same file (except where explicitly noted).

### Unit 1: Types and Validation (Foundation)

**Files owned**: `src/types/index.ts`, `src/utils/validation.ts`

**Dependencies**: None

**Deliverables**:
- All TypeScript interfaces and types as specified in Section 5
- All validation functions as specified in Section 11.6
- Supported MIME types list

**Contract**: Other units import types from `src/types/index.ts` and validators from `src/utils/validation.ts`. These files must be committed first or their interfaces published as a contract document.

---

### Unit 2: Configuration

**Files owned**: `src/config/config.ts`

**Dependencies**: Unit 1 (types: `AppConfig`)

**Deliverables**:
- `loadConfig()` function implementing priority-based loading
- dotenv integration
- Config file reading from `~/.geminirag/config.json`
- Missing value exceptions (no fallbacks)
- API key expiration warning

**Test script**: `test_scripts/test-config.ts`

---

### Unit 3: Local Registry

**Files owned**: `src/services/registry.ts`

**Dependencies**: Unit 1 (types: `Registry`, `WorkspaceData`, `UploadEntry`)

**Deliverables**:
- All registry CRUD functions as specified in Section 11.2
- Atomic write strategy (temp + rename)
- Auto-creation of `~/.geminirag/` directory and empty registry
- Workspace and upload validation (existence checks)

**Test script**: `test_scripts/test-registry.ts`

---

### Unit 4: Gemini Client and File Search Service

**Files owned**: `src/services/gemini-client.ts`, `src/services/file-search.ts`

**Dependencies**: Unit 1 (types), Unit 2 (config for API key)

**Deliverables**:
- `createGeminiClient()` factory function
- Store CRUD operations
- Upload with polling bug #1211 workaround
- Upload with 503 fallback to Files API + Import
- Document deletion with `force: true`
- Query execution with FileSearch tool and metadataFilter
- Citation parsing from grounding metadata
- Document discovery by displayName (for import fallback)

**Test script**: `test_scripts/test-gemini-service.ts`

**Complexity note**: This is the most complex unit. It must implement the upload pipeline algorithm from Section 8.1 and handle all API error scenarios.

---

### Unit 5: Content Extractors

**Files owned**: `src/services/content-extractor.ts`

**Dependencies**: Unit 1 (types: `ExtractedContent`, `SourceType`; validation: `validateMimeType`, `extractYouTubeVideoId`)

**Deliverables**:
- Disk file extractor (validation + path return)
- Web page extractor (fetch + JSDOM + Readability + Turndown)
- YouTube transcript extractor (oEmbed title + youtube-transcript)
- Personal note extractor (title generation algorithm)

**Test script**: `test_scripts/test-extractors.ts`

**Parallelization note**: This unit can be developed simultaneously with Unit 4. They meet only at the command handler level.

---

### Unit 6: Formatting Utilities

**Files owned**: `src/utils/format.ts`

**Dependencies**: Unit 1 (types)

**Deliverables**:
- Workspace table formatter
- Upload table formatter with expiration indicators
- Query result formatter with citations
- Workspace info formatter
- Expiration status calculation

**Note**: This unit is low-risk and can be developed at any time after Unit 1 is complete.

---

### Unit 7: CLI Commands -- Workspace, Upload, Metadata

**Files owned**: `src/commands/workspace.ts`, `src/commands/upload.ts`, `src/commands/metadata.ts`

**Dependencies**: Units 1, 2, 3, 4, 5, 6

**Deliverables**:
- Commander.js command definitions for: `create`, `list`, `delete`, `info`
- Upload command with `--file`, `--url`, `--youtube`, `--note` options
- Metadata commands: `update-title`, `remove`, `set-expiration`, `clear-expiration`, `flag`, `labels`
- Rollback logic for partial upload failures

**Test script**: `test_scripts/test-cli-commands.ts`

---

### Unit 8: CLI Commands -- Query and Listing

**Files owned**: `src/commands/query.ts`, `src/commands/uploads.ts`

**Dependencies**: Units 1, 2, 3, 4, 6

**Deliverables**:
- `ask` command with multi-workspace support and filter parsing
- Dual-layer filter logic (Gemini-side + client-side)
- `uploads` listing command with filters and sorting
- Expiration warnings in listing

**Test scripts**: `test_scripts/test-query.ts`, `test_scripts/test-uploads-listing.ts`

---

### Unit 9: CLI Entry Point

**Files owned**: `src/cli.ts`

**Dependencies**: Units 7, 8 (command handlers)

**Deliverables**:
- Commander.js program setup
- Register all commands from Units 7 and 8
- Global error handler
- API key expiration check on startup

**Note**: This is a thin wiring layer. It can be scaffolded early (Phase 1) and completed after Units 7 and 8.

---

### Unit Dependency Graph

```
Unit 1 (Types + Validation)
    |
    +---> Unit 2 (Config)
    |       |
    +---> Unit 3 (Registry)
    |       |
    +---> Unit 4 (Gemini Client + File Search)
    |       |
    +---> Unit 5 (Content Extractors)
    |       |
    +---> Unit 6 (Formatting)
    |       |
    |       +---+---+---+---+
    |           |           |
    |           v           v
    |     Unit 7 (WS/Upload/Meta)  Unit 8 (Query/Listing)
    |           |                       |
    |           +----------+------------+
    |                      |
    |                      v
    +---> Unit 9 (CLI Entry Point)
```

### Parallel Implementation Plan

| Wave | Units | Can Start After |
|------|-------|-----------------|
| Wave 1 | Unit 1 | Nothing (start immediately) |
| Wave 2 | Units 2, 3, 5, 6 | Unit 1 |
| Wave 3 | Unit 4 | Units 1, 2 |
| Wave 4 | Units 7, 8, 9 | All previous units |

Units 2, 3, 4, 5, and 6 can all be developed in parallel after Unit 1 is committed (Units 2, 3, 5, 6 need only types; Unit 4 also needs config but can mock it during development).

---

## 14. Architectural Decision Records

### ADR-01: Dual-Layer Metadata Architecture

**Decision**: Store immutable metadata (`source_type`, `source_url`) on the Gemini side for query-time filtering; store all metadata (including mutable fields: `title`, `flags`, `expiration_date`) in a local JSON registry.

**Rationale**:
- Gemini custom metadata is immutable after upload (documents cannot be updated)
- `string_list_value` type is not confirmed filterable at query time (research-string-list-filters.md)
- Mutable metadata would require delete + re-upload + re-indexing on every change
- The local registry provides a simple, fast mutable store for single-user use

**Consequences**:
- Client-side filtering for flags and expiration adds a post-processing step to queries
- Local registry is the authoritative metadata store; Gemini metadata is supplementary
- If registry file is lost, mutable metadata is lost (Gemini-side metadata survives)

---

### ADR-02: Upload Pipeline with Two Bug Workarounds

**Decision**: Implement a two-tier upload strategy: (1) check `response.documentName` from the initial `uploadToFileSearchStore` response to bypass polling bug #1211, (2) catch 503 errors and fall back to `files.upload` + `importFile`.

**Rationale**:
- Bug #1211 causes `operations.get()` to return incomplete objects, leading to infinite polling loops
- The initial response from `uploadToFileSearchStore` often contains `documentName` directly
- 503 errors occur for files >10KB; the alternative import pathway is not affected
- Hard timeout (120s) prevents infinite loops in all cases

**Consequences**:
- Upload code is more complex than the documented pattern
- If bug #1211 is fixed, the workaround code is harmless (just an early-exit optimization)
- The import fallback adds latency (~5-10 seconds extra for the two-step process)

---

### ADR-03: Commander.js as CLI Framework

**Decision**: Use Commander.js for CLI argument parsing and command routing.

**Rationale**:
- Zero dependencies, minimal footprint (180KB)
- 18ms startup overhead (fast CLI experience)
- Already used in sibling project (Gitter)
- Well-documented, TypeScript support
- Simple subcommand model maps to `geminirag <command>` pattern

**Consequences**:
- No middleware system (unlike yargs); validation must be done in command handlers
- Variadic argument parsing for `ask` command requires custom handling

---

### ADR-04: JSON File as Local Registry (Not SQLite)

**Decision**: Use a plain JSON file at `~/.geminirag/registry.json` as the local registry.

**Rationale**:
- Single-user tool with at most 10 workspaces and typically <1000 uploads per workspace
- JSON is human-readable and easy to debug
- No additional dependency (SQLite would require native bindings)
- Atomic writes (temp + rename) provide sufficient data safety
- Query complexity is low (no joins, no aggregations)

**Consequences**:
- Performance degrades with very large registries (>10,000 uploads per workspace) -- acceptable given scope
- No concurrent access protection (fine for single-user CLI)
- Full file rewrite on every change (not a concern at expected scale)

---

### ADR-05: No Fallback Values for Configuration

**Decision**: All required configuration settings (`GEMINI_API_KEY`, `GEMINI_MODEL`) must be explicitly provided. Missing values cause descriptive exceptions. No defaults are substituted.

**Rationale**:
- Project convention (CLAUDE.md: "You must never create fallback solutions for configuration settings")
- Prevents silent operation with wrong model or expired key
- Forces explicit user configuration, improving awareness

**Consequences**:
- First-time users must configure the tool before any command works
- Error messages must be highly descriptive (including where to obtain the values)

---

### ADR-06: Blob Upload for In-Memory Content

**Decision**: Use the native `Blob` constructor for in-memory content (web pages, YouTube transcripts, notes) instead of writing temporary files to disk.

**Rationale**:
- The SDK natively accepts `string | globalThis.Blob` for the `file` parameter (research-blob-upload.md)
- Avoids temp file creation, cleanup, and potential permission issues
- Simpler code path with fewer failure modes
- Node.js 18+ provides global `Blob` support

**Consequences**:
- Entire content must fit in memory (acceptable for text content; typical sizes 5KB-500KB)
- MIME type must be set in Blob constructor (self-describing object)

---

### ADR-07: Maximum 10 Workspaces Enforced at Application Level

**Decision**: Enforce a maximum of 10 workspaces with a clear error message, matching the Gemini File Search API's 10-store-per-project limit.

**Rationale**:
- The Gemini API has a hard limit of 10 File Search Stores per project
- Attempting to create an 11th store would produce a cryptic API error
- Application-level enforcement provides a clear, user-friendly error message

**Consequences**:
- Users needing more than 10 workspaces must delete existing ones or use multiple Google Cloud projects
- The limit is documented in CLI help text and error messages

---

### ADR-08: Content Extractors as Pure Functions

**Decision**: Content extractors (web, YouTube, note, disk file) are pure data transformation functions with no Gemini API interaction.

**Rationale**:
- Clean separation of concerns: extraction vs. upload are distinct responsibilities
- Extractors can be tested independently without API keys
- Extractors can be developed in parallel with the Gemini service layer
- Each extractor returns a uniform `ExtractedContent` interface

**Consequences**:
- The command handler is the orchestrator that connects extractors to the upload service
- No coupling between extraction logic and upload logic

---

### ADR-09: Atomic Registry Writes via Temp File + Rename

**Decision**: Registry writes follow the pattern: serialize -> write to `.tmp` file -> rename to `registry.json`.

**Rationale**:
- POSIX rename is atomic; if the process crashes mid-write, the original registry is preserved
- Prevents data corruption from partial writes
- Standard pattern for safe file updates in single-user tools

**Consequences**:
- Slightly more I/O than a direct overwrite (negligible for JSON files of this size)
- The `.tmp` file may be left behind if the process is killed between write and rename (harmless)

---

### ADR-10: API Key Expiration Warning at Startup

**Decision**: Check the optional `GEMINI_API_KEY_EXPIRATION` date at startup (before any command runs) and print a warning to stderr if within 7 days of expiration or already expired.

**Rationale**:
- API keys obtained from Google AI Studio may have expiration dates
- Proactive warning gives users time to renew before the key becomes invalid
- stderr output does not interfere with stdout-based data pipelines

**Consequences**:
- Warning appears on every command invocation when the key is near expiration
- Users who don't set `GEMINI_API_KEY_EXPIRATION` see no warning (field is optional)

---

### ADR-11: `force: true` for All Document and Store Deletions

**Decision**: Always pass `config: { force: true }` when deleting documents and stores via the Gemini SDK.

**Rationale**:
- Without `force: true`, deleting ACTIVE documents may fail silently or return an error (research-sdk-document-api.md)
- Store deletion with `force: true` cascades to all documents in the store
- This is the only reliable deletion pattern confirmed in research

**Consequences**:
- No soft-delete or archival capability (out of scope per spec)
- Deletion is irreversible at the Gemini level

---

### ADR-12: `GoogleGenAI` Instance as Function Parameter (Not Global Singleton)

**Decision**: The file search service receives a `GoogleGenAI` instance as a function parameter rather than importing a global singleton.

**Rationale**:
- Improves testability: tests can inject mock/stub instances
- Avoids module-level side effects from API key loading
- Makes the dependency on the SDK explicit in function signatures
- Follows dependency injection principle

**Consequences**:
- Command handlers must create the client (via `createGeminiClient`) and pass it to service functions
- Slightly more verbose function signatures, but clearer dependency chain

---

## V2 Enhancements Design

**Date**: 2026-04-10
**Version**: 2.0
**Status**: Approved for Implementation
**Specification**: docs/reference/refined-request-v2-enhancements.md
**Implementation Plan**: docs/design/plan-002-v2-enhancements.md
**Investigation**: docs/reference/investigation-v2-enhancements.md

This section extends the v1 design with three features: Full File Retrieval (`get` command), YouTube Channel Scan (`channel-scan` command), and Enhanced YouTube Upload Format (structured Markdown with optional AI notes).

---

### V2.1 New Type Interfaces

All new types are added to `src/types/index.ts`. Existing interfaces are extended in-place; no duplicates.

#### V2.1.1 Extended `AppConfig`

```typescript
export interface AppConfig {
  /** Google Gemini API key (required) */
  geminiApiKey: string;
  /** Gemini model name, e.g. "gemini-2.5-flash" (required) */
  geminiModel: string;
  /** ISO 8601 date for API key expiration (optional) */
  geminiApiKeyExpiration?: string;
  /** YouTube Data API v3 key (required for channel-scan only) */
  youtubeDataApiKey?: string;
  /** ISO 8601 date for YouTube API key expiration (optional) */
  youtubeDataApiKeyExpiration?: string;
}
```

#### V2.1.2 Extended `UploadOptions`

```typescript
export interface UploadOptions {
  file?: string;
  url?: string;
  youtube?: string;
  note?: string;
  /** Enable AI notes generation for YouTube uploads */
  withNotes?: boolean;
}
```

#### V2.1.3 Extended `ExtractedContent`

```typescript
export interface ExtractedContent {
  content: string;
  isFilePath: boolean;
  title: string;
  mimeType: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  /** AI-generated notes (populated when --with-notes is used on YouTube content) */
  notes?: string;
}
```

#### V2.1.4 Extended `UploadEntry`

```typescript
export interface UploadEntry {
  id: string;
  documentName: string;
  title: string;
  timestamp: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  expirationDate: string | null;
  flags: Flag[];
  /** First N characters of content (used by get command display); populated on new uploads */
  contentPreview?: string;
}
```

#### V2.1.5 `YouTubeVideoMetadata` (NEW)

Represents metadata for a single YouTube video, as returned by the YouTube Data API v3 `playlistItems.list` and `videos.list` endpoints.

```typescript
export interface YouTubeVideoMetadata {
  /** YouTube video ID (e.g., "dQw4w9WgXcQ") */
  videoId: string;
  /** Video title */
  title: string;
  /** ISO 8601 datetime of video publication */
  publishedAt: string;
  /** Channel display name */
  channelTitle: string;
  /** Full YouTube video URL (https://www.youtube.com/watch?v=<videoId>) */
  videoUrl: string;
  /** ISO 8601 duration (e.g., "PT15M32S"); populated by fetchVideoDurations() */
  duration?: string;
}
```

#### V2.1.6 `ChannelScanOptions` (NEW)

CLI options parsed from the `channel-scan` command.

```typescript
export interface ChannelScanOptions {
  /** YouTube channel identifier: @handle, UCxxxxxx, or full URL */
  channel: string;
  /** Inclusive start date (YYYY-MM-DD) */
  from: string;
  /** Inclusive end date (YYYY-MM-DD) */
  to: string;
  /** Generate AI notes for each video */
  withNotes?: boolean;
  /** Maximum number of videos to process */
  maxVideos?: number;
  /** List videos without uploading */
  dryRun?: boolean;
  /** Skip failed videos instead of stopping */
  continueOnError?: boolean;
}
```

#### V2.1.7 `ChannelScanResult` (NEW)

Summary counters for a completed (or partially completed) channel scan.

```typescript
export interface ChannelScanResult {
  /** Total videos attempted */
  processed: number;
  /** Successfully uploaded */
  uploaded: number;
  /** Skipped (no transcript, disabled captions, etc.) */
  skipped: number;
  /** Failed (upload error, rate limit exhausted, etc.) */
  failed: number;
}
```

#### V2.1.8 `NotesContent` (NEW)

Structured representation of AI-generated notes before Markdown rendering.

```typescript
export interface NotesContent {
  /** 2-3 sentence summary */
  summary: string;
  /** Bulleted key points */
  keyPoints: string[];
  /** Term/concept definitions */
  importantTerms: Array<{ term: string; context: string }>;
  /** Action items (may be empty) */
  actionItems: string[];
  /** Raw Markdown output from the model (used directly if structured parsing fails) */
  rawMarkdown: string;
}
```

---

### V2.2 New Services

#### V2.2.1 `src/services/youtube-data-api.ts` (NEW)

All YouTube Data API v3 interactions via direct `fetch` to REST endpoints. No `googleapis` package dependency. Three main functions plus helpers.

**Design decisions**: Uses `playlistItems.list` (1 quota unit per call, no 500-video cap) instead of `search.list` (100 units per call, 500-video cap). Date filtering is client-side. Handle resolution and uploads playlist ID retrieval are combined into a single `channels.list` call.

##### `ResolvedChannel` Interface (internal to this module)

```typescript
export interface ResolvedChannel {
  channelId: string;
  channelTitle: string;
  uploadsPlaylistId: string;
}
```

##### `resolveChannel(apiKey, identifier)`

Resolves any channel identifier format to a `ResolvedChannel`.

**Input parsing logic**:
1. If input starts with `UC` and is 24 characters: raw channel ID. Call `channels.list?part=id,snippet,contentDetails&id=<channelId>`.
2. If input is a URL containing `/@`: extract handle after `/@` (strip trailing path segments).
3. If input is a URL containing `/channel/UC`: extract the 24-character channel ID.
4. If input starts with `@`: use as handle directly.
5. Otherwise: try as handle (prepend `@` if needed).

For handles: call `channels.list?part=id,snippet,contentDetails&forHandle=<handle>`.

**API call**:
```
GET https://www.googleapis.com/youtube/v3/channels
  ?part=id,snippet,contentDetails
  &forHandle=<handle>   (or &id=<channelId>)
  &key=<apiKey>
```

**Returns**: `{ channelId, channelTitle, uploadsPlaylistId }` extracted from `items[0].id`, `items[0].snippet.title`, and `items[0].contentDetails.relatedPlaylists.uploads`.

**Throws**: `"Channel not found for identifier '<identifier>'"` if `items` is empty.

**Quota cost**: 1 unit.

##### `listChannelVideos(apiKey, uploadsPlaylistId, fromDate, toDate, maxVideos?)`

Paginates through the uploads playlist, applies client-side date filtering, enriches with durations.

**Algorithm**:
1. Initialize `pageToken = undefined`, `videos: YouTubeVideoMetadata[] = []`.
2. Loop:
   a. Call `playlistItems.list?part=snippet,contentDetails&playlistId=<id>&maxResults=50&pageToken=<token>&key=<apiKey>`.
   b. For each item in `items[]`:
      - Skip if `snippet.title === "Private video"` or `"Deleted video"`.
      - Extract `publishedAt` from `contentDetails.videoPublishedAt`.
      - Client-side date filter: include if `publishedAt >= fromDate` AND `publishedAt < toDate + 1 day` (to make `toDate` inclusive).
      - Build `YouTubeVideoMetadata` with `videoId` from `snippet.resourceId.videoId`, `title` from `snippet.title`, `channelTitle` from `snippet.videoOwnerChannelTitle`, `videoUrl` as `https://www.youtube.com/watch?v=${videoId}`.
   c. Set `pageToken = response.nextPageToken`. If absent, stop.
3. Sort `videos` by `publishedAt` ascending (chronological order).
4. Truncate to `maxVideos` if specified.
5. Call `fetchVideoDurations(apiKey, videos.map(v => v.videoId))` and enrich each video with its duration.
6. Return `videos`.

**Quota cost**: 1 unit per page (ceil(totalPlaylistItems / 50)) + ceil(matchedVideos / 50) for duration enrichment.

##### `fetchVideoDurations(apiKey, videoIds)`

Fetches durations in batches of 50 video IDs.

**API call per batch**:
```
GET https://www.googleapis.com/youtube/v3/videos
  ?part=contentDetails
  &id=<comma-separated-ids>
  &key=<apiKey>
```

**Returns**: `Map<string, string>` mapping videoId to ISO 8601 duration (e.g., `"PT15M32S"`).

**Quota cost**: 1 unit per batch of 50.

##### `formatDuration(isoDuration)`

Converts ISO 8601 duration to human-readable format.

```typescript
export function formatDuration(isoDuration: string): string {
  // "PT1H15M32S" -> "1:15:32"
  // "PT15M32S" -> "15:32"
  // "PT32S" -> "0:32"
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;
  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
```

##### `estimateQuotaUsage(totalPlaylistItems, matchedVideos)`

```typescript
export function estimateQuotaUsage(totalPlaylistItems: number, matchedVideos: number): number {
  const channelResolve = 1;            // channels.list
  const playlistPages = Math.ceil(totalPlaylistItems / 50);  // playlistItems.list
  const durationBatches = Math.ceil(matchedVideos / 50);     // videos.list
  return channelResolve + playlistPages + durationBatches;
}
```

##### Error Handling

All `fetch` calls check `response.ok`. On non-200 responses, parse the JSON error body and throw descriptive errors:

| Condition | Error Message |
|-----------|---------------|
| HTTP 400 (bad request) | `"YouTube API error: <error.message>"` |
| HTTP 403 (forbidden/quota exceeded) | `"YouTube API quota exceeded or API key invalid. Check your YOUTUBE_DATA_API_KEY and quota at https://console.cloud.google.com/"` |
| HTTP 404 (not found) | `"Channel not found for identifier '<identifier>'"` |
| Network error | `"Failed to connect to YouTube Data API: <error>"` |

---

#### V2.2.2 `src/services/notes-generator.ts` (NEW)

Generates AI-powered structured notes from a YouTube video transcript using Gemini `generateContent`.

##### `generateNotes(ai, model, title, transcript)`

```typescript
import { GoogleGenAI } from '@google/genai';

/**
 * Generate structured notes from a YouTube video transcript.
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name (e.g., "gemini-2.5-flash")
 * @param title - Video title (for context in the prompt)
 * @param transcript - Full transcript text
 * @returns Markdown-formatted notes string
 * @throws Error if generation fails
 */
export async function generateNotes(
  ai: GoogleGenAI,
  model: string,
  title: string,
  transcript: string
): Promise<string>;
```

**Prompt**:
```
Analyze the following transcript from a YouTube video titled "<title>" and generate structured notes in Markdown format.

Include the following sections:
1. **Summary**: A brief 2-3 sentence summary of the video content.
2. **Key Points**: A bulleted list of the main points discussed.
3. **Important Terms and Concepts**: Key terminology or concepts mentioned, with brief context.
4. **Action Items and Recommendations**: Any actionable advice or recommendations mentioned (omit this section if none are present).

Transcript:
<transcript>
```

**Implementation**:
```typescript
export async function generateNotes(
  ai: GoogleGenAI,
  model: string,
  title: string,
  transcript: string
): Promise<string> {
  const prompt = `Analyze the following transcript from a YouTube video titled "${title}" and generate structured notes in Markdown format.

Include the following sections:
1. **Summary**: A brief 2-3 sentence summary of the video content.
2. **Key Points**: A bulleted list of the main points discussed.
3. **Important Terms and Concepts**: Key terminology or concepts mentioned, with brief context.
4. **Action Items and Recommendations**: Any actionable advice or recommendations mentioned (omit this section if none are present).

Transcript:
${transcript}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const notes = response.text ?? '';
  if (!notes.trim()) {
    throw new Error('Notes generation returned empty response');
  }

  return notes;
}
```

**Token considerations**: Input is the full transcript (typically 2,000-15,000 tokens for a 10-60 minute video). Output is 200-500 tokens. Gemini 2.5 Flash supports 1M tokens input, so no practical transcript exceeds this.

---

### V2.3 Modified Services

#### V2.3.1 `src/services/content-extractor.ts` -- Modifications

##### Dependency Swap: `youtube-transcript` to `youtube-transcript-plus`

**Current** (line 9-10):
```typescript
const require = createRequire(import.meta.url);
const { YoutubeTranscript } = require('youtube-transcript') as {
  YoutubeTranscript: { fetchTranscript: (videoId: string) => Promise<Array<{ text: string }>> }
};
```

**New**:
```typescript
const require = createRequire(import.meta.url);
const { fetchTranscript } = require('youtube-transcript-plus') as {
  fetchTranscript: (videoId: string, options?: {
    retries?: number;
    retryDelay?: number;
  }) => Promise<Array<{ text: string; offset: number; duration: number }>>
};
```

Key change: `youtube-transcript-plus` exports `fetchTranscript` as a named function (not a class method). The type cast now includes `offset` and `duration` fields needed for the paragraph break algorithm.

##### New Interface: `YouTubeExtractOptions`

```typescript
export interface YouTubeExtractOptions {
  /** Pre-fetched metadata (from channel scan); skips oEmbed call when provided */
  metadata?: YouTubeVideoMetadata;
  /** Whether to generate AI notes */
  withNotes?: boolean;
  /** GoogleGenAI instance (required when withNotes is true) */
  ai?: GoogleGenAI;
  /** Model name (required when withNotes is true) */
  model?: string;
}
```

##### New Internal Function: `buildTranscriptWithParagraphs()`

Inserts paragraph breaks at points where the gap between transcript segments exceeds 2 seconds.

```typescript
function buildTranscriptWithParagraphs(
  items: Array<{ text: string; offset: number; duration: number }>,
  pauseThresholdSeconds: number = 2.0
): string {
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (let i = 0; i < items.length; i++) {
    currentParagraph.push(items[i].text);

    if (i < items.length - 1) {
      const currentEnd = items[i].offset + items[i].duration;
      const nextStart = items[i + 1].offset;
      const gap = nextStart - currentEnd;

      if (gap > pauseThresholdSeconds) {
        paragraphs.push(currentParagraph.join(' '));
        currentParagraph = [];
      }
    }
  }

  // Flush remaining text
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '));
  }

  return paragraphs.join('\n\n');
}
```

**Algorithm**: Iterate through transcript segments. For each segment, check the gap between its end (`offset + duration`) and the next segment's start (`offset`). If the gap exceeds 2 seconds, close the current paragraph and start a new one. Join paragraphs with double newlines.

##### New Exported Function: `extractYouTubeEnhanced()`

The primary YouTube extraction function for v2. Used by both single-video upload and channel scan.

```typescript
/**
 * Extract YouTube content in enhanced Markdown format.
 * Produces structured Markdown with video URL, metadata header,
 * paragraph-broken transcript, and optional AI-generated notes.
 *
 * @param url - YouTube video URL
 * @param options - Optional extraction options (metadata, notes config)
 * @returns ExtractedContent with Markdown content and mimeType 'text/markdown'
 */
export async function extractYouTubeEnhanced(
  url: string,
  options?: YouTubeExtractOptions
): Promise<ExtractedContent>;
```

**Implementation logic**:

1. **Resolve metadata**:
   - If `options.metadata` is provided (channel-scan path): use it directly. Skip oEmbed.
   - If not provided (single-video upload path): call oEmbed for title. Published date and channel name are best-effort (oEmbed provides `author_name` for channel).

2. **Fetch transcript**:
   ```typescript
   const videoId = extractYouTubeVideoId(url);
   const transcriptItems = await fetchTranscript(videoId, {
     retries: 3,
     retryDelay: 1000,
   });
   ```

3. **Build paragraph-broken transcript**:
   ```typescript
   const transcript = buildTranscriptWithParagraphs(transcriptItems);
   ```

4. **Build structured Markdown**:
   ```markdown
   # <Video Title>

   **Source:** <YouTube Video URL>
   **Published:** <Publish Date, if available>
   **Channel:** <Channel Name, if available>

   ---

   ## Transcript

   <paragraph-broken transcript>
   ```

5. **Generate notes** (if `options.withNotes` is true):
   ```typescript
   if (options?.withNotes && options.ai && options.model) {
     try {
       const notesMarkdown = await generateNotes(
         options.ai, options.model, title, transcript
       );
       // Append to content:
       content += '\n\n---\n\n## Notes\n\n' + notesMarkdown;
     } catch (error) {
       console.warn(
         `Warning: Notes generation failed for "${title}". Uploading without notes.`
       );
     }
   }
   ```

6. **Return**:
   ```typescript
   return {
     content,
     isFilePath: false,
     title,
     mimeType: 'text/markdown',  // Changed from 'text/plain'
     sourceType: 'youtube',
     sourceUrl: url,
     notes: notesMarkdown,  // Optional, if generated
   };
   ```

##### Modified `extractYouTube()` -- Backward Compatibility

The existing `extractYouTube()` function is refactored to delegate to `extractYouTubeEnhanced()`:

```typescript
export async function extractYouTube(url: string): Promise<ExtractedContent> {
  return extractYouTubeEnhanced(url);
}
```

This preserves the existing function signature. The output format changes from plain text to structured Markdown, and the MIME type changes from `text/plain` to `text/markdown`. This is an intentional breaking change for new uploads (existing uploads are not affected).

---

#### V2.3.2 `src/services/file-search.ts` -- Additions

##### New Exported Function: `getDocumentContent()`

Retrieves document content from a File Search Store using model-based retrieval with a verbatim-reproduction prompt and File Search grounding.

```typescript
/**
 * Retrieve document content from a File Search Store using model-based retrieval.
 * Uses generateContent with a verbatim-reproduction prompt and File Search grounding.
 *
 * Limitations:
 * - Long documents may be truncated by the model's output token limit (~65,536 tokens)
 * - Content may not be 100% verbatim (minor formatting differences possible)
 * - Binary files (PDF, images) cannot be faithfully reproduced
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name
 * @param storeName - File Search Store resource name
 * @param documentDisplayName - Document display name to retrieve
 * @returns Document content as a string
 * @throws Error if retrieval fails or returns empty
 */
export async function getDocumentContent(
  ai: GoogleGenAI,
  model: string,
  storeName: string,
  documentDisplayName: string
): Promise<string> {
  const prompt =
    `Return the complete, verbatim content of the document titled "${documentDisplayName}" ` +
    `without any summarization, modification, commentary, or formatting changes. ` +
    `Reproduce the document exactly as it was uploaded, including all sections and text.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{
        fileSearch: {
          fileSearchStoreNames: [storeName],
        },
      } as any],
    },
  });

  const content = response.text ?? '';
  if (!content.trim()) {
    throw new Error(
      `Failed to retrieve content for document '${documentDisplayName}': ` +
      `model returned empty response. The document may be too large or in a binary format.`
    );
  }

  return content;
}
```

**Design Decision (ADR-13)**: The Gemini SDK does not expose a method to download document content from a File Search Store. The `get` command uses `ai.models.generateContent()` with a verbatim-reproduction prompt and File Search grounding. This is best-effort: long documents may be truncated by the model's output token limit (~65,536 tokens for gemini-2.5-flash), and minor formatting differences are possible.

---

### V2.4 New Commands

#### V2.4.1 `src/commands/get.ts` (NEW)

Full file retrieval command. Retrieves and displays the complete content of a previously uploaded document.

**Command registration**:
```
geminirag get <workspace> <upload-id>
  --output <path>    Write content to a file instead of stdout
  --raw              Output raw content without metadata header
```

**Export**: `registerGetCommand(program: Command): void`

**Action handler logic**:

```
1. loadConfig() -> config
2. getWorkspace(workspace) -> workspaceData
3. Look up UploadEntry by upload-id in workspaceData.uploads
   - If not found: throw "Upload '<id>' not found in workspace '<name>'"
4. createGeminiClient(config) -> ai
5. getDocumentContent(ai, config.geminiModel, workspaceData.storeName, entry.title) -> content
6. If NOT --raw:
   - Prepend metadata header (see format below)
7. If --output:
   - Write to file using fs.writeFileSync
   - Print: "Content written to <path>"
8. Else:
   - Print content to stdout
```

**Metadata header format** (prepended when `--raw` is not specified):

```
=== Upload Metadata ===
Title:       <entry.title>
ID:          <entry.id>
Source Type: <entry.sourceType>
Source URL:  <entry.sourceUrl or "N/A">
Uploaded:    <entry.timestamp>
Expiration:  <entry.expirationDate or "None">
Flags:       <entry.flags.join(', ') or "None">
Document:    <entry.documentName>

=== Content ===
```

**Header formatting function**: Added to `src/utils/format.ts` as `formatUploadMetadataHeader(entry: UploadEntry): string`.

---

#### V2.4.2 `src/commands/channel-scan.ts` (NEW)

Scans a YouTube channel, collects videos in a date range, and bulk-uploads their transcripts to a workspace.

**Command registration**:
```
geminirag channel-scan <workspace>
  --channel <identifier>   YouTube channel (handle, URL, or ID)
  --from <date>            Start date (YYYY-MM-DD), inclusive
  --to <date>              End date (YYYY-MM-DD), inclusive
  --with-notes             Generate AI notes for each video
  --max-videos <n>         Maximum number of videos to process
  --dry-run                List videos without uploading
  --continue-on-error      Skip failed videos instead of stopping
```

**Export**: `registerChannelScanCommand(program: Command): void`

**Action handler orchestration** (detailed pseudocode):

```
1.  loadConfig() -> config
2.  Validate YOUTUBE_DATA_API_KEY is present:
      if (!config.youtubeDataApiKey) {
        throw new Error(
          "YOUTUBE_DATA_API_KEY is required for channel scanning. " +
          "Obtain it from https://console.cloud.google.com/ by enabling the " +
          "YouTube Data API v3 and creating an API key."
        );
      }
3.  Validate --from and --to dates using validateDate()
4.  Validate --from <= --to
5.  getWorkspace(workspace) -> workspaceData
6.  createGeminiClient(config) -> ai

7.  resolveChannel(config.youtubeDataApiKey, options.channel)
    -> { channelId, channelTitle, uploadsPlaylistId }

8.  listChannelVideos(
      config.youtubeDataApiKey, uploadsPlaylistId,
      options.from, options.to, options.maxVideos
    ) -> videos: YouTubeVideoMetadata[]

9.  Print summary header:
      "Found <N> videos in channel "<channelTitle>" between <from> and <to>"
    Print video table:
      # | Published    | Title                           | Duration
      1 | 2026-01-05   | Introduction to RAG Systems     | 15:32
      2 | 2026-01-12   | Vector Databases Explained      | 22:10
      ...

10. If --dry-run: print "Dry run complete. No videos were uploaded." and stop.

11. Print estimated quota usage.

12. Initialize counters: { processed: 0, uploaded: 0, skipped: 0, failed: 0 }

13. For each video (index i, chronological order):
      a. If i > 0: apply delay with jitter
           const baseDelay = 1500; // 1.5 seconds
           const jitter = Math.random() * 1000 - 500; // +/- 500ms
           await sleep(baseDelay + jitter);

      b. processed++

      c. Try:
           // Extract content in enhanced Markdown format
           const extracted = await extractYouTubeEnhanced(video.videoUrl, {
             metadata: video,
             withNotes: options.withNotes,
             ai: options.withNotes ? ai : undefined,
             model: options.withNotes ? config.geminiModel : undefined,
           });

           // Build custom metadata
           const customMetadata: CustomMetadataEntry[] = [
             { key: 'source_type', stringValue: 'youtube' },
             { key: 'source_url', stringValue: video.videoUrl },
           ];

           // Upload to Gemini File Search Store
           const documentName = await uploadContent(
             ai, workspaceData.storeName, extracted.content,
             false, 'text/markdown', extracted.title, customMetadata
           );

           // Register in local registry
           const uploadId = uuidv4();
           const entry: UploadEntry = {
             id: uploadId,
             documentName,
             title: extracted.title,
             timestamp: new Date().toISOString(),
             sourceType: 'youtube',
             sourceUrl: video.videoUrl,
             expirationDate: null,
             flags: [],
           };
           addUpload(workspace, entry);

           // Progress output
           console.log(`[${i + 1}/${videos.length}] Uploaded: "${video.title}" (ID: ${uploadId})`);
           uploaded++;

      d. Catch (error):
           // Classify error
           if (isTranscriptUnavailable(error)):
             if (options.continueOnError):
               console.warn(`[${i + 1}/${videos.length}] Skipped: "${video.title}" -- transcript not available`);
               skipped++;
             else:
               console.error(`Error: Transcript not available for "${video.title}"`);
               printPartialSummary(result, videos.length);
               process.exit(1);

           else if (isRateLimited(error)):
             // Pause 60 seconds and retry once
             console.warn(`Rate limited. Pausing for 60 seconds...`);
             await sleep(60_000);
             try:
               // Retry the same video
               ... (same extraction + upload logic)
               uploaded++;
             catch (retryError):
               if (options.continueOnError):
                 console.warn(`[${i + 1}/${videos.length}] Failed: "${video.title}" -- rate limited after retry`);
                 failed++;
               else:
                 printPartialSummary(result, videos.length);
                 process.exit(1);

           else:
             if (options.continueOnError):
               console.warn(`[${i + 1}/${videos.length}] Failed: "${video.title}" -- ${error.message}`);
               failed++;
             else:
               console.error(`Error processing "${video.title}": ${error.message}`);
               printPartialSummary(result, videos.length);
               process.exit(1);

14. Print final summary:
      "Channel scan complete."
      "Processed: <processed>/<total> videos"
      "Uploaded:  <uploaded>"
      "Skipped:   <skipped> (no transcript)"
      "Failed:    <failed> (upload errors)"
```

**Error classification helpers** (internal to `channel-scan.ts`):

```typescript
function isTranscriptUnavailable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('transcript not available') ||
           msg.includes('transcript is empty') ||
           msg.includes('transcripts disabled') ||
           msg.includes('no transcript');
  }
  return false;
}

function isRateLimited(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('too many requests') ||
           msg.includes('rate limit') ||
           msg.includes('429');
  }
  return false;
}
```

---

### V2.5 Modified Commands

#### V2.5.1 `src/commands/upload.ts` -- Modifications

1. **New option**: `.option('--with-notes', 'Generate AI notes for YouTube uploads')`

2. **`UploadOptions` usage**: The `withNotes` field is read from parsed options.

3. **YouTube branch change**: When `options.youtube` is set:
   ```typescript
   if (options.youtube) {
     extractYouTubeVideoId(options.youtube); // validates URL
     extracted = await extractYouTubeEnhanced(options.youtube, {
       withNotes: options.withNotes,
       ai: options.withNotes ? ai : undefined,
       model: options.withNotes ? config.geminiModel : undefined,
     });
   }
   ```

4. **Validation**: If `--with-notes` is used without `--youtube`, print warning:
   ```
   Warning: --with-notes is only applicable to YouTube uploads. Flag ignored.
   ```

---

### V2.6 Config Changes

#### `src/config/config.ts` -- Modifications

Two new optional fields are loaded alongside existing config:

```typescript
// After existing Gemini key resolution block:
const youtubeDataApiKey = process.env.YOUTUBE_DATA_API_KEY ?? fileConfig.YOUTUBE_DATA_API_KEY;
const youtubeDataApiKeyExpiration =
  process.env.YOUTUBE_DATA_API_KEY_EXPIRATION ?? fileConfig.YOUTUBE_DATA_API_KEY_EXPIRATION;

// YouTube API key expiration warning (same pattern as Gemini key)
if (youtubeDataApiKeyExpiration) {
  const now = new Date();
  const ytExpDate = new Date(youtubeDataApiKeyExpiration);
  const msPerDay = 24 * 60 * 60 * 1000;
  const ytDaysUntilExpiry = Math.ceil((ytExpDate.getTime() - now.getTime()) / msPerDay);
  if (ytDaysUntilExpiry <= 0) {
    console.warn('WARNING: YOUTUBE_DATA_API_KEY has expired! Renew at https://console.cloud.google.com/');
  } else if (ytDaysUntilExpiry <= 7) {
    console.warn(`WARNING: YOUTUBE_DATA_API_KEY expires in ${ytDaysUntilExpiry} day(s). Renew at https://console.cloud.google.com/`);
  }
}
```

Include in returned `AppConfig`:
```typescript
const config: AppConfig = {
  geminiApiKey,
  geminiModel,
};
if (geminiApiKeyExpiration) config.geminiApiKeyExpiration = geminiApiKeyExpiration;
if (youtubeDataApiKey) config.youtubeDataApiKey = youtubeDataApiKey;
if (youtubeDataApiKeyExpiration) config.youtubeDataApiKeyExpiration = youtubeDataApiKeyExpiration;
return config;
```

**Lazy validation**: `YOUTUBE_DATA_API_KEY` is NOT validated at config load time. It is only validated when `channel-scan` command is invoked. The error message includes instructions for obtaining the key.

**Config file format** (`~/.geminirag/config.json`):
```json
{
  "GEMINI_API_KEY": "AIza...",
  "GEMINI_MODEL": "gemini-2.5-flash",
  "GEMINI_API_KEY_EXPIRATION": "2026-07-01",
  "YOUTUBE_DATA_API_KEY": "AIza...",
  "YOUTUBE_DATA_API_KEY_EXPIRATION": "2026-07-01"
}
```

---

### V2.7 CLI Entry Point Changes (`src/cli.ts`)

Two new command registrations:

```typescript
import { registerGetCommand } from './commands/get.js';
import { registerChannelScanCommand } from './commands/channel-scan.js';
// ...
registerGetCommand(program);
registerChannelScanCommand(program);
```

Updated version:
```typescript
program.version('2.0.0');
```

---

### V2.8 Formatting Utilities (`src/utils/format.ts`) -- Additions

Three new exported functions:

#### `formatUploadMetadataHeader(entry: UploadEntry): string`

Formats the metadata header for the `get` command output.

```typescript
export function formatUploadMetadataHeader(entry: UploadEntry): string {
  const lines = [
    '=== Upload Metadata ===',
    `Title:       ${entry.title}`,
    `ID:          ${entry.id}`,
    `Source Type: ${entry.sourceType}`,
    `Source URL:  ${entry.sourceUrl ?? 'N/A'}`,
    `Uploaded:    ${entry.timestamp}`,
    `Expiration:  ${entry.expirationDate ?? 'None'}`,
    `Flags:       ${entry.flags.length > 0 ? entry.flags.join(', ') : 'None'}`,
    `Document:    ${entry.documentName}`,
    '',
    '=== Content ===',
  ];
  return lines.join('\n');
}
```

#### `formatChannelScanTable(videos: YouTubeVideoMetadata[]): string`

Formats the video listing table for channel scan display.

```typescript
export function formatChannelScanTable(videos: YouTubeVideoMetadata[]): string {
  const headers = ['#', 'Published', 'Title', 'Duration'];
  const rows = videos.map((v, i) => [
    String(i + 1),
    v.publishedAt.slice(0, 10),
    truncate(v.title, 45),
    v.duration ? formatDuration(v.duration) : '??:??',
  ]);
  return buildTable(headers, rows);
}
```

Note: `formatDuration` is imported from `src/services/youtube-data-api.ts` or duplicated as a utility. To avoid a cross-layer import (format utility importing from service), the `formatDuration` helper is also exported from `format.ts`.

#### `formatChannelScanSummary(result: ChannelScanResult, total: number): string`

```typescript
export function formatChannelScanSummary(result: ChannelScanResult, total: number): string {
  return [
    'Channel scan complete.',
    `Processed: ${result.processed}/${total} videos`,
    `Uploaded:  ${result.uploaded}`,
    `Skipped:   ${result.skipped} (no transcript)`,
    `Failed:    ${result.failed} (upload errors)`,
  ].join('\n');
}
```

---

### V2.9 Key Algorithms

#### V2.9.1 Paragraph Break Algorithm

**Purpose**: Insert paragraph breaks at natural pause points in YouTube transcripts.

**Input**: Array of transcript segments, each with `{ text, offset, duration }` where `offset` and `duration` are in seconds.

**Algorithm**:
```
FOR each segment i:
  1. Append segment.text to current paragraph buffer.
  2. IF i < last segment:
     a. Compute gap = segments[i+1].offset - (segments[i].offset + segments[i].duration)
     b. IF gap > 2.0 seconds:
        - Flush current paragraph buffer (join with spaces)
        - Start new paragraph buffer
3. Flush remaining buffer.
4. Join paragraphs with "\n\n" (double newline).
```

**Threshold**: 2 seconds (as specified in refined-request-v2-enhancements.md Section 4.3). This is a constant, not configurable.

**Edge cases**:
- If all gaps are <= 2s: result is a single paragraph (acceptable; indicates continuous speech).
- If transcript has a single segment: result is that segment as a single paragraph.
- Negative gaps (overlapping segments): treated as 0 gap, no paragraph break.

#### V2.9.2 Channel Scan Orchestration Loop

**Purpose**: Process videos sequentially with rate limiting, error handling, and progress reporting.

**Rate limiting strategy**:
- Base delay: 1.5 seconds between transcript fetches
- Jitter: +/- 500ms random (1.0-2.0 second effective range)
- Applied between completed fetches (not as a fixed timer)
- Skip delay before the first video
- If rate-limited after retries exhausted: pause for 60 seconds, retry once

**Progress output format**:
```
[1/24] Uploaded: "Introduction to RAG Systems" (ID: abc12345)
[2/24] Skipped: "Private Stream Recording" -- transcript not available
[3/24] Failed: "Live Q&A Session" -- upload error: 503 Service Unavailable
```

**Summary output format**:
```
Channel scan complete.
Processed: 22/24 videos
Uploaded:  20
Skipped:   2 (no transcript)
Failed:    2 (upload errors)
```

#### V2.9.3 Document Content Retrieval via Model Query

**Purpose**: Retrieve the full content of an uploaded document from a File Search Store.

**Approach**: Use `ai.models.generateContent()` with a verbatim-reproduction prompt and File Search grounding tool. The model retrieves relevant chunks via grounding and reproduces the document.

**Prompt**: "Return the complete, verbatim content of the document titled '<displayName>' without any summarization, modification, commentary, or formatting changes. Reproduce the document exactly as it was uploaded, including all sections and text."

**Limitations**:
- Output token limit (~65,536 tokens for gemini-2.5-flash) may truncate long documents
- Content may not be 100% verbatim (minor formatting differences possible)
- Binary files (PDF, images) cannot be faithfully reproduced
- Each retrieval costs Gemini API tokens (both input from grounding and output)

**Truncation detection heuristic**: If the response length is close to the model's output token limit or ends abruptly (no closing section marker), print a warning: `"Warning: The retrieved content may be truncated. Long documents may exceed the model's output token limit."`.

---

### V2.10 Implementation Units for Parallel Agents

Each unit has exclusive file ownership to prevent merge conflicts. Dependencies between units are defined clearly.

#### Unit V2-A: Foundation (Types, Config, Dependency Swap)

**Files owned (modifications only)**:
- `src/types/index.ts` -- Extend `AppConfig`, `UploadOptions`, `ExtractedContent`, `UploadEntry`; add `YouTubeVideoMetadata`, `ChannelScanOptions`, `ChannelScanResult`, `NotesContent`
- `src/config/config.ts` -- Load `YOUTUBE_DATA_API_KEY` and expiration; add warning
- `package.json` -- Swap `youtube-transcript` to `youtube-transcript-plus`; bump version
- `src/services/content-extractor.ts` -- **Import line only** (lines 9-10): swap import and expand type cast

**Dependencies**: None (start immediately)

**Test script**: `test_scripts/test-config-v2.ts`

---

#### Unit V2-B: Enhanced YouTube Format + Notes Generator

**Files owned**:
- `src/services/notes-generator.ts` (NEW)
- `src/services/content-extractor.ts` (bulk modifications: `buildTranscriptWithParagraphs()`, `extractYouTubeEnhanced()`, refactored `extractYouTube()`)
- `src/commands/upload.ts` (add `--with-notes` option, route to `extractYouTubeEnhanced`)

**Dependencies**: Unit V2-A (types and dependency swap must be committed first)

**Test script**: `test_scripts/test-youtube-enhanced.ts`

---

#### Unit V2-C: Get Command + Document Retrieval

**Files owned**:
- `src/commands/get.ts` (NEW)
- `src/services/file-search.ts` (add `getDocumentContent()`)
- `src/utils/format.ts` (add `formatUploadMetadataHeader()`)
- `src/cli.ts` (add `get` command registration -- single line addition)

**Dependencies**: Unit V2-A (types only)

**Can run in parallel with**: Units V2-B and V2-D (no file overlap)

**Test script**: `test_scripts/test-get-command.ts`

---

#### Unit V2-D: YouTube Data API Service

**Files owned**:
- `src/services/youtube-data-api.ts` (NEW)

**Dependencies**: Unit V2-A (types: `YouTubeVideoMetadata`)

**Can run in parallel with**: Units V2-B and V2-C (no file overlap)

**Test script**: `test_scripts/test-youtube-data-api.ts`

---

#### Unit V2-E: Channel Scan Command

**Files owned**:
- `src/commands/channel-scan.ts` (NEW)
- `src/utils/format.ts` (add `formatChannelScanTable()`, `formatChannelScanSummary()`, `formatDuration()`)
- `src/cli.ts` (add `channel-scan` command registration -- single line addition)

**Dependencies**: Units V2-A, V2-B, V2-D (needs types, enhanced extractor, and YouTube Data API service)

**Test script**: `test_scripts/test-channel-scan.ts`

---

#### Unit V2-F: Integration, Testing, and Documentation

**Files owned**:
- `CLAUDE.md` (update tool documentation)
- `docs/design/configuration-guide.md` (add YouTube Data API key docs)
- `Issues - Pending Items.md` (add known limitations)

**Dependencies**: All other units must be complete.

---

#### Dependency Graph (V2 Units)

```
Unit V2-A (Foundation)
  |
  +----> Unit V2-B (Enhanced YouTube Format)  ----+
  |                                                |
  +----> Unit V2-C (Get Command)  ----+            |
  |                                    |            |
  +----> Unit V2-D (YouTube Data API) -+----> Unit V2-E (Channel Scan)
                                       |            |
                                       +----+-------+
                                            |
                                            v
                                       Unit V2-F (Integration)
```

#### Parallelization Summary

| Can Run in Parallel | Justification |
|---------------------|---------------|
| V2-B + V2-C + V2-D | All depend only on V2-A; modify different files with no overlap |

| Must Wait For | Before Starting |
|---------------|-----------------|
| V2-A | V2-B, V2-C, V2-D |
| V2-A + V2-B + V2-D | V2-E (needs enhanced extractor from V2-B and YouTube API from V2-D) |
| All units | V2-F |

**Note on `src/cli.ts`**: Both V2-C and V2-E add a single import + registration line to `cli.ts`. These are non-overlapping additions (different lines). If agents run in parallel, the second to merge simply adds its line alongside the first. Alternatively, `cli.ts` changes can be deferred to V2-F integration.

**Note on `src/utils/format.ts`**: Both V2-C and V2-E add functions to `format.ts`. These are additive-only (new functions appended to the file). No existing code is modified. If agents run in parallel, merging is trivial (append both new functions).

---

### V2.11 Error Handling

#### V2.11.1 YouTube Data API Errors

| Condition | Error Message | Raised By |
|-----------|---------------|-----------|
| Missing API key | `"YOUTUBE_DATA_API_KEY is required for channel scanning. Obtain it from https://console.cloud.google.com/ by enabling the YouTube Data API v3 and creating an API key."` | `channel-scan.ts` |
| Invalid API key (403) | `"YouTube API quota exceeded or API key invalid. Check your YOUTUBE_DATA_API_KEY and quota at https://console.cloud.google.com/"` | `youtube-data-api.ts` |
| Quota exceeded (403) | Same as above | `youtube-data-api.ts` |
| Channel not found (404) | `"Channel not found for identifier '<identifier>'"` | `youtube-data-api.ts` |
| Network error | `"Failed to connect to YouTube Data API: <error>"` | `youtube-data-api.ts` |
| Empty date range | `"No videos found in channel '<title>' between <from> and <to>"` | `channel-scan.ts` (informational, not an error) |
| Invalid date range (from > to) | `"Invalid date range: --from (<from>) must be before or equal to --to (<to>)"` | `channel-scan.ts` |

#### V2.11.2 Transcript Errors During Channel Scan

| Condition | With `--continue-on-error` | Without `--continue-on-error` |
|-----------|---------------------------|-------------------------------|
| Transcript not available | Skip with warning, increment `skipped` | Stop, print error + partial summary, exit(1) |
| Transcript fetch rate-limited (after retries) | Pause 60s, retry once; if still fails: skip, increment `failed` | Pause 60s, retry once; if still fails: stop, print error + partial summary, exit(1) |
| Upload to Gemini fails | Skip with warning, increment `failed` | Stop, print error + partial summary, exit(1) |
| Notes generation fails | Upload proceeds without notes, print warning (always, regardless of flag) | Same (notes failure never stops the scan) |

#### V2.11.3 Get Command Errors

| Condition | Error Message |
|-----------|---------------|
| Workspace not found | `"Workspace '<name>' not found"` |
| Upload ID not found | `"Upload '<id>' not found in workspace '<name>'"` |
| Content retrieval fails (empty response) | `"Failed to retrieve content for document '<title>': model returned empty response. The document may be too large or in a binary format."` |
| Content retrieval fails (API error) | `"Failed to retrieve content for document '<title>': <error details>"` |
| Output file write fails | `"Failed to write to file '<path>': <error details>"` |
| Possible truncation detected | Warning (stderr): `"Warning: The retrieved content may be truncated. Long documents may exceed the model's output token limit."` |

---

### V2.12 Updated Architecture Diagram

```
+------------------------------------------------------------------+
|                          CLI Layer (Commander.js)                  |
|                                                                    |
|  src/cli.ts  -->  src/commands/workspace.ts                       |
|                   src/commands/upload.ts       (modified: +notes)  |
|                   src/commands/metadata.ts                         |
|                   src/commands/query.ts                            |
|                   src/commands/uploads.ts                          |
|                   src/commands/get.ts          (NEW v2)            |
|                   src/commands/channel-scan.ts (NEW v2)            |
+-----+------+------+------+------+------+------+------+-----------+
      |      |      |      |      |      |      |
      v      v      v      v      v      v      v
+------------------------------------------------------------------+
|                        Service Layer                              |
|                                                                    |
|  src/services/file-search.ts       (+ getDocumentContent)         |
|  src/services/content-extractor.ts (+ extractYouTubeEnhanced)     |
|  src/services/registry.ts                                         |
|  src/services/gemini-client.ts                                    |
|  src/services/youtube-data-api.ts  (NEW v2)                       |
|  src/services/notes-generator.ts   (NEW v2)                       |
+-----+------+------+------+------+------+------+---------+--------+
      |      |      |      |                               |
      v      v      v      v                               v
+------------------------------------+    +--------------------------+
|  External Dependencies             |    |  Local Storage           |
|                                    |    |                          |
|  @google/genai SDK                 |    |  ~/.geminirag/           |
|  jsdom + Readability + Turndown    |    |    registry.json         |
|  youtube-transcript-plus (NEW v2)  |    |    config.json (optional) |
|  Native fetch (Node.js 18+)       |    |    .env (optional)       |
+------------------------------------+    +--------------------------+
      |                |
      v                v
+---------------------+  +-------------------------------+
|  Google Gemini API  |  |  YouTube Data API v3          |
|                     |  |  (direct fetch, no SDK)       |
|  File Search Stores |  |                               |
|  Documents          |  |  channels.list (1 unit)       |
|  Models             |  |  playlistItems.list (1 unit)  |
|  Files API          |  |  videos.list (1 unit)         |
|  Operations         |  +-------------------------------+
+---------------------+
```

---

### V2.13 Updated Command Tree

```
geminirag
  |-- create <name>
  |-- list
  |-- delete <name>
  |-- info <name>
  |
  |-- upload <workspace>
  |     --file <path>
  |     --url <url>
  |     --youtube <url>
  |     --note <text>
  |     --with-notes                              (NEW v2)
  |
  |-- uploads <workspace>
  |     --filter <key=value>
  |     --sort <field>
  |
  |-- get <workspace> <upload-id>                 (NEW v2)
  |     --output <path>
  |     --raw
  |
  |-- channel-scan <workspace>                    (NEW v2)
  |     --channel <identifier>
  |     --from <date>
  |     --to <date>
  |     --with-notes
  |     --max-videos <n>
  |     --dry-run
  |     --continue-on-error
  |
  |-- update-title <workspace> <upload-id> <title>
  |-- remove <workspace> <upload-id>
  |-- set-expiration <workspace> <upload-id> <date>
  |-- clear-expiration <workspace> <upload-id>
  |-- flag <workspace> <upload-id>
  |     --add <flags...>
  |     --remove <flags...>
  |-- labels <workspace>
  |
  |-- ask <workspaces...> <question>
        --filter <key=value>
```

---

### V2.14 Architectural Decision Records (V2)

#### ADR-13: Full File Retrieval via Model-Based Verbatim Reproduction

**Decision**: Retrieve uploaded document content using `ai.models.generateContent()` with a verbatim-reproduction prompt and File Search grounding, rather than a direct content download API.

**Rationale**:
- The Gemini SDK does not expose any method to download document content from a File Search Store (investigation-v2-enhancements.md)
- The `ai.fileSearchStores.documents.list()` and `get()` methods return metadata only, not content
- Files uploaded via `uploadToFileSearchStore()` do not appear in the `ai.files` namespace, so `ai.files.download()` cannot be used
- The verbatim-reproduction prompt with File Search grounding is the only available mechanism

**Consequences**:
- Long documents (>50K words) may be truncated by output token limits
- Content may not be 100% verbatim; minor formatting differences are possible
- Binary files (PDF, images) cannot be reproduced
- Each `get` invocation costs Gemini API tokens
- Must document these limitations clearly to users

---

#### ADR-14: `playlistItems.list` for Video Enumeration (Not `search.list`)

**Decision**: Use the channel's uploads playlist via `playlistItems.list` endpoint instead of `search.list` for enumerating channel videos.

**Rationale**:
- `search.list` caps results at 500 videos per channel and costs 100 quota units per call
- `playlistItems.list` has no documented item cap and costs 1 unit per call (~55x cheaper)
- For a 500-video channel: 10 units via playlist vs 1,000 units via search
- Date filtering is done client-side on `contentDetails.videoPublishedAt` (no server-side filter available on `playlistItems.list`)

**Consequences**:
- Must paginate the entire playlist to find all videos in a date range (no early termination guarantee since ordering is not strictly guaranteed)
- Client-side date filtering is more code but avoids the 500-video hard cap
- Sort order of results must be applied client-side

---

#### ADR-15: `youtube-transcript-plus` Replaces `youtube-transcript`

**Decision**: Replace the `youtube-transcript` package (Kakulukian) with the `youtube-transcript-plus` fork (ericmmartin).

**Rationale**:
- `youtube-transcript` has no retry/backoff logic and is unmaintained (last meaningful update: 2023)
- `youtube-transcript-plus` provides built-in exponential backoff (`retries`, `retryDelay` options)
- Built-in caching (`FsCache`, `InMemoryCache`) for repeated scans
- Custom fetch injection for proxy routing (critical for cloud deployment)
- Distinct error classes for different failure modes (video unavailable, disabled, rate-limited)
- Actively maintained (v1.2.0, April 2026)
- API is compatible: `fetchTranscript(videoId, options)` returns same segment shape

**Consequences**:
- Dependency swap in `package.json`
- Import change in `content-extractor.ts` (named function instead of class method)
- Type cast updated to include `offset` and `duration` fields

---

#### ADR-16: Direct `fetch` for YouTube Data API v3 (No `googleapis` Package)

**Decision**: Call YouTube Data API v3 endpoints via built-in Node.js `fetch` with query parameters, without adding the `googleapis` npm package.

**Rationale**:
- Only 3 GET endpoints are needed: `channels.list`, `playlistItems.list`, `videos.list`
- `googleapis` package is ~50MB installed -- massive overkill for 3 simple GET requests
- Built-in `fetch` (Node.js 18+) is already available and used elsewhere in the project
- API key authentication is a simple query parameter (`key=<API_KEY>`)

**Consequences**:
- No automatic pagination or response typing from the SDK -- must be implemented manually
- Error parsing from YouTube API responses must be done manually
- Zero new npm dependencies for channel scan feature

---

#### ADR-17: 2-Second Delay with Jitter for Transcript Rate Limiting

**Decision**: Apply a 1.5-second base delay with +/-500ms random jitter between sequential `fetchTranscript()` calls during channel scan.

**Rationale**:
- YouTube rate-limits unofficial transcript requests (community-derived safe rate: 1-2 seconds)
- `youtube-transcript-plus` handles per-request retries internally (3 retries with exponential backoff)
- Jitter prevents a fixed-interval pattern that rate-limiting heuristics may detect
- If rate-limit errors persist after retries, a 60-second pause provides recovery time

**Consequences**:
- A 24-video scan takes approximately 36-48 seconds of delay time (plus transcript fetch and upload time)
- A 200-video scan takes approximately 5-7 minutes of delay time
- The `--max-videos` option serves as a safety valve for large channels

---

#### ADR-18: Lazy Validation of `YOUTUBE_DATA_API_KEY`

**Decision**: Load `YOUTUBE_DATA_API_KEY` at config time but only validate (throw if missing) when the `channel-scan` command is invoked.

**Rationale**:
- The YouTube Data API key is only needed for `channel-scan` -- not for `upload --youtube`, `get`, `ask`, or any other command
- Requiring the key at startup would break all commands for users who do not have a YouTube Data API key
- The lazy validation pattern ensures the tool remains fully functional without the key for all non-channel-scan workflows

**Consequences**:
- Users only see the "missing API key" error when they first attempt `channel-scan`
- The error message includes full instructions for obtaining the key
- Expiration warnings still fire at startup if the key is present and near expiration

---

### V2.15 Complete File Change Summary

#### New Files (4)

| File | Unit | Purpose |
|------|------|---------|
| `src/services/notes-generator.ts` | V2-B | AI notes generation from transcripts |
| `src/commands/get.ts` | V2-C | `get` command implementation |
| `src/services/youtube-data-api.ts` | V2-D | YouTube Data API v3 REST client |
| `src/commands/channel-scan.ts` | V2-E | `channel-scan` command implementation |

#### Modified Files (8)

| File | Unit(s) | Changes |
|------|---------|---------|
| `package.json` | V2-A | Swap `youtube-transcript` -> `youtube-transcript-plus`; bump version to 2.0.0 |
| `src/types/index.ts` | V2-A | Extend `AppConfig`, `UploadOptions`, `ExtractedContent`, `UploadEntry`; add `YouTubeVideoMetadata`, `ChannelScanOptions`, `ChannelScanResult`, `NotesContent` |
| `src/config/config.ts` | V2-A | Load `YOUTUBE_DATA_API_KEY` and expiration; add warning |
| `src/services/content-extractor.ts` | V2-A, V2-B | Swap import; expand transcript type; add `buildTranscriptWithParagraphs()`, `extractYouTubeEnhanced()`, `YouTubeExtractOptions`; refactor `extractYouTube()` |
| `src/services/file-search.ts` | V2-C | Add `getDocumentContent()` |
| `src/commands/upload.ts` | V2-B | Add `--with-notes` option; route to `extractYouTubeEnhanced()` |
| `src/utils/format.ts` | V2-C, V2-E | Add `formatUploadMetadataHeader()`, `formatChannelScanTable()`, `formatChannelScanSummary()`, `formatDuration()` |
| `src/cli.ts` | V2-C, V2-E | Register `get` and `channel-scan` commands; bump version |

#### New Test Scripts (5)

| File | Unit | Purpose |
|------|------|---------|
| `test_scripts/test-config-v2.ts` | V2-A | New config fields loading and validation |
| `test_scripts/test-youtube-enhanced.ts` | V2-B | Enhanced format, paragraph breaks, notes |
| `test_scripts/test-get-command.ts` | V2-C | Get command output, formatting, error cases |
| `test_scripts/test-youtube-data-api.ts` | V2-D | YouTube Data API service (requires API key) |
| `test_scripts/test-channel-scan.ts` | V2-E | Full channel scan flow (requires both API keys) |

#### New Runtime Dependency (1)

| Change | From | To |
|--------|------|-----|
| Replace | `youtube-transcript: ^1.3.0` | `youtube-transcript-plus: ^1.2.0` |

No net new dependencies. One replacement.

---

## 15. Electron Desktop UI -- Detailed Technical Design

**Date**: 2026-04-10
**Status**: Approved for Implementation
**Prerequisites**: Plan 003, Investigation, Research documents (electron-vite, shadcn DataTable, preload types)
**Related documents**:
- Requirements: `docs/reference/refined-request-electron-ui.md`
- Plan: `docs/design/plan-003-electron-ui.md`
- Investigation: `docs/reference/investigation-electron-ui.md`
- Research: `docs/reference/research-electron-vite-config.md`, `docs/reference/research-shadcn-datatable.md`, `docs/reference/research-preload-types.md`
- Codebase scan: `docs/reference/codebase-scan-electron-ui.md`

---

### 15.1 Architecture

#### 15.1.1 System Architecture

The Electron UI is a three-process architecture with strict isolation between processes. The main process owns all Node.js / Gemini API access and imports directly from the existing `../src/` service layer. The renderer process is a standard React web app with no Node.js access. Communication flows exclusively through a typed IPC bridge (preload script using `contextBridge`).

```
+============================================================================+
|                        ELECTRON APPLICATION                                 |
|                                                                             |
|  +---------------------------------------------------------------------+   |
|  |                     MAIN PROCESS (Node.js)                          |   |
|  |                                                                     |   |
|  |  electron-ui/src/main/main.ts                                       |   |
|  |    |                                                                |   |
|  |    +-- service-bridge.ts                                            |   |
|  |    |     +-- loadConfig()        <-- ../../src/config/config.ts     |   |
|  |    |     +-- createGeminiClient() <-- ../../src/services/gemini-    |   |
|  |    |     |                            client.ts                     |   |
|  |    |     +-- Caches: AppConfig, GoogleGenAI instance                |   |
|  |    |     +-- Intercepts console.warn for expiration warnings        |   |
|  |    |                                                                |   |
|  |    +-- ipc-handlers.ts                                              |   |
|  |          +-- workspace:list   -> listWorkspaces()                   |   |
|  |          +-- workspace:get    -> getWorkspace()                     |   |
|  |          +-- upload:list      -> getWorkspace() + applyFilters()    |   |
|  |          +-- upload:getContent-> getDocumentContent()               |   |
|  |          +-- upload:download  -> getDocumentContent() + dialog      |   |
|  |          +-- query:ask        -> query() + passesClientFilters()    |   |
|  |          +-- config:validate  -> initialize()                       |   |
|  |                                                                     |   |
|  |  Imports from ../../src/:                                           |   |
|  |    services/registry.ts, services/file-search.ts,                   |   |
|  |    services/gemini-client.ts, config/config.ts,                     |   |
|  |    utils/filters.ts, utils/format.ts, types/index.ts               |   |
|  +--+------------------------------------------------------------------+   |
|     |                                                                       |
|     | ipcMain.handle() <--> ipcRenderer.invoke()                            |
|     |                                                                       |
|  +--+------------------------------------------------------------------+   |
|  |                    PRELOAD SCRIPT (Sandboxed)                        |   |
|  |                                                                     |   |
|  |  electron-ui/src/preload/preload.ts                                 |   |
|  |    +-- contextBridge.exposeInMainWorld('api', api)                   |   |
|  |                                                                     |   |
|  |  electron-ui/src/preload/api.ts                                     |   |
|  |    +-- api.workspace.list()       -> invoke('workspace:list')       |   |
|  |    +-- api.workspace.get(name)    -> invoke('workspace:get')        |   |
|  |    +-- api.upload.list(...)       -> invoke('upload:list')          |   |
|  |    +-- api.upload.getContent(...) -> invoke('upload:getContent')    |   |
|  |    +-- api.upload.download(...)   -> invoke('upload:download')      |   |
|  |    +-- api.query.ask(...)         -> invoke('query:ask')            |   |
|  |    +-- api.config.validate()      -> invoke('config:validate')      |   |
|  +--+------------------------------------------------------------------+   |
|     |                                                                       |
|     | window.api (typed via index.d.ts)                                     |
|     |                                                                       |
|  +--+------------------------------------------------------------------+   |
|  |                   RENDERER PROCESS (Chromium)                        |   |
|  |                                                                     |   |
|  |  React 18 + Tailwind CSS 4 + shadcn/ui + Zustand                   |   |
|  |                                                                     |   |
|  |  electron-ui/src/renderer/src/                                      |   |
|  |    App.tsx -> AppLayout                                             |   |
|  |      +-- WorkspaceSidebar (left panel)                              |   |
|  |      +-- ContentArea (right panel)                                  |   |
|  |           +-- Tabs: [Uploads] [Ask]                                 |   |
|  |           +-- UploadsTab                                            |   |
|  |           |    +-- UploadsFilterBar                                 |   |
|  |           |    +-- DataTable (uploads-table)                        |   |
|  |           +-- AskTab                                                |   |
|  |           |    +-- QueryFilterPanel                                 |   |
|  |           |    +-- QueryPanel                                       |   |
|  |           |    +-- CitationList                                     |   |
|  |           +-- UploadDetail (Dialog overlay)                         |   |
|  |                +-- ContentViewer                                    |   |
|  |                +-- Download button                                  |   |
|  +---------------------------------------------------------------------+   |
+============================================================================+
```

#### 15.1.2 Component Diagram

```
                            App.tsx
                              |
                   +----------+----------+
                   |                     |
              AppLayout.tsx         ErrorBanner.tsx
                   |
        +----------+----------+
        |                     |
  WorkspaceSidebar      ContentArea
        |                     |
   (Zustand store)    +-------+-------+
                      |               |
                  UploadsTab       AskTab
                      |               |
             +--------+------+    +---+--------+--------+
             |               |    |            |        |
      UploadsFilterBar  DataTable QueryFilterPanel QueryPanel CitationList
                             |                               |
                        columns.tsx                   (navigates to)
                             |                               |
                     (row click) -----> UploadDetail <-------+
                                           |
                                     ContentViewer
```

#### 15.1.3 Data Flow

**Startup flow:**
1. `main.ts` creates `BrowserWindow` (900x600 min size, context isolation enabled)
2. `main.ts` calls `initializeServiceBridge()` which calls `loadConfig()` and `createGeminiClient()`
3. Renderer mounts `App.tsx`, calls `window.api.config.validate()` via IPC
4. If config invalid: `ErrorBanner` displayed, API-dependent operations blocked
5. If config valid: `loadWorkspaces()` called, sidebar populated

**Workspace selection flow:**
1. User clicks workspace in sidebar
2. `selectWorkspace(name)` called on Zustand store
3. Store calls `window.api.upload.list({ workspace: name })` via IPC
4. Main process: `getWorkspace(name)` + `applyFilters()` + `sortUploads()`
5. Result returned to renderer, store updates `uploads` array
6. `UploadsTab` re-renders with new data

**Content inspection flow:**
1. User clicks row in DataTable
2. `selectUpload(upload)` called on store, UploadDetail dialog opens
3. Store calls `window.api.upload.getContent({ workspace, uploadId })` via IPC
4. Main process: `findUploadById()` then `getDocumentContent(ai, model, storeName, docName, title)`
5. Content returned; `ContentViewer` renders the text

**Query flow:**
1. User types question in QueryPanel, clicks submit
2. `executeQuery()` called on store with question + filters
3. Store calls `window.api.query.ask(...)` via IPC
4. Main process: `buildMetadataFilter(geminiFilters)`, calls `query(ai, model, storeNames, question, metadataFilter)`
5. Applies `passesClientFilters()` to citations if client-side filters present
6. `QueryResult` returned to renderer, answer and citations displayed

---

### 15.2 Data Models

#### 15.2.1 Renderer-Side TypeScript Interfaces (UI State)

These types are defined in `electron-ui/src/shared/ipc-types.ts` and used by both main and renderer processes.

```typescript
// ===== IPC Result Wrapper =====

/** All IPC handlers return this wrapper. Never a raw rejection. */
export type IpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ===== Workspace Types (renderer-specific summaries) =====

export interface WorkspaceSummary {
  name: string;
  createdAt: string;           // ISO 8601
  uploadCount: number;
  sourceTypeCounts: {
    file: number;
    web: number;
    youtube: number;
    note: number;
  };
}

export interface WorkspaceDetail extends WorkspaceSummary {
  storeName: string;
  expiredCount: number;
  expiringSoonCount: number;   // within 7 days
}

// ===== Config Validation =====

export interface ConfigValidation {
  valid: boolean;
  error?: string;
  warnings: string[];          // e.g., "API key expires in 5 days"
}

// ===== Query Types =====

export interface QueryInput {
  workspaces: string[];
  question: string;
  geminiFilters?: { key: string; value: string }[];
  clientFilters?: { key: string; value: string }[];
}

// ===== Upload Content Response =====

export interface UploadContentResponse {
  metadata: import('../../src/types/index').UploadEntry;
  content: string;
  truncated: boolean;
}

// ===== Download Response =====

export interface DownloadResponse {
  success: boolean;
  path?: string;
  cancelled?: boolean;
}
```

Note: `UploadEntry`, `QueryResult`, `Citation`, `ParsedFilter` are imported directly from `../../src/types/index.ts`. No duplication.

#### 15.2.2 IPC Channel Map

```typescript
// electron-ui/src/shared/ipc-types.ts

import type {
  UploadEntry, QueryResult, WorkspaceData
} from '../../src/types/index';

export interface IpcChannelMap {
  'workspace:list': {
    input: void;
    output: WorkspaceSummary[];
  };
  'workspace:get': {
    input: { name: string };
    output: WorkspaceDetail;
  };
  'upload:list': {
    input: {
      workspace: string;
      filters?: { key: string; value: string }[];
      sort?: string;
    };
    output: UploadEntry[];
  };
  'upload:getContent': {
    input: { workspace: string; uploadId: string };
    output: UploadContentResponse;
  };
  'upload:download': {
    input: { workspace: string; uploadId: string };
    output: DownloadResponse;
  };
  'query:ask': {
    input: QueryInput;
    output: QueryResult;
  };
  'config:validate': {
    input: void;
    output: ConfigValidation;
  };
}
```

#### 15.2.3 Zustand Store Shape

```typescript
// electron-ui/src/renderer/src/store/index.ts

import { create } from 'zustand';
import type {
  UploadEntry, QueryResult, Citation
} from '../../../../src/types/index';
import type {
  WorkspaceSummary, WorkspaceDetail, ConfigValidation
} from '../../../shared/ipc-types';

export interface AppStore {
  // ===== Config Slice =====
  configValid: boolean;
  configError: string | null;
  configWarnings: string[];
  validateConfig: () => Promise<void>;

  // ===== Workspace Slice =====
  workspaces: WorkspaceSummary[];
  workspacesLoading: boolean;
  selectedWorkspace: string | null;
  selectedWorkspaceDetail: WorkspaceDetail | null;
  loadWorkspaces: () => Promise<void>;
  selectWorkspace: (name: string) => Promise<void>;

  // ===== Uploads Slice =====
  uploads: UploadEntry[];
  uploadsLoading: boolean;
  uploadFilters: { key: string; value: string }[];
  uploadSort: string;
  loadUploads: () => Promise<void>;
  setUploadFilters: (filters: { key: string; value: string }[]) => void;
  setUploadSort: (sort: string) => void;

  // ===== Selected Upload (Detail View) Slice =====
  selectedUpload: UploadEntry | null;
  uploadContent: string | null;
  contentTruncated: boolean;
  contentLoading: boolean;
  selectUpload: (upload: UploadEntry) => void;
  clearSelectedUpload: () => void;
  loadUploadContent: (workspace: string, uploadId: string) => Promise<void>;

  // ===== Query Slice =====
  queryResult: QueryResult | null;
  isQuerying: boolean;
  queryError: string | null;
  geminiFilters: { key: string; value: string }[];
  clientFilters: { key: string; value: string }[];
  setGeminiFilters: (filters: { key: string; value: string }[]) => void;
  setClientFilters: (filters: { key: string; value: string }[]) => void;
  executeQuery: (question: string) => Promise<void>;
  clearQueryResult: () => void;

  // ===== UI Slice =====
  activeTab: 'uploads' | 'ask';
  setActiveTab: (tab: 'uploads' | 'ask') => void;
  globalError: string | null;
  setGlobalError: (error: string | null) => void;
}
```

**Store implementation notes:**
- All async actions call `window.api.*` methods and handle `IpcResult<T>` responses
- On `success: false`, the error message is placed in the appropriate error state field
- `selectWorkspace(name)` triggers both `workspace:get` (for detail/stats) and `upload:list` (for table data)
- `executeQuery(question)` reads `selectedWorkspace`, `geminiFilters`, `clientFilters` from store state
- The store is created as a single `create<AppStore>()` call; no separate slices needed at this scale

---

### 15.3 IPC Contract

#### 15.3.1 Complete Channel Specification

| # | Channel | Direction | Input Type | Output Type | Sync/Async | Service Function(s) |
|---|---------|-----------|------------|-------------|------------|---------------------|
| 1 | `workspace:list` | renderer -> main | `void` | `WorkspaceSummary[]` | Sync (registry read) | `listWorkspaces()` from `services/registry.ts` |
| 2 | `workspace:get` | renderer -> main | `{ name: string }` | `WorkspaceDetail` | Sync (registry read) | `getWorkspace(name)` from `services/registry.ts`, `getExpirationIndicator()` from `utils/format.ts` |
| 3 | `upload:list` | renderer -> main | `{ workspace, filters?, sort? }` | `UploadEntry[]` | Sync (registry read + filter) | `getWorkspace()`, `applyFilters()`, `sortUploads()` from `utils/filters.ts` |
| 4 | `upload:getContent` | renderer -> main | `{ workspace, uploadId }` | `UploadContentResponse` | Async (Gemini API) | `findUploadById()` from `utils/filters.ts`, `getDocumentContent()` from `services/file-search.ts` |
| 5 | `upload:download` | renderer -> main | `{ workspace, uploadId }` | `DownloadResponse` | Async (Gemini API + dialog) | Same as #4 plus `dialog.showSaveDialog()` + `fs.writeFileSync()` |
| 6 | `query:ask` | renderer -> main | `QueryInput` | `QueryResult` | Async (Gemini API) | `buildMetadataFilter()`, `query()` from `services/file-search.ts`, `passesClientFilters()` from `utils/filters.ts` |
| 7 | `config:validate` | renderer -> main | `void` | `ConfigValidation` | Sync (config read) | `initializeServiceBridge()` which calls `loadConfig()` + `createGeminiClient()` |

#### 15.3.2 Error Response Format

Every IPC handler wraps its return in `IpcResult<T>`:

```typescript
// Success case
{ success: true, data: <T> }

// Error case
{ success: false, error: "Human-readable error message from the service layer" }
```

Error mapping:
- `loadConfig()` throws -> `{ success: false, error: "Missing required configuration: GEMINI_API_KEY..." }`
- `getWorkspace()` throws "Workspace not found" -> `{ success: false, error: "Workspace 'xyz' not found" }`
- Gemini API 403/429/500 -> `{ success: false, error: "Gemini API error: <status> <message>" }`
- `dialog.showSaveDialog()` cancelled -> `{ success: true, data: { success: false, cancelled: true } }` (not an error)

#### 15.3.3 Handler Implementation Pattern

```typescript
// Pattern used by all IPC handlers in ipc-handlers.ts
ipcMain.handle('channel:name', async (_event, input: InputType): Promise<IpcResult<OutputType>> => {
  try {
    // Call service layer
    const result = await someServiceFunction(input);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});
```

---

### 15.4 Component Design

#### 15.4.1 React Component Tree

```
App.tsx
  |-- ErrorBanner (conditional: shown when configError or globalError)
  |-- AppLayout.tsx
       |-- WorkspaceSidebar.tsx (left panel, ~250px width)
       |    |-- Refresh Button (calls loadWorkspaces)
       |    |-- Workspace list items (map over workspaces)
       |    |    |-- Name, creation date (formatted), upload count
       |    |    |-- Selected state (highlighted)
       |    |-- Workspace statistics panel (when workspace selected)
       |         |-- Total uploads, by source type, expired, expiring soon
       |
       |-- ContentArea (right panel, flex-grow)
            |-- Tabs (shadcn/ui Tabs)
                 |-- TabsTrigger: "Uploads"
                 |-- TabsTrigger: "Ask"
                 |-- TabsContent: UploadsTab.tsx
                 |    |-- UploadsFilterBar.tsx
                 |    |    |-- Select: Source type (All/file/web/youtube/note)
                 |    |    |-- Select: Flags (All/urgent/completed/inactive)
                 |    |    |-- Select: Expiration (All/expired/expiring_soon/active)
                 |    |    |-- Button: Clear filters
                 |    |-- DataTable (uploads-table/data-table.tsx)
                 |    |    |-- columns.tsx defines: ID, Title, Source, Date, Flags, Expiration
                 |    |    |-- Row click -> selectUpload()
                 |    |-- LoadingSpinner (when uploadsLoading)
                 |    |-- Empty state: "No uploads in this workspace"
                 |
                 |-- TabsContent: AskTab.tsx
                      |-- QueryFilterPanel.tsx (collapsible)
                      |    |-- Gemini-side: Source type Select, Source URL Input
                      |    |-- Client-side: Flags multi-select, Expiration Select
                      |    |-- Clear/Reset Button
                      |-- QueryPanel.tsx
                      |    |-- Textarea (question input)
                      |    |-- Submit Button (disabled when empty or isQuerying)
                      |    |-- LoadingSpinner (when isQuerying)
                      |    |-- Answer display area (ScrollArea)
                      |    |-- Error display (if queryError)
                      |-- CitationList.tsx
                           |-- Citation items: number, title, excerpt
                           |-- Clickable -> navigates to UploadDetail

  UploadDetail.tsx (Dialog overlay, opened by selectUpload or citation click)
    |-- Metadata panel
    |    |-- ID (full, monospace, copyable)
    |    |-- Title
    |    |-- Source type (Badge)
    |    |-- Source URL (clickable link -> shell.openExternal)
    |    |-- Timestamp (formatted)
    |    |-- Expiration date (color-coded)
    |    |-- Flags (Badge array)
    |    |-- Gemini document name (monospace)
    |-- ContentViewer.tsx
    |    |-- Skeleton (while contentLoading)
    |    |-- ScrollArea with monospace content
    |    |-- Truncation warning banner (if content was truncated)
    |-- Download Button -> window.api.upload.download()
    |-- Close Button
```

#### 15.4.2 Component Props and State

**App.tsx:**
- No props. Root component.
- On mount: calls `validateConfig()` and `loadWorkspaces()` from store.

**ErrorBanner.tsx:**
```typescript
interface ErrorBannerProps {
  message: string;
  variant?: 'error' | 'warning';
  onDismiss?: () => void;
}
```

**LoadingSpinner.tsx:**
```typescript
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;  // accessible label
}
```

**WorkspaceSidebar.tsx:**
- No props. Reads from store: `workspaces`, `selectedWorkspace`, `selectedWorkspaceDetail`, `workspacesLoading`.
- Actions from store: `loadWorkspaces()`, `selectWorkspace(name)`.

**UploadsTab.tsx:**
- No props. Reads from store: `uploads`, `uploadsLoading`, `uploadFilters`, `uploadSort`.
- Actions from store: `setUploadFilters()`, `setUploadSort()`, `selectUpload()`.

**UploadsFilterBar.tsx:**
```typescript
interface UploadsFilterBarProps {
  sourceTypeFilter: string;
  onSourceTypeChange: (value: string) => void;
  flagFilter: string;
  onFlagChange: (value: string) => void;
  expirationFilter: string;
  onExpirationChange: (value: string) => void;
  onClear: () => void;
}
```

**DataTable (data-table.tsx):**
```typescript
interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
}
```
- Internal state: `SortingState`, `ColumnFiltersState` managed by `useReactTable`.

**UploadDetail.tsx:**
- No props (reads `selectedUpload`, `uploadContent`, `contentLoading`, `contentTruncated` from store).
- Actions from store: `clearSelectedUpload()`, `loadUploadContent()`.
- On open: triggers `loadUploadContent(workspace, uploadId)`.

**ContentViewer.tsx:**
```typescript
interface ContentViewerProps {
  content: string | null;
  loading: boolean;
  truncated: boolean;
}
```

**AskTab.tsx:**
- No props. Reads from store: `queryResult`, `isQuerying`, `queryError`, `geminiFilters`, `clientFilters`.
- Actions from store: `executeQuery()`, `clearQueryResult()`, `setGeminiFilters()`, `setClientFilters()`.

**QueryPanel.tsx:**
```typescript
interface QueryPanelProps {
  onSubmit: (question: string) => void;
  isQuerying: boolean;
  result: QueryResult | null;
  error: string | null;
}
```

**QueryFilterPanel.tsx:**
```typescript
interface QueryFilterPanelProps {
  geminiFilters: { key: string; value: string }[];
  clientFilters: { key: string; value: string }[];
  onGeminiFiltersChange: (filters: { key: string; value: string }[]) => void;
  onClientFiltersChange: (filters: { key: string; value: string }[]) => void;
  onClear: () => void;
}
```

**CitationList.tsx:**
```typescript
interface CitationListProps {
  citations: Citation[];
  onCitationClick: (citation: Citation) => void;
}
```

#### 15.4.3 shadcn/ui Component Usage Plan

| shadcn Component | Used In | Purpose |
|-----------------|---------|---------|
| `Button` | All views | Actions (refresh, submit, download, clear, close) |
| `Badge` | DataTable columns, UploadDetail | Source type indicator, flags display |
| `Input` | QueryFilterPanel | Source URL text input |
| `Textarea` | QueryPanel | Question input |
| `Select` | UploadsFilterBar, QueryFilterPanel | Source type, flags, expiration dropdowns |
| `Table` | DataTable | Upload browser table rendering |
| `Tabs` | AppLayout ContentArea | Switch between Uploads and Ask views |
| `Dialog` | UploadDetail | Modal overlay for upload inspection |
| `ScrollArea` | ContentViewer, QueryPanel answer | Scrollable content panels |
| `Separator` | WorkspaceSidebar, UploadDetail | Visual dividers |
| `Skeleton` | ContentViewer, DataTable | Loading placeholders |

Additional non-shadcn dependencies:
- `@tanstack/react-table`: Headless table for DataTable (sorting, filtering)
- `lucide-react`: Icons (ArrowUpDown, Download, RefreshCw, Search, X, FileText, Globe, Video, StickyNote)

---

### 15.5 File Structure

```
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
      main.ts                                            [Phase 1, mod Phase 2]
      service-bridge.ts                                  [Phase 2]
      ipc-handlers.ts                                    [Phase 2]
    preload/
      preload.ts                                         [Phase 1, mod Phase 3]
      api.ts                                             [Phase 3]
      index.d.ts                                         [Phase 3]
    renderer/
      index.html                                         [Phase 1]
      tsconfig.json                                      [Phase 1, mod Phase 3]
      src/
        main.tsx                                         [Phase 1]
        App.tsx                                          [Phase 1, mod Phase 4]
        app.css                                          [Phase 1, mod Phase 4]
        lib/
          utils.ts                                       [Phase 4]
        store/
          index.ts                                       [Phase 4]
        layout/
          AppLayout.tsx                                  [Phase 4, mod Phase 5]
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

Files modified in existing `src/` (Phase 0 prerequisite):
```
src/utils/filters.ts                  [NEW - Phase 0]
src/commands/uploads.ts               [MODIFIED - Phase 0]
src/commands/query.ts                 [MODIFIED - Phase 0]
src/commands/get.ts                   [MODIFIED - Phase 0]
```

---

### 15.6 Configuration

#### 15.6.1 electron-vite Configuration (`electron.vite.config.ts`)

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/main.ts')
        }
      },
      watch: {
        include: [
          'src/**',
          '../src/**'       // Watch GeminiRAG service layer changes
        ]
      },
      sourcemap: true
    },
    resolve: {
      alias: {
        '@cli': resolve(__dirname, '../src')
      }
    }
  },

  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/preload.ts')
        }
      },
      sourcemap: true
    }
  },

  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
```

**Key decisions:**
- Main process uses Rollup (via electron-vite) to bundle all `../src/` ESM imports into a single CJS output
- `@cli` alias maps to `../src` for clean imports in main process code
- Watch mode includes `../src/**` so service layer changes trigger rebuild in dev mode
- No `"type": "module"` in electron-ui/package.json (CJS output)

#### 15.6.2 TypeScript Configuration

**`electron-ui/tsconfig.json`** (main + preload):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "paths": {
      "@cli/*": ["../src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out"]
}
```

**`electron-ui/tsconfig.node.json`** (for electron-vite config file):
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["electron.vite.config.ts"]
}
```

**`electron-ui/src/renderer/tsconfig.json`** (renderer):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.d.ts",
    "../preload/index.d.ts"
  ]
}
```

#### 15.6.3 Package Dependencies

**`electron-ui/package.json`:**
```json
{
  "name": "geminirag-ui",
  "version": "1.0.0",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev --watch",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  },
  "devDependencies": {
    "electron": "^41.0.0",
    "electron-vite": "^5.0.0",
    "typescript": "^5.0.0",
    "@types/node": "^22.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  },
  "dependencies": {
    "zustand": "^5.0.0",
    "@tanstack/react-table": "^8.0.0",
    "lucide-react": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest"
  }
}
```

**Note:** `@radix-ui/*` packages are installed automatically when adding shadcn/ui components via CLI. The `@google/genai`, `dotenv`, and other service-layer dependencies from the root `package.json` are bundled by Rollup at build time -- they are NOT listed in `electron-ui/package.json`.

---

### 15.7 Error Handling

#### 15.7.1 Configuration Error Strategy

**No fallback values.** This is a project-wide convention (see Structure & Conventions). If `GEMINI_API_KEY` or `GEMINI_MODEL` is missing, `loadConfig()` throws an exception. The Electron app surfaces this as follows:

1. `service-bridge.ts` `initialize()` catches the error from `loadConfig()`
2. Returns `IpcResult<ConfigValidation>` with `{ success: true, data: { valid: false, error: "...", warnings: [] } }`
3. Renderer receives this on startup via `config:validate` channel
4. Store sets `configValid = false`, `configError = "<exact error from loadConfig>">`
5. `App.tsx` renders `ErrorBanner` at top of screen with the error message
6. All API-dependent UI elements (query submit, content fetch, download) check `configValid` and are disabled when false
7. Workspace listing still works (registry is local JSON, no API needed)

#### 15.7.2 IPC Error Propagation

```
Service Layer (throws Error)
    |
    v
IPC Handler (try/catch)
    |
    v
IpcResult<T> { success: false, error: error.message }
    |
    v  (serialized via IPC)
Preload API (pass-through)
    |
    v
Zustand Store Action (checks success field)
    |
    v
Store Error State (configError, queryError, globalError)
    |
    v
UI Component (ErrorBanner, inline error text)
```

Errors never cause unhandled promise rejections. The renderer never sees raw thrown exceptions.

#### 15.7.3 UI Error Display Strategy

| Error Type | Display Location | Component | User Action |
|-----------|-----------------|-----------|-------------|
| Missing config | Top banner (persistent) | `ErrorBanner` variant=error | Fix config, restart app |
| Expiration warning | Top banner (dismissible) | `ErrorBanner` variant=warning | Renew API key |
| Workspace not found | Inline in content area | Text message | Select different workspace |
| Upload not found | Dialog error state | Text in UploadDetail | Close dialog |
| Gemini API error (query) | Inline in AskTab | `QueryPanel` error area | Retry query |
| Gemini API error (content) | Dialog error state | `ContentViewer` error | Retry or close |
| Download cancelled | No display (silent) | -- | -- |
| Download write error | Dialog toast/message | Text in UploadDetail | Retry |

---

### 15.8 Implementation Units

Each unit is a self-contained block of work with clearly defined inputs, outputs, and file ownership. Units within the same batch can be built in parallel with zero file conflicts.

#### 15.8.1 Unit Definitions

**Unit 0: Filter/Sort Utility Extraction**
- **Input:** Existing private functions in `commands/uploads.ts`, `commands/query.ts`, `commands/get.ts`
- **Output:** New `src/utils/filters.ts` with all functions exported; command files import from it
- **Files created:** `src/utils/filters.ts`
- **Files modified:** `src/commands/uploads.ts`, `src/commands/query.ts`, `src/commands/get.ts`
- **Interface contract:** Same function signatures as the private originals; pure refactor
- **Verification:** `npx tsc --noEmit` + all existing test scripts pass

**Unit 1: Electron-Vite Project Scaffolding**
- **Input:** None (greenfield `electron-ui/` directory)
- **Output:** Runnable blank Electron window; build succeeds
- **Files created:** All files listed under Phase 1 in section 15.5
- **Interface contract:** `npm run dev` opens window; `npm run build` produces `out/`
- **Verification:** `cd electron-ui && npm install && npm run build`

**Unit 2: Service Bridge + IPC Handlers + Shared Types**
- **Input:** Unit 0 (filter utils), Unit 1 (scaffolding)
- **Output:** All 7 IPC channels registered; service bridge initializes config + client
- **Files created:** `src/shared/ipc-types.ts`, `src/main/service-bridge.ts`, `src/main/ipc-handlers.ts`
- **Files modified:** `src/main/main.ts` (import and call registration)
- **Interface contract:** `IpcChannelMap` type defines all channel signatures; `IpcResult<T>` wrapper
- **Verification:** `cd electron-ui && npm run build` (main process compiles)

**Unit 3: Preload Script + Typed API**
- **Input:** Unit 1 (scaffolding), Unit 2 (shared types -- specifically `ipc-types.ts`)
- **Output:** `window.api` fully typed in renderer; preload compiles
- **Files created:** `src/preload/api.ts`, `src/preload/index.d.ts`
- **Files modified:** `src/preload/preload.ts`, `src/renderer/tsconfig.json`
- **Interface contract:** `window.api` matches `IpcChannelMap` via `typeof import('./api').api`
- **Verification:** `cd electron-ui && npm run build`

**Unit 4: Renderer Foundation + Layout Shell**
- **Input:** Unit 1 (scaffolding)
- **Output:** App renders with sidebar + content area layout; Zustand store defined; shadcn/ui components installed; Tailwind configured
- **Files created:** All shadcn `ui/` components, `store/index.ts`, `layout/AppLayout.tsx`, `ErrorBanner.tsx`, `LoadingSpinner.tsx`, `lib/utils.ts`
- **Files modified:** `App.tsx`, `app.css`
- **Interface contract:** Store shape matches section 15.2.3; components use shadcn/ui primitives
- **Verification:** `cd electron-ui && npm run build` (renderer compiles)

**Unit 5: Workspace Sidebar**
- **Input:** Units 2, 3, 4
- **Output:** Sidebar displays workspaces; selection triggers upload loading
- **Files created:** `components/WorkspaceSidebar.tsx`
- **Files modified:** `layout/AppLayout.tsx`
- **Interface contract:** Uses `workspaces`, `selectedWorkspace`, `selectWorkspace()` from store

**Unit 6: Upload Browser**
- **Input:** Units 2, 3, 4
- **Output:** DataTable with filter bar, sorting, row click
- **Files created:** `components/uploads-table/columns.tsx`, `components/uploads-table/data-table.tsx`, `components/UploadsFilterBar.tsx`, `components/UploadsTab.tsx`
- **Interface contract:** Uses `uploads`, `uploadFilters`, `setUploadFilters()`, `selectUpload()` from store

**Unit 7: Upload Detail + Download**
- **Input:** Units 2, 3, 4
- **Output:** Dialog with metadata, content viewer, download button
- **Files created:** `components/UploadDetail.tsx`, `components/ContentViewer.tsx`
- **Interface contract:** Uses `selectedUpload`, `uploadContent`, `contentLoading`, `loadUploadContent()` from store

**Unit 8: Query + Filter Panel**
- **Input:** Units 2, 3, 4
- **Output:** Ask tab with query input, filter panel, answer display, citation list
- **Files created:** `components/QueryPanel.tsx`, `components/QueryFilterPanel.tsx`, `components/CitationList.tsx`, `components/AskTab.tsx`
- **Interface contract:** Uses `queryResult`, `isQuerying`, `executeQuery()`, `geminiFilters`, `clientFilters` from store

**Unit 9: Integration + Polish**
- **Input:** All above units
- **Output:** End-to-end verified application
- **Files modified:** Any file (cross-cutting polish)
- **Verification:** All acceptance criteria from section 7 of refined request

#### 15.8.2 Parallelization Batches

```
Batch 1 (parallel):   Unit 0 (src/) + Unit 1 (electron-ui/ scaffolding)
                       No file overlap.

Batch 2 (parallel):   Unit 2 (main/) + Unit 3 (preload/) + Unit 4 (renderer/)
                       Minimal overlap: Unit 3 depends on ipc-types.ts from Unit 2.
                       Resolution: Unit 2 creates ipc-types.ts first (~15 min),
                       then all three proceed in parallel.

Batch 3 (parallel):   Unit 5 + Unit 6 + Unit 7 + Unit 8
                       No file overlap. All read from Zustand store (defined in Unit 4).
                       Store must define ALL actions upfront to avoid contention.

Batch 4 (sequential): Unit 9 (single agent, cross-cutting)
```

#### 15.8.3 Interface Contracts Between Units

| Contract | Producer | Consumer(s) | Location |
|----------|----------|-------------|----------|
| `IpcChannelMap` type | Unit 2 | Units 2, 3, 4, 5-8 | `src/shared/ipc-types.ts` |
| `IpcResult<T>` type | Unit 2 | Units 2, 3, 4, 5-8 | `src/shared/ipc-types.ts` |
| `WorkspaceSummary`, `WorkspaceDetail` types | Unit 2 | Units 4, 5 | `src/shared/ipc-types.ts` |
| `window.api` type declaration | Unit 3 | Units 5-8 (via store) | `src/preload/index.d.ts` |
| Zustand `AppStore` interface | Unit 4 | Units 5, 6, 7, 8 | `src/renderer/src/store/index.ts` |
| Filter utility functions | Unit 0 | Unit 2 (IPC handlers) | `src/utils/filters.ts` |
| `UploadEntry`, `QueryResult`, `Citation` | Existing codebase | All units | `src/types/index.ts` |

---

### 15.9 Architectural Decision Records

#### ADR-19: electron-vite for Unified Build

**Decision**: Use electron-vite v5 as the build tool for the Electron application.

**Context**: The GeminiRAG service layer is pure ESM (`"type": "module"`, NodeNext resolution, `.js` extension imports). Electron's main process historically expects CJS. Three approaches were evaluated: native ESM in Electron, bundling to CJS with esbuild, and separate CJS compilation.

**Rationale**:
- electron-vite provides unified configuration for main, preload, and renderer in a single `electron.vite.config.ts`
- Rollup (used internally by electron-vite) bundles the main process to CJS, resolving all ESM imports from `../src/` at build time
- The `.js` extension imports in the service layer are handled transparently by Rollup's TypeScript resolver
- Watch mode with `build.watch.include: ['../src/**']` detects service layer changes
- Minimal boilerplate compared to manual Vite + esbuild orchestration

**Consequences**:
- One build tool dependency (electron-vite)
- Main process debugging requires source maps (generated automatically)
- electron-vite v5 is the required minimum (v4 has different API for externals)

#### ADR-20: Zustand for State Management

**Decision**: Use Zustand v5 for renderer-side state management.

**Context**: Three options evaluated: React Context + useReducer, Zustand, Redux Toolkit.

**Rationale**:
- ~1KB bundle size vs ~30KB for RTK
- No provider wrappers needed (unlike Context or Redux)
- Selector-based subscriptions prevent unnecessary re-renders
- Async actions (IPC calls) are natural: just `await window.api.*.method()` inside store actions
- Single store with typed interface is sufficient for ~4 state domains at this scale
- Functional style (no classes) aligns with codebase conventions

**Consequences**:
- One runtime dependency in the renderer
- Developers unfamiliar with Zustand need brief onboarding (API is simple)

#### ADR-21: Shared Interface Contract (Pattern 3) for IPC Types

**Decision**: Define a shared `IpcChannelMap` interface in `src/shared/ipc-types.ts` that is used by both main process handlers and the preload API, with the renderer declaration derived via `typeof import('./api').api`.

**Context**: Three patterns for typing `window.api` were evaluated: manual interface (Pattern 1), `typeof import` auto-sync (Pattern 2), shared interface contract (Pattern 3).

**Rationale**:
- Pattern 3 provides compile-time enforcement on both sides of the IPC boundary
- If a handler's return type drifts from the contract, TypeScript catches it in the main process
- If the preload API drifts from the contract, TypeScript catches it in the preload script
- The renderer type is auto-derived from the preload implementation, so it stays in sync automatically
- With 7 IPC channels, the contract is small and easy to maintain

**Consequences**:
- `ipc-types.ts` is the single source of truth for all IPC shapes
- Changes to IPC signatures require updating this one file, then both sides are type-checked

#### ADR-22: Thin Service Bridge (Not Direct Import, Not Full Abstraction)

**Decision**: Create a thin `service-bridge.ts` in the main process that handles three cross-cutting concerns: Gemini client lifecycle, error normalization, and console.warn interception.

**Context**: Three approaches evaluated: direct import (handlers call services directly), thin bridge, full abstraction layer.

**Rationale**:
- The CLI creates a fresh `GoogleGenAI` instance per command invocation. The Electron app should create one instance at startup and reuse it, avoiding repeated initialization
- `loadConfig()` uses `console.warn()` for expiration warnings. These go to the main process console, not the UI. The bridge intercepts them during initialization and returns them as structured data
- IPC handlers need a consistent error format (`IpcResult<T>`). The bridge provides the shared try/catch pattern
- A full abstraction layer would duplicate function signatures unnecessarily -- the service functions already have clean APIs

**Consequences**:
- One additional file (~100-150 lines)
- IPC handlers call service functions directly for business logic, using the bridge only for shared resources (client, config)

#### ADR-23: DataTable with @tanstack/react-table for Upload Browser

**Decision**: Use the shadcn/ui DataTable recipe with `@tanstack/react-table` v8 for the upload browser table.

**Context**: The upload browser (FR-02) requires a table with: 6 columns (ID, title, source, date, flags, expiration), client-side sorting, external filter controls, custom cell renderers (badges, color-coded expiration), and row click navigation.

**Rationale**:
- TanStack Table is headless -- full control over rendering with shadcn/ui Table primitives
- Custom `filterFn` per column handles array-valued fields (flags)
- `getSortedRowModel()` provides client-side sorting without server round-trips
- Row click via `row.original` gives typed access to the full `UploadEntry` object
- No pagination needed for typical workspace sizes (<1000 uploads)
- ~15KB bundle addition

**Consequences**:
- Filter state is lifted to the parent component (UploadsTab) and synced to TanStack Table via `useEffect`
- Column definitions are separated into `columns.tsx` for maintainability
- If workspaces exceed ~1000 uploads, `@tanstack/react-virtual` may be needed for virtual scrolling (out of scope for v1)

#### ADR-24: Direct Relative Imports for Service Layer

**Decision**: Use direct relative imports (`../../src/services/registry.js`) in main process code rather than the `@cli` alias for the primary import pattern.

**Context**: Two import styles were evaluated: direct relative paths and `@cli/*` alias. The alias requires keeping `resolve.alias` in `electron.vite.config.ts` and `paths` in `tsconfig.json` in sync.

**Rationale**:
- Direct relative imports work without any configuration; Rollup resolves them automatically
- The `@cli` alias is still defined (for future use or editor IntelliSense) but is not the primary import pattern
- Fewer moving parts reduces the risk of path resolution issues
- The relative path depth (`../../src/`) is consistent and predictable from `electron-ui/src/main/`

**Consequences**:
- Import statements are longer but explicit
- If the directory structure changes, imports must be updated manually (low risk -- structure is stable)

#### ADR-25: RECITATION Fallback for Content Retrieval

**Decision**: When `getDocumentContent` receives `finishReason: RECITATION` from the Gemini API, automatically retry with an analytical prompt that avoids verbatim reproduction.

**Context**: The Gemini API blocks verbatim reproduction of copyrighted content (especially YouTube transcripts) via its RECITATION safety filter, returning 0 text parts. This makes the `get` command and Electron UI's Gemini content view return empty for YouTube uploads.

**Rationale**:
- The RECITATION filter cannot be bypassed — it's a server-side safety mechanism
- An analytical prompt ("write original analytical notes") avoids triggering the filter because the model generates original content rather than reproducing the source
- The fallback result is prefixed with `[NOTE: Verbatim content retrieval was blocked...]` for transparency
- If both attempts fail, a clear error message is returned instead of silent empty content

**Consequences**:
- YouTube content via Gemini is always a summary/analysis, never the raw transcript
- Users should use the Transcript button (direct YouTube fetch) for raw content
- Extra API call on RECITATION (two calls instead of one)

#### ADR-26: YouTube Content Sources in Electron UI

**Decision**: Provide four content source buttons (Description, Transcript, AI Notes, Gemini) for YouTube uploads, defaulting to Description.

**Context**: YouTube uploads have multiple useful representations: the video description (author's summary with links), the raw transcript, AI-generated notes, and Gemini's grounded content. Each serves a different purpose.

**Rationale**:
- Description is the most immediately useful (author's context, links, key points) and requires minimal API cost (1 Data API unit)
- Transcript bypasses both Gemini and copyright filters by fetching directly from YouTube
- AI Notes provides a structured analysis when a quick summary is needed
- Gemini provides the indexed content for consistency with non-YouTube uploads
- All four are fetched on-demand (not pre-loaded) to minimize API calls

**Consequences**:
- Description requires YOUTUBE_DATA_API_KEY; shows clear error if missing
- Transcript and AI Notes use `youtube-transcript-plus` which is externalized in the build config
- The main process imports only lightweight modules (no jsdom/readability) for YouTube operations

#### ADR-27: YouTube Description in Indexed Content

**Decision**: Include the YouTube video description in the uploaded markdown content, between the header and transcript sections.

**Context**: Previously, uploaded YouTube content contained only metadata and transcript. The video description (visible below the video on YouTube) contains the author's summary, links, chapter markers, and key concepts.

**Rationale**:
- The description enriches the indexed content for Gemini search queries
- For channel-scan uploads, the description is already available from `listChannelVideos`
- For single-video uploads, it's fetched via a `videos.list` API call (1 quota unit) when YOUTUBE_DATA_API_KEY is available
- Non-fatal: if the API key is missing or the call fails, the upload proceeds without the description

**Consequences**:
- Slightly larger indexed content per YouTube upload
- One additional API call per single-video upload (not for channel-scan which already has it)
- Previously uploaded YouTube content does not retroactively gain descriptions

---

## 16. Electron UI Upload Features -- Detailed Technical Design

**Date**: 2026-04-10
**Status**: Approved for Implementation
**Prerequisites**: Section 15 fully implemented (read-only Electron UI operational)
**Related documents**:
- Specification: `docs/reference/refined-request-upload-features.md`
- Plan: `docs/design/plan-004-upload-features.md`
- Investigation: `docs/reference/investigation-upload-features.md`
- Codebase scan: `docs/reference/codebase-scan-electron-ui.md`

---

### 16.1 Overview

This section defines the technical design for adding five write operations to the currently read-only Electron UI:

1. **Create workspace** -- from the sidebar
2. **Upload local file** -- via native file picker
3. **Upload from URL** -- web page content extraction
4. **Upload YouTube video** -- transcript extraction with optional AI notes
5. **Add personal note** -- free-text entry

All five operations exist in the CLI service layer (`src/`). No modifications to `src/` are required. All changes are within `electron-ui/`.

---

### 16.2 Architecture Extension

The architecture from Section 15.1.1 is extended with six new IPC channels. The main process gains write operations that call existing CLI service functions. The renderer gains two new dialog components and modifications to two existing components.

#### 16.2.1 Extended IPC Channel Map

```
+============================================================================+
|  MAIN PROCESS -- NEW HANDLERS                                              |
|                                                                            |
|  ipc-handlers.ts (additions)                                               |
|    +-- workspace:create  -> validateWorkspaceName(), createStore(),         |
|    |                        addWorkspace(); rollback: deleteStore()         |
|    +-- dialog:openFile   -> dialog.showOpenDialog()                        |
|    +-- upload:file       -> extractDiskFile(), uploadContent(),             |
|    |                        addUpload(); rollback: deleteDocument()         |
|    +-- upload:url        -> validateUrl(), extractWebPage(),               |
|    |                        uploadContent(), addUpload();                   |
|    |                        rollback: deleteDocument()                      |
|    +-- upload:youtube    -> extractYouTubeVideoId(),                        |
|    |                        extractYouTubeEnhanced(), uploadContent(),      |
|    |                        addUpload(); rollback: deleteDocument()         |
|    +-- upload:note       -> extractNote(), uploadContent(),                 |
|                             addUpload(); rollback: deleteDocument()         |
|                                                                            |
|  New imports from ../../src/:                                              |
|    services/registry.ts (addWorkspace, addUpload)                          |
|    services/file-search.ts (createStore, deleteStore, uploadContent,       |
|                             deleteDocument)                                |
|    services/content-extractor.ts (extractDiskFile, extractWebPage,         |
|                                   extractYouTubeEnhanced, extractNote)     |
|    utils/validation.ts (validateWorkspaceName, validateUrl,                |
|                         extractYouTubeVideoId)                             |
+============================================================================+
|  PRELOAD SCRIPT (additions)                                                |
|                                                                            |
|  api.ts                                                                    |
|    +-- api.workspace.create(name)              -> invoke('workspace:create')|
|    +-- api.dialog.openFile()                   -> invoke('dialog:openFile') |
|    +-- api.upload.uploadFile(ws, path)         -> invoke('upload:file')     |
|    +-- api.upload.uploadUrl(ws, url)           -> invoke('upload:url')      |
|    +-- api.upload.uploadYoutube(ws, url, bool) -> invoke('upload:youtube')  |
|    +-- api.upload.uploadNote(ws, text)         -> invoke('upload:note')     |
+============================================================================+
|  RENDERER PROCESS (additions)                                              |
|                                                                            |
|  New components:                                                           |
|    +-- CreateWorkspaceDialog.tsx (modal with name input)                    |
|    +-- AddContentDialog.tsx (tabbed modal: File, Web Page, YouTube, Note)  |
|                                                                            |
|  Modified components:                                                      |
|    +-- WorkspaceSidebar.tsx (add "+" button -> opens CreateWorkspaceDialog) |
|    +-- UploadsTab.tsx (add "Add Content" button -> opens AddContentDialog)  |
|                                                                            |
|  Store additions (store/index.ts):                                         |
|    +-- isCreatingWorkspace, createWorkspaceError, createWorkspace()         |
|    +-- isUploading, uploadError, uploadFile(), uploadUrl(),                 |
|        uploadYoutube(), uploadNote(), clearUploadError(),                   |
|        clearCreateWorkspaceError()                                         |
+============================================================================+
```

#### 16.2.2 Extended Component Diagram

```
                            App.tsx
                              |
             +----------------+------------------+
             |                                   |
      WorkspaceSidebar                      ContentArea
             |                                   |
    +--------+--------+              +-----------+-----------+
    |                 |              |                       |
  [Refresh]     [+ Create]       Tabs                  UploadDetail
    |                 |         /       \                    |
  ws list    CreateWorkspace   /         \            ContentViewer
             Dialog       UploadsTab    AskTab
                            |
                  +---------+----------+
                  |                    |
             [Add Content]      UploadsFilterBar
                  |                    |
            AddContentDialog      DataTable
              /  |   |  \
           File URL  YT  Note
           Tab  Tab  Tab  Tab
```

---

### 16.3 IPC Contract Extension (Section A)

All new channels follow the existing `IpcResult<T>` wrapper pattern defined in `ipc-types.ts`.

#### 16.3.1 New Shared Type

```typescript
// In electron-ui/src/shared/ipc-types.ts

export interface UploadResultIpc {
  id: string;
  title: string;
  sourceType: string;
}
```

#### 16.3.2 New IpcChannelMap Entries

```typescript
// Added to IpcChannelMap in electron-ui/src/shared/ipc-types.ts

'workspace:create': {
  input: { name: string };
  output: { name: string; storeName: string; createdAt: string };
};

'dialog:openFile': {
  input: void;
  output: { filePath: string; fileName: string; mimeType: string } | null;
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
  input: { workspace: string; url: string; withNotes?: boolean };
  output: UploadResultIpc;
};

'upload:note': {
  input: { workspace: string; text: string };
  output: UploadResultIpc;
};
```

#### 16.3.3 Channel Contract Details

| Channel | Input | Output | Latency | Error Scenarios |
|---------|-------|--------|---------|-----------------|
| `workspace:create` | `{ name: string }` | `{ name, storeName, createdAt }` | 2-5s | Invalid name, duplicate name, max 10 workspaces, Gemini API error |
| `dialog:openFile` | `void` | `{ filePath, fileName, mimeType } \| null` | User-driven | None (cancellation returns `null` as success) |
| `upload:file` | `{ workspace, filePath }` | `UploadResultIpc` | 3-30s | Workspace not found, file not found, unsupported MIME type, Gemini API error |
| `upload:url` | `{ workspace, url }` | `UploadResultIpc` | 5-20s | Workspace not found, invalid URL, fetch failure, content extraction failure, Gemini API error |
| `upload:youtube` | `{ workspace, url, withNotes? }` | `UploadResultIpc` | 5-120s | Workspace not found, invalid YouTube URL, transcript unavailable, Gemini API error |
| `upload:note` | `{ workspace, text }` | `UploadResultIpc` | 2-5s | Workspace not found, empty text, Gemini API error |

---

### 16.4 Main Process Handlers (Section B)

All handlers are registered inside `registerIpcHandlers()` in `electron-ui/src/main/ipc-handlers.ts`. Each follows the existing `wrapError()` / `IpcResult<T>` pattern.

#### 16.4.1 New Imports

```typescript
// Added to electron-ui/src/main/ipc-handlers.ts
import path from 'node:path';
import { addWorkspace, addUpload } from '@cli/services/registry.js';
import {
  createStore, deleteStore, uploadContent, deleteDocument
} from '@cli/services/file-search.js';
import {
  extractDiskFile, extractWebPage, extractYouTubeEnhanced, extractNote
} from '@cli/services/content-extractor.js';
import { validateWorkspaceName, validateUrl } from '@cli/utils/validation.js';
import { v4 as uuidv4 } from 'uuid';
```

**Note on `path`**: The `node:path` import is not currently in `ipc-handlers.ts`. It is needed by the `dialog:openFile` handler to extract `basename` and by MIME type detection.

**Note on `uuid`**: Must be installed in `electron-ui/package.json` (`npm install uuid && npm install -D @types/uuid`). The electron-vite bundler will inline it into the main process bundle.

#### 16.4.2 Handler: `workspace:create`

```typescript
ipcMain.handle(
  'workspace:create',
  async (_event, input: { name: string }): Promise<IpcResult<{ name: string; storeName: string; createdAt: string }>> => {
    try {
      // 1. Validate name format
      validateWorkspaceName(input.name);

      // 2. Check workspace count limit (Gemini API: max 10 stores)
      const existing = listWorkspaces();
      if (existing.length >= 10) {
        throw new Error(
          'Maximum 10 workspaces reached. Delete an existing workspace before creating a new one.'
        );
      }

      // 3. Check name uniqueness (addWorkspace also checks, but we want a clear message)
      if (existing.some((ws) => ws.name === input.name)) {
        throw new Error(`Workspace '${input.name}' already exists.`);
      }

      // 4. Create Gemini File Search Store
      const ai = getClient();
      const storeName = await createStore(ai, input.name);

      // 5. Register in local registry (with rollback on failure)
      try {
        addWorkspace(input.name, storeName);
      } catch (registryError) {
        // Rollback: delete the Gemini store we just created
        try {
          await deleteStore(ai, storeName);
        } catch {
          // Best-effort rollback; log but don't mask the original error
          console.error('[workspace:create] Rollback failed: could not delete store', storeName);
        }
        throw registryError;
      }

      return {
        success: true,
        data: {
          name: input.name,
          storeName,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return wrapError(error);
    }
  }
);
```

**Service functions called**: `validateWorkspaceName`, `listWorkspaces`, `createStore`, `addWorkspace`, `deleteStore` (rollback).

#### 16.4.3 Handler: `dialog:openFile`

```typescript
ipcMain.handle(
  'dialog:openFile',
  async (): Promise<IpcResult<{ filePath: string; fileName: string; mimeType: string } | null>> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: 'Supported Files',
            extensions: [
              'pdf', 'txt', 'md', 'html', 'csv', 'doc', 'docx',
              'xls', 'xlsx', 'pptx', 'json', 'sql', 'py', 'js',
              'java', 'c', 'zip'
            ],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null };
      }

      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      const mime = await import('mime-types');
      const mimeType = mime.default.lookup(filePath) || 'application/octet-stream';

      return { success: true, data: { filePath, fileName, mimeType } };
    } catch (error) {
      return wrapError(error);
    }
  }
);
```

**Design note**: The file picker returns `null` on cancellation as a *success* result (not an error). The renderer checks for `data === null` to know the user cancelled. The `mimeType` is provided for display purposes only; `extractDiskFile` performs its own MIME validation.

#### 16.4.4 Handler: `upload:file`

```typescript
ipcMain.handle(
  'upload:file',
  async (_event, input: { workspace: string; filePath: string }): Promise<IpcResult<UploadResultIpc>> => {
    try {
      const ai = getClient();
      const ws = getWorkspace(input.workspace);

      // 1. Extract file content (validates existence and MIME type)
      const extracted = await extractDiskFile(input.filePath);

      // 2. Build Gemini custom metadata
      const customMetadata = [
        { key: 'source_type', stringValue: 'file' },
        { key: 'source_url', stringValue: input.filePath },
      ];

      // 3. Upload to Gemini File Search Store
      const docName = await uploadContent(
        ai, ws.storeName, extracted.content,
        extracted.isFilePath, extracted.mimeType,
        extracted.title, customMetadata
      );

      // 4. Register in local registry (with rollback)
      const id = uuidv4();
      const entry = {
        id,
        documentName: docName,
        title: extracted.title,
        timestamp: new Date().toISOString(),
        sourceType: 'file' as const,
        sourceUrl: input.filePath,
        expirationDate: null,
        flags: [] as string[],
      };

      try {
        addUpload(input.workspace, entry);
      } catch (registryError) {
        try {
          await deleteDocument(ai, ws.storeName, docName);
        } catch {
          console.error('[upload:file] Rollback failed: could not delete document', docName);
        }
        throw registryError;
      }

      return {
        success: true,
        data: { id, title: extracted.title, sourceType: 'file' },
      };
    } catch (error) {
      return wrapError(error);
    }
  }
);
```

**Service functions called**: `getWorkspace`, `extractDiskFile`, `uploadContent`, `addUpload`, `deleteDocument` (rollback).

**`isFilePath` handling**: `extractDiskFile` returns `isFilePath: true` and `content` set to the absolute file path. `uploadContent` passes this path string directly to the Gemini SDK, which reads the file from disk. No file content flows through IPC.

#### 16.4.5 Handler: `upload:url`

```typescript
ipcMain.handle(
  'upload:url',
  async (_event, input: { workspace: string; url: string }): Promise<IpcResult<UploadResultIpc>> => {
    try {
      validateUrl(input.url);
      const ai = getClient();
      const ws = getWorkspace(input.workspace);

      // 1. Extract web page content (fetch + Readability + Turndown)
      const extracted = await extractWebPage(input.url);

      // 2. Build metadata
      const customMetadata = [
        { key: 'source_type', stringValue: 'web' },
        { key: 'source_url', stringValue: input.url },
      ];

      // 3. Upload to Gemini
      const docName = await uploadContent(
        ai, ws.storeName, extracted.content,
        false, extracted.mimeType,
        extracted.title, customMetadata
      );

      // 4. Register with rollback
      const id = uuidv4();
      const entry = {
        id,
        documentName: docName,
        title: extracted.title,
        timestamp: new Date().toISOString(),
        sourceType: 'web' as const,
        sourceUrl: input.url,
        expirationDate: null,
        flags: [] as string[],
      };

      try {
        addUpload(input.workspace, entry);
      } catch (registryError) {
        try {
          await deleteDocument(ai, ws.storeName, docName);
        } catch {
          console.error('[upload:url] Rollback failed: could not delete document', docName);
        }
        throw registryError;
      }

      return {
        success: true,
        data: { id, title: extracted.title, sourceType: 'web' },
      };
    } catch (error) {
      return wrapError(error);
    }
  }
);
```

**jsdom/readability bundling**: `extractWebPage` imports `jsdom` and `@mozilla/readability` at module top level (in `content-extractor.ts`). Both must be externalized in `electron.vite.config.ts` to avoid bundling native modules. They resolve from the parent project's `node_modules` at runtime.

**Required externals update** in `electron.vite.config.ts`:
```typescript
external: [
  'bufferutil', 'utf-8-validate', 'canvas',
  'jsdom', 'youtube-transcript-plus',
  '@mozilla/readability', 'turndown', 'turndown-plugin-gfm', 'mime-types'
]
```

**Rationale**: `content-extractor.ts` has top-level imports for `jsdom`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, and `mime-types`. When electron-vite bundles the main process (which now imports `content-extractor.ts` via the `@cli` alias), all these must be externalized to avoid bundling issues with native/complex modules. They all exist in the parent project's `node_modules`.

#### 16.4.6 Handler: `upload:youtube`

```typescript
ipcMain.handle(
  'upload:youtube',
  async (
    _event,
    input: { workspace: string; url: string; withNotes?: boolean }
  ): Promise<IpcResult<UploadResultIpc>> => {
    try {
      // 1. Validate YouTube URL (also extracts video ID)
      extractYouTubeVideoId(input.url);

      const ai = getClient();
      const config = getConfig();
      const ws = getWorkspace(input.workspace);

      // 2. Extract enhanced YouTube content (transcript + optional notes)
      const extracted = await extractYouTubeEnhanced(input.url, {
        withNotes: input.withNotes ?? false,
        ai,
        model: config.geminiModel,
        youtubeApiKey: config.youtubeDataApiKey,
      });

      // 3. Build metadata
      const customMetadata = [
        { key: 'source_type', stringValue: 'youtube' },
        { key: 'source_url', stringValue: input.url },
      ];

      // 4. Upload to Gemini
      const docName = await uploadContent(
        ai, ws.storeName, extracted.content,
        false, extracted.mimeType,
        extracted.title, customMetadata
      );

      // 5. Register with rollback
      const id = uuidv4();
      const entry = {
        id,
        documentName: docName,
        title: extracted.title,
        timestamp: new Date().toISOString(),
        sourceType: 'youtube' as const,
        sourceUrl: input.url,
        expirationDate: null,
        flags: [] as string[],
      };

      try {
        addUpload(input.workspace, entry);
      } catch (registryError) {
        try {
          await deleteDocument(ai, ws.storeName, docName);
        } catch {
          console.error('[upload:youtube] Rollback failed: could not delete document', docName);
        }
        throw registryError;
      }

      return {
        success: true,
        data: { id, title: extracted.title, sourceType: 'youtube' },
      };
    } catch (error) {
      return wrapError(error);
    }
  }
);
```

**Service functions called**: `extractYouTubeVideoId`, `getClient`, `getConfig`, `getWorkspace`, `extractYouTubeEnhanced`, `uploadContent`, `addUpload`, `deleteDocument` (rollback).

**`withNotes` dependency**: When `withNotes: true`, `extractYouTubeEnhanced` internally calls `generateNotes(ai, model, title, transcript)`, which makes an additional Gemini API call. This is why YouTube uploads with notes take 30-120 seconds.

#### 16.4.7 Handler: `upload:note`

```typescript
ipcMain.handle(
  'upload:note',
  async (
    _event,
    input: { workspace: string; text: string }
  ): Promise<IpcResult<UploadResultIpc>> => {
    try {
      // 1. Extract note (validates non-empty, generates title from first 60 chars)
      const extracted = extractNote(input.text);

      const ai = getClient();
      const ws = getWorkspace(input.workspace);

      // 2. Build metadata (no source_url for notes)
      const customMetadata = [
        { key: 'source_type', stringValue: 'note' },
      ];

      // 3. Upload to Gemini
      const docName = await uploadContent(
        ai, ws.storeName, extracted.content,
        false, extracted.mimeType,
        extracted.title, customMetadata
      );

      // 4. Register with rollback
      const id = uuidv4();
      const entry = {
        id,
        documentName: docName,
        title: extracted.title,
        timestamp: new Date().toISOString(),
        sourceType: 'note' as const,
        sourceUrl: null,
        expirationDate: null,
        flags: [] as string[],
      };

      try {
        addUpload(input.workspace, entry);
      } catch (registryError) {
        try {
          await deleteDocument(ai, ws.storeName, docName);
        } catch {
          console.error('[upload:note] Rollback failed: could not delete document', docName);
        }
        throw registryError;
      }

      return {
        success: true,
        data: { id, title: extracted.title, sourceType: 'note' },
      };
    } catch (error) {
      return wrapError(error);
    }
  }
);
```

#### 16.4.8 Rollback Strategy (All Upload Handlers)

Every upload handler follows a two-phase commit pattern:

1. **Phase 1 (Gemini)**: Call `uploadContent()` to create the document in the Gemini File Search Store. This is an external API call that cannot be rolled back transactionally.
2. **Phase 2 (Registry)**: Call `addUpload()` to register the upload in the local JSON registry.

If Phase 2 fails after Phase 1 succeeds, the handler attempts to roll back by calling `deleteDocument(ai, storeName, docName)`. This rollback is best-effort: if it also fails, the Gemini resource becomes orphaned. Orphaned resources can be cleaned up via `geminirag delete <workspace>` from the CLI, which deletes the entire Gemini store.

The `workspace:create` handler uses the same pattern with `createStore` / `addWorkspace` / `deleteStore`.

#### 16.4.9 Externals Configuration Update

The `electron.vite.config.ts` file must be updated to externalize additional modules that `content-extractor.ts` imports at the top level:

```typescript
// electron-ui/electron.vite.config.ts - main.build.rollupOptions
external: [
  'bufferutil', 'utf-8-validate', 'canvas',
  'jsdom', '@mozilla/readability',
  'turndown', 'turndown-plugin-gfm',
  'mime-types',
  'youtube-transcript-plus'
]
```

**Rationale**: The existing handlers only import from `registry.ts`, `file-search.ts`, `filters.ts`, and `format.ts` -- none of which depend on `jsdom`, `readability`, `turndown`, or `mime-types`. The new upload handlers import from `content-extractor.ts`, which has top-level imports for all of these. Since `content-extractor.ts` is bundled via the `@cli` alias, electron-vite will attempt to bundle these dependencies. Externalizing them causes the bundler to emit `require()` calls instead, which resolve from the parent project's `node_modules` at runtime.

---

### 16.5 Preload Layer Extension (Section C -- Preload API)

#### 16.5.1 New API Methods

The following methods are added to `electron-ui/src/preload/api.ts`:

```typescript
// Added to the 'workspace' namespace
workspace: {
  // ...existing list and get...
  create: (name: string): Promise<IpcResult<{ name: string; storeName: string; createdAt: string }>> =>
    ipcRenderer.invoke('workspace:create', { name }),
},

// Added to the 'upload' namespace
upload: {
  // ...existing list, getContent, download...
  uploadFile: (workspace: string, filePath: string): Promise<IpcResult<UploadResultIpc>> =>
    ipcRenderer.invoke('upload:file', { workspace, filePath }),
  uploadUrl: (workspace: string, url: string): Promise<IpcResult<UploadResultIpc>> =>
    ipcRenderer.invoke('upload:url', { workspace, url }),
  uploadYoutube: (workspace: string, url: string, withNotes: boolean): Promise<IpcResult<UploadResultIpc>> =>
    ipcRenderer.invoke('upload:youtube', { workspace, url, withNotes }),
  uploadNote: (workspace: string, text: string): Promise<IpcResult<UploadResultIpc>> =>
    ipcRenderer.invoke('upload:note', { workspace, text }),
},

// New 'dialog' namespace
dialog: {
  openFile: (): Promise<IpcResult<{ filePath: string; fileName: string; mimeType: string } | null>> =>
    ipcRenderer.invoke('dialog:openFile'),
},
```

**Import addition**: `UploadResultIpc` must be added to the imports from `'../shared/ipc-types'`.

#### 16.5.2 Type Declarations

The `electron-ui/src/preload/index.d.ts` file uses `typeof import('./api').api` to derive the `window.api` type. Since the new methods are added directly to the `api` object in `api.ts`, the type declaration auto-reflects. **No changes to `index.d.ts` are needed.**

---

### 16.6 Zustand Store Extension (Section C)

#### 16.6.1 New State Fields

```typescript
// Added to AppStore interface in electron-ui/src/renderer/src/store/index.ts

// Workspace creation
isCreatingWorkspace: boolean;           // default: false
createWorkspaceError: string | null;    // default: null

// Upload operations
isUploading: boolean;                   // default: false
uploadError: string | null;             // default: null
uploadProgressMessage: string | null;   // default: null -- context-specific loading text
```

#### 16.6.2 New Actions

```typescript
// Added to AppStore interface

// Workspace creation
createWorkspace: (name: string) => Promise<boolean>;
clearCreateWorkspaceError: () => void;

// Upload operations
uploadFile: (filePath: string) => Promise<boolean>;
uploadUrl: (url: string) => Promise<boolean>;
uploadYoutube: (url: string, withNotes: boolean) => Promise<boolean>;
uploadNote: (text: string) => Promise<boolean>;
clearUploadError: () => void;
```

#### 16.6.3 Action Implementation: `createWorkspace`

```typescript
createWorkspace: async (name: string) => {
  set({ isCreatingWorkspace: true, createWorkspaceError: null });
  try {
    const api = getApi();
    const result = await api.workspace.create(name);
    if (result.success) {
      set({ isCreatingWorkspace: false });
      // Refresh workspace list and auto-select the new workspace
      await get().loadWorkspaces();
      get().selectWorkspace(name);
      // Trigger upload load for the newly selected workspace
      setTimeout(() => {
        useAppStore.getState().loadUploads();
      }, 0);
      return true;
    } else {
      set({
        isCreatingWorkspace: false,
        createWorkspaceError: result.error ?? 'Failed to create workspace',
      });
      return false;
    }
  } catch (err) {
    set({
      isCreatingWorkspace: false,
      createWorkspaceError: err instanceof Error ? err.message : 'Failed to create workspace',
    });
    return false;
  }
},
```

#### 16.6.4 Action Implementation Pattern: Upload Actions

All four upload actions follow the same pattern. Here is the generic form:

```typescript
uploadFile: async (filePath: string) => {
  const { selectedWorkspace } = get();
  if (!selectedWorkspace) {
    set({ uploadError: 'No workspace selected' });
    return false;
  }
  set({ isUploading: true, uploadError: null, uploadProgressMessage: 'Uploading file to Gemini...' });
  try {
    const api = getApi();
    const result = await api.upload.uploadFile(selectedWorkspace, filePath);
    if (result.success) {
      set({ isUploading: false, uploadProgressMessage: null });
      // Refresh uploads list and workspace stats
      await get().loadUploads();
      await get().loadWorkspaces();
      return true;
    } else {
      set({
        isUploading: false,
        uploadError: result.error ?? 'Upload failed',
        uploadProgressMessage: null,
      });
      return false;
    }
  } catch (err) {
    set({
      isUploading: false,
      uploadError: err instanceof Error ? err.message : 'Upload failed',
      uploadProgressMessage: null,
    });
    return false;
  }
},
```

The only variation between the four upload actions is:

| Action | API Call | Progress Message |
|--------|----------|------------------|
| `uploadFile(filePath)` | `api.upload.uploadFile(ws, filePath)` | "Uploading file to Gemini..." |
| `uploadUrl(url)` | `api.upload.uploadUrl(ws, url)` | "Fetching page content and uploading..." |
| `uploadYoutube(url, withNotes)` | `api.upload.uploadYoutube(ws, url, withNotes)` | `withNotes ? "Fetching transcript, generating AI notes, and uploading... This may take 1-2 minutes." : "Fetching transcript and uploading..."` |
| `uploadNote(text)` | `api.upload.uploadNote(ws, text)` | "Saving note..." |

#### 16.6.5 File Picker Integration

The file picker (`dialog:openFile`) is NOT part of the Zustand store. It is a UI interaction that returns a transient value (file path). The `AddContentDialog` component calls `window.api.dialog.openFile()` directly and holds the result in local React state until the user clicks "Upload".

**Rationale**: The file picker is a one-shot UI operation with no global state implications. Putting it in the store would add complexity (storing intermediate file path) without benefit.

---

### 16.7 Component Design (Section D)

#### 16.7.1 `CreateWorkspaceDialog`

**File**: `electron-ui/src/renderer/src/components/CreateWorkspaceDialog.tsx`

**Props**:
```typescript
interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Local state**:
- `name: string` -- workspace name input value

**Store connections**:
- `isCreatingWorkspace` -- controls loading state
- `createWorkspaceError` -- inline error display
- `createWorkspace(name)` -- submit action
- `clearCreateWorkspaceError()` -- clear error on dialog open/close

**UI structure**:
```
Dialog
  DialogContent (prevent close during loading)
    DialogHeader
      DialogTitle: "Create Workspace"
    form
      Input (name, placeholder="my-workspace")
      validation error text (if pattern mismatch)
      server error text (from createWorkspaceError)
    DialogFooter
      Button "Cancel" (disabled during loading)
      Button "Create" (disabled during loading or invalid input)
        LoadingSpinner when isCreatingWorkspace
        Text: "Creating workspace..." when loading
```

**Client-side validation**:
- Pattern: `/^[a-zA-Z0-9_-]+$/`
- Shown on-change if invalid characters are typed
- Submit disabled if name is empty or invalid

**Behavior**:
- On submit: calls `store.createWorkspace(name)`
- On success (returns `true`): closes dialog, clears name
- On error (returns `false`): dialog stays open, error shown from `createWorkspaceError`
- Non-dismissable during loading: `onInteractOutside={(e) => e.preventDefault()}` and `onEscapeKeyDown={(e) => e.preventDefault()}` when `isCreatingWorkspace` is true

#### 16.7.2 `AddContentDialog`

**File**: `electron-ui/src/renderer/src/components/AddContentDialog.tsx`

**Props**:
```typescript
interface AddContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Local state**:
```typescript
activeTab: string               // 'file' | 'web' | 'youtube' | 'note' (default: 'file')
// File tab
filePath: string | null
fileName: string | null
// Web tab
webUrl: string
// YouTube tab
youtubeUrl: string
withNotes: boolean              // default: false
// Note tab
noteText: string
// Shared
elapsedSeconds: number          // timer during upload
```

**Store connections**:
- `isUploading` -- shared loading state
- `uploadError` -- shared error display
- `uploadProgressMessage` -- context-specific loading text
- `uploadFile(filePath)`, `uploadUrl(url)`, `uploadYoutube(url, withNotes)`, `uploadNote(text)` -- submit actions
- `clearUploadError()` -- clear error on tab switch and dialog open/close

**UI structure**:
```
Dialog
  DialogContent (prevent close during upload)
    DialogHeader
      DialogTitle: "Add Content"
    uploadError (red text, below header)
    Tabs (activeTab)
      TabsList
        TabsTrigger "File"
        TabsTrigger "Web Page"
        TabsTrigger "YouTube"
        TabsTrigger "Note"
      TabsContent "file"
        Button "Browse..." -> calls window.api.dialog.openFile()
        fileName display (with clear button)
        Button "Upload" (disabled if no file selected)
      TabsContent "web"
        Input url (placeholder="https://example.com/article")
        validation error (if not http/https)
        Button "Upload" (disabled if empty or invalid)
      TabsContent "youtube"
        Input url (placeholder="https://www.youtube.com/watch?v=...")
        validation error (if not YouTube URL pattern)
        Checkbox "Generate AI notes"
        info text when checked: "AI notes generation adds 1-2 minutes"
        Button "Upload" (disabled if empty or invalid)
      TabsContent "note"
        Textarea (rows=6, placeholder="Type your note here...")
        title preview: "Title: {first 60 chars}..."
        Button "Save" (disabled if empty)
    Loading overlay (when isUploading)
      LoadingSpinner
      uploadProgressMessage text
      "(Xs elapsed)" counter
```

**Elapsed time counter**: Uses `useEffect` with `setInterval` when `isUploading` transitions to `true`. Cleans up on `false`. Displays as "(12s elapsed)" next to the progress message.

**Tab switching**: Disabled when `isUploading` is `true` (all `TabsTrigger` elements receive `disabled` prop).

**Auto-close**: Each tab's submit handler awaits the store action. If it returns `true`, calls `onOpenChange(false)` and resets all local state.

**File tab Browse button**: Calls `window.api.dialog.openFile()` directly. On success (non-null result), sets `filePath` and `fileName` in local state. On `null` (cancelled), no change.

#### 16.7.3 `WorkspaceSidebar` Modifications

**File**: `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx`

**Changes**:
1. Import `Plus` from `lucide-react`
2. Import `CreateWorkspaceDialog`
3. Add `useState<boolean>` for dialog open state
4. Add "+" icon button next to the existing refresh button in the header

**Modified header**:
```tsx
<div className="flex h-12 items-center justify-between px-4">
  <h2 className="text-sm font-semibold">Workspaces</h2>
  <div className="flex items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => setCreateDialogOpen(true)}
      title="Create workspace"
    >
      <Plus className="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={handleRefresh}
      disabled={workspacesLoading}
    >
      <RefreshCw className={`h-4 w-4 ${workspacesLoading ? "animate-spin" : ""}`} />
    </Button>
  </div>
</div>
```

5. Render `<CreateWorkspaceDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />` at the end of the component return.

#### 16.7.4 `UploadsTab` Modifications

**File**: `electron-ui/src/renderer/src/components/UploadsTab.tsx`

**Changes**:
1. Import `Plus` from `lucide-react`
2. Import `AddContentDialog`
3. Import `Button` from `./ui/button`
4. Add `useState<boolean>` for dialog open state
5. Add "Add Content" button above the `UploadsFilterBar`

**Modified layout**:
```tsx
return (
  <div className="flex h-full flex-col gap-2">
    <div className="flex items-center justify-between">
      <Button
        onClick={() => setAddContentOpen(true)}
        disabled={!selectedWorkspace}
        size="sm"
        className="gap-1"
      >
        <Plus className="h-4 w-4" />
        Add Content
      </Button>
    </div>
    <UploadsFilterBar />
    {uploadsLoading ? (
      <div className="flex items-center justify-center h-48">
        <LoadingSpinner label="Loading uploads..." />
      </div>
    ) : (
      <div className="flex-1 overflow-auto">
        <DataTable columns={columns} data={uploads} onRowClick={handleRowClick} />
      </div>
    )}
    <AddContentDialog open={addContentOpen} onOpenChange={setAddContentOpen} />
  </div>
)
```

---

### 16.8 File Structure (Section E)

#### 16.8.1 New Files

| File | Purpose | Phase |
|------|---------|-------|
| `electron-ui/src/renderer/src/components/CreateWorkspaceDialog.tsx` | Modal dialog for workspace creation | Phase 5 |
| `electron-ui/src/renderer/src/components/AddContentDialog.tsx` | Tabbed modal for all upload types | Phase 5 |

#### 16.8.2 Modified Files

| File | Change Summary | Phase |
|------|----------------|-------|
| `electron-ui/package.json` | Add `uuid` + `@types/uuid` | Phase 1 |
| `electron-ui/src/shared/ipc-types.ts` | Add `UploadResultIpc` + 6 channel entries | Phase 1 |
| `electron-ui/electron.vite.config.ts` | Add `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, `mime-types` to externals | Phase 2 |
| `electron-ui/src/main/ipc-handlers.ts` | Add 6 handler registrations + new imports | Phase 2 |
| `electron-ui/src/preload/api.ts` | Add 6 new API methods + `UploadResultIpc` import | Phase 3 |
| `electron-ui/src/renderer/src/store/index.ts` | Add creation/upload state + 7 actions | Phase 4 |
| `electron-ui/src/renderer/src/components/WorkspaceSidebar.tsx` | Add "+" button + CreateWorkspaceDialog | Phase 5 |
| `electron-ui/src/renderer/src/components/UploadsTab.tsx` | Add "Add Content" button + AddContentDialog | Phase 5 |

#### 16.8.3 Unchanged Files

| File | Reason |
|------|--------|
| All files under `src/` (CLI) | Service layer reused as-is |
| `electron-ui/src/preload/index.d.ts` | Auto-reflects via `typeof import('./api').api` |
| `electron-ui/src/main/service-bridge.ts` | Already provides `getClient()` and `getConfig()` |
| `electron-ui/src/main/main.ts` | No changes needed |

---

### 16.9 Implementation Units for Parallel Coding (Section F)

The implementation is organized into 6 phases with the following dependency graph:

```
Phase 1 (Foundation) ──┬──> Phase 2 (IPC Handlers) ──┐
                        └──> Phase 3 (Preload API) ───┴──> Phase 4 (Store) ──┬──> Phase 5a (CreateWorkspaceDialog + WorkspaceSidebar)
                                                                              └──> Phase 5b (AddContentDialog + UploadsTab)
                                                                                          │
                                                                                    Phase 6 (Integration Testing)
```

#### 16.9.1 Unit 1: Foundation (Phase 1)

**Files touched**: `ipc-types.ts`, `package.json`
**No file overlap with other units** (once complete, unlocks Units 2 and 3).

Tasks:
- Add `UploadResultIpc` interface to `ipc-types.ts`
- Add 6 channel entries to `IpcChannelMap`
- Install `uuid` and `@types/uuid` in `electron-ui/`

#### 16.9.2 Unit 2: Main Process Handlers (Phase 2)

**Files touched**: `ipc-handlers.ts`, `electron.vite.config.ts`
**Depends on**: Unit 1 (needs `UploadResultIpc` type).
**No file overlap** with Units 3, 4, 5a, 5b.

Tasks:
- Add new imports to `ipc-handlers.ts`
- Implement 6 `ipcMain.handle()` registrations
- Update externals in `electron.vite.config.ts`

#### 16.9.3 Unit 3: Preload API (Phase 3)

**Files touched**: `api.ts`
**Depends on**: Unit 1 (needs `UploadResultIpc` type).
**No file overlap** with Units 2, 4, 5a, 5b.
**Can run in parallel with Unit 2.**

Tasks:
- Add `UploadResultIpc` to imports
- Add `create` to `workspace` namespace
- Add 4 upload methods to `upload` namespace
- Add `dialog` namespace with `openFile`

#### 16.9.4 Unit 4: Zustand Store (Phase 4)

**Files touched**: `store/index.ts`
**Depends on**: Unit 3 (needs preload API shape for type checking).
**No file overlap** with Units 2, 3, 5a, 5b.

Tasks:
- Add 5 new state fields with defaults
- Add 7 new action implementations
- Add 2 error-clearing actions

#### 16.9.5 Unit 5a: Workspace Creation UI (Phase 5)

**Files touched**: `CreateWorkspaceDialog.tsx` (new), `WorkspaceSidebar.tsx`
**Depends on**: Unit 4 (needs store actions).
**No file overlap** with Unit 5b.
**Can run in parallel with Unit 5b.**

Tasks:
- Create `CreateWorkspaceDialog.tsx`
- Modify `WorkspaceSidebar.tsx` to add "+" button and dialog integration

#### 16.9.6 Unit 5b: Content Upload UI (Phase 5)

**Files touched**: `AddContentDialog.tsx` (new), `UploadsTab.tsx`
**Depends on**: Unit 4 (needs store actions).
**No file overlap** with Unit 5a.
**Can run in parallel with Unit 5a.**

Tasks:
- Create `AddContentDialog.tsx` with 4 tabs
- Modify `UploadsTab.tsx` to add "Add Content" button and dialog integration

#### 16.9.7 Parallelization Summary

```
Time -->
  [Unit 1] ──> [Unit 2] ──────────────┐
           └──> [Unit 3] ──> [Unit 4] ──┬──> [Unit 5a] ──> [Unit 6]
                                         └──> [Unit 5b] ──/
```

Maximum parallelism: 2 coding streams after Unit 1 completes (Units 2+3), and 2 coding streams after Unit 4 completes (Units 5a+5b).

---

### 16.10 Error Handling Matrix

| Scenario | Error Source | Handler | User-Visible Message | Recovery |
|----------|-------------|---------|---------------------|----------|
| Invalid workspace name (spaces, special chars) | `validateWorkspaceName()` | `workspace:create` | "Only alphanumeric characters, hyphens, and underscores are allowed." | Fix name in dialog |
| Duplicate workspace name | `addWorkspace()` | `workspace:create` | "Workspace 'X' already exists." | Choose different name |
| Max 10 workspaces | Count check | `workspace:create` | "Maximum 10 workspaces reached..." | Delete existing workspace first |
| Gemini store creation failed | `createStore()` | `workspace:create` | "Upload failed: [Gemini error]" | Retry |
| File not found | `extractDiskFile()` | `upload:file` | "File not found: '/path/to/file'" | Browse for correct file |
| Unsupported MIME type | `validateMimeType()` | `upload:file` | "Unsupported file type..." | Choose supported file |
| Invalid URL format | `validateUrl()` | `upload:url` | "Invalid URL format..." | Fix URL |
| URL fetch failed | `extractWebPage()` | `upload:url` | "Failed to fetch URL..." | Check URL / retry |
| Content extraction failed | Readability | `upload:url` | "Failed to extract content..." | Try different URL |
| Invalid YouTube URL | `extractYouTubeVideoId()` | `upload:youtube` | "Invalid YouTube URL..." | Fix URL |
| Transcript unavailable | `extractYouTubeEnhanced()` | `upload:youtube` | "Transcript not available..." | Try different video |
| Empty note | `extractNote()` | `upload:note` | "Note text cannot be empty" | Type content |
| Gemini upload 503 | `uploadContent()` | All upload handlers | "Upload failed: [error]" (503 fallback may or may not succeed) | Retry |
| Registry write failure after Gemini upload | `addUpload()` | All upload handlers | Error message + automatic Gemini doc cleanup | Retry |

---

### 16.11 Architectural Decision Records

#### ADR-28: Separate `dialog:openFile` IPC Channel for File Picker

**Decision**: Implement the native file picker as a separate `dialog:openFile` IPC channel, decoupled from the `upload:file` handler.

**Context**: The file picker could either be (A) a separate IPC channel that returns a file path before the upload starts, or (B) integrated into the `upload:file` handler itself.

**Rationale**:
- Option A decouples the UI interaction (file selection) from the business logic (upload). The renderer can display the selected file name and let the user confirm before initiating the potentially long upload.
- The existing codebase already uses `dialog.showSaveDialog` in the `upload:download` handler, establishing a pattern for native dialogs in IPC handlers.
- Two IPC round-trips (dialog + upload) have negligible overhead since the dialog call is instant and the upload is the slow part.
- The file picker can be reused if file selection is needed elsewhere in the UI.

**Consequences**:
- Two IPC calls per file upload instead of one
- The renderer holds the selected file path in local component state between the two calls
- The file must still exist on disk when `upload:file` runs (not a practical concern for user-initiated uploads)

#### ADR-29: Static Loading Messages Instead of Progress Streaming

**Decision**: Use static context-specific loading messages with an elapsed time counter instead of real-time progress streaming for upload operations.

**Context**: YouTube uploads with AI notes can take 30-120 seconds. True progress reporting (e.g., "Fetching transcript... Generating notes... Uploading...") would require switching from the `ipcMain.handle()` / `ipcRenderer.invoke()` request-response pattern to event-based IPC using `event.sender.send()` with `ipcRenderer.on()`.

**Rationale**:
- Switching to event-based IPC would be a significant architectural change to the existing handler pattern, affecting all six new handlers
- The `ipcMain.handle()` pattern returns a single Promise; there is no intermediate callback mechanism
- A pragmatic middle ground: the dialog shows a descriptive loading message based on the operation type and an elapsed time counter (seconds) for reassurance
- YouTube-with-notes shows a longer message: "This may take 1-2 minutes"
- The elapsed time counter is trivial to implement (`setInterval` in the React component)

**Consequences**:
- Users do not see granular phase progress (e.g., "40% transcript fetched")
- The elapsed time counter provides sufficient reassurance that the operation is still running
- If progress streaming becomes necessary in the future, it would require refactoring to event-based IPC (not covered in this design)

#### ADR-30: Modal Dialogs for Write Operations

**Decision**: Use modal dialogs (`ui/dialog`) for both workspace creation and content upload, with a tabbed interface for the four upload types.

**Context**: The upload form could be a modal dialog, a sidebar panel, a new tab, or a dropdown menu with sub-dialogs. The workspace creation form could be a modal, an inline editable item in the sidebar, or a popover.

**Rationale**:
- Modals focus user attention on the write operation and prevent accidental interactions with the rest of the UI during uploads
- The `ui/dialog` and `ui/tabs` components already exist in the project (shadcn/ui)
- The specification explicitly recommends this approach
- A single "Add Content" dialog with four tabs is more compact than four separate dialogs
- Non-dismissable during uploads (prevents data loss from accidental close)
- Consistent pattern: both write operations use the same dialog interaction model

**Consequences**:
- Modals block interaction with the main UI (acceptable for infrequent write operations)
- The AddContentDialog component is moderately complex (4 tabs with individual state), but each tab is a simple 2-3 field form
- Tab state defaults to "File" and remembers the last-used tab within the session

#### ADR-31: Externalize Content Extractor Dependencies

**Decision**: Add `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, and `mime-types` to the `external` array in `electron.vite.config.ts`.

**Context**: The new upload handlers import from `@cli/services/content-extractor.js`, which has top-level imports for `jsdom`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, and `mime-types`. The electron-vite bundler processes these via the `@cli` alias and attempts to inline them.

**Rationale**:
- `jsdom` is already externalized (Section 15). Its companion `@mozilla/readability` must also be externalized because it depends on the DOM environment
- `turndown` and `turndown-plugin-gfm` are used by `extractWebPage()` for HTML-to-Markdown conversion. They are large packages with complex internal dependencies
- `mime-types` is used by `extractDiskFile()` for MIME type detection
- All these packages exist in the parent project's `node_modules` and resolve correctly at runtime via Node.js module resolution
- Dynamic imports (`require()`) were considered but would add conditional logic complexity without meaningful benefit since the main process loads all imports at startup

**Consequences**:
- The externals list grows from 5 to 9 entries
- All externalized packages must be installed in the parent project's `node_modules` (they already are, as CLI dependencies)
- Runtime import errors (if a package is missing) surface immediately at application startup

#### ADR-32: File Picker Not in Zustand Store

**Decision**: The file picker (`dialog:openFile`) result is held in local React component state, not in the Zustand global store.

**Context**: The file picker returns a transient value (file path, file name) that is only needed until the user clicks "Upload" in the AddContentDialog.

**Rationale**:
- The file picker is a one-shot UI interaction, not application state that other components need to observe
- Storing it in Zustand would add state fields (`pendingFilePath`, `pendingFileName`) that are meaningful only within the AddContentDialog
- Local `useState` keeps the transient value scoped to the component that uses it
- The pattern is consistent with how other dialogs manage their form state (e.g., the `name` field in CreateWorkspaceDialog)

**Consequences**:
- The file path is lost if the dialog is closed and reopened (acceptable UX: user picks again)
- Other components cannot react to a file being selected (no known use case)
- Simpler store with fewer state fields

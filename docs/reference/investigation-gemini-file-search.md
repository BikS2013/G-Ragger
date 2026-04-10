# Investigation: Gemini File Search API for GeminiRAG

**Date**: 2026-04-10  
**Status**: Complete  
**Purpose**: Evaluate approaches for building the GeminiRAG CLI tool using Google's Gemini File Search API

---

## Executive Summary

The Google Gemini File Search API (via the `@google/genai` TypeScript SDK) provides a fully managed RAG system that handles chunking, embedding, and semantic search -- eliminating the need for external vector databases. The recommended approach is to build a TypeScript CLI using **Commander.js** for command parsing, the **`@google/genai` SDK** for all Gemini interactions, a **local JSON registry** at `~/.geminirag/registry.json` for mutable metadata, and lightweight extraction libraries (`@mozilla/readability` + `turndown` for web pages, `youtube-transcript` for YouTube transcripts). Custom metadata set at import time on the Gemini side (source_type, source_url) enables query-time filtering, while mutable fields (title, flags, expiration) live in the local registry.

---

## API Analysis: Gemini File Search

### Core Concepts

| Concept | Description |
|---------|-------------|
| **File Search Store** | A persistent container for document embeddings. Stores are project-scoped and persist indefinitely until deleted. Limit: **10 stores per project**. |
| **Document** | A file imported into a store. Once indexed, documents are **immutable** -- updating requires delete + re-upload. |
| **Custom Metadata** | Key-value pairs attached at import time. Types: `string_value`, `numeric_value`, `string_list_value`. Used for query-time filtering. |
| **Grounding Metadata** | Response citations linking model output to source document chunks, including custom metadata passthrough. |

### Authentication

- **API Key**: Single `GEMINI_API_KEY` from Google AI Studio (https://aistudio.google.com/apikey)
- **SDK initialization**: `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })`
- No OAuth or service account required for the AI Studio (non-Vertex) path

### Two Ingestion Pathways

1. **Direct Upload** (`fileSearchStores.uploadToFileSearchStore`): Upload file directly to a store for immediate indexing. Single operation. Best for local files.
2. **Files API + Import** (`files.upload` then `fileSearchStores.importFile`): Two-step: upload to temporary Files API storage (48-hour retention), then import into a store. Allows attaching custom metadata during import.

**Key difference**: Both pathways return a long-running operation that must be polled until complete. The Files API path gives more control over metadata attachment. Direct upload also supports `customMetadata` in its config.

### SDK: `@google/genai`

- **Package**: `@google/genai` (npm, currently v1.48.0+)
- **Language**: TypeScript-first, full type definitions
- **Key namespaces**:
  - `ai.fileSearchStores.create()` -- create a store
  - `ai.fileSearchStores.list()` -- list stores (paginated)
  - `ai.fileSearchStores.get()` -- get store by name
  - `ai.fileSearchStores.delete()` -- delete store (with `force` option)
  - `ai.fileSearchStores.uploadToFileSearchStore()` -- direct upload with metadata
  - `ai.fileSearchStores.importFile()` -- import from Files API
  - `ai.models.generateContent()` -- query with FileSearch tool
- **File upload config** (`UploadToFileSearchStoreConfig`):
  - `displayName`: human-readable name
  - `mimeType`: file MIME type
  - `customMetadata`: array of `{ key, string_value | numeric_value | string_list_value }`
  - `chunkingConfig`: optional `{ maxTokensPerChunk, maxOverlapTokens }`

### Document Management

| Operation | SDK Method | Notes |
|-----------|-----------|-------|
| List documents | `GET fileSearchStores/{store}/documents` | Paginated |
| Get document | `GET fileSearchStores/{store}/documents/{doc}` | By document resource name |
| Delete document | `DELETE fileSearchStores/{store}/documents/{doc}` | `force: true` to delete chunks |
| Update document | N/A | Immutable. Must delete + re-upload. |

### Querying with File Search

```typescript
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",  // or configured model
  contents: "user question here",
  config: {
    tools: [{
      fileSearch: {
        fileSearchStoreNames: [storeName],
        metadataFilter: 'source_type="web"',  // AIP-160 filter syntax
      }
    }]
  }
});
```

**Multi-store querying**: Pass multiple store names in `fileSearchStoreNames` array -- supports FR-37 (query across multiple workspaces).

### Metadata Filter Syntax (AIP-160)

- Equality: `key="value"`, `key=numericValue`
- Comparison: `key > value`, `key >= value`, `key < value`, `key <= value`
- Logical: `key1="val1" AND key2="val2"`
- Reference: https://google.aip.dev/160

### Grounding Metadata (Citations) Response Structure

```typescript
// response.candidates[0].groundingMetadata
{
  groundingChunks: [
    {
      retrievedContext: {
        text: "relevant excerpt...",
        title: "document title",
        uri: "fileSearchStores/.../documents/...",
        customMetadata: [
          { key: "source_type", stringValue: "web" },
          { key: "source_url", stringValue: "https://..." }
        ]
      }
    }
  ],
  groundingSupports: [
    {
      segment: { startIndex: 0, endIndex: 85, text: "..." },
      groundingChunkIndices: [0]
    }
  ]
}
```

### Supported File Formats

Text files (.txt, .md, .html), documents (.pdf, .doc, .docx), spreadsheets (.csv, .xlsx, .xls), presentations (.pptx), code files (.py, .js, .java, .cpp, etc.), JSON, SQL, Jupyter notebooks, and zip files. Each file up to **100 MB**.

### Rate Limits and Quotas

- Rate limits are **per project**, not per API key
- Limits vary by model and usage tier (auto-upgraded with spending)
- Default: ~100 RPM for many endpoints
- **10 File Search Stores per project** (hard limit as of current docs)
- RPD quotas reset at midnight Pacific time
- Experimental/preview models have stricter limits

### Pricing

- **File storage and embedding at query time**: Free
- **Initial indexing**: $0.15 per 1M tokens (embedding cost)
- **Query cost**: Standard Gemini model input/output token pricing

### Model Notes

- Gemini 2.0 Flash/Flash-Lite: **shutting down June 1, 2026** -- must use 2.5+ models
- Recommended: `gemini-2.5-flash` or `gemini-2.5-flash-lite`
- File Search works with `gemini-3-flash-preview` as well

---

## Architecture Recommendation

### CLI Framework: Commander.js

**Choice**: Commander.js  
**Justification**:
- 152M+ weekly downloads, strongest adoption
- Zero dependencies, 180KB install
- 18ms startup overhead -- fast CLI experience
- Maintenance score 100/100
- Programmatic subcommand model maps well to the `geminirag <command>` pattern
- Sufficient for our needs (we don't need yargs middleware/validation complexity)
- Already used successfully in sibling project (Gitter)

### Project Structure

```
GeminiRAG/
  src/
    cli.ts                 # Commander setup, command registration
    commands/
      workspace.ts         # create, list, delete, info
      upload.ts            # upload --file, --url, --youtube, --note
      query.ts             # ask command
      metadata.ts          # update-title, set-expiration, flag, labels, remove
      uploads.ts           # uploads listing
    services/
      gemini-client.ts     # Wrapper around @google/genai SDK
      file-search.ts       # Store/document operations
      content-extractor.ts # Web page, YouTube, note extraction
      registry.ts          # Local JSON registry CRUD
    config/
      config.ts            # Config loading (env > .env > config file)
    types/
      index.ts             # Shared TypeScript interfaces
    utils/
      format.ts            # CLI output formatting, tables
      validation.ts        # Input validation
  test_scripts/
    ...
  docs/
    design/
      project-design.md
      configuration-guide.md
    reference/
      ...
```

### Data Flow

1. **Upload**: User provides source -> content extraction (if web/youtube/note) -> upload to Gemini File Search Store with custom metadata -> register in local registry
2. **Query**: User asks question -> build FileSearch tool config with optional metadataFilter -> call generateContent -> parse grounding metadata -> display answer with citations
3. **Metadata update**: User changes title/flags/expiration -> update local registry only (Gemini metadata is immutable)
4. **Delete**: User removes upload -> delete from Gemini store -> remove from local registry

---

## Content Source Strategies

### Disk File Upload

- **Approach**: Direct upload via `fileSearchStores.uploadToFileSearchStore()`
- **Title**: `path.basename(filePath)`
- **Validation**: Check file exists, verify MIME type against supported list
- **Metadata**: `source_type: "file"`, original file path stored in local registry
- **Libraries needed**: Node.js `fs`, `path`, `mime-types` package for MIME detection

### Web Page Extraction

- **Approach**: Fetch HTML -> extract content with `@mozilla/readability` -> convert to markdown with `turndown` -> upload as `.md` file
- **Title**: Extract from `<title>` tag; fallback to hostname + path
- **Libraries**:
  - `jsdom` -- DOM parsing for Readability
  - `@mozilla/readability` -- content extraction (strips navigation, ads, footers)
  - `turndown` + `turndown-plugin-gfm` -- HTML to Markdown conversion with GFM support
- **Metadata**: `source_type: "web"`, `source_url: <url>`
- **Edge cases**: Readability may miss content on some sites; `web-to-markdown` package (wraps readability + turndown) is an alternative that includes fallback strategies

### YouTube Transcript Extraction

- **Approach**: Extract video ID -> fetch transcript -> combine into plain text -> upload as `.txt`
- **Title**: Fetch via YouTube oEmbed endpoint (no API key needed): `https://www.youtube.com/oembed?url=<url>&format=json` returns `{ title, author_name, ... }`
- **Transcript**: Use `youtube-transcript` npm package (90+ dependents, TypeScript support, no API key needed)
- **Libraries**:
  - `youtube-transcript` (v1.3.0) -- transcript extraction
  - Built-in `fetch` (Node.js 18+) -- oEmbed title retrieval
- **Metadata**: `source_type: "youtube"`, `source_url: <url>`
- **Error handling**: If no transcript available, abort with clear error (FR-20)

### Personal Note

- **Approach**: Accept text input (CLI argument or stdin) -> save as plain text -> upload as `.txt`
- **Title**: First 60 characters trimmed to word boundary + ellipsis (per assumption #6 in spec)
- **Libraries**: None additional
- **Metadata**: `source_type: "note"`

---

## Metadata Strategy

### Dual-Layer Approach

The Gemini File Search API allows custom metadata at import time but metadata is **immutable** after creation. This creates a natural split:

| Layer | Storage | Content | Mutable |
|-------|---------|---------|---------|
| **Gemini-side** | File Search Store | `source_type`, `source_url` | No (set at import) |
| **Local registry** | `~/.geminirag/registry.json` | All fields (id, document_name, title, timestamp, source_type, source_url, expiration_date, flags) | Yes (title, expiration, flags) |

### Why This Split

1. **`source_type` and `source_url` on Gemini side**: These are immutable and needed for **query-time filtering** via `metadataFilter`. Storing them as Gemini custom metadata enables the API to filter before semantic search.
2. **All fields in local registry**: Provides the single source of truth for display, listing, and mutable operations. The local registry is the authoritative metadata store.

### Local Registry Schema

```json
{
  "workspaces": {
    "my-research": {
      "name": "my-research",
      "storeName": "fileSearchStores/abc123",
      "createdAt": "2026-04-10T12:00:00Z",
      "uploads": {
        "uuid-1": {
          "id": "uuid-1",
          "documentName": "fileSearchStores/abc123/documents/doc-xyz",
          "title": "report.pdf",
          "timestamp": "2026-04-10T12:01:00Z",
          "sourceType": "file",
          "sourceUrl": "/path/to/report.pdf",
          "expirationDate": null,
          "flags": []
        }
      }
    }
  }
}
```

### Metadata Filter Translation

User CLI filters need to be translated to AIP-160 syntax for the Gemini API:

| CLI Filter | AIP-160 Equivalent |
|------------|-------------------|
| `--filter source_type=web` | `source_type="web"` |
| `--filter source_type=youtube` | `source_type="youtube"` |

Filters on mutable fields (flags, expiration_date) must be applied **locally** after Gemini returns results, since those fields only exist in the local registry.

---

## Technology Choices

### Core Dependencies

| Package | Version | Purpose | Justification |
|---------|---------|---------|---------------|
| `@google/genai` | ^1.48.0 | Gemini API SDK | Official Google SDK, TypeScript-first, full File Search Store support |
| `commander` | ^12.x | CLI framework | Zero deps, fast, well-maintained, familiar pattern from Gitter project |
| `dotenv` | ^16.x | .env file loading | Standard, minimal |
| `uuid` | ^10.x | Upload ID generation | RFC-compliant UUID generation |

### Content Extraction Dependencies

| Package | Purpose | Justification |
|---------|---------|---------------|
| `jsdom` | DOM parsing | Required by @mozilla/readability for HTML parsing |
| `@mozilla/readability` | Web content extraction | Same algorithm as Firefox Reader View, well-tested |
| `turndown` | HTML to Markdown | Standard, extensible, pairs with Readability |
| `turndown-plugin-gfm` | GFM support for Turndown | Tables, strikethrough, task lists |
| `youtube-transcript` | YouTube transcript extraction | Most popular, no API key needed, TypeScript support |
| `mime-types` | MIME type detection | For validating file uploads against supported types |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `tsx` | TypeScript execution (dev mode) |
| `@types/node` | Node.js type definitions |
| `@types/jsdom` | jsdom type definitions |
| `@types/turndown` | turndown type definitions |

### Alternatives Considered and Rejected

| Alternative | Rejected Because |
|-------------|-----------------|
| **Yargs** (CLI) | Heavier (7 deps, 850KB), lower maintenance score, commander sufficient for our needs |
| **LangChain** | Unnecessary abstraction layer; direct SDK is simpler and more maintainable |
| **web-to-markdown** (npm) | Convenient but wraps readability+turndown -- we want direct control for error handling |
| **youtube-transcript-sdk** | Requires API key (paid service); `youtube-transcript` is free |
| **Pinecone/ChromaDB** | Unnecessary; Gemini File Search handles the entire vector DB layer |

---

## Risks and Mitigations

### Risk 1: 10 File Search Stores Limit Per Project

- **Impact**: High -- directly limits number of workspaces
- **Mitigation**: Document this limit clearly. Users can create multiple Google Cloud projects. Consider future feature to use a single store with metadata-based workspace separation (uploading all docs to one store, filtering by `workspace` metadata key).
- **Monitor**: Google may increase this limit; track API changelog.

### Risk 2: YouTube Transcript Unavailability

- **Impact**: Medium -- some videos lack captions/transcripts
- **Mitigation**: Clear error messaging (FR-20). Document that only videos with available captions are supported. The `youtube-transcript` library scrapes YouTube directly, which could break if YouTube changes their page structure.
- **Fallback**: Could add AssemblyAI speech-to-text as a future enhancement for videos without captions.

### Risk 3: Web Content Extraction Quality

- **Impact**: Medium -- Readability may fail on some sites (SPAs, paywalled content, heavy JS rendering)
- **Mitigation**: Readability works on static HTML; if it fails to extract meaningful content, fall back to `<article>` or `<main>` elements. Log warnings for low-quality extractions. Consider adding a `--raw` option to upload raw HTML.

### Risk 4: Gemini Custom Metadata is Immutable

- **Impact**: Low (already accounted for in design) -- mutable fields handled locally
- **Mitigation**: Dual-layer metadata strategy. Only immutable, query-relevant fields stored on Gemini side.

### Risk 5: Model Deprecation (Gemini 2.0 EOL June 2026)

- **Impact**: Medium -- users on older model configs will face breakage
- **Mitigation**: Config requires explicit model specification (no defaults). Document recommended models. API key expiration warning already planned.

### Risk 6: Long-Running Operation Polling

- **Impact**: Low -- uploads are async operations that need polling
- **Mitigation**: Implement polling with exponential backoff and timeout. Show progress indicator in CLI.

### Risk 7: Local Registry Data Loss/Corruption

- **Impact**: Medium -- registry is the single mutable metadata store
- **Mitigation**: Write registry atomically (write to temp file, then rename). Consider adding a `sync` command that reconciles local registry with Gemini store contents.

### Risk 8: Rate Limiting During Bulk Operations

- **Impact**: Low -- single-user tool with individual uploads
- **Mitigation**: Respect rate limits with retry logic and exponential backoff. The spec explicitly excludes bulk import (out of scope #5).

---

## Technical Research Guidance

Research needed: Yes

### Topic 1: File Search Store Document Listing API (TypeScript)

- **Why**: The SDK documentation shows REST endpoints for listing/getting/deleting documents, but the exact TypeScript SDK method signatures for document operations are not fully documented in the context7 results. Need to confirm the exact SDK API surface for `ai.fileSearchStores.documents.list()` or equivalent.
- **Focus**: Verify the TypeScript SDK methods for listing documents in a store, getting a document by name, and deleting a document. Confirm whether these are on the `fileSearchStores` namespace or require direct REST calls.
- **Depth**: shallow -- a quick check of the SDK source or types file should suffice.

### Topic 2: Operation Polling Pattern in `@google/genai` SDK

- **Why**: Upload and import return long-running operations. The SDK may provide built-in polling helpers, or we may need to implement manual polling. The exact pattern for waiting on operation completion in TypeScript is critical for a reliable upload flow.
- **Focus**: Check if the SDK has `operation.waitForCompletion()` or similar, or if we need to poll `operations.get()` manually. Determine the operation status fields and completion indicators.
- **Depth**: shallow -- check SDK types and one working example.

### Topic 3: `metadataFilter` with `string_list_value` Type

- **Why**: The spec mentions flags stored as an array. If we store flags as `string_list_value` metadata on the Gemini side, we need to confirm the AIP-160 filter syntax for list membership queries (e.g., "does the list contain 'urgent'?").
- **Focus**: Determine whether `string_list_value` metadata can be filtered with AIP-160 syntax and what the filter expression looks like. If not filterable, flags must remain local-only.
- **Depth**: medium -- may require testing against the API or finding forum posts/docs.

### Topic 4: Blob Upload for Generated Content (Web/YouTube/Notes)

- **Why**: For web pages, YouTube transcripts, and notes, we generate text content in memory (not from a file on disk). We need to confirm the exact mechanism for uploading in-memory content (Blob/Buffer) to a File Search Store via the TypeScript SDK, including MIME type handling.
- **Focus**: Verify that `uploadToFileSearchStore` accepts a `Blob` object with `text/plain` or `text/markdown` MIME type for in-memory content. Check if there are size or encoding constraints.
- **Depth**: shallow -- SDK types show `file: string | Blob`, but need a working example with Blob.

---

## References

- [Gemini File Search Documentation](https://ai.google.dev/gemini-api/docs/file-search) (last updated 2026-04-02)
- [File Search Stores API Reference](https://ai.google.dev/api/file-search/file-search-stores)
- [Documents API Reference](https://ai.google.dev/api/file-search/documents)
- [AIP-160 Filter Syntax](https://google.aip.dev/160)
- [@google/genai SDK on npm](https://www.npmjs.com/package/@google/genai)
- [@google/genai SDK on GitHub](https://github.com/googleapis/js-genai)
- [Gemini File Search JavaScript Tutorial (philschmid.de)](https://www.philschmid.de/gemini-file-search-javascript)
- [Google Gemini Cookbook - File_Search.ipynb](https://github.com/google-gemini/cookbook/blob/main/quickstarts/File_Search.ipynb)
- [Google Codelab: File Search for RAG](https://codelabs.developers.google.com/gemini-file-search-for-rag)
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Commander.js on npm](https://www.npmjs.com/package/commander)
- [youtube-transcript on npm](https://www.npmjs.com/package/youtube-transcript)
- [@mozilla/readability on npm](https://www.npmjs.com/package/@mozilla/readability)
- [Turndown on GitHub](https://github.com/mixmark-io/turndown)
- [YouTube oEmbed Endpoint](https://www.youtube.com/oembed?url=URL&format=json)

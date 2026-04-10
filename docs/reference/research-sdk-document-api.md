# Research: File Search Store Document API — @google/genai TypeScript SDK

**Date**: 2026-04-10
**SDK Version Verified Against**: @google/genai v1.49.0 (latest as of research date)
**Status**: Complete
**Research Depth**: Shallow — method signatures and working examples

---

## Overview

The `@google/genai` SDK exposes document-level operations through a **nested `documents` class** on `fileSearchStores`. This is accessed as `client.fileSearchStores.documents` and provides three methods: `list`, `get`, and `delete`. These are first-class SDK methods — no direct REST calls are required.

**Key version note**: File Search Store support (including `documents.*` methods) was introduced in `@google/genai` v1.29.0 (released November 2025). Any project using an earlier version must upgrade.

---

## Key Finding: Namespace Structure

The document management API sits on a nested class, not directly on `fileSearchStores`:

```
client.fileSearchStores            // store-level operations
client.fileSearchStores.documents  // document-level operations (nested class)
```

The `Documents` class interface is:

```typescript
class Documents {
  list(params: ListDocumentsParameters): Promise<Pager<Document>>;
  get(params: GetDocumentParameters): Promise<Document>;
  delete(params: DeleteDocumentParameters): Promise<void>;
}
```

---

## Document Type Definition

```typescript
interface Document {
  name?: string;           // Full resource name: "fileSearchStores/{store}/documents/{doc}"
  displayName?: string;    // Human-readable name set at upload time
  mimeType?: string;       // MIME type of the uploaded file
  sizeBytes?: string;      // File size as a string (note: string, not number)
  createTime?: string;     // ISO 8601 timestamp
  updateTime?: string;     // ISO 8601 timestamp
  state?: DocumentState;   // Processing state
  metadata?: Record<string, string>;  // Custom metadata (key-value pairs)
}

enum DocumentState {
  DOCUMENT_STATE_UNSPECIFIED = 'DOCUMENT_STATE_UNSPECIFIED',
  PROCESSING = 'PROCESSING',   // Still being indexed
  ACTIVE = 'ACTIVE',           // Ready for search
  FAILED = 'FAILED'            // Indexing failed
}
```

**Important**: `sizeBytes` is typed as `string`, not `number`. Parse with `parseInt(doc.sizeBytes ?? '0')` when needed.

---

## Method Signatures

### `documents.list()` — List All Documents in a Store

```typescript
function list(params: ListDocumentsParameters): Promise<Pager<Document>>;

interface ListDocumentsParameters {
  parent: string;              // Required: store resource name, e.g. "fileSearchStores/abc123"
  config?: ListDocumentsConfig;
}

interface ListDocumentsConfig {
  pageSize?: number;           // Max documents per page
  pageToken?: string;          // Token for pagination
  httpOptions?: HttpOptions;
  abortSignal?: AbortSignal;
}
```

**Returns**: `Promise<Pager<Document>>` — a paginated iterator, not a plain array.

**Usage example:**

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Iterate all documents (handles pagination automatically)
const pager = await ai.fileSearchStores.documents.list({
  parent: 'fileSearchStores/abc123',
  config: { pageSize: 20 }
});

for await (const doc of pager) {
  console.log(doc.name, doc.displayName, doc.state);
}
```

**Manual pagination (when you need to search across pages):**

```typescript
// Find a document by displayName across paginated results
const docToFind = 'report.pdf';
let targetDoc: Document | null = null;

let documentPager = await ai.fileSearchStores.documents.list({
  parent: storeName,
});

searchLoop: while (true) {
  for (const doc of documentPager.page) {
    if (doc.displayName === docToFind) {
      targetDoc = doc;
      break searchLoop;
    }
  }
  if (!documentPager.hasNextPage()) break;
  documentPager = await documentPager.nextPage();
}
```

---

### `documents.get()` — Get a Document by Name

```typescript
function get(params: GetDocumentParameters): Promise<Document>;

interface GetDocumentParameters {
  name: string;              // Required: full document resource name
                             // e.g. "fileSearchStores/abc123/documents/doc456"
  config?: GetDocumentConfig;
}

interface GetDocumentConfig {
  httpOptions?: HttpOptions;
  abortSignal?: AbortSignal;
}
```

**Usage example:**

```typescript
const doc = await ai.fileSearchStores.documents.get({
  name: 'fileSearchStores/abc123/documents/doc456'
});

console.log(doc.displayName, doc.mimeType, doc.state);
```

**Practical note**: You typically don't call `get()` directly by a guessed name. The normal workflow is to call `list()` to discover `doc.name` (the full resource name), then use that name for targeted operations.

---

### `documents.delete()` — Delete a Document

```typescript
function delete(params: DeleteDocumentParameters): Promise<void>;

interface DeleteDocumentParameters {
  name: string;              // Required: full document resource name
                             // e.g. "fileSearchStores/abc123/documents/doc456"
  config?: DeleteDocumentConfig;
}

interface DeleteDocumentConfig {
  force?: boolean;           // Required to permanently delete an indexed document
  httpOptions?: HttpOptions;
  abortSignal?: AbortSignal;
}
```

**Usage example:**

```typescript
await ai.fileSearchStores.documents.delete({
  name: 'fileSearchStores/abc123/documents/doc456',
  config: { force: true }
});
```

**Critical**: The `force: true` flag in `config` is required to permanently delete an indexed (ACTIVE) document. Without it, the call may fail or leave document artifacts. This is distinct from the store-level `delete`, which also takes `force` but in the same `config` shape.

---

## Complete Delete + Re-upload Pattern

Since documents are immutable, this is the standard update pattern:

```typescript
async function replaceDocument(
  ai: GoogleGenAI,
  storeName: string,
  displayName: string,
  newFilePath: string
): Promise<void> {
  // Step 1: Find existing document by displayName
  let foundDoc: Document | null = null;
  let pager = await ai.fileSearchStores.documents.list({ parent: storeName });

  findLoop: while (true) {
    for (const doc of pager.page) {
      if (doc.displayName === displayName) {
        foundDoc = doc;
        break findLoop;
      }
    }
    if (!pager.hasNextPage()) break;
    pager = await pager.nextPage();
  }

  // Step 2: Delete existing document if found
  if (foundDoc?.name) {
    await ai.fileSearchStores.documents.delete({
      name: foundDoc.name,
      config: { force: true }
    });
  }

  // Step 3: Upload new version and poll until done
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName: storeName,
    file: newFilePath,
    config: { displayName }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${operation.error.message}`);
  }
}
```

---

## Confirmed Namespace — No Direct REST Calls Needed

All three document operations (`list`, `get`, `delete`) are available as proper TypeScript SDK methods under `client.fileSearchStores.documents.*`. There is no need to make raw REST calls for standard document management.

Summary of the full SDK surface for this feature area:

| Operation | Method | Notes |
|-----------|--------|-------|
| List documents | `ai.fileSearchStores.documents.list({ parent })` | Returns `Pager<Document>`, paginated |
| Get document | `ai.fileSearchStores.documents.get({ name })` | Requires full resource name |
| Delete document | `ai.fileSearchStores.documents.delete({ name, config: { force: true } })` | `force: true` required for ACTIVE docs |
| Upload document | `ai.fileSearchStores.uploadToFileSearchStore({ fileSearchStoreName, file, config })` | Returns long-running operation |
| Poll operation | `ai.operations.get({ operation })` | Used to poll upload completion |

---

## Practical Guidance for GeminiRAG CLI

### Listing Documents for a Workspace

When implementing the `uploads list` command, use `documents.list()` against the store name stored in the local registry, then cross-reference results with local registry entries by `documentName`:

```typescript
const pager = await ai.fileSearchStores.documents.list({
  parent: workspace.storeName
});

for await (const doc of pager) {
  const localEntry = Object.values(workspace.uploads)
    .find(u => u.documentName === doc.name);
  // Merge Gemini doc.state with local registry metadata for display
}
```

### Checking Document State

After upload, a document is in `PROCESSING` state. Only `ACTIVE` documents are searchable. The polling loop during upload handles this, but the `state` field in `documents.list()` output can be used to diagnose stale/failed documents.

### Deleting from GeminiRAG

The `remove` command needs to:
1. Look up `documentName` from local registry by upload ID
2. Call `ai.fileSearchStores.documents.delete({ name: documentName, config: { force: true } })`
3. Remove from local registry

No need to call `documents.list()` first if `documentName` is already stored in the local registry.

---

## Uncertainties and Notes

| Topic | Finding | Confidence |
|-------|---------|------------|
| `force` flag behavior | Required for ACTIVE documents; omitting may cause silent failure or error | MEDIUM — observed in tutorial but not formally documented in Tessl spec |
| `metadata` field on `Document` type | Typed as `Record<string, string>` in Tessl spec, but custom metadata at upload uses structured types (`stringValue`, `numericValue`, `stringListValue`) — may be flattened on retrieval | LOW — needs empirical testing |
| `documents.get()` by inferred name | The document name format is `fileSearchStores/{store}/documents/{id}` where `{id}` is opaque — must be discovered via `list()` | HIGH |
| Python SDK vs TypeScript SDK | The November 2025 forum thread showed the Python SDK lacking `documents.delete()` at that time. By the time of the philschmid tutorial (2026), the TypeScript SDK has confirmed support. The forum confusion was about the Python SDK, not TypeScript. | HIGH — TypeScript SDK support confirmed |

---

## Assumptions and Scope

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| SDK v1.29.0+ required for all document methods | HIGH | Projects on older versions will get `undefined` errors on `documents.*` |
| `force: true` must be in `config`, not at the top level | MEDIUM | See philschmid example — `config: { force: true }`. The forum thread shows a Python user passing `force=True` at top level which failed. TypeScript path is via `config`. |
| `Pager<Document>` supports `for await...of` iteration | HIGH | Consistent with how `fileSearchStores.list()` pager works |
| Document metadata returned by `list()` matches custom metadata set at upload | LOW — needs verification | If false, must use grounding metadata from query responses to inspect custom metadata |

---

## Clarifying Questions for Follow-up

1. Does the `Document` type returned by `documents.list()` include the `customMetadata` (structured) that was set at upload time, or only scalar `metadata: Record<string, string>`? This affects whether document listing can show `source_type`/`source_url` without querying.
2. Is `force: true` silently ignored for PROCESSING documents, or does delete block/fail until processing completes?
3. Does `documents.get()` have lower latency than `documents.list()` when you already have the `documentName` stored locally (which is always the case in GeminiRAG)?

---

## Assumptions and Scope Section

- **In scope**: TypeScript `@google/genai` SDK document listing, get, and delete methods. Method signatures, parameter types, return types, and working code examples.
- **Out of scope**: Python SDK, Vertex AI path (File Search is Gemini Developer API only), upload/import operations (covered in investigation doc), operation polling (separate research topic).
- **Interpretation**: "Document listing" was interpreted as the `documents.list()` paginated method. The `get()` method is included as it is the single-document retrieval complement.

---

## References

| Source | URL | Information Used |
|--------|-----|-----------------|
| @google/genai SDK official docs (Tessl registry mirror, v1.30.0) | https://tessl.io/registry/tessl/npm-google--genai/1.30.0/files/docs/file-search-stores.md | Complete interface definitions for `Documents` class, all method signatures, `Document` type, `DocumentState` enum |
| Philschmid.de JavaScript Tutorial | https://www.philschmid.de/gemini-file-search-javascript | Working TypeScript code examples for `documents.list()`, `documents.delete()` with `force: true`, and operation polling |
| Context7 / googleapis/js-genai API report | https://github.com/googleapis/js-genai/blob/main/api-report/genai.api.md | Store-level method signatures confirmed; document-level not in Context7 results (confirms they are nested) |
| Google AI Developers Forum | https://discuss.ai.google.dev/t/file-search-api-delete-prevailing-contents-from-the-store/109805 | Historical context — Python SDK lacked `documents.delete()` in Nov 2025; TypeScript SDK confirmed working via philschmid tutorial |
| npm registry (@google/genai latest) | https://registry.npmjs.org/@google/genai/latest | Confirmed current version is 1.49.0 as of 2026-04-10 |

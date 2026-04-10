# Blob Upload for Generated Content in the Gemini File Search SDK

**Date**: 2026-04-10
**Status**: Complete
**Scope**: How to upload in-memory text content (Blob/Buffer) to a Gemini File Search Store via the `@google/genai` TypeScript SDK.

---

## Overview

For web pages, YouTube transcripts, and notes, the GeminiRAG CLI generates text content entirely in memory -- there is no intermediate file on disk. The question is whether `uploadToFileSearchStore` can accept a `Blob` object directly, or whether we must first write a temporary file and then upload by path.

**Finding**: The SDK natively accepts a `Blob` object as the `file` parameter. No temporary file is required.

---

## Key Concepts

### The `file` Parameter Type

The TypeScript SDK types (from the official `@google/genai` API report) define:

```typescript
export interface UploadToFileSearchStoreParameters {
    config?: UploadToFileSearchStoreConfig;
    file: string | globalThis.Blob;   // <-- accepts either a file path OR a Blob
    fileSearchStoreName: string;
}
```

`globalThis.Blob` is the standard Web API `Blob` class. In Node.js 18+, `Blob` is available globally. Both a file path string (resolved by the Node.js uploader using `fs`) and a `Blob` object are first-class inputs.

### The `mimeType` Config Field

```typescript
export interface UploadToFileSearchStoreConfig {
    abortSignal?: AbortSignal;
    chunkingConfig?: ChunkingConfig;
    customMetadata?: CustomMetadata[];
    displayName?: string;
    httpOptions?: HttpOptions;
    mimeType?: string;   // <-- optional: inferred from Blob.type if omitted
}
```

`mimeType` is optional in two situations:
- When `file` is a path string: inferred from the file extension.
- When `file` is a `Blob`: inferred from the `Blob`'s `type` property.

For in-memory text content, the recommended approach is to embed the MIME type in the `Blob` constructor itself (`new Blob([text], { type: 'text/plain' })`). This makes the object self-describing and removes the need to repeat it in `config.mimeType`.

### Supported MIME Types for Text Content

The File Search Store accepts any supported document format. For generated text content:

| Content Source | Recommended MIME Type | Blob Constructor |
|---------------|----------------------|-----------------|
| Web page (Markdown) | `text/markdown` | `new Blob([markdown], { type: 'text/markdown' })` |
| YouTube transcript | `text/plain` | `new Blob([transcript], { type: 'text/plain' })` |
| Personal note | `text/plain` | `new Blob([note], { type: 'text/plain' })` |

Both `text/plain` and `text/markdown` are in the list of supported file formats documented for File Search (`.txt`, `.md`).

---

## Code Patterns

### Pattern 1: Upload In-Memory Markdown (Web Pages)

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function uploadWebContent(
  markdownContent: string,
  storeName: string,
  sourceUrl: string,
  title: string
): Promise<string> {
  // Create a Blob from the in-memory markdown string.
  // The type property sets the MIME type automatically.
  const blob = new Blob([markdownContent], { type: 'text/markdown' });

  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: storeName,
    config: {
      displayName: title,
      customMetadata: [
        { key: 'source_type', stringValue: 'web' },
        { key: 'source_url', stringValue: sourceUrl },
      ],
    },
  });

  // Poll until indexing is complete
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
  }

  // operation.response.documentName is the Gemini document resource name
  return operation.response!.documentName!;
}
```

### Pattern 2: Upload In-Memory Plain Text (YouTube / Notes)

```typescript
async function uploadTextContent(
  textContent: string,
  storeName: string,
  sourceType: 'youtube' | 'note',
  title: string,
  sourceUrl?: string
): Promise<string> {
  const blob = new Blob([textContent], { type: 'text/plain' });

  const customMetadata: Array<{ key: string; stringValue: string }> = [
    { key: 'source_type', stringValue: sourceType },
  ];
  if (sourceUrl) {
    customMetadata.push({ key: 'source_url', stringValue: sourceUrl });
  }

  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: storeName,
    config: {
      displayName: title,
      customMetadata,
    },
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
  }

  return operation.response!.documentName!;
}
```

### Pattern 3: Encoding Awareness (UTF-8)

Node.js `Blob` uses UTF-8 encoding when initialized with a string. The Gemini API expects UTF-8 for text content. No explicit encoding step is needed:

```typescript
// This is sufficient -- Node.js Blob encodes the string as UTF-8 internally
const blob = new Blob([markdownString], { type: 'text/plain' });

// DO NOT do this -- Buffer conversion adds no value and complicates things
// const buffer = Buffer.from(markdownString, 'utf-8');
// const blob = new Blob([buffer], { type: 'text/plain' });
// (Both produce identical results; prefer the string form.)
```

### Pattern 4: Explicit mimeType Override (When Needed)

If the `Blob` is created without a type (e.g., from a third-party library that returns a typeless `Blob`), override `mimeType` in the config:

```typescript
const blob = new Blob([content]); // no type set -- blob.type === ''

let operation = await ai.fileSearchStores.uploadToFileSearchStore({
  file: blob,
  fileSearchStoreName: storeName,
  config: {
    displayName: title,
    mimeType: 'text/plain',  // explicit override when blob.type is empty
  },
});
```

---

## Size and Encoding Constraints

| Constraint | Value | Source |
|-----------|-------|--------|
| Maximum file size per upload | **100 MB** | Gemini File Search documentation |
| Encoding for text | UTF-8 (Node.js Blob default) | Node.js Blob specification |
| Minimum file size | Not documented; assume >0 bytes | N/A |
| MIME type required? | No -- inferred from `Blob.type` or `config.mimeType` | SDK API types |

For GeminiRAG use cases:
- Web pages as Markdown: typically 5 KB -- 500 KB. Well within limits.
- YouTube transcripts as plain text: typically 10 KB -- 200 KB. Well within limits.
- Notes: user-defined; must be under 100 MB (which is not a practical concern).

---

## How the SDK Handles Blob Internally

The SDK's `NodeUploader` class (from the internal API report) has this signature:

```typescript
class NodeUploader implements Uploader {
    stat(file: string | Blob): Promise<FileStat>;
    upload(file: string | Blob, uploadUrl: string, apiClient: ApiClient, httpOptions?: HttpOptions): Promise<File>;
    uploadToFileSearchStore(file: string | Blob, uploadUrl: string, apiClient: ApiClient, httpOptions?: HttpOptions): Promise<UploadToFileSearchStoreOperation>;
}
```

When `file` is a `Blob`:
- The uploader reads the Blob's `size` property to set `Content-Length`.
- It uses the Blob's `type` property for `Content-Type` (unless overridden by `config.mimeType`).
- It reads the Blob's byte stream for the upload body.
- No filesystem access occurs -- it is entirely in-memory.

When `file` is a string (file path):
- The uploader calls `fs.stat()` to get file size.
- It infers MIME type from the file extension.
- It creates a read stream from the file path.

---

## Operation Polling Pattern

`uploadToFileSearchStore` initiates a long-running operation. The returned `UploadToFileSearchStoreOperation` object must be polled:

```typescript
// The operation object after initial call
// operation.done === false  (indexing in progress)
// operation.name === "operations/some-id"

// Poll with ai.operations.get()
while (!operation.done) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  operation = await ai.operations.get({ operation });
}

// Completed states:
// operation.done === true && operation.response  -> success
// operation.done === true && operation.error     -> failure

if (operation.error) {
  throw new Error(`Indexing failed: ${JSON.stringify(operation.error)}`);
}

// Access the document name from the response
const documentName = operation.response?.documentName;
// Format: "fileSearchStores/{store-id}/documents/{doc-id}"
```

The `UploadToFileSearchStoreResponse` type confirms the available fields:

```typescript
class UploadToFileSearchStoreResponse {
    documentName?: string;   // the created document resource name
    parent?: string;         // the store name
    sdkHttpResponse?: HttpResponse;
}
```

---

## Complete Working Example

This is a minimal, self-contained example that demonstrates uploading a web page's extracted Markdown content as a Blob:

```typescript
import { GoogleGenAI } from '@google/genai';

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Step 1: Create or get a store (assume storeName is already known)
  const storeName = 'fileSearchStores/my-workspace';

  // Step 2: In-memory content (e.g., extracted from a web page)
  const markdownContent = `# Example Document\n\nThis content was extracted in memory from a web page.\n`;

  // Step 3: Create a Blob with the appropriate MIME type
  const blob = new Blob([markdownContent], { type: 'text/markdown' });

  // Step 4: Upload the Blob directly -- no temp file needed
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: storeName,
    config: {
      displayName: 'Example Web Page',
      customMetadata: [
        { key: 'source_type', stringValue: 'web' },
        { key: 'source_url', stringValue: 'https://example.com/article' },
      ],
    },
  });

  // Step 5: Poll until indexing is complete
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
  }

  console.log('Document indexed:', operation.response?.documentName);
}

main().catch(console.error);
```

---

## Recommendations for GeminiRAG Implementation

1. **Use `Blob` directly for web/YouTube/note content.** Do not write temporary files to disk; this avoids temp file cleanup, permission issues, and I/O overhead.

2. **Always set the MIME type in the `Blob` constructor.** `new Blob([text], { type: 'text/markdown' })` for web content, `new Blob([text], { type: 'text/plain' })` for transcripts and notes. This keeps the object self-describing.

3. **Do not set `config.mimeType` redundantly** when the `Blob.type` is already set correctly. Reserve `config.mimeType` for the case where you receive a typeless `Blob` from a library.

4. **Use a 2-second polling interval** with a maximum timeout (e.g., 120 seconds / 60 polls). Uploads of small text documents typically complete in 5--30 seconds.

5. **Check `operation.error` after `operation.done`** before accessing `operation.response`. An operation can finish with an error.

6. **Store `operation.response.documentName`** in the local registry immediately after a successful upload. This is the resource name needed for future delete operations.

---

## Assumptions and Scope

| Assumption | Confidence | Impact if Wrong |
|-----------|-----------|-----------------|
| Node.js 18+ is the runtime (global `Blob` available) | HIGH | On Node.js <18, `Blob` must be imported from `node:buffer` |
| `text/markdown` is accepted by the File Search ingestion pipeline | MEDIUM | Could fall back to `text/plain`; content would still be indexed |
| `Blob.type` is used as `Content-Type` when `config.mimeType` is not set | HIGH | Would need to always set `config.mimeType` explicitly |
| Polling at 2-second intervals is appropriate for small uploads | MEDIUM | Longer documents may take more time; 5-second intervals are safer |

### What is explicitly out of scope

- Streaming uploads (not supported by this API -- uploads are single-shot)
- The `files.upload()` + `fileSearchStores.importFile()` two-step pathway (covered separately)
- Browser environment `Blob` handling (project targets Node.js CLI)
- Binary content uploads (PDF, DOCX) -- those use file paths, not in-memory Blobs in GeminiRAG

---

## Clarifying Questions for Follow-up

1. Should we add an explicit timeout to the polling loop, and if so, what is the acceptable maximum wait time per upload?
2. Is `text/markdown` actually indexed differently from `text/plain` by the Gemini embedding pipeline, or are they treated identically?
3. Does the 100 MB limit apply to the raw text byte size, or the processed token count?

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | `@google/genai` SDK API Report (official) | https://raw.githubusercontent.com/googleapis/js-genai/main/api-report/genai.api.md | Definitive type definitions: `UploadToFileSearchStoreParameters` accepts `file: string \| globalThis.Blob`; `UploadToFileSearchStoreConfig.mimeType` is optional; `UploadToFileSearchStoreResponse.documentName` field |
| 2 | `@google/genai` Internal API Report | https://raw.githubusercontent.com/googleapis/js-genai/main/api-report/genai-vertex-internal.api.md | `NodeUploader` class signatures confirming `uploadToFileSearchStore(file: string \| Blob, ...)` |
| 3 | Gemini File Search API Reference | https://ai.google.dev/api/file-search/file-search-stores | REST API spec: `mimeType` is optional and "will be inferred from the uploaded content"; confirmed upload returns a long-running operation |
| 4 | Gemini File Search JavaScript Tutorial (philschmid.de) | https://www.philschmid.de/gemini-file-search-javascript | Working TypeScript examples for file path upload, polling pattern, operation structure, documents API |
| 5 | Google AI Dev -- File Search Docs | https://ai.google.dev/gemini-api/docs/file-search | Architecture diagram, upload flow explanation, 100 MB per file limit |
| 6 | Context7 -- googleapis/js-genai | via Context7 MCP | `uploadToFileSearchStore` method description, `UploadToFileSearchStoreParameters` interface documentation |

### Recommended for Deep Reading

- **`genai.api.md`** (item 1): The authoritative source for all SDK types. Searching for `UploadToFileSearchStore` reveals the complete interface chain.
- **philschmid.de tutorial** (item 4): The most comprehensive JavaScript/TypeScript end-to-end example available; covers the full document lifecycle.

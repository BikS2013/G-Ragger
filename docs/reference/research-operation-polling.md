# Operation Polling Pattern in @google/genai SDK

**Date**: 2026-04-10
**Status**: Complete
**Scope**: How to wait for long-running upload and import operations to finish in TypeScript using the `@google/genai` SDK. Covers both the documented pattern and a known active bug that affects it.

---

## Summary Finding

The `@google/genai` SDK does **not** provide a `waitForCompletion()` helper or equivalent. Polling must be implemented manually using a `while (!operation.done)` loop with `ai.operations.get({ operation })`. However, **a confirmed bug in the SDK** causes `ai.operations.get()` to return an object that is missing the `done`, `response`, and `error` fields when polling File Search store operations. This means the documented polling loop runs indefinitely.

A practical workaround exists for `uploadToFileSearchStore()` but not for `importFile()`.

---

## Operation Types

Both ingestion pathways return long-running operation objects:

| Method | Return Type | Operation Name Pattern |
|--------|------------|----------------------|
| `ai.fileSearchStores.uploadToFileSearchStore()` | `UploadToFileSearchStoreOperation` | `fileSearchStores/.../upload/operations/...` |
| `ai.fileSearchStores.importFile()` | `ImportFileOperation` | `fileSearchStores/.../operations/...` |

---

## Operation Object Structure

The TypeScript interface for `UploadToFileSearchStoreOperation` is:

```typescript
interface UploadToFileSearchStoreOperation {
  name?: string;                          // Unique operation identifier
  done?: boolean;                         // true when the operation is complete
  response?: UploadToFileSearchStoreResponse; // Populated on success
  error?: Record<string, unknown>;        // Populated on failure (Status object)
  metadata?: Record<string, unknown>;     // Progress metadata
  sdkHttpResponse?: HttpResponse;         // Raw HTTP response
}

interface UploadToFileSearchStoreResponse {
  document?: Document;                    // The created document resource
}
```

### Completion Indicators

| Field | Value When Complete | Value When In Progress | Value On Failure |
|-------|---------------------|----------------------|-----------------|
| `done` | `true` | `undefined` or `false` | `true` |
| `response` | Populated object | `undefined` | `undefined` |
| `error` | `undefined` | `undefined` | Populated Status object |

---

## Documented Polling Pattern (Official Docs)

The official documentation shows the following pattern for both TypeScript pathways:

### Direct Upload (`uploadToFileSearchStore`)

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function uploadAndWait(filePath: string, storeName: string): Promise<void> {
  // Initiate upload — returns a long-running operation immediately
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: filePath,
    fileSearchStoreName: storeName,
    config: {
      displayName: 'my-document',
      customMetadata: [
        { key: 'source_type', stringValue: 'file' }
      ]
    }
  });

  // Poll until done
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
  }

  console.log('Upload and indexing complete.');
}
```

### Files API + Import (`importFile`)

```typescript
async function importAndWait(filePath: string, storeName: string): Promise<void> {
  // Step 1: Upload to Files API (temporary 48-hour storage)
  const uploadedFile = await ai.files.upload({
    file: filePath,
    config: { displayName: 'my-document' }
  });

  // Step 2: Import into File Search Store with metadata
  let operation = await ai.fileSearchStores.importFile({
    fileSearchStoreName: storeName,
    fileName: uploadedFile.name,
    // Note: customMetadata is set in the importFile config, not files.upload
  });

  // Poll until done
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Import failed: ${JSON.stringify(operation.error)}`);
  }

  console.log('Import and indexing complete.');
}
```

---

## Known Bug: `operations.get()` Returns Incomplete Object

**Issue**: [#1211 on googleapis/js-genai](https://github.com/googleapis/js-genai/issues/1211)
**Reported**: 2026-12-21 against SDK version 1.34.0
**Status as of 2026-04-10**: No confirmed fix found in release notes. The issue was open when last verified.

### What Actually Happens

The `ai.operations.get({ operation })` call for File Search operations returns an object that contains **only the `name` field**. The `done`, `response`, `error`, and `metadata` fields are absent:

```typescript
// Expected:
{
  "name": "fileSearchStores/.../upload/operations/...",
  "done": true,
  "response": { "documentName": "fileSearchStores/.../documents/..." }
}

// Actual (what the SDK returns from operations.get):
{
  "name": "fileSearchStores/.../upload/operations/..."
}
// done is undefined, response is undefined
```

Because `!operation.done` evaluates to `!undefined` which is `true`, the `while` loop runs indefinitely.

### Initial Response from `uploadToFileSearchStore`

Interestingly, the **initial** response from `uploadToFileSearchStore()` (before any polling) often already contains a populated `response` object:

```typescript
// Initial operation returned directly from uploadToFileSearchStore():
{
  "name": "fileSearchStores/.../upload/operations/...",
  "response": {
    "parent": "fileSearchStores/...",
    "documentName": "fileSearchStores/.../documents/..."
  }
  // Note: done field is NOT present / is undefined
}
```

The presence of `response.documentName` in the initial response strongly suggests the upload has already completed (or at minimum has been accepted and a document resource has been created).

### Initial Response from `importFile`

The `importFile()` initial response is less useful — it returns an empty response object:

```typescript
{
  "name": "fileSearchStores/.../operations/...",
  "response": {}
  // done is absent, response is empty
}
```

---

## Practical Workaround

Given the bug, the recommended implementation strategy is:

### Strategy 1: Document Name Check (for `uploadToFileSearchStore`)

Check `response?.documentName` in the initial response. If present, the upload is complete. This works because for small-to-medium files the upload operation appears to complete synchronously or near-synchronously before the first SDK response is returned.

```typescript
async function uploadWithWorkaround(
  file: string | Blob,
  storeName: string,
  displayName: string,
  maxWaitMs = 120_000,
  pollIntervalMs = 3_000
): Promise<string> {
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file,
    fileSearchStoreName: storeName,
    config: { displayName }
  });

  // Cast to access raw fields not in the typed interface
  const rawOp = operation as Record<string, unknown>;
  const rawResponse = rawOp['response'] as Record<string, unknown> | undefined;

  // Check if already complete from initial response (workaround for polling bug)
  if (rawResponse?.['documentName']) {
    return rawResponse['documentName'] as string;
  }

  // Fall back to polling with timeout guard
  const deadline = Date.now() + maxWaitMs;

  while (!operation.done) {
    if (Date.now() > deadline) {
      throw new Error(
        `Upload operation timed out after ${maxWaitMs / 1000}s. ` +
        `Operation name: ${operation.name}`
      );
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
  }

  const doc = operation.response?.document;
  if (!doc?.name) {
    throw new Error('Upload completed but document name is missing from response.');
  }

  return doc.name;
}
```

### Strategy 2: Time-Bounded Polling with Optimistic Continuation (for `importFile`)

Since `importFile` does not provide an immediate `documentName`, use a time-bounded polling loop. If polling does not resolve within a reasonable timeout, treat it as potentially complete and proceed (the Gemini query will fail if the document is not yet indexed, which is a recoverable error).

```typescript
async function importWithWorkaround(
  storeName: string,
  fileName: string,
  maxWaitMs = 120_000,
  pollIntervalMs = 5_000
): Promise<void> {
  let operation = await ai.fileSearchStores.importFile({
    fileSearchStoreName: storeName,
    fileName
  });

  const deadline = Date.now() + maxWaitMs;

  // Polling loop — exits on done=true, error, or timeout
  while (!operation.done) {
    if (Date.now() > deadline) {
      // Bug: operations.get() may never set done=true
      // Log a warning and proceed — the document may already be indexed
      console.warn(
        `[importFile] Polling timed out after ${maxWaitMs / 1000}s. ` +
        `Operation: ${operation.name}. Proceeding optimistically.`
      );
      return;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Import failed: ${JSON.stringify(operation.error)}`);
  }
}
```

### Strategy 3: Document List Polling (Most Reliable Workaround)

A more reliable but heavier approach: after initiating the operation, poll `ai.fileSearchStores.documents.list()` (or equivalent document list endpoint) until the document appears in the list. This bypasses the broken `operations.get()` entirely.

```typescript
// Pseudo-code — requires confirming the document list SDK method signature
async function waitForDocumentToAppear(
  storeName: string,
  documentName: string,
  maxWaitMs = 120_000,
  pollIntervalMs = 5_000
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    // NOTE: exact SDK method for listing documents needs verification
    // See research-file-search-document-api.md for confirmed method signatures
    const docs = await ai.fileSearchStores.documents.list({
      parent: storeName
    });

    const found = docs.some((d: { name?: string }) => d.name === documentName);
    if (found) return;
  }

  throw new Error(`Document ${documentName} did not appear in store within ${maxWaitMs / 1000}s`);
}
```

---

## Recommended Implementation for GeminiRAG

Given the above findings, the recommended approach for the GeminiRAG upload flow is:

1. **Use `uploadToFileSearchStore` as the primary pathway** (not `importFile`) because its initial response contains `response.documentName`, which provides an early-exit signal that avoids the polling bug entirely for most files.

2. **Check `response.documentName` in the initial operation response** before entering any polling loop.

3. **Add a hard timeout** (120 seconds is a reasonable ceiling for document indexing) to prevent any accidental infinite loop in edge cases where the initial response lacks `documentName`.

4. **Log the operation name** whenever a timeout occurs so the user can investigate manually.

5. **Reserve `importFile` only if needed** (e.g., if a file must be uploaded once and imported to multiple stores). When using `importFile`, implement the time-bounded polling with optimistic continuation (Strategy 2).

### Consolidated Helper Function

```typescript
import { GoogleGenAI } from '@google/genai';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const POLL_INTERVAL_MS = 3_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export async function uploadFileToStore(
  file: string | Blob,
  storeName: string,
  displayName: string,
  customMetadata?: Array<{ key: string; stringValue?: string; numericValue?: number }>
): Promise<string> {
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file,
    fileSearchStoreName: storeName,
    config: {
      displayName,
      ...(customMetadata ? { customMetadata } : {})
    }
  });

  // Workaround: check initial response for documentName (avoids polling bug)
  const rawOp = operation as Record<string, unknown>;
  const initialResponse = rawOp['response'] as Record<string, unknown> | undefined;
  if (initialResponse?.['documentName']) {
    return initialResponse['documentName'] as string;
  }

  // Standard polling loop with timeout guard
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;

  while (!operation.done) {
    if (Date.now() > deadline) {
      throw new Error(
        `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s (operation: ${operation.name}). ` +
        `The file may still be indexing. Check your File Search Store for the document.`
      );
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    operation = await ai.operations.get({ operation });
  }

  if (operation.error) {
    throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
  }

  const documentName = operation.response?.document?.name;
  if (!documentName) {
    throw new Error('Upload completed but no document name in response.');
  }

  return documentName;
}
```

---

## Key Facts for Implementation

| Fact | Detail |
|------|--------|
| `waitForCompletion()` method | Does not exist in the SDK |
| Polling method | `ai.operations.get({ operation })` |
| Polling namespace | `ai.operations` (not `ai.fileSearchStores.operations`) |
| `done` field type | `boolean | undefined` — check `!operation.done` |
| Error field | `operation.error` — present and populated on failure |
| Successful response path | `operation.response.document.name` (document resource name) |
| Known bug | `operations.get()` returns `{ name }` only, missing `done`/`response`/`error` |
| Bug status | Open as of SDK 1.34.0 (reported 2025-12-21); unconfirmed fix in 1.48.0 |
| Best workaround | Check `response.documentName` from the initial `uploadToFileSearchStore` response |
| Polling interval (recommended) | 3–5 seconds |
| Timeout (recommended) | 120 seconds |

---

## Additional Known Issue: 503 Errors for Files Over ~10KB

A separate reported issue: `uploadToFileSearchStore()` consistently returns HTTP 503 ("Failed to count tokens") for files larger than approximately 10KB. This was reported in November 2025 and remained unresolved as of February 2026.

**Relevance to GeminiRAG**: Web page and YouTube transcript content can easily exceed 10KB. If this bug persists, the `importFile` pathway (Files API upload, then import) may be the required fallback for larger content, even though its polling is more problematic.

**Recommended mitigation**: Try `uploadToFileSearchStore` first; catch HTTP 503 and retry via `importFile` if the file exceeds ~8KB.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| Bug #1211 is unresolved in SDK 1.48.0 | MEDIUM | If fixed, the standard polling loop works as documented and all workarounds are unnecessary |
| `response.documentName` in the initial response means indexing is complete | MEDIUM | If it only means the upload was received (not indexed), we need a different completion signal |
| 120 seconds is sufficient for indexing typical documents | MEDIUM | Larger files may need a longer timeout |
| The 503 error for >10KB files still affects current SDK versions | LOW | May have been silently fixed in a patch release |

### Clarifying Questions

1. Has the SDK been tested at version 1.48.0 to confirm whether bug #1211 is fixed? If fixed, the standard polling loop is safe and all workarounds can be removed.
2. Does `response.documentName` in the initial upload response confirm that the document is fully indexed and queryable, or only that the upload was accepted?
3. Is the 503 error for large files still reproducible on the current SDK and API version?

---

## Assumptions & Scope Section

**Interpreted as**: Shallow research into the TypeScript SDK polling pattern, not a deep dive into the underlying REST API.

**Explicitly out of scope**:
- Vertex AI variant of the SDK (project focuses on Gemini Developer API with API key auth)
- Video generation operations (different operation type, different polling method)
- Retry/backoff strategies beyond basic polling

---

## References

| Source | URL | Information Gathered |
|--------|-----|---------------------|
| Gemini File Search Official Docs | https://ai.google.dev/gemini-api/docs/file-search | Official JS polling code samples for both pathways |
| @google/genai SDK operations.ts (source) | https://raw.githubusercontent.com/googleapis/js-genai/main/src/operations.ts | Confirmed `Operations.get()` method signature; no `waitForCompletion()` exists |
| Context7 / js-genai API report | https://github.com/googleapis/js-genai/blob/main/api-report/genai.api.md | `UploadToFileSearchStoreOperation` interface fields |
| GitHub Issue #1211 | https://github.com/googleapis/js-genai/issues/1211 | Bug details, workaround for `uploadToFileSearchStore`, confirmed missing `done` field |
| philschmid.de Tutorial | https://www.philschmid.de/gemini-file-search-javascript | Real-world usage patterns; concurrent upload with polling |
| @google/genai on npm | https://www.npmjs.com/package/@google/genai | Current SDK version (1.48.0) |
| googleapis/js-genai GitHub | https://github.com/googleapis/js-genai | SDK source repository |

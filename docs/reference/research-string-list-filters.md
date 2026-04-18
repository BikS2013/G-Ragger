# Research: metadataFilter with string_list_value Type

**Date**: 2026-04-10
**Status**: Complete
**Purpose**: Determine whether `string_list_value` metadata on Gemini File Search documents can be queried at search time using `metadataFilter`, and what filter syntax to use.

---

## Executive Summary

The `string_list_value` metadata type exists in the Gemini File Search API and can be attached to documents at upload time. However, no official documentation, cookbook example, or community report confirms that it can be used in `metadataFilter` expressions at query time. All documented filter examples use `string_value` (scalar string) equality. The AIP-160 spec defines a `:` (has) operator for repeated fields that is theoretically applicable, but the Gemini File Search API does not document support for it, and it is plausible that `metadataFilter` only supports scalar value comparisons.

**Design recommendation**: Do not store flags as `string_list_value` metadata on the Gemini side if query-time filtering on flags is required. Flags should remain in the local registry only and filtering by flag should be done client-side after Gemini returns results.

---

## Background

The investigation document (`investigation-gemini-file-search.md`) identified this as a research gap:

> The spec mentions flags stored as an array. If we store flags as `string_list_value` metadata on the Gemini side, we need to confirm the AIP-160 filter syntax for list membership queries.

Two design choices are at stake:

- **Option A**: Store flags as `string_list_value` Gemini-side metadata, and filter at query time (e.g., "only return documents flagged as 'urgent'")
- **Option B**: Store flags in the local registry only, and filter client-side after receiving Gemini results

---

## Findings

### 1. string_list_value Type Exists and Is Uploadable

The `string_list_value` type is confirmed as a valid metadata type for Gemini File Search documents. Evidence:

**From the Documents API reference** (`ai.google.dev/api/file-search/documents`):

```json
// CustomMetadata JSON representation
{
  "key": string,
  // value -- one of:
  "stringValue": string,
  "stringListValue": {
    "values": [string]
  },
  "numericValue": number
}
```

**From the official Gemini cookbook** (`quickstarts/File_Search.ipynb`):

```python
# Confirmed via model field introspection:
types.CustomMetadata.model_fields.keys() - {'key'}
# Output: {'numeric_value', 'string_list_value', 'string_value'}
```

**TypeScript upload example** (confirmed pattern):

```typescript
// Uploading a document with string_list_value metadata
let operation = await ai.fileSearchStores.uploadToFileSearchStore({
  file: 'document.txt',
  fileSearchStoreName: fileStore.name,
  config: {
    displayName: 'My Document',
    customMetadata: [
      { key: 'flags', stringListValue: { values: ['urgent', 'reviewed'] } },
      { key: 'source_type', stringValue: 'web' },
    ]
  }
});
```

### 2. No Documented Filter Syntax for string_list_value

After exhaustive search across all official sources:

- **Official Gemini File Search docs** (`ai.google.dev/gemini-api/docs/file-search`): Shows only `string_value` equality filter examples. Directs readers to AIP-160 for "complex filters."
- **Documents API reference** (`ai.google.dev/api/file-search/documents`): Documents the `StringList` type but gives no filter guidance.
- **Official cookbook notebook** (`google-gemini/cookbook`): Demonstrates `string_value` and `numeric_value` filtering only. States "to learn more about how to build complex filters, read the AIP-160 spec" without providing a `string_list_value` example.
- **philschmid.de tutorial**: Only demonstrates scalar string equality filters.
- **Community search**: No results found for `string_list_value` filter syntax in any forum, GitHub issue, or blog post.

The only filter examples found across all sources are of this form:

```typescript
// Documented and confirmed working
metadataFilter: 'author="Robert Graves"'
metadataFilter: 'genre="fiction"'
metadataFilter: 'doc_type="manual"'
metadataFilter: 'author = "Smith" AND year > 2020'
```

### 3. AIP-160 Has Operator: Theoretically Applicable, Unconfirmed for Gemini

The AIP-160 specification defines a `:` (has) operator for repeated fields (lists):

| Expression | Meaning |
|------------|---------|
| `r:42` | True if repeated field `r` contains 42 |
| `r:"urgent"` | True if repeated field `r` contains "urgent" |

From the AIP-160 spec:

> **Repeated fields** query to see if the repeated structure contains a matching element.
> The `.` operator **must not** be used to traverse through a repeated field or list, except for specific use with the `:` operator.

If Gemini's `metadataFilter` fully implements AIP-160, then a `string_list_value` membership query should look like:

```typescript
// Theoretical -- NOT confirmed to work with Gemini File Search
metadataFilter: 'flags:"urgent"'
```

However, this is speculative. There are several reasons why this may not work:

1. **Partial AIP-160 implementations are common**: Google APIs frequently implement a subset of AIP-160. The Gemini File Search docs only explicitly confirm equality and comparison operators.
2. **Different metadata value architecture**: Gemini metadata uses a typed union (`stringValue` / `stringListValue` / `numericValue`) rather than a flat repeated field. The AIP-160 `:` operator behavior on a union type may differ from a plain repeated field.
3. **No evidence of working examples**: No official or community example demonstrates `string_list_value` filtering in `metadataFilter`.
4. **API may silently ignore or error**: An unsupported filter expression may return an `INVALID_ARGUMENT` error, return all documents (ignoring the filter), or behave unpredictably.

### 4. Legacy Gemini Enterprise API Uses Different Syntax (Irrelevant)

The legacy Gemini Enterprise search API uses a completely different filter syntax (`ANY("val1", "val2")` for text list membership), not AIP-160. This does not apply to the File Search API and should not be used.

---

## Decision: Flags Must Remain Local-Only

Given the absence of confirmed `string_list_value` filter support, flags **must not** be relied upon for Gemini-side `metadataFilter` expressions. The existing dual-layer architecture in the investigation document already accounts for this:

| Metadata Layer | Storage | Used For | Filterable At Query Time |
|----------------|---------|----------|--------------------------|
| Gemini-side | File Search Store | `source_type`, `source_url` | Yes (string_value equality confirmed) |
| Local registry | `~/.g-ragger/registry.json` | `flags`, `expiration_date`, `title` | Yes (client-side, after results returned) |

This decision is consistent with the immutable nature of Gemini metadata. Since flags are mutable (users add/remove flags over time), they would need delete+re-upload on every flag change regardless. Keeping flags local avoids both the immutability problem and the unconfirmed filter support problem.

---

## Recommended Implementation Pattern

### Flag Storage (Local Only)

```typescript
// Local registry entry (from types/index.ts)
interface UploadEntry {
  id: string;
  documentName: string;
  title: string;
  timestamp: string;
  sourceType: 'file' | 'web' | 'youtube' | 'note';
  sourceUrl: string | null;
  expirationDate: string | null;
  flags: string[];  // Local only -- NOT stored on Gemini side
}
```

### Query with Flag Filtering (Client-Side Post-Processing)

```typescript
// services/registry.ts
function filterByFlag(entries: UploadEntry[], flag: string): UploadEntry[] {
  return entries.filter(entry => entry.flags.includes(flag));
}

// commands/query.ts
async function queryWithFlags(
  question: string,
  storeName: string,
  flagFilter: string | null,
  sourceTypeFilter: string | null
): Promise<void> {
  // Step 1: Build Gemini-side metadataFilter (only for Gemini-side metadata)
  const metadataFilter = sourceTypeFilter
    ? `source_type="${sourceTypeFilter}"`
    : undefined;

  // Step 2: Run Gemini query
  const response = await ai.models.generateContent({
    model: config.model,
    contents: question,
    config: {
      tools: [{
        fileSearch: {
          fileSearchStoreNames: [storeName],
          ...(metadataFilter && { metadataFilter }),
        }
      }]
    }
  });

  // Step 3: Extract document names from grounding metadata
  const usedDocumentNames = extractDocumentNames(response);

  // Step 4: If flag filter specified, apply client-side
  if (flagFilter) {
    const localEntries = registry.getEntriesForStore(storeName);
    const flaggedDocNames = filterByFlag(localEntries, flagFilter)
      .map(e => e.documentName);

    if (!usedDocumentNames.some(name => flaggedDocNames.includes(name))) {
      console.log(`Note: The answer did not use documents with flag "${flagFilter}".`);
    }
  }

  displayResponse(response);
}
```

### Why Not Filter Before Query Using Gemini-Side string_list_value

Even if `string_list_value` filtering did work (theoretically using `flags:"urgent"`), storing flags on the Gemini side is inadvisable:

1. **Immutability**: Every flag change requires delete + re-upload + re-indexing ($0.15/1M tokens indexing cost, plus polling delay)
2. **Inconsistency risk**: If delete fails mid-operation, document loses flags permanently with no recovery path
3. **No migration path**: Adding a new flag retroactively requires touching every document in the store
4. **Local registry already stores flags**: The dual-layer design is already established; adding flags to Gemini side creates redundancy without benefit

---

## Risk Assessment

### If string_list_value Filtering Is Later Confirmed to Work

Even if the `:` operator is confirmed for `string_list_value` in `metadataFilter`, the recommendation to keep flags local-only stands, for the immutability reasons above. The only scenario where Gemini-side flag storage makes sense is if:

- Flags are immutable (set once at upload, never changed)
- Query performance on flags is critical (thousands of documents where client-side post-filtering is too slow)

Neither condition applies to GeminiRAG's design (single-user tool, flags are explicitly mutable per spec).

---

## Appendix: Testing string_list_value Filtering (If Needed)

If the team wants to empirically verify whether `string_list_value` filtering works, the following test can be run:

```typescript
// test_scripts/test-string-list-filter.ts
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testStringListFilter() {
  // 1. Create a temporary store
  const store = await ai.fileSearchStores.create({
    config: { displayName: 'test-string-list-filter' }
  });

  // 2. Upload a test document with string_list_value metadata
  const testContent = new Blob(['This is a test document about TypeScript.'], { type: 'text/plain' });
  let op = await ai.fileSearchStores.uploadToFileSearchStore({
    file: testContent,
    fileSearchStoreName: store.name,
    config: {
      displayName: 'test-doc-with-flags',
      customMetadata: [
        { key: 'flags', stringListValue: { values: ['urgent', 'reviewed'] } },
      ]
    }
  });

  while (!op.done) {
    await new Promise(r => setTimeout(r, 3000));
    op = await ai.operations.get({ operation: op });
  }
  console.log('Document indexed.');

  // 3. Test 1: Query with has-operator filter (AIP-160 :)
  try {
    const response1 = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'What is this document about?',
      config: {
        tools: [{
          fileSearch: {
            fileSearchStoreNames: [store.name],
            metadataFilter: 'flags:"urgent"',  // AIP-160 has operator
          }
        }]
      }
    });
    console.log('Test 1 (flags:"urgent") - PASSED:', response1.text?.substring(0, 100));
  } catch (err) {
    console.log('Test 1 (flags:"urgent") - FAILED:', (err as Error).message);
  }

  // 4. Test 2: Equality filter on list (may not work either)
  try {
    const response2 = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'What is this document about?',
      config: {
        tools: [{
          fileSearch: {
            fileSearchStoreNames: [store.name],
            metadataFilter: 'flags="urgent"',  // Scalar equality -- likely wrong type
          }
        }]
      }
    });
    console.log('Test 2 (flags="urgent") - PASSED:', response2.text?.substring(0, 100));
  } catch (err) {
    console.log('Test 2 (flags="urgent") - FAILED:', (err as Error).message);
  }

  // 5. Cleanup
  await ai.fileSearchStores.delete({ name: store.name, config: { force: true } });
  console.log('Cleanup complete.');
}

testStringListFilter().catch(console.error);
```

Run with:
```bash
source .venv/bin/activate && npx tsx test_scripts/test-string-list-filter.ts
```

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| AIP-160 `:` operator is the correct syntax for list membership if supported | HIGH | An alternative syntax (e.g., `flags=ANY("urgent")`) might work instead |
| Gemini File Search does not support `string_list_value` in `metadataFilter` | MEDIUM | Flags could potentially be stored Gemini-side and filtered at query time -- but immutability concern still applies |
| The absence of docs/examples implies non-support | MEDIUM | Google may support it without documenting it; empirical testing would confirm |
| Flags are mutable (per spec) | HIGH | If flags become immutable in the design, Gemini-side storage becomes feasible |

## Uncertainties & Gaps

- **No empirical test result**: The `:` operator has not been tested against the actual Gemini File Search API. A failing `INVALID_ARGUMENT` error would confirm non-support; a working response would change the recommendation.
- **Google may update docs**: The File Search API was released November 2025 and is evolving. Documentation for `string_list_value` filter examples may appear in future updates.
- **AIP-160 partial implementation scope**: Google does not publish which AIP-160 operators the `metadataFilter` field supports beyond the examples shown. Equality and numeric comparison are confirmed; all others are unconfirmed.

## Clarifying Questions for Follow-Up

1. Should the team test `string_list_value` filter support empirically using the test script in the Appendix? This would definitively resolve the uncertainty.
2. Are there any use cases where filtering by flag at the Gemini level would be valuable enough to justify delete + re-upload on flag changes?
3. Is the current scope of `metadataFilter` (source_type and source_url only) sufficient for all planned query features?

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | Gemini File Search Docs (Official) | https://ai.google.dev/gemini-api/docs/file-search | Confirmed filter syntax examples (scalar equality only); reference to AIP-160 for complex filters |
| 2 | Documents API Reference (Official) | https://ai.google.dev/api/file-search/documents | Confirmed `StringList` type and `CustomMetadata` union structure |
| 3 | File Search Stores API Reference (Official) | https://ai.google.dev/api/file-search/file-search-stores | Confirmed `customMetadata` field on upload request; no filter guidance |
| 4 | AIP-160 Filter Specification | https://google.aip.dev/160 | Confirmed `:` (has) operator for repeated fields; defines list membership syntax |
| 5 | Google Gemini Cookbook - File_Search.ipynb | https://github.com/google-gemini/cookbook/blob/main/quickstarts/File_Search.ipynb | Confirmed `string_list_value` as a valid metadata type via SDK introspection; no filter example for it |
| 6 | philschmid.de JavaScript Tutorial | https://www.philschmid.de/gemini-file-search-javascript | Confirmed `doc_type="manual"` scalar equality filter pattern; no list filter examples |
| 7 | Gemini Enterprise Legacy Filter Docs | https://docs.cloud.google.com/gemini/enterprise/docs/filter-search-metadata | Different API (legacy Enterprise search), uses `ANY()` syntax -- not applicable to File Search API |
| 8 | Web Search: string_list_value filter syntax | (multiple queries, no results) | Confirmed absence of any community documentation or examples for `string_list_value` filtering |

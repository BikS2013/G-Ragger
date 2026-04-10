import { GoogleGenAI } from '@google/genai';
import { CustomMetadataEntry, QueryResult, StoreInfo, Citation } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const IMPORT_POLL_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Helper: 503 Error Detection (Section 8.2)
// ---------------------------------------------------------------------------

function is503Error(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('503') || message.includes('service unavailable')) {
      return true;
    }
    const anyError = error as unknown as Record<string, unknown>;
    if (anyError.status === 503 || anyError.statusCode === 503) {
      return true;
    }
    if (anyError.httpStatusCode === 503) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helper: Find Document by Display Name (Section 8.3)
// ---------------------------------------------------------------------------

async function findDocumentByDisplayName(
  ai: GoogleGenAI,
  storeName: string,
  displayName: string
): Promise<string> {
  const pager = await ai.fileSearchStores.documents.list({
    parent: storeName,
  });

  for await (const doc of pager) {
    if (doc.displayName === displayName) {
      if (!doc.name) {
        throw new Error(
          `Document found with displayName "${displayName}" but has no resource name.`
        );
      }
      return doc.name;
    }
  }

  throw new Error(`Document not found after import: ${displayName}`);
}

// ---------------------------------------------------------------------------
// Helper: sleep
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// createStore
// ---------------------------------------------------------------------------

/**
 * Create a new Gemini File Search Store.
 *
 * @param ai - GoogleGenAI instance
 * @param displayName - Human-readable store name
 * @returns Store resource name (e.g., "fileSearchStores/abc123")
 */
export async function createStore(
  ai: GoogleGenAI,
  displayName: string
): Promise<string> {
  const store = await ai.fileSearchStores.create({
    config: { displayName },
  });

  if (!store.name) {
    throw new Error('Store created but no resource name returned.');
  }

  return store.name;
}

// ---------------------------------------------------------------------------
// deleteStore
// ---------------------------------------------------------------------------

/**
 * Delete a Gemini File Search Store and all its documents.
 *
 * @param ai - GoogleGenAI instance
 * @param storeName - Store resource name
 */
export async function deleteStore(
  ai: GoogleGenAI,
  storeName: string
): Promise<void> {
  await ai.fileSearchStores.delete({
    name: storeName,
    config: { force: true },
  });
}

// ---------------------------------------------------------------------------
// listStores
// ---------------------------------------------------------------------------

/**
 * List all Gemini File Search Stores.
 *
 * @param ai - GoogleGenAI instance
 * @returns Array of store info objects
 */
export async function listStores(ai: GoogleGenAI): Promise<StoreInfo[]> {
  const stores: StoreInfo[] = [];
  const pager = await ai.fileSearchStores.list();

  for await (const store of pager) {
    stores.push({
      name: store.name ?? '',
      displayName: store.displayName ?? '',
    });
  }

  return stores;
}

// ---------------------------------------------------------------------------
// uploadContent
// ---------------------------------------------------------------------------

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
): Promise<string> {
  // Prepare the upload input
  const file: string | Blob = isFilePath
    ? content
    : new Blob([content], { type: mimeType });

  try {
    // === Primary Path: Direct Upload ===
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file,
      fileSearchStoreName: storeName,
      config: {
        displayName,
        customMetadata: customMetadata as any,
      },
    });

    // === Polling Bug #1211 Workaround ===
    // The initial response often contains documentName even though done is undefined.
    const rawResponse = (operation as any).response;
    if (rawResponse?.documentName) {
      return rawResponse.documentName as string;
    }

    // === Standard Polling with Hard Timeout ===
    const deadline = Date.now() + UPLOAD_TIMEOUT_MS;

    while (!operation.done) {
      if (Date.now() > deadline) {
        throw new Error(
          `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s. ` +
            `Operation: ${operation.name}. The file may still be indexing.`
        );
      }
      await sleep(POLL_INTERVAL_MS);
      operation = await ai.operations.get({ operation });
    }

    if (operation.error) {
      throw new Error(`Upload failed: ${JSON.stringify(operation.error)}`);
    }

    const documentName = (operation.response as any)?.document?.name ??
      (operation.response as any)?.documentName;
    if (!documentName) {
      throw new Error(
        'Upload completed but document name is missing from response.'
      );
    }

    return documentName;
  } catch (error: unknown) {
    // === 503 Fallback for Large Content ===
    if (is503Error(error) && !isFilePath) {
      console.warn(
        'Direct upload returned 503. Falling back to Files API + Import...'
      );

      // Step 1: Upload to Files API (temporary 48-hour storage)
      const uploadedFile = await ai.files.upload({
        file,
        config: { displayName },
      });

      if (!uploadedFile.name) {
        throw new Error(
          'Files API upload succeeded but no file name returned.'
        );
      }

      // Step 2: Import into File Search Store
      let importOp = await ai.fileSearchStores.importFile({
        fileSearchStoreName: storeName,
        fileName: uploadedFile.name,
        config: { customMetadata: customMetadata as any },
      });

      // Step 3: Time-bounded polling (importFile has no documentName workaround)
      const importDeadline = Date.now() + UPLOAD_TIMEOUT_MS;

      while (!importOp.done) {
        if (Date.now() > importDeadline) {
          // Optimistic continuation: document may already be indexed
          console.warn(
            'Import polling timed out. Proceeding optimistically.'
          );
          break;
        }
        await sleep(IMPORT_POLL_INTERVAL_MS);
        importOp = await ai.operations.get({ operation: importOp });
      }

      if (importOp.error) {
        throw new Error(`Import failed: ${JSON.stringify(importOp.error)}`);
      }

      // Discover document name via listing (since importFile response is empty)
      const documentName = await findDocumentByDisplayName(
        ai,
        storeName,
        displayName
      );
      return documentName;
    }

    // Re-throw non-503 errors
    throw error;
  }
}

// ---------------------------------------------------------------------------
// deleteDocument
// ---------------------------------------------------------------------------

/**
 * Delete a document from a File Search Store.
 *
 * @param ai - GoogleGenAI instance
 * @param documentName - Full document resource name
 */
export async function deleteDocument(
  ai: GoogleGenAI,
  documentName: string
): Promise<void> {
  await ai.fileSearchStores.documents.delete({
    name: documentName,
    config: { force: true },
  });
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

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
/**
 * Retrieve the complete content of a document from a File Search Store
 * using a verbatim-reproduction prompt with FileSearch grounding.
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name (e.g., "gemini-2.5-flash")
 * @param storeName - Store resource name
 * @param documentName - Document resource name
 * @param displayName - Human-readable document title (used in the retrieval prompt)
 * @returns The document content as text, with a truncation warning if detected
 */
export async function getDocumentContent(
  ai: GoogleGenAI,
  model: string,
  storeName: string,
  documentName: string,
  displayName?: string
): Promise<string> {
  const docRef = displayName ?? documentName;
  const prompt = `Return the complete, verbatim content of the document titled '${docRef}' without any summarization, modification, commentary, or formatting changes. Reproduce the document exactly as it was uploaded, including all sections and text.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{
        fileSearch: {
          fileSearchStoreNames: [storeName]
        }
      } as any]
    }
  });

  const candidate = response.candidates?.[0];
  let content = response.text ?? '';

  // If the model blocked the response due to RECITATION (copyright/verbatim content),
  // retry with a paraphrasing prompt that avoids triggering the safety filter.
  if (candidate?.finishReason === 'RECITATION' || (!content && candidate?.finishReason !== 'STOP')) {
    const fallbackPrompt = `You are analyzing the document titled '${docRef}'. Write original analytical notes organized as follows:

## Key Topics
List each distinct topic covered and write 2-3 sentences of analysis for each.

## Technologies & Tools Mentioned
List every specific technology, tool, framework, or product mentioned with context on how it relates to the discussion.

## Notable Insights
What are the most interesting or surprising points? Write these in your own analytical voice.

## Practical Takeaways
What actionable lessons or recommendations can be drawn from this content?

Write everything in your own words as an analyst reviewing this material.`;

    const fallbackResponse = await ai.models.generateContent({
      model,
      contents: fallbackPrompt,
      config: {
        tools: [{
          fileSearch: {
            fileSearchStoreNames: [storeName]
          }
        } as any]
      }
    });

    content = fallbackResponse.text ?? '';
    if (content) {
      content = `[NOTE: Verbatim content retrieval was blocked by the API's content policy. Below is a comprehensive summary.]\n\n${content}`;
    }
  }

  if (!content) {
    content = '[Unable to retrieve document content. The API returned an empty response.]';
  }

  // Check for truncation indicators
  const trimmed = content.trimEnd();
  const isTruncated =
    // Ends mid-sentence (no terminal punctuation)
    (trimmed.length > 0 && !/[.!?'")\]}>]$/.test(trimmed)) ||
    // Very short output (less than 100 chars) which may indicate failure
    (trimmed.length > 0 && trimmed.length < 100);

  if (isTruncated) {
    content += '\n\n[WARNING: Document content may be truncated. The full document is too large for complete retrieval.]';
  }

  return content;
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

export async function query(
  ai: GoogleGenAI,
  model: string,
  storeNames: string[],
  question: string,
  metadataFilter?: string
): Promise<QueryResult> {
  const fileSearchConfig: Record<string, unknown> = {
    fileSearchStoreNames: storeNames,
  };

  if (metadataFilter) {
    fileSearchConfig.metadataFilter = metadataFilter;
  }

  const response = await ai.models.generateContent({
    model,
    contents: question,
    config: {
      tools: [
        {
          fileSearch: fileSearchConfig,
        } as any,
      ],
    },
  });

  // Extract answer text
  const answer = response.text ?? '';

  // Extract citations from grounding metadata
  const citations: Citation[] = [];

  const candidates = (response as any).candidates;
  if (candidates && candidates.length > 0) {
    const groundingMetadata = candidates[0].groundingMetadata;
    if (groundingMetadata?.groundingChunks) {
      for (const chunk of groundingMetadata.groundingChunks) {
        const retrievedContext = chunk.retrievedContext;
        if (retrievedContext) {
          citations.push({
            text: chunk.text ?? '',
            documentTitle: retrievedContext.title ?? '',
            documentUri: retrievedContext.uri ?? '',
          });
        }
      }
    }
  }

  return { answer, citations };
}

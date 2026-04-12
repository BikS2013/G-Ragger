import type { AppContext } from './context.js';
import { query } from '../services/file-search.js';
import { getWorkspace } from '../services/registry.js';
import {
  parseFilter,
  buildMetadataFilter,
  findUploadByDocumentUri,
  passesClientFilters,
} from '../utils/filters.js';
import type { ParsedFilter, QueryResult } from '../types/index.js';

// ===== Result Types =====

export interface QueryResultIpc {
  answer: string;
  citations: { title: string; uri: string; excerpt: string }[];
}

// ===== Operations =====

/**
 * Query one or more workspaces with a natural language question.
 * Supports both Gemini-side and client-side filters.
 *
 * Returns the raw QueryResult (for CLI formatting) with client-side
 * filtered citations.
 */
export async function queryWorkspaces(
  ctx: AppContext,
  workspaceNames: string[],
  question: string,
  filterStrings?: string[]
): Promise<QueryResult> {
  // Parse filters into Gemini-side and client-side buckets
  const geminiFilters: ParsedFilter[] = [];
  const clientFilters: ParsedFilter[] = [];

  if (filterStrings) {
    for (const filterStr of filterStrings) {
      const parsed = parseFilter(filterStr);
      if (parsed.layer === 'gemini') {
        geminiFilters.push(parsed);
      } else {
        clientFilters.push(parsed);
      }
    }
  }

  const metadataFilter = buildMetadataFilter(geminiFilters);

  // Resolve store names
  const storeNames: string[] = [];
  for (const wsName of workspaceNames) {
    const ws = getWorkspace(wsName);
    storeNames.push(ws.storeName);
  }

  // Execute Gemini query
  const result = await query(
    ctx.client,
    ctx.config.geminiModel,
    storeNames,
    question,
    metadataFilter
  );

  // Apply client-side filters to citations
  if (clientFilters.length > 0) {
    result.citations = result.citations.filter((citation) => {
      const localEntry = findUploadByDocumentUri(
        workspaceNames,
        citation.documentUri
      );
      return passesClientFilters(localEntry, clientFilters);
    });
  }

  return result;
}

/**
 * Query workspaces with pre-split Gemini/client filters (for IPC callers).
 */
export async function queryWorkspacesSplit(
  ctx: AppContext,
  workspaceNames: string[],
  question: string,
  geminiFilters?: { key: string; value: string }[],
  clientFilters?: { key: string; value: string }[]
): Promise<QueryResultIpc> {
  // Parse Gemini-side filters
  const geminiParsed: ParsedFilter[] = [];
  if (geminiFilters) {
    for (const f of geminiFilters) {
      geminiParsed.push(parseFilter(`${f.key}=${f.value}`));
    }
  }
  const metadataFilter = buildMetadataFilter(geminiParsed);

  // Parse client-side filters
  const clientParsed: ParsedFilter[] = [];
  if (clientFilters) {
    for (const f of clientFilters) {
      clientParsed.push(parseFilter(`${f.key}=${f.value}`));
    }
  }

  // Resolve store names
  const storeNames: string[] = [];
  for (const wsName of workspaceNames) {
    const ws = getWorkspace(wsName);
    storeNames.push(ws.storeName);
  }

  const queryResult = await query(
    ctx.client,
    ctx.config.geminiModel,
    storeNames,
    question,
    metadataFilter
  );

  // Apply client-side filters
  let filteredCitations = queryResult.citations;
  if (clientParsed.length > 0) {
    filteredCitations = queryResult.citations.filter((citation) => {
      const localEntry = findUploadByDocumentUri(
        workspaceNames,
        citation.documentUri
      );
      return passesClientFilters(localEntry, clientParsed);
    });
  }

  return {
    answer: queryResult.answer,
    citations: filteredCitations.map((c) => ({
      title: c.documentTitle,
      uri: c.documentUri,
      excerpt: c.text,
    })),
  };
}

import { getWorkspace } from '../services/registry.js';
import { getExpirationIndicator } from '../utils/format.js';
import type { ParsedFilter, UploadEntry } from '../types/index.js';

// ===== Query-command filters =====

/** Keys that are filtered on the Gemini side via AIP-160 metadataFilter */
export const GEMINI_FILTER_KEYS = new Set(['source_type', 'source_url']);

/** Keys that are filtered client-side after Gemini returns results */
export const CLIENT_FILTER_KEYS = new Set(['flags', 'expiration_date', 'expiration_status']);

/**
 * Parse a "key=value" filter string into a ParsedFilter object.
 */
export function parseFilter(filterStr: string): ParsedFilter {
  const eqIndex = filterStr.indexOf('=');
  if (eqIndex === -1) {
    throw new Error(
      `Invalid filter format '${filterStr}'. Expected format: key=value`
    );
  }

  const key = filterStr.substring(0, eqIndex);
  const value = filterStr.substring(eqIndex + 1);

  if (GEMINI_FILTER_KEYS.has(key)) {
    return { key, value, layer: 'gemini' };
  } else if (CLIENT_FILTER_KEYS.has(key)) {
    return { key, value, layer: 'client' };
  } else {
    throw new Error(
      `Unknown filter key: '${key}'. Valid keys: ${[...GEMINI_FILTER_KEYS, ...CLIENT_FILTER_KEYS].join(', ')}`
    );
  }
}

/**
 * Build an AIP-160 metadata filter string from Gemini-side filters.
 * Example: source_type="web" AND source_url="https://example.com"
 */
export function buildMetadataFilter(geminiFilters: ParsedFilter[]): string | undefined {
  if (geminiFilters.length === 0) {
    return undefined;
  }
  const parts = geminiFilters.map((f) => `${f.key}="${f.value}"`);
  return parts.join(' AND ');
}

/**
 * Find an upload entry by its Gemini document name across all specified workspaces.
 */
export function findUploadByDocumentUri(
  workspaceNames: string[],
  documentUri: string
): UploadEntry | undefined {
  for (const wsName of workspaceNames) {
    const ws = getWorkspace(wsName);
    for (const upload of Object.values(ws.uploads)) {
      // Match against documentName or check if the URI contains the documentName
      if (upload.documentName === documentUri || documentUri.includes(upload.documentName)) {
        return upload;
      }
    }
  }
  return undefined;
}

/**
 * Check if an upload entry passes all client-side filters.
 */
export function passesClientFilters(
  upload: UploadEntry | undefined,
  clientFilters: ParsedFilter[]
): boolean {
  if (clientFilters.length === 0) {
    return true;
  }

  // If no local metadata found for this citation, exclude it when client filters are active
  if (!upload) {
    return false;
  }

  for (const filter of clientFilters) {
    if (filter.key === 'flags') {
      if (!upload.flags.includes(filter.value as UploadEntry['flags'][number])) {
        return false;
      }
    } else if (filter.key === 'expiration_status') {
      const indicator = getExpirationIndicator(upload.expirationDate);
      if (filter.value === 'expired' && indicator !== '[EXPIRED]') {
        return false;
      }
      if (filter.value === 'expiring_soon' && indicator !== '[EXPIRING SOON]') {
        return false;
      }
      if (filter.value === 'active' && indicator !== '') {
        return false;
      }
    } else if (filter.key === 'expiration_date') {
      if (upload.expirationDate !== filter.value) {
        return false;
      }
    }
  }

  return true;
}

// ===== Uploads-command filters =====

/**
 * Parse a "key=value" filter string for client-side upload listing filters.
 */
export function parseListingFilter(filterStr: string): { key: string; value: string } {
  const eqIndex = filterStr.indexOf('=');
  if (eqIndex === -1) {
    throw new Error(
      `Invalid filter format '${filterStr}'. Expected format: key=value`
    );
  }

  const key = filterStr.substring(0, eqIndex);
  const value = filterStr.substring(eqIndex + 1);

  const validKeys = new Set(['source_type', 'flags', 'expiration_status', 'channel', 'published_from', 'published_to']);
  if (!validKeys.has(key)) {
    throw new Error(
      `Unknown filter key: '${key}'. Valid keys for listing: source_type, flags, expiration_status, channel, published_from, published_to`
    );
  }

  return { key, value };
}

/**
 * Apply client-side filters to a list of uploads.
 */
export function applyFilters(
  uploads: UploadEntry[],
  filters: { key: string; value: string }[]
): UploadEntry[] {
  if (filters.length === 0) {
    return uploads;
  }

  return uploads.filter((upload) => {
    for (const filter of filters) {
      if (filter.key === 'source_type') {
        if (upload.sourceType !== filter.value) {
          return false;
        }
      } else if (filter.key === 'flags') {
        if (!upload.flags.includes(filter.value as UploadEntry['flags'][number])) {
          return false;
        }
      } else if (filter.key === 'expiration_status') {
        const indicator = getExpirationIndicator(upload.expirationDate);
        if (filter.value === 'expired' && indicator !== '[EXPIRED]') {
          return false;
        }
        if (filter.value === 'expiring_soon' && indicator !== '[EXPIRING SOON]') {
          return false;
        }
        if (filter.value === 'active' && indicator !== '') {
          return false;
        }
      } else if (filter.key === 'channel') {
        if (!upload.channelTitle || !upload.channelTitle.toLowerCase().includes(filter.value.toLowerCase())) {
          return false;
        }
      } else if (filter.key === 'published_from') {
        if (!upload.publishedAt || upload.publishedAt < filter.value) {
          return false;
        }
      } else if (filter.key === 'published_to') {
        if (!upload.publishedAt || upload.publishedAt > filter.value) {
          return false;
        }
      }
    }
    return true;
  });
}

/**
 * Sort uploads by timestamp.
 *
 * @param uploads - Array of uploads to sort
 * @param sortField - "timestamp" for ascending, "-timestamp" for descending (default)
 */
export function sortUploads(uploads: UploadEntry[], sortField?: string): UploadEntry[] {
  const sorted = [...uploads];
  const ascending = sortField === 'timestamp';

  sorted.sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime();
    const dateB = new Date(b.timestamp).getTime();
    return ascending ? dateA - dateB : dateB - dateA;
  });

  return sorted;
}

// ===== Get-command lookup =====

/**
 * Find an upload entry by full or partial ID (first 8+ characters).
 */
export function findUploadById(
  uploads: Record<string, UploadEntry>,
  uploadId: string
): UploadEntry | undefined {
  // Try exact match first
  if (uploads[uploadId]) {
    return uploads[uploadId];
  }

  // Try partial match (minimum 8 characters)
  const matches = Object.values(uploads).filter((u) =>
    u.id.startsWith(uploadId)
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous upload ID '${uploadId}'. Matches: ${matches.map((m) => m.id.slice(0, 8)).join(', ')}. Provide more characters.`
    );
  }

  return undefined;
}

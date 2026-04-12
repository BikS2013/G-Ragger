import { Flag, VALID_FLAGS } from '../types/index.js';

/**
 * List of MIME types supported by the Gemini File Search API.
 */
export const SUPPORTED_MIME_TYPES: string[] = [
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/json',
  'application/sql',
  'text/x-python',
  'text/javascript',
  'text/x-java-source',
  'text/x-c',
  'application/zip',
];

/**
 * Validate that a MIME type is supported for upload.
 *
 * @param mimeType - MIME type string to validate
 * @returns true if supported
 * @throws Error with list of supported types if not supported
 */
export function validateMimeType(mimeType: string): boolean {
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    throw new Error(
      `Unsupported file type '${mimeType}'. Supported types: ${SUPPORTED_MIME_TYPES.join(', ')}`
    );
  }
  return true;
}

/**
 * Validate an ISO 8601 date string (YYYY-MM-DD format).
 *
 * @param dateStr - Date string to validate
 * @returns true if valid
 * @throws Error with format instructions if invalid
 */
export function validateDate(dateStr: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    throw new Error(
      `Invalid date format '${dateStr}'. Use ISO 8601 format: YYYY-MM-DD`
    );
  }

  // Verify the date is actually valid (e.g., reject 2026-02-30)
  const parsed = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date format '${dateStr}'. Use ISO 8601 format: YYYY-MM-DD`
    );
  }

  // Verify the parsed date matches the input (catches invalid days like Feb 30)
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const reconstructed = `${year}-${month}-${day}`;
  if (reconstructed !== dateStr) {
    throw new Error(
      `Invalid date format '${dateStr}'. Use ISO 8601 format: YYYY-MM-DD`
    );
  }

  return true;
}

/**
 * Validate one or more flag values.
 *
 * @param flags - Array of flag strings to validate
 * @returns true if all valid (type guard)
 * @throws Error listing valid flags if any are invalid
 */
export function validateFlags(flags: string[]): flags is Flag[] {
  for (const flag of flags) {
    if (!VALID_FLAGS.includes(flag as Flag)) {
      throw new Error(
        `Invalid flag '${flag}'. Allowed values: ${VALID_FLAGS.join(', ')}`
      );
    }
  }
  return true;
}

/**
 * Validate and normalize tags.
 * Trims, lowercases, deduplicates, and rejects invalid tags.
 *
 * @param tags - Array of raw tag strings
 * @returns Normalized (lowercase, trimmed, deduplicated) tag array
 * @throws Error if any tag is empty, contains '=', or exceeds 50 characters
 */
export function validateTags(tags: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0) {
      throw new Error('Tag must be a non-empty string.');
    }
    if (tag.includes('=')) {
      throw new Error(`Tag '${tag}' must not contain the '=' character.`);
    }
    if (tag.length > 50) {
      throw new Error(`Tag '${tag}' exceeds the maximum length of 50 characters.`);
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      normalized.push(tag);
    }
  }

  return normalized;
}

/**
 * Validate a workspace name.
 *
 * @param name - Workspace name to validate
 * @returns true if valid
 * @throws Error if name is empty or contains invalid characters
 */
export function validateWorkspaceName(name: string): boolean {
  if (!name || name.trim().length === 0) {
    throw new Error('Workspace name cannot be empty');
  }

  // Allow only alphanumeric characters, hyphens, and underscores
  const validNameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!validNameRegex.test(name)) {
    throw new Error(
      `Invalid workspace name '${name}'. Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }

  return true;
}

/**
 * Validate a URL string.
 *
 * @param url - URL to validate
 * @returns true if valid HTTP/HTTPS URL
 * @throws Error if invalid
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Invalid URL '${url}'. Only HTTP and HTTPS URLs are supported.`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid URL')) {
      throw e;
    }
    throw new Error(`Invalid URL '${url}'. Only HTTP and HTTPS URLs are supported.`);
  }
  return true;
}

/**
 * Validate and extract YouTube video ID from URL.
 * Supports formats:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://youtube.com/watch?v=VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://www.youtube.com/v/VIDEO_ID
 *
 * @param url - YouTube URL
 * @returns Video ID string
 * @throws Error if URL is not a valid YouTube video URL
 */
export function extractYouTubeVideoId(url: string): string {
  try {
    const parsed = new URL(url);

    // youtube.com/watch?v=ID
    if (
      (parsed.hostname === 'www.youtube.com' ||
        parsed.hostname === 'youtube.com' ||
        parsed.hostname === 'm.youtube.com') &&
      parsed.pathname === '/watch'
    ) {
      const videoId = parsed.searchParams.get('v');
      if (videoId && videoId.length > 0) {
        return videoId;
      }
    }

    // youtu.be/ID
    if (parsed.hostname === 'youtu.be') {
      const videoId = parsed.pathname.slice(1); // remove leading /
      if (videoId && videoId.length > 0) {
        return videoId;
      }
    }

    // youtube.com/embed/ID or youtube.com/v/ID
    if (
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com'
    ) {
      const embedMatch = parsed.pathname.match(/^\/(embed|v)\/([^/?]+)/);
      if (embedMatch && embedMatch[2]) {
        return embedMatch[2];
      }
    }
  } catch {
    // URL parsing failed -- fall through to error
  }

  throw new Error(`Invalid YouTube URL: '${url}'`);
}

/**
 * YouTube Data API v3 service — direct fetch() calls, no googleapis package.
 *
 * Functions:
 *   resolveChannelId   – handle / URL / raw ID → { channelId, channelTitle }
 *   getUploadsPlaylistId – channelId → uploads playlist ID
 *   listChannelVideos  – paginated playlistItems with client-side date filter
 *   estimateQuotaCost  – quick quota math helper
 */

import type { YouTubeVideoMetadata } from '../types/index.js';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────

/** Throw a descriptive error when the API key is missing or blank. */
function assertApiKey(apiKey: string): void {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('YouTube Data API key is required but was not provided.');
  }
}

/** Inspect a YouTube Data API JSON response for quota / not-found errors. */
function handleApiError(json: Record<string, unknown>, inputLabel?: string): void {
  const error = json.error as
    | { code?: number; message?: string; errors?: Array<{ reason?: string }> }
    | undefined;

  if (!error) return;

  const reason = error.errors?.[0]?.reason;

  if (error.code === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
    throw new Error('YouTube Data API quota exceeded. Daily limit is 10,000 units.');
  }

  if (error.code === 400 && reason === 'keyInvalid') {
    throw new Error('YouTube Data API key is invalid.');
  }

  throw new Error(
    inputLabel
      ? `YouTube API error for '${inputLabel}': ${error.message ?? JSON.stringify(error)}`
      : `YouTube API error: ${error.message ?? JSON.stringify(error)}`,
  );
}

// ────────────────────────────────────────────────────────────────────
// Input parsing
// ────────────────────────────────────────────────────────────────────

interface ParsedChannelInput {
  kind: 'channelId' | 'handle';
  value: string;
}

/**
 * Determine whether the caller supplied a raw channel ID, a handle, or a URL
 * that contains one of those.
 */
function parseChannelInput(channelInput: string): ParsedChannelInput {
  const trimmed = channelInput.trim();

  // URL forms:  youtube.com/channel/UCxxx  or  youtube.com/@handle
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      const parts = url.pathname.split('/').filter(Boolean);

      // /channel/UCxxxxxxxx
      if (parts[0] === 'channel' && parts[1]) {
        return { kind: 'channelId', value: parts[1] };
      }

      // /@handle
      if (parts[0]?.startsWith('@')) {
        return { kind: 'handle', value: parts[0] };
      }
    }
  } catch {
    // Not a URL — fall through to the other checks.
  }

  // Raw channel ID (starts with UC and is 24 chars)
  if (/^UC[\w-]{22}$/.test(trimmed)) {
    return { kind: 'channelId', value: trimmed };
  }

  // Handle (with or without leading @)
  const handle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return { kind: 'handle', value: handle };
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve any supported channel reference to a canonical channel ID + title.
 *
 * Accepted inputs:
 *   - `@handle` or bare handle string
 *   - Channel URL: `https://www.youtube.com/@handle` or `.../channel/UCxxx`
 *   - Raw channel ID: `UCxxxxxxxxxxxxxxxxxxxxxxxx`
 */
export async function resolveChannelId(
  apiKey: string,
  channelInput: string,
): Promise<{ channelId: string; channelTitle: string }> {
  assertApiKey(apiKey);

  const parsed = parseChannelInput(channelInput);

  let url: string;
  if (parsed.kind === 'channelId') {
    url = `${YT_BASE}/channels?part=snippet&id=${encodeURIComponent(parsed.value)}&key=${encodeURIComponent(apiKey)}`;
  } else {
    // handle — strip leading @ for the forHandle parameter (API accepts both, but be explicit)
    const handleValue = parsed.value.startsWith('@') ? parsed.value.slice(1) : parsed.value;
    url = `${YT_BASE}/channels?part=snippet&forHandle=${encodeURIComponent(handleValue)}&key=${encodeURIComponent(apiKey)}`;
  }

  const response = await fetch(url);
  const json = (await response.json()) as Record<string, unknown>;

  handleApiError(json, channelInput);

  const items = json.items as Array<{ id?: string; snippet?: { title?: string } }> | undefined;

  if (!items || items.length === 0) {
    throw new Error(`Channel not found: '${channelInput}'`);
  }

  const item = items[0];
  return {
    channelId: item.id!,
    channelTitle: item.snippet?.title ?? '',
  };
}

/**
 * Retrieve the uploads playlist ID for a channel.
 *
 * Uses the `channels.list` endpoint with `part=contentDetails`.
 */
export async function getUploadsPlaylistId(
  apiKey: string,
  channelId: string,
): Promise<string> {
  assertApiKey(apiKey);

  const url = `${YT_BASE}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url);
  const json = (await response.json()) as Record<string, unknown>;

  handleApiError(json, channelId);

  const items = json.items as
    | Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>
    | undefined;

  if (!items || items.length === 0) {
    throw new Error(`Channel not found: '${channelId}'`);
  }

  const uploads = items[0].contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    throw new Error(`Uploads playlist not found for channel '${channelId}'.`);
  }

  return uploads;
}

/**
 * Fetch all videos from an uploads playlist, optionally filtered by date range.
 *
 * Paginates through `playlistItems.list` (50 items per page).
 * Client-side filters on `contentDetails.videoPublishedAt`:
 *   - fromDate: skip videos published before this ISO 8601 date
 *   - toDate:   skip videos published after  this ISO 8601 date
 *
 * Private and deleted video stubs are automatically skipped.
 */
export async function listChannelVideos(
  apiKey: string,
  playlistId: string,
  fromDate?: string,
  toDate?: string,
): Promise<YouTubeVideoMetadata[]> {
  assertApiKey(apiKey);

  const fromMs = fromDate ? new Date(fromDate).getTime() : undefined;
  const toMs = toDate ? new Date(toDate).getTime() : undefined;

  const videos: YouTubeVideoMetadata[] = [];
  let pageToken: string | undefined;

  do {
    let url =
      `${YT_BASE}/playlistItems?part=snippet,contentDetails` +
      `&playlistId=${encodeURIComponent(playlistId)}` +
      `&maxResults=50` +
      `&key=${encodeURIComponent(apiKey)}`;

    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const response = await fetch(url);
    const json = (await response.json()) as Record<string, unknown>;

    handleApiError(json, playlistId);

    const items = json.items as
      | Array<{
          snippet?: {
            title?: string;
            channelTitle?: string;
            description?: string;
          };
          contentDetails?: {
            videoId?: string;
            videoPublishedAt?: string;
          };
        }>
      | undefined;

    if (items) {
      for (const item of items) {
        const title = item.snippet?.title ?? '';

        // Skip private / deleted stubs
        if (title === 'Private video' || title === 'Deleted video') {
          continue;
        }

        const videoId = item.contentDetails?.videoId;
        const publishedAt = item.contentDetails?.videoPublishedAt;

        if (!videoId || !publishedAt) continue;

        const publishedMs = new Date(publishedAt).getTime();

        // Client-side date filtering
        if (fromMs !== undefined && publishedMs < fromMs) continue;
        if (toMs !== undefined && publishedMs > toMs) continue;

        videos.push({
          videoId,
          title,
          publishedAt,
          channelTitle: item.snippet?.channelTitle ?? '',
          description: item.snippet?.description,
        });
      }
    }

    pageToken = (json.nextPageToken as string) ?? undefined;
  } while (pageToken);

  return videos;
}

/**
 * Estimate the YouTube Data API quota cost for scanning a given number of videos.
 *
 * Formula:
 *   playlistCalls = ceil(videoCount / 50)
 *   totalUnits    = playlistCalls + 1   (the +1 accounts for channels.list)
 */
export function estimateQuotaCost(videoCount: number): {
  playlistCalls: number;
  totalUnits: number;
} {
  const playlistCalls = Math.ceil(videoCount / 50);
  const totalUnits = playlistCalls + 1;
  return { playlistCalls, totalUnits };
}

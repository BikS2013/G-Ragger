# Plan 002 -- GeminiRAG v2 Enhancements

**Date**: 2026-04-10
**Version**: 1.0
**Status**: Ready for Implementation
**Specification**: docs/reference/refined-request-v2-enhancements.md
**Investigation**: docs/reference/investigation-v2-enhancements.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [Key Design Decisions](#2-key-design-decisions)
3. [Phase 1 -- Foundation: Types, Config, and Dependency Swap](#3-phase-1----foundation-types-config-and-dependency-swap)
4. [Phase 2 -- Enhanced YouTube Upload Format](#4-phase-2----enhanced-youtube-upload-format)
5. [Phase 3 -- Full File Retrieval (`get` command)](#5-phase-3----full-file-retrieval-get-command)
6. [Phase 4 -- YouTube Data API Service](#6-phase-4----youtube-data-api-service)
7. [Phase 5 -- Channel Scan Command](#7-phase-5----channel-scan-command)
8. [Phase 6 -- Integration, Testing, and Documentation](#8-phase-6----integration-testing-and-documentation)
9. [Dependency Graph and Parallelization](#9-dependency-graph-and-parallelization)
10. [Risks and Mitigations](#10-risks-and-mitigations)

---

## 1. Overview

Three features are being added to GeminiRAG v1:

| Feature | New Commands | Modified Commands |
|---------|-------------|-------------------|
| Full File Retrieval | `get` | -- |
| YouTube Channel Scan | `channel-scan` | -- |
| Enhanced YouTube Upload Format | -- | `upload --youtube` |

**New files to create**: 5
**Existing files to modify**: 8
**New npm dependency**: 1 (`youtube-transcript-plus` replaces `youtube-transcript`)

---

## 2. Key Design Decisions

These decisions are final and must be followed during implementation.

### D1: Full File Retrieval via `generateContent` + File Search Grounding

The Gemini SDK does **not** expose a method to download document content from a File Search Store. The `get` command uses `ai.models.generateContent()` with a verbatim-reproduction prompt and the File Search grounding tool. This is best-effort: long documents may be truncated by the model's output token limit (~65,536 tokens for gemini-2.5-flash), and minor formatting differences are possible. Binary files (PDF, images) cannot be faithfully reproduced and will produce a clear error.

### D2: `playlistItems.list` for Video Enumeration (Not `search.list`)

The `search.list` endpoint caps results at 500 videos and costs 100 quota units per call. The `playlistItems.list` endpoint on the channel's uploads playlist has no item cap and costs 1 unit per call (~55x cheaper). Date filtering is done client-side on `contentDetails.videoPublishedAt`. Channel handle resolution and uploads playlist ID are retrieved together via a single `channels.list` call with `part=id,contentDetails` and `forHandle`.

### D3: `youtube-transcript-plus` Replaces `youtube-transcript`

The `youtube-transcript` package has no retry/backoff logic and is unmaintained. `youtube-transcript-plus` provides built-in exponential backoff (`retries`, `retryDelay` options), caching (`FsCache`, `InMemoryCache`), custom fetch injection for proxies, and distinct error classes. It is actively maintained (v1.2.0, April 2026). The API is compatible: `fetchTranscript(videoId, options)` returns the same segment shape `{ text, offset, duration }`.

### D4: 2-second Delay with Jitter Between Transcript Fetches

During channel scan, a 1.5-2 second delay with +/-500ms jitter is applied between sequential `fetchTranscript()` calls to avoid YouTube rate-limiting. The `youtube-transcript-plus` library handles retries internally (3 retries with 1s initial exponential backoff). If rate-limit errors persist after retries, the scan pauses for 60 seconds before continuing.

### D5: Enhanced YouTube Format with Paragraph Breaks at >2s Gaps

All new YouTube uploads produce structured Markdown with video URL, metadata, and transcript with paragraph breaks inserted where the gap between segments exceeds 2 seconds. The MIME type changes from `text/plain` to `text/markdown`. The `--with-notes` flag appends an AI-generated Notes section.

### D6: `YOUTUBE_DATA_API_KEY` is Lazy-Validated

The key is loaded alongside other config but is optional. Validation (throw if missing) occurs only when the `channel-scan` command is invoked. All other commands work without it.

### D7: Direct `fetch` for YouTube Data API v3

No `googleapis` package is added. The three YouTube Data API v3 endpoints (`channels.list`, `playlistItems.list`, `videos.list`) are called via built-in `fetch` with query parameters. This avoids a ~50MB dependency for 3 GET requests.

---

## 3. Phase 1 -- Foundation: Types, Config, and Dependency Swap

**Goal**: Update shared types, configuration loader, and swap the transcript dependency. All subsequent phases depend on this.

### 3.1 Files Modified

#### `package.json`

| Change | Detail |
|--------|--------|
| Remove dependency | `"youtube-transcript": "^1.3.0"` |
| Add dependency | `"youtube-transcript-plus": "^1.2.0"` |
| Update version | `"version": "1.1.0"` (or `"2.0.0"` per team preference) |

#### `src/types/index.ts`

| Change | Detail |
|--------|--------|
| Extend `AppConfig` | Add `youtubeDataApiKey?: string` and `youtubeDataApiKeyExpiration?: string` |
| Extend `UploadOptions` | Add `withNotes?: boolean` |
| New interface | `YouTubeVideoMetadata` -- `{ title: string; publishedAt: string; channelTitle: string; videoUrl: string }` |
| New interface | `ChannelScanOptions` -- `{ channel: string; from: string; to: string; withNotes?: boolean; maxVideos?: number; dryRun?: boolean; continueOnError?: boolean }` |
| New interface | `ChannelScanResult` -- `{ processed: number; uploaded: number; skipped: number; failed: number }` |

Exact additions to `src/types/index.ts`:

```typescript
// ===== Configuration (extended) =====

export interface AppConfig {
  geminiApiKey: string;
  geminiModel: string;
  geminiApiKeyExpiration?: string;
  /** YouTube Data API v3 key (required for channel-scan only) */
  youtubeDataApiKey?: string;
  /** ISO 8601 date for YouTube API key expiration (optional) */
  youtubeDataApiKeyExpiration?: string;
}

// ===== Upload Options (extended) =====

export interface UploadOptions {
  file?: string;
  url?: string;
  youtube?: string;
  note?: string;
  /** Enable AI notes generation for YouTube uploads */
  withNotes?: boolean;
}

// ===== YouTube Channel Scan Types (new) =====

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle: string;
  videoUrl: string;
  duration?: string; // ISO 8601 duration, e.g., "PT15M32S"
}

export interface ChannelScanOptions {
  channel: string;
  from: string;
  to: string;
  withNotes?: boolean;
  maxVideos?: number;
  dryRun?: boolean;
  continueOnError?: boolean;
}

export interface ChannelScanResult {
  processed: number;
  uploaded: number;
  skipped: number;
  failed: number;
}
```

#### `src/config/config.ts`

| Change | Detail |
|--------|--------|
| Load `YOUTUBE_DATA_API_KEY` | From env/dotenv/config.json, same priority chain. **Optional** -- do not throw if missing. |
| Load `YOUTUBE_DATA_API_KEY_EXPIRATION` | Same priority chain. Warn if within 7 days (same pattern as Gemini key). |
| Return new fields | Include in returned `AppConfig` object when present. |

Implementation detail: After the existing Gemini API key resolution block, add:

```typescript
const youtubeDataApiKey = process.env.YOUTUBE_DATA_API_KEY ?? fileConfig.YOUTUBE_DATA_API_KEY;
const youtubeDataApiKeyExpiration = process.env.YOUTUBE_DATA_API_KEY_EXPIRATION ?? fileConfig.YOUTUBE_DATA_API_KEY_EXPIRATION;

// YouTube API key expiration warning (same pattern as Gemini key)
if (youtubeDataApiKeyExpiration) {
  const ytExpDate = new Date(youtubeDataApiKeyExpiration);
  const ytDaysUntilExpiry = Math.ceil((ytExpDate.getTime() - now.getTime()) / msPerDay);
  if (ytDaysUntilExpiry <= 0) {
    console.warn('WARNING: YOUTUBE_DATA_API_KEY has expired! Renew at https://console.cloud.google.com/');
  } else if (ytDaysUntilExpiry <= 7) {
    console.warn(`WARNING: YOUTUBE_DATA_API_KEY expires in ${ytDaysUntilExpiry} day(s). Renew at https://console.cloud.google.com/`);
  }
}
```

Include `youtubeDataApiKey` and `youtubeDataApiKeyExpiration` in the returned config when present.

#### `src/services/content-extractor.ts` (line 9-10 only)

| Change | Detail |
|--------|--------|
| Swap import | Replace `youtube-transcript` with `youtube-transcript-plus` |
| Expand type cast | Add `offset: number; duration: number` to transcript item type |

Current (lines 9-10):
```typescript
const require = createRequire(import.meta.url);
const { YoutubeTranscript } = require('youtube-transcript') as { YoutubeTranscript: { fetchTranscript: (videoId: string) => Promise<Array<{ text: string }>> } };
```

New:
```typescript
const require = createRequire(import.meta.url);
const { fetchTranscript } = require('youtube-transcript-plus') as {
  fetchTranscript: (videoId: string, options?: { retries?: number; retryDelay?: number }) => Promise<Array<{ text: string; offset: number; duration: number }>>
};
```

Note: `youtube-transcript-plus` exports `fetchTranscript` as a named function, not as a class method. The call site in `extractYouTube` must change from `YoutubeTranscript.fetchTranscript(videoId)` to `fetchTranscript(videoId, { retries: 3, retryDelay: 1000 })`.

### 3.2 Acceptance Criteria

- [ ] `npm install` succeeds with `youtube-transcript-plus` and without `youtube-transcript`
- [ ] `tsc --noEmit` passes with all type changes
- [ ] Existing `upload --youtube` still works (plain text output at this point -- format enhancement comes in Phase 2)
- [ ] `loadConfig()` returns `youtubeDataApiKey` when set, does not throw when absent
- [ ] Expiration warning prints for `YOUTUBE_DATA_API_KEY_EXPIRATION` within 7 days

### 3.3 Test Script

`test_scripts/test-config-v2.ts` -- Tests new config fields loading and validation.

---

## 4. Phase 2 -- Enhanced YouTube Upload Format

**Goal**: Transform YouTube uploads from plain text to structured Markdown with metadata header, paragraph-broken transcript, and optional AI-generated notes.

**Depends on**: Phase 1 (dependency swap and type updates)

### 4.1 Files Created

#### `src/services/notes-generator.ts` (NEW)

Purpose: Generate AI-powered structured notes from a transcript using Gemini `generateContent`.

```typescript
import { GoogleGenAI } from '@google/genai';

/**
 * Generate structured notes from a YouTube video transcript.
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name (e.g., "gemini-2.5-flash")
 * @param title - Video title (for context in the prompt)
 * @param transcript - Full transcript text
 * @returns Markdown-formatted notes string
 * @throws Error if generation fails
 */
export async function generateNotes(
  ai: GoogleGenAI,
  model: string,
  title: string,
  transcript: string
): Promise<string>;
```

Prompt to use:
```
Analyze the following transcript from a YouTube video titled "<title>" and generate structured notes in Markdown format.

Include the following sections:
1. **Summary**: A brief 2-3 sentence summary of the video content.
2. **Key Points**: A bulleted list of the main points discussed.
3. **Important Terms and Concepts**: Key terminology or concepts mentioned, with brief context.
4. **Action Items and Recommendations**: Any actionable advice or recommendations mentioned (omit this section if none are present).

Transcript:
<transcript>
```

### 4.2 Files Modified

#### `src/services/content-extractor.ts`

Major changes to `extractYouTube()`:

1. **Paragraph break algorithm**: After fetching transcript items, build paragraphs by grouping segments. When the gap between one segment's end (`offset + duration`) and the next segment's start (`offset`) exceeds 2 seconds, insert a paragraph break (`\n\n`).

2. **Structured Markdown output**: Build the upload content as:
   ```markdown
   # <Video Title>

   **Source:** <YouTube Video URL>
   **Published:** <Publish Date, if available>
   **Channel:** <Channel Name, if available>

   ---

   ## Transcript

   <paragraph-broken transcript>
   ```

3. **MIME type change**: Return `mimeType: 'text/markdown'` instead of `'text/plain'`.

4. **New function signature for enhanced extraction**: Add a new exported function `extractYouTubeEnhanced()` that accepts optional pre-fetched metadata and notes options:

```typescript
export interface YouTubeExtractOptions {
  /** Pre-fetched metadata (from channel scan); skips oEmbed call when provided */
  metadata?: YouTubeVideoMetadata;
  /** Whether to generate AI notes */
  withNotes?: boolean;
  /** GoogleGenAI instance (required when withNotes is true) */
  ai?: GoogleGenAI;
  /** Model name (required when withNotes is true) */
  model?: string;
}

/**
 * Extract YouTube content in enhanced Markdown format.
 * Used by both single-video upload and channel scan.
 */
export async function extractYouTubeEnhanced(
  url: string,
  options?: YouTubeExtractOptions
): Promise<ExtractedContent>;
```

When `options.metadata` is provided, the oEmbed call is skipped entirely. When `options.withNotes` is true, the notes generator is called and the Notes section is appended.

5. **Backward compatibility**: The existing `extractYouTube()` function is refactored to call `extractYouTubeEnhanced()` internally (without notes, without pre-fetched metadata). The signature remains the same; the output format changes to Markdown.

#### `src/commands/upload.ts`

| Change | Detail |
|--------|--------|
| Add `--with-notes` option | `.option('--with-notes', 'Generate AI notes for YouTube uploads')` |
| Pass notes options to extractor | When `--with-notes` is set and source is `--youtube`, pass `ai` and `model` to `extractYouTubeEnhanced()` |
| Validate `--with-notes` | Only valid with `--youtube`; print warning if used with other source types |

Specific changes in the action handler:

```typescript
// When youtube source with --with-notes
if (options.youtube) {
  extractYouTubeVideoId(options.youtube); // validates URL
  extracted = await extractYouTubeEnhanced(options.youtube, {
    withNotes: options.withNotes,
    ai: options.withNotes ? ai : undefined,
    model: options.withNotes ? config.geminiModel : undefined,
  });
}
```

### 4.3 Acceptance Criteria

- [ ] AC-V2-13: `upload --youtube <url>` produces Markdown with URL, metadata header, and paragraph-broken transcript
- [ ] AC-V2-14: `upload --youtube <url> --with-notes` includes AI-generated Notes section
- [ ] AC-V2-15: Notes contain summary, key points, and important terms
- [ ] AC-V2-16: If notes generation fails, upload proceeds without notes and a warning is printed
- [ ] AC-V2-17: Video URL is embedded in the uploaded content and queryable via `ask`
- [ ] AC-V2-19: MIME type is `text/markdown`
- [ ] Paragraph breaks appear at >2s transcript gaps
- [ ] `--with-notes` without `--youtube` prints a warning

### 4.4 Test Script

`test_scripts/test-youtube-enhanced.ts` -- Tests paragraph break algorithm, Markdown structure, notes generation.

---

## 5. Phase 3 -- Full File Retrieval (`get` command)

**Goal**: New `get` command to retrieve and display the full content of a previously uploaded document.

**Depends on**: Phase 1 (types). Independent of Phase 2.

### 5.1 Files Created

#### `src/commands/get.ts` (NEW)

Export: `registerGetCommand(program: Command): void`

Command registration:
```
geminirag get <workspace> <upload-id>
  --output <path>    Write content to a file instead of stdout
  --raw              Output raw content without metadata header
```

Action handler logic:
1. `loadConfig()` to get API key and model.
2. `getWorkspace(workspace)` to retrieve workspace data.
3. Look up `UploadEntry` by `upload-id` in `workspace.uploads`. Throw `"Upload '<id>' not found in workspace '<name>'"` if not found.
4. Call `getDocumentContent(ai, config.geminiModel, workspaceData.storeName, entry.title)` from `file-search.ts`.
5. If `--raw` is not set, prepend the metadata header.
6. If `--output` is set, write to file. Otherwise, print to stdout.

Metadata header format:
```
=== Upload Metadata ===
Title:       <title>
ID:          <upload-id>
Source Type: <source_type>
Source URL:  <source_url or "N/A">
Uploaded:    <timestamp>
Expiration:  <expiration_date or "None">
Flags:       <flags.join(', ') or "None">
Document:    <documentName>

=== Content ===
```

### 5.2 Files Modified

#### `src/services/file-search.ts`

Add new exported function:

```typescript
/**
 * Retrieve document content from a File Search Store using model-based retrieval.
 * Uses generateContent with a verbatim-reproduction prompt and File Search grounding.
 *
 * Limitations:
 * - Long documents may be truncated by the model's output token limit
 * - Content may not be 100% verbatim (minor formatting differences possible)
 * - Binary files (PDF, images) cannot be faithfully reproduced
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name
 * @param storeName - File Search Store resource name
 * @param documentDisplayName - Document display name to retrieve
 * @returns Document content as a string
 * @throws Error if retrieval fails
 */
export async function getDocumentContent(
  ai: GoogleGenAI,
  model: string,
  storeName: string,
  documentDisplayName: string
): Promise<string>;
```

Implementation:
```typescript
export async function getDocumentContent(
  ai: GoogleGenAI,
  model: string,
  storeName: string,
  documentDisplayName: string
): Promise<string> {
  const prompt =
    `Return the complete, verbatim content of the document titled "${documentDisplayName}" ` +
    `without any summarization, modification, commentary, or formatting changes. ` +
    `Reproduce the document exactly as it was uploaded, including all sections and text.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{
        fileSearch: {
          fileSearchStoreNames: [storeName],
        },
      } as any],
    },
  });

  const content = response.text ?? '';
  if (!content.trim()) {
    throw new Error(
      `Failed to retrieve content for document '${documentDisplayName}': ` +
      `model returned empty response. The document may be too large or in a binary format.`
    );
  }

  return content;
}
```

#### `src/utils/format.ts`

Add new exported function:

```typescript
/**
 * Format upload metadata header for the `get` command output.
 */
export function formatUploadMetadataHeader(entry: UploadEntry): string;
```

#### `src/cli.ts`

Add import and registration:
```typescript
import { registerGetCommand } from './commands/get.js';
// ...
registerGetCommand(program);
```

### 5.3 Acceptance Criteria

- [ ] AC-V2-01: `get <workspace> <upload-id>` displays full content with metadata header
- [ ] AC-V2-02: `get <workspace> <upload-id> --raw` displays content only
- [ ] AC-V2-03: `get <workspace> <upload-id> --output ./file.md` writes to file
- [ ] AC-V2-04: `get <workspace> <invalid-id>` produces clear error
- [ ] AC-V2-05: Works for all source types (file, web, youtube, note)

### 5.4 Test Script

`test_scripts/test-get-command.ts` -- Tests metadata header formatting, raw output, file output, error cases.

---

## 6. Phase 4 -- YouTube Data API Service

**Goal**: New service module for YouTube Data API v3 interactions (channel resolution, video listing, duration fetching).

**Depends on**: Phase 1 (types and config). Independent of Phases 2 and 3.

### 6.1 Files Created

#### `src/services/youtube-data-api.ts` (NEW)

All YouTube Data API v3 interactions via direct `fetch`. No `googleapis` package.

```typescript
import type { YouTubeVideoMetadata } from '../types/index.js';

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

// ---- Channel Resolution ----

export interface ResolvedChannel {
  channelId: string;
  channelTitle: string;
  uploadsPlaylistId: string;
}

/**
 * Resolve a channel identifier to a channel ID, title, and uploads playlist ID.
 *
 * Accepts:
 * - Channel ID: "UCxxxxxx" (24 chars starting with UC)
 * - Channel handle: "@ChannelHandle"
 * - Channel URL: "https://www.youtube.com/@ChannelHandle"
 * - Channel URL: "https://www.youtube.com/channel/UCxxxxxx"
 *
 * @param apiKey - YouTube Data API v3 key
 * @param identifier - Channel identifier in any of the above formats
 * @returns ResolvedChannel object
 * @throws Error if channel cannot be resolved
 */
export async function resolveChannel(
  apiKey: string,
  identifier: string
): Promise<ResolvedChannel>;

// ---- Video Listing ----

/**
 * List all videos from a channel's uploads playlist within a date range.
 * Uses playlistItems.list (1 unit/call, no 500-video cap).
 * Client-side filtering on contentDetails.videoPublishedAt.
 *
 * @param apiKey - YouTube Data API v3 key
 * @param uploadsPlaylistId - Uploads playlist ID (UU...)
 * @param fromDate - Inclusive start date (YYYY-MM-DD)
 * @param toDate - Inclusive end date (YYYY-MM-DD)
 * @param maxVideos - Optional maximum number of videos to return
 * @returns Array of video metadata sorted chronologically (oldest first)
 */
export async function listChannelVideos(
  apiKey: string,
  uploadsPlaylistId: string,
  fromDate: string,
  toDate: string,
  maxVideos?: number
): Promise<YouTubeVideoMetadata[]>;

// ---- Duration Enrichment ----

/**
 * Fetch video durations in batches of 50.
 *
 * @param apiKey - YouTube Data API v3 key
 * @param videoIds - Array of video IDs
 * @returns Map of videoId -> ISO 8601 duration string (e.g., "PT15M32S")
 */
export async function fetchVideoDurations(
  apiKey: string,
  videoIds: string[]
): Promise<Map<string, string>>;

// ---- Duration Formatting ----

/**
 * Convert ISO 8601 duration (PT15M32S) to human-readable (15:32).
 */
export function formatDuration(isoDuration: string): string;

// ---- Quota Estimation ----

/**
 * Estimate YouTube Data API quota usage for a channel scan.
 *
 * @param totalVideos - Total videos in the uploads playlist
 * @returns Estimated quota units
 */
export function estimateQuotaUsage(totalVideos: number): number;
```

Implementation details for `listChannelVideos`:
1. Call `playlistItems.list` with `playlistId`, `part=snippet,contentDetails`, `maxResults=50`.
2. Paginate via `nextPageToken` until exhausted.
3. For each item: extract `contentDetails.videoPublishedAt`, filter client-side against `fromDate` (inclusive) and `toDate` (inclusive, add 1 day to make the comparison inclusive).
4. Filter out private/deleted video stubs (`snippet.title === "Private video"` or `"Deleted video"`).
5. Sort results by `publishedAt` ascending (chronological order).
6. Truncate to `maxVideos` if specified.
7. After collecting video IDs, call `fetchVideoDurations()` to enrich with duration.

Implementation details for `resolveChannel`:
1. Parse identifier:
   - If starts with `UC` and is 24 chars: raw channel ID. Call `channels.list?part=contentDetails&id=<channelId>` to get uploads playlist.
   - If URL containing `/@`: extract handle after `/@`.
   - If URL containing `/channel/UC`: extract channel ID.
   - If starts with `@`: use as handle directly.
   - Otherwise: try as handle.
2. For handles: call `channels.list?part=id,contentDetails&forHandle=<handle>`.
3. Extract `id`, `snippet.title` (if `part` includes snippet), and `contentDetails.relatedPlaylists.uploads`.
4. If no items returned, throw `"Channel not found for identifier '<identifier>'"`.

Error handling:
- API errors (non-200 response): Parse error body, throw with descriptive message.
- Missing fields: Throw specific errors for missing playlist ID, channel ID, etc.

### 6.2 Acceptance Criteria

- [ ] Channel resolution works for `@handle`, `UCxxxxxxx`, and full URLs
- [ ] `playlistItems.list` pagination retrieves all videos (no 500-cap)
- [ ] Date filtering is correctly inclusive on both ends
- [ ] Private/deleted video stubs are filtered out
- [ ] Duration enrichment works in batches of 50
- [ ] Quota estimation is accurate

### 6.3 Test Script

`test_scripts/test-youtube-data-api.ts` -- Tests channel resolution, video listing, duration formatting. Requires `YOUTUBE_DATA_API_KEY` to be set.

---

## 7. Phase 5 -- Channel Scan Command

**Goal**: New `channel-scan` command that scans a YouTube channel, collects videos in a date range, and uploads their transcripts to a workspace.

**Depends on**: Phases 1, 2, and 4 (all must be complete).

### 7.1 Files Created

#### `src/commands/channel-scan.ts` (NEW)

Export: `registerChannelScanCommand(program: Command): void`

Command registration:
```
geminirag channel-scan <workspace>
  --channel <identifier>   YouTube channel (handle, URL, or ID)
  --from <date>            Start date (YYYY-MM-DD), inclusive
  --to <date>              End date (YYYY-MM-DD), inclusive
  --with-notes             Generate AI notes for each video
  --max-videos <n>         Maximum number of videos to process
  --dry-run                List videos without uploading
  --continue-on-error      Skip failed videos instead of stopping
```

Action handler logic:

```
1. loadConfig()
2. Validate YOUTUBE_DATA_API_KEY is present:
   if (!config.youtubeDataApiKey) {
     throw new Error(
       "YOUTUBE_DATA_API_KEY is required for channel scanning. " +
       "Obtain it from https://console.cloud.google.com/ by enabling the " +
       "YouTube Data API v3 and creating an API key."
     );
   }
3. Validate dates (validateDate for --from and --to)
4. getWorkspace(workspace) -- validates workspace exists
5. createGeminiClient(config)

6. resolveChannel(config.youtubeDataApiKey, options.channel)
   -> { channelId, channelTitle, uploadsPlaylistId }

7. listChannelVideos(config.youtubeDataApiKey, uploadsPlaylistId, options.from, options.to, options.maxVideos)
   -> videos: YouTubeVideoMetadata[]

8. Print summary:
   "Found <N> videos in channel "<channelTitle>" between <from> and <to>"
   Print table: #, Published, Title, Duration

9. If --dry-run: stop here.

10. Estimate and log quota usage.

11. For each video (chronological order):
    a. Delay: 1.5-2s with +/-500ms jitter (skip before first video)
    b. Try:
       - extractYouTubeEnhanced(video.videoUrl, {
           metadata: video,
           withNotes: options.withNotes,
           ai: options.withNotes ? ai : undefined,
           model: options.withNotes ? config.geminiModel : undefined,
         })
       - Build customMetadata (source_type=youtube, source_url=videoUrl)
       - uploadContent(ai, storeName, content, false, 'text/markdown', title, metadata)
       - addUpload(workspace, entry)
       - Print: "[<i>/<total>] Uploaded: "<title>" (ID: <uuid>)"
       - Increment uploaded counter
    c. Catch:
       - If transcript not available:
         - If --continue-on-error: print "[<i>/<total>] Skipped: "<title>" -- transcript not available", increment skipped
         - Else: print error, print partial summary, exit
       - If rate-limited (after retries exhausted):
         - Pause 60 seconds, retry once more
         - If still fails and --continue-on-error: skip, increment failed
         - Else: print error, print partial summary, exit
       - Other errors:
         - If --continue-on-error: print "[<i>/<total>] Failed: "<title>" -- <error>", increment failed
         - Else: print error, print partial summary, exit

12. Print final summary:
    "Channel scan complete."
    "Processed: <processed>/<total> videos"
    "Uploaded:  <uploaded>"
    "Skipped:   <skipped> (no transcript)"
    "Failed:    <failed> (upload errors)"
```

#### `src/utils/format.ts` (additions)

Add:
```typescript
/**
 * Format a channel scan video listing table for dry-run or pre-scan display.
 */
export function formatChannelScanTable(videos: YouTubeVideoMetadata[]): string;

/**
 * Format a channel scan summary.
 */
export function formatChannelScanSummary(result: ChannelScanResult, total: number): string;
```

### 7.2 Files Modified

#### `src/cli.ts`

Add import and registration:
```typescript
import { registerChannelScanCommand } from './commands/channel-scan.js';
// ...
registerChannelScanCommand(program);
```

### 7.3 Acceptance Criteria

- [ ] AC-V2-06: `channel-scan --dry-run` lists videos without uploading
- [ ] AC-V2-07: `channel-scan` uploads all videos' transcripts with progress
- [ ] AC-V2-08: `--continue-on-error` skips failed videos; without it, processing stops
- [ ] AC-V2-09: Missing `YOUTUBE_DATA_API_KEY` produces clear error with instructions
- [ ] AC-V2-10: `--max-videos` limits processing count
- [ ] AC-V2-11: Final summary shows processed/uploaded/skipped/failed counts
- [ ] AC-V2-12: All uploaded videos appear in `uploads` listing with correct metadata
- [ ] AC-V2-18: `--with-notes` generates notes for each video individually
- [ ] 2s delay with jitter is applied between transcript fetches
- [ ] Rate-limit pause (60s) is applied when retries are exhausted

### 7.4 Test Script

`test_scripts/test-channel-scan.ts` -- Tests the full scan flow with a known channel. Requires both `YOUTUBE_DATA_API_KEY` and `GEMINI_API_KEY`.

---

## 8. Phase 6 -- Integration, Testing, and Documentation

**Goal**: Final integration, documentation updates, and end-to-end testing.

**Depends on**: All previous phases.

### 8.1 Files Modified

#### `CLAUDE.md`

Update tool documentation to reflect v2 changes:
- Document the `get` command
- Document the `channel-scan` command
- Document the `--with-notes` option on `upload --youtube`
- Update the `upload` command documentation to mention enhanced YouTube format

#### `docs/design/project-design.md`

Update to include:
- New modules in the architecture diagram (`get.ts`, `channel-scan.ts`, `youtube-data-api.ts`, `notes-generator.ts`)
- New data flows for `get` command and `channel-scan` command
- Updated YouTube extraction algorithm (paragraph breaks, Markdown format)
- New `getDocumentContent()` function in file-search service
- Updated `AppConfig` interface with YouTube fields
- Updated `UploadOptions` interface with `withNotes`
- New ADR entries for key decisions (D1-D7)

#### `docs/design/configuration-guide.md`

Add documentation for:
- `YOUTUBE_DATA_API_KEY`: purpose, how to obtain, required only for `channel-scan`
- `YOUTUBE_DATA_API_KEY_EXPIRATION`: optional, 7-day warning pattern

#### `Issues - Pending Items.md`

Add new pending items:
- Full file retrieval truncation for long documents (known limitation)
- `youtube-transcript-plus` stability on cloud servers (proxy may be needed)
- `playlistItems.list` ordering assumption (not guaranteed newest-first)
- No duplicate detection during channel scan

### 8.2 Acceptance Criteria

- [ ] All v2 acceptance criteria (AC-V2-01 through AC-V2-19) pass
- [ ] `tsc --noEmit` passes with no errors
- [ ] `npm run build` produces working `dist/` output
- [ ] All existing v1 commands continue to work unchanged
- [ ] Documentation is complete and accurate

---

## 9. Dependency Graph and Parallelization

```
Phase 1 (Foundation)
  |
  +----> Phase 2 (Enhanced YouTube Format)  ----+
  |                                              |
  +----> Phase 3 (Get Command)  ----+            |
  |                                 |            |
  +----> Phase 4 (YouTube Data API) +----> Phase 5 (Channel Scan)
                                    |            |
                                    +----+-------+
                                         |
                                         v
                                    Phase 6 (Integration)
```

### Parallelization Opportunities

| Can Run in Parallel | Justification |
|---------------------|---------------|
| Phase 2 + Phase 3 + Phase 4 | All depend only on Phase 1; modify different files with no overlap |
| Phase 3 + Phase 5 | Phase 3 touches `file-search.ts` and `get.ts`; Phase 5 touches `channel-scan.ts` and `cli.ts` (different additions) |

### Sequential Dependencies

| Must Wait For | Before Starting |
|---------------|-----------------|
| Phase 1 | Phases 2, 3, 4 |
| Phases 2 + 4 | Phase 5 (channel-scan needs enhanced extractor from Phase 2 and YouTube API service from Phase 4) |
| All phases | Phase 6 |

### Estimated Effort

| Phase | Effort | Files New | Files Modified |
|-------|--------|-----------|----------------|
| Phase 1 | Small | 0 | 4 (`package.json`, `types/index.ts`, `config/config.ts`, `content-extractor.ts` import only) |
| Phase 2 | Medium | 1 (`notes-generator.ts`) | 2 (`content-extractor.ts`, `upload.ts`) |
| Phase 3 | Small | 1 (`get.ts`) | 3 (`file-search.ts`, `format.ts`, `cli.ts`) |
| Phase 4 | Medium | 1 (`youtube-data-api.ts`) | 0 |
| Phase 5 | Large | 1 (`channel-scan.ts`) | 2 (`format.ts`, `cli.ts`) |
| Phase 6 | Small | 0 | 4 (docs only) |

---

## 10. Risks and Mitigations

### High Impact

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Model-based retrieval truncates long documents | Medium | Users get incomplete content | Document limitation clearly; print warning when response appears truncated (e.g., ends abruptly, response length near token limit). Consider splitting into multiple calls as future enhancement. |
| `youtube-transcript-plus` API breaks (unofficial YouTube API) | Low-Medium | Channel scan transcript fetching fails | `--continue-on-error` allows partial scans; error classification distinguishes transient vs. permanent failures; proxy injection option available in the library |

### Medium Impact

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| YouTube rate-limits during large channel scans | Medium | Some videos fail | 2s delay + jitter between fetches; built-in retries in `youtube-transcript-plus`; 60s pause on rate-limit exhaustion; `--max-videos` as safety valve |
| `playlistItems.list` ordering is not strictly newest-first | Low | Client-side date filtering must paginate entire playlist | Always paginate completely; do not rely on early termination. Sort results client-side by `videoPublishedAt`. |
| Model does not reproduce content verbatim | Medium | Minor formatting differences in `get` output | Document as known limitation; this is best-effort retrieval |

### Low Impact

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Notes generation fails for some videos | Low | Upload proceeds without notes (by design) | Warning is printed; notes section is omitted |
| `YOUTUBE_DATA_API_KEY` quota exhaustion | Low | Channel scan fails mid-run | Estimate and display quota usage before scan; `--max-videos` to limit scope |
| `youtube-transcript-plus` package disappears from npm | Very Low | Build fails | Pin exact version; keep `youtube-transcript` as documented fallback option |
| MIME type change (`text/markdown` vs `text/plain`) affects query relevance | Very Low | No meaningful impact confirmed | Both types are indexed by Gemini; no behavioral difference expected |

---

## Appendix A: Complete File Change Summary

### New Files (5)

| File | Phase | Purpose |
|------|-------|---------|
| `src/services/notes-generator.ts` | 2 | AI notes generation from transcripts |
| `src/commands/get.ts` | 3 | `get` command implementation |
| `src/services/youtube-data-api.ts` | 4 | YouTube Data API v3 REST client |
| `src/commands/channel-scan.ts` | 5 | `channel-scan` command implementation |

### Modified Files (8)

| File | Phase(s) | Changes |
|------|----------|---------|
| `package.json` | 1 | Swap `youtube-transcript` -> `youtube-transcript-plus`; bump version |
| `src/types/index.ts` | 1 | Extend `AppConfig`, `UploadOptions`; add `YouTubeVideoMetadata`, `ChannelScanOptions`, `ChannelScanResult` |
| `src/config/config.ts` | 1 | Load `YOUTUBE_DATA_API_KEY` and expiration; add warning |
| `src/services/content-extractor.ts` | 1, 2 | Swap import; expand transcript type; add `extractYouTubeEnhanced()`; paragraph breaks; Markdown format |
| `src/services/file-search.ts` | 3 | Add `getDocumentContent()` |
| `src/commands/upload.ts` | 2 | Add `--with-notes` option; route to `extractYouTubeEnhanced()` |
| `src/utils/format.ts` | 3, 5 | Add `formatUploadMetadataHeader()`, `formatChannelScanTable()`, `formatChannelScanSummary()` |
| `src/cli.ts` | 3, 5 | Register `get` and `channel-scan` commands |

### Test Scripts (4 new)

| File | Phase | Purpose |
|------|-------|---------|
| `test_scripts/test-config-v2.ts` | 1 | New config fields |
| `test_scripts/test-youtube-enhanced.ts` | 2 | Enhanced format, paragraph breaks, notes |
| `test_scripts/test-get-command.ts` | 3 | Get command output, formatting |
| `test_scripts/test-channel-scan.ts` | 5 | Full channel scan flow |
| `test_scripts/test-youtube-data-api.ts` | 4 | YouTube Data API service |

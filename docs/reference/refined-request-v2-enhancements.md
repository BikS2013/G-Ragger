# GeminiRAG v2 - Enhancement Specification

**Date**: 2026-04-10
**Version**: 2.0
**Status**: Draft
**Base Version**: GeminiRAG v1.0 (refined-request.md, project-design.md)

---

## 1. Summary

This specification defines three enhancements to the existing GeminiRAG CLI tool:

1. **Full File Retrieval** -- A new command to retrieve and display the full content of a previously uploaded file from a Gemini File Search Store, so users can inspect what was actually uploaded.

2. **YouTube Channel Scan** -- A new command to scan a YouTube channel, collect all videos published within a user-specified time period, and bulk-upload their transcripts (and optionally notes) to a workspace.

3. **Enhanced YouTube Upload Format** -- When uploading YouTube content (single video or channel scan), the uploaded file is restructured to include the video URL, the full transcript, and optionally AI-generated notes as a distinct section within the document.

These enhancements extend the existing upload pipeline, content extraction, and CLI command layers while preserving all current functionality.

---

## 2. Feature 1: Full File Retrieval

### 2.1 Problem Statement

Currently, once content is uploaded to a Gemini File Search Store, there is no way for the user to view the full content that was uploaded. The `uploads` command shows only metadata (title, source type, timestamp, etc.), and the `ask` command returns AI-generated answers with citation excerpts -- not the complete document. Users need a way to inspect the actual content stored in a workspace.

### 2.2 Command Design

```
geminirag get <workspace> <upload-id>
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace` | string | Yes | Workspace name |
| `upload-id` | string | Yes | Upload UUID (from `uploads` listing) |

**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--output <path>` | string | No | Write content to a file instead of stdout |
| `--raw` | boolean | No | Output raw content without header/metadata section |

### 2.3 Behavior

1. Look up the upload entry in the local registry to retrieve the `documentName` and metadata.
2. Call the Gemini SDK to retrieve the document content from the File Search Store.
3. Display the content to stdout (default) or write to a file (if `--output` is specified).

**Default output format (with metadata header):**

```
=== Upload Metadata ===
Title:       <title>
ID:          <upload-id>
Source Type: <source_type>
Source URL:  <source_url or "N/A">
Uploaded:    <timestamp>
Expiration:  <expiration_date or "None">
Flags:       <flags or "None">
Document:    <documentName>

=== Content ===
<full document content>
```

When `--raw` is specified, only the content section is emitted (no metadata header). This is useful for piping to other tools.

When `--output` is specified, the content (raw or with header, depending on `--raw`) is written to the given file path.

### 2.4 Implementation Approach

The Gemini File Search API provides a `documents.get()` method on `ai.fileSearchStores.documents` that returns document metadata. To retrieve the actual file content, the approach depends on the Gemini SDK capabilities:

- **Option A (Preferred):** If the Gemini SDK exposes a method to download document content (e.g., via the Files API or a content retrieval endpoint), use it directly.
- **Option B (Fallback):** If no direct content retrieval is available from File Search Stores, use the Gemini `generateContent` API with a targeted prompt like: "Return the complete, verbatim content of the document titled '<displayName>' without any summarization, modification, or commentary." This uses the File Search grounding to retrieve the full text. The prompt must instruct the model to reproduce the content faithfully.

**Investigation Required:** Before implementation, research whether the `@google/genai` SDK provides a `documents.get()` method that returns document content, or whether only metadata is returned. Document the findings in `docs/reference/research-document-retrieval.md`.

### 2.5 Error Handling

| Condition | Error Message |
|-----------|---------------|
| Workspace not found | `"Workspace '<name>' not found"` |
| Upload ID not found | `"Upload '<id>' not found in workspace '<name>'"` |
| Content retrieval fails | `"Failed to retrieve content for document '<documentName>': <error details>"` |
| Output file write fails | `"Failed to write to file '<path>': <error details>"` |

---

## 3. Feature 2: YouTube Channel Scan

### 3.1 Problem Statement

Currently, uploading YouTube content requires specifying individual video URLs one at a time. Users who want to ingest an entire channel's content for a given period must manually find and upload each video. A channel scan command automates this process.

### 3.2 Command Design

```
geminirag channel-scan <workspace> --channel <channel-identifier> --from <date> --to <date> [options]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace` | string | Yes | Target workspace name |

**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--channel <identifier>` | string | Yes | YouTube channel identifier (see Section 3.3) |
| `--from <date>` | string | Yes | Start date for video collection (ISO 8601: YYYY-MM-DD), inclusive |
| `--to <date>` | string | Yes | End date for video collection (ISO 8601: YYYY-MM-DD), inclusive |
| `--with-notes` | boolean | No | Also generate AI notes for each video (see Feature 3) |
| `--max-videos <n>` | number | No | Maximum number of videos to process (safety limit; no default -- all matching videos are processed if omitted) |
| `--dry-run` | boolean | No | List videos that would be uploaded without actually uploading them |
| `--continue-on-error` | boolean | No | Skip videos that fail (no transcript, etc.) instead of stopping |

### 3.3 Channel Identification

The `--channel` option accepts any of the following formats:

1. **Channel URL**: `https://www.youtube.com/@ChannelHandle` or `https://www.youtube.com/channel/UCxxxxxx`
2. **Channel Handle**: `@ChannelHandle`
3. **Channel ID**: `UCxxxxxx` (the raw YouTube channel ID)

The tool must resolve the channel identifier to a YouTube channel ID that can be used with the YouTube Data API v3 to list videos.

### 3.4 Behavior

1. **Resolve channel**: Parse the `--channel` value and resolve it to a YouTube channel ID.
2. **Fetch video list**: Use the YouTube Data API v3 `search.list` endpoint (or `playlistItems.list` on the channel's uploads playlist) to retrieve all videos published between `--from` and `--to` dates.
3. **Display plan**: Print the number of videos found and a summary table:
   ```
   Found 24 videos in channel "@TechTalks" between 2026-01-01 and 2026-03-31

   # | Published    | Title                              | Duration
   1 | 2026-01-05   | Introduction to RAG Systems        | 15:32
   2 | 2026-01-12   | Vector Databases Explained         | 22:10
   ...
   ```
4. **Dry-run mode**: If `--dry-run` is specified, stop after displaying the plan. Do not upload anything.
5. **Process each video**: For each video in chronological order:
   a. Extract the transcript using the existing `youtube-transcript` package.
   b. Build the enhanced upload content (see Feature 3 for format).
   c. Upload to the workspace's Gemini File Search Store.
   d. Register in the local registry.
   e. Print progress: `[3/24] Uploaded: "Vector Databases Explained" (ID: <uuid>)`
6. **Error handling per video**:
   - If a video has no transcript available:
     - With `--continue-on-error`: Print warning `[3/24] Skipped: "Video Title" -- transcript not available` and continue.
     - Without `--continue-on-error`: Stop processing and print error with summary of what was uploaded so far.
   - If upload fails for any other reason: same behavior based on `--continue-on-error`.
7. **Final summary**: After processing all videos, print:
   ```
   Channel scan complete.
   Processed: 22/24 videos
   Uploaded:  20
   Skipped:   2 (no transcript)
   Failed:    2 (upload errors)
   ```

### 3.5 YouTube Data API v3 Usage

The YouTube Data API v3 is required for:
- Resolving channel handles to channel IDs (`channels.list` with `forHandle` parameter)
- Listing videos in a channel within a date range (`search.list` with `channelId`, `publishedAfter`, `publishedBefore`, `type=video`, `order=date`)
- Retrieving video metadata (title, publish date, duration)

**API Quota Considerations:**
- The YouTube Data API v3 has a default quota of 10,000 units per day.
- `search.list` costs 100 units per call (returns up to 50 results per page).
- `channels.list` costs 1 unit per call.
- `videos.list` costs 1 unit per call (for duration/metadata).
- A scan of a channel with 200 videos would consume approximately 500 quota units (4 search pages + 4 videos.list pages).
- The tool should log the estimated quota usage before proceeding.

### 3.6 Pagination

The YouTube Data API v3 returns paginated results (max 50 per page). The tool must follow `nextPageToken` to collect all videos in the date range. The `--max-videos` option truncates after collecting the specified count.

---

## 4. Feature 3: Enhanced YouTube Upload Format

### 4.1 Problem Statement

Currently, YouTube uploads contain only the raw transcript text as plain text. This loses important context: the video URL is not included in the uploaded content (only stored in the local registry), and there are no structured notes or summaries. Users querying the workspace cannot distinguish between videos or trace back to the source from the uploaded content alone.

### 4.2 New Upload File Format

When uploading YouTube content (either via `geminirag upload --youtube` or `geminirag channel-scan`), the uploaded file will be a structured Markdown document with the following format:

```markdown
# <Video Title>

**Source:** <YouTube Video URL>
**Published:** <Publish Date, if available>
**Channel:** <Channel Name, if available>

---

## Transcript

<Full transcript text, with paragraph breaks inserted at natural pause points>

---

## Notes

<AI-generated notes: key points, summary, and important details extracted from the transcript>
```

### 4.3 File Format Details

- **MIME Type**: `text/markdown` (changed from `text/plain` for the current implementation)
- The **Video URL** is always included -- this is not optional.
- The **Published date** and **Channel name** are included when available (always available during channel-scan; best-effort during single video upload via oEmbed).
- The **Transcript** section always contains the full transcript text. Paragraph breaks are inserted at segments where there is a pause of more than 2 seconds between transcript items (using the timestamp data from `youtube-transcript`).
- The **Notes** section is only included when the `--with-notes` flag is provided.

### 4.4 Notes Generation

When `--with-notes` is enabled, the tool uses the Gemini model (configured via `GEMINI_MODEL`) to generate structured notes from the transcript. The notes generation follows this process:

1. Send the transcript text to the Gemini `generateContent` API with a prompt requesting:
   - A brief summary (2-3 sentences)
   - Key points discussed (bulleted list)
   - Important terms or concepts mentioned
   - Any action items or recommendations mentioned
2. The response is formatted as Markdown and placed in the Notes section.
3. If notes generation fails (API error, quota, etc.), the upload proceeds without notes, and a warning is printed: `Warning: Notes generation failed for "<title>". Uploading without notes.`

**CLI Integration:**

For single video upload:
```
geminirag upload <workspace> --youtube <url> --with-notes
```

For channel scan:
```
geminirag channel-scan <workspace> --channel <id> --from <date> --to <date> --with-notes
```

### 4.5 Backward Compatibility

- The `--with-notes` flag is optional. Without it, the Notes section is omitted from the uploaded file.
- The upload file format change (adding URL header and Markdown structure) applies to all new YouTube uploads. Previously uploaded YouTube content is not affected.
- The `sourceType` remains `'youtube'` in the registry. No changes to existing metadata fields.
- The MIME type changes from `text/plain` to `text/markdown` for YouTube uploads. This is within the set of supported MIME types already defined.

### 4.6 Upload Options Type Update

The `UploadOptions` interface must be extended:

```typescript
export interface UploadOptions {
  file?: string;
  url?: string;
  youtube?: string;
  note?: string;
  withNotes?: boolean;  // NEW: enable AI notes generation for YouTube uploads
}
```

---

## 5. Configuration Requirements

### 5.1 New Configuration: YouTube Data API Key

| Variable | Purpose | Source | Required | Expirable |
|----------|---------|--------|----------|-----------|
| `YOUTUBE_DATA_API_KEY` | Authentication for YouTube Data API v3 (channel scan only) | Google Cloud Console | Conditionally (required for `channel-scan` command) | Yes |
| `YOUTUBE_DATA_API_KEY_EXPIRATION` | Expiration tracking for YouTube API key | Config file or env var | No | N/A |

**How to obtain:**
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the "YouTube Data API v3" in the API Library.
4. Create an API key in Credentials.
5. (Recommended) Restrict the API key to YouTube Data API v3 only.

**Configuration loading:**
- Same priority as existing config: env vars > `.env` > `~/.g-ragger/config.json`
- The `YOUTUBE_DATA_API_KEY` is NOT required at tool startup. It is only required when the `channel-scan` command is invoked. If missing at that point, the tool throws: `"YOUTUBE_DATA_API_KEY is required for channel scanning. Obtain it from https://console.cloud.google.com/ by enabling the YouTube Data API v3 and creating an API key."`
- If `YOUTUBE_DATA_API_KEY_EXPIRATION` is set and within 7 days, a warning is printed (same pattern as `GEMINI_API_KEY_EXPIRATION`).

### 5.2 Updated AppConfig Interface

```typescript
export interface AppConfig {
  /** Google Gemini API key (required) */
  geminiApiKey: string;
  /** Gemini model name, e.g. "gemini-2.5-flash" (required) */
  geminiModel: string;
  /** ISO 8601 date for API key expiration (optional) */
  geminiApiKeyExpiration?: string;
  /** YouTube Data API v3 key (required for channel-scan only) */
  youtubeDataApiKey?: string;           // NEW
  /** ISO 8601 date for YouTube API key expiration (optional) */
  youtubeDataApiKeyExpiration?: string;  // NEW
}
```

### 5.3 Updated Config File Format (`~/.g-ragger/config.json`)

```json
{
  "GEMINI_API_KEY": "AIza...",
  "GEMINI_MODEL": "gemini-2.5-flash",
  "GEMINI_API_KEY_EXPIRATION": "2026-07-01",
  "YOUTUBE_DATA_API_KEY": "AIza...",
  "YOUTUBE_DATA_API_KEY_EXPIRATION": "2026-07-01"
}
```

### 5.4 New Runtime Dependency

| Package | Version | Purpose | Justification |
|---------|---------|---------|---------------|
| `googleapis` | ^144.x (or `@googleapis/youtube` specifically) | YouTube Data API v3 client | Official Google API client; required for channel listing and video metadata retrieval. The `youtube-transcript` package does not support channel-level operations. |

Alternatively, the YouTube Data API v3 can be called directly via `fetch` to the REST endpoints, avoiding the `googleapis` dependency. This is the **recommended approach** to keep the dependency footprint small:

```
GET https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=<id>&publishedAfter=<date>&publishedBefore=<date>&type=video&maxResults=50&order=date&key=<API_KEY>
```

---

## 6. Acceptance Criteria

### Feature 1: Full File Retrieval

- **AC-V2-01**: Running `geminirag get <workspace> <upload-id>` displays the full content of the uploaded document with a metadata header.
- **AC-V2-02**: Running `geminirag get <workspace> <upload-id> --raw` displays only the document content without the metadata header.
- **AC-V2-03**: Running `geminirag get <workspace> <upload-id> --output ./retrieved.md` writes the content to the specified file.
- **AC-V2-04**: Running `geminirag get <workspace> <invalid-id>` produces a clear error: "Upload '<id>' not found in workspace '<name>'".
- **AC-V2-05**: Retrieving content for uploads of all source types (file, web, youtube, note) works correctly.

### Feature 2: YouTube Channel Scan

- **AC-V2-06**: Running `geminirag channel-scan <workspace> --channel @ChannelHandle --from 2026-01-01 --to 2026-03-31 --dry-run` lists all videos in the channel within the date range without uploading anything.
- **AC-V2-07**: Running `geminirag channel-scan <workspace> --channel @ChannelHandle --from 2026-01-01 --to 2026-03-31` uploads all videos' transcripts to the workspace and prints progress for each video.
- **AC-V2-08**: Videos without transcripts are handled: with `--continue-on-error` they are skipped with a warning; without the flag, processing stops with an error summary.
- **AC-V2-09**: Running `channel-scan` without `YOUTUBE_DATA_API_KEY` configured produces a clear error with instructions.
- **AC-V2-10**: The `--max-videos` option limits the number of videos processed.
- **AC-V2-11**: A final summary is printed showing counts of processed, uploaded, skipped, and failed videos.
- **AC-V2-12**: All uploaded videos appear in `geminirag uploads <workspace>` with `sourceType: youtube` and correct metadata.

### Feature 3: Enhanced YouTube Upload Format

- **AC-V2-13**: Running `geminirag upload <workspace> --youtube <url>` uploads a Markdown file containing the video URL and full transcript (no Notes section by default).
- **AC-V2-14**: Running `geminirag upload <workspace> --youtube <url> --with-notes` uploads a Markdown file containing the video URL, full transcript, AND an AI-generated Notes section.
- **AC-V2-15**: The Notes section contains a summary, key points, and important terms.
- **AC-V2-16**: If notes generation fails, the upload proceeds without the Notes section and a warning is printed.
- **AC-V2-17**: The video URL is included in the uploaded content and is queryable via `geminirag ask`.
- **AC-V2-18**: During `channel-scan --with-notes`, each video gets notes generated individually.
- **AC-V2-19**: The uploaded file MIME type is `text/markdown` (not `text/plain`).

---

## 7. Assumptions

1. **YouTube Data API v3 availability**: The YouTube Data API v3 is assumed to be available and the user can obtain an API key from Google Cloud Console. The free tier quota (10,000 units/day) is sufficient for typical channel scans.

2. **Transcript availability**: Not all YouTube videos have transcripts/captions. The tool gracefully handles videos without transcripts (skip or error depending on `--continue-on-error`).

3. **Channel access**: Only public YouTube channels and their public videos can be scanned. Private or unlisted videos are not accessible via the API.

4. **oEmbed limitations for single video upload**: When uploading a single YouTube video via `--youtube`, the oEmbed API provides the video title but may not provide the channel name or publish date. These fields are included on a best-effort basis. The channel-scan path always has this metadata from the YouTube Data API.

5. **Notes quality**: AI-generated notes depend on the configured Gemini model's capabilities. The quality of notes may vary based on transcript quality and video content. The tool does not guarantee note accuracy.

6. **Gemini content retrieval**: Full file retrieval (Feature 1) depends on the Gemini SDK providing a mechanism to retrieve uploaded document content. If this is not possible directly, a model-based retrieval approach will be used as a fallback (see Section 2.4). This requires investigation before implementation.

7. **Rate limiting**: The tool does not implement rate limiting for YouTube Data API calls or Gemini API calls during channel scan. If rate limits are hit, the errors propagate naturally. Users should use `--max-videos` to control batch sizes.

8. **No duplicate detection**: If a video has already been uploaded to the workspace, the channel scan will upload it again as a new document. Duplicate detection is out of scope for this version.

9. **Transcript language**: The tool uses the default transcript language (typically the original language of the video or auto-generated captions). Language selection is out of scope.

10. **YouTube Data API key is independent**: The `YOUTUBE_DATA_API_KEY` is a separate configuration from `GEMINI_API_KEY`. They may come from different Google Cloud projects.

---

## 8. Out of Scope

1. **Duplicate detection**: No check for whether a video has already been uploaded to the workspace. Users must manage this manually.
2. **Transcript language selection**: No option to choose a specific caption language; the default/auto-generated transcript is used.
3. **Video download or audio extraction**: The tool only extracts transcripts and metadata; no video or audio content is downloaded.
4. **Playlist scanning**: Only channel-level scanning is supported. Scanning a specific YouTube playlist by URL is not included (can be added later).
5. **Incremental/scheduled scans**: No cron-like scheduling or "scan since last run" functionality. Each scan is a one-time operation.
6. **Private/unlisted video access**: Only publicly accessible videos are supported. OAuth-based access to private videos is out of scope.
7. **Custom notes prompts**: The AI notes generation uses a fixed prompt. Users cannot customize what the notes contain (can be added later).
8. **Full file content editing**: The `get` command is read-only. There is no command to update/replace the content of an uploaded file.
9. **Batch upload from directory**: Bulk upload of local files from a directory remains out of scope (as in v1).
10. **YouTube Shorts filtering**: No option to include or exclude YouTube Shorts from channel scans.
11. **Retroactive format migration**: Existing YouTube uploads (from v1) are not reformatted to the new Markdown structure. Only new uploads use the enhanced format.

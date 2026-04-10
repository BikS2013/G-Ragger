# Investigation Report: GeminiRAG v2 Enhancements

**Date**: 2026-04-10
**Status**: Complete
**Scope**: Technical feasibility and approach research for three v2 features

---

## Executive Summary

All three proposed features are technically feasible. The investigation uncovered one significant constraint: the Gemini File Search API does **not** provide a direct method to retrieve the content of documents stored in a File Search Store. A model-based retrieval approach (Option B from the specification) is the only viable path for Feature 1. Features 2 and 3 are straightforward with no blocking technical gaps. The YouTube Data API v3 can be called via direct `fetch` (no new npm dependencies needed), and the `youtube-transcript` package already provides `offset` and `duration` fields needed for paragraph-break insertion in Feature 3.

---

## Feature 1: Full File Retrieval (`get` command)

### Investigation Question

Can the `@google/genai` SDK download or read document content back from a Gemini File Search Store?

### Findings

**1. File Search Store Document API -- Metadata Only**

The `ai.fileSearchStores.documents` namespace exposes three methods:
- `list({ parent })` -- Lists documents in a store. Returns `name`, `displayName`, and metadata. No content.
- `get({ name })` -- Not documented in the SDK's public API surface for File Search Store documents. The SDK's `documents` sub-namespace on `fileSearchStores` only exposes `list`, `delete`, and the upload/import paths. There is no `documents.get()` method that returns document content.
- `delete({ name })` -- Deletes a document.

The `GET /api/v1/{parent}/documents` endpoint returns document metadata arrays with pagination, not content.

**2. Files API -- Separate from File Search Stores**

The `ai.files` namespace provides:
- `ai.files.get({ name })` -- Returns metadata only (name, sizeBytes, mimeType, createTime, state).
- `ai.files.download({ file, downloadPath })` -- Downloads file content. **Node.js only.**

However, files uploaded via `uploadToFileSearchStore` are **not the same** as files in the Files API namespace. The Files API uses resource names like `files/abc123`, while File Search Store documents use `fileSearchStores/.../documents/...`. These are separate resource hierarchies. A document uploaded directly to a File Search Store via `uploadToFileSearchStore()` does not appear in `ai.files.list()` and cannot be downloaded via `ai.files.download()`.

Only files uploaded via the two-step path (`ai.files.upload()` followed by `ai.fileSearchStores.importFile()`) would have a corresponding entry in the Files API. But even then, Files API entries expire after 48 hours, while File Search Store documents persist until deleted. So the Files API entry is ephemeral and unreliable for retrieval.

**3. Official Gemini File Search Documentation**

The official documentation at `ai.google.dev/gemini-api/docs/file-search` covers:
- Direct upload to File Search Store
- Import from Files API into File Search Store
- Querying with `generateContent` + `fileSearch` tool

There is no documented method for retrieving document content from a File Search Store. The API is designed as a write-then-query system: content goes in, and the model retrieves relevant chunks at query time via grounding.

### Approach Recommendation: Model-Based Retrieval (Option B)

Since no direct content retrieval API exists, **Option B** from the specification is the only viable approach:

Use `ai.models.generateContent()` with a carefully crafted verbatim-reproduction prompt and the File Search grounding tool to instruct the model to reproduce the full content of a specific document.

**Proposed implementation:**

```typescript
async function getDocumentContent(
  ai: GoogleGenAI,
  model: string,
  storeName: string,
  documentDisplayName: string
): Promise<string> {
  const prompt = `Return the complete, verbatim content of the document titled "${documentDisplayName}" ` +
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

  return response.text ?? '';
}
```

**Limitations of this approach:**
- **Token limits**: Very long documents may be truncated by the model's output token limit. The maximum output tokens for `gemini-2.5-flash` is approximately 65,536 tokens (~50,000 words). Documents larger than this will be truncated.
- **Fidelity**: The model may not reproduce content 100% verbatim. Minor formatting changes, whitespace differences, or small omissions are possible. This is inherent to model-based retrieval.
- **Cost**: Each `get` invocation costs Gemini API tokens (both input from grounding retrieval and output for reproduction).
- **No binary content**: This approach only works for text-based documents. Binary files (PDFs, images) cannot be faithfully reproduced this way. For PDF/binary uploads, the `get` command would need to state this limitation.

**Mitigation for long documents:** Consider splitting the retrieval into multiple calls using section-based prompts (e.g., "Return section 1 of...", "Continue from where you left off..."). However, this adds significant complexity and is recommended as a future enhancement, not for v2.

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Model does not reproduce content verbatim | Medium | Document this as a known limitation; model may paraphrase or rearrange |
| Long documents truncated by output token limit | Medium | Warn user when response appears truncated; document max size limitations |
| Binary files (PDF) cannot be retrieved as text | Low | Show clear error: "Content retrieval not supported for binary file types" |
| API cost per retrieval call | Low | Document cost implications; each get call uses Gemini tokens |

---

## Feature 2: YouTube Channel Scan

### Investigation Question

How to list videos from a YouTube channel for a given date range using the YouTube Data API v3, and can we use direct `fetch` calls instead of the `googleapis` package?

### Findings

**1. YouTube Data API v3 `search.list` Endpoint**

The `search.list` endpoint is confirmed to support all required parameters:

```
GET https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &channelId=<channel_id>
  &publishedAfter=<ISO8601_date>T00:00:00Z
  &publishedBefore=<ISO8601_date>T23:59:59Z
  &type=video
  &order=date
  &maxResults=50
  &pageToken=<token>
  &key=<API_KEY>
```

Key parameters confirmed:
- `channelId` (string) -- Restricts results to a specific channel. **Important**: results are capped at 500 videos when using `channelId` with `type=video`.
- `publishedAfter` (datetime, RFC 3339) -- Inclusive lower bound.
- `publishedBefore` (datetime, RFC 3339) -- Exclusive upper bound.
- `type=video` -- Restricts to video results only.
- `order=date` -- Sorts by creation date.
- `maxResults` (1-50) -- Maximum results per page. Default is 5.
- `pageToken` -- Token for pagination.

**Response format** (per item in `items[]`):
```json
{
  "id": { "kind": "youtube#video", "videoId": "dQw4w9WgXcQ" },
  "snippet": {
    "publishedAt": "2026-01-15T10:30:00Z",
    "channelId": "UCxxxxxxx",
    "title": "Video Title",
    "description": "Video description...",
    "channelTitle": "Channel Name",
    "thumbnails": { ... }
  }
}
```

**Pagination**: The response includes `nextPageToken` when more results are available. The tool must loop, passing `pageToken=<nextPageToken>`, until no more pages remain or `--max-videos` is reached.

**Quota cost**: 100 units per `search.list` call. With 50 results per page, scanning a channel with 200 videos requires 4 calls = 400 units. The daily default quota is 10,000 units.

**500-video cap**: When filtering by `channelId` and `type=video`, the API caps results at 500 videos. For channels with more than 500 videos in the date range, this is a hard limit. This should be documented as a known limitation.

**2. Channel Handle Resolution via `channels.list`**

The `channels.list` endpoint supports the `forHandle` parameter:

```
GET https://www.googleapis.com/youtube/v3/channels
  ?part=snippet
  &forHandle=@ChannelHandle
  &key=<API_KEY>
```

- `forHandle` (string) -- Accepts a YouTube handle with or without the `@` prefix.
- Returns the channel resource including `id` (the channel ID).
- **Quota cost**: 1 unit per call.

**Resolution logic for `--channel` parameter:**
1. If the input starts with `UC` and is 24 characters long, treat it as a raw channel ID (no API call needed).
2. If the input starts with `@` or is a URL containing `@`, extract the handle and call `channels.list` with `forHandle`.
3. If the input is a URL containing `/channel/UCxxxxxx`, extract the channel ID directly.

**3. Video Duration Retrieval**

The `search.list` endpoint does **not** return video duration. To get duration, a separate `videos.list` call is needed:

```
GET https://www.googleapis.com/youtube/v3/videos
  ?part=contentDetails
  &id=<comma-separated-video-ids>
  &key=<API_KEY>
```

- Accepts up to 50 video IDs per call (comma-separated).
- Returns `contentDetails.duration` in ISO 8601 duration format (e.g., `PT15M32S`).
- **Quota cost**: 1 unit per call.

This can be batched: after collecting video IDs from `search.list`, make `videos.list` calls with 50 IDs each. For 200 videos, that is 4 additional calls = 4 units. Minimal quota impact.

**4. Direct `fetch` vs `googleapis` Package**

All three endpoints (`search.list`, `channels.list`, `videos.list`) are simple REST GET requests with query parameters. Using direct `fetch` is straightforward and **recommended**:

- No new npm dependency required (Node.js 18+ has global `fetch`).
- The `googleapis` package is ~50MB installed and would be massive overkill for 3 GET endpoints.
- Error handling is simple: check `response.ok`, parse JSON, check for `error` field.
- API key is passed as a query parameter (`key=<API_KEY>`).

**Proposed service structure:**

```typescript
// src/services/youtube-data-api.ts

interface VideoInfo {
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle: string;
  duration?: string; // ISO 8601 duration, e.g., "PT15M32S"
}

async function resolveChannelId(apiKey: string, identifier: string): Promise<{ channelId: string; channelTitle: string }>;
async function listChannelVideos(apiKey: string, channelId: string, fromDate: string, toDate: string, maxVideos?: number): Promise<VideoInfo[]>;
async function fetchVideoDurations(apiKey: string, videoIds: string[]): Promise<Map<string, string>>;
```

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| 500-video cap per channel+type search | Low | Document limitation; most date-range scans will be under 500 |
| Quota exhaustion (10,000 units/day) | Low | Log estimated quota before scan; `--max-videos` as safety valve |
| Rate limiting (requests per second) | Low | Sequential processing provides natural throttling; no parallel calls needed |
| Channel handle resolution fails for unusual handles | Low | Fall back to error message with instructions to use direct channel ID |
| `publishedBefore` is exclusive | Low | Add 1 day to `--to` date to make it inclusive as the user expects |

---

## Feature 3: Enhanced YouTube Upload Format with Notes

### Investigation Question

How to structure the enhanced upload format, use transcript timing for paragraph breaks, and generate AI notes.

### Findings

**1. `youtube-transcript` Package -- Confirmed `offset` and `duration` Fields**

The `youtube-transcript` package (v1.3.x) returns `TranscriptResponse[]` with the following interface (confirmed from source code at `github.com/Kakulukian/youtube-transcript`):

```typescript
export interface TranscriptResponse {
  text: string;
  duration: number;  // Duration of this segment in SECONDS
  offset: number;    // Start time of this segment in SECONDS
  lang?: string;
}
```

The current codebase casts the type as `Array<{ text: string }>`, stripping `offset` and `duration`. The fix is to expand the type cast on line 10 of `content-extractor.ts`:

```typescript
// Current (line 10):
const { YoutubeTranscript } = require('youtube-transcript') as {
  YoutubeTranscript: { fetchTranscript: (videoId: string) => Promise<Array<{ text: string }>> }
};

// Fixed:
const { YoutubeTranscript } = require('youtube-transcript') as {
  YoutubeTranscript: { fetchTranscript: (videoId: string) => Promise<Array<{ text: string; offset: number; duration: number }>> }
};
```

**2. Paragraph Break Insertion Algorithm**

The specification requires paragraph breaks at points where there is a pause of more than 2 seconds between transcript segments. The algorithm:

```typescript
function buildTranscriptWithParagraphs(
  items: Array<{ text: string; offset: number; duration: number }>,
  pauseThresholdSeconds: number = 2.0
): string {
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (let i = 0; i < items.length; i++) {
    currentParagraph.push(items[i].text);

    // Check if there's a pause before the next segment
    if (i < items.length - 1) {
      const currentEnd = items[i].offset + items[i].duration;
      const nextStart = items[i + 1].offset;
      const gap = nextStart - currentEnd;

      if (gap > pauseThresholdSeconds) {
        paragraphs.push(currentParagraph.join(' '));
        currentParagraph = [];
      }
    }
  }

  // Flush remaining text
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '));
  }

  return paragraphs.join('\n\n');
}
```

This is straightforward to implement. The `offset` and `duration` values are in seconds (confirmed from the package source: they come from the `start` and `dur` attributes of the XML transcript format).

**3. Enhanced Markdown File Format**

The upload file structure is clear from the specification:

```markdown
# <Video Title>

**Source:** <YouTube Video URL>
**Published:** <Publish Date, if available>
**Channel:** <Channel Name, if available>

---

## Transcript

<Full transcript with paragraph breaks>

---

## Notes

### Summary
<2-3 sentence summary>

### Key Points
- Point 1
- Point 2
- ...

### Important Terms and Concepts
- Term 1: definition/context
- ...

### Action Items and Recommendations
- Item 1
- ...
```

**MIME type change**: From `text/plain` to `text/markdown`. This is within the set of supported MIME types already used by the web extractor, so no validation changes are needed.

**4. Notes Generation via Gemini**

The notes generation uses `ai.models.generateContent()` with the transcript text. Proposed prompt:

```typescript
const notesPrompt = `Analyze the following transcript from a YouTube video titled "${title}" and generate structured notes in Markdown format.

Include the following sections:
1. **Summary**: A brief 2-3 sentence summary of the video content.
2. **Key Points**: A bulleted list of the main points discussed.
3. **Important Terms and Concepts**: Key terminology or concepts mentioned, with brief context.
4. **Action Items and Recommendations**: Any actionable advice or recommendations mentioned (omit this section if none are present).

Transcript:
${transcriptText}`;
```

**Token considerations for notes generation:**
- Input: The full transcript (typically 2,000-15,000 tokens for a 10-60 minute video).
- Output: Notes are typically 200-500 tokens.
- For channel scans with `--with-notes`, each video requires one `generateContent` call.
- A 24-video channel scan with notes = 24 additional API calls. At typical transcript sizes, this is manageable within rate limits.

**5. Integration with Channel Scan**

During channel scan, video metadata (title, publishDate, channelTitle) comes from the YouTube Data API `search.list` response. The existing `extractYouTube()` function makes a separate oEmbed call for the title, which is redundant when metadata is already available from the API.

**Recommended approach**: Create a variant of the YouTube extraction that accepts pre-fetched metadata:

```typescript
interface YouTubeVideoMetadata {
  title: string;
  publishedAt: string;
  channelTitle: string;
  videoUrl: string;
}

async function extractYouTubeEnhanced(
  url: string,
  options?: {
    metadata?: YouTubeVideoMetadata;
    withNotes?: boolean;
    ai?: GoogleGenAI;
    model?: string;
  }
): Promise<ExtractedContent>;
```

When `metadata` is provided (channel-scan path), the oEmbed call is skipped. When not provided (single-video upload path), oEmbed is used as before (with limited metadata -- no publishDate or channelTitle).

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Notes generation fails (API error, quota) | Low | Specification says upload proceeds without notes + warning; already handled |
| Transcript has no natural pauses (continuous speech) | Low | Result is one long paragraph -- acceptable; content is still correct |
| Very long transcripts exceed model context for notes | Low | Gemini 2.5 Flash supports 1M tokens input; no practical transcript will exceed this |
| MIME type change breaks existing queries | None | New uploads use `text/markdown`; old uploads unaffected; both types queryable |

---

## Technology Choices Summary

| Feature | Technology | Rationale |
|---------|-----------|-----------|
| File retrieval | `ai.models.generateContent` with File Search grounding | No direct content retrieval API exists |
| YouTube channel listing | Direct `fetch` to YouTube Data API v3 REST endpoints | Zero new dependencies; 3 simple GET endpoints |
| Channel handle resolution | `channels.list` with `forHandle` parameter | Official API; 1 quota unit per call |
| Video duration | `videos.list` with `contentDetails` part | Batched efficiently at 50 IDs per call |
| Transcript paragraph breaks | `offset` + `duration` from `youtube-transcript` | Already available in existing dependency |
| Notes generation | `ai.models.generateContent` with structured prompt | Reuses existing Gemini client; no new dependency |
| Upload format | Markdown (`text/markdown`) | Already supported; used by web extractor |

**New npm dependencies required: None.**

All features can be implemented using existing dependencies (`@google/genai`, `youtube-transcript`) plus the built-in `fetch` API for YouTube Data API v3 calls.

---

## Configuration Impact

| Setting | Feature | Required When | Source |
|---------|---------|---------------|--------|
| `YOUTUBE_DATA_API_KEY` | Channel Scan | `channel-scan` command invoked | Google Cloud Console |
| `YOUTUBE_DATA_API_KEY_EXPIRATION` | Channel Scan | Optional, for proactive expiration warning | User-provided |

These are lazy-loaded: only validated when `channel-scan` is invoked. All other features work with existing configuration.

---

## Technical Research Guidance

Research needed: Yes

### Topic 1: Gemini Model Output Token Limits for Verbatim Retrieval

- **Why**: Feature 1 (Full File Retrieval) depends on the model reproducing full document content. If a document exceeds the model's maximum output tokens, retrieval will be incomplete. We need to confirm the exact output token limits for the configured model and determine the practical maximum document size that can be retrieved.
- **Focus**: Test with `gemini-2.5-flash` model; determine max output tokens; measure how accurately long documents are reproduced verbatim; identify the threshold where truncation begins.
- **Depth**: medium

### Topic 2: File Search Grounding Chunk Size and Retrieval Completeness

- **Why**: The File Search tool retrieves relevant chunks, not necessarily the entire document. A verbatim-reproduction prompt may only receive partial chunks from the grounding system, making full retrieval impossible for larger documents.
- **Focus**: Test whether a "reproduce this document" prompt causes the grounding system to return all chunks of a document or only the most relevant subset. Determine if there is a maximum grounding context size.
- **Depth**: deep

### Topic 3: YouTube Data API v3 -- 500-Video Cap Workaround

- **Why**: The `search.list` endpoint caps results at 500 when filtering by `channelId` + `type=video`. Prolific channels may have more than 500 videos in a date range.
- **Focus**: Investigate whether using the channel's `uploads` playlist (via `playlistItems.list`) bypasses the 500-video cap. The `contentDetails.relatedPlaylists.uploads` field from `channels.list` gives the uploads playlist ID. `playlistItems.list` costs 1 unit per call (vs 100 for `search.list`) and may not have the 500-item cap. However, it does not support date filtering natively -- client-side filtering would be needed.
- **Depth**: shallow

### Topic 4: youtube-transcript Rate Limiting and Reliability at Scale

- **Why**: During a channel scan of 50-200 videos, `YoutubeTranscript.fetchTranscript()` will be called sequentially for each video. YouTube may rate-limit or CAPTCHA-block these requests.
- **Focus**: Determine empirical rate limits; test with sequential calls; check if the package handles retries or backoff; consider adding a configurable delay between transcript fetches.
- **Depth**: shallow

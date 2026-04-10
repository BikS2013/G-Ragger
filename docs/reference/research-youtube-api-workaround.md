# YouTube Data API v3 — 500-Video Cap Workaround

## Overview

The YouTube Data API v3 `search.list` endpoint caps results at **500 videos** when filtering by `channelId` combined with `type=video`. For prolific channels with more than 500 uploads, this cap makes complete channel enumeration impossible through `search.list` alone.

This document covers the primary workaround — using the channel's **uploads playlist** via `playlistItems.list` — along with quota cost analysis, pagination behavior, date filtering limitations, and handle resolution.

---

## Key Concepts

### The 500-Video Cap on `search.list`

When you call `search.list` with `channelId=UCxxx&type=video`, YouTube stops returning a `nextPageToken` after 500 results. This is an intentional platform-level limit, not a pagination bug. YouTube's rationale is that result relevancy degrades beyond that point for search-style queries. There is no parameter to override this limit.

### The Uploads Playlist

Every YouTube channel has a special system-managed playlist that contains all videos ever uploaded to that channel. This playlist:

- Has no item limit (no 500-video cap).
- Is always up to date (videos appear in the playlist as soon as they are published).
- Is accessible without authentication when the channel is public.
- Is ordered by the channel owner's specified order (typically newest-first, but not guaranteed).

---

## Getting the Uploads Playlist ID

### Via `channels.list` API Call

The canonical method is to call `channels.list` with `part=contentDetails` and look up `contentDetails.relatedPlaylists.uploads` in the response.

**Endpoint:**
```
GET https://www.googleapis.com/youtube/v3/channels
  ?part=contentDetails
  &id=UCxxxxxxxxxxxxxxxxxxxxxxxx
  &key=YOUR_API_KEY
```

**Response structure (relevant fragment):**
```json
{
  "items": [
    {
      "id": "UCxxxxxxxxxxxxxxxxxxxxxxxx",
      "contentDetails": {
        "relatedPlaylists": {
          "uploads": "UUxxxxxxxxxxxxxxxxxxxxxxxx"
        }
      }
    }
  ]
}
```

The `uploads` playlist ID is always present for public channels. Quota cost: **1 unit**.

### The UC → UU Shortcut (Undocumented)

There is a well-known pattern in the developer community: the uploads playlist ID for a channel can be derived by replacing the `UC` prefix of the channel ID with `UU`.

- Channel ID: `UCxxxxxxxxxxxxxxxxxxxxxxxx`
- Uploads playlist ID: `UUxxxxxxxxxxxxxxxxxxxxxxxx`

**Important caveat:** This shortcut is not documented in the official YouTube API documentation and is based on observed behavior. It works reliably in practice but could theoretically break in the future. Confidence: MEDIUM. The safe approach is to always retrieve the playlist ID via `channels.list`.

---

## Resolving a Channel Handle to a Channel ID

YouTube introduced `@handle` identifiers (e.g., `@MrBeast`, `@veritasium`) as the modern way to identify channels. To convert a handle to a channel ID before calling the uploads playlist flow, use the `forHandle` parameter on `channels.list`.

### Using `forHandle` (Official — Added January 31, 2024)

**Endpoint:**
```
GET https://www.googleapis.com/youtube/v3/channels
  ?part=id,contentDetails
  &forHandle=@YourChannelHandle
  &key=YOUR_API_KEY
```

- The `@` prefix is optional; the API accepts both `@GoogleDevelopers` and `GoogleDevelopers`.
- You can combine `part=id,contentDetails` to get the channel ID and the uploads playlist ID in a single call (1 quota unit total).
- This is the recommended approach for new-style handles.

### Using `forUsername` (Legacy Usernames)

For channels created before the handle system, use:

```
GET https://www.googleapis.com/youtube/v3/channels
  ?part=id,contentDetails
  &forUsername=LegacyUsername
  &key=YOUR_API_KEY
```

### Using `search.list` as Fallback (When Only a Display Name Is Known)

If you only have a display name (not a handle or username):

```
GET https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &type=channel
  &q=DisplayName
  &key=YOUR_API_KEY
```

**Cost: 100 units.** Use this only as a last resort. Display names are not unique, so the response may contain multiple channels; the code must handle disambiguation.

### Complete Handle Resolution Strategy (Recommended Order)

1. If input is a channel ID (starts with `UC` and is 24 characters): use directly.
2. If input is a `@handle` or a potential legacy username: call `channels.list` with `forHandle` first; if no result, retry with `forUsername`. Total cost: 1–2 units.
3. If input is a bare display name: call `search.list` with `type=channel`. Cost: 100 units.

---

## Fetching All Videos via `playlistItems.list`

### API Endpoint

```
GET https://www.googleapis.com/youtube/v3/playlistItems
  ?part=snippet,contentDetails
  &playlistId=UUxxxxxxxxxxxxxxxxxxxxxxxx
  &maxResults=50
  &pageToken=PAGE_TOKEN
  &key=YOUR_API_KEY
```

**Required parameters:**
- `playlistId`: The uploads playlist ID (`UU...`).
- `part`: At minimum `snippet` for title and video ID. Add `contentDetails` to get `videoPublishedAt`.

**Optional parameters:**
- `maxResults`: Integer 1–50 (default 5). Always set to 50 for efficiency.
- `pageToken`: Opaque token returned in the previous response's `nextPageToken` field. Omit on the first call.

### Pagination

The response includes:

```json
{
  "pageInfo": {
    "totalResults": 1247,
    "resultsPerPage": 50
  },
  "nextPageToken": "CAUQAA",
  "items": [ ... ]
}
```

- `pageInfo.totalResults`: Total number of videos in the uploads playlist. Use this to estimate pagination depth before starting.
- `nextPageToken`: Present only when more pages exist. When absent (or `null`), iteration is complete.
- `prevPageToken`: Available for backwards navigation but rarely needed for full-channel scans.

**Pagination loop logic:**

```typescript
let pageToken: string | undefined = undefined;
const allVideoIds: string[] = [];

do {
  const response = await youtube.playlistItems.list({
    part: ['snippet', 'contentDetails'],
    playlistId: uploadsPlaylistId,
    maxResults: 50,
    pageToken: pageToken,
  });

  for (const item of response.data.items ?? []) {
    const videoId = item.snippet?.resourceId?.videoId;
    if (videoId) allVideoIds.push(videoId);
  }

  pageToken = response.data.nextPageToken ?? undefined;
} while (pageToken !== undefined);
```

### There Is No Hard Item Cap

Unlike `search.list`, `playlistItems.list` has **no documented upper limit** on the total number of items retrievable via pagination. Channels with thousands of videos can be fully enumerated by following `nextPageToken` until it is absent.

---

## Date Filtering in `playlistItems.list`

### Server-Side Date Filtering: Not Supported

`playlistItems.list` has **no `publishedBefore`, `publishedAfter`, or date-range parameters**. The only filter parameters are `id` (specific item IDs) and `playlistId`. There is no way to ask the API to return only videos published after a certain date.

### Available Date Fields in the Response

When `part=snippet,contentDetails` is requested, each item includes two date fields:

| Field | Meaning |
|---|---|
| `snippet.publishedAt` | Date/time the item was **added to the playlist** |
| `contentDetails.videoPublishedAt` | Date/time the **video was published** on YouTube |

For the uploads playlist, these two dates are usually the same. However, if a creator backdated a video or re-added it to the uploads playlist, they can diverge. For a channel scan where you want the actual video publish date, prefer `contentDetails.videoPublishedAt`.

### Client-Side Date Filtering Strategy

Because no server-side filter exists, client-side filtering is required for incremental scans:

1. Begin paginating from the first page (newest videos for a typical uploads playlist).
2. On each page, check `contentDetails.videoPublishedAt` against your target date threshold.
3. If all videos on the current page are newer than your threshold, continue to the next page.
4. **Early termination:** When you encounter a video older than your threshold, you can stop paginating — the uploads playlist is ordered newest-first for most channels. However, this ordering is not guaranteed by the API. If strict correctness is required, you must paginate the full playlist and filter the complete result set.

**Confidence on newest-first ordering:** MEDIUM. The uploads playlist typically reflects upload order, but YouTube does not document a guaranteed sort order for `playlistItems.list` on the uploads playlist. Treat early termination as a performance optimization, not a correctness guarantee.

---

## Quota Cost Comparison

| Operation | Endpoint | Quota Cost | Notes |
|---|---|---|---|
| Resolve `@handle` to channel ID | `channels.list` | 1 unit | One-time cost per channel |
| Get uploads playlist ID | `channels.list` | 1 unit | Can be combined with handle resolution |
| Fetch one page of 50 videos | `playlistItems.list` | 1 unit | Each paginated call = 1 unit |
| Fetch all videos from a 1,000-video channel | `playlistItems.list` (×20 pages) | 20 units | |
| Fetch all videos via `search.list` (500 max) | `search.list` (×10 pages of 50) | 1,000 units | And still misses videos beyond 500 |
| Full channel scan: handle → playlist ID → all items | Combined | 2 + ceil(N/50) units | N = total video count |

**Example:** A channel with 800 videos costs:
- Via uploads playlist: `1 (handle) + 1 (channel details) + 16 pages = 18 units`
- Via `search.list`: `1,000 units` and still returns at most 500 videos

The uploads playlist approach is approximately **55× cheaper** for a 500-video channel and scales linearly, while `search.list` hits a hard wall.

### Daily Quota Budget Implications

With the default daily quota of **10,000 units**:

| Approach | Channels scannable per day (500-video avg.) |
|---|---|
| `search.list` only | ~10 channels (1,000 units each) |
| Uploads playlist | ~476 channels (21 units each) |

---

## Complete Channel Scan Flow

```
Input: channel handle, URL, or ID
         │
         ▼
  Resolve to Channel ID
  channels.list (forHandle / forUsername / id)
  Cost: 1 unit
         │
         ▼
  Get uploads playlist ID
  channels.list (part=contentDetails, id=CHANNEL_ID)
  Cost: 1 unit  ← can be merged with step above
  Result: UU... playlist ID
         │
         ▼
  Paginate playlistItems.list
  playlistId=UU..., maxResults=50, part=snippet,contentDetails
  Cost: 1 unit per page (50 videos per page)
  Repeat until nextPageToken is absent
         │
         ▼
  Client-side date filtering (if needed)
  Filter on contentDetails.videoPublishedAt
         │
         ▼
  (Optional) Enrich with videos.list
  Batch up to 50 video IDs per call
  Cost: 1 unit per 50 videos
  Adds: duration, view count, like count, tags, etc.
```

---

## Key Fields in `playlistItems.list` Response

Each item in `response.data.items` contains (when `part=snippet,contentDetails` is requested):

```json
{
  "kind": "youtube#playlistItem",
  "id": "PLAYLIST_ITEM_ID",
  "snippet": {
    "publishedAt": "2024-03-15T14:00:00Z",
    "channelId": "UCxxxxxxxxxxxxxxxxxxxxxxxx",
    "title": "Video Title",
    "description": "Video description...",
    "thumbnails": { ... },
    "channelTitle": "Channel Name",
    "playlistId": "UUxxxxxxxxxxxxxxxxxxxxxxxx",
    "position": 0,
    "resourceId": {
      "kind": "youtube#video",
      "videoId": "dQw4w9WgXcQ"
    },
    "videoOwnerChannelTitle": "Channel Name",
    "videoOwnerChannelId": "UCxxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "contentDetails": {
    "videoId": "dQw4w9WgXcQ",
    "videoPublishedAt": "2024-03-15T14:00:00Z"
  },
  "status": {
    "privacyStatus": "public"
  }
}
```

**Note on deleted/private videos:** Private or deleted videos remain in the uploads playlist as stubs. Their `snippet.title` will be `"Private video"` or `"Deleted video"` and `snippet.resourceId.videoId` will still be present. Filter these out before further processing.

---

## Best Practices

1. **Combine handle resolution and playlist ID lookup** into a single `channels.list` call by using `part=id,contentDetails`. This halves the quota cost of the initialization phase.

2. **Always use `maxResults=50`** to minimize the number of paginated calls.

3. **Cache the uploads playlist ID** per channel ID. It does not change. Avoid re-fetching it on every scan run.

4. **Store `pageInfo.totalResults`** from the first response to estimate progress and detect channels with very large video counts before committing to full pagination.

5. **Handle `"Private video"` and `"Deleted video"` stubs** explicitly in your parsing logic. Their `contentDetails.videoPublishedAt` may be absent.

6. **Do not use `search.list` for channel video enumeration.** Reserve `search.list` for keyword-based discovery across channels where you do not know the channel ID. It is 100× more expensive per call and caps at 500 results.

7. **For incremental scans** (e.g., checking only new videos since last run), paginate until the oldest item on the current page predates your last-scan timestamp, then stop. Store the most recent video's `contentDetails.videoPublishedAt` as the checkpoint for the next run.

---

## Common Pitfalls

| Pitfall | Description | Mitigation |
|---|---|---|
| Using `search.list` for channel enumeration | 100 units/call, 500-video cap | Use `playlistItems.list` on the uploads playlist |
| Missing private/deleted stubs | These appear as items with special titles | Filter on `status.privacyStatus === 'public'` or check title |
| Assuming newest-first ordering | Not officially guaranteed | Sort client-side by `videoPublishedAt` if strict order matters |
| Not combining API calls | Separate calls for handle → ID and ID → playlist ID | Use `part=id,contentDetails` with `forHandle` in one request |
| Ignoring `totalResults` | Surprises on very large channels | Check `pageInfo.totalResults` before paginating |
| Using the UC→UU shortcut in production | Undocumented and could break | Always call `channels.list` for playlist ID |

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| Uploads playlist has no item cap | HIGH | Full channel enumeration would require a different strategy |
| `playlistItems.list` costs 1 unit per call | HIGH | Quota budget calculations would be off |
| `search.list` hard cap is 500 (not per-request, but total across pages) | HIGH | Some channels would be partially scannable via search |
| Uploads playlist is ordered newest-first | MEDIUM | Early-termination optimization for incremental scans would be unreliable |
| UC→UU prefix swap works reliably | MEDIUM | Code using the shortcut would break silently |
| `forHandle` is stable (added Jan 2024) | HIGH | All library clients need version >= Jan 2024 |
| Deleted/private video stubs are retrievable via playlist | HIGH | Stub-filtering logic is necessary, not optional |

**Out of scope:** OAuth-authenticated access (all methods described here use API key / public data only), YouTube Analytics API, Content ID API, and `search.list` date-windowing strategies for keyword searches across multiple channels.

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | YouTube Data API — `playlistItems.list` | https://developers.google.com/youtube/v3/docs/playlistItems/list | Parameters, quota cost (1 unit), pagination fields, response structure |
| 2 | YouTube Data API — `channels.list` | https://developers.google.com/youtube/v3/docs/channels/list | `forHandle`, `forUsername`, `contentDetails.relatedPlaylists.uploads`, quota cost (1 unit) |
| 3 | YouTube Data API — Working with Channel IDs | https://developers.google.com/youtube/v3/guides/working_with_channel_ids | History of channel IDs vs. usernames; `forUsername` usage |
| 4 | YouTube Data API — Quota Calculator | https://developers.google.com/youtube/v3/determine_quota_cost | Official quota cost reference |
| 5 | Truelogic Blog — Paging & the 500 Results Limit | https://truelogic.org/wordpress/2017/06/20/7-youtube-data-api-paging-maxresults/ | Confirms 500-result cap on `search.list`; time-windowing strategy |
| 6 | Context7 — YouTube Data API v3 Docs | /websites/developers_google_youtube_v3 | Code samples for uploads playlist pagination (Ruby, Go, C#) |
| 7 | CopyProgramming — Sort playlist by publish date | https://copyprogramming.com/howto/how-to-get-videos-for-a-playlist-in-sorted-by-publish-date-using-youtube-api | Confirms no native sort/filter in `playlistItems.list`; `videoPublishedAt` field location |
| 8 | Elfsight — YouTube Data API v3 Limits Guide | https://elfsight.com/blog/youtube-data-api-v3-limits-operations-resources-methods-etc/ | Overview of quota limits and method costs |
| 9 | Phyllo — YouTube API Quota Limit 2026 | https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota | Quota cost table; daily limit context |
| 10 | Google APIs Python Client — channels() | https://googleapis.github.io/google-api-python-client/docs/dyn/youtube_v3.channels.html | Python-specific parameter documentation for `forHandle` |
| 11 | GitHub — google-api-php-client Issue #2578 | https://github.com/googleapis/google-api-php-client/issues/2578 | Confirms `forHandle` added January 31, 2024; library version compatibility notes |
| 12 | DEV.to — Tracking 100K Videos Without Hitting Quota | https://dev.to/siyabuilt/youtubes-api-quota-is-10000-unitsday-heres-how-i-track-100k-videos-without-hitting-it-5d8h | Practical quota optimization patterns |

---

## Clarifying Questions for Follow-up

1. **Incremental scan checkpoint strategy**: Should the CLI tool store the last-scanned video's publish date per channel, or the last-scanned page token? Page tokens may expire; publish dates are stable but rely on ordering assumptions.

2. **Private/deleted video handling**: Should private/deleted stubs be silently skipped, logged as warnings, or tracked separately in the output?

3. **Channel handle input normalization**: Should the tool accept raw channel URLs (e.g., `https://www.youtube.com/@handle`), bare handles (`@handle`), and channel IDs (`UCxxx`) all as valid inputs? URL parsing adds implementation complexity.

4. **Rate limiting / retry behavior**: The API does not enforce per-second rate limits strictly, but high-volume pagination may trigger 429 responses. Should the tool implement exponential backoff, and if so, what are the acceptable retry parameters?

5. **Enrichment depth**: After retrieving video IDs from the uploads playlist, should the tool automatically enrich with `videos.list` (duration, statistics, tags) as a second pass, or return only the data available from `playlistItems.list`?

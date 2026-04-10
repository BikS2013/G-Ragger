# GeminiRAG Codebase Analysis for v2 Enhancements

**Date**: 2026-04-10
**Purpose**: Architecture overview and integration-point analysis for the three v2 enhancements (Full File Retrieval, YouTube Channel Scan, Enhanced YouTube Upload Format).

---

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| **Language** | TypeScript (ESM, `"type": "module"`) |
| **Runtime** | Node.js |
| **CLI Framework** | `commander` v12 |
| **Build** | `tsc` (TypeScript compiler) |
| **Entry Point** | `src/cli.ts` |
| **Binary Name** | `geminirag` (via `dist/cli.js`) |
| **Package Version** | 1.0.0 |
| **Gemini SDK** | `@google/genai` ^1.49.0 |

---

## 2. Directory Structure (excluding node_modules, dist, docs)

```
GeminiRAG/
  CLAUDE.md
  Issues - Pending Items.md
  package.json
  tsconfig.json
  test_scripts/
    test-registry.ts
    test-extractors.ts
    test-format.ts
    test-config.ts
    test-validation.ts
  src/
    cli.ts                          # Entry point; registers all commands
    config/
      config.ts                     # Configuration loader (env > .env > ~/.geminirag/config.json)
    types/
      index.ts                      # All interfaces, types, enums
      turndown-plugin-gfm.d.ts      # Type declaration for turndown-plugin-gfm
    commands/
      workspace.ts                  # create, list, delete, info
      upload.ts                     # upload (--file | --url | --youtube | --note)
      uploads.ts                    # uploads listing with filter/sort
      metadata.ts                   # update-title, remove, set-expiration, clear-expiration, flag, labels
      query.ts                      # ask (query with filters, multi-workspace)
    services/
      gemini-client.ts              # Factory: creates GoogleGenAI instance from config
      file-search.ts                # Gemini File Search Store CRUD + query
      content-extractor.ts          # Extracts content from file/web/youtube/note
      registry.ts                   # Local JSON registry at ~/.geminirag/registry.json
    utils/
      validation.ts                 # Input validators (MIME, date, flags, URL, YouTube ID)
      format.ts                     # Terminal table formatters
```

---

## 3. Module Map

### 3.1 `src/cli.ts` -- Command Registration Pattern

Commands are registered via exported `register*` functions, each receiving the `Commander.Command` program instance:

```typescript
registerWorkspaceCommands(program);   // from commands/workspace.ts
registerUploadCommand(program);        // from commands/upload.ts
registerMetadataCommands(program);     // from commands/metadata.ts
registerQueryCommand(program);         // from commands/query.ts
registerUploadsCommand(program);       // from commands/uploads.ts
```

**Pattern**: Each command file exports a single `register*` function that calls `program.command(...)` one or more times. New commands follow this same pattern.

### 3.2 `src/types/index.ts` -- Type Interfaces

Key interfaces relevant to v2:

| Interface | Purpose | Fields of Interest |
|-----------|---------|-------------------|
| `AppConfig` | Configuration object | `geminiApiKey`, `geminiModel`, `geminiApiKeyExpiration?` |
| `ExtractedContent` | Return type from all content extractors | `content`, `isFilePath`, `title`, `mimeType`, `sourceType`, `sourceUrl` |
| `UploadEntry` | Per-upload metadata in local registry | `id`, `documentName`, `title`, `timestamp`, `sourceType`, `sourceUrl`, `expirationDate`, `flags` |
| `WorkspaceData` | Workspace record | `name`, `storeName`, `createdAt`, `uploads: Record<string, UploadEntry>` |
| `UploadOptions` | CLI options for upload command | `file?`, `url?`, `youtube?`, `note?` |
| `QueryResult` | Query response | `answer`, `citations: Citation[]` |

### 3.3 `src/config/config.ts` -- Configuration Loading

- **Priority**: env vars > `.env` (dotenv) > `~/.geminirag/config.json`
- **Required**: `GEMINI_API_KEY`, `GEMINI_MODEL` -- throws with detailed instructions if missing (no fallbacks)
- **Optional**: `GEMINI_API_KEY_EXPIRATION` -- warns if within 7 days
- **Pattern**: Returns a fully validated `AppConfig` object. All new config fields must follow the same "throw if missing when needed" pattern.

### 3.4 `src/services/content-extractor.ts` -- Content Extraction

Four extractor functions, each returning `ExtractedContent`:

| Function | Source | Content Type | MIME Type | Notes |
|----------|--------|-------------|-----------|-------|
| `extractDiskFile(filePath)` | Local file | File path reference | Auto-detected | `isFilePath=true` |
| `extractWebPage(url)` | HTTP URL | Markdown string | `text/markdown` | Uses JSDOM + Readability + Turndown |
| `extractYouTube(url)` | YouTube URL | Plain text transcript | `text/plain` | Uses oEmbed for title, `youtube-transcript` for transcript |
| `extractNote(text)` | Inline text | Plain text | `text/plain` | Auto-generates title from first 60 chars |

**YouTube extractor details** (lines 116-154):
- Extracts video ID via `extractYouTubeVideoId()` from `utils/validation.ts`
- Fetches title via YouTube oEmbed endpoint (no API key needed)
- Fetches transcript via `youtube-transcript` package (CommonJS require)
- Joins all transcript segments with spaces: `transcriptItems.map(item => item.text).join(' ')`
- Returns `mimeType: 'text/plain'` and `sourceType: 'youtube'`
- The `youtube-transcript` package returns `Array<{ text: string }>` (the type signature omits `offset` and `duration` fields that the package actually provides)

### 3.5 `src/services/file-search.ts` -- Gemini File Search Operations

| Function | Purpose |
|----------|---------|
| `createStore(ai, displayName)` | Creates a File Search Store |
| `deleteStore(ai, storeName)` | Deletes a store with `force: true` |
| `listStores(ai)` | Lists all stores |
| `uploadContent(ai, storeName, content, isFilePath, mimeType, displayName, customMetadata)` | Uploads content; handles polling bug #1211 workaround and 503 fallback |
| `deleteDocument(ai, documentName)` | Deletes a single document |
| `query(ai, model, storeNames, question, metadataFilter?)` | Queries stores with natural language |

**Upload flow**: Direct upload via `uploadToFileSearchStore` with polling. On 503, falls back to Files API upload + import into store. Returns the `documentName` resource string.

**No existing document content retrieval function** -- the `documents.list()` is used internally but only for finding a document by display name. There is no `getDocumentContent()` function. This must be added for Feature 1.

### 3.6 `src/services/registry.ts` -- Local Registry

- Stored at `~/.geminirag/registry.json`
- Atomic writes via tmp file + rename
- Functions: `loadRegistry`, `saveRegistry`, `addWorkspace`, `removeWorkspace`, `getWorkspace`, `listWorkspaces`, `addUpload`, `removeUpload`, `updateUpload`
- `getWorkspace()` throws `"Workspace '<name>' not found"` if not found -- same error message expected for v2 `get` command

### 3.7 `src/commands/upload.ts` -- Upload Command

- Validates exactly one source option
- Routes to the appropriate extractor
- Builds `customMetadata` array with `source_type` and optionally `source_url`
- Calls `uploadContent()` from `file-search.ts`
- Creates `UploadEntry` with UUID, registers in local registry
- Has rollback logic: if registry write fails after Gemini upload, attempts to delete the Gemini document

### 3.8 Error Handling Pattern

All command actions follow this pattern:
```typescript
.action(async (args, options) => {
  try {
    // ... command logic
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
});
```

---

## 4. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@google/genai` | ^1.49.0 | Gemini API SDK |
| `commander` | ^12.1.0 | CLI framework |
| `dotenv` | ^16.4.0 | .env file loading |
| `uuid` | ^10.0.0 | UUID v4 generation |
| `youtube-transcript` | ^1.3.0 | YouTube transcript extraction |
| `@mozilla/readability` | ^0.6.0 | Web page content extraction |
| `jsdom` | ^29.0.2 | HTML parsing |
| `turndown` | ^7.2.0 | HTML to Markdown |
| `turndown-plugin-gfm` | ^1.0.2 | GFM tables for turndown |
| `mime-types` | ^2.1.35 | MIME type detection |

---

## 5. Integration Points for v2 Enhancements

### 5.1 Feature 1: Full File Retrieval (`get` command)

**New command file**: `src/commands/get.ts`
- Export `registerGetCommand(program: Command)` following existing pattern
- Register in `src/cli.ts` alongside other commands

**New service function**: Add to `src/services/file-search.ts`
- `getDocumentContent(ai, storeName, documentName)` -- investigate whether `ai.fileSearchStores.documents.get()` returns content or only metadata. If only metadata, implement the model-based retrieval approach (using `generateContent` with a verbatim-reproduction prompt and file search grounding).

**Registry access**: Use existing `getWorkspace()` to look up `UploadEntry` by upload ID, then use `entry.documentName` to retrieve content.

**Format utilities**: Add `formatUploadMetadataHeader(entry: UploadEntry)` to `src/utils/format.ts` for the metadata header output.

**No type changes required** for this feature (existing `UploadEntry` and `WorkspaceData` are sufficient).

### 5.2 Feature 2: YouTube Channel Scan (`channel-scan` command)

**New command file**: `src/commands/channel-scan.ts`
- Export `registerChannelScanCommand(program: Command)` following existing pattern
- Register in `src/cli.ts`

**New service file**: `src/services/youtube-data-api.ts`
- YouTube Data API v3 REST client (direct `fetch` calls recommended over `googleapis` package)
- Functions: `resolveChannelId(apiKey, identifier)`, `listChannelVideos(apiKey, channelId, fromDate, toDate, maxResults?)`
- Returns video metadata: `videoId`, `title`, `publishDate`, `channelName`, `duration`

**Config changes** (`src/types/index.ts` + `src/config/config.ts`):
- Add `youtubeDataApiKey?: string` and `youtubeDataApiKeyExpiration?: string` to `AppConfig`
- Update `loadConfig()` to read `YOUTUBE_DATA_API_KEY` and `YOUTUBE_DATA_API_KEY_EXPIRATION` from the same priority chain
- These fields are optional at startup; throw only when `channel-scan` is invoked without them

**Content extractor changes** (`src/services/content-extractor.ts`):
- The existing `extractYouTube(url)` will be called per-video within the channel scan loop
- May need a variant that accepts pre-fetched metadata (title, publishDate, channelName) to avoid redundant oEmbed calls

**Upload flow**: Reuse the existing `uploadContent()` and `addUpload()` functions in a loop.

### 5.3 Feature 3: Enhanced YouTube Upload Format

**Content extractor changes** (`src/services/content-extractor.ts`):
- Modify `extractYouTube()` to return structured Markdown instead of plain text
- Change `mimeType` from `'text/plain'` to `'text/markdown'`
- Include video URL in the Markdown header
- Insert paragraph breaks at transcript segments with >2s pauses (requires accessing `offset`/`duration` from `youtube-transcript` items -- the current type signature truncates these fields)
- Optionally include a Notes section (when `--with-notes` is passed)

**New service function**: `src/services/notes-generator.ts` (or add to `content-extractor.ts`)
- `generateNotes(ai, model, transcript)` -- calls `ai.models.generateContent()` with the notes-generation prompt
- Returns Markdown-formatted notes string

**Type changes** (`src/types/index.ts`):
- Add `withNotes?: boolean` to `UploadOptions`
- Optionally extend `ExtractedContent` or create a parallel interface for enhanced YouTube content that carries metadata fields (publishDate, channelName)

**Upload command changes** (`src/commands/upload.ts`):
- Add `--with-notes` option
- Pass the flag through to the extractor or handle notes generation after extraction

**youtube-transcript type fix**: The `YoutubeTranscript.fetchTranscript()` actually returns items with `{ text: string, offset: number, duration: number }`. The current type cast in `content-extractor.ts` (line 10) only declares `{ text: string }`. This must be expanded to `{ text: string, offset: number, duration: number }` to support paragraph-break insertion based on pause detection.

### 5.4 Summary of Files to Modify

| File | Modification |
|------|-------------|
| `src/types/index.ts` | Add `withNotes?` to `UploadOptions`; extend `AppConfig` with YouTube API key fields |
| `src/config/config.ts` | Load `YOUTUBE_DATA_API_KEY` and expiration; add expiration warning |
| `src/cli.ts` | Register `get` and `channel-scan` commands |
| `src/services/content-extractor.ts` | Restructure YouTube output to Markdown; expand transcript item types; add paragraph breaks; support metadata injection |
| `src/services/file-search.ts` | Add document content retrieval function |
| `src/commands/upload.ts` | Add `--with-notes` option; pass to extractor/notes generator |
| `src/utils/format.ts` | Add metadata header formatter for `get` command output |

### 5.5 Summary of New Files to Create

| File | Purpose |
|------|---------|
| `src/commands/get.ts` | `get` command implementation |
| `src/commands/channel-scan.ts` | `channel-scan` command implementation |
| `src/services/youtube-data-api.ts` | YouTube Data API v3 REST client |
| `src/services/notes-generator.ts` | AI notes generation via Gemini |

### 5.6 New Dependency

| Package | Purpose | Approach |
|---------|---------|----------|
| YouTube Data API v3 | Channel listing, video metadata | Direct `fetch` to REST endpoints (no `googleapis` package needed) |

No new npm packages are required. The YouTube Data API v3 will be accessed via the built-in `fetch` API.

---

## 6. Key Observations and Risks

1. **youtube-transcript type gap**: The current type cast strips `offset` and `duration` from transcript items. These fields are essential for the paragraph-break feature (Feature 3). The fix is straightforward -- expand the type in the `createRequire` cast on line 10 of `content-extractor.ts`.

2. **Document content retrieval uncertainty** (Feature 1): The Gemini SDK's `documents.get()` may return only metadata, not content. Investigation is required before implementation. The fallback approach (model-based retrieval with verbatim prompt) is documented in the refined request.

3. **Config loading is eager**: `loadConfig()` validates all required fields at call time. The `YOUTUBE_DATA_API_KEY` must be loaded lazily (only validate when `channel-scan` is invoked). This requires either a separate config loader or making the field optional in the existing loader.

4. **No rate limiting infrastructure**: The channel scan will issue many sequential API calls (YouTube Data API + Gemini upload). There is no existing rate-limiting or retry mechanism. The refined request states this is acceptable, but it should be noted.

5. **Registry atomicity**: The registry uses atomic writes (tmp + rename), which is good. However, during a channel scan uploading many videos, a crash mid-loop would leave orphaned documents in Gemini with no registry entries. Consider a progress-tracking mechanism or at minimum clear documentation of this limitation.

6. **oEmbed redundancy**: During channel scan, video metadata (title, publishDate, channelName) comes from the YouTube Data API. The existing `extractYouTube()` makes a separate oEmbed call for the title. The channel-scan path should bypass oEmbed and inject metadata directly.

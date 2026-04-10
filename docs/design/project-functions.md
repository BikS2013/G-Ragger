# GeminiRAG - Functional Requirements

**Date**: 2026-04-10
**Source**: docs/reference/refined-request.md
**Status**: Complete (initial registration)

---

## Workspace Management

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | Create a new workspace by providing a workspace name | Must | Pending |
| FR-02 | Create a corresponding Gemini File Search store for each workspace | Must | Pending |
| FR-03 | List all existing workspaces | Must | Pending |
| FR-04 | Delete a workspace and its backing Gemini store and all associated uploads | Must | Pending |
| FR-05 | View workspace details (name, creation date, upload count, metadata labels in use) | Must | Pending |

## Content Upload - General

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-06 | Every upload automatically assigned a UTC timestamp at upload time | Must | Pending |
| FR-07 | Every upload automatically assigned a title (source-specific) | Must | Pending |
| FR-08 | User must NOT be required to provide timestamps or titles | Must | Pending |
| FR-09 | Every upload indexed in the Gemini File Search store for semantic search | Must | Pending |
| FR-10 | Upload metadata stored in a local registry file (mutable fields not supported by Gemini API) | Must | Pending |

## Content Upload - Disk File

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-11 | Accept a local file path and upload the file to the workspace's Gemini store | Must | Pending |
| FR-12 | Auto-generated title for disk files is the file name (basename without directory) | Must | Pending |
| FR-13 | Validate file exists and MIME type is supported before uploading | Must | Pending |

## Content Upload - Web Page

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-14 | Accept URL, fetch web page, convert to text/markdown, upload to workspace | Must | Pending |
| FR-15 | Auto-generated title from HTML `<title>` tag; fallback: hostname + path | Must | Pending |
| FR-16 | Store source URL as metadata on the upload | Must | Pending |

## Content Upload - YouTube Video

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-17 | Accept YouTube URL, extract transcript/captions, upload transcript text | Must | Pending |
| FR-18 | Auto-generated title is the video's title from YouTube | Must | Pending |
| FR-19 | Store YouTube video URL as metadata | Must | Pending |
| FR-20 | If transcript not available, report error and do NOT create partial upload | Must | Pending |

## Content Upload - Personal Note

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-21 | Accept free-text input as a personal note and upload to workspace | Must | Pending |
| FR-22 | Auto-generated title based on note content (first 60 chars trimmed to word boundary + ellipsis) | Must | Pending |
| FR-23 | Personal notes stored as plain text files in the Gemini store | Must | Pending |

## Upload Metadata Management

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-24 | Allow user to change the title of any upload | Must | Pending |
| FR-25 | Allow user to remove (delete) an upload from workspace (Gemini doc + local registry) | Must | Pending |
| FR-26 | Allow user to set an expiration date (ISO 8601) on an upload | Must | Pending |
| FR-27 | Allow user to clear an expiration date from an upload | Must | Pending |
| FR-28 | Allow user to set status flags: `completed`, `urgent`, `inactive` | Must | Pending |
| FR-29 | Allow user to clear flags from an upload | Must | Pending |
| FR-30 | Display expiration warnings for expired or soon-to-expire uploads in listings | Must | Pending |

## Metadata Labels

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-31 | List all distinct metadata labels (keys) in use within a workspace | Must | Pending |
| FR-32 | Metadata labels include system-managed labels (timestamp, title, source_type, source_url, expiration_date, flags) | Must | Pending |

## Querying

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-33 | Allow natural language question against a workspace | Must | Pending |
| FR-34 | Route query through Gemini generateContent API with File Search store as tool | Must | Pending |
| FR-35 | Support metadata filters when querying (source_type at Gemini level; flags/expiration client-side) | Must | Pending |
| FR-36 | Display answer with citations (source document titles and relevant text excerpts) | Must | Pending |
| FR-37 | Support querying across multiple workspaces in a single query | Must | Pending |

## Upload Listing

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-38 | List all uploads within a workspace: title, source type, timestamp, expiration, flags | Must | Pending |
| FR-39 | Listing supports filtering by metadata (source type, flags, expiration status) | Must | Pending |
| FR-40 | Listing supports sorting by timestamp (ascending/descending) | Must | Pending |

## Configuration

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-41 | Configuration loaded from environment variables, `.env` file, or config file (`~/.geminirag/config.json`) | Must | Pending |
| FR-42 | Priority: environment variables > `.env` file > config file | Must | Pending |
| FR-43 | Missing `GEMINI_API_KEY` raises clear error with instructions | Must | Pending |
| FR-44 | Missing `GEMINI_MODEL` raises clear error | Must | Pending |
| FR-45 | No fallback or default values for any configuration setting | Must | Pending |
| FR-46 | Support `GEMINI_API_KEY_EXPIRATION` field; warn when within 7 days of expiration | Should | Pending |
| FR-47 | Local registry stored at `~/.geminirag/registry.json` | Must | Pending |

---

## Feature Descriptions

### Workspace Management
A workspace is a named container backed by a Gemini File Search store. Each workspace holds uploaded documents that are indexed for semantic search. Workspaces are tracked in a local registry (`~/.geminirag/registry.json`) that maps workspace names to their Gemini store resource names and holds all upload metadata. Creating a workspace provisions a new Gemini store; deleting a workspace removes the Gemini store (with `force: true`) and all local registry data.

### Content Upload
The tool supports four content source types: disk files, web pages, YouTube videos, and personal notes. Each upload follows a pipeline: content extraction (source-specific), upload to the Gemini File Search store (with custom metadata), and registration in the local registry. The upload flow handles known SDK bugs: polling bug #1211 (check initial response for document name; hard 120s timeout) and 503 errors for large files (fallback to Files API + Import pathway).

### Dual-Layer Metadata
Gemini-side metadata (set at upload time, immutable): `source_type` and `source_url` -- used for query-time filtering via AIP-160 syntax. Local registry metadata (mutable): `title`, `flags`, `expiration_date` -- managed client-side because Gemini metadata cannot be updated after upload, and `string_list_value` type is not confirmed filterable.

### Querying
Natural language queries are routed through the Gemini `generateContent` API with the workspace's File Search store as a tool. Multi-workspace queries pass multiple store names. Gemini-side metadata filters (source_type) are applied at query time; local-only filters (flags, expiration) are applied client-side after results are returned. Citations are extracted from grounding metadata and displayed with document titles and text excerpts.

### Configuration
Configuration follows a strict no-fallback policy. All required settings (`GEMINI_API_KEY`, `GEMINI_MODEL`) must be explicitly provided via environment variables, `.env` file, or `~/.geminirag/config.json`. Missing values result in descriptive exceptions. The API key expiration field is optional but recommended for proactive renewal warnings.

---

## v2 Enhancement Requirements (2026-04-10)

### Full File Retrieval

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-48 | Retrieve and display the full content of a previously uploaded document from a Gemini File Search Store | Must | Pending |
| FR-49 | Display content with a metadata header showing title, ID, source type, source URL, upload timestamp, expiration, flags, and document name | Must | Pending |
| FR-50 | Support `--raw` flag to output content without the metadata header (for piping to other tools) | Must | Pending |
| FR-51 | Support `--output <path>` flag to write content to a file instead of stdout | Must | Pending |
| FR-52 | Content retrieval uses model-based verbatim-reproduction prompt with File Search grounding (best-effort; long documents may be truncated) | Must | Pending |
| FR-53 | Clear error when workspace not found, upload ID not found, or content retrieval fails | Must | Pending |

### YouTube Channel Scan

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-54 | Scan a YouTube channel and collect all videos published within a user-specified date range | Must | Pending |
| FR-55 | Accept channel identifier as `@handle`, channel URL (`youtube.com/@handle` or `youtube.com/channel/UCxxx`), or raw channel ID (`UCxxx`) | Must | Pending |
| FR-56 | Resolve channel handle to channel ID via YouTube Data API v3 `channels.list` with `forHandle` | Must | Pending |
| FR-57 | Use `playlistItems.list` on the channel's uploads playlist for video enumeration (no 500-video cap, 1 unit/call) | Must | Pending |
| FR-58 | Client-side date filtering on `contentDetails.videoPublishedAt` (inclusive start and end dates) | Must | Pending |
| FR-59 | Display a plan table showing found videos (number, date, title, duration) before processing | Must | Pending |
| FR-60 | Support `--dry-run` flag to list videos without uploading | Must | Pending |
| FR-61 | Upload each video's transcript in enhanced Markdown format to the target workspace | Must | Pending |
| FR-62 | Print progress for each video: `[N/total] Uploaded: "title" (ID: uuid)` | Must | Pending |
| FR-63 | Support `--continue-on-error` to skip failed videos instead of stopping | Must | Pending |
| FR-64 | Support `--max-videos <n>` to limit the number of videos processed | Should | Pending |
| FR-65 | Print final summary: processed/uploaded/skipped/failed counts | Must | Pending |
| FR-66 | Apply 1.5-2 second delay with jitter between transcript fetches to avoid YouTube rate-limiting | Must | Pending |
| FR-67 | Pause for 60 seconds when rate-limit errors persist after retries | Should | Pending |
| FR-68 | Filter out private/deleted video stubs from the uploads playlist | Must | Pending |
| FR-69 | Enrich video metadata with durations via `videos.list` (batched, 50 IDs per call) | Should | Pending |
| FR-70 | Estimate and log YouTube Data API quota usage before scan begins | Should | Pending |

### Enhanced YouTube Upload Format

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-71 | All new YouTube uploads produce structured Markdown containing video URL, metadata header, and full transcript | Must | Pending |
| FR-72 | Video URL is always included in the uploaded content (not just in local registry) | Must | Pending |
| FR-73 | Published date and channel name are included when available (always from channel-scan; best-effort from single upload via oEmbed) | Should | Pending |
| FR-74 | Transcript text includes paragraph breaks at segments where the gap between consecutive transcript items exceeds 2 seconds | Must | Pending |
| FR-75 | MIME type for YouTube uploads changes from `text/plain` to `text/markdown` | Must | Pending |
| FR-76 | Support `--with-notes` flag to append an AI-generated Notes section (summary, key points, important terms, action items) | Must | Pending |
| FR-77 | Notes generation uses existing Gemini model via `generateContent` with a structured prompt | Must | Pending |
| FR-78 | If notes generation fails, upload proceeds without the Notes section and a warning is printed | Must | Pending |
| FR-79 | `--with-notes` is valid for both `upload --youtube` and `channel-scan` commands | Must | Pending |
| FR-80 | During channel-scan with `--with-notes`, each video gets notes generated individually | Must | Pending |
| FR-81 | Previously uploaded YouTube content (v1) is not retroactively reformatted | Must | Pending |

### Configuration (v2 additions)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-82 | New optional config: `YOUTUBE_DATA_API_KEY` -- required only when `channel-scan` command is invoked | Must | Pending |
| FR-83 | Lazy validation: `YOUTUBE_DATA_API_KEY` is not validated at startup; throws only when `channel-scan` is invoked without it | Must | Pending |
| FR-84 | New optional config: `YOUTUBE_DATA_API_KEY_EXPIRATION` -- warns when within 7 days (same pattern as `GEMINI_API_KEY_EXPIRATION`) | Should | Pending |
| FR-85 | Config loaded from same priority chain: env vars > `.env` > `~/.geminirag/config.json` | Must | Pending |

### Dependency Changes (v2)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-86 | Replace `youtube-transcript` with `youtube-transcript-plus` for built-in retry/backoff support | Must | Pending |
| FR-87 | YouTube Data API v3 accessed via direct `fetch` (no `googleapis` package) | Must | Pending |

---

## v2 Feature Descriptions

### Full File Retrieval
The `get` command retrieves the full content of a document previously uploaded to a Gemini File Search Store. Since the Gemini API does not provide a direct content download method for File Search Store documents, the retrieval uses a model-based approach: `generateContent` with a verbatim-reproduction prompt and File Search grounding. This is best-effort -- long documents may be truncated by the model's output token limit (~65K tokens), and minor formatting differences are possible. Binary files (PDF, images) cannot be faithfully reproduced. The command supports `--raw` for clean output and `--output` for writing to a file.

### YouTube Channel Scan
The `channel-scan` command automates bulk ingestion of YouTube video transcripts from a channel within a date range. It uses the YouTube Data API v3 to resolve channel identifiers, enumerate videos via the uploads playlist (`playlistItems.list`), and fetch metadata including durations. For each video, it extracts the transcript using `youtube-transcript-plus`, formats it as enhanced Markdown, and uploads to the target workspace. Rate-limiting protection includes 2-second delays with jitter between fetches, built-in retries in the transcript library, and a 60-second pause when retries are exhausted. The `--dry-run` flag shows what would be processed; `--continue-on-error` allows partial scans; `--max-videos` limits scope.

### Enhanced YouTube Upload Format
All new YouTube uploads produce structured Markdown documents containing the video URL, metadata (published date, channel name when available), the full transcript with paragraph breaks at natural pauses (>2s gaps), and optionally AI-generated notes. The notes section includes a summary, key points, important terms, and action items. This format replaces the previous plain-text transcript, improving queryability by embedding the source URL directly in the uploaded content. The `--with-notes` flag activates notes generation using the configured Gemini model.

---

## Electron UI Requirements (2026-04-10)

### Workspace Explorer (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-88 | Display a list of all workspaces with name, creation date, and upload count in a sidebar | Must | Pending |
| FR-89 | Selecting a workspace navigates to its upload list | Must | Pending |
| FR-90 | Show workspace statistics: total uploads, breakdown by source type, expired count, expiring-soon count | Must | Pending |
| FR-91 | Provide a refresh action to reload workspace data from the registry | Must | Pending |

### Upload Browser (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-92 | Display all uploads in a table with columns: ID (short), title, source type, date, flags, expiration status | Must | Pending |
| FR-93 | Support filtering uploads by source type, flags, and expiration status | Must | Pending |
| FR-94 | Support sorting by timestamp (ascending/descending) via clickable column headers | Must | Pending |
| FR-95 | Clicking an upload opens the detail/inspection view | Must | Pending |
| FR-96 | Show visual indicators for expiration status (expired = red, expiring soon = orange) | Must | Pending |
| FR-97 | Show visual badges for flags (completed, urgent, inactive) with distinct colors | Must | Pending |

### Upload Detail / Content Inspection (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-98 | Display full metadata: ID, title, source type, source URL (clickable), timestamp, expiration, flags, Gemini document name | Must | Pending |
| FR-99 | Fetch and display document content via Gemini File Search grounding | Must | Pending |
| FR-100 | Show loading state while content is being fetched | Must | Pending |
| FR-101 | Display truncation warning if content was truncated | Must | Pending |
| FR-102 | Render content in a scrollable, monospace panel | Must | Pending |

### File Download (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-103 | Provide a "Download" button in the upload detail view | Must | Pending |
| FR-104 | Open Electron native "Save As" dialog when clicked | Must | Pending |
| FR-105 | Save retrieved document content to user-selected path | Must | Pending |
| FR-106 | Default filename to `{upload.title}.md` (sanitized for filesystem safety) | Must | Pending |

### Workspace Query (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-107 | Provide a query input area with text field and submit button | Must | Pending |
| FR-108 | Execute query against selected workspace's Gemini store | Must | Pending |
| FR-109 | Display natural language answer in a styled response area | Must | Pending |
| FR-110 | Display citations as a list: citation number, document title, document URI, text excerpt | Must | Pending |
| FR-111 | Clickable citations navigate to corresponding upload's detail view if it matches a local registry entry | Must | Pending |
| FR-112 | Show loading/spinner state while query is executing | Must | Pending |
| FR-113 | Support querying across multiple workspaces (stretch goal for v1) | Should | Pending |

### Query Filter Panel (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-114 | Provide a filter panel accessible before/during query submission | Must | Pending |
| FR-115 | Support Gemini-side filters: source_type (dropdown), source_url (text input) | Must | Pending |
| FR-116 | Support client-side filters: flags (multi-select), expiration_status (dropdown) | Must | Pending |
| FR-117 | Clearly distinguish Gemini-side filters from client-side filters in the UI | Must | Pending |
| FR-118 | Filters must be clearable/resettable | Must | Pending |

### Shared Utility Extraction (Prerequisite for Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-119 | Extract filter/sort/lookup functions from commands to shared `src/utils/filters.ts` for reuse by both CLI and Electron UI | Must | Complete |
| FR-120 | Existing CLI behavior must remain unchanged after extraction (pure refactor) | Must | Complete |

### YouTube Content Features (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-121 | YouTube uploads show Description as default content view | Must | Complete |
| FR-122 | YouTube Description button fetches video description via YouTube Data API | Must | Complete |
| FR-123 | YouTube Transcript button fetches raw transcript directly from YouTube with timestamps and paragraph breaks | Must | Complete |
| FR-124 | YouTube AI Notes button generates structured notes from transcript via Gemini | Must | Complete |
| FR-125 | YouTube Gemini button retrieves content from File Search store with RECITATION fallback | Must | Complete |
| FR-126 | YouTube video description included in uploaded content when indexing (requires YOUTUBE_DATA_API_KEY) | Should | Complete |
| FR-127 | RECITATION fallback: when Gemini blocks verbatim content, retry with analytical prompt and show [NOTE:] banner | Must | Complete |
| FR-128 | Upload detail dialog is resizable with content viewer filling available space | Should | Complete |
| FR-129 | Transcript segments decoded from HTML entities (&#39; etc.) before display | Must | Complete |

### Upload Features (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-130 | Create new workspace from sidebar via "+" button with name validation | Must | Complete |
| FR-131 | Workspace creation dialog validates name client-side (alphanumeric, hyphens, underscores) and server-side (uniqueness, max 10 limit) | Must | Complete |
| FR-132 | New workspace auto-selected in sidebar after creation | Must | Complete |
| FR-133 | Upload local file via native Electron file picker dialog | Must | Complete |
| FR-134 | File picker uses separate `dialog:openFile` IPC channel (decoupled from upload logic) | Must | Complete |
| FR-135 | Upload web page content by URL with automatic title extraction from HTML `<title>` tag | Must | Complete |
| FR-136 | Upload YouTube video transcript with optional AI notes generation checkbox | Must | Complete |
| FR-137 | Add personal note as free-text entry with auto-generated title from first 60 characters | Must | Complete |
| FR-138 | All upload operations accessible via single "Add Content" modal dialog with 5 tabs (File, Web Page, YouTube, Channel Scan, Note) | Must | Complete |
| FR-139 | "Add Content" button in UploadsTab disabled when no workspace is selected | Must | Complete |
| FR-140 | Non-dismissable loading dialog during upload with context-specific status message and elapsed time counter | Must | Complete |
| FR-141 | Upload errors displayed inline in dialog; dialog remains open for retry | Must | Complete |
| FR-142 | Workspace list and upload table auto-refresh after successful create or upload operations | Must | Complete |
| FR-143 | Rollback Gemini resources (deleteStore/deleteDocument) if local registry write fails after successful API call | Must | Complete |
| FR-144 | All new IPC channels follow existing wrapError/IpcResult pattern | Must | Complete |
| FR-145 | Content extractors (jsdom, @mozilla/readability, youtube-transcript-plus) externalized in electron-vite config | Must | Complete |
| FR-146 | YouTube channel scan via UI: channel handle, date range, optional AI notes | Must | Complete |
| FR-147 | YouTube uploads store channelTitle and publishedAt in UploadEntry metadata (CLI + UI) | Must | Complete |
| FR-148 | CLI `get --description` fetches YouTube video description directly via Data API | Must | Complete |
| FR-149 | CLI `get --notes` generates AI notes from YouTube transcript directly | Must | Complete |
| FR-150 | Delete upload from UI: removes from Gemini and local registry with confirmation | Must | Complete |
| FR-151 | Configuration editor in UI: view/edit ~/.geminirag/config.json via Settings dialog | Must | Complete |
| FR-152 | Config save re-initializes service bridge to pick up new values | Must | Complete |
| FR-153 | CLI filter by YouTube channel name (channel=text, case-insensitive substring) | Must | Complete |
| FR-154 | CLI filter by publish date range (published_from=YYYY-MM-DD, published_to=YYYY-MM-DD) | Must | Complete |
| FR-155 | UI filter bar includes channel text input and publish date from/to pickers | Must | Complete |
| FR-156 | Delete upload per-row in uploads table (trash icon, hover-visible, with confirmation) | Must | Complete |
| FR-157 | Delete workspace from sidebar (trash icon, hover-visible, deletes store + registry) | Must | Complete |
| FR-158 | Dark theme support (light/dark/system via Settings, THEME config key) | Must | Complete |
| FR-159 | Configurable date format (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD via Settings, DATE_FORMAT config key) | Must | Complete |
| FR-160 | YouTube uploads show publish date in table Date column; others show upload date | Must | Complete |
| FR-161 | Window size/position persisted to ~/.geminirag/window-state.json | Should | Complete |
| FR-162 | Upload detail dialog size persisted in localStorage | Should | Complete |
| FR-163 | App renamed to G-Ragger (title bar, header, dialogs, package.json) | Must | Complete |
| FR-164 | Uploads/Ask toggle moved to header bar alongside Add Content and Settings | Must | Complete |

### Non-Functional Requirements (Electron UI)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| NFR-01 | All Electron UI code in separate `electron-ui/` folder with own package.json and tsconfig | Must | Pending |
| NFR-02 | Service reuse: main process imports from existing `../src/` service layer, no duplication | Must | Pending |
| NFR-03 | Uses same configuration mechanism as CLI (`loadConfig()`); no fallback values | Must | Pending |
| NFR-04 | Tech stack: Electron + TypeScript + React + IPC bridge (contextBridge/preload) | Must | Pending |
| NFR-05 | Responsive layout; minimum window size 900x600 | Must | Pending |
| NFR-06 | Clean, minimal design using Tailwind CSS + shadcn/ui | Must | Pending |
| NFR-07 | All service-layer errors displayed as user-friendly messages in the UI | Must | Pending |
| NFR-08 | Registry operations synchronous; only Gemini API calls async with loading indicators | Must | Pending |
| NFR-09 | No auto-update mechanism required | Must | Pending |
| NFR-10 | Single `npm run build` produces runnable app; `npm run dev` for development with HMR | Must | Pending |

---

## Electron UI Feature Descriptions

### Workspace Explorer
The Electron UI sidebar displays all GeminiRAG workspaces loaded from `~/.geminirag/registry.json`. Each workspace entry shows its name, creation date, and total upload count. Selecting a workspace loads its uploads in the main content area. Workspace statistics (upload breakdown by source type, expired/expiring-soon counts) are computed from the workspace data and displayed alongside the selection.

### Upload Browser
The upload browser displays all uploads in the selected workspace as an interactive data table powered by @tanstack/react-table. Columns include shortened ID, title, source type (badge), date, flags (colored badges), and expiration status (color-coded indicators). A filter bar above the table provides dropdowns for source type, flags, and expiration status filtering. Column headers are clickable for sorting. Clicking a table row opens the upload detail view.

### Upload Detail / Content Inspection
The detail view is a resizable dialog displaying full upload metadata (ID with copy-to-clipboard, title, source type badge, source URL as a clickable link that opens in external browser, timestamp, expiration with color coding, flags as badges, Gemini document name) alongside the document content. The content viewer fills all remaining dialog space and scrolls independently.

For YouTube uploads, four content source buttons are available:
- **Description** (default): fetches the video description directly from YouTube via the Data API (requires YOUTUBE_DATA_API_KEY)
- **Transcript**: fetches the raw transcript directly from YouTube with timestamps ([MM:SS]) and paragraph breaks at natural pauses, bypassing the Gemini API entirely
- **AI Notes**: generates structured notes (summary, key points, important terms, action items) from the transcript using Gemini
- **Gemini**: retrieves content from the Gemini File Search store; if blocked by the RECITATION safety filter (common for copyrighted transcripts), automatically retries with an analytical prompt and shows a [NOTE:] banner

For non-YouTube uploads, content is fetched from the Gemini File Search store by default.

### File Download
A download button in the upload detail view triggers Electron's native Save dialog. The retrieved text content (fetched via Gemini grounding) is saved to the user-selected file path. The default filename is the upload title with `.md` extension, sanitized for filesystem safety. This downloads the text content, not the original binary file.

### Workspace Query
The "Ask" tab provides a text input for natural language questions. Queries are executed against the selected workspace's Gemini File Search store via IPC. The answer is displayed in a styled response area with citations listed below. Each citation shows a number, document title, URI, and text excerpt. Citations that match local registry entries are clickable, navigating to the upload detail view.

### Query Filter Panel
A collapsible filter panel in the Ask tab provides two categories of filters. Gemini-side filters (source_type dropdown, source_url text input) are sent with the query and affect which documents are searched. Client-side filters (flags multi-select, expiration_status dropdown) are applied after the query returns and affect which citations are shown. The two categories are visually distinguished with labels. All filters are clearable via a reset button.

### Workspace Creation (Electron UI)
A "+" button in the WorkspaceSidebar header opens a CreateWorkspaceDialog modal. The dialog provides a single text input for the workspace name with real-time client-side validation (alphanumeric, hyphens, underscores only). On submit, the IPC handler validates the name server-side (uniqueness, max 10 workspaces), creates a Gemini File Search store, and registers the workspace in the local registry. If the registry write fails after the Gemini store is created, the store is rolled back via deleteStore(). On success, the workspace list refreshes and the new workspace is auto-selected. The dialog is non-dismissable during the API call, showing a "Creating workspace..." message.

### Content Upload (Electron UI)
An "Add Content" button in the UploadsTab (disabled when no workspace is selected) opens a modal dialog with four tabs: File, Web Page, YouTube, and Note. Each tab provides source-type-specific input fields and a submit button. All tabs share a loading state: during upload, the dialog becomes non-dismissable, all inputs are disabled, and a context-specific loading message with elapsed time counter is displayed. Errors are shown inline, keeping the dialog open for retry. On success, the dialog closes, and both the upload table and workspace sidebar (upload counts) are refreshed.

The File tab uses a native Electron file picker (via a separate `dialog:openFile` IPC channel) to select a local file, displaying the filename before upload. The Web Page tab accepts a URL with client-side validation (must start with http:// or https://). The YouTube tab accepts a YouTube URL with a "Generate AI notes" checkbox; when checked, an informational message warns about additional 1-2 minute processing time. The Note tab provides a textarea with a live title preview showing the auto-generated title (first 60 characters).

All upload IPC handlers follow the same pattern: validate input, extract content via the appropriate extractor from the CLI service layer, upload to Gemini, register in the local registry. If the registry write fails after a successful Gemini upload, the uploaded document is rolled back via deleteDocument(). The content extractors (jsdom, @mozilla/readability, youtube-transcript-plus) are externalized in the electron-vite config to avoid bundling native modules.

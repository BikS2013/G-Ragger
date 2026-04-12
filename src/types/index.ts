// ===== Enums and Type Aliases =====

export type SourceType = 'file' | 'web' | 'youtube' | 'note';

export type Flag = 'completed' | 'urgent' | 'inactive';

export const VALID_FLAGS: Flag[] = ['completed', 'urgent', 'inactive'];

// ===== Upload Entry =====

export interface UploadEntry {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Gemini File Search document resource name (e.g., "fileSearchStores/.../documents/...") */
  documentName: string;
  /** Human-readable title (auto-generated, user-editable) */
  title: string;
  /** ISO 8601 UTC datetime of upload creation */
  timestamp: string;
  /** Content source type */
  sourceType: SourceType;
  /** Original URL/path for web/youtube/file sources; null for notes */
  sourceUrl: string | null;
  /** ISO 8601 date for expiration; null if no expiration set */
  expirationDate: string | null;
  /** Status flags array */
  flags: Flag[];
  /** YouTube channel title (for youtube source type) */
  channelTitle?: string;
  /** Original publish date ISO 8601 (for youtube source type) */
  publishedAt?: string;
  /** User-defined tags (case-insensitive, stored lowercase) */
  tags?: string[];
}

// ===== Workspace =====

export interface WorkspaceData {
  /** Workspace name (user-provided, unique) */
  name: string;
  /** Gemini File Search Store resource name (e.g., "fileSearchStores/abc123") */
  storeName: string;
  /** ISO 8601 UTC datetime of workspace creation */
  createdAt: string;
  /** Uploads keyed by upload ID (UUID) */
  uploads: Record<string, UploadEntry>;
}

// ===== Registry (Root) =====

export interface Registry {
  /** Workspaces keyed by workspace name */
  workspaces: Record<string, WorkspaceData>;
}

// ===== Configuration =====

export interface AppConfig {
  /** Google Gemini API key (required) */
  geminiApiKey: string;
  /** Gemini model name, e.g. "gemini-2.5-flash" (required) */
  geminiModel: string;
  /** ISO 8601 date for API key expiration (optional) */
  geminiApiKeyExpiration?: string;
  /** YouTube Data API key (optional, required for channel-scan) */
  youtubeDataApiKey?: string;
  /** ISO 8601 date for YouTube Data API key expiration (optional) */
  youtubeDataApiKeyExpiration?: string;
}

// ===== Content Extraction =====

export interface ExtractedContent {
  /** The content to upload (text string for blob upload, or file path for disk files) */
  content: string;
  /** Whether content is a file path (true) or in-memory text (false) */
  isFilePath: boolean;
  /** Auto-generated title */
  title: string;
  /** MIME type for the content */
  mimeType: string;
  /** Source type classification */
  sourceType: SourceType;
  /** Source URL or file path (null for notes) */
  sourceUrl: string | null;
  /** Optional AI-generated notes in Markdown format */
  notes?: string;
  /** YouTube channel title */
  channelTitle?: string;
  /** Original publish date ISO 8601 */
  publishedAt?: string;
}

// ===== Gemini Custom Metadata =====

export interface CustomMetadataEntry {
  key: string;
  stringValue?: string;
  numericValue?: number;
  stringListValue?: { values: string[] };
}

// ===== Query Result =====

export interface Citation {
  /** Relevant text excerpt from the source document */
  text: string;
  /** Document title (from Gemini displayName or custom metadata) */
  documentTitle: string;
  /** Document resource URI */
  documentUri: string;
  /** Custom metadata returned with the citation */
  customMetadata?: Record<string, string>;
}

export interface QueryResult {
  /** Natural language answer from the model */
  answer: string;
  /** Citations from grounding metadata */
  citations: Citation[];
}

// ===== Filter Types =====

/** Gemini-side filter keys that can be passed in metadataFilter (AIP-160) */
export type GeminiFilterKey = 'source_type' | 'source_url';

/** Client-side filter keys that are applied after Gemini returns results */
export type ClientFilterKey = 'flags' | 'expiration_date' | 'expiration_status' | 'tag';

export interface ParsedFilter {
  key: string;
  value: string;
  layer: 'gemini' | 'client';
}

// ===== Store Info =====

export interface StoreInfo {
  /** Store resource name */
  name: string;
  /** Human-readable display name */
  displayName: string;
}

// ===== YouTube Video Metadata (from YouTube Data API) =====

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  publishedAt: string; // ISO 8601
  channelTitle: string;
  description?: string;
  duration?: string; // ISO 8601 duration, e.g., "PT12M34S"
}

// ===== Channel Scan Options (CLI) =====

export interface ChannelScanOptions {
  channel: string;
  from: string; // ISO 8601 date
  to: string; // ISO 8601 date
  withNotes?: boolean;
  dryRun?: boolean;
  maxVideos?: number;
  continueOnError?: boolean;
  tag?: string[];
}

// ===== Channel Scan Result =====

export interface ChannelScanResult {
  totalVideos: number;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: Array<{ videoId: string; title: string; error: string }>;
}

// ===== Notes Content =====

export interface NotesContent {
  summary: string;
  keyPoints: string[];
  importantTerms: Array<{ term: string; definition: string }>;
}

// ===== Upload Options (CLI) =====

export interface UploadOptions {
  file?: string;
  url?: string;
  youtube?: string;
  note?: string;
  withNotes?: boolean;
  tag?: string[];
}

// ===== Listing Options (CLI) =====

export interface ListingOptions {
  filter?: string[];
  sort?: string;
}

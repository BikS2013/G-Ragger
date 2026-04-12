import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import type { AppContext } from './context.js';
import { extractYouTubeEnhanced } from '../services/content-extractor.js';
import { uploadContent } from '../services/file-search.js';
import { getWorkspace, addUpload } from '../services/registry.js';
import { generateNotes } from '../services/notes-generator.js';
import {
  resolveChannelId,
  getUploadsPlaylistId,
  listChannelVideos,
} from '../services/youtube-data-api.js';
import { validateDate, extractYouTubeVideoId } from '../utils/validation.js';
import type {
  CustomMetadataEntry,
  UploadEntry,
  YouTubeVideoMetadata,
  ChannelScanResult,
} from '../types/index.js';

const require = createRequire(import.meta.url);

// ===== Transcript helpers =====

function decodeHtml(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) =>
      String.fromCharCode(parseInt(code, 10))
    );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface TranscriptItem {
  text: string;
  offset: number;
  duration: number;
}

async function fetchTranscriptItems(videoId: string): Promise<TranscriptItem[]> {
  const { YoutubeTranscript } = require('youtube-transcript-plus') as {
    YoutubeTranscript: {
      fetchTranscript: (id: string) => Promise<TranscriptItem[]>;
    };
  };
  const items = await YoutubeTranscript.fetchTranscript(videoId);
  if (!items || items.length === 0) {
    throw new Error('Transcript is empty or not available for this video.');
  }
  return items;
}

// ===== Operations =====

/**
 * Fetch a formatted transcript from YouTube with timestamps and paragraph breaks.
 */
export async function getTranscript(url: string): Promise<string> {
  const videoId = extractYouTubeVideoId(url);
  const items = await fetchTranscriptItems(videoId);

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];
  let paragraphStartTime = items[0].offset;

  for (let i = 0; i < items.length; i++) {
    currentParagraph.push(decodeHtml(items[i].text));
    if (i < items.length - 1) {
      const gap =
        items[i + 1].offset - (items[i].offset + items[i].duration);
      if (gap > 2.0) {
        const timestamp = formatTime(paragraphStartTime);
        paragraphs.push(`[${timestamp}]\n${currentParagraph.join(' ')}`);
        currentParagraph = [];
        paragraphStartTime = items[i + 1].offset;
      }
    }
  }
  if (currentParagraph.length > 0) {
    const timestamp = formatTime(paragraphStartTime);
    paragraphs.push(`[${timestamp}]\n${currentParagraph.join(' ')}`);
  }

  return paragraphs.join('\n\n');
}

/**
 * Generate AI notes from a YouTube video transcript.
 */
export async function getNotes(ctx: AppContext, url: string): Promise<string> {
  const videoId = extractYouTubeVideoId(url);
  const items = await fetchTranscriptItems(videoId);
  const transcript = items.map((i) => i.text).join(' ');

  // Fetch video title via oEmbed
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const oembedRes = await fetch(oembedUrl);
  const title = oembedRes.ok
    ? ((await oembedRes.json()) as { title: string }).title
    : 'Unknown Video';

  return generateNotes(ctx.client, ctx.config.geminiModel, title, transcript);
}

/**
 * Fetch the video description via the YouTube Data API.
 */
export async function getDescription(
  ctx: AppContext,
  url: string
): Promise<string> {
  const videoId = extractYouTubeVideoId(url);

  if (!ctx.config.youtubeDataApiKey) {
    throw new Error(
      'YouTube Data API key is not configured. Set YOUTUBE_DATA_API_KEY to fetch video descriptions.'
    );
  }

  const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(ctx.config.youtubeDataApiKey)}`;
  const ytRes = await fetch(ytUrl);
  if (!ytRes.ok) {
    throw new Error(
      `YouTube API request failed: ${ytRes.status} ${ytRes.statusText}`
    );
  }

  const ytJson = (await ytRes.json()) as {
    items?: Array<{ snippet?: { description?: string } }>;
  };
  const desc = ytJson.items?.[0]?.snippet?.description;
  if (!desc) {
    throw new Error('No description available for this video.');
  }

  return desc;
}

/**
 * Channel scan progress callback for reporting progress to callers.
 */
export interface ChannelScanProgress {
  onResolving?: (channel: string) => void;
  onFetchingVideos?: (from: string, to: string) => void;
  onFound?: (count: number, channelTitle: string) => void;
  onProcessing?: (index: number, total: number, title: string) => void;
  onUploaded?: (title: string, id: string) => void;
  onFailed?: (title: string, error: string) => void;
}

/**
 * Scan a YouTube channel for videos in a date range and upload them to a workspace.
 */
export async function channelScan(
  ctx: AppContext,
  workspace: string,
  channel: string,
  fromDate: string,
  toDate: string,
  options: {
    withNotes?: boolean;
    dryRun?: boolean;
    maxVideos?: number;
    continueOnError?: boolean;
  } = {},
  progress?: ChannelScanProgress
): Promise<{
  channelTitle: string;
  videos: YouTubeVideoMetadata[];
  result: ChannelScanResult;
}> {
  if (!ctx.config.youtubeDataApiKey) {
    throw new Error(
      'YOUTUBE_DATA_API_KEY is required for channel-scan but was not set.\n' +
        'Obtain your API key from: https://console.cloud.google.com/apis/credentials\n' +
        'Set it using one of the following methods:\n' +
        '  1. Environment variable: export YOUTUBE_DATA_API_KEY="your-key"\n' +
        '  2. .env file in project root: YOUTUBE_DATA_API_KEY=your-key\n' +
        '  3. Config file at ~/.geminirag/config.json: { "YOUTUBE_DATA_API_KEY": "your-key" }'
    );
  }
  const apiKey = ctx.config.youtubeDataApiKey;

  validateDate(fromDate);
  validateDate(toDate);

  progress?.onResolving?.(channel);
  const { channelId, channelTitle } = await resolveChannelId(apiKey, channel);

  const playlistId = await getUploadsPlaylistId(apiKey, channelId);

  progress?.onFetchingVideos?.(fromDate, toDate);
  const fromDateISO = fromDate + 'T00:00:00Z';
  const toDateISO = toDate + 'T23:59:59Z';
  let videos = await listChannelVideos(apiKey, playlistId, fromDateISO, toDateISO);

  if (options.maxVideos !== undefined && options.maxVideos > 0) {
    videos = videos.slice(0, options.maxVideos);
  }

  progress?.onFound?.(videos.length, channelTitle);

  const scanResult: ChannelScanResult = {
    totalVideos: videos.length,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (options.dryRun) {
    return { channelTitle, videos, result: scanResult };
  }

  // Verify workspace exists
  const ws = getWorkspace(workspace);

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

    progress?.onProcessing?.(i + 1, videos.length, video.title);

    try {
      const extracted = await extractYouTubeEnhanced(videoUrl, {
        metadata: video,
        withNotes: options.withNotes,
        ai: options.withNotes ? ctx.client : undefined,
        model: options.withNotes ? ctx.config.geminiModel : undefined,
      });

      const customMetadata: CustomMetadataEntry[] = [
        { key: 'source_type', stringValue: 'youtube' },
        { key: 'source_url', stringValue: videoUrl },
      ];

      const documentName = await uploadContent(
        ctx.client,
        ws.storeName,
        extracted.content,
        extracted.isFilePath,
        extracted.mimeType,
        extracted.title,
        customMetadata
      );

      const uploadId = uuidv4();
      const entry: UploadEntry = {
        id: uploadId,
        documentName,
        title: extracted.title,
        timestamp: new Date().toISOString(),
        sourceType: 'youtube',
        sourceUrl: videoUrl,
        expirationDate: null,
        flags: [],
        channelTitle: video.channelTitle,
        publishedAt: video.publishedAt,
      };
      addUpload(workspace, entry);

      progress?.onUploaded?.(extracted.title, uploadId);
      scanResult.uploaded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (options.continueOnError) {
        progress?.onFailed?.(video.title, message);
        scanResult.failed++;
        scanResult.errors.push({
          videoId: video.videoId,
          title: video.title,
          error: message,
        });
      } else {
        throw error;
      }
    }

    // Rate limiting between videos
    if (i < videos.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 2000 + Math.random() * 1000)
      );
    }
  }

  scanResult.skipped =
    scanResult.totalVideos - scanResult.uploaded - scanResult.failed;

  return { channelTitle, videos, result: scanResult };
}

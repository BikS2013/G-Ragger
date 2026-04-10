import { resolve, basename } from 'node:path';
import { access } from 'node:fs/promises';
import mime from 'mime-types';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { YoutubeTranscript } = require('youtube-transcript-plus') as { YoutubeTranscript: { fetchTranscript: (videoId: string) => Promise<Array<{ text: string; offset: number; duration: number }>> } };

import { GoogleGenAI } from '@google/genai';
import { ExtractedContent, YouTubeVideoMetadata } from '../types/index.js';
import { validateMimeType, extractYouTubeVideoId } from '../utils/validation.js';
import { generateNotes } from './notes-generator.js';

/**
 * Options for enhanced YouTube content extraction.
 */
export interface YouTubeExtractOptions {
  /** Pre-fetched metadata (from channel scan); skips oEmbed call when provided */
  metadata?: YouTubeVideoMetadata;
  /** Whether to generate AI notes */
  withNotes?: boolean;
  /** GoogleGenAI instance (required when withNotes is true) */
  ai?: GoogleGenAI;
  /** Model name (required when withNotes is true) */
  model?: string;
  /** YouTube Data API key (optional, used to fetch video description for single uploads) */
  youtubeApiKey?: string;
}

/**
 * Extract content from a disk file.
 *
 * @param filePath - Absolute or relative path to the file
 * @returns ExtractedContent with isFilePath=true
 * @throws Error if file not found or MIME type unsupported
 */
export async function extractDiskFile(filePath: string): Promise<ExtractedContent> {
  const absolutePath = resolve(filePath);

  // Check file exists
  try {
    await access(absolutePath);
  } catch {
    throw new Error(`File not found: '${absolutePath}'`);
  }

  // Detect MIME type
  const mimeType = mime.lookup(absolutePath);
  if (!mimeType) {
    throw new Error(
      `Could not determine MIME type for file: '${absolutePath}'`
    );
  }

  // Validate MIME type is supported
  validateMimeType(mimeType);

  return {
    content: absolutePath,
    isFilePath: true,
    title: basename(absolutePath),
    mimeType,
    sourceType: 'file',
    sourceUrl: absolutePath,
  };
}

/**
 * Extract content from a web page URL.
 *
 * @param url - HTTP/HTTPS URL
 * @returns ExtractedContent with markdown content and isFilePath=false
 * @throws Error if fetch fails or content extraction fails
 */
export async function extractWebPage(url: string): Promise<ExtractedContent> {
  // Fetch HTML
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch URL '${url}': ${response.status} ${response.statusText}`
    );
  }
  const html = await response.text();

  // Parse with JSDOM
  const dom = new JSDOM(html, { url });

  // Extract title
  const titleElement = dom.window.document.querySelector('title');
  let title: string;
  if (titleElement && titleElement.textContent?.trim()) {
    title = titleElement.textContent.trim();
  } else {
    const parsedUrl = new URL(url);
    title = parsedUrl.hostname + parsedUrl.pathname;
  }

  // Extract content with Readability
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.content) {
    throw new Error(`Failed to extract content from URL: '${url}'`);
  }

  // Convert to Markdown
  const turndownService = new TurndownService();
  turndownService.use(gfm);
  const markdown = turndownService.turndown(article.content);

  if (!markdown.trim()) {
    throw new Error(`Extracted content from URL is empty: '${url}'`);
  }

  return {
    content: markdown,
    isFilePath: false,
    title,
    mimeType: 'text/markdown',
    sourceType: 'web',
    sourceUrl: url,
  };
}

/**
 * Build a transcript string with paragraph breaks inserted at natural pauses.
 *
 * Iterates through transcript segments and inserts a double newline (paragraph break)
 * when the gap between the end of one segment and the start of the next exceeds the
 * pause threshold. Otherwise, segments are joined with a single space.
 *
 * @param items - Transcript segments with text, offset (seconds), and duration (seconds)
 * @param pauseThresholdSeconds - Gap threshold for paragraph breaks (default: 2.0 seconds)
 * @returns Formatted transcript text with paragraph breaks
 */
function buildTranscriptWithParagraphs(
  items: Array<{ text: string; offset: number; duration: number }>,
  pauseThresholdSeconds: number = 2.0
): string {
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (let i = 0; i < items.length; i++) {
    currentParagraph.push(items[i].text);

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

/**
 * Extract YouTube content in enhanced Markdown format.
 *
 * Produces structured Markdown with video URL, metadata header,
 * paragraph-broken transcript, and optional AI-generated notes.
 *
 * @param url - YouTube video URL
 * @param options - Optional extraction options (metadata, notes config)
 * @returns ExtractedContent with Markdown content and mimeType 'text/markdown'
 * @throws Error if URL invalid, transcript unavailable, or fetch fails
 */
export async function extractYouTubeEnhanced(
  url: string,
  options?: YouTubeExtractOptions
): Promise<ExtractedContent> {
  const videoId = extractYouTubeVideoId(url);

  // Resolve metadata
  let title: string;
  let publishedAt: string;
  let channelTitle: string;

  let description: string | undefined;

  if (options?.metadata) {
    // Channel-scan path: use pre-fetched metadata
    title = options.metadata.title;
    publishedAt = options.metadata.publishedAt;
    channelTitle = options.metadata.channelTitle;
    description = options.metadata.description;
  } else {
    // Single-video upload path: fetch via oEmbed
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const oembedResponse = await fetch(oembedUrl);
    if (!oembedResponse.ok) {
      throw new Error(`Failed to fetch YouTube video info for: '${url}'`);
    }
    const oembedData = (await oembedResponse.json()) as { title: string; author_name?: string };
    title = oembedData.title;
    publishedAt = 'Unknown';
    channelTitle = oembedData.author_name ?? 'Unknown';

    // Fetch description via YouTube Data API if key is available
    if (options?.youtubeApiKey) {
      try {
        const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(options.youtubeApiKey)}`;
        const ytRes = await fetch(ytUrl);
        if (ytRes.ok) {
          const ytJson = (await ytRes.json()) as { items?: Array<{ snippet?: { description?: string; publishedAt?: string } }> };
          if (ytJson.items?.[0]?.snippet) {
            description = ytJson.items[0].snippet.description;
            if (ytJson.items[0].snippet.publishedAt) {
              publishedAt = ytJson.items[0].snippet.publishedAt;
            }
          }
        }
      } catch {
        // Non-fatal: proceed without description
      }
    }
  }

  // Fetch transcript
  let transcriptItems: Array<{ text: string; offset: number; duration: number }>;
  try {
    transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
  } catch {
    throw new Error(
      `Transcript not available for YouTube video: '${url}'. Only videos with captions are supported.`
    );
  }

  if (!transcriptItems || transcriptItems.length === 0) {
    throw new Error(`Transcript is empty for YouTube video: '${url}'`);
  }

  // Build paragraph-broken transcript
  const transcript = buildTranscriptWithParagraphs(transcriptItems);

  // Build structured Markdown
  let content = `# ${title}\n\n`;
  content += `**Source:** ${url}\n`;
  content += `**Published:** ${publishedAt}\n`;
  content += `**Channel:** ${channelTitle}\n\n`;
  if (description) {
    content += `---\n\n`;
    content += `## Description\n\n`;
    content += description + '\n\n';
  }
  content += `---\n\n`;
  content += `## Transcript\n\n`;
  content += transcript;

  // Generate notes if requested
  let notesMarkdown: string | undefined;
  if (options?.withNotes && options.ai && options.model) {
    try {
      notesMarkdown = await generateNotes(
        options.ai, options.model, title, transcript
      );
      content += '\n\n---\n\n## Notes\n\n' + notesMarkdown;
    } catch (error) {
      console.warn(
        `Warning: Notes generation failed for "${title}". Uploading without notes.`
      );
    }
  }

  return {
    content,
    isFilePath: false,
    title,
    mimeType: 'text/markdown',
    sourceType: 'youtube',
    sourceUrl: url,
    notes: notesMarkdown,
    channelTitle,
    publishedAt,
  };
}

/**
 * Extract transcript from a YouTube video.
 *
 * Backward-compatible wrapper that delegates to extractYouTubeEnhanced.
 * Output format is structured Markdown (text/markdown).
 *
 * @param url - YouTube video URL
 * @returns ExtractedContent with structured Markdown content and isFilePath=false
 * @throws Error if URL invalid, transcript unavailable, or fetch fails
 */
export async function extractYouTube(url: string): Promise<ExtractedContent> {
  return extractYouTubeEnhanced(url);
}

/**
 * Generate a title from note text.
 * Takes first 60 characters, trimmed to a word boundary.
 */
function generateNoteTitle(noteText: string): string {
  const trimmed = noteText.trim();

  if (trimmed.length <= 60) {
    return trimmed;
  }

  const truncated = trimmed.substring(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 20) {
    return truncated.substring(0, lastSpace) + '...';
  } else {
    return truncated + '...';
  }
}

/**
 * Create upload content from a personal note.
 *
 * @param text - Note text content
 * @returns ExtractedContent with plain text and isFilePath=false
 * @throws Error if text is empty
 */
export function extractNote(text: string): ExtractedContent {
  if (!text || !text.trim()) {
    throw new Error('Note text cannot be empty');
  }

  return {
    content: text,
    isFilePath: false,
    title: generateNoteTitle(text),
    mimeType: 'text/plain',
    sourceType: 'note',
    sourceUrl: null,
  };
}

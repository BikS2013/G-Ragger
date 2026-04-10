import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import { getDocumentContent } from '../services/file-search.js';
import { generateNotes } from '../services/notes-generator.js';
import { getWorkspace } from '../services/registry.js';
import { formatUploadMetadataHeader } from '../utils/format.js';
import { findUploadById } from '../utils/filters.js';
import { extractYouTubeVideoId } from '../utils/validation.js';

const require = createRequire(import.meta.url);

/**
 * Register the get command for retrieving document content.
 */
export function registerGetCommand(program: Command): void {
  program
    .command('get')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload ID (full or first 8+ characters)')
    .option('--output <file>', 'Write content to file instead of stdout')
    .option('--raw', 'Skip metadata header, output only document content')
    .option('--description', 'Fetch YouTube video description directly (YouTube uploads only)')
    .option('--notes', 'Generate AI notes from YouTube transcript (YouTube uploads only)')
    .description('Retrieve the full content of an uploaded document')
    .action(
      async (
        workspace: string,
        uploadId: string,
        options: { output?: string; raw?: boolean; description?: boolean; notes?: boolean }
      ) => {
        try {
          const config = loadConfig();
          const ai = createGeminiClient(config);

          // Resolve workspace
          const ws = getWorkspace(workspace);

          // Find upload by ID (supports partial matching)
          const upload = findUploadById(ws.uploads, uploadId);
          if (!upload) {
            throw new Error(
              `Upload '${uploadId}' not found in workspace '${workspace}'.`
            );
          }

          // Mutual exclusivity check
          if (options.description && options.notes) {
            throw new Error('--description and --notes are mutually exclusive. Use only one at a time.');
          }

          // Retrieve content based on selected mode
          let content: string;

          if (options.description) {
            // Requires YouTube upload with sourceUrl
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--description is only available for YouTube uploads with a source URL.');
            }
            // Requires YouTube Data API key
            if (!config.youtubeDataApiKey) {
              throw new Error('--description requires YOUTUBE_DATA_API_KEY to be configured.');
            }
            // Fetch description via YouTube Data API
            const videoId = extractYouTubeVideoId(upload.sourceUrl);
            const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(config.youtubeDataApiKey)}`;
            const ytRes = await fetch(ytUrl);
            if (!ytRes.ok) throw new Error(`YouTube API request failed: ${ytRes.status}`);
            const ytJson = await ytRes.json();
            const desc = ytJson.items?.[0]?.snippet?.description;
            if (!desc) throw new Error('No description available for this video.');
            content = desc;
          } else if (options.notes) {
            // Requires YouTube upload with sourceUrl
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--notes is only available for YouTube uploads with a source URL.');
            }
            // Fetch transcript from YouTube
            const videoId = extractYouTubeVideoId(upload.sourceUrl);
            const { YoutubeTranscript } = require('youtube-transcript-plus');
            const items = await YoutubeTranscript.fetchTranscript(videoId);
            if (!items?.length) throw new Error('Transcript not available for this video.');
            const transcript = items.map((i: any) => i.text).join(' ');
            // Generate notes via Gemini
            content = await generateNotes(ai, config.geminiModel, upload.title, transcript);
          } else {
            // Default: fetch via Gemini getDocumentContent
            content = await getDocumentContent(
              ai,
              config.geminiModel,
              ws.storeName,
              upload.documentName,
              upload.title
            );
          }

          // Build output
          let output: string;
          if (options.raw) {
            output = content;
          } else {
            const header = formatUploadMetadataHeader(upload);
            output = `${header}\n\n${content}`;
          }

          // Write to file or stdout
          if (options.output) {
            fs.writeFileSync(options.output, output, 'utf-8');
            console.log(`Content written to ${options.output}`);
          } else {
            console.log(output);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );
}

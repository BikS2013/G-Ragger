import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import { extractYouTubeEnhanced } from '../services/content-extractor.js';
import { uploadContent } from '../services/file-search.js';
import { getWorkspace, addUpload } from '../services/registry.js';
import {
  resolveChannelId,
  getUploadsPlaylistId,
  listChannelVideos,
} from '../services/youtube-data-api.js';
import { validateDate } from '../utils/validation.js';
import { formatChannelScanSummary } from '../utils/format.js';
import type {
  ChannelScanOptions,
  ChannelScanResult,
  CustomMetadataEntry,
  UploadEntry,
} from '../types/index.js';

/**
 * Sleep helper for rate limiting between video uploads.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Register the channel-scan command.
 *
 * Scans a YouTube channel for videos in a date range, extracts transcripts,
 * and uploads them to a GeminiRAG workspace.
 */
export function registerChannelScanCommand(program: Command): void {
  program
    .command('channel-scan')
    .argument('<workspace>', 'Target workspace name')
    .requiredOption('--channel <input>', 'Channel handle (@name), URL, or ID')
    .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
    .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
    .option('--with-notes', 'Generate AI notes for each video')
    .option('--dry-run', 'List videos without uploading')
    .option('--max-videos <n>', 'Limit number of videos to process', parseInt)
    .option('--continue-on-error', 'Skip failed videos instead of aborting')
    .description('Scan a YouTube channel and upload video transcripts to a workspace')
    .action(async (workspace: string, options: ChannelScanOptions) => {
      try {
        // 1. Load config, validate YouTube Data API key
        const config = loadConfig();
        if (!config.youtubeDataApiKey) {
          throw new Error(
            'YOUTUBE_DATA_API_KEY is required for channel-scan but was not set.\n' +
            'Obtain your API key from: https://console.cloud.google.com/apis/credentials\n' +
            'Set it using one of the following methods:\n' +
            '  1. Environment variable: export YOUTUBE_DATA_API_KEY="your-key"\n' +
            '  2. .env file in project root: YOUTUBE_DATA_API_KEY=your-key\n' +
            '  3. Config file at ~/.geminirag/config.json: { "YOUTUBE_DATA_API_KEY": "your-key" }'
          );
        }
        const apiKey = config.youtubeDataApiKey;

        // 2. Create Gemini client
        const ai = createGeminiClient(config);

        // 3. Validate dates
        validateDate(options.from);
        validateDate(options.to);

        // 4. Resolve channel
        console.log(`Resolving channel: ${options.channel}...`);
        const { channelId, channelTitle } = await resolveChannelId(apiKey, options.channel);

        // 5. Get uploads playlist
        const playlistId = await getUploadsPlaylistId(apiKey, channelId);

        // 6. List videos in date range
        console.log(`Fetching videos from ${options.from} to ${options.to}...`);
        const fromDateISO = options.from + 'T00:00:00Z';
        const toDateISO = options.to + 'T23:59:59Z';
        let videos = await listChannelVideos(apiKey, playlistId, fromDateISO, toDateISO);

        // 7. Apply --max-videos limit
        if (options.maxVideos !== undefined && options.maxVideos > 0) {
          videos = videos.slice(0, options.maxVideos);
        }

        // 8. Display summary
        console.log(`\nFound ${videos.length} videos from "${channelTitle}" between ${options.from} and ${options.to}\n`);

        // 9. Dry run: display table and exit
        if (options.dryRun) {
          if (videos.length === 0) {
            console.log('No videos found in the specified date range.');
            return;
          }

          // Build table header
          const titleWidth = 60;
          const dateWidth = 12;
          const idWidth = 13;
          const header = `${'Title'.padEnd(titleWidth)}  ${'Date'.padEnd(dateWidth)}  ${'Video ID'.padEnd(idWidth)}`;
          const separator = `${'-'.repeat(titleWidth)}  ${'-'.repeat(dateWidth)}  ${'-'.repeat(idWidth)}`;

          console.log(header);
          console.log(separator);

          for (const video of videos) {
            const title = video.title.length > titleWidth
              ? video.title.slice(0, titleWidth - 3) + '...'
              : video.title.padEnd(titleWidth);
            const date = video.publishedAt.slice(0, 10).padEnd(dateWidth);
            const id = video.videoId.padEnd(idWidth);
            console.log(`${title}  ${date}  ${id}`);
          }

          console.log(`\n(Dry run — no uploads performed)`);
          return;
        }

        // 10. Verify workspace exists
        const workspaceData = getWorkspace(workspace);

        // 11. Process each video sequentially
        const result: ChannelScanResult = {
          totalVideos: videos.length,
          uploaded: 0,
          skipped: 0,
          failed: 0,
          errors: [],
        };

        for (let i = 0; i < videos.length; i++) {
          const video = videos[i];
          const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

          console.log(`[${i + 1}/${videos.length}] Processing: ${video.title}`);

          try {
            // 11b. Extract content
            const extracted = await extractYouTubeEnhanced(videoUrl, {
              metadata: video,
              withNotes: options.withNotes,
              ai: options.withNotes ? ai : undefined,
              model: options.withNotes ? config.geminiModel : undefined,
            });

            // 11c. Build custom metadata
            const customMetadata: CustomMetadataEntry[] = [
              { key: 'source_type', stringValue: 'youtube' },
              { key: 'source_url', stringValue: videoUrl },
            ];

            // 11d. Upload to Gemini File Search Store
            const documentName = await uploadContent(
              ai,
              workspaceData.storeName,
              extracted.content,
              extracted.isFilePath,
              extracted.mimeType,
              extracted.title,
              customMetadata
            );

            // 11e. Register in local registry
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

            // 11f. Print success
            console.log(`  Uploaded: ${extracted.title} (ID: ${uploadId})`);
            result.uploaded++;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            // 11g. Handle error
            if (options.continueOnError) {
              console.warn(`  Warning: Failed to process "${video.title}": ${message}`);
              result.failed++;
              result.errors.push({
                videoId: video.videoId,
                title: video.title,
                error: message,
              });
            } else {
              throw error;
            }
          }

          // 11h. Rate limiting between videos (skip after last video)
          if (i < videos.length - 1) {
            await sleep(2000 + Math.random() * 1000);
          }
        }

        // 12. Print final summary
        result.skipped = result.totalVideos - result.uploaded - result.failed;
        console.log('\n' + formatChannelScanSummary(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

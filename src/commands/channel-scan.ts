import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import { channelScan } from '../operations/youtube-ops.js';
import { validateTags } from '../utils/validation.js';
import { formatChannelScanSummary } from '../utils/format.js';
import type { ChannelScanOptions } from '../types/index.js';

/**
 * Register the channel-scan command.
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
    .option('--tag <tags...>', 'Tags to attach to all uploaded videos')
    .description('Scan a YouTube channel and upload video transcripts to a workspace')
    .action(async (workspace: string, options: ChannelScanOptions) => {
      try {
        const ctx = createContext();
        const tags = options.tag ? validateTags(options.tag) : undefined;

        const { videos, result } = await channelScan(
          ctx,
          workspace,
          options.channel,
          options.from,
          options.to,
          {
            withNotes: options.withNotes,
            dryRun: options.dryRun,
            maxVideos: options.maxVideos,
            continueOnError: options.continueOnError,
            tags,
          },
          {
            onResolving: (ch) => console.log(`Resolving channel: ${ch}...`),
            onFetchingVideos: (from, to) =>
              console.log(`Fetching videos from ${from} to ${to}...`),
            onFound: (count, title) =>
              console.log(
                `\nFound ${count} videos from "${title}" between ${options.from} and ${options.to}\n`
              ),
            onProcessing: (i, total, title) =>
              console.log(`[${i}/${total}] Processing: ${title}`),
            onUploaded: (title, id) =>
              console.log(`  Uploaded: ${title} (ID: ${id})`),
            onFailed: (title, error) =>
              console.warn(`  Warning: Failed to process "${title}": ${error}`),
          }
        );

        if (options.dryRun) {
          if (videos.length === 0) {
            console.log('No videos found in the specified date range.');
            return;
          }

          // Build table
          const titleWidth = 60;
          const dateWidth = 12;
          const idWidth = 13;
          const header = `${'Title'.padEnd(titleWidth)}  ${'Date'.padEnd(dateWidth)}  ${'Video ID'.padEnd(idWidth)}`;
          const separator = `${'-'.repeat(titleWidth)}  ${'-'.repeat(dateWidth)}  ${'-'.repeat(idWidth)}`;

          console.log(header);
          console.log(separator);

          for (const video of videos) {
            const title =
              video.title.length > titleWidth
                ? video.title.slice(0, titleWidth - 3) + '...'
                : video.title.padEnd(titleWidth);
            const date = video.publishedAt.slice(0, 10).padEnd(dateWidth);
            const id = video.videoId.padEnd(idWidth);
            console.log(`${title}  ${date}  ${id}`);
          }

          console.log(`\n(Dry run — no uploads performed)`);
          return;
        }

        console.log('\n' + formatChannelScanSummary(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

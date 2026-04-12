import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import {
  uploadFile,
  uploadUrl,
  uploadYoutube,
  uploadNote,
} from '../operations/upload-ops.js';
import { validateTags } from '../utils/validation.js';
import type { UploadOptions } from '../types/index.js';

/**
 * Register the upload command with mutually exclusive source options.
 */
export function registerUploadCommand(program: Command): void {
  program
    .command('upload')
    .argument('<workspace>', 'Target workspace name')
    .option('--file <path>', 'Upload from a local file')
    .option('--url <url>', 'Upload from a web page URL')
    .option('--youtube <url>', 'Upload from a YouTube video transcript')
    .option('--note <text>', 'Upload a personal note')
    .option('--with-notes', 'Generate AI notes for YouTube uploads')
    .option('--tag <tags...>', 'Tags to attach to the upload (repeatable)')
    .description('Upload content to a workspace')
    .action(async (workspace: string, options: UploadOptions) => {
      try {
        // Validate exactly one source option is provided
        const sources = [options.file, options.url, options.youtube, options.note].filter(
          (v) => v !== undefined
        );
        if (sources.length === 0) {
          throw new Error('One of --file, --url, --youtube, or --note must be provided');
        }
        if (sources.length > 1) {
          throw new Error('Only one of --file, --url, --youtube, or --note can be provided');
        }

        if (options.withNotes && !options.youtube) {
          console.warn('Warning: --with-notes is only applicable to YouTube uploads. Flag ignored.');
        }

        const ctx = createContext();
        const tags = options.tag ? validateTags(options.tag) : undefined;
        let result;

        if (options.file) {
          result = await uploadFile(ctx, workspace, options.file, tags);
        } else if (options.url) {
          result = await uploadUrl(ctx, workspace, options.url, tags);
        } else if (options.youtube) {
          result = await uploadYoutube(ctx, workspace, options.youtube, !!options.withNotes, tags);
        } else if (options.note) {
          result = await uploadNote(ctx, workspace, options.note, tags);
        } else {
          throw new Error('One of --file, --url, --youtube, or --note must be provided');
        }

        console.log(`Uploaded: ${result.title} (ID: ${result.id})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

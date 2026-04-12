import fs from 'node:fs';
import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import { getUploadContent } from '../operations/upload-ops.js';
import { getNotes, getDescription } from '../operations/youtube-ops.js';
import { getWorkspace } from '../services/registry.js';
import { formatUploadMetadataHeader } from '../utils/format.js';
import { findUploadById } from '../utils/filters.js';

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
          const ctx = createContext();
          const ws = getWorkspace(workspace);
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

          let content: string;

          if (options.description) {
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--description is only available for YouTube uploads with a source URL.');
            }
            content = await getDescription(ctx, upload.sourceUrl);
          } else if (options.notes) {
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--notes is only available for YouTube uploads with a source URL.');
            }
            content = await getNotes(ctx, upload.sourceUrl);
          } else {
            const result = await getUploadContent(ctx, workspace, uploadId);
            content = result.content;
          }

          // Build output
          let output: string;
          if (options.raw) {
            output = content;
          } else {
            const header = formatUploadMetadataHeader(upload);
            output = `${header}\n\n${content}`;
          }

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

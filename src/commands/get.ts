import fs from 'node:fs';
import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import { getUploadContent } from '../operations/upload-ops.js';
import { getNotes, getDescription, generateReport, prepareReportFiles, openEmailWithReport } from '../operations/youtube-ops.js';
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
    .option('--report', 'Generate detailed AI report from transcript + description (YouTube uploads only)')
    .option('--email', 'Send content via system email client (use with --report or --notes)')
    .description('Retrieve the full content of an uploaded document')
    .action(
      async (
        workspace: string,
        uploadId: string,
        options: { output?: string; raw?: boolean; description?: boolean; notes?: boolean; report?: boolean; email?: boolean }
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
          const modeCount = [options.description, options.notes, options.report].filter(Boolean).length;
          if (modeCount > 1) {
            throw new Error('--description, --notes, and --report are mutually exclusive. Use only one at a time.');
          }

          if (options.email && !options.report && !options.notes) {
            throw new Error('--email requires --report or --notes. Use: g-ragger get <ws> <id> --report --email');
          }

          let content: string;
          let emailSubjectPrefix = 'YouTube Content';

          if (options.description) {
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--description is only available for YouTube uploads with a source URL.');
            }
            content = await getDescription(ctx, upload.sourceUrl);
            emailSubjectPrefix = 'YouTube Description';
          } else if (options.notes) {
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--notes is only available for YouTube uploads with a source URL.');
            }
            content = await getNotes(ctx, upload.sourceUrl);
            emailSubjectPrefix = 'YouTube AI Notes';
          } else if (options.report) {
            if (upload.sourceType !== 'youtube' || !upload.sourceUrl) {
              throw new Error('--report is only available for YouTube uploads with a source URL.');
            }
            content = await generateReport(ctx, upload.sourceUrl);
            emailSubjectPrefix = 'YouTube Report';
          } else {
            const result = await getUploadContent(ctx, workspace, uploadId);
            content = result.content;
          }

          // Send via email if requested
          if (options.email) {
            console.log('Preparing files for email...');
            const files = await prepareReportFiles(ctx, upload.sourceUrl!, upload.title, content);
            console.log(`  Markdown: ${files.mdPath}`);
            console.log(`  Word:     ${files.docxPath}`);
            console.log('Opening email client...');
            await openEmailWithReport(files, `${emailSubjectPrefix} - ${upload.title}`);
            console.log('Email client opened with files attached.');
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

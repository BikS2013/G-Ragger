import { Command } from 'commander';
import { listUploads } from '../operations/upload-ops.js';
import { parseListingFilter } from '../utils/filters.js';
import { formatUploadTable } from '../utils/format.js';
import type { ListingOptions } from '../types/index.js';

/**
 * Register the uploads listing command with filter and sort support.
 */
export function registerUploadsCommand(program: Command): void {
  program
    .command('uploads')
    .argument('<workspace>', 'Workspace name')
    .option('--filter <filters...>', 'Filter by metadata (key=value, repeatable)')
    .option(
      '--sort <field>',
      'Sort field: "timestamp" (ascending) or "-timestamp" (descending, default)'
    )
    .description('List all uploads in a workspace')
    .action((workspace: string, options: ListingOptions) => {
      try {
        const filters = options.filter
          ? options.filter.map(parseListingFilter)
          : undefined;

        const uploads = listUploads(workspace, filters, options.sort);
        console.log(formatUploadTable(uploads));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import { getWorkspace } from '../services/registry.js';
import { formatUploadTable } from '../utils/format.js';
import { parseListingFilter, applyFilters, sortUploads } from '../utils/filters.js';
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
        const workspaceData = getWorkspace(workspace);
        let uploads = Object.values(workspaceData.uploads);

        // Apply filters
        if (options.filter) {
          const parsedFilters = options.filter.map(parseListingFilter);
          uploads = applyFilters(uploads, parsedFilters);
        }

        // Sort uploads (default: descending by timestamp)
        uploads = sortUploads(uploads, options.sort);

        // Format and display
        console.log(formatUploadTable(uploads));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import {
  updateTitle,
  removeUploadEntry,
  setExpiration,
  clearExpiration,
  updateFlags,
  getLabels,
} from '../operations/metadata-ops.js';

/**
 * Register metadata management commands:
 * update-title, remove, set-expiration, clear-expiration, flag, labels.
 */
export function registerMetadataCommands(program: Command): void {
  // --- update-title ---
  program
    .command('update-title')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload UUID')
    .argument('<title>', 'New title')
    .description('Update the title of an upload')
    .action((workspace: string, uploadId: string, title: string) => {
      try {
        updateTitle(workspace, uploadId, title);
        console.log(`Title updated to: ${title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- remove ---
  program
    .command('remove')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload UUID')
    .description('Remove an upload from a workspace')
    .action(async (workspace: string, uploadId: string) => {
      try {
        const ctx = createContext();
        await removeUploadEntry(ctx, workspace, uploadId);
        console.log(`Upload '${uploadId}' removed successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- set-expiration ---
  program
    .command('set-expiration')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload UUID')
    .argument('<date>', 'Expiration date in YYYY-MM-DD format')
    .description('Set an expiration date on an upload')
    .action((workspace: string, uploadId: string, date: string) => {
      try {
        setExpiration(workspace, uploadId, date);
        console.log(`Expiration date set to: ${date}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- clear-expiration ---
  program
    .command('clear-expiration')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload UUID')
    .description('Clear the expiration date from an upload')
    .action((workspace: string, uploadId: string) => {
      try {
        clearExpiration(workspace, uploadId);
        console.log('Expiration date cleared.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- flag ---
  program
    .command('flag')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload UUID')
    .option('--add <flags...>', 'Flags to add (completed, urgent, inactive)')
    .option('--remove <flags...>', 'Flags to remove')
    .description('Add or remove flags on an upload')
    .action(
      (
        workspace: string,
        uploadId: string,
        options: { add?: string[]; remove?: string[] }
      ) => {
        try {
          const currentFlags = updateFlags(workspace, uploadId, options.add, options.remove);
          console.log(`Flags updated: [${currentFlags.join(', ')}]`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );

  // --- labels ---
  program
    .command('labels')
    .argument('<workspace>', 'Workspace name')
    .description('List all distinct metadata labels used in a workspace')
    .action((workspace: string) => {
      try {
        const labels = getLabels(workspace);
        if (labels.length === 0) {
          console.log('No uploads in this workspace.');
          return;
        }
        console.log('Metadata labels in use:');
        for (const label of labels) {
          console.log(`  - ${label}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

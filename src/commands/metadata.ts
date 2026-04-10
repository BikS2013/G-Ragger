import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import { deleteDocument } from '../services/file-search.js';
import {
  getWorkspace,
  updateUpload,
  removeUpload,
} from '../services/registry.js';
import { validateDate, validateFlags } from '../utils/validation.js';
import type { Flag } from '../types/index.js';

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
        // Validates workspace and upload exist
        getWorkspace(workspace);
        updateUpload(workspace, uploadId, { title });
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
        // Get workspace and upload details
        const workspaceData = getWorkspace(workspace);
        const upload = workspaceData.uploads[uploadId];
        if (!upload) {
          throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
        }

        const config = loadConfig();
        const ai = createGeminiClient(config);

        // Delete from Gemini
        await deleteDocument(ai, upload.documentName);

        // Remove from local registry
        removeUpload(workspace, uploadId);

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
        validateDate(date);
        // Validates workspace and upload exist
        getWorkspace(workspace);
        updateUpload(workspace, uploadId, { expirationDate: date });
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
        // Validates workspace and upload exist
        getWorkspace(workspace);
        updateUpload(workspace, uploadId, { expirationDate: null });
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
          if (!options.add && !options.remove) {
            throw new Error('At least one of --add or --remove must be provided');
          }

          // Validate flag values
          if (options.add) {
            validateFlags(options.add);
          }
          if (options.remove) {
            validateFlags(options.remove);
          }

          // Get current upload to read existing flags
          const workspaceData = getWorkspace(workspace);
          const upload = workspaceData.uploads[uploadId];
          if (!upload) {
            throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
          }

          let currentFlags: Flag[] = [...upload.flags];

          // Add flags (avoiding duplicates)
          if (options.add) {
            for (const flag of options.add as Flag[]) {
              if (!currentFlags.includes(flag)) {
                currentFlags.push(flag);
              }
            }
          }

          // Remove flags
          if (options.remove) {
            const toRemove = new Set(options.remove as Flag[]);
            currentFlags = currentFlags.filter((f) => !toRemove.has(f));
          }

          updateUpload(workspace, uploadId, { flags: currentFlags });
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
        const workspaceData = getWorkspace(workspace);
        const uploads = Object.values(workspaceData.uploads);

        if (uploads.length === 0) {
          console.log('No uploads in this workspace.');
          return;
        }

        // Collect all distinct metadata keys across uploads
        const labels = new Set<string>();
        for (const upload of uploads) {
          // Standard fields that serve as metadata labels
          labels.add('title');
          labels.add('source_type');
          if (upload.sourceUrl !== null) {
            labels.add('source_url');
          }
          if (upload.expirationDate !== null) {
            labels.add('expiration_date');
          }
          if (upload.flags.length > 0) {
            labels.add('flags');
          }
          labels.add('timestamp');
        }

        const sortedLabels = Array.from(labels).sort();
        console.log('Metadata labels in use:');
        for (const label of sortedLabels) {
          console.log(`  - ${label}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

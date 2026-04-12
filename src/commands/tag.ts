import { Command } from 'commander';
import { updateTags, getTags } from '../operations/metadata-ops.js';

/**
 * Register the tag management command.
 */
export function registerTagCommand(program: Command): void {
  program
    .command('tag')
    .argument('<workspace>', 'Workspace name')
    .argument('<upload-id>', 'Upload UUID')
    .option('--add <tags...>', 'Tags to add')
    .option('--remove <tags...>', 'Tags to remove')
    .option('--list', 'List current tags')
    .description('Manage tags on an upload')
    .action(
      (
        workspace: string,
        uploadId: string,
        options: { add?: string[]; remove?: string[]; list?: boolean }
      ) => {
        try {
          if (!options.add && !options.remove && !options.list) {
            throw new Error('At least one of --add, --remove, or --list must be provided');
          }

          if (options.list) {
            const tags = getTags(workspace, uploadId);
            if (tags.length === 0) {
              console.log('No tags.');
            } else {
              console.log(`Tags: [${tags.join(', ')}]`);
            }
            // If only --list, return
            if (!options.add && !options.remove) return;
          }

          if (options.add || options.remove) {
            const currentTags = updateTags(workspace, uploadId, options.add, options.remove);
            console.log(`Tags updated: [${currentTags.join(', ')}]`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );
}

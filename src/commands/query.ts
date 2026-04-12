import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import { queryWorkspaces } from '../operations/query-ops.js';
import { formatQueryResult } from '../utils/format.js';

/**
 * Register the ask (query) command with multi-workspace and filter support.
 */
export function registerQueryCommand(program: Command): void {
  program
    .command('ask')
    .argument('<workspace>', 'Primary workspace name')
    .argument('<question>', 'Natural language question')
    .option('--workspace <names...>', 'Additional workspace names for cross-workspace query')
    .option('--filter <filters...>', 'Metadata filters in key=value format (repeatable)')
    .description('Query workspace(s) with a natural language question')
    .action(
      async (
        workspace: string,
        question: string,
        options: { workspace?: string[]; filter?: string[] }
      ) => {
        try {
          const ctx = createContext();

          const workspaceNames = [workspace];
          if (options.workspace) {
            workspaceNames.push(...options.workspace);
          }

          const result = await queryWorkspaces(
            ctx,
            workspaceNames,
            question,
            options.filter
          );

          console.log(formatQueryResult(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );
}

import { Command } from 'commander';
import { createContext } from '../operations/context.js';
import { createWorkspace, deleteWorkspace } from '../operations/workspace-ops.js';
import { getWorkspace, listWorkspaces } from '../services/registry.js';
import { formatWorkspaceTable, formatWorkspaceInfo } from '../utils/format.js';

/**
 * Register workspace management commands: create, list, delete, info.
 */
export function registerWorkspaceCommands(program: Command): void {
  // --- create ---
  program
    .command('create')
    .argument('<name>', 'Workspace name')
    .description('Create a new workspace')
    .action(async (name: string) => {
      try {
        const ctx = createContext();
        const result = await createWorkspace(ctx, name);
        console.log(`Workspace '${result.name}' created successfully.`);
        console.log(`Store: ${result.storeName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- list ---
  program
    .command('list')
    .description('List all workspaces')
    .action(() => {
      try {
        const workspaces = listWorkspaces();
        console.log(formatWorkspaceTable(workspaces));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- delete ---
  program
    .command('delete')
    .argument('<name>', 'Workspace name')
    .description('Delete a workspace and all its uploads')
    .action(async (name: string) => {
      try {
        const ctx = createContext();
        await deleteWorkspace(ctx, name);
        console.log(`Workspace '${name}' deleted successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // --- info ---
  program
    .command('info')
    .argument('<name>', 'Workspace name')
    .description('Show workspace details')
    .action((name: string) => {
      try {
        const workspace = getWorkspace(name);
        console.log(formatWorkspaceInfo(workspace));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

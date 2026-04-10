import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import { createStore, deleteStore } from '../services/file-search.js';
import {
  addWorkspace,
  removeWorkspace,
  getWorkspace,
  listWorkspaces,
} from '../services/registry.js';
import { validateWorkspaceName } from '../utils/validation.js';
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
        validateWorkspaceName(name);

        // Check max 10 workspaces
        const existing = listWorkspaces();
        if (existing.length >= 10) {
          throw new Error(
            'Maximum 10 workspaces reached (Gemini API limit). Delete a workspace before creating a new one.'
          );
        }

        // Check workspace does not already exist
        const alreadyExists = existing.some((ws) => ws.name === name);
        if (alreadyExists) {
          throw new Error(`Workspace '${name}' already exists`);
        }

        const config = loadConfig();
        const ai = createGeminiClient(config);

        // Create Gemini File Search Store
        const storeName = await createStore(ai, name);

        // Register in local registry
        addWorkspace(name, storeName);

        console.log(`Workspace '${name}' created successfully.`);
        console.log(`Store: ${storeName}`);
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
        const workspace = getWorkspace(name);

        const config = loadConfig();
        const ai = createGeminiClient(config);

        // Delete Gemini File Search Store (cascades to all documents)
        await deleteStore(ai, workspace.storeName);

        // Remove from local registry
        removeWorkspace(name);

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

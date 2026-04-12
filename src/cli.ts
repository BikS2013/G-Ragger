#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerUploadCommand } from './commands/upload.js';
import { registerMetadataCommands } from './commands/metadata.js';
import { registerQueryCommand } from './commands/query.js';
import { registerUploadsCommand } from './commands/uploads.js';
import { registerGetCommand } from './commands/get.js';
import { registerChannelScanCommand } from './commands/channel-scan.js';
import { registerTagCommand } from './commands/tag.js';

const program = new Command();

program
  .name('g-ragger')
  .description('Workspace-based document management and semantic search using Gemini File Search API')
  .version('1.0.0');

// --- ui command: launch Electron desktop app ---
program
  .command('ui')
  .description('Launch the G-Ragger desktop application')
  .action(() => {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const electronPkg = path.resolve(__dirname, '..', 'electron-ui');
      const electronPath = path.join(
        electronPkg,
        'node_modules',
        'electron',
        'dist',
        'Electron.app',
        'Contents',
        'MacOS',
        'Electron'
      );
      const mainEntry = path.join(electronPkg, 'out', 'main', 'index.js');

      const child = spawn(electronPath, [mainEntry], {
        stdio: 'ignore',
        env: { ...process.env },
        detached: true,
      });

      child.unref();
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error launching UI: ${message}`);
      process.exit(1);
    }
  });

registerWorkspaceCommands(program);
registerUploadCommand(program);
registerMetadataCommands(program);
registerQueryCommand(program);
registerUploadsCommand(program);
registerGetCommand(program);
registerChannelScanCommand(program);
registerTagCommand(program);

// Global error handler for unhandled rejections
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});

program.parse(process.argv);

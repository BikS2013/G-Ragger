#!/usr/bin/env node

import { Command } from 'commander';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerUploadCommand } from './commands/upload.js';
import { registerMetadataCommands } from './commands/metadata.js';
import { registerQueryCommand } from './commands/query.js';
import { registerUploadsCommand } from './commands/uploads.js';
import { registerGetCommand } from './commands/get.js';
import { registerChannelScanCommand } from './commands/channel-scan.js';

const program = new Command();

program
  .name('geminirag')
  .description('Workspace-based document management and semantic search using Gemini File Search API')
  .version('1.0.0');

registerWorkspaceCommands(program);
registerUploadCommand(program);
registerMetadataCommands(program);
registerQueryCommand(program);
registerUploadsCommand(program);
registerGetCommand(program);
registerChannelScanCommand(program);

// Global error handler for unhandled rejections
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});

program.parse(process.argv);

import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import { query } from '../services/file-search.js';
import { getWorkspace } from '../services/registry.js';
import { formatQueryResult } from '../utils/format.js';
import { parseFilter, buildMetadataFilter, findUploadByDocumentUri, passesClientFilters } from '../utils/filters.js';
import type { ParsedFilter, QueryResult } from '../types/index.js';

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
          const config = loadConfig();
          const ai = createGeminiClient(config);

          // Collect all workspace names
          const workspaceNames = [workspace];
          if (options.workspace) {
            workspaceNames.push(...options.workspace);
          }

          // Parse filters into Gemini-side and client-side buckets
          const geminiFilters: ParsedFilter[] = [];
          const clientFilters: ParsedFilter[] = [];

          if (options.filter) {
            for (const filterStr of options.filter) {
              const parsed = parseFilter(filterStr);
              if (parsed.layer === 'gemini') {
                geminiFilters.push(parsed);
              } else {
                clientFilters.push(parsed);
              }
            }
          }

          // Build AIP-160 metadata filter string
          const metadataFilter = buildMetadataFilter(geminiFilters);

          // Resolve store names from registry
          const storeNames: string[] = [];
          for (const wsName of workspaceNames) {
            const ws = getWorkspace(wsName);
            storeNames.push(ws.storeName);
          }

          // Execute Gemini query
          const result: QueryResult = await query(
            ai,
            config.geminiModel,
            storeNames,
            question,
            metadataFilter
          );

          // Apply client-side filters to citations
          if (clientFilters.length > 0) {
            result.citations = result.citations.filter((citation) => {
              const localEntry = findUploadByDocumentUri(
                workspaceNames,
                citation.documentUri
              );
              return passesClientFilters(localEntry, clientFilters);
            });
          }

          // Format and display
          console.log(formatQueryResult(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );
}

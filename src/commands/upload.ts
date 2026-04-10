import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import { uploadContent, deleteDocument } from '../services/file-search.js';
import { getWorkspace, addUpload } from '../services/registry.js';
import {
  extractDiskFile,
  extractWebPage,
  extractYouTubeEnhanced,
  extractNote,
} from '../services/content-extractor.js';
import { validateUrl, extractYouTubeVideoId } from '../utils/validation.js';
import type { UploadOptions, CustomMetadataEntry, UploadEntry } from '../types/index.js';

/**
 * Register the upload command with mutually exclusive source options.
 */
export function registerUploadCommand(program: Command): void {
  program
    .command('upload')
    .argument('<workspace>', 'Target workspace name')
    .option('--file <path>', 'Upload from a local file')
    .option('--url <url>', 'Upload from a web page URL')
    .option('--youtube <url>', 'Upload from a YouTube video transcript')
    .option('--note <text>', 'Upload a personal note')
    .option('--with-notes', 'Generate AI notes for YouTube uploads')
    .description('Upload content to a workspace')
    .action(async (workspace: string, options: UploadOptions) => {
      try {
        // Validate exactly one source option is provided
        const sources = [options.file, options.url, options.youtube, options.note].filter(
          (v) => v !== undefined
        );
        if (sources.length === 0) {
          throw new Error('One of --file, --url, --youtube, or --note must be provided');
        }
        if (sources.length > 1) {
          throw new Error('Only one of --file, --url, --youtube, or --note can be provided');
        }

        // Warn if --with-notes is used without --youtube
        if (options.withNotes && !options.youtube) {
          console.warn('Warning: --with-notes is only applicable to YouTube uploads. Flag ignored.');
        }

        // Get workspace from registry (validates it exists)
        const workspaceData = getWorkspace(workspace);

        const config = loadConfig();
        const ai = createGeminiClient(config);

        // Route to appropriate content extractor
        let extracted;
        if (options.file) {
          extracted = await extractDiskFile(options.file);
        } else if (options.url) {
          validateUrl(options.url);
          extracted = await extractWebPage(options.url);
        } else if (options.youtube) {
          // extractYouTubeVideoId validates the URL format
          extractYouTubeVideoId(options.youtube);
          extracted = await extractYouTubeEnhanced(options.youtube, {
            withNotes: options.withNotes,
            ai: options.withNotes ? ai : undefined,
            model: options.withNotes ? config.geminiModel : undefined,
            youtubeApiKey: config.youtubeDataApiKey,
          });
        } else if (options.note) {
          extracted = extractNote(options.note);
        } else {
          throw new Error('One of --file, --url, --youtube, or --note must be provided');
        }

        // Build custom metadata for Gemini
        const customMetadata: CustomMetadataEntry[] = [
          { key: 'source_type', stringValue: extracted.sourceType },
        ];
        if (extracted.sourceUrl !== null) {
          customMetadata.push({ key: 'source_url', stringValue: extracted.sourceUrl });
        }

        // Upload to Gemini File Search Store
        const documentName = await uploadContent(
          ai,
          workspaceData.storeName,
          extracted.content,
          extracted.isFilePath,
          extracted.mimeType,
          extracted.title,
          customMetadata
        );

        // Build upload entry for local registry
        const uploadId = uuidv4();
        const entry: UploadEntry = {
          id: uploadId,
          documentName,
          title: extracted.title,
          timestamp: new Date().toISOString(),
          sourceType: extracted.sourceType,
          sourceUrl: extracted.sourceUrl,
          expirationDate: null,
          flags: [],
          channelTitle: extracted.channelTitle,
          publishedAt: extracted.publishedAt,
        };

        // Register in local registry with rollback on failure
        try {
          addUpload(workspace, entry);
        } catch (registryError) {
          // Registry write failed after Gemini upload succeeded -- attempt cleanup
          try {
            await deleteDocument(ai, documentName);
          } catch {
            console.error(
              'Warning: Failed to clean up Gemini document after registry error'
            );
          }
          throw registryError;
        }

        console.log(`Uploaded: ${extracted.title} (ID: ${uploadId})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

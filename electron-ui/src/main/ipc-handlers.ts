import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';

import { listWorkspaces, getWorkspace, addWorkspace, addUpload, removeUpload, removeWorkspace } from '@cli/services/registry.js';
import { query, getDocumentContent, createStore, deleteStore, uploadContent, deleteDocument } from '@cli/services/file-search.js';
import { extractDiskFile, extractWebPage, extractYouTubeEnhanced, extractNote } from '@cli/services/content-extractor.js';
import { getExpirationIndicator } from '@cli/utils/format.js';
import { extractYouTubeVideoId, validateWorkspaceName, validateUrl, validateDate } from '@cli/utils/validation.js';
import { generateNotes } from '@cli/services/notes-generator.js';
import {
  resolveChannelId,
  getUploadsPlaylistId,
  listChannelVideos,
} from '@cli/services/youtube-data-api.js';
import {
  applyFilters,
  sortUploads,
  findUploadById,
  parseFilter,
  buildMetadataFilter,
  findUploadByDocumentUri,
  passesClientFilters,
} from '@cli/utils/filters.js';
import type { ParsedFilter, CustomMetadataEntry } from '@cli/types/index.js';

import { initialize, getClient, getConfig } from './service-bridge.js';
import type {
  IpcResult,
  WorkspaceSummary,
  WorkspaceDetail,
  QueryInput,
  QueryResultIpc,
  UploadContentResponse,
  DownloadResponse,
  ConfigValidation,
  UploadResultIpc,
} from '../shared/ipc-types.js';
import type { UploadEntry } from '@cli/types/index.js';

// ===== Helper =====

function wrapError(error: unknown): IpcResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, error: message };
}

// ===== Handler Registration =====

export function registerIpcHandlers(): void {
  // --- config:validate ---
  ipcMain.handle('config:validate', async (): Promise<IpcResult<ConfigValidation>> => {
    try {
      return initialize();
    } catch (error) {
      return wrapError(error);
    }
  });

  // --- workspace:list ---
  ipcMain.handle('workspace:list', async (): Promise<IpcResult<WorkspaceSummary[]>> => {
    try {
      const workspaces = listWorkspaces();
      const summaries: WorkspaceSummary[] = workspaces.map((ws) => {
        const uploads = Object.values(ws.uploads);
        const sourceTypeCounts: Record<string, number> = {};
        for (const upload of uploads) {
          sourceTypeCounts[upload.sourceType] = (sourceTypeCounts[upload.sourceType] || 0) + 1;
        }
        return {
          name: ws.name,
          createdAt: ws.createdAt,
          uploadCount: uploads.length,
          sourceTypeCounts,
        };
      });
      return { success: true, data: summaries };
    } catch (error) {
      return wrapError(error);
    }
  });

  // --- workspace:get ---
  ipcMain.handle(
    'workspace:get',
    async (_event, input: { name: string }): Promise<IpcResult<WorkspaceDetail>> => {
      try {
        const ws = getWorkspace(input.name);
        const uploads = Object.values(ws.uploads);

        const sourceTypeCounts: Record<string, number> = {};
        let expiredCount = 0;
        let expiringSoonCount = 0;

        for (const upload of uploads) {
          sourceTypeCounts[upload.sourceType] = (sourceTypeCounts[upload.sourceType] || 0) + 1;
          const indicator = getExpirationIndicator(upload.expirationDate);
          if (indicator === '[EXPIRED]') {
            expiredCount++;
          } else if (indicator === '[EXPIRING SOON]') {
            expiringSoonCount++;
          }
        }

        const detail: WorkspaceDetail = {
          name: ws.name,
          createdAt: ws.createdAt,
          uploadCount: uploads.length,
          sourceTypeCounts,
          expiredCount,
          expiringSoonCount,
        };
        return { success: true, data: detail };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:list ---
  ipcMain.handle(
    'upload:list',
    async (
      _event,
      input: { workspace: string; filters?: { key: string; value: string }[]; sort?: string }
    ): Promise<IpcResult<UploadEntry[]>> => {
      try {
        const ws = getWorkspace(input.workspace);
        let uploads = Object.values(ws.uploads);

        if (input.filters && input.filters.length > 0) {
          uploads = applyFilters(uploads, input.filters);
        }

        uploads = sortUploads(uploads, input.sort);

        return { success: true, data: uploads };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:getContent ---
  ipcMain.handle(
    'upload:getContent',
    async (
      _event,
      input: { workspace: string; uploadId: string }
    ): Promise<IpcResult<UploadContentResponse>> => {
      try {
        const ai = getClient();
        const config = getConfig();
        const ws = getWorkspace(input.workspace);

        const upload = findUploadById(ws.uploads, input.uploadId);
        if (!upload) {
          throw new Error(
            `Upload '${input.uploadId}' not found in workspace '${input.workspace}'.`
          );
        }

        console.log(`[upload:getContent] Fetching content for '${upload.title}' from store '${ws.storeName}', doc '${upload.documentName}'`);
        const content = await getDocumentContent(
          ai,
          config.geminiModel,
          ws.storeName,
          upload.documentName,
          upload.title
        );
        console.log(`[upload:getContent] Got ${content.length} chars of content`);

        return {
          success: true,
          data: { metadata: upload, content },
        };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:download ---
  ipcMain.handle(
    'upload:download',
    async (
      _event,
      input: { workspace: string; uploadId: string }
    ): Promise<IpcResult<DownloadResponse>> => {
      try {
        const ai = getClient();
        const config = getConfig();
        const ws = getWorkspace(input.workspace);

        const upload = findUploadById(ws.uploads, input.uploadId);
        if (!upload) {
          throw new Error(
            `Upload '${input.uploadId}' not found in workspace '${input.workspace}'.`
          );
        }

        const content = await getDocumentContent(
          ai,
          config.geminiModel,
          ws.storeName,
          upload.documentName,
          upload.title
        );

        // Show native save dialog
        const result = await dialog.showSaveDialog({
          defaultPath: `${upload.title.replace(/[/\\?%*:|"<>]/g, '_')}.md`,
          filters: [
            { name: 'Markdown Files', extensions: ['md'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          throw new Error('Download cancelled by user.');
        }

        await fs.writeFile(result.filePath, content, 'utf-8');

        return {
          success: true,
          data: { savedPath: result.filePath },
        };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- query:ask ---
  ipcMain.handle(
    'query:ask',
    async (_event, input: QueryInput): Promise<IpcResult<QueryResultIpc>> => {
      try {
        const ai = getClient();
        const config = getConfig();

        // Resolve store names from workspace names
        const storeNames: string[] = [];
        for (const wsName of input.workspaces) {
          const ws = getWorkspace(wsName);
          storeNames.push(ws.storeName);
        }

        // Parse Gemini-side filters and build AIP-160 metadata filter string
        const geminiParsed: ParsedFilter[] = [];
        if (input.geminiFilters) {
          for (const f of input.geminiFilters) {
            geminiParsed.push(parseFilter(`${f.key}=${f.value}`));
          }
        }
        const metadataFilter = buildMetadataFilter(geminiParsed);

        // Parse client-side filters
        const clientParsed: ParsedFilter[] = [];
        if (input.clientFilters) {
          for (const f of input.clientFilters) {
            clientParsed.push(parseFilter(`${f.key}=${f.value}`));
          }
        }

        // Execute Gemini query
        const queryResult = await query(
          ai,
          config.geminiModel,
          storeNames,
          input.question,
          metadataFilter
        );

        // Apply client-side filters to citations
        let filteredCitations = queryResult.citations;
        if (clientParsed.length > 0) {
          filteredCitations = queryResult.citations.filter((citation) => {
            const localEntry = findUploadByDocumentUri(
              input.workspaces,
              citation.documentUri
            );
            return passesClientFilters(localEntry, clientParsed);
          });
        }

        // Map to IPC citation format
        const ipcResult: QueryResultIpc = {
          answer: queryResult.answer,
          citations: filteredCitations.map((c) => ({
            title: c.documentTitle,
            uri: c.documentUri,
            excerpt: c.text,
          })),
        };

        return { success: true, data: ipcResult };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- youtube:getTranscript ---
  ipcMain.handle(
    'youtube:getTranscript',
    async (_event, input: { url: string }): Promise<IpcResult<string>> => {
      try {
        const videoId = extractYouTubeVideoId(input.url);

        // youtube-transcript-plus is marked external in electron.vite.config.ts,
        // so require() resolves it from the parent project's node_modules at runtime
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { YoutubeTranscript } = require('youtube-transcript-plus') as {
          YoutubeTranscript: { fetchTranscript: (id: string) => Promise<Array<{ text: string; offset: number; duration: number }>> }
        };

        const items = await YoutubeTranscript.fetchTranscript(videoId);
        if (!items || items.length === 0) {
          return { success: false, error: 'Transcript is empty or not available for this video.' };
        }

        // Decode HTML entities
        function decodeHtml(text: string): string {
          return text
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));
        }

        // Format seconds as MM:SS or H:MM:SS
        function formatTime(seconds: number): string {
          const h = Math.floor(seconds / 3600);
          const m = Math.floor((seconds % 3600) / 60);
          const s = Math.floor(seconds % 60);
          if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          }
          return `${m}:${String(s).padStart(2, '0')}`;
        }

        // Build transcript with paragraph breaks at natural pauses and timestamp headers
        const paragraphs: string[] = [];
        let currentParagraph: string[] = [];
        let paragraphStartTime = items[0].offset;

        for (let i = 0; i < items.length; i++) {
          currentParagraph.push(decodeHtml(items[i].text));
          if (i < items.length - 1) {
            const gap = items[i + 1].offset - (items[i].offset + items[i].duration);
            if (gap > 2.0) {
              const timestamp = formatTime(paragraphStartTime);
              paragraphs.push(`[${timestamp}]\n${currentParagraph.join(' ')}`);
              currentParagraph = [];
              paragraphStartTime = items[i + 1].offset;
            }
          }
        }
        if (currentParagraph.length > 0) {
          const timestamp = formatTime(paragraphStartTime);
          paragraphs.push(`[${timestamp}]\n${currentParagraph.join(' ')}`);
        }

        return { success: true, data: paragraphs.join('\n\n') };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- youtube:getNotes ---
  ipcMain.handle(
    'youtube:getNotes',
    async (_event, input: { url: string }): Promise<IpcResult<string>> => {
      try {
        const videoId = extractYouTubeVideoId(input.url);
        const ai = getClient();
        const config = getConfig();

        // youtube-transcript-plus is marked external in electron.vite.config.ts
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { YoutubeTranscript } = require('youtube-transcript-plus') as {
          YoutubeTranscript: { fetchTranscript: (id: string) => Promise<Array<{ text: string; offset: number; duration: number }>> }
        };

        const items = await YoutubeTranscript.fetchTranscript(videoId);
        if (!items || items.length === 0) {
          return { success: false, error: 'Transcript is empty or not available for this video.' };
        }

        const transcript = items.map(i => i.text).join(' ');

        // Fetch video title via oEmbed
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(input.url)}&format=json`;
        const oembedRes = await fetch(oembedUrl);
        const title = oembedRes.ok
          ? ((await oembedRes.json()) as { title: string }).title
          : 'Unknown Video';

        const notes = await generateNotes(ai, config.geminiModel, title, transcript);
        return { success: true, data: notes };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- youtube:getDescription ---
  ipcMain.handle(
    'youtube:getDescription',
    async (_event, input: { url: string }): Promise<IpcResult<string>> => {
      try {
        const videoId = extractYouTubeVideoId(input.url);
        const config = getConfig();

        if (!config.youtubeDataApiKey) {
          return { success: false, error: 'YouTube Data API key is not configured. Set YOUTUBE_DATA_API_KEY to fetch video descriptions.' };
        }

        const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(config.youtubeDataApiKey)}`;
        const ytRes = await fetch(ytUrl);
        if (!ytRes.ok) {
          return { success: false, error: `YouTube API request failed: ${ytRes.status} ${ytRes.statusText}` };
        }

        const ytJson = (await ytRes.json()) as { items?: Array<{ snippet?: { description?: string } }> };
        const desc = ytJson.items?.[0]?.snippet?.description;
        if (!desc) {
          return { success: false, error: 'No description available for this video.' };
        }

        return { success: true, data: desc };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- shell:openExternal ---
  ipcMain.handle(
    'shell:openExternal',
    async (_event, input: { url: string }): Promise<IpcResult<void>> => {
      try {
        // Validate URL protocol to prevent command injection
        const parsed = new URL(input.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error(`Refusing to open URL with unsafe protocol: ${parsed.protocol}`);
        }
        await shell.openExternal(input.url);
        return { success: true, data: undefined };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- workspace:create ---
  ipcMain.handle(
    'workspace:create',
    async (_event, input: { name: string }): Promise<IpcResult<{ name: string; storeName: string }>> => {
      try {
        validateWorkspaceName(input.name);

        const workspaces = listWorkspaces();
        if (workspaces.length >= 10) {
          throw new Error('Maximum 10 workspaces allowed. Please delete an existing workspace first.');
        }

        const existing = workspaces.find((ws) => ws.name === input.name);
        if (existing) {
          throw new Error(`Workspace '${input.name}' already exists.`);
        }

        const ai = getClient();
        const storeName = await createStore(ai, input.name);

        try {
          addWorkspace(input.name, storeName);
        } catch (registryError) {
          // Rollback: delete the store that was just created
          try {
            await deleteStore(ai, storeName);
          } catch {
            // Best-effort rollback
          }
          throw registryError;
        }

        return { success: true, data: { name: input.name, storeName } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- workspace:delete ---
  ipcMain.handle(
    'workspace:delete',
    async (_event, input: { name: string }): Promise<IpcResult<void>> => {
      try {
        const ai = getClient();
        const ws = getWorkspace(input.name);

        // Delete the Gemini File Search store (cascades to all documents)
        await deleteStore(ai, ws.storeName);

        // Remove from local registry
        removeWorkspace(input.name);

        return { success: true, data: undefined };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- dialog:openFile ---
  ipcMain.handle(
    'dialog:openFile',
    async (): Promise<IpcResult<{ filePath: string; fileName: string } | null>> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [
            {
              name: 'Supported Files',
              extensions: [
                'pdf', 'txt', 'md', 'html', 'csv',
                'doc', 'docx', 'xls', 'xlsx', 'pptx',
                'json', 'sql', 'py', 'js', 'java', 'c', 'zip',
              ],
            },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: true, data: null };
        }

        const filePath = result.filePaths[0];
        return { success: true, data: { filePath, fileName: path.basename(filePath) } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:file ---
  ipcMain.handle(
    'upload:file',
    async (_event, input: { workspace: string; filePath: string }): Promise<IpcResult<UploadResultIpc>> => {
      try {
        const ai = getClient();
        const ws = getWorkspace(input.workspace);

        const extracted = await extractDiskFile(input.filePath);

        const customMetadata: CustomMetadataEntry[] = [
          { key: 'source_type', stringValue: 'file' },
          { key: 'source_url', stringValue: input.filePath },
        ];

        const docName = await uploadContent(
          ai, ws.storeName, extracted.content, extracted.isFilePath,
          extracted.mimeType, extracted.title, customMetadata
        );

        const id = uuidv4();
        const entry: UploadEntry = {
          id,
          documentName: docName,
          title: extracted.title,
          timestamp: new Date().toISOString(),
          sourceType: 'file',
          sourceUrl: input.filePath,
          expirationDate: null,
          flags: [],
        };

        try {
          addUpload(input.workspace, entry);
        } catch (registryError) {
          try { await deleteDocument(ai, docName); } catch { /* best-effort */ }
          throw registryError;
        }

        return { success: true, data: { id, title: extracted.title, sourceType: 'file' } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:url ---
  ipcMain.handle(
    'upload:url',
    async (_event, input: { workspace: string; url: string }): Promise<IpcResult<UploadResultIpc>> => {
      try {
        validateUrl(input.url);
        const ai = getClient();
        const ws = getWorkspace(input.workspace);

        const extracted = await extractWebPage(input.url);

        const customMetadata: CustomMetadataEntry[] = [
          { key: 'source_type', stringValue: 'web' },
          { key: 'source_url', stringValue: input.url },
        ];

        const docName = await uploadContent(
          ai, ws.storeName, extracted.content, false,
          extracted.mimeType, extracted.title, customMetadata
        );

        const id = uuidv4();
        const entry: UploadEntry = {
          id,
          documentName: docName,
          title: extracted.title,
          timestamp: new Date().toISOString(),
          sourceType: 'web',
          sourceUrl: input.url,
          expirationDate: null,
          flags: [],
        };

        try {
          addUpload(input.workspace, entry);
        } catch (registryError) {
          try { await deleteDocument(ai, docName); } catch { /* best-effort */ }
          throw registryError;
        }

        return { success: true, data: { id, title: extracted.title, sourceType: 'web' } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:youtube ---
  ipcMain.handle(
    'upload:youtube',
    async (_event, input: { workspace: string; url: string; withNotes: boolean }): Promise<IpcResult<UploadResultIpc>> => {
      try {
        extractYouTubeVideoId(input.url); // validates URL
        const ai = getClient();
        const config = getConfig();
        const ws = getWorkspace(input.workspace);

        const extracted = await extractYouTubeEnhanced(input.url, {
          withNotes: input.withNotes,
          ai,
          model: config.geminiModel,
          youtubeApiKey: config.youtubeDataApiKey,
        });

        const customMetadata: CustomMetadataEntry[] = [
          { key: 'source_type', stringValue: 'youtube' },
          { key: 'source_url', stringValue: input.url },
        ];

        const docName = await uploadContent(
          ai, ws.storeName, extracted.content, false,
          extracted.mimeType, extracted.title, customMetadata
        );

        const id = uuidv4();
        const entry: UploadEntry = {
          id,
          documentName: docName,
          title: extracted.title,
          timestamp: new Date().toISOString(),
          sourceType: 'youtube',
          sourceUrl: input.url,
          expirationDate: null,
          flags: [],
          channelTitle: extracted.channelTitle,
          publishedAt: extracted.publishedAt,
        };

        try {
          addUpload(input.workspace, entry);
        } catch (registryError) {
          try { await deleteDocument(ai, docName); } catch { /* best-effort */ }
          throw registryError;
        }

        return { success: true, data: { id, title: extracted.title, sourceType: 'youtube' } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:note ---
  ipcMain.handle(
    'upload:note',
    async (_event, input: { workspace: string; text: string }): Promise<IpcResult<UploadResultIpc>> => {
      try {
        const extracted = extractNote(input.text);
        const ai = getClient();
        const ws = getWorkspace(input.workspace);

        const customMetadata: CustomMetadataEntry[] = [
          { key: 'source_type', stringValue: 'note' },
        ];

        const docName = await uploadContent(
          ai, ws.storeName, extracted.content, false,
          extracted.mimeType, extracted.title, customMetadata
        );

        const id = uuidv4();
        const entry: UploadEntry = {
          id,
          documentName: docName,
          title: extracted.title,
          timestamp: new Date().toISOString(),
          sourceType: 'note',
          sourceUrl: null,
          expirationDate: null,
          flags: [],
        };

        try {
          addUpload(input.workspace, entry);
        } catch (registryError) {
          try { await deleteDocument(ai, docName); } catch { /* best-effort */ }
          throw registryError;
        }

        return { success: true, data: { id, title: extracted.title, sourceType: 'note' } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- upload:delete ---
  ipcMain.handle(
    'upload:delete',
    async (
      _event,
      input: { workspace: string; uploadId: string }
    ): Promise<IpcResult<void>> => {
      try {
        const ai = getClient();
        const ws = getWorkspace(input.workspace);

        const upload = findUploadById(ws.uploads, input.uploadId);
        if (!upload) {
          throw new Error(
            `Upload '${input.uploadId}' not found in workspace '${input.workspace}'.`
          );
        }

        // Delete from Gemini
        await deleteDocument(ai, upload.documentName);

        // Remove from local registry
        removeUpload(input.workspace, input.uploadId);

        return { success: true, data: undefined };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- config:get ---
  ipcMain.handle(
    'config:get',
    async (): Promise<IpcResult<{ filePath: string; config: Record<string, string> }>> => {
      try {
        const configFilePath = path.join(os.homedir(), '.geminirag', 'config.json');
        let config: Record<string, string> = {};
        try {
          const raw = await fs.readFile(configFilePath, 'utf-8');
          config = JSON.parse(raw);
        } catch {
          // File doesn't exist or is invalid — return empty config
        }
        return { success: true, data: { filePath: configFilePath, config } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- config:save ---
  ipcMain.handle(
    'config:save',
    async (
      _event,
      input: { config: Record<string, string> }
    ): Promise<IpcResult<void>> => {
      try {
        const configDir = path.join(os.homedir(), '.geminirag');
        await fs.mkdir(configDir, { recursive: true });
        const configFilePath = path.join(configDir, 'config.json');
        await fs.writeFile(configFilePath, JSON.stringify(input.config, null, 2), 'utf-8');

        // Re-initialize service bridge to pick up new config
        initialize();

        return { success: true, data: undefined };
      } catch (error) {
        return wrapError(error);
      }
    }
  );

  // --- youtube:channelScan ---
  ipcMain.handle(
    'youtube:channelScan',
    async (
      _event,
      input: { workspace: string; channel: string; fromDate: string; toDate: string; withNotes: boolean }
    ): Promise<IpcResult<{ uploaded: number; failed: number; errors: string[] }>> => {
      try {
        const ai = getClient();
        const config = getConfig();

        if (!config.youtubeDataApiKey) {
          throw new Error(
            'YOUTUBE_DATA_API_KEY is required for channel-scan but was not set.\n' +
            'Obtain your API key from: https://console.cloud.google.com/apis/credentials\n' +
            'Set it in ~/.geminirag/config.json or as an environment variable.'
          );
        }
        const apiKey = config.youtubeDataApiKey;

        // Validate dates
        validateDate(input.fromDate);
        validateDate(input.toDate);

        // Verify workspace exists
        const ws = getWorkspace(input.workspace);

        // Resolve channel
        console.log(`[youtube:channelScan] Resolving channel: ${input.channel}...`);
        const { channelId, channelTitle } = await resolveChannelId(apiKey, input.channel);

        // Get uploads playlist
        const playlistId = await getUploadsPlaylistId(apiKey, channelId);

        // List videos in date range
        console.log(`[youtube:channelScan] Fetching videos from ${input.fromDate} to ${input.toDate}...`);
        const fromDateISO = input.fromDate + 'T00:00:00Z';
        const toDateISO = input.toDate + 'T23:59:59Z';
        const videos = await listChannelVideos(apiKey, playlistId, fromDateISO, toDateISO);

        console.log(`[youtube:channelScan] Found ${videos.length} videos from "${channelTitle}"`);

        let uploaded = 0;
        let failed = 0;
        const errors: string[] = [];

        // Process each video sequentially
        for (let i = 0; i < videos.length; i++) {
          const video = videos[i];
          const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

          console.log(`[youtube:channelScan] [${i + 1}/${videos.length}] Processing: ${video.title}`);

          try {
            // Extract content
            const extracted = await extractYouTubeEnhanced(videoUrl, {
              metadata: video,
              withNotes: input.withNotes,
              ai: input.withNotes ? ai : undefined,
              model: input.withNotes ? config.geminiModel : undefined,
            });

            // Build custom metadata
            const customMetadata: CustomMetadataEntry[] = [
              { key: 'source_type', stringValue: 'youtube' },
              { key: 'source_url', stringValue: videoUrl },
            ];

            // Upload to Gemini File Search Store
            const documentName = await uploadContent(
              ai,
              ws.storeName,
              extracted.content,
              extracted.isFilePath,
              extracted.mimeType,
              extracted.title,
              customMetadata
            );

            // Register in local registry
            const uploadId = uuidv4();
            const entry: UploadEntry = {
              id: uploadId,
              documentName,
              title: extracted.title,
              timestamp: new Date().toISOString(),
              sourceType: 'youtube',
              sourceUrl: videoUrl,
              expirationDate: null,
              flags: [],
              channelTitle: video.channelTitle,
              publishedAt: video.publishedAt,
            };
            addUpload(input.workspace, entry);

            console.log(`[youtube:channelScan]   Uploaded: ${extracted.title} (ID: ${uploadId})`);
            uploaded++;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[youtube:channelScan]   Failed: "${video.title}": ${message}`);
            failed++;
            errors.push(`${video.title}: ${message}`);
          }

          // Rate limiting between videos (skip after last video)
          if (i < videos.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1000));
          }
        }

        return { success: true, data: { uploaded, failed, errors } };
      } catch (error) {
        return wrapError(error);
      }
    }
  );
}

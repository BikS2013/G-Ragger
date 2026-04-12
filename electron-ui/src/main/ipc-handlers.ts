import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createWorkspace,
  deleteWorkspace,
  listAllWorkspaces,
  getWorkspaceDetail,
} from '@cli/operations/workspace-ops.js';
import {
  uploadFile,
  uploadUrl,
  uploadYoutube,
  uploadNote,
  deleteUpload,
  listUploads,
  getUploadContent,
} from '@cli/operations/upload-ops.js';
import { queryWorkspacesSplit } from '@cli/operations/query-ops.js';
import {
  getTranscript,
  getNotes,
  getDescription,
  channelScan,
} from '@cli/operations/youtube-ops.js';
import { getConfigFile, saveConfigFile } from '@cli/operations/config-ops.js';

import { initialize, getContext } from './service-bridge.js';
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

async function wrap<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    return wrapError(error);
  }
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
  ipcMain.handle('workspace:list', () =>
    wrap<WorkspaceSummary[]>(() => listAllWorkspaces())
  );

  // --- workspace:get ---
  ipcMain.handle('workspace:get', (_event, input: { name: string }) =>
    wrap<WorkspaceDetail>(() => getWorkspaceDetail(input.name))
  );

  // --- workspace:create ---
  ipcMain.handle('workspace:create', (_event, input: { name: string }) =>
    wrap(async () => {
      const ctx = getContext();
      return createWorkspace(ctx, input.name);
    })
  );

  // --- workspace:delete ---
  ipcMain.handle('workspace:delete', (_event, input: { name: string }) =>
    wrap(async () => {
      const ctx = getContext();
      await deleteWorkspace(ctx, input.name);
    })
  );

  // --- upload:list ---
  ipcMain.handle(
    'upload:list',
    (
      _event,
      input: { workspace: string; filters?: { key: string; value: string }[]; sort?: string }
    ) =>
      wrap<UploadEntry[]>(() =>
        listUploads(input.workspace, input.filters, input.sort)
      )
  );

  // --- upload:getContent ---
  ipcMain.handle(
    'upload:getContent',
    (_event, input: { workspace: string; uploadId: string }) =>
      wrap<UploadContentResponse>(async () => {
        const ctx = getContext();
        return getUploadContent(ctx, input.workspace, input.uploadId);
      })
  );

  // --- upload:download ---
  ipcMain.handle(
    'upload:download',
    (_event, input: { workspace: string; uploadId: string }) =>
      wrap<DownloadResponse>(async () => {
        const ctx = getContext();
        const { metadata, content } = await getUploadContent(
          ctx,
          input.workspace,
          input.uploadId
        );

        const result = await dialog.showSaveDialog({
          defaultPath: `${metadata.title.replace(/[/\\?%*:|"<>]/g, '_')}.md`,
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
        return { savedPath: result.filePath };
      })
  );

  // --- upload:file ---
  ipcMain.handle(
    'upload:file',
    (_event, input: { workspace: string; filePath: string }) =>
      wrap<UploadResultIpc>(async () => {
        const ctx = getContext();
        return uploadFile(ctx, input.workspace, input.filePath);
      })
  );

  // --- upload:url ---
  ipcMain.handle(
    'upload:url',
    (_event, input: { workspace: string; url: string }) =>
      wrap<UploadResultIpc>(async () => {
        const ctx = getContext();
        return uploadUrl(ctx, input.workspace, input.url);
      })
  );

  // --- upload:youtube ---
  ipcMain.handle(
    'upload:youtube',
    (_event, input: { workspace: string; url: string; withNotes: boolean }) =>
      wrap<UploadResultIpc>(async () => {
        const ctx = getContext();
        return uploadYoutube(ctx, input.workspace, input.url, input.withNotes);
      })
  );

  // --- upload:note ---
  ipcMain.handle(
    'upload:note',
    (_event, input: { workspace: string; text: string }) =>
      wrap<UploadResultIpc>(async () => {
        const ctx = getContext();
        return uploadNote(ctx, input.workspace, input.text);
      })
  );

  // --- upload:delete ---
  ipcMain.handle(
    'upload:delete',
    (_event, input: { workspace: string; uploadId: string }) =>
      wrap(async () => {
        const ctx = getContext();
        await deleteUpload(ctx, input.workspace, input.uploadId);
      })
  );

  // --- query:ask ---
  ipcMain.handle('query:ask', (_event, input: QueryInput) =>
    wrap<QueryResultIpc>(async () => {
      const ctx = getContext();
      return queryWorkspacesSplit(
        ctx,
        input.workspaces,
        input.question,
        input.geminiFilters,
        input.clientFilters
      );
    })
  );

  // --- youtube:getTranscript ---
  ipcMain.handle(
    'youtube:getTranscript',
    (_event, input: { url: string }) =>
      wrap(() => getTranscript(input.url))
  );

  // --- youtube:getNotes ---
  ipcMain.handle(
    'youtube:getNotes',
    (_event, input: { url: string }) =>
      wrap(async () => {
        const ctx = getContext();
        return getNotes(ctx, input.url);
      })
  );

  // --- youtube:getDescription ---
  ipcMain.handle(
    'youtube:getDescription',
    (_event, input: { url: string }) =>
      wrap(async () => {
        const ctx = getContext();
        return getDescription(ctx, input.url);
      })
  );

  // --- youtube:channelScan ---
  ipcMain.handle(
    'youtube:channelScan',
    (
      _event,
      input: {
        workspace: string;
        channel: string;
        fromDate: string;
        toDate: string;
        withNotes: boolean;
      }
    ) =>
      wrap<{ uploaded: number; failed: number; errors: string[] }>(async () => {
        const ctx = getContext();
        const { result } = await channelScan(
          ctx,
          input.workspace,
          input.channel,
          input.fromDate,
          input.toDate,
          { withNotes: input.withNotes, continueOnError: true },
          {
            onProcessing: (i, total, title) =>
              console.log(`[youtube:channelScan] [${i}/${total}] Processing: ${title}`),
            onUploaded: (title, id) =>
              console.log(`[youtube:channelScan]   Uploaded: ${title} (ID: ${id})`),
            onFailed: (title, error) =>
              console.warn(`[youtube:channelScan]   Failed: "${title}": ${error}`),
          }
        );
        return {
          uploaded: result.uploaded,
          failed: result.failed,
          errors: result.errors.map((e) => `${e.title}: ${e.error}`),
        };
      })
  );

  // --- dialog:openFile ---
  ipcMain.handle(
    'dialog:openFile',
    () =>
      wrap(async () => {
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
          return null;
        }

        const filePath = result.filePaths[0];
        return { filePath, fileName: path.basename(filePath) };
      })
  );

  // --- config:get ---
  ipcMain.handle('config:get', () => wrap(() => getConfigFile()));

  // --- config:save ---
  ipcMain.handle(
    'config:save',
    (_event, input: { config: Record<string, string> }) =>
      wrap(async () => {
        await saveConfigFile(input.config);
        initialize(); // Re-initialize to pick up new config
      })
  );

  // --- shell:openExternal ---
  ipcMain.handle(
    'shell:openExternal',
    (_event, input: { url: string }) =>
      wrap(async () => {
        const parsed = new URL(input.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error(`Refusing to open URL with unsafe protocol: ${parsed.protocol}`);
        }
        await shell.openExternal(input.url);
      })
  );
}

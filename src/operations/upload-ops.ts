import { v4 as uuidv4 } from 'uuid';
import type { AppContext } from './context.js';
import { uploadContent, deleteDocument, getDocumentContent } from '../services/file-search.js';
import { getWorkspace, addUpload, removeUpload } from '../services/registry.js';
import {
  extractDiskFile,
  extractWebPage,
  extractYouTubeEnhanced,
  extractNote,
} from '../services/content-extractor.js';
import { validateUrl, extractYouTubeVideoId } from '../utils/validation.js';
import { applyFilters, sortUploads, findUploadById } from '../utils/filters.js';
import type { UploadEntry, CustomMetadataEntry, ExtractedContent } from '../types/index.js';

// ===== Result Types =====

export interface UploadResult {
  id: string;
  title: string;
  sourceType: string;
}

export interface UploadContentResult {
  metadata: UploadEntry;
  content: string;
}

// ===== Internal Helpers =====

/**
 * Common upload pipeline: upload to Gemini, register in registry, rollback on failure.
 */
async function performUpload(
  ctx: AppContext,
  workspace: string,
  extracted: ExtractedContent
): Promise<UploadResult> {
  const ws = getWorkspace(workspace);

  const customMetadata: CustomMetadataEntry[] = [
    { key: 'source_type', stringValue: extracted.sourceType },
  ];
  if (extracted.sourceUrl !== null) {
    customMetadata.push({ key: 'source_url', stringValue: extracted.sourceUrl });
  }

  const docName = await uploadContent(
    ctx.client,
    ws.storeName,
    extracted.content,
    extracted.isFilePath,
    extracted.mimeType,
    extracted.title,
    customMetadata
  );

  const id = uuidv4();
  const entry: UploadEntry = {
    id,
    documentName: docName,
    title: extracted.title,
    timestamp: new Date().toISOString(),
    sourceType: extracted.sourceType,
    sourceUrl: extracted.sourceUrl,
    expirationDate: null,
    flags: [],
    channelTitle: extracted.channelTitle,
    publishedAt: extracted.publishedAt,
  };

  try {
    addUpload(workspace, entry);
  } catch (registryError) {
    try {
      await deleteDocument(ctx.client, docName);
    } catch {
      // Best-effort rollback
    }
    throw registryError;
  }

  return { id, title: extracted.title, sourceType: extracted.sourceType };
}

// ===== Operations =====

/**
 * Upload a local file to a workspace.
 */
export async function uploadFile(
  ctx: AppContext,
  workspace: string,
  filePath: string
): Promise<UploadResult> {
  const extracted = await extractDiskFile(filePath);
  return performUpload(ctx, workspace, extracted);
}

/**
 * Upload web page content to a workspace.
 */
export async function uploadUrl(
  ctx: AppContext,
  workspace: string,
  url: string
): Promise<UploadResult> {
  validateUrl(url);
  const extracted = await extractWebPage(url);
  return performUpload(ctx, workspace, extracted);
}

/**
 * Upload YouTube video transcript to a workspace.
 */
export async function uploadYoutube(
  ctx: AppContext,
  workspace: string,
  url: string,
  withNotes: boolean
): Promise<UploadResult> {
  extractYouTubeVideoId(url); // validates URL
  const extracted = await extractYouTubeEnhanced(url, {
    withNotes,
    ai: withNotes ? ctx.client : undefined,
    model: withNotes ? ctx.config.geminiModel : undefined,
    youtubeApiKey: ctx.config.youtubeDataApiKey,
  });
  return performUpload(ctx, workspace, extracted);
}

/**
 * Upload a personal note to a workspace.
 */
export async function uploadNote(
  ctx: AppContext,
  workspace: string,
  text: string
): Promise<UploadResult> {
  const extracted = extractNote(text);
  return performUpload(ctx, workspace, extracted);
}

/**
 * Delete an upload from Gemini and local registry.
 */
export async function deleteUpload(
  ctx: AppContext,
  workspace: string,
  uploadId: string
): Promise<void> {
  const ws = getWorkspace(workspace);
  const upload = findUploadById(ws.uploads, uploadId);
  if (!upload) {
    throw new Error(
      `Upload '${uploadId}' not found in workspace '${workspace}'.`
    );
  }
  await deleteDocument(ctx.client, upload.documentName);
  removeUpload(workspace, upload.id);
}

/**
 * List uploads in a workspace with optional filters and sorting.
 */
export function listUploads(
  workspace: string,
  filters?: { key: string; value: string }[],
  sort?: string
): UploadEntry[] {
  const ws = getWorkspace(workspace);
  let uploads = Object.values(ws.uploads);

  if (filters && filters.length > 0) {
    uploads = applyFilters(uploads, filters);
  }

  uploads = sortUploads(uploads, sort);
  return uploads;
}

/**
 * Retrieve the content of an upload from Gemini.
 */
export async function getUploadContent(
  ctx: AppContext,
  workspace: string,
  uploadId: string
): Promise<UploadContentResult> {
  const ws = getWorkspace(workspace);
  const upload = findUploadById(ws.uploads, uploadId);
  if (!upload) {
    throw new Error(
      `Upload '${uploadId}' not found in workspace '${workspace}'.`
    );
  }

  const content = await getDocumentContent(
    ctx.client,
    ctx.config.geminiModel,
    ws.storeName,
    upload.documentName,
    upload.title
  );

  return { metadata: upload, content };
}

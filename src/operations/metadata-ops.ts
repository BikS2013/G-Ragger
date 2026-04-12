import type { AppContext } from './context.js';
import { deleteDocument } from '../services/file-search.js';
import { getWorkspace, updateUpload, removeUpload } from '../services/registry.js';
import { validateDate, validateFlags, validateTags } from '../utils/validation.js';
import type { Flag } from '../types/index.js';

/**
 * Update the title of an upload.
 */
export function updateTitle(
  workspace: string,
  uploadId: string,
  title: string
): void {
  getWorkspace(workspace); // validates existence
  updateUpload(workspace, uploadId, { title });
}

/**
 * Remove an upload from Gemini and local registry.
 */
export async function removeUploadEntry(
  ctx: AppContext,
  workspace: string,
  uploadId: string
): Promise<void> {
  const ws = getWorkspace(workspace);
  const upload = ws.uploads[uploadId];
  if (!upload) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
  }

  await deleteDocument(ctx.client, upload.documentName);
  removeUpload(workspace, uploadId);
}

/**
 * Set an expiration date on an upload.
 */
export function setExpiration(
  workspace: string,
  uploadId: string,
  date: string
): void {
  validateDate(date);
  getWorkspace(workspace);
  updateUpload(workspace, uploadId, { expirationDate: date });
}

/**
 * Clear the expiration date from an upload.
 */
export function clearExpiration(
  workspace: string,
  uploadId: string
): void {
  getWorkspace(workspace);
  updateUpload(workspace, uploadId, { expirationDate: null });
}

/**
 * Add or remove flags on an upload.
 * Returns the updated flags array.
 */
export function updateFlags(
  workspace: string,
  uploadId: string,
  add?: string[],
  remove?: string[]
): Flag[] {
  if (!add && !remove) {
    throw new Error('At least one of --add or --remove must be provided');
  }

  if (add) validateFlags(add);
  if (remove) validateFlags(remove);

  const ws = getWorkspace(workspace);
  const upload = ws.uploads[uploadId];
  if (!upload) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
  }

  let currentFlags: Flag[] = [...upload.flags];

  if (add) {
    for (const flag of add as Flag[]) {
      if (!currentFlags.includes(flag)) {
        currentFlags.push(flag);
      }
    }
  }

  if (remove) {
    const toRemove = new Set(remove as Flag[]);
    currentFlags = currentFlags.filter((f) => !toRemove.has(f));
  }

  updateUpload(workspace, uploadId, { flags: currentFlags });
  return currentFlags;
}

/**
 * Add or remove tags on an upload.
 * Tags are validated (trimmed, lowercased, deduplicated).
 * Returns the updated tags array.
 */
export function updateTags(
  workspace: string,
  uploadId: string,
  add?: string[],
  remove?: string[]
): string[] {
  if (!add && !remove) {
    throw new Error('At least one of --add or --remove must be provided');
  }

  const ws = getWorkspace(workspace);
  const upload = ws.uploads[uploadId];
  if (!upload) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
  }

  let currentTags: string[] = [...(upload.tags ?? [])];

  if (add) {
    const normalizedAdd = validateTags(add);
    for (const tag of normalizedAdd) {
      if (!currentTags.includes(tag)) {
        currentTags.push(tag);
      }
    }
  }

  if (remove) {
    const normalizedRemove = validateTags(remove);
    const toRemove = new Set(normalizedRemove);
    currentTags = currentTags.filter((t) => !toRemove.has(t));
  }

  updateUpload(workspace, uploadId, { tags: currentTags });
  return currentTags;
}

/**
 * Get the current tags for an upload.
 */
export function getTags(workspace: string, uploadId: string): string[] {
  const ws = getWorkspace(workspace);
  const upload = ws.uploads[uploadId];
  if (!upload) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
  }
  return upload.tags ?? [];
}

/**
 * List all distinct metadata labels used in a workspace.
 */
export function getLabels(workspace: string): string[] {
  const ws = getWorkspace(workspace);
  const uploads = Object.values(ws.uploads);

  if (uploads.length === 0) {
    return [];
  }

  const labels = new Set<string>();
  for (const upload of uploads) {
    labels.add('title');
    labels.add('source_type');
    if (upload.sourceUrl !== null) labels.add('source_url');
    if (upload.expirationDate !== null) labels.add('expiration_date');
    if (upload.flags.length > 0) labels.add('flags');
    if ((upload.tags ?? []).length > 0) labels.add('tags');
    labels.add('timestamp');
  }

  return Array.from(labels).sort();
}

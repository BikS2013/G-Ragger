import type { AppContext } from './context.js';
import { createStore, deleteStore } from '../services/file-search.js';
import {
  addWorkspace as registryAddWorkspace,
  removeWorkspace as registryRemoveWorkspace,
  getWorkspace as registryGetWorkspace,
  listWorkspaces as registryListWorkspaces,
} from '../services/registry.js';
import { getExpirationIndicator } from '../utils/format.js';
import { validateWorkspaceName } from '../utils/validation.js';
import type { WorkspaceData } from '../types/index.js';

// ===== Result Types =====

export interface WorkspaceSummary {
  name: string;
  createdAt: string;
  uploadCount: number;
  sourceTypeCounts: Record<string, number>;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  expiredCount: number;
  expiringSoonCount: number;
}

// ===== Operations =====

/**
 * Create a new workspace backed by a Gemini File Search Store.
 * Rolls back the store if registry write fails.
 */
export async function createWorkspace(
  ctx: AppContext,
  name: string
): Promise<{ name: string; storeName: string }> {
  validateWorkspaceName(name);

  const existing = registryListWorkspaces();
  if (existing.length >= 10) {
    throw new Error(
      'Maximum 10 workspaces reached (Gemini API limit). Delete a workspace before creating a new one.'
    );
  }

  if (existing.some((ws) => ws.name === name)) {
    throw new Error(`Workspace '${name}' already exists.`);
  }

  const storeName = await createStore(ctx.client, name);

  try {
    registryAddWorkspace(name, storeName);
  } catch (registryError) {
    try {
      await deleteStore(ctx.client, storeName);
    } catch {
      // Best-effort rollback
    }
    throw registryError;
  }

  return { name, storeName };
}

/**
 * Delete a workspace and its Gemini File Search Store.
 */
export async function deleteWorkspace(
  ctx: AppContext,
  name: string
): Promise<void> {
  const ws = registryGetWorkspace(name);
  await deleteStore(ctx.client, ws.storeName);
  registryRemoveWorkspace(name);
}

/**
 * List all workspaces with summary statistics.
 */
export function listAllWorkspaces(): WorkspaceSummary[] {
  const workspaces = registryListWorkspaces();
  return workspaces.map(buildSummary);
}

/**
 * Get detailed workspace information including expiration counts.
 */
export function getWorkspaceDetail(name: string): WorkspaceDetail {
  const ws = registryGetWorkspace(name);
  const summary = buildSummary(ws);
  const uploads = Object.values(ws.uploads);

  let expiredCount = 0;
  let expiringSoonCount = 0;

  for (const upload of uploads) {
    const indicator = getExpirationIndicator(upload.expirationDate);
    if (indicator === '[EXPIRED]') {
      expiredCount++;
    } else if (indicator === '[EXPIRING SOON]') {
      expiringSoonCount++;
    }
  }

  return { ...summary, expiredCount, expiringSoonCount };
}

// ===== Helpers =====

function buildSummary(ws: WorkspaceData): WorkspaceSummary {
  const uploads = Object.values(ws.uploads);
  const sourceTypeCounts: Record<string, number> = {};
  for (const upload of uploads) {
    sourceTypeCounts[upload.sourceType] =
      (sourceTypeCounts[upload.sourceType] || 0) + 1;
  }
  return {
    name: ws.name,
    createdAt: ws.createdAt,
    uploadCount: uploads.length,
    sourceTypeCounts,
  };
}

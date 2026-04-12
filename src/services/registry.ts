import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Registry, WorkspaceData, UploadEntry } from '../types/index.js';

const REGISTRY_DIR = path.join(os.homedir(), '.geminirag');
const REGISTRY_PATH = path.join(REGISTRY_DIR, 'registry.json');
const REGISTRY_TMP_PATH = path.join(REGISTRY_DIR, 'registry.json.tmp');

/**
 * Load the registry from ~/.geminirag/registry.json.
 * Creates the directory and an empty registry file if they don't exist.
 *
 * @returns The current registry state
 */
export function loadRegistry(): Registry {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }

  if (!fs.existsSync(REGISTRY_PATH)) {
    const emptyRegistry: Registry = { workspaces: {} };
    saveRegistry(emptyRegistry);
    return emptyRegistry;
  }

  const data = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(data) as Registry;
}

/**
 * Save the registry atomically (write to .tmp, rename).
 *
 * @param registry - The complete registry state to save
 */
export function saveRegistry(registry: Registry): void {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }

  const json = JSON.stringify(registry, null, 2);
  fs.writeFileSync(REGISTRY_TMP_PATH, json, 'utf-8');
  fs.renameSync(REGISTRY_TMP_PATH, REGISTRY_PATH);
}

/**
 * Add a workspace to the registry.
 *
 * @param name - Workspace name (must not already exist)
 * @param storeName - Gemini File Search Store resource name
 * @throws Error if workspace name already exists
 */
export function addWorkspace(name: string, storeName: string): void {
  const registry = loadRegistry();

  if (registry.workspaces[name]) {
    throw new Error(`Workspace '${name}' already exists`);
  }

  const workspace: WorkspaceData = {
    name,
    storeName,
    createdAt: new Date().toISOString(),
    uploads: {},
  };

  registry.workspaces[name] = workspace;
  saveRegistry(registry);
}

/**
 * Remove a workspace and all its uploads from the registry.
 *
 * @param name - Workspace name
 * @throws Error if workspace not found
 */
export function removeWorkspace(name: string): void {
  const registry = loadRegistry();

  if (!registry.workspaces[name]) {
    throw new Error(`Workspace '${name}' not found`);
  }

  delete registry.workspaces[name];
  saveRegistry(registry);
}

/**
 * Get a workspace by name.
 *
 * @param name - Workspace name
 * @returns WorkspaceData object
 * @throws Error if workspace not found
 */
export function getWorkspace(name: string): WorkspaceData {
  const registry = loadRegistry();

  if (!registry.workspaces[name]) {
    throw new Error(`Workspace '${name}' not found`);
  }

  return registry.workspaces[name];
}

/**
 * List all workspaces.
 *
 * @returns Array of WorkspaceData objects
 */
export function listWorkspaces(): WorkspaceData[] {
  const registry = loadRegistry();
  return Object.values(registry.workspaces);
}

/**
 * Add an upload entry to a workspace.
 *
 * @param workspaceName - Target workspace
 * @param entry - Complete UploadEntry object
 * @throws Error if workspace not found
 */
export function addUpload(workspaceName: string, entry: UploadEntry): void {
  const registry = loadRegistry();

  if (!registry.workspaces[workspaceName]) {
    throw new Error(`Workspace '${workspaceName}' not found`);
  }

  registry.workspaces[workspaceName].uploads[entry.id] = entry;
  saveRegistry(registry);
}

/**
 * Remove an upload entry from a workspace.
 *
 * @param workspaceName - Target workspace
 * @param uploadId - Upload UUID to remove
 * @throws Error if workspace or upload not found
 */
export function removeUpload(workspaceName: string, uploadId: string): void {
  const registry = loadRegistry();

  if (!registry.workspaces[workspaceName]) {
    throw new Error(`Workspace '${workspaceName}' not found`);
  }

  if (!registry.workspaces[workspaceName].uploads[uploadId]) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspaceName}'`);
  }

  delete registry.workspaces[workspaceName].uploads[uploadId];
  saveRegistry(registry);
}

/**
 * Partially update an upload entry.
 *
 * @param workspaceName - Target workspace
 * @param uploadId - Upload UUID to update
 * @param updates - Partial UploadEntry with fields to update
 * @throws Error if workspace or upload not found
 */
export function updateUpload(
  workspaceName: string,
  uploadId: string,
  updates: Partial<Pick<UploadEntry, 'title' | 'expirationDate' | 'flags' | 'tags'>>
): void {
  const registry = loadRegistry();

  if (!registry.workspaces[workspaceName]) {
    throw new Error(`Workspace '${workspaceName}' not found`);
  }

  if (!registry.workspaces[workspaceName].uploads[uploadId]) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspaceName}'`);
  }

  const upload = registry.workspaces[workspaceName].uploads[uploadId];

  if (updates.title !== undefined) {
    upload.title = updates.title;
  }
  if (updates.expirationDate !== undefined) {
    upload.expirationDate = updates.expirationDate;
  }
  if (updates.flags !== undefined) {
    upload.flags = updates.flags;
  }
  if (updates.tags !== undefined) {
    upload.tags = updates.tags;
  }

  saveRegistry(registry);
}

import type { UploadEntry } from '../../../src/types/index.js';

// ===== IPC Result Wrapper =====

export type IpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ===== Workspace Types =====

export interface WorkspaceSummary {
  name: string;
  createdAt?: string;
  uploadCount: number;
  sourceTypeCounts: Record<string, number>;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  expiredCount: number;
  expiringSoonCount: number;
}

// ===== Config Types =====

export interface ConfigValidation {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

// ===== Query Types =====

export interface QueryInput {
  workspaces: string[];
  question: string;
  geminiFilters?: { key: string; value: string }[];
  clientFilters?: { key: string; value: string }[];
}

export interface QueryResultIpc {
  answer: string;
  citations: { title: string; uri: string; excerpt: string }[];
}

// ===== Upload Result Types =====

export interface UploadResultIpc {
  id: string;
  title: string;
  sourceType: string;
}

// ===== Upload Content Types =====

export interface UploadContentResponse {
  metadata: UploadEntry;
  content: string;
}

export interface DownloadResponse {
  savedPath: string;
}

// ===== IPC Channel Map =====

export interface IpcChannelMap {
  'config:validate': {
    input: void;
    output: ConfigValidation;
  };
  'workspace:list': {
    input: void;
    output: WorkspaceSummary[];
  };
  'workspace:get': {
    input: { name: string };
    output: WorkspaceDetail;
  };
  'upload:list': {
    input: {
      workspace: string;
      filters?: { key: string; value: string }[];
      sort?: string;
    };
    output: UploadEntry[];
  };
  'upload:getContent': {
    input: { workspace: string; uploadId: string };
    output: UploadContentResponse;
  };
  'upload:download': {
    input: { workspace: string; uploadId: string };
    output: DownloadResponse;
  };
  'query:ask': {
    input: QueryInput;
    output: QueryResultIpc;
  };
  'shell:openExternal': {
    input: { url: string };
    output: void;
  };
  'youtube:getTranscript': {
    input: { url: string };
    output: string;
  };
  'youtube:getNotes': {
    input: { url: string };
    output: string;
  };
  'youtube:getDescription': {
    input: { url: string };
    output: string;
  };
  'workspace:create': {
    input: { name: string };
    output: { name: string; storeName: string };
  };
  'workspace:delete': {
    input: { name: string };
    output: void;
  };
  'dialog:openFile': {
    input: void;
    output: { filePath: string; fileName: string } | null;
  };
  'upload:file': {
    input: { workspace: string; filePath: string; tags?: string[] };
    output: UploadResultIpc;
  };
  'upload:url': {
    input: { workspace: string; url: string; tags?: string[] };
    output: UploadResultIpc;
  };
  'upload:youtube': {
    input: { workspace: string; url: string; withNotes: boolean; tags?: string[] };
    output: UploadResultIpc;
  };
  'upload:note': {
    input: { workspace: string; text: string; tags?: string[] };
    output: UploadResultIpc;
  };
  'upload:updateTags': {
    input: { workspace: string; uploadId: string; add?: string[]; remove?: string[] };
    output: string[];
  };
  'youtube:channelScan': {
    input: { workspace: string; channel: string; fromDate: string; toDate: string; withNotes: boolean; tags?: string[] };
    output: { uploaded: number; failed: number; errors: string[] };
  };
  'upload:delete': {
    input: { workspace: string; uploadId: string };
    output: void;
  };
  'config:get': {
    input: void;
    output: { filePath: string; config: Record<string, string> };
  };
  'config:save': {
    input: { config: Record<string, string> };
    output: void;
  };
}

import { ipcRenderer } from 'electron'
import type {
  IpcResult,
  ConfigValidation,
  WorkspaceSummary,
  WorkspaceDetail,
  UploadContentResponse,
  DownloadResponse,
  QueryInput,
  QueryResultIpc,
  UploadResultIpc
} from '../shared/ipc-types'
import type { UploadEntry } from '../../../src/types/index.js'

export const api = {
  config: {
    validate: (): Promise<IpcResult<ConfigValidation>> =>
      ipcRenderer.invoke('config:validate'),
    get: (): Promise<IpcResult<{ filePath: string; config: Record<string, string> }>> =>
      ipcRenderer.invoke('config:get'),
    save: (config: Record<string, string>): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('config:save', { config })
  },
  workspace: {
    list: (): Promise<IpcResult<WorkspaceSummary[]>> =>
      ipcRenderer.invoke('workspace:list'),
    get: (name: string): Promise<IpcResult<WorkspaceDetail>> =>
      ipcRenderer.invoke('workspace:get', { name }),
    create: (name: string): Promise<IpcResult<{ name: string; storeName: string }>> =>
      ipcRenderer.invoke('workspace:create', { name }),
    delete: (name: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('workspace:delete', { name })
  },
  upload: {
    list: (
      workspace: string,
      filters?: { key: string; value: string }[],
      sort?: string
    ): Promise<IpcResult<UploadEntry[]>> =>
      ipcRenderer.invoke('upload:list', { workspace, filters, sort }),
    getContent: (
      workspace: string,
      uploadId: string
    ): Promise<IpcResult<UploadContentResponse>> =>
      ipcRenderer.invoke('upload:getContent', { workspace, uploadId }),
    download: (
      workspace: string,
      uploadId: string
    ): Promise<IpcResult<DownloadResponse>> =>
      ipcRenderer.invoke('upload:download', { workspace, uploadId }),
    uploadFile: (
      workspace: string,
      filePath: string
    ): Promise<IpcResult<UploadResultIpc>> =>
      ipcRenderer.invoke('upload:file', { workspace, filePath }),
    uploadUrl: (
      workspace: string,
      url: string
    ): Promise<IpcResult<UploadResultIpc>> =>
      ipcRenderer.invoke('upload:url', { workspace, url }),
    uploadYoutube: (
      workspace: string,
      url: string,
      withNotes: boolean
    ): Promise<IpcResult<UploadResultIpc>> =>
      ipcRenderer.invoke('upload:youtube', { workspace, url, withNotes }),
    uploadNote: (
      workspace: string,
      text: string
    ): Promise<IpcResult<UploadResultIpc>> =>
      ipcRenderer.invoke('upload:note', { workspace, text }),
    deleteUpload: (
      workspace: string,
      uploadId: string
    ): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('upload:delete', { workspace, uploadId })
  },
  query: {
    ask: (input: QueryInput): Promise<IpcResult<QueryResultIpc>> =>
      ipcRenderer.invoke('query:ask', input)
  },
  youtube: {
    getTranscript: (url: string): Promise<IpcResult<string>> =>
      ipcRenderer.invoke('youtube:getTranscript', { url }),
    getNotes: (url: string): Promise<IpcResult<string>> =>
      ipcRenderer.invoke('youtube:getNotes', { url }),
    getDescription: (url: string): Promise<IpcResult<string>> =>
      ipcRenderer.invoke('youtube:getDescription', { url }),
    channelScan: (
      workspace: string,
      channel: string,
      fromDate: string,
      toDate: string,
      withNotes: boolean
    ): Promise<IpcResult<{ uploaded: number; failed: number; errors: string[] }>> =>
      ipcRenderer.invoke('youtube:channelScan', { workspace, channel, fromDate, toDate, withNotes })
  },
  dialog: {
    openFile: (): Promise<IpcResult<{ filePath: string; fileName: string } | null>> =>
      ipcRenderer.invoke('dialog:openFile')
  },
  shell: {
    openExternal: (url: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('shell:openExternal', { url })
  }
}

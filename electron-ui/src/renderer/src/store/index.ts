import { create } from "zustand"

// ===== Local type mirrors (from shared/ipc-types and CLI types) =====

export type SourceType = "file" | "web" | "youtube" | "note"
export type Flag = "completed" | "urgent" | "inactive"

export interface UploadEntry {
  id: string
  documentName: string
  title: string
  timestamp: string
  sourceType: SourceType
  sourceUrl: string | null
  expirationDate: string | null
  flags: Flag[]
  channelTitle?: string
  publishedAt?: string
}

export interface WorkspaceSummary {
  name: string
  createdAt?: string
  uploadCount: number
  sourceTypeCounts: Record<string, number>
}

export interface QueryResultData {
  answer: string
  citations: { title: string; uri: string; excerpt: string }[]
}

// ===== Helper to call window.api safely =====

function getApi(): typeof window.api {
  return window.api
}

// ===== Store Interface =====

export interface AppStore {
  // Config
  configValid: boolean
  configError: string | null
  configWarnings: string[]
  validateConfig: () => Promise<void>

  // Workspaces
  workspaces: WorkspaceSummary[]
  selectedWorkspace: string | null
  workspacesLoading: boolean
  loadWorkspaces: () => Promise<void>
  selectWorkspace: (name: string) => void

  // Uploads
  uploads: UploadEntry[]
  uploadsLoading: boolean
  uploadFilters: { key: string; value: string }[]
  uploadSort: string
  loadUploads: () => Promise<void>
  setUploadFilters: (filters: { key: string; value: string }[]) => void
  setUploadSort: (sort: string) => void

  // Selected upload
  selectedUpload: UploadEntry | null
  uploadContent: string | null
  contentLoading: boolean
  contentError: string | null
  selectUpload: (upload: UploadEntry) => void
  clearSelectedUpload: () => void
  loadUploadContent: (workspace: string, uploadId: string) => Promise<void>
  downloadUpload: (workspace: string, uploadId: string) => Promise<{ success: boolean; error?: string }>

  // Query
  queryResult: QueryResultData | null
  isQuerying: boolean
  queryError: string | null
  executeQuery: (
    question: string,
    geminiFilters?: { key: string; value: string }[],
    clientFilters?: { key: string; value: string }[]
  ) => Promise<void>
  clearQueryResult: () => void

  // Workspace creation
  isCreatingWorkspace: boolean
  createWorkspaceError: string | null
  createWorkspace: (name: string) => Promise<boolean>
  clearCreateWorkspaceError: () => void

  // Delete
  isDeleting: boolean
  deleteUpload: (uploadId: string) => Promise<boolean>
  deleteWorkspace: (name: string) => Promise<boolean>

  // Upload operations
  isUploading: boolean
  uploadError: string | null
  uploadFile: (filePath: string) => Promise<boolean>
  uploadUrl: (url: string) => Promise<boolean>
  uploadYoutube: (url: string, withNotes: boolean) => Promise<boolean>
  uploadNote: (text: string) => Promise<boolean>
  channelScan: (channel: string, fromDate: string, toDate: string, withNotes: boolean) => Promise<{ success: boolean; uploaded?: number; failed?: number; errors?: string[] }>
  clearUploadError: () => void

  // UI
  activeTab: "uploads" | "ask"
  setActiveTab: (tab: "uploads" | "ask") => void
}

// ===== Store Implementation =====

export const useAppStore = create<AppStore>((set, get) => ({
  // Config
  configValid: false,
  configError: null,
  configWarnings: [],
  validateConfig: async () => {
    try {
      const api = getApi()
      const result = await api.config.validate()
      if (result.success) {
        set({
          configValid: result.data.valid,
          configError: result.data.error ?? null,
          configWarnings: result.data.warnings ?? [],
        })
      } else {
        set({
          configValid: false,
          configError: result.error ?? "Failed to validate configuration",
          configWarnings: [],
        })
      }
    } catch (err) {
      set({
        configValid: false,
        configError: err instanceof Error ? err.message : "Unknown error validating config",
        configWarnings: [],
      })
    }
  },

  // Workspaces
  workspaces: [],
  selectedWorkspace: null,
  workspacesLoading: false,
  loadWorkspaces: async () => {
    set({ workspacesLoading: true })
    try {
      const api = getApi()
      const result = await api.workspace.list()
      if (result.success) {
        set({ workspaces: result.data, workspacesLoading: false })
      } else {
        set({ workspaces: [], workspacesLoading: false })
      }
    } catch {
      set({ workspaces: [], workspacesLoading: false })
    }
  },
  selectWorkspace: (name: string) => {
    set({
      selectedWorkspace: name,
      uploads: [],
      selectedUpload: null,
      uploadContent: null,
      queryResult: null,
      queryError: null,
    })
  },

  // Uploads
  uploads: [],
  uploadsLoading: false,
  uploadFilters: [],
  uploadSort: "-timestamp",
  loadUploads: async () => {
    const { selectedWorkspace, uploadFilters, uploadSort } = get()
    if (!selectedWorkspace) return
    set({ uploadsLoading: true })
    try {
      const api = getApi()
      const result = await api.upload.list(selectedWorkspace, uploadFilters, uploadSort)
      if (result.success) {
        set({ uploads: result.data, uploadsLoading: false })
      } else {
        set({ uploads: [], uploadsLoading: false })
      }
    } catch {
      set({ uploads: [], uploadsLoading: false })
    }
  },
  setUploadFilters: (filters) => set({ uploadFilters: filters }),
  setUploadSort: (sort) => set({ uploadSort: sort }),

  // Selected upload
  selectedUpload: null,
  uploadContent: null,
  contentLoading: false,
  contentError: null,
  selectUpload: (upload) => set({ selectedUpload: upload, uploadContent: null, contentError: null }),
  clearSelectedUpload: () => set({ selectedUpload: null, uploadContent: null, contentError: null }),
  loadUploadContent: async (workspace, uploadId) => {
    set({ contentLoading: true, contentError: null })
    try {
      const api = getApi()
      const result = await api.upload.getContent(workspace, uploadId)
      if (result.success) {
        set({ uploadContent: result.data.content, contentLoading: false })
      } else {
        set({ uploadContent: null, contentLoading: false, contentError: result.error ?? "Failed to load content" })
      }
    } catch (err) {
      set({ uploadContent: null, contentLoading: false, contentError: err instanceof Error ? err.message : "Failed to load content" })
    }
  },
  downloadUpload: async (workspace, uploadId) => {
    try {
      const api = getApi()
      const result = await api.upload.download(workspace, uploadId)
      if (result.success) {
        return { success: true }
      } else {
        return { success: false, error: result.error }
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Download failed",
      }
    }
  },

  // Query
  queryResult: null,
  isQuerying: false,
  queryError: null,
  executeQuery: async (question, geminiFilters, clientFilters) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) {
      set({ queryError: "No workspace selected" })
      return
    }
    set({ isQuerying: true, queryError: null, queryResult: null })
    try {
      const api = getApi()
      const result = await api.query.ask({
        workspaces: [selectedWorkspace],
        question,
        geminiFilters: geminiFilters ?? [],
        clientFilters: clientFilters ?? [],
      })
      if (result.success) {
        set({ queryResult: result.data, isQuerying: false })
      } else {
        set({ queryError: result.error ?? "Query failed", isQuerying: false })
      }
    } catch (err) {
      set({
        queryError: err instanceof Error ? err.message : "Query failed",
        isQuerying: false,
      })
    }
  },
  clearQueryResult: () => set({ queryResult: null, queryError: null }),

  // Workspace creation
  isCreatingWorkspace: false,
  createWorkspaceError: null,
  createWorkspace: async (name: string) => {
    set({ isCreatingWorkspace: true, createWorkspaceError: null })
    try {
      const api = getApi()
      const result = await api.workspace.create(name)
      if (result.success) {
        set({ isCreatingWorkspace: false })
        await get().loadWorkspaces()
        get().selectWorkspace(name)
        await get().loadUploads()
        return true
      } else {
        set({ isCreatingWorkspace: false, createWorkspaceError: result.error ?? "Failed to create workspace" })
        return false
      }
    } catch (err) {
      set({
        isCreatingWorkspace: false,
        createWorkspaceError: err instanceof Error ? err.message : "Failed to create workspace",
      })
      return false
    }
  },
  clearCreateWorkspaceError: () => set({ createWorkspaceError: null }),

  // Delete upload
  isDeleting: false,
  deleteUpload: async (uploadId: string) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) return false
    set({ isDeleting: true })
    try {
      const api = getApi()
      const result = await api.upload.deleteUpload(selectedWorkspace, uploadId)
      if (result.success) {
        set({ isDeleting: false, selectedUpload: null, uploadContent: null, contentError: null })
        await get().loadUploads()
        await get().loadWorkspaces()
        return true
      } else {
        set({ isDeleting: false })
        return false
      }
    } catch {
      set({ isDeleting: false })
      return false
    }
  },
  deleteWorkspace: async (name: string) => {
    set({ isDeleting: true })
    try {
      const api = getApi()
      const result = await api.workspace.delete(name)
      if (result.success) {
        const { selectedWorkspace } = get()
        set({ isDeleting: false })
        // If the deleted workspace was selected, clear selection
        if (selectedWorkspace === name) {
          set({ selectedWorkspace: null, uploads: [], selectedUpload: null, uploadContent: null })
        }
        await get().loadWorkspaces()
        return true
      } else {
        set({ isDeleting: false })
        return false
      }
    } catch {
      set({ isDeleting: false })
      return false
    }
  },

  // Upload operations
  isUploading: false,
  uploadError: null,
  uploadFile: async (filePath: string) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) {
      set({ uploadError: "No workspace selected" })
      return false
    }
    set({ isUploading: true, uploadError: null })
    try {
      const api = getApi()
      const result = await api.upload.uploadFile(selectedWorkspace, filePath)
      if (result.success) {
        set({ isUploading: false })
        await get().loadUploads()
        await get().loadWorkspaces()
        return true
      } else {
        set({ isUploading: false, uploadError: result.error ?? "Upload failed" })
        return false
      }
    } catch (err) {
      set({
        isUploading: false,
        uploadError: err instanceof Error ? err.message : "Upload failed",
      })
      return false
    }
  },
  uploadUrl: async (url: string) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) {
      set({ uploadError: "No workspace selected" })
      return false
    }
    set({ isUploading: true, uploadError: null })
    try {
      const api = getApi()
      const result = await api.upload.uploadUrl(selectedWorkspace, url)
      if (result.success) {
        set({ isUploading: false })
        await get().loadUploads()
        await get().loadWorkspaces()
        return true
      } else {
        set({ isUploading: false, uploadError: result.error ?? "Upload failed" })
        return false
      }
    } catch (err) {
      set({
        isUploading: false,
        uploadError: err instanceof Error ? err.message : "Upload failed",
      })
      return false
    }
  },
  uploadYoutube: async (url: string, withNotes: boolean) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) {
      set({ uploadError: "No workspace selected" })
      return false
    }
    set({ isUploading: true, uploadError: null })
    try {
      const api = getApi()
      const result = await api.upload.uploadYoutube(selectedWorkspace, url, withNotes)
      if (result.success) {
        set({ isUploading: false })
        await get().loadUploads()
        await get().loadWorkspaces()
        return true
      } else {
        set({ isUploading: false, uploadError: result.error ?? "Upload failed" })
        return false
      }
    } catch (err) {
      set({
        isUploading: false,
        uploadError: err instanceof Error ? err.message : "Upload failed",
      })
      return false
    }
  },
  uploadNote: async (text: string) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) {
      set({ uploadError: "No workspace selected" })
      return false
    }
    set({ isUploading: true, uploadError: null })
    try {
      const api = getApi()
      const result = await api.upload.uploadNote(selectedWorkspace, text)
      if (result.success) {
        set({ isUploading: false })
        await get().loadUploads()
        await get().loadWorkspaces()
        return true
      } else {
        set({ isUploading: false, uploadError: result.error ?? "Upload failed" })
        return false
      }
    } catch (err) {
      set({
        isUploading: false,
        uploadError: err instanceof Error ? err.message : "Upload failed",
      })
      return false
    }
  },
  channelScan: async (channel: string, fromDate: string, toDate: string, withNotes: boolean) => {
    const { selectedWorkspace } = get()
    if (!selectedWorkspace) {
      set({ uploadError: "No workspace selected" })
      return { success: false }
    }
    set({ isUploading: true, uploadError: null })
    try {
      const api = getApi()
      const result = await api.youtube.channelScan(selectedWorkspace, channel, fromDate, toDate, withNotes)
      if (result.success) {
        set({ isUploading: false })
        await get().loadUploads()
        await get().loadWorkspaces()
        return { success: true, uploaded: result.data.uploaded, failed: result.data.failed, errors: result.data.errors }
      } else {
        set({ isUploading: false, uploadError: result.error ?? "Channel scan failed" })
        return { success: false }
      }
    } catch (err) {
      set({
        isUploading: false,
        uploadError: err instanceof Error ? err.message : "Channel scan failed",
      })
      return { success: false }
    }
  },
  clearUploadError: () => set({ uploadError: null }),

  // UI
  activeTab: "uploads",
  setActiveTab: (tab) => set({ activeTab: tab }),
}))

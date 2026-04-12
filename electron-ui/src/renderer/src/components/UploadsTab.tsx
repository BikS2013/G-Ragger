import { useMemo } from "react"
import { useAppStore, type UploadEntry } from "../store"
import { UploadsFilterBar } from "./UploadsFilterBar"
import { DataTable } from "./uploads-table/data-table"
import { createColumns } from "./uploads-table/columns"
import { LoadingSpinner } from "./LoadingSpinner"

export function UploadsTab() {
  const selectedWorkspace = useAppStore((s) => s.selectedWorkspace)
  const uploads = useAppStore((s) => s.uploads)
  const uploadsLoading = useAppStore((s) => s.uploadsLoading)
  const selectUpload = useAppStore((s) => s.selectUpload)
  const deleteUpload = useAppStore((s) => s.deleteUpload)

  const handleDelete = (upload: UploadEntry) => {
    if (window.confirm(`Delete "${upload.title}"? This will remove it from Gemini and the local registry.`)) {
      deleteUpload(upload.id)
    }
  }

  const handleTagsChange = async (upload: UploadEntry, add?: string[], remove?: string[]) => {
    const ws = useAppStore.getState().selectedWorkspace
    if (!ws) return
    const result = await window.api.upload.updateTags(ws, upload.id, add, remove)
    if (result.success) {
      useAppStore.getState().loadUploads()
    }
  }

  const columns = useMemo(() => createColumns(handleDelete, handleTagsChange), [])

  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        Select a workspace to view uploads.
      </div>
    )
  }

  const handleRowClick = (upload: UploadEntry) => {
    selectUpload(upload)
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <UploadsFilterBar />
      {uploadsLoading ? (
        <div className="flex items-center justify-center h-48">
          <LoadingSpinner label="Loading uploads..." />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <DataTable columns={columns} data={uploads} onRowClick={handleRowClick} />
        </div>
      )}
    </div>
  )
}

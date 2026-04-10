import { useEffect, useState } from "react"
import { RefreshCw, Folder, FileText, Globe, Video, StickyNote, Plus, Trash2 } from "lucide-react"
import { useAppStore, type WorkspaceSummary } from "../store"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { ScrollArea } from "./ui/scroll-area"
import { Skeleton } from "./ui/skeleton"
import { Separator } from "./ui/separator"
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog"

const SOURCE_TYPE_ICONS: Record<string, React.ReactNode> = {
  file: <FileText className="h-3 w-3" />,
  web: <Globe className="h-3 w-3" />,
  youtube: <Video className="h-3 w-3" />,
  note: <StickyNote className="h-3 w-3" />,
}

function WorkspaceListSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-1 rounded-md p-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function WorkspaceStatsSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-3 w-1/3" />
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-16" />
        ))}
      </div>
    </div>
  )
}

function WorkspaceStats({ workspace }: { workspace: WorkspaceSummary }) {
  const sourceTypes = workspace.sourceTypeCounts ?? {}

  return (
    <div className="space-y-2 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {workspace.uploadCount} upload{workspace.uploadCount !== 1 ? "s" : ""} total
      </p>
      {Object.keys(sourceTypes).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(sourceTypes).map(([type, count]) => (
            <Badge key={type} variant="secondary" className="gap-1 text-[10px]">
              {SOURCE_TYPE_ICONS[type] ?? null}
              {type} {count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function WorkspaceSidebar() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const workspaces = useAppStore((s) => s.workspaces)
  const selectedWorkspace = useAppStore((s) => s.selectedWorkspace)
  const workspacesLoading = useAppStore((s) => s.workspacesLoading)
  const loadWorkspaces = useAppStore((s) => s.loadWorkspaces)
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const loadUploads = useAppStore((s) => s.loadUploads)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const handleSelectWorkspace = (name: string) => {
    selectWorkspace(name)
    // loadUploads reads selectedWorkspace from store, but selectWorkspace
    // is synchronous so we need to call loadUploads after the state update.
    // Since Zustand updates are synchronous, the next call will pick up the new value.
    setTimeout(() => {
      useAppStore.getState().loadUploads()
    }, 0)
  }

  const handleRefresh = () => {
    loadWorkspaces()
  }

  const handleDeleteWorkspace = (e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    if (window.confirm(`Delete workspace "${name}"? This will permanently remove the workspace, all its uploads, and the Gemini store.`)) {
      deleteWorkspace(name)
    }
  }

  const selectedWs = workspaces.find((ws) => ws.name === selectedWorkspace)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 items-center justify-between bg-header-bg px-4">
        <h2 className="text-sm font-semibold">Workspaces</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 transition-colors duration-150"
            onClick={() => setCreateDialogOpen(true)}
            title="Create workspace"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 transition-colors duration-150"
            onClick={handleRefresh}
            disabled={workspacesLoading}
          >
            <RefreshCw className={`h-4 w-4 ${workspacesLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <Separator />

      {/* Workspace list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {workspacesLoading && workspaces.length === 0 ? (
            <WorkspaceListSkeleton />
          ) : workspaces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
              <Folder className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No workspaces found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {workspaces.map((ws) => (
                <button
                  key={ws.name}
                  onClick={() => handleSelectWorkspace(ws.name)}
                  className={`group flex w-full items-center rounded-md px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent ${
                    selectedWorkspace === ws.name
                      ? "border-l-2 border-l-primary bg-accent"
                      : "border-l-2 border-l-transparent"
                  }`}
                >
                  <span className="flex-1 truncate font-medium">{ws.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {ws.uploadCount}
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => handleDeleteWorkspace(e, ws.name)}
                    className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all duration-150 hover:text-destructive group-hover:opacity-100"
                    title="Delete workspace"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Statistics for selected workspace */}
      {selectedWorkspace && (
        <>
          <Separator />
          {workspacesLoading ? (
            <WorkspaceStatsSkeleton />
          ) : selectedWs ? (
            <WorkspaceStats workspace={selectedWs} />
          ) : null}
        </>
      )}

      <CreateWorkspaceDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  )
}

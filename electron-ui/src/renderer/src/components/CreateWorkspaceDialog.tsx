import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { useAppStore } from "../store"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { Button } from "./ui/button"

const WORKSPACE_NAME_REGEX = /^[a-zA-Z0-9_-]*$/

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const [name, setName] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)

  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const isCreatingWorkspace = useAppStore((s) => s.isCreatingWorkspace)
  const createWorkspaceError = useAppStore((s) => s.createWorkspaceError)
  const clearCreateWorkspaceError = useAppStore((s) => s.clearCreateWorkspaceError)

  // Clear errors and input when dialog opens/closes
  useEffect(() => {
    setName("")
    setValidationError(null)
    clearCreateWorkspaceError()
  }, [open, clearCreateWorkspaceError])

  const handleNameChange = (value: string) => {
    setName(value)
    if (!WORKSPACE_NAME_REGEX.test(value)) {
      setValidationError("Only letters, numbers, hyphens, and underscores are allowed")
    } else {
      setValidationError(null)
    }
    // Clear server-side error when user types
    if (createWorkspaceError) {
      clearCreateWorkspaceError()
    }
  }

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setValidationError("Workspace name is required")
      return
    }
    if (!WORKSPACE_NAME_REGEX.test(trimmed)) {
      setValidationError("Only letters, numbers, hyphens, and underscores are allowed")
      return
    }
    const success = await createWorkspace(trimmed)
    if (success) {
      onOpenChange(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isCreatingWorkspace) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={isCreatingWorkspace ? undefined : onOpenChange}>
      <DialogContent
        onInteractOutside={(e) => {
          if (isCreatingWorkspace) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isCreatingWorkspace) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>
            Enter a name for the new workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Input
            placeholder="my-workspace"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isCreatingWorkspace}
            autoFocus
          />

          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}

          {createWorkspaceError && (
            <p className="text-sm text-destructive">{createWorkspaceError}</p>
          )}

          {isCreatingWorkspace && (
            <p className="text-sm text-muted-foreground animate-pulse">Creating workspace...</p>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={isCreatingWorkspace || !!validationError || !name.trim()}
          >
            {isCreatingWorkspace ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from "react"
import { Download, Copy, Clock, Flag, FileText, ExternalLink, Video, StickyNote, Loader2, Text, Trash2, X, Plus, Tag } from "lucide-react"
import { useAppStore } from "../store"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Separator } from "./ui/separator"
import { Input } from "./ui/input"
import { ContentViewer } from "./ContentViewer"
import { formatDateTime, formatDate } from "../lib/date-format"

function getExpirationInfo(expirationDate: string | null): {
  label: string
  colorClass: string
} {
  if (!expirationDate) {
    return { label: "No expiration", colorClass: "text-muted-foreground" }
  }
  const now = new Date()
  const exp = new Date(expirationDate)
  const diffMs = exp.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { label: `Expired (${expirationDate})`, colorClass: "text-red-500" }
  }
  if (diffDays <= 7) {
    return {
      label: `${expirationDate} (${diffDays}d remaining)`,
      colorClass: "text-orange-500",
    }
  }
  return { label: expirationDate, colorClass: "text-success-foreground" }
}

function sourceTypeBadgeVariant(
  sourceType: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (sourceType) {
    case "youtube":
      return "destructive"
    case "web":
      return "default"
    case "file":
      return "secondary"
    case "note":
      return "outline"
    default:
      return "secondary"
  }
}

function flagBadgeVariant(
  flag: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (flag) {
    case "urgent":
      return "destructive"
    case "completed":
      return "default"
    case "inactive":
      return "secondary"
    default:
      return "outline"
  }
}

import { usePersistedSize } from "../hooks/usePersistedSize"

export function UploadDetail() {
  const { ref: dialogSizeRef } = usePersistedSize("upload-detail", { width: 700, height: 600 })
  const selectedUpload = useAppStore((s) => s.selectedUpload)
  const uploadContent = useAppStore((s) => s.uploadContent)
  const contentLoading = useAppStore((s) => s.contentLoading)
  const contentError = useAppStore((s) => s.contentError)
  const selectedWorkspace = useAppStore((s) => s.selectedWorkspace)
  const clearSelectedUpload = useAppStore((s) => s.clearSelectedUpload)
  const loadUploadContent = useAppStore((s) => s.loadUploadContent)
  const downloadUpload = useAppStore((s) => s.downloadUpload)
  const deleteUploadAction = useAppStore((s) => s.deleteUpload)
  const isDeleting = useAppStore((s) => s.isDeleting)

  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const [youtubeContent, setYoutubeContent] = useState<string | null>(null)
  const [youtubeLoading, setYoutubeLoading] = useState<"transcript" | "notes" | "description" | null>(null)
  const [youtubeError, setYoutubeError] = useState<string | null>(null)
  const [activeContentSource, setActiveContentSource] = useState<"gemini" | "transcript" | "notes" | "description">("gemini")

  // Tag editing state
  const [tagInput, setTagInput] = useState("")
  const [tagSaving, setTagSaving] = useState(false)
  const selectUpload = useAppStore((s) => s.selectUpload)
  const loadUploads = useAppStore((s) => s.loadUploads)

  const handleAddTag = async () => {
    const tag = tagInput.trim().toLowerCase()
    if (!tag || !selectedUpload || !selectedWorkspace) return
    if (tag.includes("=") || tag.length > 50) return
    if ((selectedUpload.tags ?? []).includes(tag)) { setTagInput(""); return }
    setTagSaving(true)
    try {
      const result = await window.api.upload.updateTags(selectedWorkspace, selectedUpload.id, [tag])
      if (result.success) {
        selectUpload({ ...selectedUpload, tags: result.data })
        loadUploads()
      }
    } finally {
      setTagSaving(false)
      setTagInput("")
    }
  }

  const handleRemoveTag = async (tag: string) => {
    if (!selectedUpload || !selectedWorkspace) return
    setTagSaving(true)
    try {
      const result = await window.api.upload.updateTags(selectedWorkspace, selectedUpload.id, undefined, [tag])
      if (result.success) {
        selectUpload({ ...selectedUpload, tags: result.data })
        loadUploads()
      }
    } finally {
      setTagSaving(false)
    }
  }

  const isOpen = selectedUpload !== null
  const isYoutube = selectedUpload?.sourceType === "youtube" && !!selectedUpload?.sourceUrl

  useEffect(() => {
    if (selectedUpload && selectedWorkspace) {
      if (selectedUpload.sourceType === "youtube" && selectedUpload.sourceUrl) {
        // For YouTube uploads, fetch description by default
        setActiveContentSource("description")
        handleYoutubeDescription()
      } else {
        setActiveContentSource("gemini")
        loadUploadContent(selectedWorkspace, selectedUpload.id)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUpload, selectedWorkspace])

  // Clear transient state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setCopiedField(null)
      setDownloadStatus(null)
      setYoutubeContent(null)
      setYoutubeLoading(null)
      setYoutubeError(null)
      setActiveContentSource("gemini")
    }
  }, [isOpen])

  const handleYoutubeTranscript = async () => {
    if (!selectedUpload?.sourceUrl) return
    setYoutubeLoading("transcript")
    setYoutubeError(null)
    try {
      const result = await window.api.youtube.getTranscript(selectedUpload.sourceUrl)
      if (result.success) {
        setYoutubeContent(result.data)
        setActiveContentSource("transcript")
      } else {
        setYoutubeError(result.error)
      }
    } catch (err) {
      setYoutubeError(err instanceof Error ? err.message : "Failed to fetch transcript")
    } finally {
      setYoutubeLoading(null)
    }
  }

  const handleYoutubeNotes = async () => {
    if (!selectedUpload?.sourceUrl) return
    setYoutubeLoading("notes")
    setYoutubeError(null)
    try {
      const result = await window.api.youtube.getNotes(selectedUpload.sourceUrl)
      if (result.success) {
        setYoutubeContent(result.data)
        setActiveContentSource("notes")
      } else {
        setYoutubeError(result.error)
      }
    } catch (err) {
      setYoutubeError(err instanceof Error ? err.message : "Failed to generate notes")
    } finally {
      setYoutubeLoading(null)
    }
  }

  const handleYoutubeDescription = async () => {
    if (!selectedUpload?.sourceUrl) return
    setYoutubeLoading("description")
    setYoutubeError(null)
    try {
      const result = await window.api.youtube.getDescription(selectedUpload.sourceUrl)
      if (result.success) {
        setYoutubeContent(result.data)
        setActiveContentSource("description")
      } else {
        setYoutubeError(result.error)
      }
    } catch (err) {
      setYoutubeError(err instanceof Error ? err.message : "Failed to fetch description")
    } finally {
      setYoutubeLoading(null)
    }
  }

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      // Clipboard write can fail in some contexts; silently ignore
    }
  }

  const handleDelete = async () => {
    if (!selectedUpload) return
    const confirmed = window.confirm(
      "Delete this upload? This will remove it from both Gemini and the local registry."
    )
    if (!confirmed) return
    await deleteUploadAction(selectedUpload.id)
  }

  const handleDownload = async () => {
    if (!selectedWorkspace || !selectedUpload) return
    setDownloadStatus(null)
    const result = await downloadUpload(selectedWorkspace, selectedUpload.id)
    if (result.success) {
      setDownloadStatus({ type: "success", message: "File saved successfully." })
    } else {
      setDownloadStatus({
        type: "error",
        message: result.error ?? "Download failed.",
      })
    }
  }

  if (!selectedUpload) return null

  const expInfo = getExpirationInfo(selectedUpload.expirationDate)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && clearSelectedUpload()}>
      <DialogContent ref={dialogSizeRef} className="max-w-4xl min-w-[500px] min-h-[400px] resize overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 shrink-0" />
            <span className="truncate">{selectedUpload.title}</span>
          </DialogTitle>
          <DialogDescription>Upload details and content inspection</DialogDescription>
        </DialogHeader>

        {/* Metadata Section */}
        <div className="shrink-0 space-y-3 text-sm">
          {/* ID */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground">ID</span>
            <code className="flex-1 truncate rounded bg-muted px-2 py-0.5 font-mono text-xs">
              {selectedUpload.id}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => handleCopy(selectedUpload.id, "id")}
              title="Copy ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {copiedField === "id" && (
              <span className="text-xs text-success-foreground">Copied</span>
            )}
          </div>

          {/* Source Type */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground">
              Source Type
            </span>
            <Badge variant={sourceTypeBadgeVariant(selectedUpload.sourceType)}>
              {selectedUpload.sourceType}
            </Badge>
          </div>

          {/* Source URL */}
          {selectedUpload.sourceUrl && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 font-medium text-muted-foreground">
                Source URL
              </span>
              <button
                type="button"
                onClick={() => window.api.shell.openExternal(selectedUpload.sourceUrl!)}
                className="flex-1 truncate text-blue-500 underline underline-offset-2 cursor-pointer flex items-center gap-1 text-left hover:text-blue-600"
                title="Open in browser"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{selectedUpload.sourceUrl}</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleCopy(selectedUpload.sourceUrl!, "url")}
                title="Copy URL"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {copiedField === "url" && (
                <span className="text-xs text-success-foreground">Copied</span>
              )}
            </div>
          )}

          {/* Channel (YouTube only) */}
          {selectedUpload.channelTitle && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 font-medium text-muted-foreground">
                Channel
              </span>
              <span>{selectedUpload.channelTitle}</span>
            </div>
          )}

          {/* Published date (YouTube only) */}
          {selectedUpload.publishedAt && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 font-medium text-muted-foreground">
                Published
              </span>
              <span>{formatDate(selectedUpload.publishedAt)}</span>
            </div>
          )}

          {/* Timestamp */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground">
              Uploaded
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {formatDateTime(selectedUpload.timestamp)}
            </span>
          </div>

          {/* Expiration */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground">
              Expiration
            </span>
            <span className={expInfo.colorClass}>{expInfo.label}</span>
          </div>

          {/* Flags */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground">
              Flags
            </span>
            {selectedUpload.flags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedUpload.flags.map((flag) => (
                  <Badge key={flag} variant={flagBadgeVariant(flag)} className="gap-1">
                    <Flag className="h-3 w-3" />
                    {flag}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </div>

          {/* Tags (editable) */}
          <div className="flex items-start gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground pt-1">
              <Tag className="inline h-3 w-3 mr-1" />
              Tags
            </span>
            <div className="flex-1 space-y-1.5">
              {(selectedUpload.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(selectedUpload.tags ?? []).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        disabled={tagSaving}
                        className="ml-0.5 hover:text-destructive disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault()
                      handleAddTag()
                    }
                  }}
                  placeholder="Add tag..."
                  className="h-7 text-xs w-36"
                  disabled={tagSaving}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || tagSaving}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Gemini Document Name */}
          <div className="flex items-start gap-2">
            <span className="w-28 shrink-0 font-medium text-muted-foreground">
              Gemini Doc
            </span>
            <code className="flex-1 break-all rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {selectedUpload.documentName}
            </code>
          </div>
        </div>

        <Separator className="shrink-0" />

        {/* Content Section */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium">Content</h4>
              {(() => {
                const visibleContent = activeContentSource === "gemini" ? uploadContent : youtubeContent
                if (!visibleContent) return null
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-xs text-muted-foreground"
                    onClick={() => {
                      navigator.clipboard.writeText(visibleContent)
                      setCopiedField("content")
                      setTimeout(() => setCopiedField(null), 2000)
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    {copiedField === "content" ? "Copied!" : "Copy"}
                  </Button>
                )
              })()}
            </div>
            {isYoutube && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant={activeContentSource === "gemini" ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    setActiveContentSource("gemini")
                    if (!uploadContent && !contentLoading && selectedWorkspace && selectedUpload) {
                      loadUploadContent(selectedWorkspace, selectedUpload.id)
                    }
                  }}
                >
                  <FileText className="h-3 w-3" />
                  Gemini
                </Button>
                <Button
                  variant={activeContentSource === "transcript" ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={youtubeLoading !== null}
                  onClick={handleYoutubeTranscript}
                >
                  {youtubeLoading === "transcript" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Video className="h-3 w-3" />
                  )}
                  Transcript
                </Button>
                <Button
                  variant={activeContentSource === "notes" ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={youtubeLoading !== null}
                  onClick={handleYoutubeNotes}
                >
                  {youtubeLoading === "notes" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <StickyNote className="h-3 w-3" />
                  )}
                  AI Notes
                </Button>
                <Button
                  variant={activeContentSource === "description" ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={youtubeLoading !== null}
                  onClick={handleYoutubeDescription}
                >
                  {youtubeLoading === "description" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Text className="h-3 w-3" />
                  )}
                  Description
                </Button>
              </div>
            )}
          </div>

          {youtubeError && (
            <div className="rounded-md border border-destructive/30 bg-error-bg px-3 py-2 text-xs text-error-foreground">
              {youtubeError}
            </div>
          )}

          {activeContentSource === "gemini" ? (
            <ContentViewer content={uploadContent} loading={contentLoading} error={contentError} />
          ) : (
            <ContentViewer
              content={youtubeContent}
              loading={youtubeLoading !== null}
            />
          )}
        </div>

        {/* Download Status */}
        {downloadStatus && (
          <div
            className={`rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
              downloadStatus.type === "success"
                ? "bg-success-bg/20 text-success-foreground"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {downloadStatus.message}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            className="gap-2 mr-auto"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Download
          </Button>
          <Button variant="secondary" onClick={clearSelectedUpload}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

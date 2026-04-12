import { useState, useEffect, useRef, useCallback } from "react"
import { useAppStore } from "../store"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { Button } from "./ui/button"
import {
  Plus,
  Loader2,
  Upload,
  Globe,
  Video,
  StickyNote,
  X,
  File,
  Radio,
} from "lucide-react"
import { TagInput } from "./TagInput"

type ContentTab = "file" | "url" | "youtube" | "note" | "channel"

interface AddContentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getLoadingMessage(tab: ContentTab, withNotes: boolean): string {
  switch (tab) {
    case "file":
      return "Uploading file to Gemini..."
    case "url":
      return "Fetching page content and uploading..."
    case "youtube":
      return withNotes
        ? "Fetching transcript, generating AI notes, and uploading..."
        : "Fetching transcript and uploading..."
    case "note":
      return "Saving note..."
    case "channel":
      return "Scanning channel and uploading videos..."
  }
}

export function AddContentDialog({ open, onOpenChange }: AddContentDialogProps) {
  const uploadFile = useAppStore((s) => s.uploadFile)
  const uploadUrl = useAppStore((s) => s.uploadUrl)
  const uploadYoutube = useAppStore((s) => s.uploadYoutube)
  const uploadNote = useAppStore((s) => s.uploadNote)
  const channelScan = useAppStore((s) => s.channelScan)
  const isUploading = useAppStore((s) => s.isUploading)
  const uploadError = useAppStore((s) => s.uploadError)
  const clearUploadError = useAppStore((s) => s.clearUploadError)

  // Tab state
  const [activeTab, setActiveTab] = useState<ContentTab>("file")

  // File tab state
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // URL tab state
  const [url, setUrl] = useState("")

  // YouTube tab state
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [withNotes, setWithNotes] = useState(false)

  // Note tab state
  const [noteText, setNoteText] = useState("")

  // Channel scan tab state
  const [channelInput, setChannelInput] = useState("")
  const [channelFromDate, setChannelFromDate] = useState("")
  const [channelToDate, setChannelToDate] = useState("")
  const [channelWithNotes, setChannelWithNotes] = useState(false)
  const [channelScanResult, setChannelScanResult] = useState<{ uploaded: number; failed: number } | null>(null)

  // Tags state (shared across all tabs)
  const [tags, setTags] = useState<string[]>([])

  // Elapsed time counter
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Track uploading state to detect transition from uploading to not uploading
  const wasUploadingRef = useRef(false)

  // Clear all local state
  const clearAllState = useCallback(() => {
    setFilePath(null)
    setFileName(null)
    setUrl("")
    setYoutubeUrl("")
    setWithNotes(false)
    setNoteText("")
    setChannelInput("")
    setChannelFromDate("")
    setChannelToDate("")
    setChannelWithNotes(false)
    setChannelScanResult(null)
    setTags([])
    setElapsedSeconds(0)
  }, [])

  // Clear error when switching tabs
  const handleTabChange = (value: string) => {
    setActiveTab(value as ContentTab)
    clearUploadError()
  }

  // Clear error when dialog opens
  useEffect(() => {
    if (open) {
      clearUploadError()
    }
  }, [open, clearUploadError])

  // Elapsed time timer
  useEffect(() => {
    if (isUploading) {
      setElapsedSeconds(0)
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isUploading])

  // Detect upload completion (was uploading, now not uploading, no error => success)
  useEffect(() => {
    if (wasUploadingRef.current && !isUploading && !uploadError) {
      clearAllState()
      onOpenChange(false)
    }
    wasUploadingRef.current = isUploading
  }, [isUploading, uploadError, clearAllState, onOpenChange])

  // File browse handler
  const handleBrowse = async () => {
    const result = await window.api.dialog.openFile()
    if (result.success && result.data) {
      setFilePath(result.data.filePath)
      setFileName(result.data.fileName)
    }
  }

  // Submit handlers
  const tagsOrUndefined = tags.length > 0 ? tags : undefined

  const handleFileUpload = () => {
    if (filePath) {
      uploadFile(filePath, tagsOrUndefined)
    }
  }

  const handleUrlUpload = () => {
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      uploadUrl(url, tagsOrUndefined)
    }
  }

  const handleYoutubeUpload = () => {
    if (youtubeUrl && (youtubeUrl.includes("youtube.com") || youtubeUrl.includes("youtu.be"))) {
      uploadYoutube(youtubeUrl, withNotes, tagsOrUndefined)
    }
  }

  const handleNoteUpload = () => {
    if (noteText.trim()) {
      uploadNote(noteText, tagsOrUndefined)
    }
  }

  const handleChannelScan = async () => {
    if (channelInput.trim() && channelFromDate && channelToDate) {
      setChannelScanResult(null)
      const result = await channelScan(channelInput.trim(), channelFromDate, channelToDate, channelWithNotes, tagsOrUndefined)
      if (result.success) {
        setChannelScanResult({ uploaded: result.uploaded ?? 0, failed: result.failed ?? 0 })
      }
    }
  }

  // Validation helpers
  const isUrlValid = url.startsWith("http://") || url.startsWith("https://")
  const isYoutubeUrlValid = youtubeUrl.includes("youtube.com") || youtubeUrl.includes("youtu.be")

  return (
    <Dialog open={open} onOpenChange={isUploading ? undefined : onOpenChange}>
      <DialogContent
        onInteractOutside={(e) => {
          if (isUploading) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isUploading) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Content
          </DialogTitle>
          <DialogDescription>
            Upload files, web pages, YouTube videos, or personal notes to the workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Error display */}
        {uploadError && (
          <div className="text-sm text-error-foreground bg-error-bg rounded-md px-3 py-2">
            {uploadError}
          </div>
        )}

        {/* Loading indicator */}
        {isUploading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="animate-pulse">{getLoadingMessage(activeTab, withNotes)}</span>
            <span className="text-xs">({elapsedSeconds}s elapsed)</span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="file" disabled={isUploading}>
              <File className="h-4 w-4 mr-1" />
              File
            </TabsTrigger>
            <TabsTrigger value="url" disabled={isUploading}>
              <Globe className="h-4 w-4 mr-1" />
              Web Page
            </TabsTrigger>
            <TabsTrigger value="youtube" disabled={isUploading}>
              <Video className="h-4 w-4 mr-1" />
              YouTube
            </TabsTrigger>
            <TabsTrigger value="note" disabled={isUploading}>
              <StickyNote className="h-4 w-4 mr-1" />
              Note
            </TabsTrigger>
            <TabsTrigger value="channel" disabled={isUploading}>
              <Radio className="h-4 w-4 mr-1" />
              Channel
            </TabsTrigger>
          </TabsList>

          {/* File Tab */}
          <TabsContent value="file">
            <div className="flex flex-col gap-4 py-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleBrowse}
                  disabled={isUploading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Browse...
                </Button>
                {fileName && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground bg-muted rounded-md px-2 py-1 max-w-[300px]">
                    <File className="h-3 w-3 shrink-0" />
                    <span className="truncate">{fileName}</span>
                    <button
                      onClick={() => {
                        setFilePath(null)
                        setFileName(null)
                      }}
                      disabled={isUploading}
                      className="ml-1 shrink-0 rounded-sm opacity-70 hover:opacity-100 disabled:pointer-events-none"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              <TagInput tags={tags} onChange={setTags} placeholder="Add tags..." />
              <Button
                onClick={handleFileUpload}
                disabled={!filePath || isUploading}
              >
                Upload
              </Button>
            </div>
          </TabsContent>

          {/* URL Tab */}
          <TabsContent value="url">
            <div className="flex flex-col gap-4 py-2">
              <Input
                placeholder="https://example.com/article"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isUploading}
              />
              {url && !isUrlValid && (
                <p className="text-xs text-red-500">
                  URL must start with http:// or https://
                </p>
              )}
              <TagInput tags={tags} onChange={setTags} placeholder="Add tags..." />
              <Button
                onClick={handleUrlUpload}
                disabled={!url || !isUrlValid || isUploading}
              >
                Upload
              </Button>
            </div>
          </TabsContent>

          {/* YouTube Tab */}
          <TabsContent value="youtube">
            <div className="flex flex-col gap-4 py-2">
              <Input
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                disabled={isUploading}
              />
              {youtubeUrl && !isYoutubeUrlValid && (
                <p className="text-xs text-red-500">
                  URL must contain youtube.com or youtu.be
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={withNotes}
                  onChange={(e) => setWithNotes(e.target.checked)}
                  disabled={isUploading}
                  className="rounded"
                />
                Generate AI notes
              </label>
              {withNotes && (
                <p className="text-xs text-muted-foreground">
                  AI notes generation adds 1-2 minutes to upload time
                </p>
              )}
              <TagInput tags={tags} onChange={setTags} placeholder="Add tags..." />
              <Button
                onClick={handleYoutubeUpload}
                disabled={!youtubeUrl || !isYoutubeUrlValid || isUploading}
              >
                Upload
              </Button>
            </div>
          </TabsContent>

          {/* Note Tab */}
          <TabsContent value="note">
            <div className="flex flex-col gap-4 py-2">
              <Textarea
                rows={6}
                placeholder="Type your note here..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                disabled={isUploading}
              />
              {noteText.trim() && (
                <p className="text-xs text-muted-foreground">
                  Title: {noteText.trim().substring(0, 60)}
                  {noteText.trim().length > 60 ? "..." : ""}
                </p>
              )}
              <TagInput tags={tags} onChange={setTags} placeholder="Add tags..." />
              <Button
                onClick={handleNoteUpload}
                disabled={!noteText.trim() || isUploading}
              >
                Save Note
              </Button>
            </div>
          </TabsContent>

          {/* Channel Scan Tab */}
          <TabsContent value="channel">
            <div className="flex flex-col gap-4 py-2">
              <Input
                placeholder="@IndyDevDan or channel URL"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                disabled={isUploading}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">From date</label>
                  <Input
                    type="date"
                    value={channelFromDate}
                    onChange={(e) => setChannelFromDate(e.target.value)}
                    disabled={isUploading}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">To date</label>
                  <Input
                    type="date"
                    value={channelToDate}
                    onChange={(e) => setChannelToDate(e.target.value)}
                    disabled={isUploading}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={channelWithNotes}
                  onChange={(e) => setChannelWithNotes(e.target.checked)}
                  disabled={isUploading}
                  className="rounded"
                />
                Generate AI notes
              </label>
              <p className="text-xs text-muted-foreground">
                This will upload all videos from the channel published between the dates. Each video takes 10-30 seconds.
              </p>
              {channelScanResult && (
                <div className="text-sm rounded-md px-3 py-2 bg-success-bg/20 text-success-foreground transition-colors duration-150">
                  Uploaded {channelScanResult.uploaded} video{channelScanResult.uploaded !== 1 ? "s" : ""}{channelScanResult.failed > 0 ? `, ${channelScanResult.failed} failed` : ""}
                </div>
              )}
              <TagInput tags={tags} onChange={setTags} placeholder="Add tags to all videos..." />
              <Button
                onClick={handleChannelScan}
                disabled={!channelInput.trim() || !channelFromDate || !channelToDate || isUploading}
              >
                Scan Channel
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

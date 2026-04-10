import { ScrollArea } from "./ui/scroll-area"
import { Skeleton } from "./ui/skeleton"

interface ContentViewerProps {
  content: string | null
  loading: boolean
  error?: string | null
}

export function ContentViewer({ content, loading, error }: ContentViewerProps) {
  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-error-bg p-4 text-sm text-error-foreground">
        <p className="font-medium">Failed to load content</p>
        <p className="mt-1 text-xs text-error-foreground">{error}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3 rounded-md border p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[95%]" />
        <Skeleton className="h-4 w-[80%]" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[85%]" />
        <Skeleton className="h-4 w-[70%]" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed p-8 text-sm text-muted-foreground">
        No content available.
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed">
        {content}
      </pre>
    </div>
  )
}

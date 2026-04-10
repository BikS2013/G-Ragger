import { X } from "lucide-react"
import { cn } from "../lib/utils"

interface ErrorBannerProps {
  message: string
  onDismiss?: () => void
  className?: string
}

export function ErrorBanner({ message, onDismiss, className }: ErrorBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md bg-destructive px-4 py-3 text-sm text-destructive-foreground transition-colors duration-150",
        className
      )}
    >
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Dismiss</span>
        </button>
      )}
    </div>
  )
}

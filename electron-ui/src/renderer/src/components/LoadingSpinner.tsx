import { Loader2 } from "lucide-react"
import { cn } from "../lib/utils"

interface LoadingSpinnerProps {
  className?: string
  size?: number
  label?: string
}

export function LoadingSpinner({ className, size = 24, label }: LoadingSpinnerProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Loader2 className="animate-spin text-muted-foreground" size={size} />
      {label && <span className="text-sm text-muted-foreground animate-pulse">{label}</span>}
    </div>
  )
}

import { useState } from "react"
import { Badge } from "./ui/badge"
import { Separator } from "./ui/separator"

interface Citation {
  title: string
  uri: string
  excerpt: string
}

interface CitationListProps {
  citations: Citation[]
}

export function CitationList({ citations }: CitationListProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  if (citations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No citations found
      </p>
    )
  }

  return (
    <div className="space-y-0">
      {citations.map((citation, index) => (
        <div key={index}>
          {index > 0 && <Separator />}
          <button
            type="button"
            onClick={() =>
              setSelectedIndex(selectedIndex === index ? null : index)
            }
            className={`w-full text-left px-3 py-3 rounded-md transition-colors ${
              selectedIndex === index
                ? "bg-accent"
                : "hover:bg-accent/50"
            }`}
          >
            <div className="flex items-start gap-2">
              <Badge
                variant="secondary"
                className="shrink-0 mt-0.5 min-w-[1.5rem] justify-center"
              >
                {index + 1}
              </Badge>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium text-sm leading-tight">
                  {citation.title || "Untitled"}
                </p>
                {citation.uri && (
                  <p className="font-mono text-xs text-muted-foreground truncate">
                    {citation.uri}
                  </p>
                )}
                {citation.excerpt && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {citation.excerpt}
                  </p>
                )}
              </div>
            </div>
          </button>
        </div>
      ))}
    </div>
  )
}

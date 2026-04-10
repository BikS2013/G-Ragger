import { useState } from "react"
import { Send, X } from "lucide-react"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"
import { ScrollArea } from "./ui/scroll-area"
import { LoadingSpinner } from "./LoadingSpinner"
import { ErrorBanner } from "./ErrorBanner"
import type { QueryResultData } from "../store"

interface QueryPanelProps {
  queryResult: QueryResultData | null
  isQuerying: boolean
  queryError: string | null
  onSubmit: (question: string) => void
  onClear: () => void
}

export function QueryPanel({
  queryResult,
  isQuerying,
  queryError,
  onSubmit,
  onClear,
}: QueryPanelProps) {
  const [question, setQuestion] = useState("")

  const canSubmit = question.trim().length > 0 && !isQuerying

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(question.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-4">
      {/* Question input */}
      <div className="space-y-2">
        <div className="relative">
          <Textarea
            placeholder="Ask a question about this workspace..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isQuerying}
            className="min-h-[100px] pr-12 resize-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Press Cmd+Enter to submit
          </p>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            size="sm"
          >
            {isQuerying ? (
              <LoadingSpinner size={16} />
            ) : (
              <Send className="h-4 w-4 mr-1.5" />
            )}
            {isQuerying ? "Querying..." : "Ask"}
          </Button>
        </div>
      </div>

      {/* Error display */}
      {queryError && (
        <ErrorBanner message={queryError} onDismiss={onClear} />
      )}

      {/* Loading state */}
      {isQuerying && (
        <div className="flex justify-center py-8">
          <LoadingSpinner size={32} label="Searching workspace..." />
        </div>
      )}

      {/* Answer display */}
      {queryResult && !isQuerying && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Answer</h3>
            <Button variant="ghost" size="sm" onClick={onClear} className="text-xs h-7 transition-colors duration-150">
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
          <ScrollArea className="max-h-[400px]">
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {queryResult.answer}
              </p>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

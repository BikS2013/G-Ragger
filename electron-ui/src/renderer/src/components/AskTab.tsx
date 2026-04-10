import { useRef } from "react"
import { Search } from "lucide-react"
import { useAppStore } from "../store"
import { QueryPanel } from "./QueryPanel"
import {
  QueryFilterPanel,
  type QueryFilterPanelRef,
} from "./QueryFilterPanel"
import { CitationList } from "./CitationList"
import { Separator } from "./ui/separator"
import { ScrollArea } from "./ui/scroll-area"

export function AskTab() {
  const selectedWorkspace = useAppStore((s) => s.selectedWorkspace)
  const queryResult = useAppStore((s) => s.queryResult)
  const isQuerying = useAppStore((s) => s.isQuerying)
  const queryError = useAppStore((s) => s.queryError)
  const executeQuery = useAppStore((s) => s.executeQuery)
  const clearQueryResult = useAppStore((s) => s.clearQueryResult)

  const filterPanelRef = useRef<QueryFilterPanelRef>(null)

  if (!selectedWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Search className="h-10 w-10" />
        <p className="text-sm">Select a workspace first to start querying</p>
      </div>
    )
  }

  const handleSubmit = (question: string) => {
    const filters = filterPanelRef.current?.getFilters()
    executeQuery(
      question,
      filters?.geminiFilters,
      filters?.clientFilters
    )
  }

  const handleClear = () => {
    clearQueryResult()
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        {/* Filter panel (collapsible) */}
        <QueryFilterPanel ref={filterPanelRef} />

        {/* Query input + answer */}
        <QueryPanel
          queryResult={queryResult}
          isQuerying={isQuerying}
          queryError={queryError}
          onSubmit={handleSubmit}
          onClear={handleClear}
        />

        {/* Citations */}
        {queryResult &&
          !isQuerying &&
          queryResult.citations.length > 0 && (
            <div className="space-y-2">
              <Separator />
              <h3 className="text-sm font-semibold">
                Citations ({queryResult.citations.length})
              </h3>
              <CitationList citations={queryResult.citations} />
            </div>
          )}
      </div>
    </ScrollArea>
  )
}

import { useState, useCallback, useImperativeHandle, forwardRef } from "react"
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Separator } from "./ui/separator"

export interface FilterValues {
  geminiFilters: { key: string; value: string }[]
  clientFilters: { key: string; value: string }[]
}

export interface QueryFilterPanelRef {
  getFilters: () => FilterValues
  reset: () => void
}

export const QueryFilterPanel = forwardRef<QueryFilterPanelRef>(
  function QueryFilterPanel(_props, ref) {
    const [isOpen, setIsOpen] = useState(false)

    // Gemini-side filters
    const [sourceType, setSourceType] = useState("all")
    const [sourceUrl, setSourceUrl] = useState("")

    // Client-side filters
    const [flagFilter, setFlagFilter] = useState("all")
    const [expirationStatus, setExpirationStatus] = useState("all")

    const hasActiveFilters =
      sourceType !== "all" ||
      sourceUrl.trim() !== "" ||
      flagFilter !== "all" ||
      expirationStatus !== "all"

    const buildFilters = useCallback((): FilterValues => {
      const geminiFilters: { key: string; value: string }[] = []
      const clientFilters: { key: string; value: string }[] = []

      if (sourceType !== "all") {
        geminiFilters.push({ key: "source_type", value: sourceType })
      }
      if (sourceUrl.trim()) {
        geminiFilters.push({ key: "source_url", value: sourceUrl.trim() })
      }
      if (flagFilter !== "all") {
        clientFilters.push({ key: "flags", value: flagFilter })
      }
      if (expirationStatus !== "all") {
        clientFilters.push({
          key: "expiration_status",
          value: expirationStatus,
        })
      }

      return { geminiFilters, clientFilters }
    }, [sourceType, sourceUrl, flagFilter, expirationStatus])

    const resetFilters = useCallback(() => {
      setSourceType("all")
      setSourceUrl("")
      setFlagFilter("all")
      setExpirationStatus("all")
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        getFilters: buildFilters,
        reset: resetFilters,
      }),
      [buildFilters, resetFilters]
    )

    return (
      <div className="rounded-md border">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent/50 transition-colors duration-150 rounded-md"
        >
          <span className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Query Filters
            {hasActiveFilters && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                !
              </span>
            )}
          </span>
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {isOpen && (
          <div className="px-4 pb-4 space-y-4">
            <Separator />

            {/* Gemini-side filters */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Search Filters -- applied during search
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Source Type</label>
                  <Select value={sourceType} onValueChange={setSourceType}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="file">File</SelectItem>
                      <SelectItem value="web">Web</SelectItem>
                      <SelectItem value="youtube">YouTube</SelectItem>
                      <SelectItem value="note">Note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Source URL</label>
                  <Input
                    className="h-9"
                    placeholder="Filter by URL..."
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Client-side filters */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Citation Filters -- applied to results
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Flags</label>
                  <Select value={flagFilter} onValueChange={setFlagFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Expiration Status
                  </label>
                  <Select
                    value={expirationStatus}
                    onValueChange={setExpirationStatus}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="expiring_soon">Expiring soon</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Reset button */}
            {hasActiveFilters && (
              <>
                <Separator />
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    className="text-xs"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear All Filters
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }
)

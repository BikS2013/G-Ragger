import { useRef } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { useAppStore } from "../store"

export function UploadsFilterBar() {
  const uploadFilters = useAppStore((s) => s.uploadFilters)
  const setUploadFilters = useAppStore((s) => s.setUploadFilters)
  const loadUploads = useAppStore((s) => s.loadUploads)
  const channelDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getFilterValue = (key: string): string => {
    const found = uploadFilters.find((f) => f.key === key)
    return found ? found.value : ""
  }

  const getSelectValue = (key: string): string => {
    const found = uploadFilters.find((f) => f.key === key)
    return found ? found.value : "all"
  }

  const updateFilter = (key: string, value: string) => {
    const others = uploadFilters.filter((f) => f.key !== key)
    const next = value === "all" || value === "" ? others : [...others, { key, value }]
    setUploadFilters(next)
    loadUploads()
  }

  const updateChannelFilter = (value: string) => {
    if (channelDebounce.current) clearTimeout(channelDebounce.current)
    channelDebounce.current = setTimeout(() => {
      updateFilter("channel", value)
    }, 400)
  }

  const clearAll = () => {
    setUploadFilters([])
    loadUploads()
  }

  const hasFilters = uploadFilters.length > 0

  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <Select
        value={getSelectValue("source_type")}
        onValueChange={(v) => updateFilter("source_type", v)}
      >
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue placeholder="Source type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="file">File</SelectItem>
          <SelectItem value="web">Web</SelectItem>
          <SelectItem value="youtube">YouTube</SelectItem>
          <SelectItem value="note">Note</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={getSelectValue("flags")}
        onValueChange={(v) => updateFilter("flags", v)}
      >
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue placeholder="Flag" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All flags</SelectItem>
          <SelectItem value="urgent">Urgent</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={getSelectValue("expiration_status")}
        onValueChange={(v) => updateFilter("expiration_status", v)}
      >
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue placeholder="Expiration" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All expiration</SelectItem>
          <SelectItem value="expired">Expired</SelectItem>
          <SelectItem value="expiring_soon">Expiring soon</SelectItem>
        </SelectContent>
      </Select>

      <Input
        placeholder="Channel..."
        defaultValue={getFilterValue("channel")}
        onChange={(e) => updateChannelFilter(e.target.value)}
        className="w-28 h-8 text-xs"
      />

      {/* Date filters grouped together */}
      <div className="flex items-center gap-3 border-l pl-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <Input
            type="date"
            value={getFilterValue("published_from")}
            onChange={(e) => updateFilter("published_from", e.target.value)}
            className="w-32 h-8 text-xs"
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <Input
            type="date"
            value={getFilterValue("published_to")}
            onChange={(e) => updateFilter("published_to", e.target.value)}
            className="w-32 h-8 text-xs"
          />
        </div>
      </div>

      {hasFilters && (
        <Button variant="ghost" onClick={clearAll} size="sm" className="h-8 text-xs transition-colors duration-150">
          Clear all
        </Button>
      )}
    </div>
  )
}

import * as React from "react"
import { type ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Trash2 } from "lucide-react"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { formatDate } from "../../lib/date-format"

// Local mirror matching the store's UploadEntry shape
export interface UploadEntry {
  id: string
  documentName: string
  title: string
  timestamp: string
  sourceType: "file" | "web" | "youtube" | "note"
  sourceUrl: string | null
  expirationDate: string | null
  flags: ("completed" | "urgent" | "inactive")[]
  channelTitle?: string
  publishedAt?: string
}

const sourceVariantMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  file: "default",
  web: "secondary",
  youtube: "destructive",
  note: "outline",
}

const flagVariantMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  urgent: "destructive",
  completed: "secondary",
  inactive: "outline",
}

export function createColumns(onDelete?: (upload: UploadEntry) => void): ColumnDef<UploadEntry>[] {
  return [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.getValue<string>("id").substring(0, 8)}
      </span>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue<string>("title")}</div>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "sourceType",
    header: "Source",
    cell: ({ row }) => {
      const type = row.getValue<string>("sourceType")
      return (
        <Badge variant={sourceVariantMap[type] ?? "outline"} className="text-xs">
          {type}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    id: "date",
    accessorFn: (row) =>
      row.sourceType === "youtube" && row.publishedAt
        ? row.publishedAt
        : row.timestamp,
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="-ml-4"
      >
        Date
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const upload = row.original
      const isPublishDate = upload.sourceType === "youtube" && !!upload.publishedAt
      const dateStr = isPublishDate ? upload.publishedAt! : upload.timestamp
      return (
        <span className="text-sm text-muted-foreground" title={isPublishDate ? "Published date" : "Upload date"}>
          {formatDate(dateStr)}
        </span>
      )
    },
  },
  {
    accessorKey: "flags",
    header: "Flags",
    cell: ({ row }) => {
      const flags = row.getValue<string[]>("flags")
      if (!flags || flags.length === 0) return null
      return (
        <div className="flex flex-wrap gap-1">
          {flags.map((flag) => (
            <Badge
              key={flag}
              variant={flagVariantMap[flag] ?? "secondary"}
              className="text-xs"
            >
              {flag}
            </Badge>
          ))}
        </div>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: "expirationDate",
    header: "Expiration",
    cell: ({ row }) => {
      const date = row.getValue<string | null>("expirationDate")
      if (!date) {
        return <span className="text-xs text-muted-foreground">None</span>
      }

      const now = new Date()
      const exp = new Date(date)
      const daysUntil = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      let colorClass = "text-muted-foreground"
      if (daysUntil < 0) {
        colorClass = "text-destructive font-semibold"
      } else if (daysUntil <= 7) {
        colorClass = "text-warning-foreground font-medium"
      }

      const label =
        daysUntil < 0
          ? `Expired ${Math.abs(daysUntil)}d ago`
          : daysUntil === 0
            ? "Expires today"
            : `${daysUntil}d`

      return <span className={`text-xs ${colorClass}`}>{label}</span>
    },
    enableSorting: false,
  },
  ...(onDelete
    ? [
        {
          id: "actions",
          header: "",
          cell: ({ row }: { row: { original: UploadEntry } }) => (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors duration-150"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onDelete(row.original)
              }}
              title="Delete upload"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ),
          enableSorting: false,
        } as ColumnDef<UploadEntry>,
      ]
    : []),
  ]
}

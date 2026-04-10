# shadcn/ui DataTable Pattern with @tanstack/react-table

## Overview

The shadcn/ui DataTable is not a standalone installable component. It is a **recipe** — a pattern documented on the shadcn/ui site that combines:

- `@tanstack/react-table` (v8) for headless table state and logic
- shadcn/ui `Table`, `Input`, `Button`, `DropdownMenu`, `Checkbox` primitives for rendering
- `flexRender` utility from TanStack Table to render column headers and cells

The pattern gives full control over rendering while keeping all sorting, filtering, and pagination logic in TanStack Table's state model.

Install the required pieces:

```bash
npm install @tanstack/react-table
npx shadcn@latest add table input button dropdown-menu checkbox badge select
```

---

## Key Concepts

### ColumnDef

A `ColumnDef<TData>` object describes each column. Key fields:

| Field | Purpose |
|---|---|
| `accessorKey` | Property path into the row data object |
| `id` | Required when `accessorKey` is absent (e.g., action columns) |
| `header` | String, or a render function receiving `{ column }` |
| `cell` | Render function receiving `{ row, getValue }` |
| `enableSorting` | `false` disables sort on this column |
| `enableHiding` | `false` prevents column from being toggled off |
| `filterFn` | Built-in (`'includesString'`, `'inNumberRange'`) or inline function |

### useReactTable

The single hook that wires everything together. It requires:

- `data` — the array of row objects
- `columns` — array of `ColumnDef`
- `state` — controlled state object (`sorting`, `columnFilters`, etc.)
- `on*Change` — callbacks to update the state
- Row model factories from TanStack Table

### Row Models

Row models are pure functions that transform the data. The ones relevant to this project:

| Factory | Purpose |
|---|---|
| `getCoreRowModel()` | Always required |
| `getFilteredRowModel()` | Enables per-column and global filtering |
| `getSortedRowModel()` | Enables column sorting |
| `getPaginationRowModel()` | Enables pagination (optional for small lists) |

---

## 1. Basic Setup

**File: `src/components/uploads-table/columns.tsx`**

```tsx
import { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"

export type Upload = {
  id: string
  title: string
  source_type: "file" | "web" | "youtube" | "note"
  flags: string[]
  expiration_date?: string
  timestamp: string
}

export const columns: ColumnDef<Upload>[] = [
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("title")}</div>
    ),
  },
  {
    accessorKey: "source_type",
    header: "Source",
    cell: ({ row }) => {
      const type = row.getValue<string>("source_type")
      return <Badge variant="outline">{type}</Badge>
    },
  },
  {
    accessorKey: "flags",
    header: "Flags",
    cell: ({ row }) => {
      const flags = row.getValue<string[]>("flags")
      return (
        <div className="flex gap-1">
          {flags.map((flag) => (
            <Badge key={flag} variant={flag === "urgent" ? "destructive" : "secondary"}>
              {flag}
            </Badge>
          ))}
        </div>
      )
    },
    filterFn: (row, columnId, filterValue: string) => {
      const flags = row.getValue<string[]>(columnId)
      return flags.includes(filterValue)
    },
  },
  {
    accessorKey: "expiration_date",
    header: "Expires",
    cell: ({ row }) => {
      const date = row.getValue<string | undefined>("expiration_date")
      if (!date) return <span className="text-muted-foreground">—</span>
      const isExpired = new Date(date) < new Date()
      return (
        <span className={isExpired ? "text-destructive font-medium" : "text-muted-foreground"}>
          {date}
        </span>
      )
    },
  },
  {
    accessorKey: "timestamp",
    header: "Uploaded",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.getValue("timestamp")).toLocaleDateString()}
      </span>
    ),
  },
]
```

**File: `src/components/uploads-table/data-table.tsx`**

```tsx
"use client"
import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table"
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  onRowClick?: (row: TData) => void
}

export function DataTable<TData>({
  columns,
  data,
  onRowClick,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

---

## 2. External Filter Controls

Filter controls live **outside** the `DataTable` component and communicate with TanStack Table's state via `column.setFilterValue`. The cleanest pattern is to lift the `columnFilters` state up into a parent component and pass a setter down, or keep the table state inside `DataTable` and expose imperative refs. For this project, the simpler approach is to pass filter props directly into `DataTable`.

### Pattern: Pass filter state as props

```tsx
// data-table.tsx — extend the props interface
interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  // External filter values
  titleFilter?: string
  sourceTypeFilter?: string
  flagFilter?: string
}

export function DataTable<TData>({
  columns, data, onRowClick,
  titleFilter, sourceTypeFilter, flagFilter,
}: DataTableProps<TData>) {
  // ...
  const table = useReactTable({ /* same as above */ })

  // Sync external filter props into TanStack column filter state
  React.useEffect(() => {
    table.getColumn("title")?.setFilterValue(titleFilter ?? "")
  }, [titleFilter])

  React.useEffect(() => {
    table.getColumn("source_type")?.setFilterValue(sourceTypeFilter ?? "")
  }, [sourceTypeFilter])

  React.useEffect(() => {
    table.getColumn("flags")?.setFilterValue(flagFilter ?? "")
  }, [flagFilter])
  // ...
}
```

### Filter Bar Component

```tsx
// uploads-filter-bar.tsx
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"

interface FilterBarProps {
  titleFilter: string
  onTitleChange: (v: string) => void
  sourceTypeFilter: string
  onSourceTypeChange: (v: string) => void
  flagFilter: string
  onFlagChange: (v: string) => void
  onClear: () => void
}

export function UploadsFilterBar({
  titleFilter, onTitleChange,
  sourceTypeFilter, onSourceTypeChange,
  flagFilter, onFlagChange,
  onClear,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 py-4">
      <Input
        placeholder="Search title..."
        value={titleFilter}
        onChange={(e) => onTitleChange(e.target.value)}
        className="max-w-xs"
      />
      <Select value={sourceTypeFilter} onValueChange={onSourceTypeChange}>
        <SelectTrigger className="w-36">
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
      <Select value={flagFilter} onValueChange={onFlagChange}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Flag" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All flags</SelectItem>
          <SelectItem value="urgent">Urgent</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  )
}
```

### Parent page wiring

```tsx
// uploads-page.tsx
export function UploadsPage() {
  const [titleFilter, setTitleFilter] = React.useState("")
  const [sourceTypeFilter, setSourceTypeFilter] = React.useState("")
  const [flagFilter, setFlagFilter] = React.useState("")

  const handleRowClick = (upload: Upload) => {
    // Navigate to detail view — depends on router
    navigate(`/uploads/${upload.id}`)
  }

  return (
    <div>
      <UploadsFilterBar
        titleFilter={titleFilter}
        onTitleChange={setTitleFilter}
        sourceTypeFilter={sourceTypeFilter}
        onSourceTypeChange={setSourceTypeFilter}
        flagFilter={flagFilter}
        onFlagChange={setFlagFilter}
        onClear={() => {
          setTitleFilter("")
          setSourceTypeFilter("")
          setFlagFilter("")
        }}
      />
      <DataTable
        columns={columns}
        data={uploads}
        onRowClick={handleRowClick}
        titleFilter={titleFilter}
        sourceTypeFilter={sourceTypeFilter === "all" ? "" : sourceTypeFilter}
        flagFilter={flagFilter === "all" ? "" : flagFilter}
      />
    </div>
  )
}
```

---

## 3. Row Click for Navigation

Row click is not a built-in TanStack Table concept. It is implemented by adding an `onClick` handler directly to the `<TableRow>` element, reading `row.original` to get the full typed data object:

```tsx
<TableRow
  key={row.id}
  onClick={() => onRowClick?.(row.original)}
  className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
>
```

`row.original` contains the raw data object passed in the `data` array, before any accessor transformations. This is the canonical way to retrieve the source record from inside a cell render function or an event handler.

For Electron apps without a router, navigation typically means updating a React state value that controls which view is rendered:

```tsx
// App-level state
const [selectedUploadId, setSelectedUploadId] = React.useState<string | null>(null)

// In UploadsPage
<DataTable
  onRowClick={(upload) => setSelectedUploadId(upload.id)}
  ...
/>

// Conditional render
{selectedUploadId ? (
  <UploadDetail id={selectedUploadId} onBack={() => setSelectedUploadId(null)} />
) : (
  <UploadsPage />
)}
```

---

## 4. Custom Cell Renderers

### Badge for source type

```tsx
{
  accessorKey: "source_type",
  cell: ({ row }) => {
    const type = row.getValue<string>("source_type")
    const variantMap: Record<string, "default" | "secondary" | "outline"> = {
      file: "outline",
      web: "secondary",
      youtube: "destructive",
      note: "default",
    }
    return <Badge variant={variantMap[type] ?? "outline"}>{type}</Badge>
  },
}
```

### Color-coded expiration indicator

```tsx
{
  accessorKey: "expiration_date",
  cell: ({ row }) => {
    const date = row.getValue<string | undefined>("expiration_date")
    if (!date) return <span className="text-muted-foreground text-xs">None</span>

    const now = new Date()
    const exp = new Date(date)
    const daysUntil = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    let colorClass = "text-muted-foreground"
    if (daysUntil < 0) colorClass = "text-destructive font-semibold"
    else if (daysUntil <= 7) colorClass = "text-yellow-600 font-medium"

    const label = daysUntil < 0
      ? `Expired ${Math.abs(daysUntil)}d ago`
      : daysUntil === 0
        ? "Expires today"
        : `${daysUntil}d`

    return <span className={colorClass}>{label}</span>
  },
}
```

### Multi-value flags with badges

```tsx
{
  accessorKey: "flags",
  cell: ({ row }) => {
    const flags = row.getValue<string[]>("flags")
    if (!flags.length) return null
    return (
      <div className="flex flex-wrap gap-1">
        {flags.map((flag) => (
          <Badge
            key={flag}
            variant={flag === "urgent" ? "destructive" : "secondary"}
            className="text-xs"
          >
            {flag}
          </Badge>
        ))}
      </div>
    )
  },
  // Custom filter: row passes if its flags array includes the filter value
  filterFn: (row, columnId, filterValue: string) => {
    if (!filterValue) return true
    return (row.getValue<string[]>(columnId) ?? []).includes(filterValue)
  },
}
```

---

## 5. Column Sorting with Sortable Header

To make a column header clickable for sorting, use `column.toggleSorting` in the header render function:

```tsx
import { ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"

{
  accessorKey: "timestamp",
  header: ({ column }) => (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      Uploaded
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  ),
}
```

`column.getIsSorted()` returns `"asc"`, `"desc"`, or `false`.

---

## 6. TanStack Table Filter API Reference

| API | Use |
|---|---|
| `table.getColumn(id)` | Get column instance by its `accessorKey` or `id` |
| `column.setFilterValue(value)` | Set the filter value for that column |
| `column.getFilterValue()` | Read the current filter value (useful for controlled inputs) |
| `table.setColumnFilters(state)` | Overwrite entire column filter state |
| `table.resetColumnFilters()` | Clear all column filters |
| `column.getCanFilter()` | Whether this column supports filtering |
| `column.getIsFiltered()` | Whether this column currently has an active filter |

---

## 7. Electron-Specific Notes

In an Electron renderer process running React:

- There is no Next.js `"use client"` directive; all components are already client-side. The directive can be omitted.
- For navigation between views, use local React state or a lightweight client router such as `wouter` or `react-router` in memory mode.
- shadcn/ui components work without modification in Electron — they have no server-side dependencies.
- TailwindCSS setup for Electron requires configuring PostCSS and pointing `content` globs at the renderer source files.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| TanStack Table v8 is the version in use (`@tanstack/react-table`) | HIGH | v7 has a different API (`useTable` hook style) |
| Client-side filtering only — no server-side pagination | HIGH | Server-side requires `manualFiltering: true` and custom fetch logic |
| shadcn/ui components installed via CLI, Tailwind configured | HIGH | Components won't render without Tailwind |
| Electron renderer uses React 18 | MEDIUM | Hooks behavior unchanged but concurrent mode may affect some patterns |
| `flags` column stores an array of strings per row | HIGH | Custom `filterFn` must match the actual data shape |
| No row virtualization needed (< ~1000 rows) | MEDIUM | For large lists, `@tanstack/react-virtual` integration is needed |

### Explicitly Out of Scope

- Server-side sorting/filtering/pagination
- Row editing (inline editable cells)
- Column resizing / drag-to-reorder
- Virtual scrolling for large datasets
- Export to CSV/Excel

---

## References

| # | Source | URL |
|---|---|---|
| 1 | shadcn/ui DataTable docs | https://ui.shadcn.com/docs/components/data-table |
| 2 | shadcn/ui Table component | https://ui.shadcn.com/docs/components/table |
| 3 | TanStack Table column filtering guide | https://github.com/tanstack/table/blob/alpha/docs/guide/column-filtering.md |
| 4 | TanStack Table row selection guide | https://github.com/tanstack/table/blob/alpha/docs/guide/row-selection.md |
| 5 | TanStack Table cells guide | https://github.com/tanstack/table/blob/alpha/docs/guide/cells.md |
| 6 | TanStack Table rows guide | https://github.com/tanstack/table/blob/alpha/docs/guide/rows.md |

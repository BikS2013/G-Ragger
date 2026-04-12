# Codebase Scan: Upload Tags Feature

## 1. Project Overview: Directory Layout

```
G-Ragger/
  src/
    cli.ts                          # Command registration (Commander.js)
    types/
      index.ts                      # All domain types: UploadEntry, Flag, UploadOptions, etc.
    config/
      config.ts                     # Configuration loading
    commands/
      upload.ts                     # CLI "upload" command
      channel-scan.ts               # CLI "channel-scan" command
      metadata.ts                   # CLI "flag", "labels", etc. commands
      query.ts                      # CLI "ask" command
      uploads.ts                    # CLI "uploads" listing command
      get.ts                        # CLI "get" command
      workspace.ts                  # CLI workspace CRUD commands
    operations/
      upload-ops.ts                 # Upload pipeline: performUpload, uploadFile, uploadUrl, etc.
      metadata-ops.ts               # updateFlags, getLabels, updateTitle, etc.
      youtube-ops.ts                # channelScan, getTranscript, getNotes, getDescription
      workspace-ops.ts              # Workspace CRUD operations
      query-ops.ts                  # Query execution
      config-ops.ts                 # Config file read/write
      context.ts                    # AppContext factory
    services/
      registry.ts                   # JSON file registry CRUD (addUpload, updateUpload, etc.)
      gemini-client.ts              # Gemini API client
      file-search.ts                # Gemini File Search operations
      content-extractor.ts          # Content extraction from various sources
      notes-generator.ts            # AI notes generation
      youtube-data-api.ts           # YouTube Data API integration
    utils/
      validation.ts                 # validateFlags, validateMimeType, validateDate, etc.
      filters.ts                    # parseFilter, applyFilters, passesClientFilters, etc.
      format.ts                     # Display formatting utilities
  electron-ui/
    src/
      shared/
        ipc-types.ts                # IpcChannelMap: typed IPC contracts
      main/
        main.ts                     # Electron main process entry
        service-bridge.ts           # CLI service initialization for Electron
        ipc-handlers.ts             # All ipcMain.handle() registrations
      preload/
        api.ts                      # window.api bridge (typed)
        preload.ts                  # Context bridge exposure
        index.d.ts                  # Type declarations for window.api
      renderer/src/
        store/index.ts              # Zustand store (state + actions)
        components/
          AddContentDialog.tsx       # 5-tab upload dialog
          UploadsFilterBar.tsx       # Filter bar for uploads listing
          UploadDetail.tsx           # Upload detail/inspector dialog
          QueryFilterPanel.tsx       # Query filter panel (Gemini + client-side)
          UploadsTab.tsx             # Uploads tab (table + filter bar)
          uploads-table/
            columns.tsx             # DataTable column definitions
            data-table.tsx          # Generic DataTable component
          WorkspaceSidebar.tsx
          AskTab.tsx
          ...ui/                    # shadcn/ui primitives
  test_scripts/                     # Test files
  docs/
    design/                         # Plans, project design
    reference/                      # Research, specs, this document
```

## 2. Integration Points: Files and Functions to Modify

### 2.1 Data Model (`src/types/index.ts`)

**UploadEntry interface** (line 11-32) -- add `tags: string[]` field:

```typescript
export interface UploadEntry {
  id: string;
  documentName: string;
  title: string;
  timestamp: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  expirationDate: string | null;
  flags: Flag[];
  channelTitle?: string;
  publishedAt?: string;
  // ADD: tags?: string[];  (optional for backward compat, normalize to [] at read time)
}
```

**UploadOptions interface** (line 187-193) -- add `tag?: string[]`:

```typescript
export interface UploadOptions {
  file?: string;
  url?: string;
  youtube?: string;
  note?: string;
  withNotes?: boolean;
  // ADD: tag?: string[];
}
```

**ChannelScanOptions interface** (line 157-165) -- add `tag?: string[]`:

```typescript
export interface ChannelScanOptions {
  channel: string;
  from: string;
  to: string;
  withNotes?: boolean;
  dryRun?: boolean;
  maxVideos?: number;
  continueOnError?: boolean;
  // ADD: tag?: string[];
}
```

**ClientFilterKey type** (line 127) -- add `'tag'`:

```typescript
export type ClientFilterKey = 'flags' | 'expiration_date' | 'expiration_status';
// CHANGE TO: 'flags' | 'expiration_date' | 'expiration_status' | 'tag'
```

### 2.2 Validation (`src/utils/validation.ts`)

Add `validateTags()` function following the `validateFlags()` pattern (line 86-95):

```typescript
// EXISTING PATTERN:
export function validateFlags(flags: string[]): flags is Flag[] {
  for (const flag of flags) {
    if (!VALID_FLAGS.includes(flag as Flag)) {
      throw new Error(
        `Invalid flag '${flag}'. Allowed values: ${VALID_FLAGS.join(', ')}`
      );
    }
  }
  return true;
}
```

New `validateTags()` must:
- Reject empty strings (after trim)
- Reject strings containing `=`
- Reject strings over 50 characters
- Normalize to lowercase
- Deduplicate
- Return the cleaned array

### 2.3 Filters (`src/utils/filters.ts`)

**CLIENT_FILTER_KEYS** (line 11) -- add `'tag'`:

```typescript
export const CLIENT_FILTER_KEYS = new Set(['flags', 'expiration_date', 'expiration_status']);
// ADD 'tag' to the set
```

**passesClientFilters()** (line 72-109) -- add tag matching in the for-loop:

```typescript
// EXISTING pattern for flags (line 86-89):
if (filter.key === 'flags') {
  if (!upload.flags.includes(filter.value as UploadEntry['flags'][number])) {
    return false;
  }
}
// ADD: similar block for 'tag' key
```

**Important**: For query filters, multiple `tag=` filters use OR logic (any match), but the current `passesClientFilters` loop uses AND logic (all filters must pass). The tag implementation needs special handling: collect all tag filter values, then check if upload has ANY of them.

**parseListingFilter()** (line 116-135) -- add `'tag'` to `validKeys`:

```typescript
const validKeys = new Set(['source_type', 'flags', 'expiration_status', 'channel', 'published_from', 'published_to']);
// ADD 'tag'
```

**applyFilters()** (line 140-185) -- add tag matching branch. Same OR-logic consideration: multiple `tag=` filters should match if upload has ANY of the specified tags.

### 2.4 Upload Operations (`src/operations/upload-ops.ts`)

**performUpload()** (line 33-83) -- accept tags parameter, store in UploadEntry and Gemini custom metadata:

```typescript
// CURRENT signature:
async function performUpload(
  ctx: AppContext,
  workspace: string,
  extracted: ExtractedContent
): Promise<UploadResult>

// CHANGE TO:
async function performUpload(
  ctx: AppContext,
  workspace: string,
  extracted: ExtractedContent,
  tags?: string[]
): Promise<UploadResult>
```

Inside `performUpload`, add tags to:
1. **Gemini custom metadata** (as `stringListValue`):
   ```typescript
   if (tags && tags.length > 0) {
     customMetadata.push({ key: 'tags', stringListValue: { values: tags } });
   }
   ```
2. **UploadEntry** (line 58-69):
   ```typescript
   const entry: UploadEntry = {
     ...
     flags: [],
     tags: tags ?? [],  // ADD
     ...
   };
   ```

**All public upload functions** (`uploadFile`, `uploadUrl`, `uploadYoutube`, `uploadNote`) -- add `tags?: string[]` parameter and pass to `performUpload`.

### 2.5 Metadata Operations (`src/operations/metadata-ops.ts`)

Add `updateTags()` function following the `updateFlags()` pattern (line 65-101):

```typescript
// EXISTING PATTERN:
export function updateFlags(
  workspace: string,
  uploadId: string,
  add?: string[],
  remove?: string[]
): Flag[] {
  if (!add && !remove) {
    throw new Error('At least one of --add or --remove must be provided');
  }
  if (add) validateFlags(add);
  if (remove) validateFlags(remove);

  const ws = getWorkspace(workspace);
  const upload = ws.uploads[uploadId];
  if (!upload) {
    throw new Error(`Upload '${uploadId}' not found in workspace '${workspace}'`);
  }

  let currentFlags: Flag[] = [...upload.flags];
  if (add) {
    for (const flag of add as Flag[]) {
      if (!currentFlags.includes(flag)) {
        currentFlags.push(flag);
      }
    }
  }
  if (remove) {
    const toRemove = new Set(remove as Flag[]);
    currentFlags = currentFlags.filter((f) => !toRemove.has(f));
  }

  updateUpload(workspace, uploadId, { flags: currentFlags });
  return currentFlags;
}
```

New `updateTags()` follows same structure but uses `validateTags()` instead and operates on `string[]` instead of `Flag[]`.

**getLabels()** (line 106-125) -- add tags detection:

```typescript
// ADD after the flags check (line 120):
if (upload.tags && upload.tags.length > 0) labels.add('tags');
```

### 2.6 YouTube Operations (`src/operations/youtube-ops.ts`)

**channelScan()** (line 168-306) -- accept `tags` in options object, store in each upload's UploadEntry:

```typescript
// CURRENT options type (line 174-179):
options: {
  withNotes?: boolean;
  dryRun?: boolean;
  maxVideos?: number;
  continueOnError?: boolean;
}
// ADD: tags?: string[];
```

Inside the scan loop, add tags to:
1. **Gemini custom metadata** (line 246-249) -- add tags entry
2. **UploadEntry construction** (line 262-270) -- add `tags: options.tags ?? []`

### 2.7 Registry Service (`src/services/registry.ts`)

**updateUpload()** (line 163-191) -- extend the `updates` parameter type to include `tags`:

```typescript
// CURRENT:
updates: Partial<Pick<UploadEntry, 'title' | 'expirationDate' | 'flags'>>
// CHANGE TO:
updates: Partial<Pick<UploadEntry, 'title' | 'expirationDate' | 'flags' | 'tags'>>
```

Add handling block:
```typescript
if (updates.tags !== undefined) {
  upload.tags = updates.tags;
}
```

### 2.8 CLI Commands

**`src/commands/upload.ts`** -- add `--tag` option:

```typescript
// ADD after line 23 (.option('--with-notes', ...)):
.option('--tag <tag>', 'Tag to attach (repeatable)', (val, prev) => [...(prev || []), val], [])
```

Pass `options.tag` through to upload functions.

**`src/commands/channel-scan.ts`** -- add `--tag` option, pass to `channelScan()`.

**`src/commands/tag.ts`** (new file) -- follow the `flag` command pattern in `src/commands/metadata.ts` (line 89-111):

```typescript
// EXISTING flag command pattern:
program
  .command('flag')
  .argument('<workspace>', 'Workspace name')
  .argument('<upload-id>', 'Upload UUID')
  .option('--add <flags...>', 'Flags to add')
  .option('--remove <flags...>', 'Flags to remove')
  .action(...)
```

**`src/cli.ts`** -- register the new tag command (import and call).

### 2.9 IPC Types (`electron-ui/src/shared/ipc-types.ts`)

Add `tags?: string[]` to upload channel inputs:

```typescript
// CURRENT (line 128-129):
'upload:file': {
  input: { workspace: string; filePath: string };
// CHANGE TO:
'upload:file': {
  input: { workspace: string; filePath: string; tags?: string[] };

// Same for upload:url, upload:youtube, upload:note, youtube:channelScan
```

Add new channel:

```typescript
'upload:updateTags': {
  input: { workspace: string; uploadId: string; add?: string[]; remove?: string[] };
  output: string[];
};
```

### 2.10 IPC Handlers (`electron-ui/src/main/ipc-handlers.ts`)

Update all upload handlers to pass `input.tags` through. Add new `upload:updateTags` handler.

Example pattern from existing upload handler (line 149-157):

```typescript
ipcMain.handle(
  'upload:file',
  (_event, input: { workspace: string; filePath: string }) =>
    wrap<UploadResultIpc>(async () => {
      const ctx = getContext();
      return uploadFile(ctx, input.workspace, input.filePath);
    })
);
// CHANGE: add input.tags parameter
```

### 2.11 Preload API (`electron-ui/src/preload/api.ts`)

Update upload method signatures to accept `tags?: string[]`. Add `updateTags` method.

### 2.12 Zustand Store (`electron-ui/src/renderer/src/store/index.ts`)

**UploadEntry interface** (line 8-19) -- add `tags?: string[]` field.

**Upload action signatures** -- add `tags?: string[]` parameter to:
- `uploadFile` (line 99)
- `uploadUrl` (line 100)
- `uploadYoutube` (line 101)
- `uploadNote` (line 102)
- `channelScan` (line 103)

**Implementations** (line 346-480) -- pass tags through to API calls.

Add new `updateTags` action.

### 2.13 Electron UI Components

**AddContentDialog.tsx** -- add tag input state + TagInput component to all 5 tabs. Pass tags to upload actions.

**UploadsFilterBar.tsx** -- add tag text input (following the channel input pattern at line 97-102):

```tsx
// EXISTING channel filter pattern:
<Input
  placeholder="Channel..."
  defaultValue={getFilterValue("channel")}
  onChange={(e) => updateChannelFilter(e.target.value)}
  className="w-28 h-8 text-xs"
/>
```

**UploadDetail.tsx** -- add tags display in metadata section (following flags pattern at line 335-351):

```tsx
// EXISTING flags display pattern:
<div className="flex items-center gap-2">
  <span className="w-28 shrink-0 font-medium text-muted-foreground">Flags</span>
  {selectedUpload.flags.length > 0 ? (
    <div className="flex flex-wrap gap-1.5">
      {selectedUpload.flags.map((flag) => (
        <Badge key={flag} variant={flagBadgeVariant(flag)} className="gap-1">
          <Flag className="h-3 w-3" />
          {flag}
        </Badge>
      ))}
    </div>
  ) : (
    <span className="text-muted-foreground">None</span>
  )}
</div>
```

Add inline tag add/remove capability using the `upload:updateTags` IPC channel.

**columns.tsx** -- add Tags column (following the Flags column pattern at line 96-116):

```tsx
// EXISTING flags column pattern:
{
  accessorKey: "flags",
  header: "Flags",
  cell: ({ row }) => {
    const flags = row.getValue<string[]>("flags")
    if (!flags || flags.length === 0) return null
    return (
      <div className="flex flex-wrap gap-1">
        {flags.map((flag) => (
          <Badge key={flag} variant={flagVariantMap[flag] ?? "secondary"} className="text-xs">
            {flag}
          </Badge>
        ))}
      </div>
    )
  },
  enableSorting: false,
}
```

**columns.tsx UploadEntry interface** (line 9-20) -- add `tags?: string[]`.

**QueryFilterPanel.tsx** -- add tag filter input to client-side filters section (line 145-185):

```tsx
// Add a tag input alongside the existing flags and expiration_status selects
```

### 2.14 AskTab.tsx

Pass tag filter through to `executeQuery()` via the QueryFilterPanel.

## 3. Pattern Reference: How Flags Work End-to-End

The `flags` feature is the template for the `tags` implementation. Here is the complete flow:

### 3.1 Type Definition

```typescript
// src/types/index.ts
export type Flag = 'completed' | 'urgent' | 'inactive';
export const VALID_FLAGS: Flag[] = ['completed', 'urgent', 'inactive'];

export interface UploadEntry {
  ...
  flags: Flag[];
  ...
}
```

### 3.2 Validation

```typescript
// src/utils/validation.ts
export function validateFlags(flags: string[]): flags is Flag[] {
  for (const flag of flags) {
    if (!VALID_FLAGS.includes(flag as Flag)) {
      throw new Error(`Invalid flag '${flag}'. Allowed values: ${VALID_FLAGS.join(', ')}`);
    }
  }
  return true;
}
```

### 3.3 Storage at Upload Time

```typescript
// src/operations/upload-ops.ts - performUpload()
const entry: UploadEntry = {
  ...
  flags: [],  // empty at creation
  ...
};
```

Flags are NOT stored in Gemini custom metadata -- only in the local registry. Tags SHOULD be stored in both (per the spec: `stringListValue`).

### 3.4 Post-Upload Modification

```typescript
// src/operations/metadata-ops.ts
export function updateFlags(workspace, uploadId, add?, remove?): Flag[] {
  // 1. Validate inputs
  // 2. Load current entry from registry
  // 3. Add new flags (deduplicate)
  // 4. Remove specified flags
  // 5. Save via updateUpload()
  // 6. Return updated array
}
```

### 3.5 Registry Persistence

```typescript
// src/services/registry.ts
export function updateUpload(workspaceName, uploadId, updates):
  // updates: Partial<Pick<UploadEntry, 'title' | 'expirationDate' | 'flags'>>
  // Merges updates into the existing entry and saves atomically
```

### 3.6 CLI Command

```typescript
// src/commands/metadata.ts - flag command
program.command('flag')
  .argument('<workspace>')
  .argument('<upload-id>')
  .option('--add <flags...>')
  .option('--remove <flags...>')
  .action((workspace, uploadId, options) => {
    const currentFlags = updateFlags(workspace, uploadId, options.add, options.remove);
    console.log(`Flags updated: [${currentFlags.join(', ')}]`);
  });
```

### 3.7 Listing Filter (uploads command)

```typescript
// src/utils/filters.ts
// parseListingFilter() validates 'flags' as a valid key
// applyFilters() checks upload.flags.includes(filter.value)
```

### 3.8 Query Filter (ask command)

```typescript
// src/utils/filters.ts
// CLIENT_FILTER_KEYS includes 'flags'
// parseFilter() classifies 'flags' as layer: 'client'
// passesClientFilters() checks upload.flags.includes(filter.value)
```

### 3.9 Electron Display

```typescript
// columns.tsx - flags column uses Badge with variant mapping
// UploadDetail.tsx - flags shown as Badge chips in metadata section
// UploadsFilterBar.tsx - Select dropdown for flag filtering
// QueryFilterPanel.tsx - Select dropdown for flag filtering in queries
```

## 4. Conventions

### 4.1 Naming

- Types in `src/types/index.ts` use PascalCase interfaces and camelCase fields
- CLI options use kebab-case (`--with-notes`, `--continue-on-error`)
- Filter keys use snake_case (`source_type`, `expiration_status`)
- IPC channels use colon-separated namespaces (`upload:file`, `upload:delete`)
- Operations functions use camelCase verbs (`uploadFile`, `updateFlags`)

### 4.2 Error Handling

- All operations throw `Error` with descriptive messages
- CLI commands catch errors and output via `console.error(`Error: ${message}`)` then `process.exit(1)`
- IPC handlers use `wrap()` helper that catches and returns `{ success: false, error: message }`
- Zustand store actions catch errors and set error state fields

### 4.3 Validation Pattern

- Validation functions throw on invalid input (no fallback values per project convention)
- Validation happens at the command/handler entry point, before calling operations
- Functions return `true` or a typed value on success

### 4.4 IPC Contract Pattern

1. Define input/output types in `electron-ui/src/shared/ipc-types.ts` (IpcChannelMap)
2. Register handler in `electron-ui/src/main/ipc-handlers.ts` using `ipcMain.handle()` + `wrap()`
3. Expose in `electron-ui/src/preload/api.ts` using `ipcRenderer.invoke()`
4. Call from renderer via `window.api.*`
5. Zustand store wraps API calls with loading/error state management

### 4.5 Filter Architecture

Two-layer filtering:
- **Gemini-side** (`GEMINI_FILTER_KEYS`): `source_type`, `source_url` -- passed as AIP-160 metadata filter
- **Client-side** (`CLIENT_FILTER_KEYS`): `flags`, `expiration_status`, `expiration_date` -- applied after Gemini returns results

Tags will be client-side filters (added to `CLIENT_FILTER_KEYS`).

For listing filters (`parseListingFilter` + `applyFilters`), there is a separate valid keys set that includes additional keys like `channel`, `published_from`, `published_to`.

### 4.6 Upload Pipeline

```
CLI command / IPC handler
  --> operations function (uploadFile, uploadUrl, etc.)
    --> content extractor (extractDiskFile, extractWebPage, etc.)
    --> performUpload()
      --> uploadContent() to Gemini (with custom metadata)
      --> addUpload() to local registry
      --> rollback deleteDocument() on registry failure
```

### 4.7 Component State Pattern (Electron UI)

- Each upload dialog tab manages its own local state via `useState`
- Upload actions are called from the store, which sets `isUploading`, `uploadError`
- Success detection: `wasUploadingRef.current && !isUploading && !uploadError` triggers dialog close
- Filter bar uses `updateFilter()` helper that manages the filter array and triggers `loadUploads()`

### 4.8 Backward Compatibility

The `UploadEntry` already has optional fields (`channelTitle?`, `publishedAt?`). Adding `tags` as optional follows the same pattern. Code that reads entries must default to `[]` when `tags` is undefined (defensive deserialization).

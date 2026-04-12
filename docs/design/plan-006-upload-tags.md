# Plan 006: Upload Tags

**Date**: 2026-04-12
**Status**: Ready for Implementation
**Specification**: docs/reference/refined-request-upload-tags.md
**Investigation**: docs/reference/investigation-upload-tags.md
**Codebase Scan**: docs/reference/codebase-scan-upload-tags.md

---

## Overview

Add user-defined string tags to uploads across the full stack: data model, validation, CLI commands, filter/query logic, Electron IPC, and Electron UI. Tags enable flexible categorization (e.g., `"machine-learning"`, `"Q3-review"`) and OR-based filtering.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | Local registry + Gemini metadata (`stringListValue`) | Enables future Gemini-side filtering |
| Multiple tag filter logic | OR (any match) | Better for tag discovery |
| Case sensitivity | Case-insensitive (normalize to lowercase) | Consistent UX |
| Max tags per upload | No limit | Simplicity |
| UI pattern | Chip/badge input with Enter to add, X to remove | Matches spec, reusable component |

---

## Phase 1: Core Data Model + CLI (No UI)

### Task 1.1: Types and Validation

**Files to modify:**

1. **`src/types/index.ts`**
   - Add `tags?: string[]` to `UploadEntry` interface (after `flags` field)
   - Add `tag?: string[]` to `UploadOptions` interface
   - Add `tag?: string[]` to `ChannelScanOptions` interface
   - Add `'tag'` to `ClientFilterKey` type union

2. **`src/utils/validation.ts`**
   - Add `validateTags(tags: string[]): string[]` function:
     - Trim each tag
     - Reject empty strings after trim (throw Error)
     - Reject tags containing `=` (throw Error)
     - Reject tags over 50 characters (throw Error)
     - Normalize to lowercase
     - Deduplicate
     - Return cleaned array

**Dependencies:** None
**Parallelizable:** Yes (types and validation can be written together)

### Task 1.2: Registry Update Support

**Files to modify:**

1. **`src/services/registry.ts`**
   - In `updateUpload()`: extend the `updates` parameter type from `Partial<Pick<UploadEntry, 'title' | 'expirationDate' | 'flags'>>` to include `'tags'`
   - Add handling block for `updates.tags !== undefined`

**Dependencies:** Task 1.1 (needs `tags` on `UploadEntry`)

### Task 1.3: Upload Operations with Gemini Storage

**Files to modify:**

1. **`src/operations/upload-ops.ts`**
   - `performUpload()`: add `tags?: string[]` parameter
     - Push `{ key: 'tags', stringListValue: { values: tags } }` to `customMetadata` when tags present
     - Add `tags: tags ?? []` to the `UploadEntry` construction
   - `uploadFile()`: add `tags?: string[]` param, pass to `performUpload`
   - `uploadUrl()`: add `tags?: string[]` param, pass to `performUpload`
   - `uploadYoutube()`: add `tags?: string[]` param, pass to `performUpload`
   - `uploadNote()`: add `tags?: string[]` param, pass to `performUpload`

2. **`src/operations/youtube-ops.ts`**
   - `channelScan()`: add `tags?: string[]` to options parameter type
     - In the scan loop (around line 246), add tags to `customMetadata` array
     - In `UploadEntry` construction (around line 262), add `tags: options.tags ?? []`

**Dependencies:** Task 1.1, Task 1.2

### Task 1.4: Metadata Operations

**Files to modify:**

1. **`src/operations/metadata-ops.ts`**
   - Add `updateTags(workspace: string, uploadId: string, add?: string[], remove?: string[]): string[]`
     - Follow `updateFlags()` pattern exactly (lines 65-101)
     - Call `validateTags()` on add/remove inputs
     - Use `upload.tags ?? []` for backward compatibility
     - Deduplicate when adding, filter when removing
     - Call `updateUpload()` to persist
     - Return updated tags array
   - In `getLabels()`: add check `if ((upload.tags ?? []).length > 0) labels.add('tags')` after the flags check

**Dependencies:** Task 1.1, Task 1.2

### Task 1.5: Filter Logic with OR Semantics

**Files to modify:**

1. **`src/utils/filters.ts`**
   - Add `'tag'` to `CLIENT_FILTER_KEYS` set
   - In `parseListingFilter()`: add `'tag'` to `validKeys` set
   - In `applyFilters()`: implement pre-grouping OR logic:
     - Before the main filter loop, collect all `tag` filter values into an array (lowercase)
     - Separate non-tag filters from tag filters
     - If tag filters exist: check `(upload.tags ?? []).some(t => tagValues.includes(t.toLowerCase()))` -- reject if false
     - Apply remaining non-tag filters with existing AND logic
   - In `passesClientFilters()`: same pre-grouping pattern:
     - Collect tag filter values
     - Check upload has ANY matching tag (OR within tags, AND with other filters)

**Dependencies:** Task 1.1
**Risk:** OR logic deviation from existing AND-only pattern. Mitigation: pre-grouping isolates the change.

### Task 1.6: CLI Commands

**Files to create:**

1. **`src/commands/tag.ts`** (new file)
   - Follow `flag` command pattern from `src/commands/metadata.ts` (lines 89-111)
   - Register command: `program.command('tag')`
   - Arguments: `<workspace>`, `<upload-id>`
   - Options: `--add <tags...>`, `--remove <tags...>`, `--list`
   - Action: call `updateTags()` from metadata-ops, or display current tags for `--list`
   - Validation: at least one of --add, --remove, or --list required

**Files to modify:**

2. **`src/commands/upload.ts`**
   - Add option: `.option('--tag <tag>', 'Tag to attach (repeatable)', (val, prev) => [...(prev || []), val], [])`
   - Pass `options.tag` through `validateTags()` if present
   - Pass validated tags to each upload function (`uploadFile`, `uploadUrl`, `uploadYoutube`, `uploadNote`)

3. **`src/commands/channel-scan.ts`**
   - Add same `--tag` option as upload command
   - Pass validated tags to `channelScan()` options

4. **`src/cli.ts`**
   - Import and register the new `tag` command: `import { registerTagCommand } from './commands/tag';`
   - Call `registerTagCommand(program)` in the command registration section

**Dependencies:** Task 1.3, Task 1.4, Task 1.5

### Phase 1 Verification

1. **Unit tests** (create `test_scripts/test-tags.ts`):
   - `validateTags()`: empty string, `=` character, >50 chars, case normalization, dedup
   - `applyFilters()` with tag filters: single tag, multiple tags (OR), tags + other filters (AND), no tags on upload, empty tags array
   - `passesClientFilters()` with tag filters: same cases
   - `updateTags()`: add, remove, add+remove, list, backward compat (no tags field)
   - Registry backward compat: load entry without `tags`, verify operations work

2. **CLI smoke tests**:
   ```bash
   # Upload with tags
   geminirag upload test-ws --url https://example.com --tag ml --tag finance
   # List with tag filter
   geminirag uploads test-ws --filter tag=ml
   # Tag management
   geminirag tag test-ws <id> --add urgent-review
   geminirag tag test-ws <id> --list
   geminirag tag test-ws <id> --remove ml
   # Query with tag filter
   geminirag ask test-ws "summary" --filter tag=finance
   # Channel scan with tags
   geminirag channel-scan test-ws --channel @handle --from 2026-01-01 --to 2026-04-01 --tag ai --dry-run
   ```

---

## Phase 2: Electron UI

### Task 2.1: IPC Types and Handlers

**Files to modify:**

1. **`electron-ui/src/shared/ipc-types.ts`**
   - Add `tags?: string[]` to input types of:
     - `upload:file` input
     - `upload:url` input
     - `upload:youtube` input
     - `upload:note` input
     - `youtube:channelScan` input
   - Add new channel:
     ```typescript
     'upload:updateTags': {
       input: { workspace: string; uploadId: string; add?: string[]; remove?: string[] };
       output: string[];
     };
     ```

2. **`electron-ui/src/main/ipc-handlers.ts`**
   - Update all upload handlers to pass `input.tags` to operations functions
   - Add new handler for `upload:updateTags`:
     ```typescript
     ipcMain.handle('upload:updateTags', (_event, input) =>
       wrap<string[]>(async () => {
         return updateTags(input.workspace, input.uploadId, input.add, input.remove);
       })
     );
     ```

3. **`electron-ui/src/preload/api.ts`**
   - Add `tags?: string[]` parameter to `uploadFile`, `uploadUrl`, `uploadYoutube`, `uploadNote`, `channelScan` methods
   - Add `updateTags(workspace: string, uploadId: string, add?: string[], remove?: string[]): Promise<IpcResult<string[]>>` method

4. **`electron-ui/src/preload/index.d.ts`**
   - Update type declarations to match new preload API signatures

**Dependencies:** Phase 1 complete
**Parallelizable:** Yes (ipc-types, handlers, preload can be done together since they follow a known pattern)

### Task 2.2: Zustand Store Updates

**Files to modify:**

1. **`electron-ui/src/renderer/src/store/index.ts`**
   - Add `tags?: string[]` to the local `UploadEntry` interface
   - Add `tags?: string[]` parameter to upload action signatures:
     - `uploadFile(workspace, filePath, tags?)`
     - `uploadUrl(workspace, url, tags?)`
     - `uploadYoutube(workspace, url, withNotes, tags?)`
     - `uploadNote(workspace, text, tags?)`
     - `channelScan(workspace, channel, fromDate, toDate, withNotes, tags?)`
   - Pass tags through to `window.api.*` calls in each implementation
   - Add new action: `updateTags(workspace: string, uploadId: string, add?: string[], remove?: string[]): Promise<string[]>`

**Dependencies:** Task 2.1

### Task 2.3: TagInput Component

**Files to create:**

1. **`electron-ui/src/renderer/src/components/TagInput.tsx`** (new file)
   - Props: `{ tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean; placeholder?: string }`
   - Text input where Enter or comma adds a tag
   - Backspace on empty input removes last tag
   - Tags displayed as `Badge` components (shadcn/ui) with X button to remove
   - Case normalization (lowercase) on add
   - Deduplication on add
   - Validation: reject empty, reject `=`, reject >50 chars (inline error flash)
   - ~60-80 lines of React using existing Badge, Input, X icon from lucide-react

**Dependencies:** None (can be built in parallel with Tasks 2.1-2.2)

### Task 2.4: AddContentDialog Tag Integration

**Files to modify:**

1. **`electron-ui/src/renderer/src/components/AddContentDialog.tsx`**
   - Add `tags` state: `const [tags, setTags] = useState<string[]>([])`
   - Add `<TagInput tags={tags} onChange={setTags} disabled={isUploading} />` to all 5 tabs (File, Web Page, YouTube, Channel Scan, Note)
   - Pass `tags` to each upload action call:
     - `uploadFile(workspace, filePath, tags)`
     - `uploadUrl(workspace, url, tags)`
     - `uploadYoutube(workspace, url, withNotes, tags)`
     - `uploadNote(workspace, text, tags)`
     - `channelScan(workspace, channel, fromDate, toDate, withNotes, tags)`
   - Clear `tags` on dialog close and after successful upload (same as other form state)

**Dependencies:** Task 2.2, Task 2.3

### Task 2.5: Tags Column in Uploads Table

**Files to modify:**

1. **`electron-ui/src/renderer/src/components/uploads-table/columns.tsx`**
   - Add `tags?: string[]` to the local `UploadEntry` interface
   - Add a "Tags" column after the "Flags" column:
     ```typescript
     {
       accessorKey: "tags",
       header: "Tags",
       cell: ({ row }) => {
         const tags = row.getValue<string[]>("tags");
         if (!tags || tags.length === 0) return null;
         return (
           <div className="flex flex-wrap gap-1">
             {tags.map((tag) => (
               <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
             ))}
           </div>
         );
       },
       enableSorting: false,
     }
     ```

**Dependencies:** Task 2.2
**Parallelizable:** Yes (can be done with Tasks 2.4, 2.6, 2.7)

### Task 2.6: Upload Detail Tag Display and Editing

**Files to modify:**

1. **`electron-ui/src/renderer/src/components/UploadDetail.tsx`**
   - Add tags display in metadata section (after flags display, following same Badge pattern)
   - Use `(selectedUpload.tags ?? [])` for backward compatibility
   - Add inline TagInput for add/remove using `updateTags` store action
   - On add: call `updateTags(workspace, uploadId, [newTag])` then refresh
   - On remove (click X on badge): call `updateTags(workspace, uploadId, undefined, [tag])` then refresh

**Dependencies:** Task 2.2, Task 2.3

### Task 2.7: Tag Filter in Upload Filter Bar

**Files to modify:**

1. **`electron-ui/src/renderer/src/components/UploadsFilterBar.tsx`**
   - Add a tag text input following the channel filter pattern:
     ```tsx
     <Input
       placeholder="Tag..."
       defaultValue={getFilterValue("tag")}
       onChange={(e) => updateFilter("tag", e.target.value)}
       className="w-28 h-8 text-xs"
     />
     ```
   - Debounce the input (same as channel filter)
   - Triggers `loadUploads()` via the filter update mechanism

2. **`electron-ui/src/renderer/src/store/index.ts`** (if needed)
   - Ensure filter state handles `tag` key correctly

**Dependencies:** Task 2.2
**Parallelizable:** Yes (can be done with Tasks 2.4, 2.5, 2.6)

### Task 2.8: Tag Filter in Query Panel

**Files to modify:**

1. **`electron-ui/src/renderer/src/components/QueryFilterPanel.tsx`**
   - Add tag text input in the client-side filters section (alongside flags and expiration_status)
   - Follow same pattern as flags filter but with text input instead of select
   - Label: "Tag" with input placeholder "e.g., ml"

2. **`electron-ui/src/renderer/src/components/AskTab.tsx`** (if needed)
   - Ensure tag filter value is passed through to `executeQuery()` via the filter array

**Dependencies:** Task 2.2

### Phase 2 Verification

1. **Build verification**: `cd electron-ui && npm run build` succeeds
2. **IPC type tests** (extend `test_scripts/test-ipc-types.ts`):
   - Verify `upload:updateTags` channel exists in IpcChannelMap
   - Verify all upload channel inputs include `tags?: string[]`
3. **Manual UI testing checklist**:
   - [ ] TagInput: type tag, press Enter -- chip appears
   - [ ] TagInput: press comma -- adds tag
   - [ ] TagInput: click X on chip -- removes tag
   - [ ] TagInput: Backspace on empty input -- removes last tag
   - [ ] TagInput: validation rejects empty, `=`, >50 chars
   - [ ] AddContentDialog: all 5 tabs show TagInput
   - [ ] Upload with tags: tags appear in table Tags column
   - [ ] UploadDetail: tags shown as badges
   - [ ] UploadDetail: can add/remove tags inline
   - [ ] Filter bar: tag filter works
   - [ ] Query panel: tag filter works
   - [ ] Existing uploads without tags: display correctly (no errors)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OR filter logic breaks existing AND semantics | Medium | Medium | Pre-grouping approach isolates tag OR from existing AND loop. Dedicated test cases. |
| Gemini `stringListValue` not indexed for filtering | Medium | Low | Tags are client-side filtered in v1. Stored in Gemini for future server-side use. |
| Backward compat regression (old registry entries) | Low | High | `tags ?? []` at every access point. Test with registry lacking `tags` field. |
| TagInput edge cases (rapid Enter, long strings) | Medium | Low | 50-char limit from validation. Dedup prevents double-add. |
| `=` restriction confuses users | Low | Low | Clear validation error message explaining why. |
| IPC signature changes break existing callers | Low | Medium | `tags` is optional everywhere. Existing callers without tags continue to work. |

---

## Task Dependency Graph

```
Phase 1:
  1.1 Types + Validation ─┬─> 1.2 Registry
                          ├─> 1.3 Upload Ops ──┐
                          ├─> 1.4 Metadata Ops ─┤
                          └─> 1.5 Filters ──────┤
                                                └─> 1.6 CLI Commands

Phase 2 (requires Phase 1 complete):
  2.1 IPC Types/Handlers ─┬─> 2.2 Zustand Store ─┬─> 2.4 AddContentDialog
                          │                       ├─> 2.5 Tags Column
  2.3 TagInput Component ─┤                       ├─> 2.6 UploadDetail
                          │                       ├─> 2.7 Filter Bar
                          │                       └─> 2.8 Query Panel
                          └───────────────────────────────────────────────>
```

**Parallelizable within Phase 1:** Tasks 1.2, 1.3, 1.4, 1.5 can run in parallel after 1.1
**Parallelizable within Phase 2:** Tasks 2.3 can run parallel with 2.1-2.2. Tasks 2.4-2.8 can run in parallel after 2.2+2.3

---

## Estimated Effort

| Phase | Tasks | Estimated Lines Changed | Effort |
|-------|-------|------------------------|--------|
| Phase 1 | 1.1-1.6 | ~300 lines across 10 files + 1 new file | Medium |
| Phase 2 | 2.1-2.8 | ~400 lines across 10 files + 1 new file | Medium |
| Tests | Phase 1 + 2 verification | ~200 lines | Small |
| **Total** | | ~900 lines | **Medium** |

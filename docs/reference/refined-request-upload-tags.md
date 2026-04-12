# Refined Specification: Upload Tags

## Overview

Introduce user-defined string tags on uploads in the G-Ragger project. Unlike the existing `flags` field (a fixed enum of `completed | urgent | inactive`), tags are free-form strings that users attach to uploads for flexible categorization and retrieval. Tags must be supported across the full stack: data model, CLI commands, filter/query logic, Electron IPC layer, and Electron UI.

Tags enable users to organize uploads by topic, project, priority, or any custom dimension (e.g., `"machine-learning"`, `"Q3-review"`, `"competitor-analysis"`), and then filter both listings and queries by those tags.

---

## Functional Requirements

### FR-1: Data Model — Add `tags` Field to `UploadEntry`

Add an optional `tags` field to the `UploadEntry` interface in `src/types/index.ts`.

- **Type**: `string[]` (defaults to `[]` for new uploads, backward-compatible with existing entries that lack the field)
- **Constraints**: Tags are case-sensitive, non-empty strings. No duplicates within a single upload's tag array. No maximum count enforced at the type level.
- **Backward compatibility**: Existing registry entries without `tags` must be treated as having `tags: []` at read time (defensive deserialization).

**Files affected**: `src/types/index.ts` (`UploadEntry` interface)

### FR-2: Tag Validation Utility

Create a validation function for tags (similar to `validateFlags` in `src/utils/validation.ts`).

- Tags must be non-empty strings after trimming.
- Tags must not contain the `=` character (to avoid ambiguity in filter syntax `tag=value`).
- Tags must not exceed 50 characters.
- Tags are normalized to lowercase before storage (case-insensitive).
- Duplicate tags within a single operation should be silently deduplicated.

**Files affected**: `src/utils/validation.ts`

### FR-3: CLI — Tag Assignment During Upload

Extend the `upload` command to accept a `--tag <tag>` option (repeatable) that attaches tags at upload time.

```
geminirag upload my-workspace --url https://example.com --tag ml --tag q3-review
geminirag upload my-workspace --youtube https://youtu.be/abc --tag tutorial --with-notes
geminirag upload my-workspace --file report.pdf --tag finance
geminirag upload my-workspace --note "Some note" --tag reminder
```

- The `--tag` option can appear zero or more times.
- Tags are passed through the operations layer and stored in the `UploadEntry`.

**Files affected**:
- `src/types/index.ts` (`UploadOptions` — add `tag?: string[]`)
- `src/commands/upload.ts` (add `--tag` option, pass to operations)
- `src/operations/upload-ops.ts` (`performUpload` and all public upload functions — accept and store tags)

### FR-4: CLI — Tag Assignment During Channel Scan

Extend the `channel-scan` command to accept `--tag <tag>` (repeatable). All videos uploaded during the scan receive the specified tags.

```
geminirag channel-scan my-workspace --channel @IndyDevDan --from 2026-01-01 --to 2026-04-01 --tag ai-coding --tag indydevdan
```

**Files affected**:
- `src/types/index.ts` (`ChannelScanOptions` — add `tag?: string[]`)
- `src/commands/channel-scan.ts` (add `--tag` option, pass through)
- `src/operations/youtube-ops.ts` (`channelScan` — pass tags to each upload)

### FR-5: CLI — Post-Upload Tag Management

Create a new `tag` CLI command (analogous to the existing `flag` command) for managing tags on existing uploads.

```
geminirag tag <workspace> <upload-id> --add ml finance --remove draft
geminirag tag <workspace> <upload-id> --list
```

- `--add <tags...>`: Add one or more tags (deduplicate against existing).
- `--remove <tags...>`: Remove specified tags.
- `--list`: Display current tags for the upload.
- At least one of `--add`, `--remove`, or `--list` must be provided.

**Files affected**:
- `src/commands/tag.ts` (new file)
- `src/cli.ts` (register the new command)
- `src/operations/metadata-ops.ts` (add `updateTags` function, analogous to `updateFlags`)

### FR-6: CLI — Filtering Uploads by Tag

Extend the `uploads` command to support `--filter tag=<value>` for filtering the upload listing by tag.

```
geminirag uploads my-workspace --filter tag=ml
geminirag uploads my-workspace --filter tag=ml --filter tag=finance
```

- When multiple `tag=` filters are specified, an upload must have ANY of the specified tags (OR logic, better for tag discovery).
- Tag matching is exact (case-sensitive).

**Files affected**:
- `src/utils/filters.ts` (`parseListingFilter` — add `'tag'` to valid keys; `applyFilters` — add tag matching logic)

### FR-7: CLI — Filtering Query Citations by Tag

Extend the `ask` command to support `--filter tag=<value>` as a client-side filter for citations.

```
geminirag ask my-workspace "What are the findings?" --filter tag=ml
```

- Tag filtering is client-side (post-Gemini), matching citation documents against local registry entries (same pattern as `flags` filtering).

**Files affected**:
- `src/utils/filters.ts` (`CLIENT_FILTER_KEYS` — add `'tag'`; `passesClientFilters` — add tag matching)
- `src/types/index.ts` (`ClientFilterKey` — add `'tag'`)

### FR-8: CLI — List All Tags Across Workspace

Extend the `labels` command output to include `tags` when any upload in the workspace has tags. Optionally, add a dedicated `--tags` flag or a `tags` subcommand to list all distinct tags in use across a workspace.

```
geminirag labels my-workspace
# Output includes "tags" if any upload has tags

# Optional: list all distinct tags
geminirag uploads my-workspace --filter tag=*   (or a dedicated command)
```

**Files affected**:
- `src/operations/metadata-ops.ts` (`getLabels` — include `'tags'` when applicable)

### FR-9: Electron IPC — Extend Upload Channels to Accept Tags

Update all upload-related IPC channels to accept an optional `tags` parameter:

- `upload:file` input: add `tags?: string[]`
- `upload:url` input: add `tags?: string[]`
- `upload:youtube` input: add `tags?: string[]`
- `upload:note` input: add `tags?: string[]`
- `youtube:channelScan` input: add `tags?: string[]`

**Files affected**:
- `electron-ui/src/shared/ipc-types.ts` (update `IpcChannelMap` input types)
- `electron-ui/src/main/ipc-handlers.ts` (pass tags through to operations)
- `electron-ui/src/preload/api.ts` (update API bridge signatures)

### FR-10: Electron IPC — Add Tag Management Channel

Add a new IPC channel for managing tags on existing uploads:

- `upload:updateTags` — input: `{ workspace: string; uploadId: string; add?: string[]; remove?: string[] }`, output: `string[]` (updated tags array)

**Files affected**:
- `electron-ui/src/shared/ipc-types.ts` (add channel to `IpcChannelMap`)
- `electron-ui/src/main/ipc-handlers.ts` (add handler)
- `electron-ui/src/preload/api.ts` (add API bridge method)

### FR-11: Electron UI — Tag Input in Upload Dialogs

Add a tag input component to all 5 tabs of the AddContentDialog (File, Web Page, YouTube, Note, Channel Scan).

- UI pattern: a text input where the user types a tag and presses Enter (or comma) to add it. Tags appear as removable chips/badges below the input.
- Tags are passed to the corresponding IPC upload call.
- Tags are cleared when the dialog closes or upload succeeds (same as other form state).

**Files affected**:
- `electron-ui/src/renderer/src/components/AddContentDialog.tsx` (add tag input state and UI to each tab)
- Consider extracting a reusable `TagInput` component (new file: `electron-ui/src/renderer/src/components/TagInput.tsx`)

### FR-12: Electron UI — Tag Display in Upload Detail

Display tags in the upload detail dialog/inspector. Tags should appear as badges/chips.

- If the upload has tags, show them in the metadata section.
- Provide inline add/remove capability (click to remove, input to add) using the `upload:updateTags` IPC channel.

**Files affected**:
- `electron-ui/src/renderer/src/components/UploadDetail.tsx`

### FR-13: Electron UI — Tag Filter in Upload Filter Bar

Add a tag filter to the UploadsFilterBar component.

- UI pattern: a text input (similar to the Channel filter) where the user types a tag name. Debounced, filters the upload list to show only uploads having that tag.
- Multiple tag filters could be supported via comma-separated input or multiple filter entries.

**Files affected**:
- `electron-ui/src/renderer/src/components/UploadsFilterBar.tsx` (add tag filter input)
- `electron-ui/src/renderer/src/store/index.ts` (if filter state needs adjustment)

### FR-14: Electron UI — Tag Filter in Query Panel

Extend the query panel's filter options to include tag filtering (client-side), consistent with CLI behavior.

**Files affected**:
- `electron-ui/src/renderer/src/components/AskTab.tsx`
- `electron-ui/src/renderer/src/store/index.ts` (if query filter state needs adjustment)

### FR-15: Electron UI — Tag Column in Upload Table

Add a "Tags" column to the uploads DataTable showing tag badges. The column should be optional/collapsible if space is limited.

**Files affected**:
- `electron-ui/src/renderer/src/components/UploadsTab.tsx`

### FR-16: Zustand Store — Update Upload Actions

Update the Zustand store's upload actions (`uploadFile`, `uploadUrl`, `uploadYoutube`, `uploadNote`, `channelScan`) to accept and pass through a `tags` parameter.

**Files affected**:
- `electron-ui/src/renderer/src/store/index.ts`

---

## Acceptance Criteria

1. **Data model**: `UploadEntry` includes `tags: string[]`. Existing registry entries without the field are handled gracefully (treated as `[]`).
2. **CLI upload**: `geminirag upload <ws> --file <path> --tag foo --tag bar` creates an upload with `tags: ["foo", "bar"]`.
3. **CLI channel-scan**: `geminirag channel-scan <ws> --channel @handle --from ... --to ... --tag foo` applies the tag to all uploaded videos.
4. **CLI tag management**: `geminirag tag <ws> <id> --add foo --remove bar` updates tags. `geminirag tag <ws> <id> --list` shows current tags.
5. **CLI listing filter**: `geminirag uploads <ws> --filter tag=foo` returns only uploads tagged with "foo".
6. **CLI query filter**: `geminirag ask <ws> "question" --filter tag=foo` filters citations to tagged uploads.
7. **Electron upload dialogs**: All 5 tabs allow specifying tags via a chip/badge input. Tags are persisted on the created upload.
8. **Electron filter bar**: Tag filter input filters the upload list by tag.
9. **Electron upload detail**: Tags are displayed and editable (add/remove) in the upload detail dialog.
10. **Electron query panel**: Tag filter is available in query filters.
11. **Validation**: Empty strings, strings with `=`, and strings over 50 characters are rejected with clear error messages.
12. **Backward compatibility**: Opening a registry created before this feature works without errors or data loss.
13. **No fallback values**: Tag-related configuration (if any) must not use default/fallback values; raise exceptions for missing required config. (Note: tags themselves have no configuration dependency.)

---

## Out of Scope

1. **Tag auto-completion/suggestions**: No server-side or client-side auto-complete for tag names in this iteration.
2. **Tag rename across workspace**: Bulk-renaming a tag across all uploads (like gitter's `--eliminate`) is not included.
3. **Gemini-side tag query filtering**: Although tags are stored in Gemini metadata, query-time tag filtering is done client-side in this iteration. Gemini-side tag filtering during queries could be a future enhancement.
4. **Tag hierarchy or namespacing**: No support for hierarchical tags (e.g., `topic/subtopic`).
5. **Tag-based permissions or access control**: Tags are purely organizational.
6. **Global tag management command**: No `geminirag tags --list-all` or `geminirag tags --eliminate` command across workspaces (could be added later).

---

## Resolved Decisions

1. **Tag storage**: Tags stored in BOTH local registry AND Gemini custom metadata (key: `tags`, type: `stringListValue`). This enables future server-side filtering.
2. **Multiple tag filter semantics**: OR logic — upload must have ANY of the specified tags. Better for tag discovery and browsing.
3. **Tag case sensitivity**: Case-insensitive. Tags are normalized to lowercase on storage. User inputs `"ML"` → stored as `"ml"`.
4. **Maximum tags per upload**: No limit enforced.
5. **Tag display in uploads table**: Tags column visible by default, showing tag badges.

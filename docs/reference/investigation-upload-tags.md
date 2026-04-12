# Investigation: Upload Tags Implementation

## 1. Findings

### 1.1 Gemini `stringListValue` Metadata

**Status: Fully supported, no changes needed to the type system.**

The `CustomMetadataEntry` type in `src/types/index.ts` (lines 94-99) already defines `stringListValue` as an optional field:

```typescript
export interface CustomMetadataEntry {
  key: string;
  stringValue?: string;
  numericValue?: number;
  stringListValue?: { values: string[] };
}
```

The `uploadContent` function in `src/services/file-search.ts` (line 155-163) accepts `customMetadata: CustomMetadataEntry[]` and passes it directly to the Gemini API via `config.customMetadata`. The function uses `as any` cast (line 176-177) which means any valid `CustomMetadataEntry` shape will be forwarded without type issues.

**How tags would be stored in Gemini:**

```typescript
customMetadata.push({ key: 'tags', stringListValue: { values: ['tag1', 'tag2'] } });
```

This is straightforward. There are two upload paths in the code:

1. **Direct upload** (line 171-178): custom metadata is passed in `config.customMetadata`
2. **503 fallback import** (line 234-238): custom metadata is also passed in `config.customMetadata`

Both paths already support the `CustomMetadataEntry[]` array, so tags will flow through naturally.

**Note:** The `channelScan` function in `src/operations/youtube-ops.ts` (lines 246-249) constructs its own `customMetadata` array independently from `performUpload`. Tags must be added in both locations: `performUpload` (upload-ops.ts) and the channel scan loop (youtube-ops.ts, line 246).

### 1.2 Filter OR Logic Implementation

**Status: Requires special handling in two functions. Clean approach identified.**

The current filter architecture uses strict AND logic everywhere:

- **`applyFilters`** (src/utils/filters.ts, lines 140-185): Iterates all filters in a `for` loop. If any filter fails, the upload is rejected (`return false`). This is AND logic.
- **`passesClientFilters`** (src/utils/filters.ts, lines 72-109): Same pattern -- all filters must pass.

**The challenge:** The spec requires OR logic for tags (upload must have ANY of the specified tags) while keeping AND logic for all other filter types.

**Recommended implementation pattern -- pre-grouping approach:**

Before the main filter loop, collect all tag filter values into a set. Then check if the upload has at least one matching tag. This avoids restructuring the existing AND loop.

For `applyFilters`:

```typescript
export function applyFilters(
  uploads: UploadEntry[],
  filters: { key: string; value: string }[]
): UploadEntry[] {
  if (filters.length === 0) return uploads;

  // Pre-group tag filters for OR logic
  const tagValues = filters
    .filter((f) => f.key === 'tag')
    .map((f) => f.value.toLowerCase());
  const nonTagFilters = filters.filter((f) => f.key !== 'tag');

  return uploads.filter((upload) => {
    // Tag filter: OR logic (upload has ANY of the specified tags)
    if (tagValues.length > 0) {
      const uploadTags = (upload.tags ?? []).map((t) => t.toLowerCase());
      if (!tagValues.some((tv) => uploadTags.includes(tv))) {
        return false;
      }
    }

    // All other filters: AND logic (unchanged)
    for (const filter of nonTagFilters) {
      // ... existing filter logic unchanged ...
    }
    return true;
  });
}
```

The same pattern applies to `passesClientFilters` for query-time filtering.

**Relationship between filter groups:** Tags use OR within the tag group, but the tag group itself is ANDed with all other filters. This means: "show me uploads tagged 'ml' OR 'finance' AND source_type='web'" -- which is the expected behavior.

### 1.3 Registry Backward Compatibility

**Status: Simple, one defensive line needed per read site.**

The registry is loaded in `src/services/registry.ts` via `loadRegistry()` (line 16-29). It reads the JSON file and casts directly to `Registry`:

```typescript
const data = fs.readFileSync(REGISTRY_PATH, 'utf-8');
return JSON.parse(data) as Registry;
```

There is no per-field normalization or migration step. Existing entries without `tags` will have `tags: undefined` at runtime.

**Where to add defensive deserialization:**

The project already handles this pattern with optional fields (`channelTitle?`, `publishedAt?`). The convention is to handle it at the point of use rather than at load time.

Best approach: add `tags ?? []` at every point where `upload.tags` is accessed:

1. **`applyFilters`** in filters.ts: `(upload.tags ?? [])`
2. **`passesClientFilters`** in filters.ts: `(upload.tags ?? [])`
3. **`updateTags`** in metadata-ops.ts (new function): `[...(upload.tags ?? [])]`
4. **`getLabels`** in metadata-ops.ts: `(upload.tags ?? []).length > 0`
5. **Electron UI components**: `(upload.tags ?? [])` when rendering

**Alternative -- centralized normalization:** Add a `normalizeUploadEntry` function called once after deserialization in `loadRegistry()`. However, this changes the registry load path and could introduce subtle issues. The existing codebase convention is to handle it at the point of use, so sticking with `tags ?? []` is more consistent.

### 1.4 IPC Type Extension Pattern

**Status: Straightforward. Adding `tags?: string[]` to all upload inputs is a mechanical change.**

The IPC type system in `electron-ui/src/shared/ipc-types.ts` defines input/output types for each channel. Adding `tags?: string[]` to the input types is simple:

**Current patterns and where to add `tags`:**

| Channel | Current input type | Change needed |
|---|---|---|
| `upload:file` (line 127-129) | `{ workspace: string; filePath: string }` | Add `tags?: string[]` |
| `upload:url` (line 131-133) | `{ workspace: string; url: string }` | Add `tags?: string[]` |
| `upload:youtube` (line 135-137) | `{ workspace: string; url: string; withNotes: boolean }` | Add `tags?: string[]` |
| `upload:note` (line 139-141) | `{ workspace: string; text: string }` | Add `tags?: string[]` |
| `youtube:channelScan` (line 143-145) | `{ workspace: string; channel: string; fromDate: string; toDate: string; withNotes: boolean }` | Add `tags?: string[]` |

**New channel to add:**

```typescript
'upload:updateTags': {
  input: { workspace: string; uploadId: string; add?: string[]; remove?: string[] };
  output: string[];
};
```

**IPC handler changes** (ipc-handlers.ts): Each upload handler currently destructures input and calls the corresponding operations function. Adding `input.tags` as a parameter to each call is mechanical. Example for `upload:file`:

```typescript
// Current:
return uploadFile(ctx, input.workspace, input.filePath);
// Changed:
return uploadFile(ctx, input.workspace, input.filePath, input.tags);
```

**Preload API changes** (preload/api.ts): Each upload method needs an additional `tags?: string[]` parameter and must pass it through. Example:

```typescript
// Current:
uploadFile: (workspace: string, filePath: string): Promise<IpcResult<UploadResultIpc>> =>
  ipcRenderer.invoke('upload:file', { workspace, filePath }),
// Changed:
uploadFile: (workspace: string, filePath: string, tags?: string[]): Promise<IpcResult<UploadResultIpc>> =>
  ipcRenderer.invoke('upload:file', { workspace, filePath, tags }),
```

**Zustand store changes** (store/index.ts): The store's `UploadEntry` interface (lines 8-19) is a local mirror and needs `tags?: string[]` added. Each upload action signature needs the tags parameter added and passed through to the API.

**No constraints or blockers identified.** The `tags` field is optional everywhere, so existing callers that don't pass tags will continue to work.

### 1.5 Electron UI Tag Input Patterns

**Three options evaluated:**

#### Option A: Comma-separated text input

A simple text input where the user types comma-separated tags. Parse on submit.

- **Pros:** Simplest implementation, no new components needed.
- **Cons:** Poor UX -- user does not see individual tags, no inline deletion, easy to make formatting mistakes, no visual feedback of what tags are being added.

#### Option B: Chip/badge input with Enter key (RECOMMENDED)

A text input where the user types a tag and presses Enter (or comma) to add it. Tags appear as removable chips/badges below or inline with the input.

- **Pros:** Clear visual feedback, matches the spec's description (FR-11: "Tags appear as removable chips/badges below the input"), consistent with how tags are displayed elsewhere (UploadDetail, columns), familiar UX pattern, reusable as `TagInput` component.
- **Cons:** Requires a new component (~60-80 lines of React). However, it can be built entirely with existing shadcn/ui primitives (Badge, Input, X icon from lucide-react).

**Implementation sketch:**

```tsx
// TagInput.tsx
function TagInput({ tags, onChange, disabled }: Props) {
  const [input, setInput] = useState("");
  
  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  };
  
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };
  
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <X className="h-3 w-3 cursor-pointer" onClick={() => onChange(tags.filter(t => t !== tag))} />
          </Badge>
        ))}
      </div>
      <Input value={input} onChange={...} onKeyDown={handleKeyDown} placeholder="Add tags..." disabled={disabled} />
    </div>
  );
}
```

#### Option C: Select with creatable options (react-select or similar)

A dropdown that allows creating new options on the fly.

- **Pros:** Familiar for users who expect autocomplete.
- **Cons:** Overkill for this iteration (spec explicitly excludes tag auto-completion/suggestions). Adds a dependency. The project uses shadcn/ui with no react-select.

**Recommendation: Option B.** It matches the spec, provides good UX, uses existing components, and the `TagInput` component is reusable across all 5 upload tabs and the UploadDetail dialog.

---

## 2. Recommended Approach

**Follow the `flags` pattern end-to-end, with two specific deviations for tags.**

The flags feature provides a complete, battle-tested template that covers every layer of the stack. The tags implementation should mirror it exactly with these modifications:

1. **Dual storage (local + Gemini):** Unlike flags (local-only), tags are stored in both the local registry and Gemini custom metadata as `stringListValue`. This is already supported by the type system and upload infrastructure.

2. **OR logic for tag filters:** Unlike the AND-only filter logic used for flags, tag filters use OR semantics within the tag group while remaining AND with other filter groups. Implement via pre-grouping before the filter loop.

3. **Case normalization:** Tags are normalized to lowercase on storage. This differs from flags which are a fixed enum.

**Implementation order (recommended):**

1. Types and validation (`src/types/index.ts`, `src/utils/validation.ts`)
2. Registry update support (`src/services/registry.ts`)
3. Upload operations with Gemini storage (`src/operations/upload-ops.ts`, `src/operations/youtube-ops.ts`)
4. Metadata operations -- updateTags, getLabels (`src/operations/metadata-ops.ts`)
5. Filter logic with OR semantics (`src/utils/filters.ts`)
6. CLI commands (`src/commands/tag.ts`, `src/commands/upload.ts`, `src/commands/channel-scan.ts`, `src/cli.ts`)
7. IPC types + handlers + preload (`electron-ui/src/shared/ipc-types.ts`, `ipc-handlers.ts`, `api.ts`)
8. Zustand store (`electron-ui/src/renderer/src/store/index.ts`)
9. UI components: TagInput, AddContentDialog, UploadDetail, UploadsFilterBar, columns, QueryFilterPanel

This order ensures each layer can be tested incrementally without forward dependencies.

---

## 3. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Gemini `stringListValue` not indexed for server-side filtering** | Medium | Low (tags are client-side filtered in this iteration) | The spec explicitly states tag filtering is client-side. Server-side Gemini filtering can be explored in a future iteration. Store tags in Gemini now to enable it later. |
| **OR logic introduces subtle filter interaction bugs** | Medium | Medium | Pre-grouping approach isolates tag OR logic from existing AND logic. Add dedicated test cases for: tags-only, tags+other filters, empty tags, no tags on upload. |
| **Backward compatibility regression** | Low | High | Use `tags ?? []` at every access point. Add a test that loads a registry JSON without any `tags` fields and verifies all operations work. |
| **Channel scan performance with tags** | Low | Low | Tags are small string arrays. Adding them to Gemini custom metadata adds negligible overhead per upload. |
| **UI TagInput component edge cases** | Medium | Low | Handle: empty string submission, duplicate prevention, rapid Enter key presses, Backspace to delete last tag, very long tag strings (50-char limit from validation). |
| **Tag `=` character restriction confuses users** | Low | Low | Display clear validation error message. The `=` restriction exists because `tag=value` is the filter syntax and `=` inside a tag would break parsing. |

---

## 4. Technical Research Guidance

**Research needed: No**

All five investigation topics have been fully resolved through direct source code inspection. The codebase already provides complete support for every aspect of the tags feature:

- The `CustomMetadataEntry` type already includes `stringListValue` (verified in src/types/index.ts, line 98)
- The upload pipeline already passes custom metadata arrays to Gemini (verified in src/services/file-search.ts and src/operations/upload-ops.ts)
- The filter architecture is well-understood, and the pre-grouping approach for OR logic is a clean, self-contained change
- The IPC contract pattern is mechanical and fully documented
- The UI component approach uses only existing dependencies (shadcn/ui Badge, Input, lucide-react icons)

No external API documentation, library research, or experimental spikes are required. The implementation can proceed directly from this investigation.

| Topic | Research needed | Rationale |
|---|---|---|
| Gemini stringListValue metadata | No | Type already defined, upload paths verified, both primary and fallback paths support it |
| Filter OR logic | No | Approach designed and validated against existing code; pre-grouping pattern is isolated and testable |
| Registry backward compatibility | No | Existing pattern (`channelTitle?`, `publishedAt?`) provides proven convention; `?? []` is sufficient |
| IPC type extension | No | All 5 upload channels and preload API inspected; adding optional parameter is mechanical |
| UI tag input pattern | No | Can be built with existing shadcn/ui primitives; no new dependencies needed |

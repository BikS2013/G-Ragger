# GeminiRAG - Issues & Pending Items

**Last Updated**: 2026-04-10

---

## Pending Items

### Medium (Electron UI)

15. **CitationList does not navigate to upload detail view**: FR-05.5 requires that clicking a citation navigates to the corresponding upload's detail view (UploadDetail dialog). The current `CitationList` component only toggles a local `selectedIndex` state for visual highlighting but does not call `selectUpload()` on the store. This requires matching the citation's document URI to a local registry entry, which would need a new IPC channel or logic to resolve citation URIs to upload entries.

16. **`WorkspaceDetail` IPC type missing `storeName` field**: The design document (Section 15.2.1) specifies `storeName: string` in `WorkspaceDetail`, but the implemented `ipc-types.ts` omits it. While not needed by any current component, it would be useful for debugging information in the UI.

17. **`components.json` (shadcn/ui config) not created**: The plan (Phase 1) specifies a `components.json` file for shadcn/ui configuration. All shadcn/ui components were added manually, so this is not blocking but means `npx shadcn@latest add` cannot be used to add new components in the future.

### Low (Test Suite)

18. **Config test `GEMINI_MODEL` missing tests fail when `~/.geminirag/config.json` has GEMINI_MODEL**: The `test-config.ts` tests for "throws when GEMINI_MODEL is missing" and "throws with descriptive message for missing model" fail because `withCleanEnv()` only clears environment variables but does not prevent `loadConfig()` from reading GEMINI_MODEL from the config file at `~/.geminirag/config.json`. The test should either mock the config file or temporarily rename it during these tests.

### Medium (V2 Review)

9. **`YouTubeVideoMetadata` missing `videoUrl` field from design**: The design (V2.1.5) specifies a `videoUrl: string` field on `YouTubeVideoMetadata`, but the implementation omits it. The channel-scan command reconstructs URLs inline via `https://www.youtube.com/watch?v=${video.videoId}`. Adding the field would reduce duplication and align with the design.

10. **YouTube Data API: `resolveChannelId` and `getUploadsPlaylistId` use separate API calls**: The design (V2.2.1) specifies a single combined `resolveChannel()` function that calls `channels.list?part=id,snippet,contentDetails` once, returning both the channel ID and the uploads playlist ID. The implementation uses two separate functions and two separate API calls (one for `snippet`, one for `contentDetails`), costing 2 quota units instead of 1.

11. **`NotesContent` interface not used**: The `NotesContent` interface in `types/index.ts` differs from the design (uses `definition` instead of `context`, missing `actionItems` and `rawMarkdown` fields) and is never referenced by any code. The notes generator returns raw Markdown strings directly, bypassing structured parsing. Consider removing the unused interface or aligning it with the design.

12. **`UploadEntry` missing optional `contentPreview` field from design**: Design V2.1.4 adds `contentPreview?: string` to `UploadEntry`. The implementation does not include this field. Since it is optional, no breakage occurs, but the design intent (preview in `get` command display) is not fulfilled.

13. **`formatChannelScanTable` function not implemented**: Design V2.8 specifies a `formatChannelScanTable()` utility in `format.ts`, but the channel-scan command builds its dry-run table inline instead of using a shared formatter.

14. **Rate limiting differs from design specification**: Design V2.9.2 specifies 1.5s base + 500ms jitter (1.0-2.0s range). Implementation uses 2.0s base + 1.0s jitter (2.0-3.0s range). The implementation is more conservative, which is acceptable but deviates from the spec.

### Critical

1. **SDK Bug #1211 Status Unknown for v1.49.0**: The polling bug (`operations.get()` returns incomplete object) was reported against SDK v1.34.0. It is unconfirmed whether v1.49.0 has fixed it. The workaround (check initial `response.documentName`) is implemented in the design but should be empirically tested during Phase 3 implementation.

2. **503 Error for Large Files Status Unknown**: The 503 error for files >10KB via `uploadToFileSearchStore` was reported in late 2025. It may be silently fixed. The fallback pathway (Files API + Import) is designed but should be validated during Phase 3 implementation.

### Medium

3. **`string_list_value` Filter Support Unconfirmed**: AIP-160 `:` (has) operator for `string_list_value` metadata is theoretically applicable but unconfirmed for Gemini File Search. The design keeps flags local-only. Consider running the empirical test in the Appendix of `research-string-list-filters.md` to confirm.

4. **`Document.metadata` Field Shape Uncertain**: The `metadata` field returned by `documents.list()` may not match the structured `customMetadata` set at upload time. The design stores `source_type`/`source_url` in both Gemini-side metadata and local registry, so functionality is not affected, but citation cross-referencing may need adjustment.

5. **Gemini 2.0 Model EOL (June 2026)**: Users with `gemini-2.0-flash` or `gemini-2.0-flash-lite` in their config will face breakage after June 2026. The configuration guide should prominently recommend 2.5+ models.

6. **`ask` command multi-workspace UX deviates from spec**: The specification (AC-18) defines multi-workspace queries as `geminirag ask ws1 ws2 "question"` (positional variadic args). The implementation uses `geminirag ask ws1 "question" --workspace ws2` (flag-based additional workspaces). This is a pragmatic Commander.js limitation and is functionally equivalent, but the CLI syntax differs from the acceptance criteria example. Consider documenting this deviation.

### Low

7. **`text/markdown` vs `text/plain` Indexing Difference**: It is unknown whether the Gemini embedding pipeline treats `text/markdown` differently from `text/plain`. The design uses `text/markdown` for web content and `text/plain` for transcripts/notes. Both should work correctly regardless.

8. **No startup API key expiration check for local-only commands**: The design (Section 4.1 of project-design.md) specifies that `cli.ts` should check API key expiration before any command runs. In the current implementation, the expiration check happens inside `loadConfig()`, which is only called by commands that need the Gemini API. Local-only commands (`list`, `info`, `uploads`, `labels`, `update-title`, `set-expiration`, `clear-expiration`, `flag`) do not trigger the check. This is arguably correct behavior (no API key needed for local operations) but deviates from the literal design specification.

---

## Completed Items

### Electron UI Code Review (2026-04-10)

1. **[FIXED] Store IPC method name mismatch (CRITICAL)**: The Zustand store used a flat `getApi()` helper returning `Record<string, Function>` and called non-existent method names like `api.validateConfig()`, `api.listWorkspaces()`, `api.listUploads()`, `api.getUploadContent()`, `api.downloadUpload()`, `api.askQuery()`. The actual preload API exposes a nested structure (`api.config.validate()`, `api.workspace.list()`, `api.upload.list()`, etc.). Every IPC call would have thrown `undefined is not a function` at runtime. Fixed by changing `getApi()` to return `typeof window.api` and rewriting all IPC calls to match the preload API's nested structure.

2. **[FIXED] Download default extension `.txt` instead of `.md`**: FR-04.4 specifies the default filename as `{title}.md`, but the `upload:download` IPC handler used `.txt`. Fixed to default to `.md` with Markdown as the primary file type filter.

3. **[FIXED] Source URL not clickable in UploadDetail**: FR-03.1 requires the source URL to be clickable, opening in the external browser. The UploadDetail component rendered the URL as a non-interactive `<span>`. Fixed by adding a `shell:openExternal` IPC channel (with URL protocol validation to prevent command injection), updating the preload API, and wiring the URL as a clickable button that calls `window.api.shell.openExternal()`.

4. **[FIXED] Unsafe type cast in `sourceTypeBadgeVariant`**: The UploadDetail component used `"destructive" as unknown as "default"` for the YouTube source type badge variant, an unsafe double-cast to bypass TypeScript. Fixed by correcting the return type to include `"destructive"` in the union.

5. **[FIXED] QueryFilterPanel missing `expiring_soon` option**: FR-06.3 specifies client-side filter options including `expiring_soon` for expiration status. The `QueryFilterPanel` component only offered "All" and "Expired" but omitted "Expiring soon". Fixed by adding the missing `<SelectItem value="expiring_soon">` option.

### V2 Code Review (2026-04-10)

4. **[FIXED] `formatUploadMetadataHeader` deviates from spec format**: The metadata header used `--- ... ---` delimiters and different field ordering/naming from the spec (Section 2.3) and design (V2.8). Fixed to use `=== Upload Metadata ===` and `=== Content ===` delimiters, correct field order (Title, ID, Source Type, Source URL, Uploaded, Expiration, Flags, Document), and added the missing `Document:` field.

5. **[FIXED] `getDocumentContent` prompt uses resource path instead of display name**: The retrieval prompt passed the raw Gemini document resource name (e.g., `fileSearchStores/.../documents/...`) instead of a human-readable title. Fixed to accept an optional `displayName` parameter and use the design-specified prompt wording for verbatim reproduction.

### Code Review (2026-04-10)

1. **[FIXED] Error messages in `content-extractor.ts` missing quoted URL values**: Several error messages in `extractWebPage` and `extractYouTube` did not wrap the URL in single quotes as specified in Section 9.2 of the design document. The `extractWebPage` fetch error also omitted the URL itself from the message. Fixed to match the spec pattern `'<url>'`.

2. **[FIXED] `formatWorkspaceInfo` missing "metadata labels in use"**: FR-05 and AC-03 require the workspace info display to show metadata labels in use. The `formatWorkspaceInfo` function in `format.ts` did not include this information. Added label collection and display at the end of the info output.

### Upload Features Code Review (2026-04-10)

6. **[FIXED] `AddContentDialog.handleBrowse` accessed IpcResult properties incorrectly**: The file browse handler called `window.api.dialog.openFile()` which returns `IpcResult<{filePath, fileName} | null>`, but accessed `result.filePath` and `result.fileName` directly instead of first checking `result.success` and reading from `result.data`. This would have caused a runtime error when the user clicked the Browse button. Fixed to check `result.success` and access `result.data.filePath` / `result.data.fileName`.

### Integration Verification (2026-04-10)

3. **[FIXED] `youtube-transcript` ESM import failure**: The `youtube-transcript@1.3.0` package declares `"type": "module"` in its package.json but resolves to its CJS entry (`main: dist/youtube-transcript.common.js`) at runtime under Node.js ESM resolution. CJS modules loaded as ESM do not expose named exports, causing `import { YoutubeTranscript } from 'youtube-transcript'` to fail with `SyntaxError: does not provide an export named 'YoutubeTranscript'`. Fixed by using `createRequire(import.meta.url)` to load the CJS module directly, which correctly provides the named exports. The fix passes both `tsc --noEmit` type checking and runtime execution.

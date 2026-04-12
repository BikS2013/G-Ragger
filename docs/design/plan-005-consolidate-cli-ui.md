# Plan 005: Consolidate GeminiRAG CLI + G-Ragger Electron UI under single `g-ragger` command

## Context

Currently the project has two separate entry points:
- `geminirag` CLI (root `src/cli.ts` + `src/commands/`)  
- `g-ragger` Electron launcher (in `electron-ui/`)

The business logic is duplicated: CLI commands in `src/commands/*.ts` each call services directly (load config, create client, call service, format output), and `electron-ui/src/main/ipc-handlers.ts` reimplements the same logic wrapped in IPC handlers with `IpcResult<T>` wrappers.

**Goal**: One `g-ragger` command where `g-ragger ui` launches Electron and all other subcommands are the existing CLI commands. Deduplicate the business logic into a shared operations layer.

## Architecture

### New operations layer: `src/operations/`

Extract the business logic from both CLI commands and IPC handlers into pure async functions that:
- Accept typed input params
- Return typed results (or throw on error)  
- Have no console.log/process.exit (those are caller concerns)

Files:
- `src/operations/workspace-ops.ts` — createWorkspace, deleteWorkspace, listWorkspaces, getWorkspaceDetail
- `src/operations/upload-ops.ts` — uploadFile, uploadUrl, uploadYoutube, uploadNote, deleteUpload, listUploads, getUploadContent
- `src/operations/query-ops.ts` — queryWorkspace
- `src/operations/metadata-ops.ts` — updateTitle, remove, setExpiration, clearExpiration, flag, labels
- `src/operations/youtube-ops.ts` — getTranscript, getNotes, getDescription, channelScan
- `src/operations/config-ops.ts` — getConfigFile, saveConfigFile
- `src/operations/context.ts` — AppContext type (holds config + client), createContext()

### Shared context pattern

```ts
// src/operations/context.ts
export interface AppContext {
  config: AppConfig;
  client: GoogleGenAI;
}

export function createContext(): AppContext {
  const config = loadConfig();
  const client = createGeminiClient(config);
  return { config, client };
}
```

CLI commands call `createContext()` per invocation. The Electron service-bridge caches it.

### CLI entry point change: `src/cli.ts`

- Rename `geminirag` to `g-ragger`
- Add `ui` subcommand that spawns the Electron process (logic from current `electron-ui/bin/g-ragger.mjs`)
- All existing commands stay as subcommands
- Each command handler becomes thin: parse args → call operation → format + print (or handle error)

### Electron IPC handlers simplification

`ipc-handlers.ts` becomes thin wrappers: parse IPC input → call shared operation → wrap in `IpcResult<T>`. The 900-line file should shrink to ~300 lines.

### Launcher: `electron-ui/bin/g-ragger.mjs` → removed

The Electron launch logic moves into the CLI's `ui` command.

### Root `package.json` changes

- Add `"bin": { "g-ragger": "dist/cli.js" }` (replace `geminirag`)
- Keep existing build scripts

## Files to create

1. `src/operations/context.ts`
2. `src/operations/workspace-ops.ts`
3. `src/operations/upload-ops.ts`
4. `src/operations/query-ops.ts`
5. `src/operations/metadata-ops.ts`
6. `src/operations/youtube-ops.ts`
7. `src/operations/config-ops.ts`

## Files to modify

1. `src/cli.ts` — rename to g-ragger, add `ui` command
2. `src/commands/workspace.ts` — thin wrapper calling workspace-ops
3. `src/commands/upload.ts` — thin wrapper calling upload-ops
4. `src/commands/query.ts` — thin wrapper calling query-ops
5. `src/commands/metadata.ts` — thin wrapper calling metadata-ops
6. `src/commands/channel-scan.ts` — thin wrapper calling youtube-ops
7. `src/commands/get.ts` — thin wrapper calling upload-ops + youtube-ops
8. `electron-ui/src/main/ipc-handlers.ts` — thin wrappers calling operations
9. `electron-ui/src/main/service-bridge.ts` — use AppContext from operations/context
10. `package.json` — bin: g-ragger
11. `electron-ui/package.json` — remove bin entry (no longer separate launcher)
12. `CLAUDE.md` — consolidate tool documentation

## Files to delete

1. `electron-ui/bin/g-ragger.mjs`

## Implementation order

1. Create `src/operations/context.ts`
2. Create all operation files, extracting logic from CLI commands + IPC handlers
3. Refactor CLI commands to use operations
4. Refactor IPC handlers to use operations
5. Add `ui` subcommand to CLI
6. Update package.json bin entries
7. Remove old launcher
8. Update CLAUDE.md
9. npm unlink old; npm link new
10. Test: `g-ragger list`, `g-ragger ui`, etc.

## Verification

1. `npx tsx src/cli.ts list` — should list workspaces
2. `npx tsx src/cli.ts ui` — should launch Electron app
3. `cd electron-ui && npm run dev` — Electron dev mode still works
4. Run existing test scripts to verify no regressions
5. `npm link` from root → `g-ragger list` and `g-ragger ui` work globally

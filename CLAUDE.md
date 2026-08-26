<structure-and-conventions>
## Structure & Conventions — Documentation Map

<!-- Maintained automatically. The master copy lives at
     ~/.claude/structure-and-conventions.md (claude-workdocs repo) and the SessionStart
     hook ~/.claude/scripts/sync-claude-md.sh keeps this copy of the block up to date —
     edit the master, never this block. The block is committed with the repository on
     purpose: it tells anyone (human or agent) working with this repo where the
     project's documentation lives and how to read and maintain it. -->

### Where the documentation lives

- `docs/design/` — all planning and design documents:
  - `plan-NNN-<indicative-description>.md` — one file per plan.
  - `project-design.md` — the complete, always-current project design; update it with every new design or design change.
  - `project-functions.md` — the registry of all functional requirements and feature descriptions.
  - `configuration-guide.md` — the project's configuration guide, when one exists (structure below).
- `docs/reference/` — all reference material collected for the project.
- `docs/tools/<tool-name>.md` — one dedicated documentation file per project tool.
- `test_scripts/` — every test script goes here; create the folder if it doesn't exist.
- `prompts/` — every prompt created while working on the project (create the folder if missing); each file name has a sequential number prefix and describes the prompt's use and purpose.
- `Issues - Pending Items.md` (project root) — the register of every issue, pending item, inconsistency, or discrepancy detected while working on the project. Pending items come first (most critical and important on top), completed items after. Whenever a defect or issue is fixed, check this file for an item to remove.

### How to use the documentation

- Every time an issue is solved, it must be resolved AND both the issue and the solution must be thoroughly documented.
- This file's "Tools" section (when present) lists each project tool with a one-or-two-sentence description of what it is capable of and the relative path to its dedicated documentation file under `docs/tools/` — retrieve the full documentation from there whenever it is needed. Full tool documentation must never be inlined into this file.
- Before writing any code script, consult the "Tools" section and the documentation under `docs/tools/` to check whether the planned code fits the scope of an existing tool. If so, implement it as an extension of that tool; otherwise build a generic, abstract version of the code as a new tool in the project's toolset, document it under `docs/tools/`, and reference it in the "Tools" section. The goal is to progressively grow the tools needed to test, evaluate, generate data, collect information, etc., and reuse them consistently.

<configuration-guide>
- A configuration guide, when requested, is created at `docs/design/configuration-guide.md` and explains:
  - When multiple configuration options exist (config file, env variables, CLI params, etc.), what the options are and the priority of each one.
  - The purpose and use of each configuration variable.
  - How the user can obtain such a configuration variable.
  - The recommended approach for storing or managing the variable.
  - Which options exist for the variable and what each option means for the project.
  - Any default value the parameter has.
  - For configuration parameters that expire (e.g., PAT keys, tokens), propose adding a parameter that captures the expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

</structure-and-conventions>

# G-Ragger - Workspace-Based Document Search Tool

## Project Overview
A unified TypeScript CLI + Electron desktop application that uses the Google Gemini File Search API to create workspaces for uploading, indexing, and searching documents. The `g-ragger` command provides both CLI subcommands and a `ui` subcommand that launches the Electron desktop app. Supports uploading from disk files, web pages, YouTube videos, and personal notes. Each upload has metadata (timestamp, title, expiration, status flags) that can be used as filters when querying.

## Architecture
Business logic lives in `src/operations/` — pure async functions shared by both
the CLI commands (`src/commands/`) and the Electron IPC handlers (`electron-ui/src/main/ipc-handlers.ts`).
Both use the same `AppContext` (config + Gemini client) from `src/operations/context.ts`.

## Tools

- **g-ragger** — Unified CLI + Electron desktop application for workspace-based document management and semantic search powered by the Google Gemini File Search API. Supports uploading files, web pages, YouTube videos, and notes; tags, metadata filtering, expiration tracking; natural-language queries with citations; the `ui` subcommand launches the desktop application. Full documentation: [`docs/tools/g-ragger.md`](docs/tools/g-ragger.md).

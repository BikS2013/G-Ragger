# G-Ragger

> Workspace-based document search and management powered by the Google Gemini File Search API.

G-Ragger is a unified TypeScript CLI **plus** Electron desktop application that lets you create
named workspaces, upload documents from many sources (local files, web pages, YouTube videos,
personal notes), tag and filter them, and ask natural-language questions across the indexed
content with citations.

The single `g-ragger` command gives you both surfaces:

- A scriptable **CLI** for power users and automation.
- A graphical **desktop app** (`g-ragger ui`) for everyday browsing and querying.

---

## Highlights

- **One command, two surfaces.** CLI subcommands and a full Electron UI behind the same binary.
- **Multi-source uploads.** Files, web pages, YouTube videos (with transcripts and AI-generated
  notes), and personal notes — all in one workspace.
- **Rich metadata.** Tags, expiration dates, status flags, source-type filters, channel and
  publish-date filters for YouTube uploads.
- **Semantic search with citations.** Ask questions across one or many workspaces and get answers
  grounded in your uploaded content.
- **YouTube channel scanning.** Bulk-import every video from a channel within a date range,
  optionally generating AI notes per video.
- **AI reports.** Generate detailed analyses combining transcript and description using a
  user-editable prompt template.

---

## Prerequisites

- **Node.js 18+**
- **Google AI Studio API key** — required.
  Obtain at: <https://aistudio.google.com/apikey>
- **YouTube Data API v3 key** — optional, required only for `channel-scan` and direct video
  description retrieval.
  Obtain at: <https://console.cloud.google.com/apis/credentials>

---

## Install

Clone the repo and link the CLI globally:

```bash
git clone <repo-url> g-ragger
cd g-ragger
npm install
npm run build
npm link
```

After `npm link`, the `g-ragger` command is available on your `PATH`.

For development without a global install, use `npx tsx src/cli.ts <command>` from the
project root.

---

## Configure

G-Ragger reads configuration from a four-tier chain (highest priority last):

1. Shell environment variables
2. `~/.tool-agents/g-ragger/.env`   *(tool-level secrets, mode `0600`)*
3. Local `.env` in the current working directory
4. CLI flags

Required variables:

| Variable                  | Purpose                                                                 |
|---------------------------|-------------------------------------------------------------------------|
| `GOOGLE_API_KEY`          | Gemini / Google AI Studio API key (canonical name).                      |
| `GEMINI_API_KEY`          | Accepted alias for `GOOGLE_API_KEY` (legacy).                            |
| `GEMINI_MODEL`            | Model id, e.g. `gemini-2.5-flash`.                                       |

Optional variables:

| Variable                          | Purpose                                                      |
|-----------------------------------|--------------------------------------------------------------|
| `GOOGLE_API_KEY_EXPIRATION`       | `YYYY-MM-DD`. Warns when the key is near expiry.             |
| `YOUTUBE_DATA_API_KEY`            | Required for `channel-scan` and direct video description.    |
| `YOUTUBE_DATA_API_KEY_EXPIRATION` | `YYYY-MM-DD`. Warns when the YouTube key is near expiry.     |
| `DATE_FORMAT`                     | `DD/MM/YYYY` (default), `MM/DD/YYYY`, or `YYYY-MM-DD`.       |
| `THEME`                           | `light` (default), `dark`, or `system`.                      |

A minimal `~/.tool-agents/g-ragger/.env` looks like:

```bash
# Required
GOOGLE_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-2.5-flash

# Optional
# YOUTUBE_DATA_API_KEY=your-youtube-key
# DATE_FORMAT=DD/MM/YYYY
# THEME=system
```

> **Note.** G-Ragger never substitutes a missing required value with a default — if
> `GOOGLE_API_KEY` or `GEMINI_MODEL` is absent across all four tiers, the tool fails fast with
> a clear error.

See [`docs/design/configuration-guide.md`](docs/design/configuration-guide.md) (when present)
for the full breakdown and security recommendations.

---

## CLI Quickstart

```bash
# Create a workspace
g-ragger create my-research

# Upload content
g-ragger upload my-research --file ~/docs/report.pdf
g-ragger upload my-research --url https://example.com/article
g-ragger upload my-research --youtube https://youtu.be/abc123 --with-notes
g-ragger upload my-research --note "Remember to check the Q3 results"

# Browse
g-ragger uploads my-research
g-ragger uploads my-research --filter source_type=youtube

# Ask
g-ragger ask my-research "What are the key findings?"
g-ragger ask my-research "Summary" --filter tag=ml
```

A full command reference, filter syntax, and every option is in
[`docs/tools/g-ragger.md`](docs/tools/g-ragger.md).

---

## Desktop UI Quickstart

```bash
g-ragger ui
```

The desktop app opens with:

- Sidebar for workspace creation, deletion, and browsing.
- 5-tab upload dialog (File · Web Page · YouTube · Channel Scan · Note) with tag input.
- DataTable upload browser with filter bar and sortable columns.
- Content inspector with multiple YouTube viewing modes (Gemini, Transcript, AI Notes,
  Description, Report).
- Workspace query panel with citation rendering.
- Settings dialog (gear icon) for editing configuration.
- Dark / light / system theme with window size and position persistence.

---

## Filesystem Layout

| Path                                       | Contents                                                    |
|--------------------------------------------|-------------------------------------------------------------|
| `~/.tool-agents/g-ragger/.env`             | Tool-level secrets (.env file, mode `0600`).                |
| `~/.g-ragger/registry.json`                | Workspace + upload registry.                                |
| `~/.g-ragger/config.json`                  | UI preferences (theme, date format).                        |
| `~/.g-ragger/report-prompt.txt`            | Editable YouTube report prompt template.                    |

---

## Documentation map

- [`docs/tools/g-ragger.md`](docs/tools/g-ragger.md) — full tool reference (commands, filters, configuration).
- [`docs/design/project-design.md`](docs/design/project-design.md) — full architecture and design.
- [`docs/design/project-functions.md`](docs/design/project-functions.md) — functional requirements and feature catalog.
- [`docs/design/plan-001-geminirag-implementation.md`](docs/design/plan-001-geminirag-implementation.md) — initial implementation plan.
- [`docs/design/plan-002-v2-enhancements.md`](docs/design/plan-002-v2-enhancements.md) — V2 enhancements (YouTube + multi-workspace).
- [`docs/design/plan-003-electron-ui.md`](docs/design/plan-003-electron-ui.md) — Electron UI plan.
- [`docs/design/plan-004-upload-features.md`](docs/design/plan-004-upload-features.md) — extended upload features.
- [`docs/design/plan-005-consolidate-cli-ui.md`](docs/design/plan-005-consolidate-cli-ui.md) — CLI + UI consolidation.
- [`docs/design/plan-006-upload-tags.md`](docs/design/plan-006-upload-tags.md) — upload tagging.
- [`docs/reference/`](docs/reference/) — refined requests, investigations, codebase scans, research notes.
- [`Issues - Pending Items.md`](Issues%20-%20Pending%20Items.md) — open issues, known limitations, planned next steps.

---

## Build & Test

```bash
# CLI
npx tsc

# Electron UI
cd electron-ui && npm run build
```

Run the test scripts:

```bash
npx tsx test_scripts/test-config.ts
npx tsx test_scripts/test-registry.ts
npx tsx test_scripts/test-filters.ts
# ... see docs/tools/g-ragger.md for the full list
```

---

## Provider Support

G-Ragger is purpose-built around the Gemini File Search API. The indexing and search layer is
Gemini-only by design (no cross-provider equivalent exists). Partial multi-provider support for
the AI-generative side (notes, reports, descriptions) is on the roadmap — tracked in
[`Issues - Pending Items.md`](Issues%20-%20Pending%20Items.md).

---

## License

See [`LICENSE`](LICENSE) (if present) or contact the project owner.

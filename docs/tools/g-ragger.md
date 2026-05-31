# g-ragger — Tool Documentation

<gRagger>
    <objective>
        Unified CLI + Electron desktop tool for workspace-based document
        management and semantic search powered by the Google Gemini File
        Search API. Creates named workspaces backed by Gemini File Search
        Stores, accepts uploads from local files, web pages, YouTube videos,
        and personal notes, attaches metadata (timestamp, title, expiration,
        tags, status flags) to each upload, and exposes natural-language
        queries with optional metadata filtering. The `ui` subcommand
        launches the Electron desktop application.
    </objective>
    <command>
        g-ragger [command]
        # Development:        npx tsx src/cli.ts [command]
        # After build:        node dist/cli.js [command]
        # After npm link:     g-ragger [command]
    </command>
    <info>
        ## CLI Commands

        Workspace management
            g-ragger ui                                     Launch the desktop application
            g-ragger create <name>                          Create a new workspace
            g-ragger list                                   List all workspaces
            g-ragger delete <name>                          Delete a workspace and all its uploads
            g-ragger info <name>                            Show workspace details and statistics

        Upload content
            g-ragger upload <workspace> --file <path>       Upload a local file
            g-ragger upload <workspace> --url <url>         Upload content from a web page
            g-ragger upload <workspace> --youtube <url>     Upload YouTube video (structured markdown)
                --with-notes                                Generate AI notes for YouTube uploads
                --tag <tags...>                             Tags to attach (repeatable)
            g-ragger upload <workspace> --note <text>       Add a personal note

        Browse and inspect
            g-ragger uploads <workspace>                    List all uploads in a workspace
                --filter <key=value>                        Filter by metadata (repeatable)
                --sort <field>                              Sort by timestamp or -timestamp
            g-ragger labels <workspace>                     List all metadata labels in use

        Manage tags and metadata
            g-ragger tag <workspace> <upload-id>            Manage tags on an upload
                --add <tags...>                             Add tags
                --remove <tags...>                          Remove tags
                --list                                      List current tags

            g-ragger update-title <ws> <id> <title>         Change an upload's title
            g-ragger remove <workspace> <upload-id>         Delete an upload
            g-ragger set-expiration <ws> <id> <date>        Set expiration date (YYYY-MM-DD)
            g-ragger clear-expiration <ws> <id>             Remove expiration date
            g-ragger flag <workspace> <upload-id>           Manage status flags
                --add <flags...>                            Add flags (completed, urgent, inactive)
                --remove <flags...>                         Remove flags

        Retrieve content
            g-ragger get <workspace> <upload-id>            Retrieve uploaded content
                --output <file>                             Write to file instead of stdout
                --raw                                       Skip metadata header
                --description                               Fetch YouTube video description directly
                --notes                                     Generate AI notes from YouTube transcript
                --report                                    Generate detailed AI report (transcript + description)
                --email                                     Send content via system email client (use with --report or --notes)

        YouTube channel scanning
            g-ragger channel-scan <workspace>               Scan YouTube channel
                --channel <handle|url|id>                   Channel to scan (required)
                --from <YYYY-MM-DD>                         Start date (required)
                --to <YYYY-MM-DD>                           End date (required)
                --with-notes                                Generate AI notes per video
                --dry-run                                   List videos without uploading
                --max-videos <n>                            Limit videos processed
                --continue-on-error                         Skip failed videos
                --tag <tags...>                             Tags to attach to all videos

        Semantic query
            g-ragger ask <workspace> <question>             Query a workspace
                --workspace <name>                          Add additional workspaces (repeatable)
                --filter <key=value>                        Metadata filter (repeatable)

        ## Filter keys

            source_type=file|web|youtube|note   (Gemini-side, fast)
            source_url=<url>                    (Gemini-side, fast)
            flags=completed|urgent|inactive     (client-side, post-filter)
            expiration_status=expired           (client-side, post-filter)
            channel=<text>                      (client-side, substring match on YouTube channel)
            tag=<tag>                           (client-side, OR logic: upload has ANY matching tag)
            published_from=YYYY-MM-DD           (client-side, YouTube publish date >= value)
            published_to=YYYY-MM-DD             (client-side, YouTube publish date <= value)

        ## Configuration

        Four-tier resolution chain (highest priority last; later tiers override earlier ones):

            1. Shell-registered environment variables
            2. ~/.tool-agents/g-ragger/.env       (tool-level secrets file, mode 0600)
            3. Local .env in the current working directory
            4. CLI flags                          (always win — when implemented per option)

        A separate non-secret data file lives at `~/.g-ragger/config.json` and is
        used by the Electron UI for user preferences (DATE_FORMAT, THEME). It is
        NOT part of the secrets resolution chain.

        ### Configuration variables

            GOOGLE_API_KEY                Required. Google AI Studio API key (canonical name).
            GEMINI_API_KEY                Accepted alias for GOOGLE_API_KEY (legacy).
            GEMINI_MODEL                  Required. e.g., gemini-2.5-flash
            GOOGLE_API_KEY_EXPIRATION     Optional. YYYY-MM-DD. Warns when near expiry.
            GEMINI_API_KEY_EXPIRATION     Accepted alias for GOOGLE_API_KEY_EXPIRATION (legacy).
            YOUTUBE_DATA_API_KEY          Optional. Required for channel-scan and direct video description fetch.
            YOUTUBE_DATA_API_KEY_EXPIRATION  Optional. Warns when near expiry.
            DATE_FORMAT                   Optional UI preference. DD/MM/YYYY (default), MM/DD/YYYY, YYYY-MM-DD.
            THEME                         Optional UI preference. light (default), dark, or system.

        ### Report prompt file

        `~/.g-ragger/report-prompt.txt` — user-editable prompt template for
        YouTube report generation. Uses `{{TRANSCRIPT}}` and `{{DESCRIPTION}}`
        placeholders. Auto-created with a default prompt on first use.

        ## Desktop UI features (`g-ragger ui`)

            - Workspace creation, deletion, and browsing in sidebar
            - Content upload via 5-tab dialog (File, Web Page, YouTube, Channel Scan, Note) with tag input
            - Upload browser with DataTable, filter bar, sortable columns
            - Content inspector with resizable dialog
            - YouTube content modes: Gemini, Transcript, AI Notes, Description, Report
            - Report mode: AI-generated detailed analysis combining transcript + description
              (prompt customizable via ~/.g-ragger/report-prompt.txt)
            - File download via native Save dialog
            - Workspace query with citations
            - Configuration editor (Settings gear icon)
            - Dark / light / system theme
            - Window size / position persistence

        ## Desktop UI architecture

            Main process : Operations bridge + IPC handlers (bundled to CJS by electron-vite)
            Preload      : Typed window.api bridge with context isolation
            Renderer     : React 19 + Tailwind CSS 4 + shadcn/ui + Zustand 5

        ## Build, develop, install

        Build:
            npx tsc                              Build CLI
            cd electron-ui && npm run build      Build Electron UI

        Development:
            npx tsx src/cli.ts [command]         Run CLI in dev mode
            cd electron-ui && npm run dev        Run Electron UI in dev mode

        Global install:
            npm link                             Creates global `g-ragger` command

        ## Tests

            npx tsx test_scripts/test-validation.ts
            npx tsx test_scripts/test-config.ts
            npx tsx test_scripts/test-registry.ts
            npx tsx test_scripts/test-extractors.ts
            npx tsx test_scripts/test-format.ts
            npx tsx test_scripts/test-youtube-enhanced.ts
            npx tsx test_scripts/test-notes-generator.ts
            npx tsx test_scripts/test-youtube-data-api.ts
            npx tsx test_scripts/test-get-command.ts
            npx tsx test_scripts/test-filters.ts
            npx tsx test_scripts/test-electron-build.ts
            npx tsx test_scripts/test-ipc-types.ts

        ## Filesystem locations

            ~/.tool-agents/g-ragger/.env         Tool-level secrets (.env tier 2 of resolution chain)
            ~/.g-ragger/registry.json            Workspace and upload registry
            ~/.g-ragger/config.json              UI preferences (theme, date format)
            ~/.g-ragger/report-prompt.txt        Editable YouTube report prompt

        ## Prerequisites

            - Node.js 18+
            - A Gemini / Google AI Studio API key — obtain at https://aistudio.google.com/apikey
            - (Optional) A YouTube Data API v3 key for channel-scan and direct video description
              fetch — obtain at https://console.cloud.google.com/apis/credentials

        ## Key directories

            src/operations/             Shared business logic (used by CLI + Electron)
            src/commands/               CLI command handlers (thin wrappers)
            src/services/               Low-level service layer (Gemini, registry, extractors)
            src/utils/                  Shared utilities (filters, format, validation)
            electron-ui/src/main/       Electron main process (IPC handlers, thin wrappers)
            electron-ui/src/preload/    Preload script (typed API bridge)
            electron-ui/src/shared/     Shared IPC types
            electron-ui/src/renderer/   React application

        ## Provider support (current state)

        g-ragger is purpose-built around the Gemini File Search API. The search,
        indexing, and storage layer is Gemini-only by design and has no
        cross-provider equivalent. A partial multi-provider extension for the
        AI-generative side (notes, reports, descriptions) is on the roadmap — see
        `Issues - Pending Items.md` and the upcoming plan document.

        ## Examples

            g-ragger ui
            g-ragger create my-research
            g-ragger upload my-research --url https://example.com/article
            g-ragger upload my-research --youtube https://youtube.com/watch?v=abc123
            g-ragger upload my-research --youtube https://youtu.be/abc123 --with-notes
            g-ragger upload my-research --note "Remember to check the Q3 results"
            g-ragger upload my-research --file ~/docs/report.pdf
            g-ragger uploads my-research --filter source_type=web
            g-ragger flag my-research <upload-id> --add urgent
            g-ragger get my-research <upload-id>
            g-ragger get my-research <upload-id> --raw --output transcript.md
            g-ragger get my-research <upload-id> --description
            g-ragger get my-research <upload-id> --notes
            g-ragger uploads my-research --filter channel=IndyDevDan
            g-ragger uploads my-research --filter published_from=2026-03-01 --filter published_to=2026-04-01
            g-ragger channel-scan my-research --channel @IndyDevDan --from 2026-01-01 --to 2026-04-10
            g-ragger channel-scan my-research --channel @IndyDevDan --from 2026-03-01 --to 2026-04-01 --with-notes --continue-on-error
            g-ragger channel-scan my-research --channel @IndyDevDan --from 2026-01-01 --to 2026-04-10 --dry-run
            g-ragger ask my-research "What are the key findings?" --filter source_type=web
            g-ragger ask my-research "Summary" --workspace other-workspace
            g-ragger upload my-research --url https://example.com --tag ml --tag finance
            g-ragger tag my-research <upload-id> --add review --remove draft
            g-ragger tag my-research <upload-id> --list
            g-ragger uploads my-research --filter tag=ml
            g-ragger ask my-research "key findings" --filter tag=ml
    </info>
</gRagger>

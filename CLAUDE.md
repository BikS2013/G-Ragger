<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the test_scripts folder. If the folder doesn't exist, you must make it.

- All the plans must be kept under the docs/design folder inside the project's folder in separate files: Each plan file must be named according to the following pattern: plan-xxx-<indicative description>.md

- The complete project design must be maintained inside a file named docs/design/project-design.md under the project's folder. The file must be updated with each new design or design change.

- All the reference material used for the project must be collected and kept under the docs/reference folder.
- All the functional requirements and all the feature descriptions must be registered in the /docs/design/project-functions.MD document under the project's folder.

<configuration-guide>
- If the user ask you to create a configuration guide, you must create it under the docs/design folder, name it configuration-guide.md and be sure to explain the following:
  - if multiple configuration options exist (like config file, env variables, cli params, etc) you must explain the options and what is the priority of each one.
  - Which is the purpose and the use of each configuration variable
  - How the user can obtain such a configuration variable
  - What is the recomented approach of storing or managing this configuration variable
  - Which options exist for the variable and what each option means for the project
  - If there are any default value for the parameter you must present it.
  - For configuration parameters that expire (e.g., PAT keys, tokens), I want you to propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt working in a project, the prompt must be placed inside a dedicated folder named prompts. If the folder doesn't exists you must create it. The prompt file name must have an sequential number prefix and must be representative to the prompt use and purpose.

- You must maintain a document at the root level of the project, named "Issues - Pending Items.md," where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.
- The "Issues - Pending Items.md" content must be organized with the pending items on top and the completed items after. From the pending items the most critical and important must be first followed by the rest.

- When I ask you to create tools in the context of a project everything must be in Typescript.
- Every tool you develop must be documented in the project's Claude.md file
- The documentation must be in the following format:
<toolName>
    <objective>
        what the tool does
    </objective>
    <command>
        the exact command to run
    </command>
    <info>
        detailed description of the tool
        command line parameters and their description
        examples of usage
    </info>
</toolName>

- Every time I ask you to do something that requires the creation of a code script, I want you to examine the tools already implemented in the scope of the project to detect if the code you plan to write, fits to the scope of the tool.
- If so, I want you to implement the code as an extension of the tool, otherwise I want you to build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.
- Our goal is, while the project progressing, to develop the tools needed to test, evaluate, generate data, collect information, etc and reuse them in a consistent manner.
- All these tools must be documented inside the CLAUDE.md to allow their consistent reuse.

- When I ask you to locate code, I need to give me the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version control operation unless I explicitly request it.

- When you design databases you must align with the following table naming conventions:
  - Table names must be singular e.g. the table that keeps customers' data must be called "Customer"
  - Tables that are used to express references from one entity to another can by plural if the first entity is linked to many other entities.
  - So we have "Customer" and "Transaction" tables, we have CustomerTransactions.

- You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value.
- If I ask you to make an exception to the configuration setting rule, you must write this exception in the projects memory file, before you implement it.
</structure-and-conventions>

# GeminiRAG - Workspace-Based Document Search Tool

## Project Overview
A TypeScript CLI tool and Electron desktop application that uses the Google Gemini File Search API to create workspaces for uploading, indexing, and searching documents. Supports uploading from disk files, web pages, YouTube videos, and personal notes. Each upload has metadata (timestamp, title, expiration, status flags) that can be used as filters when querying. YouTube uploads include the video description when the YouTube Data API key is configured.

## Tools

<GeminiRAG>
    <objective>
        CLI tool for workspace-based document management and semantic search powered by Google Gemini File Search API.
    </objective>
    <command>
        npx tsx src/cli.ts [command]
        # Or after build: node dist/cli.js [command]
        # Or after npm link: geminirag [command]
    </command>
    <info>
        GeminiRAG creates named workspaces backed by Gemini File Search Stores.
        Users upload content from multiple sources and query workspaces using
        natural language with optional metadata filtering.

        Commands:
            geminirag create <name>                         Create a new workspace
            geminirag list                                  List all workspaces
            geminirag delete <name>                         Delete a workspace and all its uploads
            geminirag info <name>                           Show workspace details and statistics

            geminirag upload <workspace> --file <path>      Upload a local file
            geminirag upload <workspace> --url <url>        Upload content from a web page
            geminirag upload <workspace> --youtube <url>    Upload YouTube video (structured markdown)
                --with-notes                                Generate AI notes for YouTube uploads
            geminirag upload <workspace> --note <text>      Add a personal note

            geminirag uploads <workspace>                   List all uploads in a workspace
                --filter <key=value>                        Filter by metadata (repeatable)
                --sort <field>                              Sort by timestamp or -timestamp

            geminirag update-title <ws> <id> <title>        Change an upload's title
            geminirag remove <workspace> <upload-id>        Delete an upload
            geminirag set-expiration <ws> <id> <date>       Set expiration date (YYYY-MM-DD)
            geminirag clear-expiration <ws> <id>            Remove expiration date
            geminirag flag <workspace> <upload-id>          Manage status flags
                --add <flags...>                            Add flags (completed, urgent, inactive)
                --remove <flags...>                         Remove flags
            geminirag labels <workspace>                    List all metadata labels in use

            geminirag get <workspace> <upload-id>            Retrieve uploaded content
                --output <file>                             Write to file instead of stdout
                --raw                                       Skip metadata header
                --description                               Fetch YouTube video description directly
                --notes                                     Generate AI notes from YouTube transcript

            geminirag channel-scan <workspace>              Scan YouTube channel
                --channel <handle|url|id>                   Channel to scan (required)
                --from <YYYY-MM-DD>                         Start date (required)
                --to <YYYY-MM-DD>                           End date (required)
                --with-notes                                Generate AI notes per video
                --dry-run                                   List videos without uploading
                --max-videos <n>                             Limit videos processed
                --continue-on-error                         Skip failed videos

            geminirag ask <workspace> <question>            Query a workspace
                --workspace <name>                          Add additional workspaces (repeatable)
                --filter <key=value>                        Metadata filter (repeatable)

        Filter keys:
            source_type=file|web|youtube|note   (Gemini-side, fast)
            source_url=<url>                    (Gemini-side, fast)
            flags=completed|urgent|inactive     (client-side, post-filter)
            expiration_status=expired           (client-side, post-filter)
            channel=<text>                      (client-side, substring match on YouTube channel)
            published_from=YYYY-MM-DD           (client-side, YouTube publish date >= value)
            published_to=YYYY-MM-DD             (client-side, YouTube publish date <= value)

        Configuration (priority: env vars > .env > ~/.geminirag/config.json):
            GEMINI_API_KEY          Required. Google AI Studio API key.
            GEMINI_MODEL            Required. e.g., gemini-2.5-flash
            GEMINI_API_KEY_EXPIRATION  Optional. YYYY-MM-DD. Warns when near expiry.
            YOUTUBE_DATA_API_KEY    Optional. Required for channel-scan and video description fetch.
            YOUTUBE_DATA_API_KEY_EXPIRATION  Optional. Warns when near expiry.
            DATE_FORMAT             Optional. DD/MM/YYYY (default), MM/DD/YYYY, or YYYY-MM-DD.
            THEME                   Optional. light (default), dark, or system.

        Build:
            npx tsc

        Development:
            npx tsx src/cli.ts [command]

        Tests:
            npx tsx test_scripts/test-validation.ts
            npx tsx test_scripts/test-config.ts
            npx tsx test_scripts/test-registry.ts
            npx tsx test_scripts/test-extractors.ts
            npx tsx test_scripts/test-format.ts
            npx tsx test_scripts/test-youtube-enhanced.ts
            npx tsx test_scripts/test-notes-generator.ts
            npx tsx test_scripts/test-youtube-data-api.ts
            npx tsx test_scripts/test-get-command.ts

        Registry location: ~/.geminirag/registry.json
        Config file: ~/.geminirag/config.json
        Prerequisites: Node.js 18+, Gemini API key from https://aistudio.google.com/apikey

        Examples:
            geminirag create my-research
            geminirag upload my-research --url https://example.com/article
            geminirag upload my-research --youtube https://youtube.com/watch?v=abc123
            geminirag upload my-research --youtube https://youtu.be/abc123 --with-notes
            geminirag upload my-research --note "Remember to check the Q3 results"
            geminirag upload my-research --file ~/docs/report.pdf
            geminirag uploads my-research --filter source_type=web
            geminirag flag my-research <upload-id> --add urgent
            geminirag get my-research <upload-id>
            geminirag get my-research <upload-id> --raw --output transcript.md
            geminirag get my-research <upload-id> --description
            geminirag get my-research <upload-id> --notes
            geminirag uploads my-research --filter channel=IndyDevDan
            geminirag uploads my-research --filter published_from=2026-03-01 --filter published_to=2026-04-01
            geminirag channel-scan my-research --channel @IndyDevDan --from 2026-01-01 --to 2026-04-10
            geminirag channel-scan my-research --channel @IndyDevDan --from 2026-03-01 --to 2026-04-01 --with-notes --continue-on-error
            geminirag channel-scan my-research --channel @IndyDevDan --from 2026-01-01 --to 2026-04-10 --dry-run
            geminirag ask my-research "What are the key findings?" --filter source_type=web
            geminirag ask my-research "Summary" --workspace other-workspace
    </info>
</GeminiRAG>

<G-Ragger>
    <objective>
        G-Ragger: Electron desktop application providing a graphical interface for GeminiRAG workspace exploration, upload browsing, content inspection, file download, and semantic querying with special YouTube content viewing capabilities.
    </objective>
    <command>
        cd electron-ui && npm run dev
        # Or after build: cd electron-ui && npm run preview
    </command>
    <info>
        G-Ragger is an Electron desktop app (React + Tailwind + shadcn/ui) that provides
        a polished GUI for all GeminiRAG workspace operations. It reuses the existing
        CLI service layer via IPC. The app name appears as "G-Ragger" in the title bar,
        header, and all dialogs.

        Architecture:
            Main process:  Service bridge + 22 IPC handlers (bundled to CJS by electron-vite)
            Preload:       Typed window.api bridge with context isolation
            Renderer:      React 19 + Tailwind CSS 4 + shadcn/ui + Zustand 5

        Features:
            - Workspace creation: "+" button in sidebar opens dialog with name validation
              (alphanumeric, hyphens, underscores), max 10 workspaces, auto-selects on success
            - Content upload: "Add Content" button opens 5-tab modal dialog:
                * File: native file picker via Electron dialog, supports pdf/txt/md/html/csv/doc/xlsx/etc
                * Web Page: URL input with validation, extracts content via Readability
                * YouTube: URL input with optional "Generate AI notes" checkbox
                * Channel Scan: bulk upload from YouTube channel by date range
                  (channel handle/URL, from/to dates, optional AI notes)
                * Note: free-text textarea with auto-generated title preview
              All uploads show non-dismissable loading dialog with elapsed time counter
              and context-specific status messages. Errors shown inline for retry.
            - YouTube metadata: channel name and publish date stored in upload metadata
              and displayed in the upload detail view (for both CLI and UI uploads)
            - Workspace sidebar: browse all workspaces, see upload counts and source type stats
            - Upload browser: DataTable with filter bar (source type, flags, expiration),
              sortable columns, scrollable list
            - Content inspector: resizable dialog showing full metadata + content
            - File download: native Save dialog, defaults to .md
            - Workspace query: ask questions, see answers with citations
            - Query filters: Gemini-side (source_type, source_url) and client-side (flags, expiration)
            - YouTube content modes (4 buttons for YouTube uploads):
                * Gemini: content from Gemini File Search store (with RECITATION fallback
                  that returns analytical notes when verbatim retrieval is blocked)
                * Transcript: raw transcript fetched directly from YouTube with
                  timestamps ([MM:SS]) and paragraph breaks at natural pauses
                * AI Notes: AI-generated structured notes (summary, key points,
                  important terms, action items) from the transcript
                * Description: the YouTube video description fetched via YouTube
                  Data API (default view for YouTube uploads; requires YOUTUBE_DATA_API_KEY)
            - Upload deletion: delete button in upload detail dialog (removes from
              Gemini and local registry with confirmation prompt)
            - Per-row upload deletion: trash icon on each table row (hover-visible)
            - Workspace deletion: trash icon on each workspace in sidebar (hover-visible,
              deletes Gemini store and all uploads with confirmation)
            - Configuration editor: Settings gear icon in header opens dialog to
              view/edit ~/.geminirag/config.json (API keys, model, expiration dates)
            - Dark theme: light/dark/system theme via Settings dialog (THEME config)
            - Date format: configurable DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD
              (DATE_FORMAT config, European default)
            - Upload date display: YouTube uploads show publish date, others show upload date
            - Filter bar: source type, flags, expiration, channel name, publish date range
            - Source URLs clickable (opens in external browser with protocol validation)
            - Copy-to-clipboard for upload IDs and URLs

        IPC Channels:
            config:validate          Validate Gemini API configuration
            workspace:list           List all workspaces
            workspace:get            Get workspace details with statistics
            workspace:create         Create new workspace (with Gemini store + rollback)
            workspace:delete         Delete workspace (Gemini store + registry)
            upload:list              List uploads with filters and sorting
            upload:getContent        Retrieve document content from Gemini
            upload:download          Download content via native Save dialog
            upload:file              Upload local file (native picker + Gemini + rollback)
            upload:url               Upload web page content (extract + Gemini + rollback)
            upload:youtube           Upload YouTube video (transcript + optional notes + rollback)
            upload:note              Upload personal note (Gemini + rollback)
            upload:delete            Delete upload from Gemini and local registry
            dialog:openFile          Open native file picker dialog
            youtube:channelScan      Bulk upload from YouTube channel by date range
            config:get               Read ~/.geminirag/config.json
            config:save              Write ~/.geminirag/config.json and re-initialize
            query:ask                Query workspace with filters
            youtube:getTranscript    Fetch raw transcript directly from YouTube
            youtube:getNotes         Generate AI notes from YouTube transcript
            youtube:getDescription   Fetch video description via YouTube Data API
            shell:openExternal       Open URLs in external browser (validated)

        Build:
            cd electron-ui && npm run build

        Development:
            cd electron-ui && npm run dev

        Configuration:
            Uses the same config as the CLI (env vars > .env > ~/.geminirag/config.json)
            GEMINI_API_KEY and GEMINI_MODEL are required
            YOUTUBE_DATA_API_KEY is optional but needed for the Description button
            DATE_FORMAT controls date display (DD/MM/YYYY default, MM/DD/YYYY, YYYY-MM-DD)
            THEME controls appearance (light default, dark, system)
            Missing config shows error banner in UI (no fallback values)
            All settings editable via Settings dialog (gear icon in header)

        Tests:
            npx tsx test_scripts/test-filters.ts        (50 filter utility tests)
            npx tsx test_scripts/test-electron-build.ts  (25 build structure tests)
            npx tsx test_scripts/test-ipc-types.ts       (53 IPC contract consistency tests)

        Source location: electron-ui/
        Prerequisites: Node.js 18+, npm, Gemini API key

        Key directories:
            electron-ui/src/main/       Main process (service-bridge, ipc-handlers)
            electron-ui/src/preload/    Preload script (typed API bridge)
            electron-ui/src/shared/     Shared IPC types
            electron-ui/src/renderer/   React application

        Notable behaviors:
            - YouTube uploads default to showing the video Description on open
            - Gemini RECITATION filter: when verbatim content retrieval is blocked
              (common for YouTube transcripts), the system automatically retries
              with an analytical prompt and prefixes the result with a [NOTE:] banner
            - The upload detail dialog is resizable (drag bottom-right corner);
              the content viewer fills all available space
            - Filter/sort utilities are shared between CLI and UI via src/utils/filters.ts
            - Native modules (bufferutil, utf-8-validate, canvas, jsdom,
              @mozilla/readability, turndown, turndown-plugin-gfm, mime-types,
              youtube-transcript-plus) are externalized in electron.vite.config.ts
            - YouTube uploads store channel name and publish date in metadata
            - Window size/position persisted to ~/.geminirag/window-state.json
            - Upload detail dialog size persisted in localStorage
            - App quits when last window is closed (all platforms)
    </info>
</G-Ragger>

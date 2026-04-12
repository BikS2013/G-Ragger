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

# G-Ragger - Workspace-Based Document Search Tool

## Project Overview
A unified TypeScript CLI + Electron desktop application that uses the Google Gemini File Search API to create workspaces for uploading, indexing, and searching documents. The `g-ragger` command provides both CLI subcommands and a `ui` subcommand that launches the Electron desktop app. Supports uploading from disk files, web pages, YouTube videos, and personal notes. Each upload has metadata (timestamp, title, expiration, status flags) that can be used as filters when querying.

## Architecture
Business logic lives in `src/operations/` — pure async functions shared by both
the CLI commands (`src/commands/`) and the Electron IPC handlers (`electron-ui/src/main/ipc-handlers.ts`).
Both use the same `AppContext` (config + Gemini client) from `src/operations/context.ts`.

## Tools

<G-Ragger>
    <objective>
        Unified CLI + desktop tool for workspace-based document management and
        semantic search powered by Google Gemini File Search API. The `ui`
        subcommand launches the Electron desktop application.
    </objective>
    <command>
        g-ragger [command]
        # Development: npx tsx src/cli.ts [command]
        # After build: node dist/cli.js [command]
        # After npm link: g-ragger [command]
    </command>
    <info>
        G-Ragger creates named workspaces backed by Gemini File Search Stores.
        Users upload content from multiple sources and query workspaces using
        natural language with optional metadata filtering. The `ui` subcommand
        opens the Electron desktop GUI for graphical workspace management.

        CLI Commands:
            g-ragger ui                                     Launch the desktop application
            g-ragger create <name>                          Create a new workspace
            g-ragger list                                   List all workspaces
            g-ragger delete <name>                          Delete a workspace and all its uploads
            g-ragger info <name>                            Show workspace details and statistics

            g-ragger upload <workspace> --file <path>       Upload a local file
            g-ragger upload <workspace> --url <url>         Upload content from a web page
            g-ragger upload <workspace> --youtube <url>     Upload YouTube video (structured markdown)
                --with-notes                                Generate AI notes for YouTube uploads
            g-ragger upload <workspace> --note <text>       Add a personal note

            g-ragger uploads <workspace>                    List all uploads in a workspace
                --filter <key=value>                        Filter by metadata (repeatable)
                --sort <field>                              Sort by timestamp or -timestamp

            g-ragger update-title <ws> <id> <title>         Change an upload's title
            g-ragger remove <workspace> <upload-id>         Delete an upload
            g-ragger set-expiration <ws> <id> <date>        Set expiration date (YYYY-MM-DD)
            g-ragger clear-expiration <ws> <id>             Remove expiration date
            g-ragger flag <workspace> <upload-id>           Manage status flags
                --add <flags...>                            Add flags (completed, urgent, inactive)
                --remove <flags...>                         Remove flags
            g-ragger labels <workspace>                     List all metadata labels in use

            g-ragger get <workspace> <upload-id>            Retrieve uploaded content
                --output <file>                             Write to file instead of stdout
                --raw                                       Skip metadata header
                --description                               Fetch YouTube video description directly
                --notes                                     Generate AI notes from YouTube transcript

            g-ragger channel-scan <workspace>               Scan YouTube channel
                --channel <handle|url|id>                   Channel to scan (required)
                --from <YYYY-MM-DD>                         Start date (required)
                --to <YYYY-MM-DD>                           End date (required)
                --with-notes                                Generate AI notes per video
                --dry-run                                   List videos without uploading
                --max-videos <n>                             Limit videos processed
                --continue-on-error                         Skip failed videos

            g-ragger ask <workspace> <question>             Query a workspace
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

        Desktop UI Features (g-ragger ui):
            - Workspace creation, deletion, and browsing in sidebar
            - Content upload via 5-tab dialog (File, Web Page, YouTube, Channel Scan, Note)
            - Upload browser with DataTable, filter bar, sortable columns
            - Content inspector with resizable dialog
            - YouTube content modes: Gemini, Transcript, AI Notes, Description
            - File download via native Save dialog
            - Workspace query with citations
            - Configuration editor (Settings gear icon)
            - Dark/light/system theme
            - Window size/position persistence

        Desktop UI Architecture:
            Main process:  Operations bridge + IPC handlers (bundled to CJS by electron-vite)
            Preload:       Typed window.api bridge with context isolation
            Renderer:      React 19 + Tailwind CSS 4 + shadcn/ui + Zustand 5

        Build:
            npx tsc                              Build CLI
            cd electron-ui && npm run build      Build Electron UI

        Development:
            npx tsx src/cli.ts [command]          Run CLI in dev mode
            cd electron-ui && npm run dev         Run Electron UI in dev mode

        Global install:
            npm link                             Creates global 'g-ragger' command

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
            npx tsx test_scripts/test-filters.ts
            npx tsx test_scripts/test-electron-build.ts
            npx tsx test_scripts/test-ipc-types.ts

        Registry location: ~/.geminirag/registry.json
        Config file: ~/.geminirag/config.json
        Prerequisites: Node.js 18+, Gemini API key from https://aistudio.google.com/apikey

        Key directories:
            src/operations/             Shared business logic (used by CLI + Electron)
            src/commands/               CLI command handlers (thin wrappers)
            src/services/               Low-level service layer (Gemini, registry, extractors)
            src/utils/                  Shared utilities (filters, format, validation)
            electron-ui/src/main/       Electron main process (IPC handlers, thin wrappers)
            electron-ui/src/preload/    Preload script (typed API bridge)
            electron-ui/src/shared/     Shared IPC types
            electron-ui/src/renderer/   React application

        Examples:
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
    </info>
</G-Ragger>

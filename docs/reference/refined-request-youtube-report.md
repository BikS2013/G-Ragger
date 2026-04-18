# Refined Specification: YouTube Video Report Generation

## Overview

Add a new "Report" content mode for YouTube uploads in the G-Ragger Electron UI. The report is an AI-generated detailed analysis that combines both the video transcript and description into a comprehensive document. The report appears in the same content area as the existing modes (Gemini, Transcript, AI Notes, Description) and is copyable via the existing Copy button.

The AI prompt used to generate the report is stored in an external text file that users can customize to control the report format and focus.

## Functional Requirements

### FR-1: Report Generation Prompt File
- Store the default report prompt at `~/.g-ragger/report-prompt.txt`
- If the file does not exist, create it with the default prompt on first use
- The prompt must include placeholders for `{{TRANSCRIPT}}` and `{{DESCRIPTION}}`
- The prompt instructs the AI to produce a detailed analytical report

### FR-2: YouTube Operations — generateReport Function
- New function in `src/operations/youtube-ops.ts`: `generateReport(ctx, url)`
- Fetches transcript and description (reusing existing `getTranscript` and `getDescription`)
- Loads the prompt template from `~/.g-ragger/report-prompt.txt`
- Substitutes `{{TRANSCRIPT}}` and `{{DESCRIPTION}}` placeholders
- Sends the composed prompt to Gemini for generation
- Returns the generated report text

### FR-3: IPC Channel — youtube:getReport
- New IPC channel: `youtube:getReport`
- Input: `{ url: string }`
- Output: `string` (the generated report)
- Calls the `generateReport` operation

### FR-4: Electron UI — Report Button
- Add a 5th button "Report" in the YouTube content mode buttons row in UploadDetail
- Icon: `FileBarChart` or `ClipboardList` from lucide-react
- Same toggle behavior as existing buttons (active/outline variant)
- Shows loading spinner while generating
- Displays the generated report in the ContentViewer area
- The existing Copy button already copies whatever is displayed

### FR-5: Preload API Extension
- Add `getReport(url: string)` to the `youtube` section of the preload API

### FR-6: IPC Types Extension
- Add `youtube:getReport` to the `IpcChannelMap` in ipc-types.ts

## Acceptance Criteria

1. A "Report" button appears next to Description for YouTube uploads
2. Clicking Report generates an AI report combining transcript + description
3. The report is displayed in the same content area
4. The Copy button copies the report text
5. The prompt file is at `~/.g-ragger/report-prompt.txt` and is user-editable
6. If the prompt file doesn't exist, it's created with a sensible default
7. Changing the prompt file changes subsequent report output (no app restart needed)
8. Report generation shows a loading spinner during processing

## Out of Scope

1. CLI command for report generation (UI only for now)
2. Caching reports (regenerated each time)
3. Report prompt editor in the UI (user edits the file directly)

## Resolved Decisions

1. **Prompt file location**: `~/.g-ragger/report-prompt.txt` (same config directory as other settings)
2. **Prompt placeholders**: `{{TRANSCRIPT}}` and `{{DESCRIPTION}}` — simple mustache-style
3. **Fallback when description unavailable**: If YouTube Data API key is not configured, the report uses transcript only and notes the description was unavailable
4. **Prompt file creation**: Auto-create with default prompt on first use (this is NOT a config fallback — it's a template file, similar to how text editors create default config files)

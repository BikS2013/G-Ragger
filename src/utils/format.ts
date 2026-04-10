import { WorkspaceData, UploadEntry, QueryResult, Citation, ChannelScanResult } from '../types/index.js';

// ===== Helper Functions =====

/**
 * Pad or truncate a string to fit a fixed column width.
 */
function padColumn(text: string, width: number): string {
  if (text.length > width) {
    return text.slice(0, width - 3) + '...';
  }
  return text.padEnd(width);
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Build a simple text table from headers and rows.
 * Each column auto-sizes to the widest value (header or data).
 */
function buildTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxDataWidth = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, maxDataWidth);
  });

  const headerLine = headers.map((h, i) => padColumn(h, colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row =>
    row.map((cell, i) => padColumn(cell, colWidths[i])).join('  ')
  );

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

/**
 * Format an ISO date string to a short display format (YYYY-MM-DD).
 */
function formatDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

// ===== Exported Functions =====

/**
 * Get expiration status indicator string.
 *
 * @returns "[EXPIRED]", "[EXPIRING SOON]", or empty string
 */
export function getExpirationIndicator(expirationDate: string | null): string {
  if (expirationDate === null) {
    return '';
  }

  const expDate = new Date(expirationDate);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 0) {
    return '[EXPIRED]';
  } else if (diffDays <= 7) {
    return '[EXPIRING SOON]';
  }

  return '';
}

/**
 * Format workspaces as a table for terminal output.
 *
 * Columns: Name, Store, Created, Uploads
 */
export function formatWorkspaceTable(workspaces: WorkspaceData[]): string {
  if (workspaces.length === 0) {
    return 'No workspaces found.';
  }

  const headers = ['Name', 'Store', 'Created', 'Uploads'];
  const rows = workspaces.map(ws => [
    ws.name,
    ws.storeName,
    formatDate(ws.createdAt),
    String(Object.keys(ws.uploads).length),
  ]);

  return buildTable(headers, rows);
}

/**
 * Format uploads as a table with expiration indicators.
 *
 * Columns: ID (first 8 chars), Title (truncated to 40 chars), Source, Date, Flags, Expiration
 */
export function formatUploadTable(uploads: UploadEntry[]): string {
  if (uploads.length === 0) {
    return 'No uploads found.';
  }

  const headers = ['ID', 'Title', 'Source', 'Date', 'Flags', 'Expiration'];
  const rows = uploads.map(upload => {
    const indicator = getExpirationIndicator(upload.expirationDate);
    const expirationDisplay = upload.expirationDate
      ? `${formatDate(upload.expirationDate)} ${indicator}`.trim()
      : '';
    const flagsDisplay = upload.flags.join(', ');

    return [
      upload.id.slice(0, 8),
      truncate(upload.title, 40),
      upload.sourceType,
      formatDate(upload.timestamp),
      flagsDisplay,
      expirationDisplay,
    ];
  });

  return buildTable(headers, rows);
}

/**
 * Format a query result with answer and citations.
 *
 * Displays the answer text followed by a citations table if citations exist.
 */
export function formatQueryResult(result: QueryResult): string {
  const parts: string[] = [];

  parts.push('Answer:');
  parts.push(result.answer);

  if (result.citations.length > 0) {
    parts.push('');
    parts.push('Citations:');

    const headers = ['#', 'Source', 'Title', 'Excerpt'];
    const rows = result.citations.map((citation: Citation, index: number) => [
      String(index + 1),
      citation.documentUri,
      citation.documentTitle,
      truncate(citation.text, 60),
    ]);

    parts.push(buildTable(headers, rows));
  }

  return parts.join('\n');
}

/**
 * Format a metadata header for an upload entry display.
 *
 * Shows: ID, Title, Source, URL, Uploaded, Expiration, Flags
 */
export function formatUploadMetadataHeader(upload: UploadEntry): string {
  const indicator = getExpirationIndicator(upload.expirationDate);
  const expirationDisplay = upload.expirationDate
    ? `${upload.expirationDate} ${indicator}`.trim()
    : 'None';
  const flagsDisplay = upload.flags.length > 0 ? upload.flags.join(', ') : 'None';

  const lines: string[] = [];
  lines.push('=== Upload Metadata ===');
  lines.push(`Title:       ${upload.title}`);
  lines.push(`ID:          ${upload.id}`);
  lines.push(`Source Type: ${upload.sourceType}`);
  lines.push(`Source URL:  ${upload.sourceUrl ?? 'N/A'}`);
  lines.push(`Uploaded:    ${upload.timestamp}`);
  lines.push(`Expiration:  ${expirationDisplay}`);
  lines.push(`Flags:       ${flagsDisplay}`);
  lines.push(`Document:    ${upload.documentName}`);
  lines.push('');
  lines.push('=== Content ===');

  return lines.join('\n');
}

/**
 * Format workspace info display in key-value format.
 *
 * Shows: Name, Store Name, Created, Total uploads, uploads by source type,
 * expired uploads count, expiring soon count.
 */
export function formatWorkspaceInfo(workspace: WorkspaceData): string {
  const uploads = Object.values(workspace.uploads);
  const totalUploads = uploads.length;

  // Count uploads by source type
  const bySource: Record<string, number> = {};
  for (const upload of uploads) {
    bySource[upload.sourceType] = (bySource[upload.sourceType] || 0) + 1;
  }

  // Count expired and expiring soon
  let expiredCount = 0;
  let expiringSoonCount = 0;
  for (const upload of uploads) {
    const indicator = getExpirationIndicator(upload.expirationDate);
    if (indicator === '[EXPIRED]') {
      expiredCount++;
    } else if (indicator === '[EXPIRING SOON]') {
      expiringSoonCount++;
    }
  }

  const lines: string[] = [];
  lines.push(`Name:             ${workspace.name}`);
  lines.push(`Store Name:       ${workspace.storeName}`);
  lines.push(`Created:          ${formatDate(workspace.createdAt)}`);
  lines.push(`Total Uploads:    ${totalUploads}`);

  if (Object.keys(bySource).length > 0) {
    lines.push('Uploads by Source:');
    for (const [source, count] of Object.entries(bySource)) {
      lines.push(`  ${source}: ${count}`);
    }
  }

  lines.push(`Expired:          ${expiredCount}`);
  lines.push(`Expiring Soon:    ${expiringSoonCount}`);

  // Collect metadata labels in use (FR-05, AC-03)
  const labels = new Set<string>();
  for (const upload of uploads) {
    labels.add('title');
    labels.add('source_type');
    labels.add('timestamp');
    if (upload.sourceUrl !== null) {
      labels.add('source_url');
    }
    if (upload.expirationDate !== null) {
      labels.add('expiration_date');
    }
    if (upload.flags.length > 0) {
      labels.add('flags');
    }
  }

  if (labels.size > 0) {
    const sortedLabels = Array.from(labels).sort();
    lines.push(`Labels in Use:    ${sortedLabels.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format the channel scan summary block.
 *
 * Displays total, uploaded, skipped, and failed counts.
 * If there are failures, lists each one with title and error message.
 */
export function formatChannelScanSummary(result: ChannelScanResult): string {
  const lines: string[] = [];

  lines.push('Channel Scan Complete');
  lines.push(`Total:    ${result.totalVideos}`);
  lines.push(`Uploaded: ${result.uploaded}`);
  lines.push(`Skipped:  ${result.skipped}`);
  lines.push(`Failed:   ${result.failed}`);

  if (result.failed > 0 && result.errors.length > 0) {
    lines.push('');
    lines.push('Failures:');
    for (const err of result.errors) {
      lines.push(`  - ${err.title}: ${err.error}`);
    }
  }

  return lines.join('\n');
}

/**
 * Tests for formatting utilities.
 *
 * Run: npx tsx test_scripts/test-format.ts
 */

import { strict as assert } from 'node:assert';
import {
  getExpirationIndicator,
  formatWorkspaceTable,
  formatUploadTable,
  formatQueryResult,
  formatWorkspaceInfo,
} from '../src/utils/format.js';
import type { WorkspaceData, UploadEntry, QueryResult } from '../src/types/index.js';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    failed++;
    errors.push(`${name}: ${err.message}`);
    console.log(`  FAIL: ${name} - ${err.message}`);
  }
}

// ===== Helper factories =====

function makeUpload(overrides: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    documentName: 'fileSearchStores/store1/documents/doc1',
    title: 'Test Upload',
    timestamp: '2026-03-15T10:00:00Z',
    sourceType: 'file',
    sourceUrl: '/path/to/file.txt',
    expirationDate: null,
    flags: [],
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<WorkspaceData> & { uploads?: Record<string, UploadEntry> } = {}): WorkspaceData {
  return {
    name: 'test-workspace',
    storeName: 'fileSearchStores/abc123',
    createdAt: '2026-01-10T08:00:00Z',
    uploads: {},
    ...overrides,
  };
}

// ===== Tests =====

console.log('\n=== getExpirationIndicator tests ===\n');

test('null returns empty string', () => {
  assert.equal(getExpirationIndicator(null), '');
});

test('past date returns "[EXPIRED]"', () => {
  assert.equal(getExpirationIndicator('2020-01-01'), '[EXPIRED]');
});

test('date within 7 days returns "[EXPIRING SOON]"', () => {
  // Create a date 3 days from now
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const dateStr = soon.toISOString().slice(0, 10);
  assert.equal(getExpirationIndicator(dateStr), '[EXPIRING SOON]');
});

test('future date >7 days returns empty string', () => {
  // Create a date 30 days from now
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const dateStr = future.toISOString().slice(0, 10);
  assert.equal(getExpirationIndicator(dateStr), '');
});

test('date exactly today returns "[EXPIRING SOON]"', () => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const result = getExpirationIndicator(dateStr);
  // Today could be either EXPIRING SOON or EXPIRED depending on time of day
  assert.ok(
    result === '[EXPIRING SOON]' || result === '[EXPIRED]',
    `Expected "[EXPIRING SOON]" or "[EXPIRED]", got "${result}"`
  );
});

console.log('\n=== formatWorkspaceTable tests ===\n');

test('empty array returns "No workspaces found."', () => {
  assert.equal(formatWorkspaceTable([]), 'No workspaces found.');
});

test('array with workspaces contains headers and workspace names', () => {
  const ws1 = makeWorkspace({ name: 'alpha', storeName: 'store-alpha' });
  const ws2 = makeWorkspace({ name: 'beta', storeName: 'store-beta' });
  const result = formatWorkspaceTable([ws1, ws2]);

  assert.ok(result.includes('Name'), 'Should contain Name header');
  assert.ok(result.includes('Store'), 'Should contain Store header');
  assert.ok(result.includes('Created'), 'Should contain Created header');
  assert.ok(result.includes('Uploads'), 'Should contain Uploads header');
  assert.ok(result.includes('alpha'), 'Should contain workspace name "alpha"');
  assert.ok(result.includes('beta'), 'Should contain workspace name "beta"');
});

test('workspace table shows correct upload count', () => {
  const upload1 = makeUpload({ id: 'id-1' });
  const upload2 = makeUpload({ id: 'id-2' });
  const ws = makeWorkspace({
    name: 'with-uploads',
    uploads: { 'id-1': upload1, 'id-2': upload2 },
  });
  const result = formatWorkspaceTable([ws]);
  assert.ok(result.includes('2'), 'Should show upload count of 2');
});

console.log('\n=== formatUploadTable tests ===\n');

test('empty array returns "No uploads found."', () => {
  assert.equal(formatUploadTable([]), 'No uploads found.');
});

test('array with uploads contains IDs (first 8 chars) and titles', () => {
  const upload = makeUpload({
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    title: 'My Important Document',
  });
  const result = formatUploadTable([upload]);

  assert.ok(result.includes('abcdef12'), 'Should contain first 8 chars of ID');
  assert.ok(result.includes('My Important Document'), 'Should contain title');
  assert.ok(result.includes('ID'), 'Should contain ID header');
  assert.ok(result.includes('Title'), 'Should contain Title header');
  assert.ok(result.includes('Source'), 'Should contain Source header');
});

test('upload table shows expiration indicator for expired uploads', () => {
  const upload = makeUpload({
    expirationDate: '2020-06-15',
  });
  const result = formatUploadTable([upload]);
  assert.ok(result.includes('[EXPIRED]'), 'Should contain [EXPIRED] indicator');
});

test('upload table shows flags', () => {
  const upload = makeUpload({
    flags: ['urgent', 'completed'],
  });
  const result = formatUploadTable([upload]);
  assert.ok(result.includes('urgent'), 'Should contain flag "urgent"');
  assert.ok(result.includes('completed'), 'Should contain flag "completed"');
});

console.log('\n=== formatQueryResult tests ===\n');

test('result with answer and citations contains both', () => {
  const result: QueryResult = {
    answer: 'The answer to your question is 42.',
    citations: [
      {
        text: 'According to the source, the answer is 42.',
        documentTitle: 'Hitchhiker Guide',
        documentUri: 'docs/guide.txt',
      },
    ],
  };
  const formatted = formatQueryResult(result);

  assert.ok(formatted.includes('Answer:'), 'Should contain "Answer:" label');
  assert.ok(formatted.includes('The answer to your question is 42.'), 'Should contain answer text');
  assert.ok(formatted.includes('Citations:'), 'Should contain "Citations:" label');
  assert.ok(formatted.includes('Hitchhiker Guide'), 'Should contain citation document title');
  assert.ok(formatted.includes('docs/guide.txt'), 'Should contain citation document URI');
});

test('result with answer only (no citations) has no Citations section', () => {
  const result: QueryResult = {
    answer: 'No relevant information found.',
    citations: [],
  };
  const formatted = formatQueryResult(result);

  assert.ok(formatted.includes('Answer:'), 'Should contain "Answer:" label');
  assert.ok(formatted.includes('No relevant information found.'), 'Should contain answer text');
  assert.ok(!formatted.includes('Citations:'), 'Should NOT contain "Citations:" section');
});

test('result with multiple citations shows all', () => {
  const result: QueryResult = {
    answer: 'Combined answer from sources.',
    citations: [
      { text: 'First source text', documentTitle: 'Doc A', documentUri: 'uri-a' },
      { text: 'Second source text', documentTitle: 'Doc B', documentUri: 'uri-b' },
    ],
  };
  const formatted = formatQueryResult(result);

  assert.ok(formatted.includes('Doc A'), 'Should contain first citation title');
  assert.ok(formatted.includes('Doc B'), 'Should contain second citation title');
});

console.log('\n=== formatWorkspaceInfo tests ===\n');

test('workspace with uploads shows name, counts, source type breakdown', () => {
  const uploads: Record<string, UploadEntry> = {
    'id-1': makeUpload({ id: 'id-1', sourceType: 'file' }),
    'id-2': makeUpload({ id: 'id-2', sourceType: 'file' }),
    'id-3': makeUpload({ id: 'id-3', sourceType: 'web', sourceUrl: 'https://example.com' }),
    'id-4': makeUpload({ id: 'id-4', sourceType: 'note', sourceUrl: null }),
  };
  const ws = makeWorkspace({
    name: 'research-workspace',
    storeName: 'fileSearchStores/xyz789',
    uploads,
  });
  const formatted = formatWorkspaceInfo(ws);

  assert.ok(formatted.includes('research-workspace'), 'Should contain workspace name');
  assert.ok(formatted.includes('Total Uploads:    4'), 'Should show total upload count of 4');
  assert.ok(formatted.includes('file: 2'), 'Should show file source count');
  assert.ok(formatted.includes('web: 1'), 'Should show web source count');
  assert.ok(formatted.includes('note: 1'), 'Should show note source count');
  assert.ok(formatted.includes('Uploads by Source:'), 'Should contain source breakdown header');
});

test('workspace info shows expired and expiring counts', () => {
  const uploads: Record<string, UploadEntry> = {
    'id-1': makeUpload({ id: 'id-1', expirationDate: '2020-01-01' }), // expired
    'id-2': makeUpload({ id: 'id-2', expirationDate: '2020-06-01' }), // expired
  };
  const ws = makeWorkspace({ name: 'old-ws', uploads });
  const formatted = formatWorkspaceInfo(ws);

  assert.ok(formatted.includes('Expired:          2'), 'Should show 2 expired uploads');
});

test('workspace info shows store name and created date', () => {
  const ws = makeWorkspace({
    name: 'info-test',
    storeName: 'fileSearchStores/store-abc',
    createdAt: '2026-04-01T12:00:00Z',
  });
  const formatted = formatWorkspaceInfo(ws);

  assert.ok(formatted.includes('fileSearchStores/store-abc'), 'Should contain store name');
  assert.ok(formatted.includes('2026-04-01'), 'Should contain formatted creation date');
});

test('empty workspace shows zero counts', () => {
  const ws = makeWorkspace({ name: 'empty-ws', uploads: {} });
  const formatted = formatWorkspaceInfo(ws);

  assert.ok(formatted.includes('Total Uploads:    0'), 'Should show 0 uploads');
  assert.ok(formatted.includes('Expired:          0'), 'Should show 0 expired');
  assert.ok(formatted.includes('Expiring Soon:    0'), 'Should show 0 expiring soon');
});

// ===== Summary =====

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(`  - ${e}`));
}
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}

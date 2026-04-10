/**
 * Tests for the get command utilities (offline-only).
 *
 * Tests formatUploadMetadataHeader from format.ts and
 * findUploadById partial matching logic (re-implemented locally).
 * API-dependent tests are marked SKIP.
 *
 * Run: npx tsx test_scripts/test-get-command.ts
 */

import { strict as assert } from 'node:assert';
import { formatUploadMetadataHeader } from '../src/utils/format.js';
import type { UploadEntry } from '../src/types/index.js';

// --- Re-implement findUploadById locally to test without importing
//     the get command module (which pulls in config/gemini dependencies).

function findUploadById(
  uploads: Record<string, UploadEntry>,
  uploadId: string
): UploadEntry | undefined {
  // Try exact match first
  if (uploads[uploadId]) {
    return uploads[uploadId];
  }

  // Try partial match (prefix)
  const matches = Object.values(uploads).filter((u) =>
    u.id.startsWith(uploadId)
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous upload ID '${uploadId}'. Matches: ${matches.map((m) => m.id.slice(0, 8)).join(', ')}. Provide more characters.`
    );
  }

  return undefined;
}

// --- Test data factory

function createUploadEntry(overrides: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: 'abcd1234-5678-9abc-def0-123456789abc',
    documentName: 'fileSearchStores/store1/documents/doc1',
    title: 'Test Upload',
    timestamp: '2026-04-10T10:00:00Z',
    sourceType: 'file',
    sourceUrl: '/path/to/file.txt',
    expirationDate: null,
    flags: [],
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  PASS: ${name}`);
    })
    .catch((err: Error) => {
      failed++;
      errors.push(`${name}: ${err.message}`);
      console.log(`  FAIL: ${name} - ${err.message}`);
    });
}

async function run() {
  console.log('\n=== formatUploadMetadataHeader tests ===\n');

  await test('displays all metadata fields correctly', () => {
    const upload = createUploadEntry({
      title: 'My Document',
      id: 'aaaa1111-2222-3333-4444-555566667777',
      sourceType: 'web',
      sourceUrl: 'https://example.com/page',
      timestamp: '2026-04-10T12:30:00Z',
      expirationDate: null,
      flags: [],
      documentName: 'fileSearchStores/abc/documents/xyz',
    });

    const header = formatUploadMetadataHeader(upload);
    assert.ok(header.includes('=== Upload Metadata ==='));
    assert.ok(header.includes('Title:       My Document'));
    assert.ok(header.includes('ID:          aaaa1111-2222-3333-4444-555566667777'));
    assert.ok(header.includes('Source Type: web'));
    assert.ok(header.includes('Source URL:  https://example.com/page'));
    assert.ok(header.includes('Uploaded:    2026-04-10T12:30:00Z'));
    assert.ok(header.includes('Expiration:  None'));
    assert.ok(header.includes('Flags:       None'));
    assert.ok(header.includes('Document:    fileSearchStores/abc/documents/xyz'));
    assert.ok(header.includes('=== Content ==='));
  });

  await test('displays N/A for null sourceUrl', () => {
    const upload = createUploadEntry({ sourceUrl: null });
    const header = formatUploadMetadataHeader(upload);
    assert.ok(header.includes('Source URL:  N/A'));
  });

  await test('displays expiration date when set', () => {
    const upload = createUploadEntry({ expirationDate: '2027-01-01' });
    const header = formatUploadMetadataHeader(upload);
    assert.ok(header.includes('Expiration:  2027-01-01'));
  });

  await test('displays flags when set', () => {
    const upload = createUploadEntry({ flags: ['completed', 'urgent'] });
    const header = formatUploadMetadataHeader(upload);
    assert.ok(header.includes('Flags:       completed, urgent'));
  });

  await test('displays source type for youtube uploads', () => {
    const upload = createUploadEntry({ sourceType: 'youtube', sourceUrl: 'https://youtube.com/watch?v=abc' });
    const header = formatUploadMetadataHeader(upload);
    assert.ok(header.includes('Source Type: youtube'));
  });

  await test('displays source type for note uploads', () => {
    const upload = createUploadEntry({ sourceType: 'note', sourceUrl: null });
    const header = formatUploadMetadataHeader(upload);
    assert.ok(header.includes('Source Type: note'));
    assert.ok(header.includes('Source URL:  N/A'));
  });

  console.log('\n=== findUploadById partial matching tests ===\n');

  const uploads: Record<string, UploadEntry> = {
    'aaaa1111-2222-3333-4444-555566667777': createUploadEntry({
      id: 'aaaa1111-2222-3333-4444-555566667777',
      title: 'First Upload',
    }),
    'aaaa1111-9999-8888-7777-666655554444': createUploadEntry({
      id: 'aaaa1111-9999-8888-7777-666655554444',
      title: 'Second Upload',
    }),
    'bbbb2222-3333-4444-5555-666677778888': createUploadEntry({
      id: 'bbbb2222-3333-4444-5555-666677778888',
      title: 'Third Upload',
    }),
  };

  await test('exact match: finds by full UUID', () => {
    const result = findUploadById(uploads, 'aaaa1111-2222-3333-4444-555566667777');
    assert.ok(result);
    assert.equal(result.title, 'First Upload');
  });

  await test('partial match: unique prefix finds single result', () => {
    const result = findUploadById(uploads, 'bbbb');
    assert.ok(result);
    assert.equal(result.title, 'Third Upload');
  });

  await test('partial match: longer prefix resolves ambiguity', () => {
    const result = findUploadById(uploads, 'aaaa1111-2');
    assert.ok(result);
    assert.equal(result.title, 'First Upload');
  });

  await test('ambiguous partial match: throws descriptive error', () => {
    assert.throws(
      () => findUploadById(uploads, 'aaaa1111'),
      (err: Error) => {
        assert.ok(err.message.includes('Ambiguous upload ID'));
        assert.ok(err.message.includes('aaaa1111'));
        return true;
      }
    );
  });

  await test('no match: returns undefined', () => {
    const result = findUploadById(uploads, 'zzzz9999');
    assert.equal(result, undefined);
  });

  await test('empty uploads: returns undefined', () => {
    const result = findUploadById({}, 'anything');
    assert.equal(result, undefined);
  });

  console.log('\n=== Skipped tests ===\n');
  console.log('  SKIP: get command with live Gemini API - requires GEMINI_API_KEY');
  console.log('  SKIP: getDocumentContent retrieval - requires live Gemini File Search Store');

  // Summary
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
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

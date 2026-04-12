/**
 * Tests for src/utils/filters.ts
 * Run: npx tsx test_scripts/test-filters.ts
 */

import {
  parseListingFilter,
  parseFilter,
  applyFilters,
  sortUploads,
  findUploadById,
  buildMetadataFilter,
  passesClientFilters,
  GEMINI_FILTER_KEYS,
  CLIENT_FILTER_KEYS,
} from '../src/utils/filters.js';
import type { ParsedFilter, UploadEntry } from '../src/types/index.js';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function expectThrow(fn: () => void, substringInMessage?: string): void {
  let threw = false;
  try {
    fn();
  } catch (e: unknown) {
    threw = true;
    if (substringInMessage && e instanceof Error) {
      if (!e.message.includes(substringInMessage)) {
        throw new Error(
          `Expected error containing "${substringInMessage}", got: "${e.message}"`
        );
      }
    }
  }
  if (!threw) {
    throw new Error('Expected function to throw, but it did not');
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e: unknown) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`${name}: ${msg}`);
    console.log(`  FAIL: ${name} -- ${msg}`);
  }
}

// ===== Helper factory =====

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

// ========== parseListingFilter ==========
console.log('\n--- parseListingFilter ---');

test('parses source_type=file correctly', () => {
  const result = parseListingFilter('source_type=file');
  assert(result.key === 'source_type', `key should be source_type, got ${result.key}`);
  assert(result.value === 'file', `value should be file, got ${result.value}`);
});

test('parses flags=urgent correctly', () => {
  const result = parseListingFilter('flags=urgent');
  assert(result.key === 'flags', `key should be flags, got ${result.key}`);
  assert(result.value === 'urgent', `value should be urgent, got ${result.value}`);
});

test('parses expiration_status=expired correctly', () => {
  const result = parseListingFilter('expiration_status=expired');
  assert(result.key === 'expiration_status', `key should be expiration_status`);
  assert(result.value === 'expired', `value should be expired`);
});

test('rejects filter without equals sign', () => {
  expectThrow(() => parseListingFilter('source_type'), 'Invalid filter format');
});

test('rejects empty string', () => {
  expectThrow(() => parseListingFilter(''), 'Invalid filter format');
});

test('rejects unknown key', () => {
  expectThrow(() => parseListingFilter('unknown_key=value'), 'Unknown filter key');
});

test('rejects source_url as listing filter key', () => {
  expectThrow(() => parseListingFilter('source_url=https://example.com'), 'Unknown filter key');
});

test('handles value containing equals sign', () => {
  const result = parseListingFilter('source_type=a=b');
  assert(result.key === 'source_type', `key should be source_type`);
  assert(result.value === 'a=b', `value should be a=b, got ${result.value}`);
});

// ========== parseFilter ==========
console.log('\n--- parseFilter ---');

test('parses source_type as gemini layer', () => {
  const result = parseFilter('source_type=web');
  assert(result.key === 'source_type', `key should be source_type`);
  assert(result.value === 'web', `value should be web`);
  assert(result.layer === 'gemini', `layer should be gemini, got ${result.layer}`);
});

test('parses source_url as gemini layer', () => {
  const result = parseFilter('source_url=https://example.com');
  assert(result.key === 'source_url', `key should be source_url`);
  assert(result.value === 'https://example.com', `value should be the URL`);
  assert(result.layer === 'gemini', `layer should be gemini`);
});

test('parses flags as client layer', () => {
  const result = parseFilter('flags=completed');
  assert(result.key === 'flags', `key should be flags`);
  assert(result.value === 'completed', `value should be completed`);
  assert(result.layer === 'client', `layer should be client, got ${result.layer}`);
});

test('parses expiration_date as client layer', () => {
  const result = parseFilter('expiration_date=2026-12-31');
  assert(result.key === 'expiration_date', `key should be expiration_date`);
  assert(result.value === '2026-12-31', `value should be 2026-12-31`);
  assert(result.layer === 'client', `layer should be client`);
});

test('parses expiration_status as client layer', () => {
  const result = parseFilter('expiration_status=expired');
  assert(result.key === 'expiration_status', `key should be expiration_status`);
  assert(result.layer === 'client', `layer should be client`);
});

test('rejects filter without equals sign', () => {
  expectThrow(() => parseFilter('source_type'), 'Invalid filter format');
});

test('rejects unknown key', () => {
  expectThrow(() => parseFilter('bogus_key=value'), 'Unknown filter key');
});

test('handles URL value with equals signs', () => {
  const result = parseFilter('source_url=https://example.com?q=1&r=2');
  assert(result.value === 'https://example.com?q=1&r=2', `value should preserve full URL`);
});

// ========== buildMetadataFilter ==========
console.log('\n--- buildMetadataFilter ---');

test('returns undefined for empty array', () => {
  const result = buildMetadataFilter([]);
  assert(result === undefined, `should return undefined, got ${result}`);
});

test('builds single filter', () => {
  const filters: ParsedFilter[] = [{ key: 'source_type', value: 'web', layer: 'gemini' }];
  const result = buildMetadataFilter(filters);
  assert(result === 'source_type="web"', `should be source_type="web", got ${result}`);
});

test('builds multiple filters with AND', () => {
  const filters: ParsedFilter[] = [
    { key: 'source_type', value: 'web', layer: 'gemini' },
    { key: 'source_url', value: 'https://example.com', layer: 'gemini' },
  ];
  const result = buildMetadataFilter(filters);
  assert(
    result === 'source_type="web" AND source_url="https://example.com"',
    `should join with AND, got ${result}`
  );
});

// ========== passesClientFilters ==========
console.log('\n--- passesClientFilters ---');

test('returns true when no filters', () => {
  const upload = makeUpload();
  assert(passesClientFilters(upload, []) === true, 'should pass with no filters');
});

test('returns false when upload is undefined and filters present', () => {
  const filters: ParsedFilter[] = [{ key: 'flags', value: 'urgent', layer: 'client' }];
  assert(passesClientFilters(undefined, filters) === false, 'should fail for undefined upload');
});

test('passes when upload has matching flag', () => {
  const upload = makeUpload({ flags: ['urgent', 'completed'] });
  const filters: ParsedFilter[] = [{ key: 'flags', value: 'urgent', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === true, 'should pass for matching flag');
});

test('fails when upload lacks requested flag', () => {
  const upload = makeUpload({ flags: ['completed'] });
  const filters: ParsedFilter[] = [{ key: 'flags', value: 'urgent', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === false, 'should fail for missing flag');
});

test('passes expiration_status=expired for past date', () => {
  const upload = makeUpload({ expirationDate: '2020-01-01' });
  const filters: ParsedFilter[] = [{ key: 'expiration_status', value: 'expired', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === true, 'should pass for expired upload');
});

test('fails expiration_status=expired for future date', () => {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const upload = makeUpload({ expirationDate: future.toISOString().slice(0, 10) });
  const filters: ParsedFilter[] = [{ key: 'expiration_status', value: 'expired', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === false, 'should fail for non-expired upload');
});

test('passes expiration_status=active for no expiration', () => {
  const upload = makeUpload({ expirationDate: null });
  const filters: ParsedFilter[] = [{ key: 'expiration_status', value: 'active', layer: 'client' }];
  // null expirationDate => getExpirationIndicator returns '' => matches 'active'
  assert(passesClientFilters(upload, filters) === true, 'should pass for active (no expiration)');
});

test('fails expiration_status=active for expired upload', () => {
  const upload = makeUpload({ expirationDate: '2020-01-01' });
  const filters: ParsedFilter[] = [{ key: 'expiration_status', value: 'active', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === false, 'should fail for expired when checking active');
});

test('passes expiration_date match', () => {
  const upload = makeUpload({ expirationDate: '2026-06-15' });
  const filters: ParsedFilter[] = [{ key: 'expiration_date', value: '2026-06-15', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === true, 'should pass for matching expiration_date');
});

test('fails expiration_date mismatch', () => {
  const upload = makeUpload({ expirationDate: '2026-06-15' });
  const filters: ParsedFilter[] = [{ key: 'expiration_date', value: '2026-12-31', layer: 'client' }];
  assert(passesClientFilters(upload, filters) === false, 'should fail for non-matching expiration_date');
});

test('multiple client filters must all pass (AND)', () => {
  const upload = makeUpload({ flags: ['urgent'], expirationDate: '2020-01-01' });
  const filters: ParsedFilter[] = [
    { key: 'flags', value: 'urgent', layer: 'client' },
    { key: 'expiration_status', value: 'expired', layer: 'client' },
  ];
  assert(passesClientFilters(upload, filters) === true, 'should pass when all conditions met');
});

test('multiple client filters fail if one fails', () => {
  const upload = makeUpload({ flags: ['completed'], expirationDate: '2020-01-01' });
  const filters: ParsedFilter[] = [
    { key: 'flags', value: 'urgent', layer: 'client' },
    { key: 'expiration_status', value: 'expired', layer: 'client' },
  ];
  assert(passesClientFilters(upload, filters) === false, 'should fail when flag does not match');
});

// ========== applyFilters ==========
console.log('\n--- applyFilters ---');

test('returns all uploads when no filters', () => {
  const uploads = [makeUpload({ id: '1' }), makeUpload({ id: '2' })];
  const result = applyFilters(uploads, []);
  assert(result.length === 2, `should return 2, got ${result.length}`);
});

test('filters by source_type', () => {
  const uploads = [
    makeUpload({ id: '1', sourceType: 'file' }),
    makeUpload({ id: '2', sourceType: 'web' }),
    makeUpload({ id: '3', sourceType: 'file' }),
  ];
  const result = applyFilters(uploads, [{ key: 'source_type', value: 'file' }]);
  assert(result.length === 2, `should return 2 file uploads, got ${result.length}`);
  assert(result.every((u) => u.sourceType === 'file'), 'all should be file type');
});

test('filters by flags', () => {
  const uploads = [
    makeUpload({ id: '1', flags: ['urgent'] }),
    makeUpload({ id: '2', flags: ['completed'] }),
    makeUpload({ id: '3', flags: ['urgent', 'completed'] }),
  ];
  const result = applyFilters(uploads, [{ key: 'flags', value: 'urgent' }]);
  assert(result.length === 2, `should return 2 urgent uploads, got ${result.length}`);
});

test('filters by expiration_status=expired', () => {
  const uploads = [
    makeUpload({ id: '1', expirationDate: '2020-01-01' }),
    makeUpload({ id: '2', expirationDate: null }),
    makeUpload({ id: '3', expirationDate: '2020-06-01' }),
  ];
  const result = applyFilters(uploads, [{ key: 'expiration_status', value: 'expired' }]);
  assert(result.length === 2, `should return 2 expired uploads, got ${result.length}`);
});

test('combines multiple filters (AND logic)', () => {
  const uploads = [
    makeUpload({ id: '1', sourceType: 'web', flags: ['urgent'] }),
    makeUpload({ id: '2', sourceType: 'web', flags: [] }),
    makeUpload({ id: '3', sourceType: 'file', flags: ['urgent'] }),
  ];
  const result = applyFilters(uploads, [
    { key: 'source_type', value: 'web' },
    { key: 'flags', value: 'urgent' },
  ]);
  assert(result.length === 1, `should return 1 upload matching both, got ${result.length}`);
  assert(result[0].id === '1', `should be upload id 1`);
});

test('returns empty array when no matches', () => {
  const uploads = [makeUpload({ id: '1', sourceType: 'file' })];
  const result = applyFilters(uploads, [{ key: 'source_type', value: 'youtube' }]);
  assert(result.length === 0, `should return 0, got ${result.length}`);
});

// ========== sortUploads ==========
console.log('\n--- sortUploads ---');

test('sorts ascending with "timestamp"', () => {
  const uploads = [
    makeUpload({ id: '1', timestamp: '2026-03-15T10:00:00Z' }),
    makeUpload({ id: '2', timestamp: '2026-01-01T08:00:00Z' }),
    makeUpload({ id: '3', timestamp: '2026-06-20T12:00:00Z' }),
  ];
  const result = sortUploads(uploads, 'timestamp');
  assert(result[0].id === '2', `first should be earliest (id 2), got ${result[0].id}`);
  assert(result[1].id === '1', `second should be id 1, got ${result[1].id}`);
  assert(result[2].id === '3', `third should be latest (id 3), got ${result[2].id}`);
});

test('sorts descending with "-timestamp"', () => {
  const uploads = [
    makeUpload({ id: '1', timestamp: '2026-03-15T10:00:00Z' }),
    makeUpload({ id: '2', timestamp: '2026-01-01T08:00:00Z' }),
    makeUpload({ id: '3', timestamp: '2026-06-20T12:00:00Z' }),
  ];
  const result = sortUploads(uploads, '-timestamp');
  assert(result[0].id === '3', `first should be latest (id 3), got ${result[0].id}`);
  assert(result[2].id === '2', `last should be earliest (id 2), got ${result[2].id}`);
});

test('defaults to descending when sortField is undefined', () => {
  const uploads = [
    makeUpload({ id: '1', timestamp: '2026-03-15T10:00:00Z' }),
    makeUpload({ id: '2', timestamp: '2026-01-01T08:00:00Z' }),
    makeUpload({ id: '3', timestamp: '2026-06-20T12:00:00Z' }),
  ];
  const result = sortUploads(uploads);
  assert(result[0].id === '3', `first should be latest without sortField, got ${result[0].id}`);
});

test('does not mutate original array', () => {
  const uploads = [
    makeUpload({ id: '1', timestamp: '2026-03-15T10:00:00Z' }),
    makeUpload({ id: '2', timestamp: '2026-01-01T08:00:00Z' }),
  ];
  const sorted = sortUploads(uploads, 'timestamp');
  assert(uploads[0].id === '1', 'original should be unchanged');
  assert(sorted[0].id === '2', 'sorted should be reordered');
});

test('handles empty array', () => {
  const result = sortUploads([], 'timestamp');
  assert(result.length === 0, 'should return empty array');
});

test('handles single element', () => {
  const uploads = [makeUpload({ id: '1' })];
  const result = sortUploads(uploads, 'timestamp');
  assert(result.length === 1, 'should return single element');
  assert(result[0].id === '1', 'should be same element');
});

// ========== findUploadById ==========
console.log('\n--- findUploadById ---');

test('finds by exact ID', () => {
  const uploads: Record<string, UploadEntry> = {
    'abcdef12-3456-7890-abcd-ef1234567890': makeUpload({ id: 'abcdef12-3456-7890-abcd-ef1234567890' }),
    'bbbbbb12-3456-7890-abcd-ef1234567890': makeUpload({ id: 'bbbbbb12-3456-7890-abcd-ef1234567890' }),
  };
  const result = findUploadById(uploads, 'abcdef12-3456-7890-abcd-ef1234567890');
  assert(result !== undefined, 'should find upload');
  assert(result!.id === 'abcdef12-3456-7890-abcd-ef1234567890', 'should match exact ID');
});

test('finds by partial ID (prefix)', () => {
  const uploads: Record<string, UploadEntry> = {
    'abcdef12-3456-7890-abcd-ef1234567890': makeUpload({ id: 'abcdef12-3456-7890-abcd-ef1234567890' }),
    'bbbbbb12-3456-7890-abcd-ef1234567890': makeUpload({ id: 'bbbbbb12-3456-7890-abcd-ef1234567890' }),
  };
  const result = findUploadById(uploads, 'abcdef12');
  assert(result !== undefined, 'should find upload by prefix');
  assert(result!.id === 'abcdef12-3456-7890-abcd-ef1234567890', 'should match by prefix');
});

test('returns undefined for non-existing ID', () => {
  const uploads: Record<string, UploadEntry> = {
    'abcdef12-3456-7890-abcd-ef1234567890': makeUpload({ id: 'abcdef12-3456-7890-abcd-ef1234567890' }),
  };
  const result = findUploadById(uploads, 'zzzzz');
  assert(result === undefined, 'should return undefined for non-existing ID');
});

test('throws on ambiguous partial ID', () => {
  const uploads: Record<string, UploadEntry> = {
    'abc00001-3456-7890-abcd-ef1234567890': makeUpload({ id: 'abc00001-3456-7890-abcd-ef1234567890' }),
    'abc00002-3456-7890-abcd-ef1234567890': makeUpload({ id: 'abc00002-3456-7890-abcd-ef1234567890' }),
  };
  expectThrow(() => findUploadById(uploads, 'abc'), 'Ambiguous upload ID');
});

test('returns undefined for empty uploads record', () => {
  const result = findUploadById({}, 'anything');
  assert(result === undefined, 'should return undefined for empty record');
});

// ========== Constants ==========
console.log('\n--- Constants ---');

test('GEMINI_FILTER_KEYS contains source_type and source_url', () => {
  assert(GEMINI_FILTER_KEYS.has('source_type'), 'should contain source_type');
  assert(GEMINI_FILTER_KEYS.has('source_url'), 'should contain source_url');
  assert(GEMINI_FILTER_KEYS.size === 2, `should have 2 entries, got ${GEMINI_FILTER_KEYS.size}`);
});

test('CLIENT_FILTER_KEYS contains flags, expiration_date, expiration_status, tag', () => {
  assert(CLIENT_FILTER_KEYS.has('flags'), 'should contain flags');
  assert(CLIENT_FILTER_KEYS.has('expiration_date'), 'should contain expiration_date');
  assert(CLIENT_FILTER_KEYS.has('expiration_status'), 'should contain expiration_status');
  assert(CLIENT_FILTER_KEYS.has('tag'), 'should contain tag');
  assert(CLIENT_FILTER_KEYS.size === 4, `should have 4 entries, got ${CLIENT_FILTER_KEYS.size}`);
});

// ===== Summary =====

console.log(`\n========================================`);
console.log(`Filter Tests: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach((e) => console.log(`  - ${e}`));
}
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}

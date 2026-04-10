/**
 * Tests for src/utils/validation.ts
 * Run: npx tsx test_scripts/test-validation.ts
 */

import {
  validateMimeType,
  validateDate,
  validateFlags,
  validateWorkspaceName,
  validateUrl,
  extractYouTubeVideoId,
} from '../src/utils/validation.js';

let passed = 0;
let failed = 0;

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
    console.log(`  FAIL: ${name} -- ${msg}`);
  }
}

// ========== validateMimeType ==========
console.log('\n--- validateMimeType ---');

test('accepts text/plain', () => {
  assert(validateMimeType('text/plain') === true, 'should return true');
});

test('accepts application/pdf', () => {
  assert(validateMimeType('application/pdf') === true, 'should return true');
});

test('accepts application/json', () => {
  assert(validateMimeType('application/json') === true, 'should return true');
});

test('rejects image/png', () => {
  expectThrow(() => validateMimeType('image/png'), 'Unsupported file type');
});

test('rejects empty string', () => {
  expectThrow(() => validateMimeType(''), 'Unsupported file type');
});

test('rejects arbitrary string', () => {
  expectThrow(() => validateMimeType('foo/bar'), 'Unsupported file type');
});

// ========== validateDate ==========
console.log('\n--- validateDate ---');

test('accepts valid date 2026-01-15', () => {
  assert(validateDate('2026-01-15') === true, 'should return true');
});

test('accepts leap day 2024-02-29', () => {
  assert(validateDate('2024-02-29') === true, 'should return true');
});

test('rejects bad format dd/mm/yyyy', () => {
  expectThrow(() => validateDate('15/01/2026'), 'Invalid date format');
});

test('rejects bad format yyyy-m-d', () => {
  expectThrow(() => validateDate('2026-1-5'), 'Invalid date format');
});

test('rejects Feb 30', () => {
  expectThrow(() => validateDate('2026-02-30'), 'Invalid date format');
});

test('rejects Feb 29 in non-leap year', () => {
  expectThrow(() => validateDate('2025-02-29'), 'Invalid date format');
});

test('rejects month 13', () => {
  expectThrow(() => validateDate('2026-13-01'), 'Invalid date format');
});

// ========== validateFlags ==========
console.log('\n--- validateFlags ---');

test('accepts valid flags [completed, urgent]', () => {
  assert(validateFlags(['completed', 'urgent']) === true, 'should return true');
});

test('accepts single flag [inactive]', () => {
  assert(validateFlags(['inactive']) === true, 'should return true');
});

test('accepts empty array', () => {
  assert(validateFlags([]) === true, 'should return true');
});

test('rejects invalid flag "done"', () => {
  expectThrow(() => validateFlags(['done']), "Invalid flag 'done'");
});

test('rejects mixed valid+invalid', () => {
  expectThrow(() => validateFlags(['completed', 'bogus']), "Invalid flag 'bogus'");
});

// ========== validateWorkspaceName ==========
console.log('\n--- validateWorkspaceName ---');

test('accepts alphanumeric name', () => {
  assert(validateWorkspaceName('myWorkspace123') === true, 'should return true');
});

test('accepts hyphens and underscores', () => {
  assert(validateWorkspaceName('my-work_space') === true, 'should return true');
});

test('rejects empty string', () => {
  expectThrow(() => validateWorkspaceName(''), 'cannot be empty');
});

test('rejects whitespace-only', () => {
  expectThrow(() => validateWorkspaceName('   '), 'cannot be empty');
});

test('rejects name with spaces', () => {
  expectThrow(() => validateWorkspaceName('my workspace'), 'Invalid workspace name');
});

test('rejects name with special chars', () => {
  expectThrow(() => validateWorkspaceName('ws@#!'), 'Invalid workspace name');
});

test('rejects name with dots', () => {
  expectThrow(() => validateWorkspaceName('my.workspace'), 'Invalid workspace name');
});

// ========== validateUrl ==========
console.log('\n--- validateUrl ---');

test('accepts https URL', () => {
  assert(validateUrl('https://example.com') === true, 'should return true');
});

test('accepts http URL', () => {
  assert(validateUrl('http://example.com/path?q=1') === true, 'should return true');
});

test('rejects ftp URL', () => {
  expectThrow(() => validateUrl('ftp://files.example.com'), 'Invalid URL');
});

test('rejects non-URL string', () => {
  expectThrow(() => validateUrl('not a url'), 'Invalid URL');
});

test('rejects empty string', () => {
  expectThrow(() => validateUrl(''), 'Invalid URL');
});

// ========== extractYouTubeVideoId ==========
console.log('\n--- extractYouTubeVideoId ---');

test('extracts from www.youtube.com/watch?v=ID', () => {
  assert(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123') === 'abc123',
    'should extract abc123'
  );
});

test('extracts from youtube.com/watch?v=ID (no www)', () => {
  assert(
    extractYouTubeVideoId('https://youtube.com/watch?v=xyz789') === 'xyz789',
    'should extract xyz789'
  );
});

test('extracts from youtu.be/ID', () => {
  assert(
    extractYouTubeVideoId('https://youtu.be/shortID') === 'shortID',
    'should extract shortID'
  );
});

test('extracts from youtube.com/embed/ID', () => {
  assert(
    extractYouTubeVideoId('https://www.youtube.com/embed/emb123') === 'emb123',
    'should extract emb123'
  );
});

test('extracts from youtube.com/v/ID', () => {
  assert(
    extractYouTubeVideoId('https://www.youtube.com/v/vid456') === 'vid456',
    'should extract vid456'
  );
});

test('extracts with extra query params', () => {
  assert(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=test1&t=30') === 'test1',
    'should extract test1'
  );
});

test('rejects non-YouTube URL', () => {
  expectThrow(
    () => extractYouTubeVideoId('https://vimeo.com/12345'),
    'Invalid YouTube URL'
  );
});

test('rejects youtube URL without video ID', () => {
  expectThrow(
    () => extractYouTubeVideoId('https://www.youtube.com/'),
    'Invalid YouTube URL'
  );
});

test('rejects plain string', () => {
  expectThrow(
    () => extractYouTubeVideoId('not-a-url'),
    'Invalid YouTube URL'
  );
});

// ========== Summary ==========
console.log(`\n=== Validation Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}

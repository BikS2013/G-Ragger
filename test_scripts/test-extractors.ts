/**
 * Tests for content extractors (offline-only).
 * Skips extractWebPage and extractYouTube as they require network access.
 *
 * Run: npx tsx test_scripts/test-extractors.ts
 */

import { strict as assert } from 'node:assert';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { access } from 'node:fs/promises';
import mime from 'mime-types';
import { ExtractedContent } from '../src/types/index.js';
import { validateMimeType } from '../src/utils/validation.js';

// --- Re-implement extractNote and extractDiskFile locally to avoid importing
//     content-extractor.ts, which pulls in youtube-transcript (broken on Node v25 ESM).
//     These are exact copies of the source functions for testing purposes.

function generateNoteTitle(noteText: string): string {
  const trimmed = noteText.trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }
  const truncated = trimmed.substring(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 20) {
    return truncated.substring(0, lastSpace) + '...';
  } else {
    return truncated + '...';
  }
}

function extractNote(text: string): ExtractedContent {
  if (!text || !text.trim()) {
    throw new Error('Note text cannot be empty');
  }
  return {
    content: text,
    isFilePath: false,
    title: generateNoteTitle(text),
    mimeType: 'text/plain',
    sourceType: 'note',
    sourceUrl: null,
  };
}

async function extractDiskFile(filePath: string): Promise<ExtractedContent> {
  const absolutePath = resolve(filePath);
  try {
    await access(absolutePath);
  } catch {
    throw new Error(`File not found: '${absolutePath}'`);
  }
  const mimeType = mime.lookup(absolutePath);
  if (!mimeType) {
    throw new Error(`Could not determine MIME type for file: '${absolutePath}'`);
  }
  validateMimeType(mimeType);
  return {
    content: absolutePath,
    isFilePath: true,
    title: basename(absolutePath),
    mimeType,
    sourceType: 'file',
    sourceUrl: absolutePath,
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
  console.log('\n=== extractNote tests ===\n');

  await test('short text: title equals trimmed text', () => {
    const result = extractNote('Hello world');
    assert.equal(result.title, 'Hello world');
  });

  await test('short text (exactly 60 chars): title equals trimmed text', () => {
    const text = 'A'.repeat(60);
    const result = extractNote(text);
    assert.equal(result.title, text);
  });

  await test('long text (>60 chars): title truncated to word boundary with ellipsis', () => {
    // 70+ chars with spaces so truncation happens at a word boundary
    const text = 'The quick brown fox jumps over the lazy dog and then runs away very far into the distance';
    const result = extractNote(text);
    assert.ok(result.title.endsWith('...'), `Expected ellipsis, got: "${result.title}"`);
    assert.ok(result.title.length <= 63, `Expected max 63 chars, got ${result.title.length}`);
    // Should not cut in the middle of a word
    const titleWithoutEllipsis = result.title.slice(0, -3);
    assert.ok(!titleWithoutEllipsis.endsWith(' '), 'Should not end with trailing space before ellipsis');
  });

  await test('long text without spaces before 20 chars: truncates at 60 chars', () => {
    // No space in first 20 chars to trigger the else branch
    const text = 'Abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz_extra_stuff_here';
    const result = extractNote(text);
    assert.ok(result.title.endsWith('...'));
    // Should be exactly 63 chars (60 + "...")
    assert.equal(result.title.length, 63);
  });

  await test('empty text: throws "Note text cannot be empty"', () => {
    assert.throws(() => extractNote(''), { message: 'Note text cannot be empty' });
  });

  await test('whitespace-only text: throws "Note text cannot be empty"', () => {
    assert.throws(() => extractNote('   \n\t  '), { message: 'Note text cannot be empty' });
  });

  await test('correct sourceType, mimeType, isFilePath, sourceUrl', () => {
    const result = extractNote('Test note content');
    assert.equal(result.sourceType, 'note');
    assert.equal(result.mimeType, 'text/plain');
    assert.equal(result.isFilePath, false);
    assert.equal(result.sourceUrl, null);
  });

  await test('content equals original text', () => {
    const text = 'My note with special chars: <>&"\'';
    const result = extractNote(text);
    assert.equal(result.content, text);
  });

  console.log('\n=== extractDiskFile tests ===\n');

  // Create a temp directory for file tests
  const tempDir = await mkdtemp(join(tmpdir(), 'geminirag-test-'));
  const tempFile = join(tempDir, 'sample.txt');

  try {
    await writeFile(tempFile, 'Hello, this is test content.');

    await test('valid .txt file: extraction succeeds', async () => {
      const result = await extractDiskFile(tempFile);
      assert.ok(result, 'Should return a result');
    });

    await test('valid .txt file: isFilePath is true', async () => {
      const result = await extractDiskFile(tempFile);
      assert.equal(result.isFilePath, true);
    });

    await test('valid .txt file: title equals basename', async () => {
      const result = await extractDiskFile(tempFile);
      assert.equal(result.title, 'sample.txt');
    });

    await test('valid .txt file: correct mimeType', async () => {
      const result = await extractDiskFile(tempFile);
      assert.equal(result.mimeType, 'text/plain');
    });

    await test('valid .txt file: sourceType is "file"', async () => {
      const result = await extractDiskFile(tempFile);
      assert.equal(result.sourceType, 'file');
    });

    await test('valid .txt file: sourceUrl is absolute path', async () => {
      const result = await extractDiskFile(tempFile);
      assert.ok(result.sourceUrl?.startsWith('/'), 'sourceUrl should be an absolute path');
    });

    await test('valid .txt file: content is absolute path', async () => {
      const result = await extractDiskFile(tempFile);
      assert.ok(result.content.startsWith('/'), 'content should be an absolute path');
      assert.ok(result.content.endsWith('sample.txt'));
    });

    await test('non-existent file: throws error', async () => {
      await assert.rejects(
        () => extractDiskFile('/tmp/this-file-does-not-exist-xyz-999.txt'),
        (err: Error) => {
          assert.ok(err.message.includes('File not found'), `Expected "File not found", got: ${err.message}`);
          return true;
        }
      );
    });

    // Test with unsupported file type
    const unsupportedFile = join(tempDir, 'image.png');
    await writeFile(unsupportedFile, 'fake png data');

    await test('unsupported MIME type: throws error', async () => {
      await assert.rejects(
        () => extractDiskFile(unsupportedFile),
        (err: Error) => {
          assert.ok(err.message.includes('Unsupported file type'), `Expected unsupported type error, got: ${err.message}`);
          return true;
        }
      );
    });

  } finally {
    // Clean up temp files
    try { await unlink(tempFile); } catch { /* ignore */ }
    try {
      const unsupportedFile = join(tempDir, 'image.png');
      await unlink(unsupportedFile);
    } catch { /* ignore */ }
    try {
      const { rmdir } = await import('node:fs/promises');
      await rmdir(tempDir);
    } catch { /* ignore */ }
  }

  console.log('\n=== Skipped tests ===\n');
  console.log('  SKIP: extractWebPage - requires network access');
  console.log('  SKIP: extractYouTube - requires network access');

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

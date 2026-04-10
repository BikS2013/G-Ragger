/**
 * Tests for enhanced YouTube extraction (offline-only).
 *
 * Tests buildTranscriptWithParagraphs logic, extractNote regression,
 * and note title generation regression.
 *
 * Run: npx tsx test_scripts/test-youtube-enhanced.ts
 */

import { strict as assert } from 'node:assert';
import { ExtractedContent } from '../src/types/index.js';

// --- Re-implement buildTranscriptWithParagraphs locally to test without
//     importing content-extractor.ts (which pulls in youtube-transcript).

function buildTranscriptWithParagraphs(
  items: Array<{ text: string; offset: number; duration: number }>,
  pauseThresholdSeconds: number = 2.0
): string {
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (let i = 0; i < items.length; i++) {
    currentParagraph.push(items[i].text);

    if (i < items.length - 1) {
      const currentEnd = items[i].offset + items[i].duration;
      const nextStart = items[i + 1].offset;
      const gap = nextStart - currentEnd;

      if (gap > pauseThresholdSeconds) {
        paragraphs.push(currentParagraph.join(' '));
        currentParagraph = [];
      }
    }
  }

  // Flush remaining text
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '));
  }

  return paragraphs.join('\n\n');
}

// --- Re-implement extractNote and generateNoteTitle locally (regression tests)

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
  console.log('\n=== buildTranscriptWithParagraphs tests ===\n');

  await test('segments with >2s gap: inserts paragraph break', () => {
    const items = [
      { text: 'Hello world', offset: 0, duration: 2 },
      { text: 'second segment', offset: 5, duration: 1 }, // gap: 5 - (0+2) = 3 > 2
      { text: 'third segment', offset: 7, duration: 1 },  // gap: 7 - (5+1) = 1 <= 2
    ];
    const result = buildTranscriptWithParagraphs(items);
    assert.equal(result, 'Hello world\n\nsecond segment third segment');
  });

  await test('segments with no gap: joins with space', () => {
    const items = [
      { text: 'Hello', offset: 0, duration: 2 },
      { text: 'world', offset: 2, duration: 2 },    // gap: 2 - (0+2) = 0
      { text: 'foo', offset: 4, duration: 1 },       // gap: 4 - (2+2) = 0
    ];
    const result = buildTranscriptWithParagraphs(items);
    assert.equal(result, 'Hello world foo');
  });

  await test('segments with exactly 2s gap: no paragraph break (threshold is >2)', () => {
    const items = [
      { text: 'A', offset: 0, duration: 1 },
      { text: 'B', offset: 3, duration: 1 }, // gap: 3 - (0+1) = 2 (not > 2)
    ];
    const result = buildTranscriptWithParagraphs(items);
    assert.equal(result, 'A B');
  });

  await test('segments with 2.1s gap: inserts paragraph break', () => {
    const items = [
      { text: 'A', offset: 0, duration: 1 },
      { text: 'B', offset: 3.1, duration: 1 }, // gap: 3.1 - 1 = 2.1 > 2
    ];
    const result = buildTranscriptWithParagraphs(items);
    assert.equal(result, 'A\n\nB');
  });

  await test('single segment: returns just that text', () => {
    const items = [
      { text: 'Only segment here', offset: 0, duration: 5 },
    ];
    const result = buildTranscriptWithParagraphs(items);
    assert.equal(result, 'Only segment here');
  });

  await test('empty array: returns empty string', () => {
    const result = buildTranscriptWithParagraphs([]);
    assert.equal(result, '');
  });

  await test('multiple paragraph breaks in sequence', () => {
    const items = [
      { text: 'Part one', offset: 0, duration: 1 },
      { text: 'Part two', offset: 10, duration: 1 },   // gap: 10-1 = 9 > 2
      { text: 'Part three', offset: 20, duration: 1 },  // gap: 20-11 = 9 > 2
    ];
    const result = buildTranscriptWithParagraphs(items);
    assert.equal(result, 'Part one\n\nPart two\n\nPart three');
  });

  await test('custom pause threshold: 5 seconds', () => {
    const items = [
      { text: 'A', offset: 0, duration: 1 },
      { text: 'B', offset: 4, duration: 1 }, // gap: 3 <= 5
      { text: 'C', offset: 11, duration: 1 }, // gap: 6 > 5
    ];
    const result = buildTranscriptWithParagraphs(items, 5.0);
    assert.equal(result, 'A B\n\nC');
  });

  console.log('\n=== extractNote regression tests ===\n');

  await test('extractNote: basic text returns correct structure', () => {
    const result = extractNote('Test note');
    assert.equal(result.content, 'Test note');
    assert.equal(result.isFilePath, false);
    assert.equal(result.mimeType, 'text/plain');
    assert.equal(result.sourceType, 'note');
    assert.equal(result.sourceUrl, null);
  });

  await test('extractNote: empty text throws', () => {
    assert.throws(() => extractNote(''), { message: 'Note text cannot be empty' });
  });

  await test('extractNote: whitespace-only throws', () => {
    assert.throws(() => extractNote('   '), { message: 'Note text cannot be empty' });
  });

  console.log('\n=== generateNoteTitle regression tests ===\n');

  await test('title: short text (<= 60 chars) returned as-is', () => {
    const result = extractNote('Short title');
    assert.equal(result.title, 'Short title');
  });

  await test('title: long text truncated at word boundary with ellipsis', () => {
    const text = 'The quick brown fox jumps over the lazy dog and then runs away very far into the distance';
    const result = extractNote(text);
    assert.ok(result.title.endsWith('...'));
    assert.ok(result.title.length <= 63);
  });

  await test('title: exactly 60 chars returned as-is', () => {
    const text = 'A'.repeat(60);
    const result = extractNote(text);
    assert.equal(result.title, text);
  });

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

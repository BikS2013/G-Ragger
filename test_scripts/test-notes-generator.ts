/**
 * Tests for notes-generator service.
 *
 * Only offline tests are run. The actual Gemini API call is marked SKIP.
 *
 * Run: npx tsx test_scripts/test-notes-generator.ts
 */

import { strict as assert } from 'node:assert';

// Import the actual function to verify it is importable
import { generateNotes } from '../src/services/notes-generator.js';

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
  console.log('\n=== notes-generator import tests ===\n');

  await test('generateNotes is a function', () => {
    assert.equal(typeof generateNotes, 'function');
  });

  await test('generateNotes accepts 4 parameters (ai, model, title, transcript)', () => {
    // Function.length reports the number of declared parameters
    assert.equal(generateNotes.length, 4);
  });

  console.log('\n=== notes-generator error handling tests ===\n');

  await test('throws when AI client returns empty response', async () => {
    // Create a mock AI client that returns empty text
    const mockAi = {
      models: {
        generateContent: async () => ({
          text: '',
        }),
      },
    } as any;

    await assert.rejects(
      () => generateNotes(mockAi, 'test-model', 'Test Title', 'Some transcript text'),
      (err: Error) => {
        assert.ok(
          err.message.includes('empty response'),
          `Expected "empty response" in message, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  await test('throws when AI client returns whitespace-only response', async () => {
    const mockAi = {
      models: {
        generateContent: async () => ({
          text: '   \n  ',
        }),
      },
    } as any;

    await assert.rejects(
      () => generateNotes(mockAi, 'test-model', 'Test Title', 'Some transcript'),
      (err: Error) => {
        assert.ok(
          err.message.includes('empty response'),
          `Expected "empty response" in message, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  await test('returns notes when AI client returns valid response', async () => {
    const mockAi = {
      models: {
        generateContent: async () => ({
          text: '## Summary\nThis is a test summary.\n\n## Key Points\n- Point 1\n- Point 2',
        }),
      },
    } as any;

    const result = await generateNotes(
      mockAi, 'test-model', 'Test Title', 'Some transcript'
    );
    assert.ok(result.includes('Summary'));
    assert.ok(result.includes('Key Points'));
  });

  await test('throws when AI client throws an error', async () => {
    const mockAi = {
      models: {
        generateContent: async () => {
          throw new Error('API quota exceeded');
        },
      },
    } as any;

    await assert.rejects(
      () => generateNotes(mockAi, 'test-model', 'Test Title', 'Some transcript'),
      (err: Error) => {
        assert.ok(
          err.message.includes('API quota exceeded'),
          `Expected API error, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  console.log('\n=== Skipped tests ===\n');
  console.log('  SKIP: generateNotes with live Gemini API - requires GEMINI_API_KEY');

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

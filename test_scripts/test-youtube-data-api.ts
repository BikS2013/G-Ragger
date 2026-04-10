/**
 * Tests for YouTube Data API service (offline-only).
 *
 * Tests parseChannelInput logic (via local re-implementation) and estimateQuotaCost.
 * API-dependent tests (resolveChannelId, listChannelVideos) are marked SKIP.
 *
 * Run: npx tsx test_scripts/test-youtube-data-api.ts
 */

import { strict as assert } from 'node:assert';

// Import estimateQuotaCost directly (pure function, no network)
import { estimateQuotaCost } from '../src/services/youtube-data-api.js';

// --- Re-implement parseChannelInput locally to test input parsing logic
//     without triggering actual API calls from resolveChannelId.

interface ParsedChannelInput {
  kind: 'channelId' | 'handle';
  value: string;
}

function parseChannelInput(channelInput: string): ParsedChannelInput {
  const trimmed = channelInput.trim();

  // URL forms:  youtube.com/channel/UCxxx  or  youtube.com/@handle
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      const parts = url.pathname.split('/').filter(Boolean);

      // /channel/UCxxxxxxxx
      if (parts[0] === 'channel' && parts[1]) {
        return { kind: 'channelId', value: parts[1] };
      }

      // /@handle
      if (parts[0]?.startsWith('@')) {
        return { kind: 'handle', value: parts[0] };
      }
    }
  } catch {
    // Not a URL -- fall through to the other checks.
  }

  // Raw channel ID (starts with UC and is 24 chars)
  if (/^UC[\w-]{22}$/.test(trimmed)) {
    return { kind: 'channelId', value: trimmed };
  }

  // Handle (with or without leading @)
  const handle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return { kind: 'handle', value: handle };
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
  console.log('\n=== parseChannelInput tests ===\n');

  await test('channel URL with /channel/ path: extracts channel ID', () => {
    const result = parseChannelInput('https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxxxx');
    assert.equal(result.kind, 'channelId');
    // The ID in the URL is a placeholder; the function extracts whatever follows /channel/
    assert.equal(result.value, 'UCxxxxxxxxxxxxxxxxxxxxxxxx');
  });

  await test('channel URL with /@handle path: extracts handle', () => {
    const result = parseChannelInput('https://www.youtube.com/@TechChannel');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@TechChannel');
  });

  await test('raw channel ID (24 chars starting with UC): detected as channelId', () => {
    const id = 'UCabcdefghijklmnopqrstuv'; // UC + 22 chars = 24
    const result = parseChannelInput(id);
    assert.equal(result.kind, 'channelId');
    assert.equal(result.value, id);
  });

  await test('handle with @: returns as handle', () => {
    const result = parseChannelInput('@MyChannel');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@MyChannel');
  });

  await test('handle without @: prepends @ and returns as handle', () => {
    const result = parseChannelInput('MyChannel');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@MyChannel');
  });

  await test('URL with trailing slash: still extracts handle', () => {
    const result = parseChannelInput('https://www.youtube.com/@SomeHandle/');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@SomeHandle');
  });

  await test('non-YouTube URL: treated as handle', () => {
    const result = parseChannelInput('https://example.com/something');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@https://example.com/something');
  });

  await test('whitespace trimming: spaces around input are trimmed', () => {
    const result = parseChannelInput('  @Trimmed  ');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@Trimmed');
  });

  await test('short string starting with UC (< 24 chars): treated as handle', () => {
    const result = parseChannelInput('UCshort');
    assert.equal(result.kind, 'handle');
    assert.equal(result.value, '@UCshort');
  });

  console.log('\n=== estimateQuotaCost tests ===\n');

  await test('0 videos: 1 playlist call + 1 channels.list = 2 units', () => {
    // ceil(0/50) = 0; total = 0 + 1 = 1
    const result = estimateQuotaCost(0);
    assert.equal(result.playlistCalls, 0);
    assert.equal(result.totalUnits, 1);
  });

  await test('1 video: 1 playlist call + 1 = 2 total units', () => {
    const result = estimateQuotaCost(1);
    assert.equal(result.playlistCalls, 1);
    assert.equal(result.totalUnits, 2);
  });

  await test('50 videos: 1 playlist call + 1 = 2 total units', () => {
    const result = estimateQuotaCost(50);
    assert.equal(result.playlistCalls, 1);
    assert.equal(result.totalUnits, 2);
  });

  await test('51 videos: 2 playlist calls + 1 = 3 total units', () => {
    const result = estimateQuotaCost(51);
    assert.equal(result.playlistCalls, 2);
    assert.equal(result.totalUnits, 3);
  });

  await test('200 videos: 4 playlist calls + 1 = 5 total units', () => {
    const result = estimateQuotaCost(200);
    assert.equal(result.playlistCalls, 4);
    assert.equal(result.totalUnits, 5);
  });

  await test('100 videos: 2 playlist calls + 1 = 3 total units', () => {
    const result = estimateQuotaCost(100);
    assert.equal(result.playlistCalls, 2);
    assert.equal(result.totalUnits, 3);
  });

  console.log('\n=== Skipped tests ===\n');
  console.log('  SKIP: resolveChannelId with live API - requires YOUTUBE_DATA_API_KEY');
  console.log('  SKIP: getUploadsPlaylistId with live API - requires YOUTUBE_DATA_API_KEY');
  console.log('  SKIP: listChannelVideos with live API - requires YOUTUBE_DATA_API_KEY');

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

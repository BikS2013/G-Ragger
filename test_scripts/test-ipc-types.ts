/**
 * Static analysis tests for IPC type consistency.
 * Verifies that all IPC channels defined in ipc-types.ts have matching
 * handlers in ipc-handlers.ts and preload methods in api.ts.
 *
 * Run: npx tsx test_scripts/test-ipc-types.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;
const errors: string[] = [];

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

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const ELECTRON_ROOT = path.resolve(__dirname, '..', 'electron-ui');

// ===== Read source files =====

const ipcTypesPath = path.join(ELECTRON_ROOT, 'src', 'shared', 'ipc-types.ts');
const ipcHandlersPath = path.join(ELECTRON_ROOT, 'src', 'main', 'ipc-handlers.ts');
const preloadApiPath = path.join(ELECTRON_ROOT, 'src', 'preload', 'api.ts');

const ipcTypesContent = fs.readFileSync(ipcTypesPath, 'utf-8');
const ipcHandlersContent = fs.readFileSync(ipcHandlersPath, 'utf-8');
const preloadApiContent = fs.readFileSync(preloadApiPath, 'utf-8');

// ===== Extract channels from IpcChannelMap =====

/**
 * Extract channel names from the IpcChannelMap interface in ipc-types.ts.
 * Matches lines like: 'config:validate': {
 */
function extractChannelsFromTypes(content: string): string[] {
  const channels: string[] = [];
  // Match quoted keys inside IpcChannelMap
  const mapMatch = content.match(/interface\s+IpcChannelMap\s*\{([\s\S]*?)\n\}/);
  if (!mapMatch) {
    throw new Error('Could not find IpcChannelMap interface in ipc-types.ts');
  }
  const mapBody = mapMatch[1];
  const keyRegex = /['"]([a-zA-Z:]+)['"]\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(mapBody)) !== null) {
    channels.push(match[1]);
  }
  return channels;
}

/**
 * Extract channel names registered via ipcMain.handle() in ipc-handlers.ts.
 * Matches: ipcMain.handle('channel:name',
 */
function extractChannelsFromHandlers(content: string): string[] {
  const channels: string[] = [];
  const regex = /ipcMain\.handle\(\s*['"]([a-zA-Z:]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    channels.push(match[1]);
  }
  return channels;
}

/**
 * Extract channel names invoked via ipcRenderer.invoke() in api.ts.
 * Matches: ipcRenderer.invoke('channel:name'
 */
function extractChannelsFromPreload(content: string): string[] {
  const channels: string[] = [];
  const regex = /ipcRenderer\.invoke\(\s*['"]([a-zA-Z:]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    channels.push(match[1]);
  }
  return channels;
}

const typeChannels = extractChannelsFromTypes(ipcTypesContent);
const handlerChannels = extractChannelsFromHandlers(ipcHandlersContent);
const preloadChannels = extractChannelsFromPreload(preloadApiContent);

// ========== IpcChannelMap completeness ==========
console.log('\n--- IpcChannelMap channels ---');

// Expected channels from the refined request (Section 5)
const expectedChannels = [
  'config:validate',
  'workspace:list',
  'workspace:get',
  'upload:list',
  'upload:getContent',
  'upload:download',
  'query:ask',
];

test(`IpcChannelMap has at least ${expectedChannels.length} channels`, () => {
  assert(
    typeChannels.length >= expectedChannels.length,
    `Expected at least ${expectedChannels.length} channels, found ${typeChannels.length}: ${typeChannels.join(', ')}`
  );
});

for (const channel of expectedChannels) {
  test(`IpcChannelMap defines '${channel}'`, () => {
    assert(
      typeChannels.includes(channel),
      `Channel '${channel}' not found in IpcChannelMap. Found: ${typeChannels.join(', ')}`
    );
  });
}

test('IpcChannelMap channels list for reference', () => {
  console.log(`    Channels found: ${typeChannels.join(', ')}`);
  assert(true, '');
});

// ========== Handler coverage ==========
console.log('\n--- Handler coverage (ipc-handlers.ts) ---');

test(`ipc-handlers.ts registers at least ${expectedChannels.length} handlers`, () => {
  assert(
    handlerChannels.length >= expectedChannels.length,
    `Expected at least ${expectedChannels.length} handlers, found ${handlerChannels.length}: ${handlerChannels.join(', ')}`
  );
});

for (const channel of typeChannels) {
  test(`Handler registered for '${channel}'`, () => {
    assert(
      handlerChannels.includes(channel),
      `No ipcMain.handle() found for channel '${channel}' in ipc-handlers.ts`
    );
  });
}

// Check for orphan handlers (handlers without type definition)
const orphanHandlers = handlerChannels.filter((ch) => !typeChannels.includes(ch));
test('No orphan handlers (handlers without type definition)', () => {
  assert(
    orphanHandlers.length === 0,
    `Orphan handlers found: ${orphanHandlers.join(', ')}`
  );
});

// ========== Preload coverage ==========
console.log('\n--- Preload coverage (api.ts) ---');

test(`api.ts invokes at least ${expectedChannels.length} channels`, () => {
  assert(
    preloadChannels.length >= expectedChannels.length,
    `Expected at least ${expectedChannels.length} preload invocations, found ${preloadChannels.length}: ${preloadChannels.join(', ')}`
  );
});

for (const channel of typeChannels) {
  test(`Preload method invokes '${channel}'`, () => {
    assert(
      preloadChannels.includes(channel),
      `No ipcRenderer.invoke() found for channel '${channel}' in api.ts`
    );
  });
}

// Check for orphan preload calls (invoke without type definition)
const orphanPreload = preloadChannels.filter((ch) => !typeChannels.includes(ch));
test('No orphan preload invocations (invocations without type definition)', () => {
  assert(
    orphanPreload.length === 0,
    `Orphan preload invocations found: ${orphanPreload.join(', ')}`
  );
});

// ========== Cross-check: all three match ==========
console.log('\n--- Cross-consistency ---');

test('All type channels have both handler and preload', () => {
  const missingHandler = typeChannels.filter((ch) => !handlerChannels.includes(ch));
  const missingPreload = typeChannels.filter((ch) => !preloadChannels.includes(ch));
  const issues: string[] = [];
  if (missingHandler.length > 0) {
    issues.push(`Missing handlers: ${missingHandler.join(', ')}`);
  }
  if (missingPreload.length > 0) {
    issues.push(`Missing preload: ${missingPreload.join(', ')}`);
  }
  assert(issues.length === 0, issues.join('; '));
});

test('Handler and preload channel sets are identical', () => {
  const handlerSet = new Set(handlerChannels);
  const preloadSet = new Set(preloadChannels);
  const onlyInHandler = handlerChannels.filter((ch) => !preloadSet.has(ch));
  const onlyInPreload = preloadChannels.filter((ch) => !handlerSet.has(ch));
  const issues: string[] = [];
  if (onlyInHandler.length > 0) {
    issues.push(`Only in handlers: ${onlyInHandler.join(', ')}`);
  }
  if (onlyInPreload.length > 0) {
    issues.push(`Only in preload: ${onlyInPreload.join(', ')}`);
  }
  assert(issues.length === 0, issues.join('; '));
});

// ========== Type imports check ==========
console.log('\n--- Type imports ---');

test('ipc-handlers.ts imports from ipc-types', () => {
  assert(
    ipcHandlersContent.includes('ipc-types'),
    'ipc-handlers.ts does not import from ipc-types'
  );
});

test('api.ts imports from ipc-types', () => {
  assert(
    preloadApiContent.includes('ipc-types'),
    'api.ts does not import from ipc-types'
  );
});

test('ipc-types.ts exports IpcChannelMap', () => {
  assert(
    ipcTypesContent.includes('export interface IpcChannelMap'),
    'ipc-types.ts does not export IpcChannelMap'
  );
});

test('ipc-types.ts exports IpcResult', () => {
  assert(
    ipcTypesContent.includes('export type IpcResult'),
    'ipc-types.ts does not export IpcResult'
  );
});

// ===== Summary =====

console.log(`\n========================================`);
console.log(`IPC Type Consistency Tests: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach((e) => console.log(`  - ${e}`));
}
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}

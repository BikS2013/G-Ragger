/**
 * Tests for src/services/registry.ts
 * Run: npx tsx test_scripts/test-registry.ts
 *
 * Uses a temporary directory to avoid touching the real ~/.geminirag/registry.json.
 * We override the module-level constants by rewriting the registry paths via
 * a small wrapper that patches the module internals.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { UploadEntry } from '../src/types/index.js';

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

// ========== Setup: temporary registry directory ==========

// The registry module uses module-level constants derived from os.homedir().
// We cannot easily mock those, so instead we create a temp .geminirag dir and
// monkey-patch os.homedir() BEFORE importing the registry module.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geminirag-test-'));
const originalHomedir = os.homedir;

// Override homedir so the registry module picks up our temp directory
(os as any).homedir = () => tmpDir;

// Dynamic import after patching homedir
const registry = await import('../src/services/registry.js');

function resetRegistry(): void {
  const registryPath = path.join(tmpDir, '.geminirag', 'registry.json');
  if (fs.existsSync(registryPath)) {
    fs.unlinkSync(registryPath);
  }
  const registryDir = path.join(tmpDir, '.geminirag');
  if (fs.existsSync(registryDir)) {
    fs.rmSync(registryDir, { recursive: true });
  }
}

function makeUploadEntry(overrides: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: overrides.id ?? 'upload-001',
    documentName: overrides.documentName ?? 'fileSearchStores/store1/documents/doc1',
    title: overrides.title ?? 'Test Document',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    sourceType: overrides.sourceType ?? 'file',
    sourceUrl: overrides.sourceUrl ?? '/tmp/test.pdf',
    expirationDate: overrides.expirationDate ?? null,
    flags: overrides.flags ?? [],
  };
}

// ========== Tests ==========
console.log('\n--- Registry CRUD ---');

test('addWorkspace + getWorkspace', () => {
  resetRegistry();
  registry.addWorkspace('test-ws', 'fileSearchStores/abc');
  const ws = registry.getWorkspace('test-ws');
  assert(ws.name === 'test-ws', 'name should match');
  assert(ws.storeName === 'fileSearchStores/abc', 'storeName should match');
  assert(typeof ws.createdAt === 'string', 'createdAt should be a string');
  assert(Object.keys(ws.uploads).length === 0, 'uploads should be empty');
});

test('addWorkspace with duplicate name throws', () => {
  resetRegistry();
  registry.addWorkspace('dup-ws', 'fileSearchStores/s1');
  expectThrow(
    () => registry.addWorkspace('dup-ws', 'fileSearchStores/s2'),
    "already exists"
  );
});

test('removeWorkspace + verify gone', () => {
  resetRegistry();
  registry.addWorkspace('remove-me', 'fileSearchStores/r1');
  registry.removeWorkspace('remove-me');
  expectThrow(
    () => registry.getWorkspace('remove-me'),
    "not found"
  );
});

test('getWorkspace with non-existent name throws', () => {
  resetRegistry();
  expectThrow(
    () => registry.getWorkspace('does-not-exist'),
    "not found"
  );
});

test('listWorkspaces returns correct array', () => {
  resetRegistry();
  registry.addWorkspace('ws-a', 'fileSearchStores/a');
  registry.addWorkspace('ws-b', 'fileSearchStores/b');
  registry.addWorkspace('ws-c', 'fileSearchStores/c');
  const list = registry.listWorkspaces();
  assert(list.length === 3, `expected 3, got ${list.length}`);
  const names = list.map((w) => w.name).sort();
  assert(names[0] === 'ws-a', 'first should be ws-a');
  assert(names[1] === 'ws-b', 'second should be ws-b');
  assert(names[2] === 'ws-c', 'third should be ws-c');
});

test('listWorkspaces returns empty array when none exist', () => {
  resetRegistry();
  const list = registry.listWorkspaces();
  assert(list.length === 0, 'should be empty');
});

test('addUpload + verify in workspace', () => {
  resetRegistry();
  registry.addWorkspace('upload-ws', 'fileSearchStores/u1');
  const entry = makeUploadEntry({ id: 'up-001', title: 'My Upload' });
  registry.addUpload('upload-ws', entry);
  const ws = registry.getWorkspace('upload-ws');
  assert(ws.uploads['up-001'] !== undefined, 'upload should exist');
  assert(ws.uploads['up-001'].title === 'My Upload', 'title should match');
});

test('addUpload to non-existent workspace throws', () => {
  resetRegistry();
  expectThrow(
    () => registry.addUpload('ghost-ws', makeUploadEntry()),
    "not found"
  );
});

test('removeUpload + verify gone', () => {
  resetRegistry();
  registry.addWorkspace('rm-upload-ws', 'fileSearchStores/r1');
  const entry = makeUploadEntry({ id: 'up-to-remove' });
  registry.addUpload('rm-upload-ws', entry);
  registry.removeUpload('rm-upload-ws', 'up-to-remove');
  const ws = registry.getWorkspace('rm-upload-ws');
  assert(ws.uploads['up-to-remove'] === undefined, 'upload should be gone');
});

test('removeUpload with non-existent ID throws', () => {
  resetRegistry();
  registry.addWorkspace('rm-ws2', 'fileSearchStores/r2');
  expectThrow(
    () => registry.removeUpload('rm-ws2', 'nonexistent-id'),
    "not found"
  );
});

test('updateUpload -- title change', () => {
  resetRegistry();
  registry.addWorkspace('upd-ws', 'fileSearchStores/upd');
  registry.addUpload('upd-ws', makeUploadEntry({ id: 'upd-001', title: 'Original' }));
  registry.updateUpload('upd-ws', 'upd-001', { title: 'Updated Title' });
  const ws = registry.getWorkspace('upd-ws');
  assert(ws.uploads['upd-001'].title === 'Updated Title', 'title should be updated');
});

test('updateUpload -- flag changes', () => {
  resetRegistry();
  registry.addWorkspace('flag-ws', 'fileSearchStores/f');
  registry.addUpload('flag-ws', makeUploadEntry({ id: 'flag-001', flags: [] }));
  registry.updateUpload('flag-ws', 'flag-001', { flags: ['completed', 'urgent'] });
  const ws = registry.getWorkspace('flag-ws');
  assert(ws.uploads['flag-001'].flags.length === 2, 'should have 2 flags');
  assert(ws.uploads['flag-001'].flags.includes('completed'), 'should include completed');
  assert(ws.uploads['flag-001'].flags.includes('urgent'), 'should include urgent');
});

test('updateUpload -- expiration change', () => {
  resetRegistry();
  registry.addWorkspace('exp-ws', 'fileSearchStores/e');
  registry.addUpload('exp-ws', makeUploadEntry({ id: 'exp-001', expirationDate: null }));
  registry.updateUpload('exp-ws', 'exp-001', { expirationDate: '2026-12-31' });
  const ws = registry.getWorkspace('exp-ws');
  assert(
    ws.uploads['exp-001'].expirationDate === '2026-12-31',
    'expiration should be updated'
  );
});

test('updateUpload with non-existent upload throws', () => {
  resetRegistry();
  registry.addWorkspace('upd-ws2', 'fileSearchStores/u2');
  expectThrow(
    () => registry.updateUpload('upd-ws2', 'ghost-id', { title: 'x' }),
    "not found"
  );
});

test('updateUpload with non-existent workspace throws', () => {
  resetRegistry();
  expectThrow(
    () => registry.updateUpload('ghost-ws', 'id', { title: 'x' }),
    "not found"
  );
});

// ========== Cleanup ==========
(os as any).homedir = originalHomedir;
fs.rmSync(tmpDir, { recursive: true, force: true });

// ========== Summary ==========
console.log(`\n=== Registry Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}

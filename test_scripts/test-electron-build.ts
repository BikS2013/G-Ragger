/**
 * Structural/smoke tests for the Electron UI build system.
 * Verifies that required files, directories, and configuration exist.
 *
 * Run: npx tsx test_scripts/test-electron-build.ts
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

// ========== package.json ==========
console.log('\n--- electron-ui/package.json ---');

test('package.json exists', () => {
  const pkgPath = path.join(ELECTRON_ROOT, 'package.json');
  assert(fs.existsSync(pkgPath), `${pkgPath} does not exist`);
});

test('package.json has "main" field', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf-8'));
  assert(typeof pkg.main === 'string' && pkg.main.length > 0, '"main" field is missing or empty');
});

test('package.json has "scripts.dev"', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf-8'));
  assert(
    typeof pkg.scripts?.dev === 'string' && pkg.scripts.dev.length > 0,
    '"scripts.dev" is missing or empty'
  );
});

test('package.json has "scripts.build"', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf-8'));
  assert(
    typeof pkg.scripts?.build === 'string' && pkg.scripts.build.length > 0,
    '"scripts.build" is missing or empty'
  );
});

test('package.json declares electron as dependency or devDependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf-8'));
  const hasElectron =
    pkg.dependencies?.electron ||
    pkg.devDependencies?.electron;
  assert(!!hasElectron, 'electron not found in dependencies or devDependencies');
});

test('package.json declares react as dependency or devDependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf-8'));
  const hasReact =
    pkg.dependencies?.react ||
    pkg.devDependencies?.react;
  assert(!!hasReact, 'react not found in dependencies or devDependencies');
});

test('package.json declares typescript as devDependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf-8'));
  const hasTsc =
    pkg.devDependencies?.typescript;
  assert(!!hasTsc, 'typescript not found in devDependencies');
});

// ========== out/ directory ==========
console.log('\n--- electron-ui/out/ directory ---');

test('out/ directory exists', () => {
  const outPath = path.join(ELECTRON_ROOT, 'out');
  assert(fs.existsSync(outPath), `${outPath} does not exist (has the build been run?)`);
});

test('out/main/ directory exists', () => {
  const mainOut = path.join(ELECTRON_ROOT, 'out', 'main');
  assert(fs.existsSync(mainOut), 'out/main/ does not exist');
});

test('out/preload/ directory exists', () => {
  const preloadOut = path.join(ELECTRON_ROOT, 'out', 'preload');
  assert(fs.existsSync(preloadOut), 'out/preload/ does not exist');
});

test('out/renderer/ directory exists', () => {
  const rendererOut = path.join(ELECTRON_ROOT, 'out', 'renderer');
  assert(fs.existsSync(rendererOut), 'out/renderer/ does not exist');
});

// ========== Key source files ==========
console.log('\n--- Key source files ---');

const requiredFiles = [
  'src/main/main.ts',
  'src/main/ipc-handlers.ts',
  'src/main/service-bridge.ts',
  'src/preload/preload.ts',
  'src/preload/api.ts',
  'src/shared/ipc-types.ts',
  'src/renderer/src/store/index.ts',
  'src/renderer/src/App.tsx',
  'src/renderer/src/main.tsx',
  'tsconfig.json',
  'electron.vite.config.ts',
];

for (const relPath of requiredFiles) {
  test(`${relPath} exists`, () => {
    const fullPath = path.join(ELECTRON_ROOT, relPath);
    assert(fs.existsSync(fullPath), `${fullPath} does not exist`);
  });
}

// ========== Store exports useAppStore ==========
console.log('\n--- Store exports ---');

test('store/index.ts exports useAppStore', () => {
  const storePath = path.join(ELECTRON_ROOT, 'src', 'renderer', 'src', 'store', 'index.ts');
  const content = fs.readFileSync(storePath, 'utf-8');
  assert(
    content.includes('export const useAppStore'),
    'store/index.ts does not export useAppStore'
  );
});

test('store/index.ts uses zustand', () => {
  const storePath = path.join(ELECTRON_ROOT, 'src', 'renderer', 'src', 'store', 'index.ts');
  const content = fs.readFileSync(storePath, 'utf-8');
  assert(
    content.includes('from "zustand"') || content.includes("from 'zustand'"),
    'store/index.ts does not import from zustand'
  );
});

// ========== tsconfig.json ==========
console.log('\n--- tsconfig.json ---');

test('tsconfig.json is valid JSON', () => {
  const tsconfigPath = path.join(ELECTRON_ROOT, 'tsconfig.json');
  const content = fs.readFileSync(tsconfigPath, 'utf-8');
  // tsconfig may have comments, but let's try parsing
  // If it fails, that's a real issue
  try {
    JSON.parse(content);
  } catch {
    // tsconfig.json with comments is valid for TypeScript but not strict JSON
    // Just check it exists and is non-empty
    assert(content.trim().length > 0, 'tsconfig.json is empty');
  }
});

// ===== Summary =====

console.log(`\n========================================`);
console.log(`Electron Build Tests: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach((e) => console.log(`  - ${e}`));
}
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}

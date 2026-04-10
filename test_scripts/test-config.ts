/**
 * Tests for src/config/config.ts
 * Run: npx tsx test_scripts/test-config.ts
 */

import { loadConfig } from '../src/config/config.js';

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

// Helper to save and restore env vars around each test
function withCleanEnv(fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'GEMINI_API_KEY_EXPIRATION',
  ];
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    fn();
  } finally {
    for (const key of keys) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

// Capture stderr output
function captureStderr(fn: () => void): string {
  const original = console.warn;
  const captured: string[] = [];
  console.warn = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return captured.join('\n');
}

// ========== Tests ==========
console.log('\n--- loadConfig ---');

test('throws when GEMINI_API_KEY is missing', () => {
  withCleanEnv(() => {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    expectThrow(() => loadConfig(), 'GEMINI_API_KEY is required');
  });
});

test('throws with descriptive message for missing API key', () => {
  withCleanEnv(() => {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    expectThrow(() => loadConfig(), 'aistudio.google.com');
  });
});

test('throws when GEMINI_MODEL is missing', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'test-key-123';
    expectThrow(() => loadConfig(), 'GEMINI_MODEL is required');
  });
});

test('throws with descriptive message for missing model', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'test-key-123';
    expectThrow(() => loadConfig(), 'Recommended models');
  });
});

test('valid env vars produce correct AppConfig', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'my-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const config = loadConfig();
    assert(config.geminiApiKey === 'my-api-key', 'apiKey should match');
    assert(config.geminiModel === 'gemini-2.5-flash', 'model should match');
  });
});

test('config includes expiration date when set', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'my-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_API_KEY_EXPIRATION = '2030-12-31';
    const config = loadConfig();
    assert(
      config.geminiApiKeyExpiration === '2030-12-31',
      'expiration should be set'
    );
  });
});

test('warns to stderr when API key expires within 7 days', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'my-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    // Set expiration to 3 days from now
    const future = new Date();
    future.setDate(future.getDate() + 3);
    process.env.GEMINI_API_KEY_EXPIRATION = future.toISOString().split('T')[0];
    const output = captureStderr(() => loadConfig());
    assert(output.includes('expires in'), `should warn about expiry, got: "${output}"`);
    assert(output.includes('day(s)'), 'should mention days');
  });
});

test('warns to stderr when API key has already expired', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'my-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_API_KEY_EXPIRATION = '2020-01-01';
    const output = captureStderr(() => loadConfig());
    assert(output.includes('has expired'), `should warn about expiry, got: "${output}"`);
  });
});

test('no warning when expiration is far in the future', () => {
  withCleanEnv(() => {
    process.env.GEMINI_API_KEY = 'my-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_API_KEY_EXPIRATION = '2030-12-31';
    const output = captureStderr(() => loadConfig());
    assert(output === '', `should not warn, got: "${output}"`);
  });
});

// ========== Summary ==========
console.log(`\n=== Config Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}

import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AppConfig } from '../types/index.js';

/**
 * Configuration overrides supplied directly by the caller (typically parsed CLI flags).
 * These represent Tier 4 of the resolution chain and always win over env/.env values.
 * Keys mirror the canonical env-var names.
 */
export interface ConfigOverrides {
  GOOGLE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GOOGLE_API_KEY_EXPIRATION?: string;
  GEMINI_API_KEY_EXPIRATION?: string;
  YOUTUBE_DATA_API_KEY?: string;
  YOUTUBE_DATA_API_KEY_EXPIRATION?: string;
}

const TOOL_AGENTS_DIR = path.join(os.homedir(), '.tool-agents', 'g-ragger');
const TOOL_AGENTS_ENV_PATH = path.join(TOOL_AGENTS_DIR, '.env');
const LEGACY_DATA_DIR = path.join(os.homedir(), '.g-ragger');
const LEGACY_CONFIG_JSON = path.join(LEGACY_DATA_DIR, 'config.json');

/**
 * Ensure the canonical tool-agents config directory exists with mode 0700.
 * Also ensures the legacy data directory exists for registry / UI prefs.
 */
function ensureToolDirs(): void {
  if (!fs.existsSync(TOOL_AGENTS_DIR)) {
    fs.mkdirSync(TOOL_AGENTS_DIR, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(TOOL_AGENTS_DIR, 0o700);
    } catch {
      // chmod is best-effort; do not fail startup over it.
    }
  }
  if (!fs.existsSync(LEGACY_DATA_DIR)) {
    fs.mkdirSync(LEGACY_DATA_DIR, { recursive: true });
  }
}

/**
 * Resolve a configuration value through the four-tier chain:
 *   1. Shell env (process.env) — populated before any dotenv call
 *   2. ~/.tool-agents/g-ragger/.env
 *   3. Local .env in CWD
 *   4. CLI overrides (always win)
 *
 * Each tier supports a canonical key and an optional alias key. The first
 * non-empty value wins, with later tiers (overrides) checked LAST so they
 * override earlier ones.
 *
 * Important: dotenv.config() never overrides values already in process.env,
 * so by loading the tool-level .env first and the local .env second, the
 * local .env values do NOT clobber shell-set values, which is the documented
 * precedence (shell > tool .env > local .env). Overrides are applied
 * explicitly at the end.
 */
function resolveValue(
  shellEnv: NodeJS.ProcessEnv,
  toolEnv: Record<string, string>,
  localEnv: Record<string, string>,
  overrides: ConfigOverrides,
  canonical: keyof ConfigOverrides,
  alias?: keyof ConfigOverrides,
): string | undefined {
  const keys: Array<keyof ConfigOverrides> = alias ? [canonical, alias] : [canonical];

  // Tier 4 wins
  for (const k of keys) {
    const v = overrides[k];
    if (v) return v;
  }
  // Tier 1 (shell — captured before any dotenv mutation)
  for (const k of keys) {
    const v = shellEnv[k];
    if (v) return v;
  }
  // Tier 3 (local .env)
  for (const k of keys) {
    const v = localEnv[k];
    if (v) return v;
  }
  // Tier 2 (tool-level .env)
  for (const k of keys) {
    const v = toolEnv[k];
    if (v) return v;
  }
  return undefined;
}

/**
 * Load application configuration through the four-tier resolution chain
 * (shell env > tool-agent .env > local .env > CLI overrides — later wins).
 *
 * Throws if GOOGLE_API_KEY / GEMINI_API_KEY or GEMINI_MODEL is missing.
 * Prints warning to stderr if API key expiration is within 7 days.
 *
 * @param overrides - Optional caller-supplied overrides (Tier 4 / CLI flags).
 * @returns Fully validated AppConfig object
 * @throws Error if required configuration is missing
 */
export function loadConfig(overrides: ConfigOverrides = {}): AppConfig {
  // Snapshot the shell environment BEFORE any dotenv mutation so Tier 1 stays
  // distinguishable from Tiers 2/3.
  const shellEnv: NodeJS.ProcessEnv = { ...process.env };

  // Ensure the tool-agents config directory exists with the correct mode.
  ensureToolDirs();

  // Tier 2: parse ~/.tool-agents/g-ragger/.env without mutating process.env.
  let toolEnv: Record<string, string> = {};
  if (fs.existsSync(TOOL_AGENTS_ENV_PATH)) {
    toolEnv = dotenv.parse(fs.readFileSync(TOOL_AGENTS_ENV_PATH));
  }

  // Tier 3: parse local CWD .env without mutating process.env.
  let localEnv: Record<string, string> = {};
  const localEnvPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(localEnvPath)) {
    localEnv = dotenv.parse(fs.readFileSync(localEnvPath));
  }

  // Resolve each value through the four-tier chain (later tier wins).
  const geminiApiKey = resolveValue(
    shellEnv, toolEnv, localEnv, overrides,
    'GOOGLE_API_KEY', 'GEMINI_API_KEY',
  );
  const geminiModel = resolveValue(
    shellEnv, toolEnv, localEnv, overrides,
    'GEMINI_MODEL',
  );
  const geminiApiKeyExpiration = resolveValue(
    shellEnv, toolEnv, localEnv, overrides,
    'GOOGLE_API_KEY_EXPIRATION', 'GEMINI_API_KEY_EXPIRATION',
  );
  const youtubeDataApiKey = resolveValue(
    shellEnv, toolEnv, localEnv, overrides,
    'YOUTUBE_DATA_API_KEY',
  );
  const youtubeDataApiKeyExpiration = resolveValue(
    shellEnv, toolEnv, localEnv, overrides,
    'YOUTUBE_DATA_API_KEY_EXPIRATION',
  );

  // Legacy fallback: ~/.g-ragger/config.json is supported only for users who
  // have not yet migrated. It is the LAST resort, after all four canonical
  // tiers have been exhausted. This is the SOLE exception to the
  // no-fallback rule and is recorded in the project memory file.
  let legacyConfig: Record<string, string> = {};
  if (fs.existsSync(LEGACY_CONFIG_JSON)) {
    try {
      legacyConfig = JSON.parse(fs.readFileSync(LEGACY_CONFIG_JSON, 'utf-8'));
    } catch {
      legacyConfig = {};
    }
  }
  const finalGeminiApiKey =
    geminiApiKey ?? legacyConfig.GOOGLE_API_KEY ?? legacyConfig.GEMINI_API_KEY;
  const finalGeminiModel = geminiModel ?? legacyConfig.GEMINI_MODEL;
  const finalGeminiApiKeyExpiration =
    geminiApiKeyExpiration
    ?? legacyConfig.GOOGLE_API_KEY_EXPIRATION
    ?? legacyConfig.GEMINI_API_KEY_EXPIRATION;
  const finalYoutubeDataApiKey = youtubeDataApiKey ?? legacyConfig.YOUTUBE_DATA_API_KEY;
  const finalYoutubeDataApiKeyExpiration =
    youtubeDataApiKeyExpiration ?? legacyConfig.YOUTUBE_DATA_API_KEY_EXPIRATION;

  // Validate required values — NO silent defaults.
  if (!finalGeminiApiKey) {
    throw new Error(
      'GOOGLE_API_KEY (or its alias GEMINI_API_KEY) is required but not set.\n' +
      'Obtain your API key from: https://aistudio.google.com/apikey\n' +
      'Set it using one of the following (highest priority last):\n' +
      '  1. Shell env:      export GOOGLE_API_KEY="your-key"\n' +
      `  2. Tool .env:      ${TOOL_AGENTS_ENV_PATH}    -> GOOGLE_API_KEY=your-key\n` +
      '  3. Local .env:     <cwd>/.env                                  -> GOOGLE_API_KEY=your-key\n' +
      '  4. CLI override:   pass GOOGLE_API_KEY in loadConfig overrides\n'
    );
  }

  if (!finalGeminiModel) {
    throw new Error(
      'GEMINI_MODEL is required but not set.\n' +
      'Recommended models: gemini-2.5-flash, gemini-2.5-flash-lite\n' +
      'Set it using one of the following (highest priority last):\n' +
      '  1. Shell env:      export GEMINI_MODEL="gemini-2.5-flash"\n' +
      `  2. Tool .env:      ${TOOL_AGENTS_ENV_PATH}    -> GEMINI_MODEL=gemini-2.5-flash\n` +
      '  3. Local .env:     <cwd>/.env                                  -> GEMINI_MODEL=gemini-2.5-flash\n' +
      '  4. CLI override:   pass GEMINI_MODEL in loadConfig overrides\n'
    );
  }

  // Expiration warnings (Gemini)
  if (finalGeminiApiKeyExpiration) {
    const now = new Date();
    const expirationDate = new Date(finalGeminiApiKeyExpiration);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilExpiry = Math.ceil((expirationDate.getTime() - now.getTime()) / msPerDay);

    if (daysUntilExpiry <= 0) {
      console.warn('WARNING: GOOGLE_API_KEY has expired! Renew at https://aistudio.google.com/apikey');
    } else if (daysUntilExpiry <= 7) {
      console.warn(`WARNING: GOOGLE_API_KEY expires in ${daysUntilExpiry} day(s). Renew at https://aistudio.google.com/apikey`);
    }
  }

  // Expiration warnings (YouTube Data API)
  if (finalYoutubeDataApiKeyExpiration) {
    const now = new Date();
    const ytExpirationDate = new Date(finalYoutubeDataApiKeyExpiration);
    const msPerDay = 24 * 60 * 60 * 1000;
    const ytDaysUntilExpiry = Math.ceil((ytExpirationDate.getTime() - now.getTime()) / msPerDay);

    if (ytDaysUntilExpiry <= 0) {
      console.warn('WARNING: YOUTUBE_DATA_API_KEY has expired! Renew at https://console.cloud.google.com/apis/credentials');
    } else if (ytDaysUntilExpiry <= 7) {
      console.warn(`WARNING: YOUTUBE_DATA_API_KEY expires in ${ytDaysUntilExpiry} day(s). Renew at https://console.cloud.google.com/apis/credentials`);
    }
  }

  const config: AppConfig = {
    geminiApiKey: finalGeminiApiKey,
    geminiModel: finalGeminiModel,
  };

  if (finalGeminiApiKeyExpiration) {
    config.geminiApiKeyExpiration = finalGeminiApiKeyExpiration;
  }

  if (finalYoutubeDataApiKey) {
    config.youtubeDataApiKey = finalYoutubeDataApiKey;
  }

  if (finalYoutubeDataApiKeyExpiration) {
    config.youtubeDataApiKeyExpiration = finalYoutubeDataApiKeyExpiration;
  }

  return config;
}

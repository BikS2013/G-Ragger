import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AppConfig } from '../types/index.js';

/**
 * Load application configuration from env vars > .env > config file.
 * Throws if GEMINI_API_KEY or GEMINI_MODEL is missing.
 * Prints warning to stderr if API key expiration is within 7 days.
 *
 * @returns Fully validated AppConfig object
 * @throws Error if required configuration is missing
 */
export function loadConfig(): AppConfig {
  // Step 1: Load .env file (adds to process.env, does NOT override existing env vars)
  dotenv.config();

  // Step 2: Load config file
  const configFilePath = path.join(os.homedir(), '.g-ragger', 'config.json');
  let fileConfig: Record<string, string> = {};
  if (fs.existsSync(configFilePath)) {
    fileConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
  }

  // Step 3: Resolve values with priority (env > .env [already in env] > config file)
  const geminiApiKey = process.env.GEMINI_API_KEY ?? fileConfig.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL ?? fileConfig.GEMINI_MODEL;
  const geminiApiKeyExpiration = process.env.GEMINI_API_KEY_EXPIRATION ?? fileConfig.GEMINI_API_KEY_EXPIRATION;
  const youtubeDataApiKey = process.env.YOUTUBE_DATA_API_KEY ?? fileConfig.YOUTUBE_DATA_API_KEY;
  const youtubeDataApiKeyExpiration = process.env.YOUTUBE_DATA_API_KEY_EXPIRATION ?? fileConfig.YOUTUBE_DATA_API_KEY_EXPIRATION;

  // Step 4: Validate required values -- NO FALLBACKS
  if (!geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY is required but not set.\n' +
      'Obtain your API key from: https://aistudio.google.com/apikey\n' +
      'Set it using one of the following methods:\n' +
      '  1. Environment variable: export GEMINI_API_KEY="your-key"\n' +
      '  2. .env file in project root: GEMINI_API_KEY=your-key\n' +
      '  3. Config file at ~/.g-ragger/config.json: { "GEMINI_API_KEY": "your-key" }'
    );
  }

  if (!geminiModel) {
    throw new Error(
      'GEMINI_MODEL is required but not set.\n' +
      'Recommended models: gemini-2.5-flash, gemini-2.5-flash-lite\n' +
      'Set it using one of the following methods:\n' +
      '  1. Environment variable: export GEMINI_MODEL="gemini-2.5-flash"\n' +
      '  2. .env file in project root: GEMINI_MODEL=gemini-2.5-flash\n' +
      '  3. Config file at ~/.g-ragger/config.json: { "GEMINI_MODEL": "gemini-2.5-flash" }'
    );
  }

  // Step 5: Check API key expiration warning
  if (geminiApiKeyExpiration) {
    const now = new Date();
    const expirationDate = new Date(geminiApiKeyExpiration);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilExpiry = Math.ceil((expirationDate.getTime() - now.getTime()) / msPerDay);

    if (daysUntilExpiry <= 0) {
      console.warn('WARNING: GEMINI_API_KEY has expired! Renew at https://aistudio.google.com/apikey');
    } else if (daysUntilExpiry <= 7) {
      console.warn(`WARNING: GEMINI_API_KEY expires in ${daysUntilExpiry} day(s). Renew at https://aistudio.google.com/apikey`);
    }
  }

  // Step 5b: Check YouTube Data API key expiration warning
  if (youtubeDataApiKeyExpiration) {
    const now = new Date();
    const ytExpirationDate = new Date(youtubeDataApiKeyExpiration);
    const msPerDay = 24 * 60 * 60 * 1000;
    const ytDaysUntilExpiry = Math.ceil((ytExpirationDate.getTime() - now.getTime()) / msPerDay);

    if (ytDaysUntilExpiry <= 0) {
      console.warn('WARNING: YOUTUBE_DATA_API_KEY has expired! Renew at https://console.cloud.google.com/apis/credentials');
    } else if (ytDaysUntilExpiry <= 7) {
      console.warn(`WARNING: YOUTUBE_DATA_API_KEY expires in ${ytDaysUntilExpiry} day(s). Renew at https://console.cloud.google.com/apis/credentials`);
    }
  }

  // Step 6: Return fully validated AppConfig
  const config: AppConfig = {
    geminiApiKey,
    geminiModel,
  };

  if (geminiApiKeyExpiration) {
    config.geminiApiKeyExpiration = geminiApiKeyExpiration;
  }

  if (youtubeDataApiKey) {
    config.youtubeDataApiKey = youtubeDataApiKey;
  }

  if (youtubeDataApiKeyExpiration) {
    config.youtubeDataApiKeyExpiration = youtubeDataApiKeyExpiration;
  }

  return config;
}

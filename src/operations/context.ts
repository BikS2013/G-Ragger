import type { GoogleGenAI } from '@google/genai';
import { loadConfig } from '../config/config.js';
import { createGeminiClient } from '../services/gemini-client.js';
import type { AppConfig } from '../types/index.js';

/**
 * Shared application context holding configuration and Gemini client.
 * CLI creates one per invocation; Electron service-bridge caches it.
 */
export interface AppContext {
  config: AppConfig;
  client: GoogleGenAI;
}

/**
 * Create a fresh AppContext by loading config and initializing the Gemini client.
 * Throws if configuration is missing or invalid.
 */
export function createContext(): AppContext {
  const config = loadConfig();
  const client = createGeminiClient(config);
  return { config, client };
}

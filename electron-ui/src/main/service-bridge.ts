import type { GoogleGenAI } from '@google/genai';
import { loadConfig } from '@cli/config/config.js';
import { createGeminiClient } from '@cli/services/gemini-client.js';
import type { AppConfig } from '@cli/types/index.js';
import type { IpcResult, ConfigValidation } from '../shared/ipc-types.js';

// ===== Cached State =====

let cachedConfig: AppConfig | null = null;
let cachedClient: GoogleGenAI | null = null;

// ===== Public API =====

/**
 * Initialize the service bridge: load config, create Gemini client,
 * and capture any expiration warnings emitted by loadConfig().
 *
 * Returns an IpcResult with config validation status and warnings.
 */
export function initialize(): IpcResult<ConfigValidation> {
  const warnings: string[] = [];

  // Intercept console.warn during loadConfig to capture expiration warnings
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const message = args.map(String).join(' ');
    if (message.startsWith('WARNING:')) {
      warnings.push(message);
    } else {
      originalWarn(...args);
    }
  };

  try {
    cachedConfig = loadConfig();
    cachedClient = createGeminiClient(cachedConfig);

    return {
      success: true,
      data: {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cachedConfig = null;
    cachedClient = null;

    return {
      success: false,
      error: message,
    };
  } finally {
    // Always restore console.warn
    console.warn = originalWarn;
  }
}

/**
 * Get the cached GoogleGenAI client instance.
 * Throws if initialize() has not been called or failed.
 */
export function getClient(): GoogleGenAI {
  if (!cachedClient) {
    throw new Error(
      'Service bridge not initialized. Call initialize() first.'
    );
  }
  return cachedClient;
}

/**
 * Get the cached AppConfig.
 * Throws if initialize() has not been called or failed.
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    throw new Error(
      'Service bridge not initialized. Call initialize() first.'
    );
  }
  return cachedConfig;
}

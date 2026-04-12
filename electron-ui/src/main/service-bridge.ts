import type { AppContext } from '@cli/operations/context.js';
import { createContext } from '@cli/operations/context.js';
import type { IpcResult, ConfigValidation } from '../shared/ipc-types.js';

// ===== Cached State =====

let cachedContext: AppContext | null = null;

// ===== Public API =====

/**
 * Initialize the service bridge: load config, create Gemini client,
 * and capture any expiration warnings emitted by loadConfig().
 *
 * Returns an IpcResult with config validation status and warnings.
 */
export function initialize(): IpcResult<ConfigValidation> {
  const warnings: string[] = [];

  // Intercept console.warn during createContext to capture expiration warnings
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
    cachedContext = createContext();

    return {
      success: true,
      data: {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cachedContext = null;

    return {
      success: false,
      error: message,
    };
  } finally {
    console.warn = originalWarn;
  }
}

/**
 * Get the cached AppContext.
 * Throws if initialize() has not been called or failed.
 */
export function getContext(): AppContext {
  if (!cachedContext) {
    throw new Error(
      'Service bridge not initialized. Call initialize() first.'
    );
  }
  return cachedContext;
}

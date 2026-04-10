import { GoogleGenAI } from '@google/genai';
import { AppConfig } from '../types/index.js';

/**
 * Create a GoogleGenAI SDK instance from the provided config.
 * Does not cache -- returns a new instance each time.
 *
 * @param config - AppConfig with geminiApiKey
 * @returns Initialized GoogleGenAI instance
 */
export function createGeminiClient(config: AppConfig): GoogleGenAI {
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
}

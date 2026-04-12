import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.geminirag');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Read the config file from disk.
 * Returns the file path and parsed config object.
 */
export async function getConfigFile(): Promise<{
  filePath: string;
  config: Record<string, string>;
}> {
  let config: Record<string, string> = {};
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — return empty config
  }
  return { filePath: CONFIG_FILE, config };
}

/**
 * Write config to disk, creating the directory if needed.
 */
export async function saveConfigFile(
  config: Record<string, string>
): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

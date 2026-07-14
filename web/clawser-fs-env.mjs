/**
 * clawser-fs-env.mjs — .env file loading for workspace environments
 *
 * Loads ~/.config/clawser/.env from OPFS, parses KEY=VALUE pairs,
 * and injects them into shell state environment variables.
 *
 * @module clawser-fs-env
 */

import { resolveVirtualPath, opfsWalk } from './clawser-opfs.js';

/**
 * Parse a .env file content into key-value pairs.
 * Supports # comments, empty lines, KEY=VALUE format.
 * Strips surrounding quotes from values.
 *
 * @param {string} content - Raw .env file content
 * @returns {Record<string, string>} Parsed environment variables
 *
 * @example
 * parseEnvFile('# comment\nFOO=bar\nBAZ="hello world"\n')
 * // → { FOO: 'bar', BAZ: 'hello world' }
 *
 * @example
 * parseEnvFile("SINGLE='quoted'\nNO_QUOTES=plain")
 * // → { SINGLE: 'quoted', NO_QUOTES: 'plain' }
 */
export const parseEnvFile = (content) => {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

/**
 * Load ~/.config/clawser/.env and return parsed key-value pairs.
 * Returns empty object if file doesn't exist.
 *
 * @param {string} wsId - Workspace ID
 * @returns {Promise<Record<string, string>>} Parsed environment variables
 *
 * @example
 * const env = await loadEnvFile('default');
 * // → { API_KEY: 'sk-xxx', DEBUG: 'true' }
 */
export const loadEnvFile = async (wsId) => {
  try {
    const opfsPath = resolveVirtualPath('~/.config/clawser/.env', wsId);
    const { dir, name } = await opfsWalk(opfsPath);
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    const content = await file.text();
    return parseEnvFile(content);
  } catch {
    return {};
  }
};

/**
 * Load .env and inject into shell state environment.
 * Call during workspace init.
 *
 * @param {string} wsId - Workspace ID
 * @param {{ env: Map<string, string> }} shellState - Shell state with env Map
 * @returns {Promise<Record<string, string>>} The loaded env vars
 *
 * @example
 * await injectEnvIntoShell('default', shell.state);
 * shell.state.env.get('API_KEY'); // → 'sk-xxx'
 */
export const injectEnvIntoShell = async (wsId, shellState) => {
  const env = await loadEnvFile(wsId);
  for (const [key, value] of Object.entries(env)) {
    shellState.env.set(key, value);
  }
  return env;
};

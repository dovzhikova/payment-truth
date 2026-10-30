// Reads .env without printing anything. Never pass these values to the AI.

import { existsSync, readFileSync } from 'node:fs';

export function loadEnv(path = '.env'): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function requireEnv(env: Record<string, string>, keys: string[]): void {
  const missing = keys.filter((k) => !env[k] && !process.env[k]);
  if (missing.length) throw new Error(`missing in .env: ${missing.join(', ')}`);
}

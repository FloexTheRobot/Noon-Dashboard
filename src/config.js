// config.js - loads config.json once and caches it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const DATA_DIR = join(ROOT, 'data');
const CONFIG_PATH = join(ROOT, 'config.json');

let cache = null;

export function getConfig() {
  if (cache) return cache;
  cache = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  return cache;
}

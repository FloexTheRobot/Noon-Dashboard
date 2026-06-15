// store.js - tiny file-based "database". One JSON file per table under data/.
// Mirrors the PowerShell Get-SMTable / Save-SMTable / Add-SMRow / Set-SMRow helpers.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

function tablePath(name) {
  return join(DATA_DIR, `${name}.json`);
}

export function getTable(name) {
  const path = tablePath(name);
  if (!existsSync(path)) return [];
  let raw = readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM (legacy PowerShell files)
  if (!raw || raw.trim() === '') return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function saveTable(name, data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const arr = Array.isArray(data) ? data : [data];
  writeFileSync(tablePath(name), JSON.stringify(arr, null, 2), 'utf8');
}

export function addRow(table, fields) {
  const rows = getTable(table);
  rows.push({ ...fields });
  saveTable(table, rows);
}

// Upsert by business key. Returns the saved row.
export function setRow(table, keyField, keyValue, fields) {
  const rows = getTable(table);
  let existing = rows.find((r) => r[keyField] === keyValue);
  if (existing) {
    Object.assign(existing, fields);
  } else {
    existing = { [keyField]: keyValue, ...fields };
    rows.push(existing);
  }
  saveTable(table, rows);
  return existing;
}

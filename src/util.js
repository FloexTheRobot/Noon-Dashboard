// util.js - small helpers, faithful ports of the PowerShell ones so the
// deterministic mock data matches the existing data/*.json files.

// Sum of character codes - same algorithm as Get-SMSeed.
export function seed(text) {
  let sum = 0;
  for (const ch of String(text)) sum += ch.charCodeAt(0);
  return sum;
}

// yyyy-MM-dd for a given Date (local time), default today.
export function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ISO timestamp - replaces Get-SMNow.
export function now() {
  return new Date().toISOString();
}

// Date n days before today, as yyyy-MM-dd.
export function daysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return today(d);
}

// Round to 2 decimals.
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Unique-ish id - replaces New-SMId.
export function newId(prefix = 'ID') {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 999)}`;
}

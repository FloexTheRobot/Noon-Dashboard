#!/usr/bin/env node
// cli.js - command-line entry point. Replaces the old standalone PowerShell
// scripts (Get-Dashboard, Get-MinimumPrice, New-Product, Sync-Stock,
// Send-DailyReport) with one tool over the same src/services.js logic.
//
//   node cli.js dashboard [--date 2026-06-06]
//   node cli.js minprice <code>
//   node cli.js create <code>
//   node cli.js create --file samples/products.csv     (bulk)
//   node cli.js sync --all
//   node cli.js sync --file samples/stock.csv
//   node cli.js report [--date 2026-06-05]
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import * as svc from './src/services.js';

// ---- tiny arg parser ---------------------------------------------------------
const [, , command, ...rest] = process.argv;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(a);
  }
}

// ---- console helpers ---------------------------------------------------------
const c = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function readCodes(path) {
  if (extname(path).toLowerCase() === '.xlsx') {
    throw new Error('The CLI reads .csv files. Export your .xlsx to CSV first (one item code per row).');
  }
  let raw = readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const cell = (line, idx) => (line.split(',')[idx] || '').replace(/^"|"$/g, '').trim();
  const header = lines[0].split(',').map((x) => x.replace(/^"|"$/g, '').trim());
  const known = header.findIndex((x) => /^(productcode|code|sku)$/i.test(x));
  const dataLines = known >= 0 ? lines.slice(1) : lines; // no recognised header -> all lines are codes
  const col = known >= 0 ? known : 0;
  return dataLines.map((l) => cell(l, col)).filter(Boolean);
}

function writeResultsCsv(srcPath, results) {
  const out = srcPath.replace(/\.[^.]+$/, '') + '-results.csv';
  const cols = ['code', 'ok', 'marketplaceId', 'price', 'error'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = results.map((r) => cols.map((k) => esc(r[k])).join(',')).join('\n');
  writeFileSync(out, cols.map(esc).join(',') + '\n' + body + '\n', 'utf8');
  return out;
}

function help() {
  console.log(`
${c.cyan('noon online dashboard - CLI')}

  ${c.green('node cli.js dashboard')} [--date YYYY-MM-DD]      daily KPI overview
  ${c.green('node cli.js minprice')} <code>                    minimum-price calculator
  ${c.green('node cli.js create')} <code>                      create / update one listing
  ${c.green('node cli.js create')} --file <path.csv>           bulk create from a CSV of codes
  ${c.green('node cli.js sync')} --all                         sync stock for all live listings
  ${c.green('node cli.js sync')} --file <path.csv>             sync stock for codes in a CSV
  ${c.green('node cli.js report')} [--date YYYY-MM-DD]         build/send the daily report
  ${c.green('node cli.js noon:login')}                         one-time: log in to Seller Lab, save the session
  ${c.green('node cli.js noon:upload')} [file.xlsx]            upload a NIS file (or build from --codes / --all)
  ${c.green('node cli.js noon:api-login')}                     test the noon Partner API (JWT) credentials
  ${c.green('node cli.js noon:api')} <path>                    authenticated GET against the API gateway

${c.dim('Mock data is used until real API keys are set in config.json.')}
`);
}

// ---- commands ----------------------------------------------------------------
async function run() {
  switch (command) {
    case 'dashboard': {
      const m = await svc.dashboard(flags.date || undefined);
      console.log('');
      console.log(c.cyan(`Dashboard - ${m.date}`));
      console.log(`  Sales      : ${m.sales}`);
      console.log(`  Orders     : ${m.orders}`);
      console.log(`  Views      : ${m.views}`);
      console.log(`  Live items : ${m.liveItems}`);
      break;
    }

    case 'minprice': {
      const code = positional[0];
      if (!code) throw new Error('Usage: node cli.js minprice <code>');
      const r = await svc.minimumPrice(code);
      console.log('');
      console.log(`Product           : ${r.productCode}`);
      console.log(`Recommended floor : ${c.green(r.recommendedFloor)}`);
      console.log(`Source            : ${r.source}`);
      console.log(c.cyan('\nBreakdown:'));
      for (const [k, v] of Object.entries(r.breakdown)) console.log(`  ${k.padEnd(16)}: ${v}`);
      if (r.aiReasoning) console.log(`\nAI: ${r.aiReasoning}`);
      break;
    }

    case 'create': {
      if (flags.file) {
        const codes = readCodes(flags.file);
        console.log(c.cyan(`Bulk creating ${codes.length} product(s) ...`));
        const res = await svc.newProductBulk(codes);
        console.log(`Status: ${res.status}  OK: ${res.ok}  Failed: ${res.failed}`);
        const out = writeResultsCsv(flags.file, res.results);
        console.log(`Results: ${out}`);
      } else {
        const code = positional[0];
        if (!code) throw new Error('Usage: node cli.js create <code>   (or --file <path.csv>)');
        console.log(c.cyan(`Creating ${code} ...`));
        const r = await svc.newProduct(code);
        console.log(c.green('[OK] Created'));
        console.log(`  marketplaceId : ${r.marketplaceId}`);
        console.log(`  isLive        : ${r.isLive}`);
        console.log(`  price         : ${r.price}`);
      }
      break;
    }

    case 'sync': {
      let res;
      if (flags.all) {
        console.log(c.cyan('Auto-syncing stock for all live listings ...'));
        res = await svc.updateStock({ all: true });
      } else if (flags.file) {
        const codes = readCodes(flags.file);
        console.log(c.cyan(`Syncing stock for ${codes.length} product(s) ...`));
        res = await svc.updateStock({ codes });
      } else {
        throw new Error('Usage: node cli.js sync --all   (or --file <path.csv>)');
      }
      console.log(`Status: ${res.status}  Changed: ${res.changed}  OK: ${res.ok}  Failed: ${res.failed}`);
      for (const r of res.results) {
        if (r.error) console.log(c.red(`  ${r.code}: ${r.error}`));
        else if (r.changed) console.log(`  ${r.code}: ${r.oldStock ?? '-'} -> ${r.newStock}`);
        else console.log(c.dim(`  ${r.code}: unchanged (${r.newStock})`));
      }
      break;
    }

    case 'report': {
      const r = await svc.sendDailyReport(flags.date || undefined);
      if (r.sent) console.log(c.green(`[OK] Emailed report for ${r.date}.`));
      else if (r.savedTo) console.log(c.yellow(`No SMTP configured - report saved to: ${r.savedTo}`));
      else console.log(c.red(`Failed: ${r.error || 'unknown error'}`));
      break;
    }

    case 'noon:login': {
      const { captureLogin } = await import('./src/noon-upload.js');
      await captureLogin();
      break;
    }

    case 'noon:api-login': {
      const { noonApiCheck } = await import('./src/noon-api.js');
      const r = await noonApiCheck();
      if (r.ok) console.log(c.green(`[OK] ${r.message}`));
      else console.log(c.red(`Failed: ${r.message}`));
      break;
    }

    case 'noon:api': {
      // ad-hoc authenticated GET against the gateway: node cli.js noon:api /some/path
      const { noonApi } = await import('./src/noon-api.js');
      const path = positional[0];
      if (!path) throw new Error('Usage: node cli.js noon:api <path>   e.g. /identity/public/v1/api/me');
      const res = await noonApi(path, { method: flags.method || 'GET' });
      console.log(c.cyan(`${flags.method || 'GET'} ${path} -> ${res.status}`));
      console.log((await res.text()).slice(0, 2000));
      break;
    }

    case 'noon:upload': {
      const { uploadNis } = await import('./src/noon-upload.js');
      let file = positional[0];
      if (!file) {
        // No file given -> build a NIS file from the catalog (optionally --codes a,b,c)
        const { noonCatalogXlsx } = await import('./src/catalog.js');
        const codes = flags.codes ? String(flags.codes).split(',').map((x) => x.trim()).filter(Boolean) : null;
        const { buf } = await noonCatalogXlsx({ codes, all: !!flags.all });
        file = `data/noon-upload-${Date.now()}.xlsx`;
        writeFileSync(file, buf);
        console.log(c.dim(`Built ${file}`));
      }
      console.log(c.cyan(`Uploading ${file} to noon Seller Lab ...`));
      const r = await uploadNis(file, { headless: !!flags.headless });
      if (r.ok) console.log(c.green(`[OK] ${r.message}`));
      else console.log(c.red(r.message));
      console.log(c.dim(`Screenshot: ${r.screenshot}`));
      break;
    }

    case 'help':
    case undefined:
    case '--help':
    case '-h':
      help();
      break;

    default:
      console.error(c.red(`Unknown command: ${command}`));
      help();
      process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error(c.red(`Error: ${e.message}`));
  process.exitCode = 1;
});

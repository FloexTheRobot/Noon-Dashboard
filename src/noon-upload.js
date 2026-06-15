// noon-upload.js - automates uploading the NIS file to noon Seller Lab.
// noon has no API, so this drives the Bulk Products upload page with Playwright.
//
// Auth model: you log in ONCE in a real browser window (captureLogin), the
// session cookies are saved to config.noon.sellerLab.sessionPath, and every
// upload reuses that session. Your password / OTP never touch this code.
//
//   node cli.js noon:login            - one-time: log in, save the session
//   node cli.js noon:upload <file>    - upload a generated NIS .xlsx
import { chromium } from 'playwright';
import { join, isAbsolute, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { getConfig, ROOT } from './config.js';

function sellerLabCfg() {
  const cfg = getConfig();
  const s = (cfg.noon && cfg.noon.sellerLab) || {};
  if (!s.url) throw new Error('config.noon.sellerLab.url is not set.');
  const sessionPath = isAbsolute(s.sessionPath || '')
    ? s.sessionPath
    : join(ROOT, s.sessionPath || 'auth/noon-session.json');
  return { url: s.url, email: s.email || '', sessionPath };
}

function waitForEnter(prompt) {
  if (prompt) process.stdout.write(prompt);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

const looksLikeLogin = (url) => /login|signin|sign-in|auth|accounts\.google/i.test(url);

// One-time: open a real window, let the user log in, save the session.
export async function captureLogin() {
  const s = sellerLabCfg();
  mkdirSync(dirname(s.sessionPath), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(s.url, { waitUntil: 'domcontentloaded' });
    console.log('\nA browser window opened at noon Seller Lab.');
    if (s.email) console.log(`Log in as: ${s.email}`);
    console.log('Sign in (handle any 2FA/captcha) until you can SEE the Bulk Products upload area.');
    await waitForEnter('\nThen press ENTER here to save the session... ');
    await ctx.storageState({ path: s.sessionPath });
    console.log(`Session saved to ${s.sessionPath}`);
  } finally {
    await browser.close();
  }
}

// Upload a NIS .xlsx using the saved session. Returns { ok, reference, message, screenshot }.
export async function uploadNis(filePath, { headless = false, keepOpenMs = 0 } = {}) {
  const s = sellerLabCfg();
  if (!existsSync(s.sessionPath)) {
    throw new Error('No saved noon session. Run "node cli.js noon:login" first.');
  }
  const abs = isAbsolute(filePath) ? filePath : join(ROOT, filePath);
  if (!existsSync(abs)) throw new Error(`NIS file not found: ${abs}`);

  const browser = await chromium.launch({ headless });
  try {
    const ctx = await browser.newContext({ storageState: s.sessionPath, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    if (looksLikeLogin(page.url())) {
      throw new Error('Session expired or not logged in. Run "node cli.js noon:login" again.');
    }

    // The dragger renders a hidden <input type="file"> - the stable target
    // (the hashed draggerInner CSS class changes between deploys).
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {
      throw new Error('Could not find the file upload field on the Bulk Products page.');
    });
    await input.setInputFiles(abs);

    // Some upload widgets auto-submit on file select; others need a button.
    const submit = page.getByRole('button', { name: /upload|submit|import|confirm|process|continue/i }).first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click().catch(() => {});
    }

    // Give the server a moment to accept/queue the import.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);

    // Best-effort scrape of an import reference / confirmation from the page text.
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const refMatch = bodyText.match(/(import(?:\s*(?:id|reference|ref))?|reference)\s*[:#]?\s*([A-Za-z0-9\-_]{4,})/i);
    const reference = refMatch ? refMatch[2] : null;
    const errored = /error|failed|invalid|not\s+supported/i.test(bodyText) && !reference;

    mkdirSync(dirname(s.sessionPath), { recursive: true });
    const screenshot = join(dirname(s.sessionPath), `last-upload.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});

    if (keepOpenMs > 0) await page.waitForTimeout(keepOpenMs);

    return {
      ok: !errored,
      reference,
      message: reference
        ? `Upload submitted. Import reference: ${reference}`
        : errored
          ? 'The page reported an error after upload - check the screenshot.'
          : 'File submitted. No import reference detected yet - verify in Seller Lab (screenshot saved).',
      screenshot,
      file: abs,
    };
  } finally {
    await browser.close();
  }
}

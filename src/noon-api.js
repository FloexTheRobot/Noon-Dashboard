// noon-api.js - authenticated client for the noon Partner API.
//
// Auth flow (type "apijwt", per noon-docs):
//   1. Sign a JWT (RS256) with the service-account private key:
//        header  { alg:"RS256", typ:"JWT" }
//        claims  { sub: key_id, iat: <unix>, jti: <uuid> }
//   2. POST {token, default_project_code} to .../identity/public/v1/api/login
//   3. The response sets session cookies; send them as `Cookie` on every call.
//
// The private key lives in auth/noon-key.json (git-ignored). Session cookies are
// cached to auth/noon-cookies.json and reused until a 401 forces a re-login.
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { ProxyAgent } from 'undici';
import { getConfig, ROOT } from './config.js';

function proxyDispatcher() {
  let configured;
  try { configured = getConfig().proxy; } catch { /* config not loaded */ }
  const p = configured || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY ||
            process.env.all_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  return p ? new ProxyAgent(p) : undefined;
}

function cfg() {
  const c = getConfig();
  const n = c.noon || {};
  const base = (n.apiGateway || 'https://noon-api-gateway.noon.partners').replace(/\/+$/, '');
  const keyFile = isAbsolute(n.keyFile || '') ? n.keyFile : join(ROOT, n.keyFile || 'auth/noon-key.json');
  return { base, keyFile, ua: n.userAgent || 'noon-online-dashboard/1.0' };
}

export function loadKey() {
  const { keyFile } = cfg();
  if (!existsSync(keyFile)) throw new Error(`noon key file not found at ${keyFile}`);
  const k = JSON.parse(readFileSync(keyFile, 'utf8'));
  if (!k.private_key || !k.key_id) throw new Error('noon key file missing private_key / key_id');
  return k;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Sign the RS256 login JWT from the service-account key.
export function signLoginJwt(key) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { sub: key.key_id, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(key.private_key);
  return `${data}.${b64url(sig)}`;
}

const COOKIE_PATH = () => join(ROOT, 'auth', 'noon-cookies.json');
function loadCookie() { try { return JSON.parse(readFileSync(COOKIE_PATH(), 'utf8')).cookie || null; } catch { return null; } }
function saveCookie(cookie) {
  try { writeFileSync(COOKIE_PATH(), JSON.stringify({ cookie, at: new Date().toISOString() }, null, 2)); } catch { /* ignore */ }
}

// Exchange the signed JWT for a session (sets cookies). Returns the cookie string.
export async function login() {
  const { base, ua } = cfg();
  const key = loadKey();
  const token = signLoginJwt(key);
  const dispatcher = proxyDispatcher();
  const r = await fetch(`${base}/identity/public/v1/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua, Accept: 'application/json' },
    body: JSON.stringify({ token, default_project_code: key.project_code }),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const bodyText = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`noon login failed (${r.status}): ${bodyText.slice(0, 300)}`);
  const setCookies = typeof r.headers.getSetCookie === 'function'
    ? r.headers.getSetCookie()
    : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  const cookie = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('noon login returned no session cookies');
  saveCookie(cookie);
  return cookie;
}

// Authenticated request against the gateway. Re-logs in once on 401.
export async function noonApi(path, { method = 'GET', body = null, headers = {}, retry = true } = {}) {
  const { base, ua } = cfg();
  let cookie = loadCookie();
  if (!cookie) cookie = await login();
  const send = () => fetch(`${base}${path}`, {
    method,
    headers: { 'User-Agent': ua, Accept: 'application/json', Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    ...(proxyDispatcher() ? { dispatcher: proxyDispatcher() } : {}),
  });
  let r = await send();
  // A stale/invalid session makes the gateway serve the partner SPA (HTML 200)
  // instead of a 401 — treat that, and a real 401, as "re-login and retry once".
  const isSpa = (resp) => (resp.headers.get('content-type') || '').includes('text/html');
  if ((r.status === 401 || isSpa(r)) && retry) { cookie = await login(); r = await send(); }
  return r;
}

// Create (upsert) a product on noon from a connect-fetched product object.
// Maps the fields we have to the BatchUpsertProduct payload. The endpoint path
// and payload field names live here + config.noon.upsertPath so they're easy to
// align once the exact schema is confirmed. Returns { ok, status, path, response }.
export async function createOnNoon(product) {
  const c = getConfig();
  const path = (c.noon && c.noon.upsertPath) || '/xborder-pricing/public/v1/product/upsert';
  // noon's xborder product/upsert carries SKU + logistics/customs data only
  // (partner_sku required; dimensions/weight/hs_code nullable). It does NOT
  // accept title/description/images - those go via the NIS content template.
  const item = { partner_sku: product.productCode };
  if (product.dimensionsCm) item.dimensions_cm = product.dimensionsCm;
  if (product.vmWeightCm != null) item.vm_weight_cm = product.vmWeightCm;
  if (product.actualWeightKg != null) item.actual_weight_kg = product.actualWeightKg;
  if (product.hsCode) item.hs_code = product.hsCode;
  const body = { items: [item] };
  const r = await noonApi(path, { method: 'POST', body });
  const text = await r.text();
  let response = text;
  try { response = JSON.parse(text); } catch { /* keep text */ }
  return { ok: r.ok, status: r.status, path, sent: item, response };
}

// Connectivity check: signs in and reports success. Returns { ok, message }.
export async function noonApiCheck() {
  try {
    const cookie = await login();
    const names = cookie.split('; ').map((c) => c.split('=')[0]).filter(Boolean);
    return { ok: true, message: `Logged in to noon Partner API (PRJ188). Session cookies: ${names.join(', ') || '(none named)'}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

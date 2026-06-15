// adapters.js - the ONLY functions that touch external services.
// Each one returns deterministic mock data until the matching base+key pair
// is filled into config.json, at which point it switches to the real call.
// Replace the bodies marked  // TODO(api):  with real endpoints when ready.
import { ProxyAgent } from 'undici';
import { getConfig } from './config.js';
import { seed } from './util.js';

// Make outbound fetch honour a local proxy (Node's global fetch ignores the
// https_proxy env var by default). Returns undefined when no proxy is set, so
// fetch behaves normally.
function proxyDispatcher() {
  let configured;
  try { configured = getConfig().proxy; } catch { /* config not loaded */ }
  const proxy = configured ||
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? new ProxyAgent(proxy) : undefined;
}

// ---- main product panel (deterministic mock) ---------------------------------
// Used by the synthetic-catalog features (new arrivals, FBP/FBN stock, price
// compare) which are keyed by demo codes like ABC100. Real product data for the
// Auto-create flow comes from fetchCombinedMedia() below instead.
export async function panelProduct(productCode) {
  const s = seed(productCode);
  return {
    productCode,
    title: `Demo Product ${productCode}`,
    description: `Auto-generated demo description for ${productCode}.`,
    attributes: { color: ['black', 'white', 'blue'][s % 3], warranty: '1 year' },
    imageUrls: [`https://picsum.photos/seed/${productCode}/600`],
    baseCost: 20 + (s % 80),
    stock: 5 + (s % 50),
    category: ['accessories', 'audio', 'charging'][s % 3],
  };
}

// ---- real product fetch from connect.oskarme.com -----------------------------
// GET {base}/product/combined-media?item={SKU} with the raw token in the
// Authorization header. Returns name, description, brand and all media
// (images, videos, documents, certificates). This endpoint does NOT expose
// price / stock / category, so those are defaulted by mapCombinedMedia().
export async function fetchCombinedMedia(productCode) {
  const cfg = getConfig();
  const base = (cfg.panelApiBase || '').replace(/\/+$/, '');
  const url = `${base}/product/combined-media?item=${encodeURIComponent(productCode)}`;
  const dispatcher = proxyDispatcher();
  const r = await fetch(url, {
    headers: { Authorization: cfg.panelApiKey, Accept: 'application/json' },
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (!r.ok) throw new Error(`Panel API returned ${r.status} for "${productCode}"`);
  const j = await r.json();
  if (!j || j.success !== true || !j.data) {
    throw new Error(`Product "${productCode}" not found in panel`);
  }
  return mapCombinedMedia(productCode, j.data);
}

function mapCombinedMedia(code, data) {
  const p = data.product || {};
  const m = data.media || {};

  // The product "name" lives in `description`, often prefixed with "{SKU} ".
  const rawName = String(p.description || code).trim();
  const name = rawName.replace(/^\{[^}]*\}\s*/, '').trim() || rawName;

  // Images: keep order, with primaryImage first.
  let images = Array.isArray(m.images) ? m.images.filter(Boolean) : [];
  if (m.primaryImage) {
    images = [m.primaryImage, ...images.filter((u) => u !== m.primaryImage)];
  }
  // Videos: primaryVideo first.
  let videos = Array.isArray(m.videos) ? m.videos.filter(Boolean) : [];
  if (m.primaryVideo) {
    videos = [m.primaryVideo, ...videos.filter((u) => u !== m.primaryVideo)];
  }

  // Mine the assets array for (a) JPG/JPEG images - noon requires JPEG, our
  // media.images are .webp - and (b) rich marketing titles from listing_links,
  // which give far better source text for SEO content than the bare name.
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const isJpg = (u) => /\.(jpe?g)(\?|#|$)/i.test(String(u || ''));
  const assetImages = assets
    .filter((a) => String(a.type).toLowerCase() === 'images')
    .map((a) => a.fileUrl || a.link)
    .filter(Boolean);
  const jpgImages = [...new Set([...assetImages.filter(isJpg), ...images.filter(isJpg)])];
  const sourceTitles = [...new Set(
    assets
      .filter((a) => String(a.type).toLowerCase() === 'listing_links')
      .map((a) => String(a.details || '').trim())
      .filter((t) => t.length > 20 && /[a-z]/i.test(t) && /\s/.test(t)),
  )].sort((a, b) => b.length - a.length);
  const richTitle = sourceTitles[0] || '';

  return {
    productCode: p.sku || code,
    title: name,
    description: p.description || '',
    richTitle,
    sourceTitles: sourceTitles.slice(0, 5),
    brand: p.brand || '',
    barcode: p.barcode || '',
    productNo: p.productNo || '',
    imageUrls: images,
    imageUrlsJpg: jpgImages,
    primaryImage: m.primaryImage || images[0] || '',
    videoUrls: videos,
    primaryVideo: m.primaryVideo || '',
    documents: Array.isArray(m.documents) ? m.documents : [],
    certificates: Array.isArray(m.certificates) ? m.certificates : [],
    attributes: { brand: p.brand || '', barcode: p.barcode || '', productNo: p.productNo || '' },
    // Not provided by the combined-media endpoint — defaulted so pricing and
    // the listing call still work. Wire a cost/stock endpoint to fill these.
    baseCost: 0,
    stock: 0,
    category: 'general',
    source: 'panel',
  };
}

export async function panelStock(productCode) {
  return (await panelProduct(productCode)).stock;
}

// ---- marketplace analytics ---------------------------------------------------
export async function dailyMetrics(dateStr) {
  const cfg = getConfig();
  if (cfg.marketplaceApiBase && cfg.marketplaceApiKey) {
    // TODO(api): real analytics call.
    const r = await fetch(`${cfg.marketplaceApiBase}/analytics/daily?date=${dateStr}`, {
      headers: { Authorization: `Bearer ${cfg.marketplaceApiKey}` },
    });
    const d = await r.json();
    return { date: dateStr, sales: Number(d.sales), orders: parseInt(d.orders, 10), views: parseInt(d.views, 10), liveItems: parseInt(d.liveItems, 10) };
  }
  const s = seed(dateStr);
  return {
    date: dateStr,
    sales: 1000 + (s % 4000),
    orders: 10 + (s % 40),
    views: 500 + (s % 3000),
    liveItems: 120 + (s % 30),
  };
}

// ---- live listings -----------------------------------------------------------
export async function liveProducts() {
  const cfg = getConfig();
  if (cfg.marketplaceApiBase && cfg.marketplaceApiKey) {
    // TODO(api): list live listings.
    const r = await fetch(`${cfg.marketplaceApiBase}/listings?status=live&limit=1000`, {
      headers: { Authorization: `Bearer ${cfg.marketplaceApiKey}` },
    });
    const data = await r.json();
    return (data.items || []).map((it) => ({ productCode: it.sku, stock: parseInt(it.stock, 10) }));
  }
  return Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const code = `ABC${100 + n}`;
    return { productCode: code, marketplaceId: `MP-${code}`, stock: n % 7 };
  });
}

// ---- create / update a listing ----------------------------------------------
export async function setListing(product, price) {
  const cfg = getConfig();
  // Preferred path: publish to the noon Partner/Marketplace API once granted.
  if (cfg.noon && cfg.noon.apiBase && cfg.noon.apiKey) {
    return createNoonListing(cfg, product, price);
  }
  // Generic marketplace fallback (kept for compatibility).
  if (cfg.marketplaceApiBase && cfg.marketplaceApiKey) {
    const r = await fetch(`${cfg.marketplaceApiBase}/listings/${product.productCode}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cfg.marketplaceApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: product.productCode, title: product.title, price, stock: product.stock }),
    });
    const res = await r.json();
    return { marketplaceId: res.id, isLive: Boolean(res.active) };
  }
  // No marketplace configured -> mock listing record (saved locally only).
  return { marketplaceId: `MP-${product.productCode}`, isLive: true };
}

// Publish a product to noon's catalogue.
// NOTE: endpoint, auth scheme and payload field names below are PROVISIONAL —
// confirm them against noon's Partner API docs once access is granted, then
// adjust this single function. Everything it needs is already fetched upstream.
async function createNoonListing(cfg, product, price) {
  const base = cfg.noon.apiBase.replace(/\/+$/, '');
  const path = cfg.noon.createPath || '/catalog/products';
  const payload = {
    partner_sku: product.productCode,
    title: product.title,
    description: product.description,
    brand: product.brand,
    barcode: product.barcode,
    category: product.category,
    price,
    stock: product.stock,
    images: product.imageUrls,
    videos: product.videoUrls,
  };
  const dispatcher = proxyDispatcher();
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.noon.apiKey}`,
      'Content-Type': 'application/json',
      ...(cfg.noon.sellerCode ? { 'x-seller-code': cfg.noon.sellerCode } : {}),
    },
    body: JSON.stringify(payload),
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (!r.ok) throw new Error(`noon catalog API returned ${r.status}`);
  const res = await r.json();
  return {
    marketplaceId: res.id || res.psku || res.nsku || `noon-${product.productCode}`,
    isLive: res.status === 'live' || res.active === true,
  };
}

// ---- patch stock -------------------------------------------------------------
export async function setStock(productCode, newStock) {
  const cfg = getConfig();
  if (cfg.marketplaceApiBase && cfg.marketplaceApiKey) {
    // TODO(api): patch stock.
    await fetch(`${cfg.marketplaceApiBase}/listings/${productCode}/stock`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${cfg.marketplaceApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: newStock }),
    });
  }
  return true;
}

// ---- Claude (Anthropic) ------------------------------------------------------
export async function callClaude(system, user, maxTokens = 1024) {
  const cfg = getConfig();
  if (!cfg.anthropicApiKey) return null; // offline -> caller falls back
  const dispatcher = proxyDispatcher();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cfg.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const resp = await r.json();
  return (resp.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

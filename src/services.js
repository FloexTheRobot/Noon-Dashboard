// services.js - all business logic, ported 1:1 from lib/StoreManager.psm1.
// Pure functions over the JSON store + adapters. The Express routes in
// server.js are thin wrappers around these.
import { getConfig } from './config.js';
import { getTable, saveTable, addRow, setRow } from './store.js';
import { panelProduct, fetchCombinedMedia, panelStock, dailyMetrics, liveProducts, setListing, setStock, callClaude } from './adapters.js';
import { seed, today, now, daysAgo, round2, newId } from './util.js';

// =============================================================================
// PRICING
// =============================================================================
// productObj lets the caller pass an already-fetched product (e.g. the real
// panel product) so we don't re-fetch and so pricing uses its baseCost.
export async function minimumPrice(productCode, productObj = null) {
  const cfg = getConfig();
  const p = productObj || (await panelProduct(productCode));

  const comm = Number(cfg.pricing.commissionRate);
  const ship = Number(cfg.pricing.shippingCost);
  const prep = Number(cfg.pricing.prepCost);
  const margin = Number(cfg.pricing.targetMargin);

  const fixed = p.baseCost + ship + prep;
  const breakeven = round2(fixed / (1 - comm));
  const floor = round2((fixed * (1 + margin)) / (1 - comm));

  const breakdown = {
    baseCost: p.baseCost,
    shippingCost: ship,
    prepCost: prep,
    commissionRate: comm,
    targetMargin: margin,
    totalCost: fixed,
    breakevenPrice: breakeven,
    floorWithMargin: floor,
  };

  let recommended = floor;
  let source = 'formula';
  let aiReason = null;

  if (cfg.anthropicApiKey) {
    try {
      const sys =
        'You are a pricing analyst for an online marketplace seller. ' +
        'Return a defensible minimum viable selling price that never loses money ' +
        `after all fees. All amounts are in ${cfg.currency}.`;
      const usr =
        `Product: ${p.title} (code ${productCode}, category ${p.category}).\n` +
        `Cost breakdown: ${JSON.stringify(breakdown)}\n` +
        'Return ONLY valid JSON: {"recommendedFloor": number, "reasoning": string, "riskFlags": string[]}';
      const txt = await callClaude(sys, usr);
      const clean = txt.replace(/^```(json)?/, '').replace(/```$/, '').trim();
      const ai = JSON.parse(clean);
      if (ai.recommendedFloor) {
        recommended = Math.max(Number(ai.recommendedFloor), breakeven);
        source = 'ai';
        aiReason = ai.reasoning;
      }
    } catch (e) {
      aiReason = `AI unavailable: ${e.message}`;
    }
  }

  addRow('PricingHistory', { productCode, computedMinPrice: recommended, source, at: now() });

  return { productCode, recommendedFloor: recommended, source, breakdown, aiReasoning: aiReason };
}

// =============================================================================
// PRODUCTS
// =============================================================================
// Fetch a product's full details (name, description, media) for previewing or
// creating. Uses the real connect.oskarme.com panel when configured, otherwise
// the deterministic mock.
export async function fetchPanelProduct(productCode) {
  const cfg = getConfig();
  const usePanel = Boolean(cfg.panelApiBase && cfg.panelApiKey);
  return usePanel ? fetchCombinedMedia(productCode) : panelProduct(productCode);
}

export async function newProduct(productCode) {
  const base = await fetchPanelProduct(productCode);
  const code = base.productCode || productCode;
  const min = await minimumPrice(code, base);
  const price = min.recommendedFloor;
  const listing = await setListing(base, price);

  setRow('Product', 'productCode', code, {
    title: base.title,
    description: base.description,
    richTitle: base.richTitle || '',
    sourceTitles: base.sourceTitles || [],
    brand: base.brand || '',
    barcode: base.barcode || '',
    productNo: base.productNo || '',
    baseCost: base.baseCost,
    price,
    stock: base.stock,
    category: base.category,
    imageUrls: base.imageUrls || [],
    imageUrlsJpg: base.imageUrlsJpg || [],
    primaryImage: base.primaryImage || '',
    videoUrls: base.videoUrls || [],
    primaryVideo: base.primaryVideo || '',
    documents: base.documents || [],
    marketplaceId: listing.marketplaceId,
    isLive: listing.isLive,
    source: base.source || 'mock',
    lastSyncedAt: now(),
  });

  return {
    productCode: code,
    title: base.title,
    description: base.description,
    brand: base.brand || '',
    price,
    stock: base.stock,
    marketplaceId: listing.marketplaceId,
    isLive: listing.isLive,
    imageUrls: base.imageUrls || [],
    primaryImage: base.primaryImage || '',
    videoUrls: base.videoUrls || [],
    primaryVideo: base.primaryVideo || '',
    source: base.source || 'mock',
  };
}

export async function newProductBulk(codes) {
  const results = [];
  let ok = 0;
  let fail = 0;
  for (const code of codes) {
    try {
      const r = await newProduct(code);
      ok++;
      results.push({ code, ok: true, marketplaceId: r.marketplaceId, price: r.price });
    } catch (e) {
      fail++;
      results.push({ code, ok: false, error: e.message });
    }
  }
  const status = fail === 0 ? 'success' : ok === 0 ? 'failed' : 'partial';
  addRow('AutomationLog', { automation: 'creation.bulk', status, itemsTotal: codes.length, itemsOk: ok, itemsFailed: fail, at: now() });
  return { status, total: codes.length, ok, failed: fail, results };
}

export async function newProductFromUrl(productCode, url) {
  const r = await newProduct(productCode);
  setRow('Product', 'productCode', productCode, { sourceUrl: url });
  return { ...r, sourceUrl: url };
}

// =============================================================================
// STOCK SYNC
// =============================================================================
export async function updateStock({ codes = null, all = false } = {}) {
  let items;
  if (all) items = await liveProducts();
  else items = (codes || []).map((c) => ({ productCode: c, stock: null }));

  const results = [];
  let ok = 0;
  let fail = 0;
  let changed = 0;
  for (const it of items) {
    try {
      const next = parseInt(await panelStock(it.productCode), 10);
      const cur = it.stock;
      if (cur !== null && cur !== undefined && parseInt(cur, 10) === next) {
        ok++;
        results.push({ code: it.productCode, changed: false, newStock: next });
        continue;
      }
      await setStock(it.productCode, next);
      addRow('StockHistory', { productCode: it.productCode, oldStock: cur, newStock: next, at: now() });
      setRow('Product', 'productCode', it.productCode, { stock: next, lastSyncedAt: now() });
      ok++;
      changed++;
      results.push({ code: it.productCode, changed: true, oldStock: cur, newStock: next });
    } catch (e) {
      fail++;
      results.push({ code: it.productCode, ok: false, error: e.message });
    }
  }
  const status = fail === 0 ? 'success' : ok === 0 ? 'failed' : 'partial';
  addRow('AutomationLog', { automation: 'stock.update', status, itemsTotal: items.length, itemsOk: ok, itemsFailed: fail, at: now() });
  return { status, total: items.length, ok, failed: fail, changed, results };
}

// =============================================================================
// DASHBOARD + DAILY REPORT
// =============================================================================
export async function dashboard(date = today()) {
  const m = await dailyMetrics(date);
  setRow('DailyMetric', 'date', date, { sales: m.sales, orders: m.orders, views: m.views, liveItems: m.liveItems });
  return m;
}

async function sendMail(cfg, subject, html) {
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: Number(cfg.smtp.port) === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
  });
  await transport.sendMail({ from: cfg.smtp.from, to: cfg.smtp.to, subject, html });
}

export async function sendDailyReport(date = daysAgo(1)) {
  const cfg = getConfig();
  const m = await dashboard(date);
  const autos = getTable('AutomationLog');

  const html =
    `<h2>Daily report - ${date}</h2>` +
    "<table border='0' cellpadding='4'>" +
    `<tr><td>Sales</td><td align='right'><b>${m.sales} ${cfg.currency}</b></td></tr>` +
    `<tr><td>Orders</td><td align='right'><b>${m.orders}</b></td></tr>` +
    `<tr><td>Views</td><td align='right'><b>${m.views}</b></td></tr>` +
    `<tr><td>Live items</td><td align='right'><b>${m.liveItems}</b></td></tr>` +
    `</table><h3>Recent automations: ${autos.length}</h3>`;

  if (cfg.smtp.host && cfg.smtp.to) {
    try {
      await sendMail(cfg, `Store daily report - ${date}`, html);
      return { sent: true, date };
    } catch (e) {
      return { sent: false, error: e.message };
    }
  }

  const { join } = await import('node:path');
  const { writeFileSync, existsSync, mkdirSync } = await import('node:fs');
  const { DATA_DIR } = await import('./config.js');
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const out = join(DATA_DIR, `report-${date}.html`);
  writeFileSync(out, html, 'utf8');
  return { sent: false, savedTo: out, date };
}

// =============================================================================
// ORDERS / DEALS / ADS / NET PROFIT (mock)
// =============================================================================
export async function orders(days = 7) {
  const statuses = ['pending', 'shipped', 'delivered', 'cancelled'];
  return Array.from({ length: 14 }, (_, i) => {
    const s = seed(`ORD${i}`);
    return {
      orderId: `ORD-${String(1000 + i).padStart(4, '0')}`,
      productCode: `ABC${100 + (s % 25)}`,
      sellingPrice: 30 + (s % 120),
      status: statuses[s % 4],
      orderedAt: daysAgo(i % days),
    };
  });
}

export function deals() {
  const names = ['Flash Friday', 'Ramadan Deal', 'Weekend Sale', 'Clearance', 'New Arrival Boost', 'Bundle Offer'];
  return names.map((name, i) => {
    const s = seed(name);
    return {
      dealId: `DEAL-${i + 1}`,
      title: name,
      joined: Boolean(s % 2),
      discountPct: 5 + (s % 25),
      sales: 200 + (s % 3000),
      orders: 3 + (s % 40),
    };
  });
}

export function ads() {
  const names = ['Search - Brand', 'Display - Retarget', 'Banner - Home', 'Video - Launch', 'Sponsored - Category'];
  return names.map((name) => {
    const s = seed(name);
    const spend = 50 + (s % 500);
    const revenue = spend * (1 + (s % 30) / 10.0);
    return { campaign: name, spend: round2(spend), revenue: round2(revenue), roas: round2(revenue / spend) };
  });
}

export function netProfit() {
  const cfg = getConfig();
  const comm = Number(cfg.pricing.commissionRate);
  const ship = Number(cfg.pricing.shippingCost);
  const prep = Number(cfg.pricing.prepCost);
  const products = getTable('Product');
  const rows = [];
  let totRev = 0;
  let totProfit = 0;
  for (const p of products) {
    if (!p.price || Number(p.price) <= 0) continue;
    const price = Number(p.price);
    const cost = Number(p.baseCost);
    const units = 1 + (seed(p.productCode) % 20);
    const revenue = price * units;
    const unitProfit = price - (cost + ship + prep) - comm * price;
    const profit = round2(unitProfit * units);
    rows.push({ productCode: p.productCode, price, unitsSold: units, revenue: round2(revenue), netProfit: profit });
    totRev += revenue;
    totProfit += profit;
  }
  return { totalRevenue: round2(totRev), totalNetProfit: round2(totProfit), products: rows };
}

// =============================================================================
// NOTES
// =============================================================================
export function getNotes(query) {
  let rows = getTable('Note');
  if (query) {
    const q = query.toLowerCase();
    rows = rows.filter((r) => `${r.title} ${r.body} ${r.tags}`.toLowerCase().includes(q));
  }
  return rows;
}
export function newNote(title, body, tags) {
  const id = newId('N');
  setRow('Note', 'id', id, { title, body, tags: tags || [], at: now() });
  return { id };
}
export function setNote(id, title, body, tags) {
  setRow('Note', 'id', id, { title, body, tags: tags || [], at: now() });
  return { id, updated: true };
}
export function removeNote(id) {
  saveTable('Note', getTable('Note').filter((r) => r.id !== id));
  return { id, deleted: true };
}

// =============================================================================
// CALENDAR
// =============================================================================
export function getCalendar() {
  return getTable('CalendarEvent');
}
export function newCalendarEvent(date, note) {
  const id = newId('C');
  setRow('CalendarEvent', 'id', id, { date, note, at: now() });
  return { id };
}
export function removeCalendarEvent(id) {
  saveTable('CalendarEvent', getTable('CalendarEvent').filter((r) => r.id !== id));
  return { id, deleted: true };
}

// =============================================================================
// AI IMAGE
// =============================================================================
export async function newImage(prompt, productCode, size = '1024x1024') {
  const cfg = getConfig();
  let w = 600;
  let h = 400;
  const dim = size.split('x');
  if (dim.length === 2) {
    w = parseInt(dim[0], 10);
    h = parseInt(dim[1], 10);
  }
  let urls = [];
  if (cfg.imageApiBase && cfg.imageApiKey) {
    // TODO(api): real image generation call.
    const r = await fetch(`${cfg.imageApiBase}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.imageApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, n: 1, size }),
    });
    const data = await r.json();
    urls = (data.data || []).map((d) => d.url);
  } else {
    urls = [`https://picsum.photos/seed/${encodeURIComponent(prompt)}/${w}/${h}`];
  }
  const id = newId('IMG');
  setRow('AiOutput', 'id', id, { kind: 'image', prompt, productCode, size, result: urls, at: now() });
  return { id, prompt, productCode, size, images: urls };
}

// =============================================================================
// AI ASSISTANT
// =============================================================================
export async function assistant(question) {
  const cfg = getConfig();
  const products = getTable('Product');
  const low = products.filter((p) => p.stock !== null && p.stock !== undefined && parseInt(p.stock, 10) <= 3).slice(0, 10);
  const suggestions = [];
  if (low.length) suggestions.push(`Restock ${low.length} low-stock item(s): ` + low.map((p) => p.productCode).join(', '));
  suggestions.push('Review minimum prices for products below target margin.');
  suggestions.push('Join high-volume deals (see Deals) for your fast movers.');
  let answer = null;
  if (cfg.anthropicApiKey) {
    try {
      const sys = 'You are an operations assistant for a marketplace seller. Be concise; max 5 prioritized bullet actions.';
      const ctx = `Question: ${question}\nLow stock codes: ${low.map((p) => p.productCode).join(', ')}\nTotal products: ${products.length}`;
      answer = await callClaude(sys, ctx);
    } catch {
      answer = null;
    }
  }
  if (!answer) answer = '(AI offline) ' + suggestions.join('  |  ');
  return { question, answer, suggestions };
}

// =============================================================================
// KEYWORDS / TITLES
// =============================================================================
export async function newKeywords(productCode, category) {
  const cfg = getConfig();
  let label = category;
  if (productCode) label = (await panelProduct(productCode)).title;
  let title = null;
  let keywords = [];
  let desc = null;
  if (cfg.anthropicApiKey) {
    try {
      const sys = 'You are an e-commerce SEO copywriter. Return ONLY JSON {"title":string,"keywords":string[],"description":string}.';
      const txt = await callClaude(sys, `Generate optimized marketplace listing copy for: ${label}`);
      const ai = JSON.parse(txt.replace(/^```(json)?/, '').replace(/```$/, '').trim());
      title = ai.title;
      keywords = ai.keywords;
      desc = ai.description;
    } catch {
      /* fall through to template */
    }
  }
  if (!keywords || keywords.length === 0) {
    const base = String(label).replace(/[^a-zA-Z0-9 ]/g, '').trim();
    keywords = [base, `buy ${base}`, `${base} online`, `best ${base}`, `${base} price`, `${base} deal`, `cheap ${base}`];
    title = `${base} - Premium Quality, Fast Delivery`;
    desc = `Shop ${base} with fast shipping and great value. Top rated and in stock now.`;
  }
  const id = newId('KW');
  setRow('AiOutput', 'id', id, { kind: 'keywords', prompt: label, result: { title, keywords, description: desc }, at: now() });
  return { label, title, keywords, description: desc };
}

// =============================================================================
// BEST SELLERS
// =============================================================================
export function bestSellers() {
  let mine = [];
  for (const p of getTable('Product')) {
    if (!p.price) continue;
    const units = 1 + (seed(p.productCode) % 40);
    mine.push({
      productCode: p.productCode,
      title: p.title,
      category: p.category,
      unitsSold: units,
      revenue: round2(Number(p.price) * units),
    });
  }
  mine = mine.sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10);

  const cats = ['accessories', 'audio', 'charging'];
  const platform = [];
  for (const c of cats) {
    for (let i = 1; i <= 3; i++) {
      const s = seed(`${c}${i}`);
      platform.push({
        category: c,
        productCode: `ABC${100 + (s % 50)}`,
        sales: 500 + (s % 5000),
        orders: 10 + (s % 90),
        views: 800 + (s % 6000),
      });
    }
  }
  return { mine, platform };
}

// =============================================================================
// PRICE COMPARE / MATCH
// =============================================================================
export async function priceCompare(productCode) {
  const base = await panelProduct(productCode);
  const my = round2(base.baseCost * 1.4);
  const platforms = ['noon', 'Amazon', 'Jumla', 'Star Gallery'];
  const rows = [];
  for (const p of platforms) {
    const s = seed(`${productCode}${p}`);
    let price = my;
    if (p !== 'noon') price = round2(my * (0.9 + (s % 30) / 100.0));
    const mine = p === 'noon';
    rows.push({ platform: p, price, mine });
  }
  const cheapest = [...rows].sort((a, b) => a.price - b.price)[0].platform;
  return { productCode, myPrice: my, cheapest, rows };
}

export async function matchPrice(productCode) {
  const cmp = await priceCompare(productCode);
  const comp = cmp.rows.filter((r) => !r.mine).map((r) => r.price);
  const lowest = Math.min(...comp);
  const min = await minimumPrice(productCode);
  const newPrice = round2(Math.max(lowest, min.recommendedFloor));
  setRow('Product', 'productCode', productCode, { price: newPrice, lastSyncedAt: now() });
  addRow('PricingHistory', { productCode, computedMinPrice: newPrice, source: 'match', at: now() });
  return { productCode, matchedTo: lowest, floor: min.recommendedFloor, newPrice };
}

export async function listingsPricing() {
  const rows = [];
  for (const p of getTable('Product')) {
    if (!p.price) continue;
    const code = p.productCode;
    const units = 1 + (seed(code) % 40);
    const cmp = await priceCompare(code);
    const amazon = cmp.rows.find((r) => r.platform === 'Amazon')?.price;
    const jumla = cmp.rows.find((r) => r.platform === 'Jumla')?.price;
    const star = cmp.rows.find((r) => r.platform === 'Star Gallery')?.price;
    const comp = [amazon, jumla, star].filter((x) => x);
    const lowest = comp.length ? Math.min(...comp) : undefined;
    rows.push({
      productCode: code,
      title: p.title,
      myPrice: Number(p.price),
      unitsSold: units,
      amazon,
      jumla,
      starGallery: star,
      lowestCompetitor: lowest,
      competitive: Number(p.price) <= lowest,
    });
  }
  return rows;
}

// =============================================================================
// DEAL OPTIMIZER
// =============================================================================
export function dealOptimizer() {
  return deals().map((d) => {
    const join = d.orders >= 15 && d.discountPct <= 20;
    return {
      deal: d.title,
      currentlyJoined: d.joined,
      recommend: join ? 'join' : 'skip',
      suggestedDiscount: Math.min(d.discountPct, 20),
      orders: d.orders,
      reason: join ? 'Strong order volume at an acceptable discount' : 'Low volume or discount too deep',
    };
  });
}

// =============================================================================
// SALES RANGE (chart)
// =============================================================================
export async function salesRange(days = 14) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i);
    const m = await dailyMetrics(d);
    out.push({ date: d, sales: m.sales, orders: m.orders });
  }
  return out;
}

// =============================================================================
// PANEL CATALOG / NEW ARRIVALS
// =============================================================================
export async function panelCatalog() {
  const brands = ['Anker', 'Baseus', 'Sony', 'JBL', 'Samsung', 'Apple', 'Xiaomi', 'Philips'];
  const out = [];
  for (let n = 100; n <= 129; n++) {
    const code = `ABC${n}`;
    const p = await panelProduct(code);
    const brand = brands[seed(code) % brands.length];
    out.push({ productCode: code, title: p.title, brand, stock: p.stock, baseCost: p.baseCost, category: p.category });
  }
  return out;
}

export async function newArrivals() {
  const created = getTable('Product').map((p) => p.productCode);
  const out = [];
  for (const c of await panelCatalog()) {
    if (c.stock > 0 && !created.includes(c.productCode)) out.push(c);
  }
  return out;
}

// =============================================================================
// FULFILLMENT STOCK - FBP (my warehouse) / FBN (noon warehouse)
// =============================================================================
export async function stockFBP() {
  return (await panelCatalog()).map((c) => ({
    productCode: c.productCode,
    title: c.title,
    brand: c.brand,
    warehouseStock: c.stock,
  }));
}

export async function stockFBN() {
  const out = [];
  for (const c of await panelCatalog()) {
    const s = seed(`FBN${c.productCode}`);
    if (s % 3 !== 0) continue; // only some items are stored at noon
    const qty = s % 40;
    out.push({ productCode: c.productCode, title: c.title, brand: c.brand, noonStock: qty, low: qty <= 5 });
  }
  return out;
}

export async function fbnLowAlert() {
  const cfg = getConfig();
  const all = await stockFBN();
  const low = all.filter((x) => x.low);
  const rowsHtml = low
    .map((x) => `<tr><td>${x.productCode}</td><td>${x.title}</td><td align='right'>${x.noonStock}</td></tr>`)
    .join('');
  const html =
    `<h2>FBN low-stock alert</h2><p>${low.length} item(s) running low in noon's warehouse.</p>` +
    `<table border='0' cellpadding='4'><tr><th align='left'>Code</th><th align='left'>Title</th><th>Noon stock</th></tr>${rowsHtml}</table>`;
  addRow('AutomationLog', { automation: 'fbn.lowstock.alert', status: 'success', itemsTotal: low.length, itemsOk: low.length, itemsFailed: 0, at: now() });

  if (cfg.smtp.host && cfg.smtp.to) {
    try {
      await sendMail(cfg, `FBN low-stock alert - ${low.length} item(s)`, html);
      return { sent: true, count: low.length };
    } catch (e) {
      return { sent: false, count: low.length, error: e.message };
    }
  }
  const { join } = await import('node:path');
  const { writeFileSync, existsSync, mkdirSync } = await import('node:fs');
  const { DATA_DIR } = await import('./config.js');
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const out = join(DATA_DIR, 'fbn-lowstock-alert.html');
  writeFileSync(out, html, 'utf8');
  return { sent: false, count: low.length, savedTo: out };
}

// =============================================================================
// ACTION ITEMS (high views, low sales)
// =============================================================================
export function actionItems() {
  const out = [];
  for (const p of getTable('Product')) {
    if (!p.price) continue;
    const s = seed(p.productCode);
    const views = 50 + (s % 950);
    const sold = s % 25;
    const conv = views > 0 ? Math.round((sold / views) * 1000) / 1000 : 0;
    const need = views >= 300 && conv < 0.02;
    const stored = getTable('Aplus').find((a) => a.productCode === p.productCode);
    let hasAplus = seed(p.productCode) % 2 === 0;
    if (stored) hasAplus = Boolean(stored.uploaded);
    const priceHigh = s % 3 === 0;
    let sug = 'Run ads to get more traffic';
    if (!hasAplus) sug = 'Add A+ content';
    else if (priceHigh) sug = 'Lower the price';
    out.push({ productCode: p.productCode, title: p.title, views, unitsSold: sold, conversion: conv, needAction: need, suggestion: sug });
  }
  return out.sort((a, b) => Number(b.needAction) - Number(a.needAction) || b.views - a.views);
}

// =============================================================================
// A+ CONTENT
// =============================================================================
export function getAplus() {
  const out = [];
  for (const p of getTable('Product')) {
    if (!p.price) continue;
    const stored = getTable('Aplus').find((a) => a.productCode === p.productCode);
    let has = seed(p.productCode) % 2 === 0;
    if (stored) has = Boolean(stored.uploaded);
    out.push({ productCode: p.productCode, title: p.title, category: p.category, hasAplus: has });
  }
  return out;
}
export function setAplus(code, uploaded = true) {
  setRow('Aplus', 'productCode', code, { uploaded });
  return { productCode: code, uploaded };
}

// =============================================================================
// RETURNS / RMA
// =============================================================================
export function getReturns() {
  // Returns come from the real table only; no mock seeding.
  return getTable('Return');
}

export function setReturnStatus(id, status) {
  setRow('Return', 'returnId', id, { status });
  addRow('AutomationLog', { automation: `return.${status}`, status: 'success', itemsTotal: 1, itemsOk: 1, itemsFailed: 0, at: now() });
  return { returnId: id, status };
}

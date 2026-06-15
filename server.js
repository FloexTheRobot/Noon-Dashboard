// server.js - Express server. Replaces Start-Site.ps1.
// Serves the dashboard from public/ and exposes the JSON /api/* endpoints,
// each a thin wrapper around src/services.js.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import * as svc from './src/services.js';
import { getTable } from './src/store.js';
import { noonCatalogCsv, noonCatalogXlsx, catalogStatus } from './src/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 7080;

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Wrap an async handler so thrown errors become a 500 JSON response.
const h = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined && !res.headersSent) res.json(result);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
};

// ---- dashboard + chart -------------------------------------------------------
app.all('/api/dashboard', h((req) => svc.dashboard(req.query.date || undefined)));
app.all('/api/sales-range', h((req) => svc.salesRange(req.query.days ? parseInt(req.query.days, 10) : 14)));

// ---- raw tables --------------------------------------------------------------
app.all('/api/products', h(() => getTable('Product')));
app.all('/api/pricing', h(() => getTable('PricingHistory')));
app.all('/api/stock', h(() => getTable('StockHistory')));
app.all('/api/automations', h(() => getTable('AutomationLog')));

// ---- pricing / products ------------------------------------------------------
app.all('/api/minprice', h((req) => svc.minimumPrice(req.query.code || 'ABC100')));
app.all('/api/panel/fetch', h((req) => svc.fetchPanelProduct(req.query.code || req.query.item)));
app.all('/api/create', h((req) => svc.newProduct(req.query.code || 'ABC100')));
app.all('/api/syncstock', h(() => svc.updateStock({ all: true })));

// ---- modules -----------------------------------------------------------------
app.all('/api/orders', h(() => svc.orders()));
app.all('/api/deals', h(() => svc.deals()));
app.all('/api/ads', h(() => svc.ads()));
app.all('/api/netprofit', h(() => svc.netProfit()));

app.all('/api/returns/status', h((req) => svc.setReturnStatus(req.query.id, req.query.status)));
app.all('/api/returns', h(() => svc.getReturns()));

app.all('/api/stock/fbp', h(() => svc.stockFBP()));
app.all('/api/stock/fbn', h(() => svc.stockFBN()));
app.all('/api/fbn/alert', h(() => svc.fbnLowAlert()));

app.all('/api/action-items', h(() => svc.actionItems()));
app.all('/api/aplus/set', h((req) => {
  const up = req.query.uploaded;
  const val = !(up === '0' || up === 'false');
  return svc.setAplus(req.query.code, val);
}));
app.all('/api/aplus', h(() => svc.getAplus()));

app.all('/api/bestsellers', h(() => svc.bestSellers()));
app.all('/api/dealoptimizer', h(() => svc.dealOptimizer()));
app.all('/api/pricecompare', h((req) => svc.priceCompare(req.query.code || 'ABC100')));

app.all('/api/assistant', h((req) => svc.assistant(req.query.q || 'What should I focus on today?')));
app.all('/api/keywords', h((req) => svc.newKeywords(req.query.code, req.query.category)));
app.all('/api/image', h((req) => svc.newImage(req.query.prompt || 'product banner', req.query.code, req.query.size || '1024x1024')));

app.all('/api/listings-pricing', h(() => svc.listingsPricing()));
app.all('/api/match-price', h((req) => svc.matchPrice(req.query.code)));
app.all('/api/newarrivals', h(() => svc.newArrivals()));

app.all('/api/autocreate/url', h((req) => svc.newProductFromUrl(req.query.code, req.query.url)));
app.all('/api/autocreate/bulk', h((req) => svc.newProductBulk(req.body?.codes || [])));

// ---- noon catalogue upload file (upload-only; no API) -------------------------
function catalogOpts(req) {
  const codes = req.query.codes ? String(req.query.codes).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const all = req.query.all === '1' || req.query.all === 'true';
  return { codes, all };
}
// Excel - the primary format Seller Lab expects. Fills noon's real template if
// you place it at templates/noon-catalog-template.xlsx, else a default workbook.
app.get('/api/noon/catalog.xlsx', async (req, res) => {
  try {
    const { buf } = await noonCatalogXlsx(catalogOpts(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="noon-catalog.xlsx"');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// CSV - kept as a convenience alternative.
app.get('/api/noon/catalog.csv', (req, res) => {
  try {
    const { csv } = noonCatalogCsv(catalogOpts(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="noon-catalog.csv"');
    res.send('﻿' + csv); // BOM so Excel reads UTF-8 correctly
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.all('/api/noon/catalog/count', h((req) => catalogStatus({ all: req.query.all === '1' })));

// Build the NIS file and upload it to Seller Lab via Playwright (saved session).
app.all('/api/noon/upload', h(async (req) => {
  const codes = req.query.codes ? String(req.query.codes).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const all = req.query.all === '1' || req.query.all === 'true';
  const { noonCatalogXlsx } = await import('./src/catalog.js');
  const { buf, count } = await noonCatalogXlsx({ codes, all });
  if (!count) return { ok: false, message: 'No products to upload.' };
  const dir = join(__dirname, 'data');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `noon-upload-${Date.now()}.xlsx`);
  writeFileSync(file, buf);
  const { uploadNis } = await import('./src/noon-upload.js');
  return uploadNis(file, { headless: false });
}));

// Full automation: fetch a SKU from connect, then create it on noon via the API.
app.all('/api/noon/create', h(async (req) => {
  const code = req.query.code;
  if (!code) throw new Error('SKU code is required');
  const product = await svc.fetchPanelProduct(code);
  const { createOnNoon } = await import('./src/noon-api.js');
  const noon = await createOnNoon(product);
  const images = (product.imageUrlsJpg && product.imageUrlsJpg.length ? product.imageUrlsJpg : product.imageUrls) || [];
  return {
    product: {
      productCode: product.productCode, title: product.title, description: product.description,
      brand: product.brand, barcode: product.barcode, imageUrls: images,
      primaryImage: product.primaryImage, videoUrls: product.videoUrls || [],
    },
    noon,
  };
}));

// ---- Mode 3: supplier pricelist (.xlsx) -> filled NIS workbook ---------------
// Raw xlsx bytes in the body. Parses variations/types, pulls images per SKU
// from connect, builds the NIS, and returns it with summary headers.
app.post('/api/noon/pricelist-nis', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  try {
    if (!req.body || !req.body.length) throw new Error('No file received.');
    const { parsePricelist } = await import('./src/pricelist.js');
    const { fetchCombinedMedia } = await import('./src/adapters.js');
    const { buildNisXlsx } = await import('./src/nis.js');
    const { TEMPLATE_PATH } = await import('./src/catalog.js');

    const parsed = parsePricelist(req.body);
    const brandFromTitle = (t) => {
      const w = String(t || '').trim().split(/\s+/);
      return w.length >= 2 && /^[A-Z]/.test(w[0]) && /^[A-Z]/.test(w[1]) ? `${w[0]} ${w[1]}` : (w[0] || '');
    };

    const products = [];
    for (const it of parsed.items) {
      let imageUrls = [];
      let imageUrlsJpg = [];
      let brand = brandFromTitle(it.title);
      try {
        const cm = await fetchCombinedMedia(it.sku); // images (+ brand) from connect
        imageUrls = cm.imageUrls || [];
        imageUrlsJpg = cm.imageUrlsJpg || [];
        if (cm.brand) brand = cm.brand;
      } catch { /* no connect media for this SKU - continue with pricelist data */ }
      products.push({
        productCode: it.sku,
        title: it.title,
        description: it.features || it.title,
        richTitle: `${it.title}. ${it.features || ''}`.trim(),
        features: it.features,
        brand,
        barcode: it.barcode,
        type: it.type,
        parentGroupKey: it.parentGroupKey,
        parentChildVariation: it.parentChildVariation,
        sizeVariation: it.sizeVariation,
        imageUrls,
        imageUrlsJpg,
      });
    }

    const { buf } = await buildNisXlsx(products, TEMPLATE_PATH);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="noon-NIS-pricelist.xlsx"');
    res.setHeader('X-Nis-Total', String(parsed.total));
    res.setHeader('X-Nis-Variations', String(parsed.variations));
    res.setHeader('X-Nis-Singles', String(parsed.singles));
    res.setHeader('Access-Control-Expose-Headers', 'X-Nis-Total, X-Nis-Variations, X-Nis-Singles');
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- notes (method-sensitive) ------------------------------------------------
app.all('/api/notes/delete', h((req) => svc.removeNote(req.query.id)));
app.all('/api/notes/update', h((req) => svc.setNote(req.body.id, req.body.title, req.body.body, req.body.tags || [])));
app.all('/api/notes', h((req) => {
  if (req.method === 'POST') return svc.newNote(req.body.title, req.body.body, req.body.tags || []);
  return svc.getNotes(req.query.q);
}));

// ---- calendar (method-sensitive) ---------------------------------------------
app.all('/api/calendar/delete', h((req) => svc.removeCalendarEvent(req.query.id)));
app.all('/api/calendar', h((req) => {
  if (req.method === 'POST') return svc.newCalendarEvent(req.body.date, req.body.note);
  return svc.getCalendar();
}));

// ---- fallback ----------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: `not found: ${req.path}` }));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`noon online dashboard running at ${url}`);
  if (process.argv.includes('--open')) {
    import('node:child_process').then(({ spawn }) => {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
      spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
    }).catch(() => {});
  }
});

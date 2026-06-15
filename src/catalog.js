// catalog.js - builds a noon catalogue upload file from created products.
// noon catalogue creation is upload-only (no API), so this file IS the
// integration: fetch -> create (local) -> export this file -> upload in Seller Lab.
//
// Two modes:
//   1. If you drop noon's real template at  templates/noon-catalog-template.xlsx
//      the exporter reads ITS header row and fills rows underneath, matching
//      each column by name (see HEADER_ALIASES). This is what Seller Lab wants.
//   2. Otherwise it emits a clean default workbook with the columns below, so
//      you have something usable until you add the real template.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { getTable } from './store.js';
import { ROOT } from './config.js';
import { buildNisXlsx, isNisTemplate } from './nis.js';

export const TEMPLATE_PATH = join(ROOT, 'templates', 'noon-catalog-template.xlsx');

// Default columns when no noon template is supplied.
const DEFAULT_HEADERS = [
  'partner_sku', 'product_title', 'brand', 'category', 'barcode', 'model_number',
  'price', 'stock', 'main_image', 'product_description',
  'image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'image_7', 'image_8',
];

// Map a normalized template header -> one of our product fields.
// Add noon's real header names here once you see their template.
const HEADER_ALIASES = {
  'partner sku': 'partner_sku', 'partnersku': 'partner_sku', 'sku': 'partner_sku', 'seller sku': 'partner_sku',
  'product title': 'product_title', 'title': 'product_title', 'name': 'product_title', 'product name': 'product_title',
  'brand': 'brand',
  'category': 'category', 'category code': 'category',
  'barcode': 'barcode', 'ean': 'barcode', 'upc': 'barcode',
  'model number': 'model_number', 'model': 'model_number', 'model no': 'model_number',
  'price': 'price', 'sale price': 'price', 'msrp': 'price',
  'stock': 'stock', 'quantity': 'stock', 'qty': 'stock',
  'description': 'product_description', 'product description': 'product_description', 'long description': 'product_description',
};

function norm(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Flatten one product into named fields + an ordered list of extra images.
function productFields(p) {
  const imgs = Array.isArray(p.imageUrls) ? p.imageUrls.filter(Boolean) : [];
  const main = p.primaryImage || imgs[0] || '';
  const extras = imgs.filter((u) => u !== main);
  return {
    partner_sku: p.productCode || '',
    product_title: p.title || '',
    brand: p.brand || '',
    category: p.category || '',
    barcode: p.barcode || '',
    model_number: p.productNo || '',
    price: p.price ?? '',
    stock: p.stock ?? '',
    main_image: main,
    product_description: p.description || '',
    extras,
  };
}

// Resolve the value for a given (template or default) header from a product.
function resolveCell(f, header) {
  const h = norm(header);
  const img = h.match(/(?:additional |extra )?image(?:\s*url)?\s*(\d+)/);
  if (img) return f.extras[parseInt(img[1], 10) - 1] || '';
  if (h === 'image' || h === 'image url' || /^(main|primary|cover)\s*image/.test(h)) return f.main_image;
  const key = HEADER_ALIASES[h];
  return key ? (f[key] ?? '') : '';
}

function selectProducts({ codes = null, all = false } = {}) {
  let products = getTable('Product').filter((p) => p.title);
  if (codes && codes.length) {
    const set = new Set(codes);
    return products.filter((p) => set.has(p.productCode));
  }
  return all ? products : products.filter((p) => p.source === 'panel');
}

// ---- default-column rows (used by CSV + default xlsx) ------------------------
export function buildCatalogRows(products) {
  return products.map((p) => {
    const f = productFields(p);
    const row = {};
    for (const h of DEFAULT_HEADERS) row[h] = resolveCell(f, h);
    return row;
  });
}

export function rowsToCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\r\n');
  return `${head}\r\n${body}\r\n`;
}

export function noonCatalogCsv(opts = {}) {
  const products = selectProducts(opts);
  return { csv: rowsToCsv(buildCatalogRows(products)), count: products.length };
}

// Lightweight status for the UI (no file build).
export function catalogStatus(opts = {}) {
  const products = selectProducts(opts);
  const hasTemplate = existsSync(TEMPLATE_PATH);
  return { count: products.length, usingTemplate: hasTemplate, nis: hasTemplate && isNisTemplate(TEMPLATE_PATH) };
}

// ---- xlsx (NIS template, generic template, or default columns) --------------
export async function noonCatalogXlsx(opts = {}) {
  const products = selectProducts(opts);

  // noon's NIS template: classify + enrich + inject rows, preserving dropdowns.
  if (existsSync(TEMPLATE_PATH) && isNisTemplate(TEMPLATE_PATH)) {
    const { buf } = await buildNisXlsx(products, TEMPLATE_PATH);
    return { buf, count: products.length, usingTemplate: true, nis: true };
  }

  let wb;
  let usingTemplate = false;
  if (existsSync(TEMPLATE_PATH)) {
    usingTemplate = true;
    wb = XLSX.read(readFileSync(TEMPLATE_PATH), { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const existing = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false });
    const headers = existing[0] || DEFAULT_HEADERS;
    const dataRows = products.map((p) => {
      const f = productFields(p);
      return headers.map((h) => resolveCell(f, String(h)));
    });
    wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(existing.concat(dataRows));
  } else {
    const rows = buildCatalogRows(products);
    const ws = XLSX.utils.json_to_sheet(rows, { header: DEFAULT_HEADERS });
    wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalog');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, count: products.length, usingTemplate };
}

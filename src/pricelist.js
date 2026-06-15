// pricelist.js - parses a supplier "pricelist" workbook (e.g. Green Lion
// New Arrival) into per-SKU items, detecting variations and category headers.
//
// Layout (discovered from the Green Lion template):
//   - A header row containing "SKU" defines the columns:
//       PRODUCT DESCRIPTION | Features | SKU | BARCODE | Image | Mockup |
//       COLOR | COMPATIBLE | PRICE / AED | RRP | MASTER BOX DETAILS | MEDIA
//   - Full-width (A:L) merged cells are SECTION/TYPE headers (TWS, HEADPHONE,
//     POWER BANK, ...). They set the product type for the rows beneath them.
//   - A vertical merge on the PRODUCT DESCRIPTION column spanning several rows
//     marks a VARIATION group: those rows are variants of one parent product
//     (e.g. Black + White), sharing the description/features from the top row
//     and differing by COLOR (-> noon size_variation).
//   - A SKU row not inside such a merge is a single product.
import * as XLSX from 'xlsx';

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lc = (s) => norm(s).toLowerCase();

// build a key from text: letters/digits, capped
function slug(s) {
  return norm(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function parsePricelist(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => /list|full/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) throw new Error('Empty or unreadable pricelist sheet.');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (r, c) => norm((ws[XLSX.utils.encode_cell({ r, c })] || {}).v);

  // ---- merges: full-width headers + vertical description groups ----
  // Vertical merge on the PRODUCT DESCRIPTION column (A) spanning >1 row marks a
  // VARIATION group (the variant rows). Full-width header bands span many cols on
  // a single row and are handled structurally below (text + no SKU), so they're
  // intentionally excluded here by the column-span guard.
  const merges = ws['!merges'] || [];
  const descGroupTop = {};                  // row -> top row of its variation group
  for (const m of merges) {
    if (m.s.c === 0 && m.e.r > m.s.r && (m.e.c - m.s.c) < 8) {
      for (let r = m.s.r; r <= m.e.r; r++) descGroupTop[r] = m.s.r;
    }
  }

  // ---- locate the header row + columns ----
  let headerRow = -1;
  const col = {};
  for (let r = range.s.r; r <= range.e.r && headerRow < 0; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (lc(cell(r, c)) === 'sku') { headerRow = r; break; }
    }
  }
  if (headerRow < 0) throw new Error('Could not find a header row containing "SKU".');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = lc(cell(headerRow, c));
    if (!h) continue;
    if (h.includes('description')) col.desc = c;
    else if (h.startsWith('feature')) col.features = c;
    else if (h === 'sku') col.sku = c;
    else if (h.includes('barcode')) col.barcode = c;
    else if (h === 'color' || h === 'colour') col.color = c;
    else if (h.includes('price')) col.price = c;
    else if (h === 'rrp') col.rrp = c;
    else if (h.includes('compatible')) col.compatible = c;
    else if (h === 'media') col.media = c;
  }
  if (col.sku == null) throw new Error('No SKU column found.');

  // ---- walk rows ----
  const items = [];
  let currentType = '';
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const sku = cell(r, col.sku);
    const aText = col.desc != null ? cell(r, col.desc) : '';

    // Section/type header: a label row with description text but NO SKU. Covers
    // both full-width merged headers and standalone black-filled cells
    // (e.g. HEADPHONE, POWER BANK) - we don't rely on fill colour, which xlsx
    // libraries read unreliably.
    if (aText && !sku) { currentType = aText; continue; }
    if (!sku) continue; // blank / spacer row

    const top = descGroupTop[r];
    const isVariant = top != null; // inside a multi-row description merge
    const title = isVariant ? cell(top, col.desc) : aText;
    const features = (col.features != null) ? (isVariant ? cell(top, col.features) : cell(r, col.features)) : '';
    const color = col.color != null ? cell(r, col.color) : '';

    const item = {
      sku,
      title,
      features,
      type: currentType,
      color,
      barcode: col.barcode != null ? cell(r, col.barcode) : '',
      compatible: col.compatible != null ? cell(r, col.compatible) : '',
      price: col.price != null ? cell(r, col.price) : '',
      rrp: col.rrp != null ? cell(r, col.rrp) : '',
      mediaUrl: (col.media != null && ws[XLSX.utils.encode_cell({ r, c: col.media })]?.l?.Target) || '',
      isVariant,
      parentGroupKey: isVariant ? slug(title) : '',
      sizeVariation: isVariant ? color : '',
    };
    items.push(item);
  }
  if (!items.length) throw new Error('No SKU rows found in the pricelist.');

  // mark variant rows as Child (noon parent_child_variation)
  const groupCounts = {};
  for (const it of items) if (it.isVariant) groupCounts[it.parentGroupKey] = (groupCounts[it.parentGroupKey] || 0) + 1;
  for (const it of items) it.parentChildVariation = (it.isVariant && groupCounts[it.parentGroupKey] > 1) ? 'Child' : '';

  const groups = Object.keys(groupCounts).filter((g) => groupCounts[g] > 1).length;
  return { items, sheet: sheetName, total: items.length, variations: groups, singles: items.filter((i) => !i.parentChildVariation).length };
}

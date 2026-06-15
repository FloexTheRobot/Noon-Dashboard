// nis.js - fills noon's NIS (Noon Item Setup) template.
//
// noon's template enforces dropdown validations on Family/Product Type/Subtype,
// Item Condition and VAT columns, so we (a) classify each product into a valid
// Family > Product Type > Subtype combo from the "Classification Directory"
// sheet, and (b) inject data rows at the XML level (row 10+) so all five sheets,
// dropdowns and data validations in the original template are preserved exactly.
import { readFileSync, existsSync } from 'node:fs';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { enrichContent } from './enrich.js';

// Column order of the template_data sheet (machine-code row, A..AH).
const COLS = [
  'family', 'product_type', 'product_subtype', 'seller_sku', 'brand',
  'parent_group_key', 'parent_child_variation', 'size_variation',
  'product_title', 'long_description',
  ...Array.from({ length: 12 }, (_, i) => `feature_bullet_${i + 1}`),
  'item_condition', 'whats_in_the_box',
  ...Array.from({ length: 7 }, (_, i) => `image_url_${i + 1}`),
  'vat_rate_ae', 'vat_rate_sa', 'vat_rate_eg',
];

const TEMPLATE_DATA_FIRST_ROW = 10; // rows 1-9 are headers/metadata

function encodeCol(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/[\r\n\t]+/g, ' ').trim();

// ---- classification ----------------------------------------------------------
let TAXONOMY = null;
function loadTaxonomy(templatePath) {
  if (TAXONOMY) return TAXONOMY;
  const wb = XLSX.read(readFileSync(templatePath), { type: 'buffer' });
  const ws = wb.Sheets['Classification Directory'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }).slice(1);
  TAXONOMY = rows
    .filter((r) => r[0] && r[1] && r[2])
    .map((r) => ({ family: String(r[0]).trim(), type: String(r[1]).trim(), subtype: String(r[2]).trim(), includes: String(r[3] || '') }));
  return TAXONOMY;
}

const stem = (w) => w.replace(/s$/, '');
function toks(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map(stem);
}

// High-confidence keyword -> exact noon Family > Type > Subtype. Driven by the
// supplier "type" (HEADPHONE / POWER BANK / TWS …) plus the product name.
// Order matters (first match wins). All strings are verified taxonomy values.
const CATEGORY_MAP = [
  { rx: /power\s*bank/, f: 'Electronic Accessories', t: 'Phone Accessories', s: 'Power Banks' },
  { rx: /\b(tws|true\s*wireless|ear\s*buds?|in[\s-]?ear)\b/, f: 'Electronic Accessories', t: 'Headphones', s: 'Truewireless Headphones' },
  { rx: /wired\s*(head|ear)phone/, f: 'Electronic Accessories', t: 'Headphones', s: 'Wired Headphones' },
  { rx: /(head|ear)phone|over[\s-]?ear|on[\s-]?ear/, f: 'Electronic Accessories', t: 'Headphones', s: 'Wireless Headphones' },
  { rx: /speaker|soundbar/, f: 'Audio & Video', t: 'Portable Audio', s: 'Speakers' },
  { rx: /car\s*charger/, f: 'Electronic Accessories', t: 'Phone Accessories', s: 'Car Chargers' },
  { rx: /charger|adapter|wall\s*charg/, f: 'Electronic Accessories', t: 'Phone Accessories', s: 'Mobile Phone Chargers' },
  { rx: /smart\s*watch/, f: 'Electronic Accessories', t: 'Wearables', s: 'Smartwatch' },
];

// Pick the best Family > Type > Subtype for a product. Returns blanks if no
// confident match (better blank than wrong for a mandatory, validated field).
export function classify(product, templatePath) {
  const taxonomy = loadTaxonomy(templatePath);
  const text = `${product.type || ''} ${product.title || ''} ${product.features || ''} ${product.richTitle || ''} ${product.description || ''}`.toLowerCase();

  // 1) high-confidence keyword map (supplier type + product name)
  for (const m of CATEGORY_MAP) if (m.rx.test(text)) return { family: m.f, type: m.t, subtype: m.s, score: 99 };

  // 2) heuristic scoring against the taxonomy
  const set = new Set(toks(text));
  let best = null;
  let bestScore = 0;
  for (const t of taxonomy) {
    const sub = toks(t.subtype);
    const typ = toks(t.type);
    const inc = toks(t.includes);
    let score = sub.filter((w) => set.has(w)).length * 5
      + typ.filter((w) => set.has(w)).length * 2
      + inc.filter((w) => set.has(w)).length * 1;
    // phrase boost only for multi-word subtypes (avoids "Solar"/"Battery" traps)
    if (t.subtype.split(/\s+/).length > 1 && text.includes(t.subtype.toLowerCase())) score += 10;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best || bestScore < 5) return { family: '', type: '', subtype: '', score: bestScore };
  return { family: best.family, type: best.type, subtype: best.subtype, score: bestScore };
}

// ---- row values --------------------------------------------------------------
async function rowValues(product, templatePath) {
  const c = classify(product, templatePath);
  const content = await enrichContent(product);
  const imgs = (product.imageUrlsJpg && product.imageUrlsJpg.length ? product.imageUrlsJpg : product.imageUrls || []).slice(0, 7);

  // Prefer the supplier's own Features list for bullets (already concise,
  // bulleted with •); fall back to the AI/heuristic bullets otherwise.
  let bullets = content.featureBullets;
  if (product.features) {
    const fb = String(product.features)
      .split(/[•\n;]+/).map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 3).slice(0, 12);
    if (fb.length) bullets = fb;
  }

  const v = {
    family: c.family,
    product_type: c.type,
    product_subtype: c.subtype,
    seller_sku: product.productCode || '',
    brand: product.brand || '',
    parent_group_key: product.parentGroupKey || '',
    parent_child_variation: product.parentChildVariation || '',
    size_variation: product.sizeVariation || '',
    product_title: content.title,
    long_description: content.longDescription,
    item_condition: 'New',
    whats_in_the_box: content.whatsInTheBox,
    vat_rate_ae: 'Std',
    vat_rate_sa: 'Std',
    vat_rate_eg: 'Std',
  };
  bullets.slice(0, 12).forEach((b, i) => { v[`feature_bullet_${i + 1}`] = b; });
  imgs.forEach((u, i) => { v[`image_url_${i + 1}`] = u; });
  return v;
}

// ---- build the filled NIS workbook ------------------------------------------
export async function buildNisXlsx(products, templatePath) {
  if (!existsSync(templatePath)) throw new Error(`NIS template not found at ${templatePath}`);
  const zip = new AdmZip(readFileSync(templatePath));

  // template_data is sheet3 (sheetId 3 -> worksheets/sheet3.xml in this template).
  const sheetPath = 'xl/worksheets/sheet3.xml';
  let xml = zip.readAsText(sheetPath);

  const rowsXml = [];
  for (let i = 0; i < products.length; i++) {
    const rowNum = TEMPLATE_DATA_FIRST_ROW + i;
    const v = await rowValues(products[i], templatePath);
    const cells = COLS.map((code, idx) => {
      const val = v[code];
      if (val === undefined || val === null || val === '') return '';
      return `<c r="${encodeCol(idx)}${rowNum}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
    }).join('');
    rowsXml.push(`<row r="${rowNum}">${cells}</row>`);
  }

  // Append the data rows just before </sheetData>.
  xml = xml.replace('</sheetData>', rowsXml.join('') + '</sheetData>');
  // Extend the sheet dimension so readers see the new rows.
  const lastRow = TEMPLATE_DATA_FIRST_ROW + products.length - 1;
  xml = xml.replace(/<dimension ref="A1:AH\d+"\s*\/>/, `<dimension ref="A1:AH${Math.max(9, lastRow)}" />`);

  zip.updateFile(sheetPath, Buffer.from(xml, 'utf8'));
  return { buf: zip.toBuffer(), count: products.length };
}

// True if a workbook at this path is the NIS template (has template_data sheet).
export function isNisTemplate(templatePath) {
  try {
    const zip = new AdmZip(readFileSync(templatePath));
    return zip.readAsText('xl/workbook.xml').includes('name="template_data"');
  } catch {
    return false;
  }
}

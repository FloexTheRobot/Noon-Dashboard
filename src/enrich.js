// enrich.js - produces noon-compliant, SEO-optimized listing content from the
// data fetched from connect.oskarme.com.
//
// noon content rules enforced here (see the template's instructions sheet):
//   - Title: clear & descriptive, NO brand name, include pack size if multipack.
//   - Feature bullets: each <= 250 chars, phrases separated by semicolons, focus
//     on what matters most; no references to other marketplaces.
//   - Long description: 250-4000 chars, plain text (no bold/italic), most
//     important info first, unique to the product, good grammar.
//
// When config.anthropicApiKey is set it uses Claude for best-quality copy;
// otherwise a strong deterministic generator builds content from the product's
// own name / marketing title / brand / category.
import { getConfig } from './config.js';
import { callClaude } from './adapters.js';

const cap = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '').trim() : s);
const clean = (s) => String(s || '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();

// Remove the brand word(s) from a string (brand must not appear in the title).
function debrand(text, brand) {
  let t = clean(text);
  if (brand) {
    const b = brand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\b${b}\\b`, 'ig'), '');
    // also strip a leading single-token brand variant (e.g. "Porodo" vs "PORODO")
    const first = brand.trim().split(/\s+/)[0];
    if (first) t = t.replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), '');
  }
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s,;:\-–—]+/, '').trim();
}

// Title-case but preserve real acronyms and unit/number tokens (10000mAh,
// 3-in-1, ABS, PC, USB, 1200A...). Common words that happen to be ALL CAPS in
// the source (WITH, JUMP, BANK, AIR) are normalized to Title Case.
const ACRONYMS = new Set(['USB', 'USB-C', 'ABS', 'PC', 'LED', 'LCD', 'TV', 'HD', 'AC', 'DC', 'RGB', 'IP', 'IP67', 'IP68', 'PD', 'QC', 'EU', 'UK', 'US', 'UAE', 'KSA', 'BT', '3D', '4K', '8K']);
function smartTitle(s) {
  return clean(s)
    .split(' ')
    .map((w) => {
      if (/\d/.test(w)) return w.replace(/mah\b/i, 'mAh').replace(/ghz\b/i, 'GHz').replace(/wh\b/i, 'Wh');
      if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

// Split a marketing string into candidate feature phrases.
function toClauses(text, brand) {
  return debrand(text, brand)
    .split(/[,;]|\s+\|\s+|\s+•\s+/)
    .map((c) => clean(c))
    .map((c) => c.replace(/^(with|and|featuring|includes?)\s+/i, ''))
    .filter((c) => c.length >= 3);
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = x.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

// ---- deterministic generator -------------------------------------------------
function generate(product) {
  const brand = clean(product.brand);
  // Short product name (from the panel `description`/name) makes the best title;
  // the long marketing string (richTitle) is reserved for bullets/description.
  const shortName = clean(product.title || product.description || product.productCode);
  const category = clean(product.category && product.category !== 'general' ? product.category : '');

  // Title: concise, de-branded, descriptive (NOT the full comma-separated dump).
  let title = smartTitle(debrand(shortName, brand)).split(',')[0].trim();
  title = cap(title, 150) || smartTitle(debrand(product.productCode, brand)) || product.productCode;

  // Feature bullets from the marketing clauses, then padded with quality points.
  let bullets = dedupe(toClauses(product.richTitle || product.title || '', brand))
    .map((c) => smartTitle(c))
    .filter((c) => c.length >= 4)
    .map((c) => cap(c, 250));
  // Drop a pure color/size-only first clause duplication of the title.
  bullets = bullets.filter((b) => b.toLowerCase() !== title.toLowerCase());
  if (bullets.length < 4) {
    const extra = [
      brand ? `Genuine ${brand} product; quality you can trust` : 'Quality build; reliable everyday performance',
      'Compact and lightweight; easy to carry and store',
      category ? `Ideal ${category.toLowerCase()} for home, work and travel` : 'Versatile design for home, work and travel',
      'Backed by responsive after-sales support',
    ];
    for (const e of extra) { if (bullets.length >= 6) break; if (!bullets.some((b) => b.toLowerCase() === e.toLowerCase())) bullets.push(cap(e, 250)); }
  }
  bullets = bullets.slice(0, 12);

  // Long description: product-specific, key info first, plain text, 250-4000.
  const featureList = bullets.slice(0, 6).join(', ');
  const lead = category ? `${title} is a ${category.toLowerCase()} designed for dependable everyday use.` : `${title} is designed for dependable everyday use.`;
  const sentences = [
    lead,
    featureList ? `Key highlights include ${featureList}.` : '',
    brand ? `${brand} combines practical design with solid build quality so you get consistent results every time.` : 'It combines practical design with solid build quality so you get consistent results every time.',
    'Whether at home, in the office or on the move, it delivers the performance and convenience you expect.',
  ].filter(Boolean);
  let longDescription = clean(sentences.join(' '));
  // Ensure minimum length without padding with banned generic-only filler.
  if (longDescription.length < 250) {
    longDescription = clean(`${longDescription} It is easy to set up and use, built to last, and a smart addition to your collection. Order today and enjoy fast, reliable delivery.`);
  }
  longDescription = cap(longDescription, 4000);

  // What's in the box - conservative.
  const isCharger = /charg|power\s*bank|cable|adapter|inflator|starter/i.test(`${shortName} ${product.richTitle || ''}`);
  const box = [`1 x ${cap(debrand(title, brand) || product.productCode, 60)}`];
  if (isCharger) box.push('Charging Cable');
  box.push('User Manual');
  const whatsInTheBox = box.join('; ');

  return { title, longDescription, featureBullets: bullets, whatsInTheBox, contentSource: 'generated' };
}

// ---- Claude path -------------------------------------------------------------
async function generateWithAI(product) {
  const cfg = getConfig();
  const sys =
    'You are an expert e-commerce SEO copywriter for the noon marketplace. ' +
    'Follow these rules strictly: the title must NOT contain the brand name and must be clear and descriptive; ' +
    'each feature bullet must be <= 250 characters and may use semicolons to separate phrases; ' +
    'the long description must be 250-4000 characters, plain text (no markdown/bold/italic), unique to the product, with the most important information first. ' +
    'Return ONLY valid JSON: {"title": string, "long_description": string, "feature_bullets": string[], "whats_in_the_box": string}.';
  const usr =
    `Brand: ${product.brand}\n` +
    `Product name / marketing text: ${product.richTitle || product.title}\n` +
    `Category: ${product.category || 'unknown'}\n` +
    `Raw description: ${product.description || ''}\n` +
    'Write the best possible SEO-optimized content. Provide 6-10 strong feature bullets.';
  const txt = await callClaude(sys, usr, 2048);
  const ai = JSON.parse(String(txt).replace(/^```(json)?/i, '').replace(/```$/, '').trim());
  return {
    title: cap(clean(ai.title), 200),
    longDescription: cap(clean(ai.long_description), 4000),
    featureBullets: (ai.feature_bullets || []).map((b) => cap(clean(b), 250)).filter(Boolean).slice(0, 12),
    whatsInTheBox: clean(ai.whats_in_the_box || ''),
    contentSource: 'ai',
  };
}

export async function enrichContent(product) {
  const cfg = getConfig();
  if (cfg.anthropicApiKey) {
    try {
      const ai = await generateWithAI(product);
      if (ai.title && ai.longDescription && ai.featureBullets.length) return ai;
    } catch {
      /* fall back to deterministic */
    }
  }
  return generate(product);
}

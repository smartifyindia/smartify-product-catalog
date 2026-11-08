// Meta (Facebook / WhatsApp) catalog feed rows from products.json.
// Pure: no I/O. scripts/build-whatsapp-feed.mjs reads products.json and writes the CSV.
//
// Rules this file enforces (each one has a test):
//   - the price is the SRP, which is GST-inclusive, as "4200.00 INR" (Meta feed format, rupees, two decimals)
//   - the id is the Smartify SKU: WhatsApp orders come back as product_retailer_id == this id
//   - a product with the "photography pending" placeholder is left out until it has a real photo
//   - no supplier name and no "made to order" wording may reach a customer-visible field
//   - availability is always "in stock": Smartify products are never described as out of stock

import path from 'node:path';

export const SITE_BASE = 'https://smartify.in/product';
// scripts/build-whatsapp-images.mjs writes <sku>.jpg files (1200 px, well under Meta's 8 MB limit); they are hosted under this prefix.
export const DEFAULT_IMAGE_BASE = 'https://pub-cb5e9b79d39046829fc7d2bc4443b347.r2.dev/whatsapp';
export const PLACEHOLDER_IMAGE = 'placeholder-photography-pending.png';

export const COLUMNS = [
  'id', 'title', 'description', 'availability', 'condition', 'price',
  'link', 'image_link', 'brand', 'product_type',
];

// Customer-visible fields must never carry these (brand rule: customers never learn the manufacturer; no "made to order").
const BANNED = /youtomatic|made[- ]to[- ]order/i;
const MAX_TITLE = 150;
const MAX_DESCRIPTION = 5000;

const clean = (s) => String(s ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function priceOf(srp) {
  if (!Number.isFinite(srp) || srp <= 0) return null;
  return `${Number(srp).toFixed(2)} INR`;
}

export const imageLink = (sku, imageBase = DEFAULT_IMAGE_BASE) => `${imageBase}/${encodeURIComponent(sku)}.jpg`;

function describe(p) {
  const base = clean(p.description?.consumer) || clean(p.description?.technical).split('\n\n')[0] || p.name;
  const facts = [p.device_type, p.protocol].filter(Boolean).join(' · ');
  return truncate(facts ? `${base}\n\n${facts}.` : base, MAX_DESCRIPTION);
}

/** → { rows, skipped: [{ sku, name, reason }] } */
export function buildFeed(products, { imageBase = DEFAULT_IMAGE_BASE } = {}) {
  const rows = [];
  const skipped = [];
  const seen = new Set();
  for (const p of products) {
    const skip = (reason) => skipped.push({ sku: p.sku, name: p.name, reason });
    if (!p.enabled) { skip('disabled'); continue; }
    if (!p.sku || !p.slug || !p.name) { skip('missing sku, slug or name'); continue; }
    const price = priceOf(p.pricing?.srp_inr);
    if (!price) { skip('no SRP'); continue; }
    const hero = p.images?.hero;
    if (!hero) { skip('no hero image'); continue; }
    if (path.basename(hero) === PLACEHOLDER_IMAGE) { skip('placeholder photo (photography pending)'); continue; }
    if (seen.has(p.sku)) throw new Error(`duplicate SKU ${p.sku}`);
    seen.add(p.sku);
    const row = {
      id: String(p.sku),
      title: truncate(clean(p.device_type ? `${p.name} – ${p.device_type}` : p.name), MAX_TITLE),
      description: describe(p),
      availability: 'in stock',
      condition: 'new',
      price,
      link: `${SITE_BASE}/${p.slug}/`,
      image_link: imageLink(p.sku, imageBase),
      brand: p.brand || 'Smartify',
      product_type: Array.isArray(p.category) ? p.category.join(' > ') : String(p.category || ''),
    };
    for (const [field, value] of Object.entries(row)) {
      if (BANNED.test(value)) throw new Error(`SKU ${p.sku}: banned wording in ${field}`);
    }
    rows.push(row);
  }
  return { rows, skipped };
}

const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows) {
  return `${[COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(String(r[c] ?? ''))).join(','))].join('\n')}\n`;
}

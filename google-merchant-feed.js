#!/usr/bin/env node
/**
 * Generate Google Merchant Center product feed (RSS 2.0 + Google namespace)
 *
 * Usage:
 *   node google-merchant-feed.js                          # defaults below
 *   node google-merchant-feed.js --dry-run                # print XML to stdout
 *   node google-merchant-feed.js \
 *     --input ./products.json \
 *     --output ../smartify-website/public/product-feed.xml \
 *     --site-base https://smartify.in/product \
 *     --feed-title "Smartify — Smart Home Products"
 *
 * Required flags (or use defaults):
 *   --input      Path to products.json              [./products.json]
 *   --output     Path to write the XML feed         [../smartify-website/public/product-feed.xml]
 *   --site-base  Base URL for product pages         [https://smartify.in/product]
 *   --feed-title Feed <title> shown in Merchant     [Smartify — Smart Home Products]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse named CLI flags: --key value
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const DRY_RUN = process.argv.includes('--dry-run');

const INPUT_PATH = path.resolve(arg('input',      path.join(__dirname, 'products.json')));
const OUT_PATH   = path.resolve(arg('output',     path.join(__dirname, '..', 'smartify-website', 'public', 'product-feed.xml')));
const SITE_BASE  = arg('site-base',  'https://smartify.in/product');
const FEED_TITLE = arg('feed-title', 'Smartify — Smart Home Products');

const R2_BASE = 'https://pub-cb5e9b79d39046829fc7d2bc4443b347.r2.dev/products';

function imageUrl(heroPath) {
  const filename = path.basename(heroPath);
  return `${R2_BASE}/${encodeURIComponent(filename)}`;
}

// Google price format: "3000.00 INR"
function priceStr(srp_inr) {
  return `${srp_inr.toFixed(2)} INR`;
}

// Escape XML special characters
function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Truncate to Google's 5000-char description limit
function truncate(str, max = 5000) {
  return str?.length > max ? str.slice(0, max - 1) + '…' : str ?? '';
}

// Map first product category to Google's product taxonomy
const CATEGORY_MAP = {
  'Retrofit Switches':  'Electronics > Home Automation',
  'Smart Switches':     'Electronics > Home Automation',
  'Gateways':           'Electronics > Home Automation > Smart Home Hubs',
  'Sensors':            'Electronics > Home Automation > Smart Home Sensors',
  'IR Blasters':        'Electronics > Remote Controls',
  'LED Controllers':    'Electronics > Home Automation',
  'Touch Panels':       'Electronics > Home Automation',
  'Smart Panels':       'Electronics > Home Automation',
};

function googleCategory(categories) {
  const cats = Array.isArray(categories) ? categories : [categories];
  for (const c of cats) {
    if (CATEGORY_MAP[c]) return CATEGORY_MAP[c];
  }
  return 'Electronics > Home Automation';
}

function productToItem(p) {
  const desc = truncate(p.description?.consumer || p.description?.technical || p.name);
  const imgUrl = p.images?.hero ? imageUrl(p.images.hero) : null;

  return {
    id:       p.sku,
    title:    p.name,
    desc,
    link:     `${SITE_BASE}/${p.slug}`.replace(/([^:])\/\//g, '$1/'),
    imgUrl,
    price:    priceStr(p.pricing.srp_inr),
    brand:    p.brand || 'Smartify',
    category: googleCategory(p.category),
    mpn:      p.sku,
  };
}

function buildXml(items) {
  const now = new Date().toUTCString();

  const itemsXml = items.map(i => `
    <item>
      <g:id>${esc(i.id)}</g:id>
      <g:title>${esc(i.title)}</g:title>
      <g:description>${esc(i.desc)}</g:description>
      <g:link>${esc(i.link)}</g:link>
      <g:image_link>${esc(i.imgUrl)}</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>${esc(i.price)}</g:price>
      <g:brand>${esc(i.brand)}</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>${esc(i.category)}</g:google_product_category>
      <g:mpn>${esc(i.mpn)}</g:mpn>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${esc(FEED_TITLE)}</title>
    <link>${esc(SITE_BASE.replace(/\/product.*$/, ''))}</link>
    <description>Smart home automation products by Smartify India</description>
    <lastBuildDate>${now}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;
}

function main() {
  const raw      = fs.readFileSync(INPUT_PATH, 'utf8');
  const products = JSON.parse(raw).filter(p => p.enabled);

  const withImages    = products.filter(p => p.images?.hero);
  const skippedCount  = products.length - withImages.length;

  if (skippedCount > 0) {
    const skipped = products.filter(p => !p.images?.hero).map(p => p.name);
    console.warn(`Skipping ${skippedCount} product(s) with no image: ${skipped.join(', ')}`);
  }

  const items = withImages.map(productToItem);
  const xml   = buildXml(items);

  if (DRY_RUN) {
    console.log(xml);
    console.log(`\n--- DRY RUN: ${items.length} products would be written to feed ---`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, xml, 'utf8');
  console.log(`✓ Wrote ${items.length} products → ${OUT_PATH}`);
}

main();

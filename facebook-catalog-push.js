#!/usr/bin/env node
/**
 * Push Smartify products to Facebook Catalog via Batch API
 *
 * Prerequisites:
 *   FB_ACCESS_TOKEN  - System User token with catalog_management permission
 *   FB_CATALOG_ID    - From Commerce Manager > your catalog > Settings
 *
 * Usage:
 *   FB_ACCESS_TOKEN=xxx FB_CATALOG_ID=yyy node facebook-catalog-push.js
 *   node facebook-catalog-push.js --dry-run   # Preview payload without sending
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const CATALOG_ID   = process.env.FB_CATALOG_ID;
const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v26.0';
const DRY_RUN      = process.argv.includes('--dry-run');

const R2_BASE = 'https://pub-cb5e9b79d39046829fc7d2bc4443b347.r2.dev/products';
const SITE_BASE = 'https://smartify.in/product';

// Maps product hero image path → R2 public URL
function imageUrl(heroPath) {
  const filename = path.basename(heroPath);
  return `${R2_BASE}/${encodeURIComponent(filename)}`;
}

// Facebook requires price as integer paise (INR paise = INR * 100)
function priceStr(srp_inr) {
  return `${srp_inr * 100} INR`;
}

// Truncate to FB's 5000-char description limit
function truncate(str, max = 5000) {
  return str?.length > max ? str.slice(0, max - 1) + '…' : str;
}

function mapProduct(p) {
  return {
    retailer_id: p.sku,
    name: p.name,
    description: truncate(p.description?.consumer || p.description?.technical || p.name),
    price: priceStr(p.pricing.srp_inr),
    currency: 'INR',
    availability: p.enabled ? 'in stock' : 'out of stock',
    condition: 'new',
    url: `${SITE_BASE}/${p.slug}`,
    image_url: imageUrl(p.images.hero),
    brand: p.brand || 'Smartify',
    category: Array.isArray(p.category) ? p.category[0] : p.category,
    google_product_category: 'Electronics > Home Automation',
  };
}

async function push(products) {
  const items = products.map(p => ({
    method: 'UPDATE',   // UPDATE = create-or-update (idempotent)
    retailer_id: p.retailer_id,
    data: p,
  }));

  if (!/^v\d+\.\d+$/.test(GRAPH_VERSION)) {
    throw new Error('FB_GRAPH_VERSION must look like v26.0');
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${CATALOG_ID}/items_batch`;
  const body = {
    allow_upsert: true,
    requests: items,
  };

  console.log(`\nPOSTing ${items.length} products to catalog ${CATALOG_ID}...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    console.error('Facebook API error:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  return json;
}

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8');
  const allProducts = JSON.parse(raw);
  const enabled = allProducts.filter(p => p.enabled);

  console.log(`Loaded ${enabled.length} enabled products from products.json`);

  const mapped = enabled.map(mapProduct);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: sample payload (first 2 products) ---');
    console.log(JSON.stringify(mapped.slice(0, 2), null, 2));
    console.log(`\n${mapped.length} products would be pushed to catalog.`);
    return;
  }

  if (!ACCESS_TOKEN || !CATALOG_ID) {
    console.error('Error: FB_ACCESS_TOKEN and FB_CATALOG_ID environment variables are required.');
    console.error('Usage: FB_ACCESS_TOKEN=xxx FB_CATALOG_ID=yyy node facebook-catalog-push.js');
    console.error('Tip:   node facebook-catalog-push.js --dry-run   (no credentials needed)');
    process.exit(1);
  }

  const result = await push(mapped);
  console.log('Success:', JSON.stringify(result, null, 2));
}

main();

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
const DRY_RUN      = process.argv.includes('--dry-run');
const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v26.0';
const COMMERCE_BASE_URL = process.env.COMMERCE_BASE_URL || 'https://smartify.in';

const R2_BASE = 'https://pub-cb5e9b79d39046829fc7d2bc4443b347.r2.dev/products';
const SITE_BASE = 'https://smartify.in/product';

// Maps product hero image path → R2 public URL
function imageUrl(heroPath) {
  const filename = path.basename(heroPath);
  return `${R2_BASE}/${encodeURIComponent(filename)}`;
}

// items_batch takes the displayed major-unit price and ISO currency together.
function priceStr(srp_inr) {
  if (!Number.isFinite(srp_inr) || srp_inr < 0) throw new Error('Invalid catalog price');
  return `${srp_inr} INR`;
}

// Truncate to FB's 5000-char description limit
function truncate(str, max = 5000) {
  return str?.length > max ? str.slice(0, max - 1) + '…' : str;
}

export function mapProduct(p, availability) {
  if (availability?.availability_state !== 'verified' ||
      !Number.isSafeInteger(availability.quantity) || availability.quantity < 0 ||
      typeof availability.purchasable !== 'boolean') {
    throw new Error(`Missing verified Commerce availability for SKU ${p.sku}`);
  }
  return {
    retailer_id: p.sku,
    title: p.name,
    description: truncate(p.description?.consumer || p.description?.technical || p.name),
    price: priceStr(p.pricing.srp_inr),
    availability: availability.quantity > 0 && availability.purchasable ? 'in stock' : 'out of stock',
    condition: 'new',
    link: `${SITE_BASE}/${p.slug}`,
    image_link: imageUrl(p.images.hero),
    brand: p.brand || 'Smartify',
    product_type: Array.isArray(p.category) ? p.category[0] : p.category,
  };
}

export async function buildBatch(products, availabilityBody) {
  const enabled = products.filter(p => p.enabled);
  if (enabled.length === 0 || enabled.length > 60 ||
      enabled.some(p => !/^[A-Za-z0-9_-]{1,40}$/.test(p.sku)) ||
      new Set(enabled.map(p => p.sku)).size !== enabled.length) {
    throw new Error('Expected 1–60 unique active catalog SKUs');
  }
  const inventory = availabilityBody?.inventory;
  if (inventory?.state !== 'fresh' ||
      !Number.isFinite(Date.parse(inventory.fresh_until)) ||
      Date.parse(inventory.fresh_until) <= Date.now()) {
    throw new Error('Commerce did not provide fresh inventory');
  }
  return enabled.map(p => mapProduct(p, availabilityBody.items?.[p.sku]));
}

async function getAvailability(products) {
  const skus = products.filter(p => p.enabled).map(p => p.sku);
  if (skus.length === 0 || skus.length > 60 ||
      skus.some(sku => !/^[A-Za-z0-9_-]{1,40}$/.test(sku))) {
    throw new Error('Expected 1–60 active catalog SKUs');
  }
  const url = new URL('/api/commerce/availability', COMMERCE_BASE_URL);
  url.searchParams.set('skus', skus.join(','));
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Commerce availability request failed (HTTP ${res.status})`);
  return res.json();
}

async function graphRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, ...options.headers },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  if (!res.ok || body?.error) {
    throw new Error(`Meta catalog API request failed (HTTP ${res.status})`);
  }
  return body;
}

export function assertNoRejections(body) {
  const validation = body?.validation_status;
  const rejected = Array.isArray(validation) && validation.some(item =>
    ['error', 'rejected'].includes(String(item?.status).toLowerCase()) ||
    (Array.isArray(item?.errors) && item.errors.length > 0));
  if (rejected) {
    throw new Error('Meta catalog rejected one or more items; inspect Commerce Manager');
  }
}

export function parseBatchStatus(body) {
  if (!Array.isArray(body?.data) || body.data.length !== 1 || !body.data[0] ||
      typeof body.data[0] !== 'object') {
    throw new Error('Meta catalog batch status response lacks one status row');
  }
  const row = body.data[0];
  const status = String(row.status || '').toLowerCase().replace(/[ _-]+/g, '');
  if (Array.isArray(row.errors) && row.errors.length > 0) {
    throw new Error('Meta catalog rejected one or more items; inspect Commerce Manager');
  }
  if (status === 'failed' || status === 'error') throw new Error('Meta catalog batch failed');
  if (status === 'finished' || status === 'completed') {
    if (row.errors_total_count == null || !Number.isSafeInteger(Number(row.errors_total_count)) ||
        Number(row.errors_total_count) < 0) {
      throw new Error('Meta catalog batch did not report a rejection count');
    }
    if (Number(row.errors_total_count) > 0) {
      throw new Error('Meta catalog rejected one or more items; inspect Commerce Manager');
    }
    return 'finished';
  }
  if (['pending', 'processing', 'inprogress', 'started', 'running'].includes(status)) return 'pending';
  throw new Error('Meta catalog returned an unknown batch status');
}

export function buildMetaRequest(products) {
  return {
    allow_upsert: true,
    item_type: 'PRODUCT_ITEM',
    requests: products.map(({ retailer_id, ...data }) => ({
      method: 'UPDATE',
      data: { id: retailer_id, ...data },
    })),
  };
}

export function encodeMetaRequest(body) {
  return new URLSearchParams({
    allow_upsert: String(body.allow_upsert),
    item_type: body.item_type,
    requests: JSON.stringify(body.requests),
  });
}

async function push(products) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(CATALOG_ID)}/items_batch`;
  const body = buildMetaRequest(products);

  console.log(`\nPOSTing ${body.requests.length} products to catalog ${CATALOG_ID}...`);

  const result = await graphRequest(url, {
    method: 'POST',
    body: encodeMetaRequest(body),
  });
  assertNoRejections(result);
  const handles = result.handles;
  if (!Array.isArray(handles) || handles.length === 0) {
    throw new Error('Meta catalog did not return a batch handle');
  }
  for (const handle of handles) {
    let finished = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 5000));
      const statusUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(CATALOG_ID)}/check_batch_request_status`);
      statusUrl.searchParams.set('handle', handle);
      statusUrl.searchParams.set('fields', 'status,errors_total_count');
      const status = await graphRequest(statusUrl);
      if (parseBatchStatus(status) === 'finished') {
        finished = true;
        break;
      }
    }
    if (!finished) throw new Error('Meta catalog batch status did not finish in time');
  }
  return { handles, itemCount: body.requests.length };
}

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8');
  const allProducts = JSON.parse(raw);
  const enabled = allProducts.filter(p => p.enabled);

  console.log(`Loaded ${enabled.length} enabled products from products.json`);

  const availabilityBody = await getAvailability(enabled);
  const mapped = await buildBatch(enabled, availabilityBody);

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
  console.log('Success:', JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Catalog sync aborted: ${error.message}`);
    process.exitCode = 1;
  });
}

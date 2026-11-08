#!/usr/bin/env node
/**
 * Writes the Meta catalog feed (CSV) used for the WhatsApp Business catalog.
 *
 *   node scripts/build-whatsapp-feed.mjs                  # → dist/whatsapp-catalog-feed.csv
 *   node scripts/build-whatsapp-feed.mjs --verify-images  # also HEAD-checks every image_link
 *   WA_FEED_IMAGE_BASE=https://… node scripts/build-whatsapp-feed.mjs
 *
 * Upload the CSV in Commerce Manager → Catalog → Data sources → Data feed (see docs/whatsapp-catalog.md).
 * No Meta credentials are used or needed here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeed, toCsv, DEFAULT_IMAGE_BASE } from './lib/whatsapp-feed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verifyImages = args.includes('--verify-images');
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(ROOT, 'dist', 'whatsapp-catalog-feed.csv');

const products = JSON.parse(readFileSync(join(ROOT, 'products.json'), 'utf8'));
const { rows, skipped } = buildFeed(products, { imageBase: process.env.WA_FEED_IMAGE_BASE || DEFAULT_IMAGE_BASE });

if (verifyImages) {
  const bad = [];
  for (const row of rows) {
    const res = await fetch(row.image_link, { method: 'HEAD' }).catch(() => null);
    const type = res?.headers.get('content-type') || '';
    const bytes = Number(res?.headers.get('content-length') || 0);
    if (!res?.ok || !/^image\/(png|jpeg)$/.test(type) || bytes > 8 * 1024 * 1024) bad.push(`${row.id} ${row.image_link} (${res?.status ?? 'no response'}, ${type}, ${bytes} bytes)`);
  }
  if (bad.length) {
    console.error(`Image check failed for ${bad.length} product(s):\n${bad.join('\n')}`);
    process.exit(1);
  }
  console.log(`All ${rows.length} images answered 200 as PNG or JPEG under 8 MB.`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toCsv(rows));
console.log(`Wrote ${rows.length} products to ${out}`);
for (const s of skipped) console.log(`  skipped ${s.sku} ${s.name}: ${s.reason}`);

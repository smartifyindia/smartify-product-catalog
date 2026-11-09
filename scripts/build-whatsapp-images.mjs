#!/usr/bin/env node
/**
 * Resizes every feed product's hero photo to a 1200x1200 JPEG named <sku>.jpg in dist/whatsapp-images/.
 * Meta rejects catalog images over 8 MB and several repo masters are 12-21 MB 4320 px PNGs. Transparent
 * backgrounds are flattened onto white. Upload the folder to the R2 prefix the feed points at (docs/whatsapp-catalog.md).
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildFeed, IMAGE_SOURCES } from './lib/whatsapp-feed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'whatsapp-images');
const SIZE = 1200;

const products = JSON.parse(readFileSync(join(ROOT, 'products.json'), 'utf8'));
const included = new Set(buildFeed(products).rows.map((r) => r.id));
mkdirSync(OUT, { recursive: true });

let done = 0;
for (const p of products.filter((x) => included.has(String(x.sku)))) {
  const remote = IMAGE_SOURCES[p.sku];
  let src = resolve(ROOT, 'products', p.slug, p.images.hero);
  if (remote) {
    const res = await fetch(remote);
    if (!res.ok) throw new Error(`SKU ${p.sku}: could not download ${remote} (${res.status})`);
    src = Buffer.from(await res.arrayBuffer());
  } else if (!existsSync(src)) throw new Error(`SKU ${p.sku}: hero image missing at ${src}`);
  const dest = join(OUT, `${p.sku}.jpg`);
  await sharp(src)
    .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(dest);
  done += 1;
  const kb = Math.round(statSync(dest).size / 1024);
  if (kb > 2048) console.warn(`  ${p.sku} is ${kb} KB, larger than expected`);
}
console.log(`Wrote ${done} images to ${OUT}`);

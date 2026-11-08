import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFeed, toCsv, priceOf, COLUMNS } from '../scripts/lib/whatsapp-feed.mjs';

const product = (over = {}) => ({
  sku: '1001', slug: 'tac-1', name: 'TAC 1', brand: 'Smartify', enabled: true,
  device_type: 'Smart Switch', protocol: 'Zigbee 3.0', category: ['Smart Switches'],
  description: { consumer: 'One touch.\n\nOne room.', technical: 'Tech' },
  pricing: { srp_inr: 21900 }, images: { hero: '../../images/TAC 1 Gang - White.png' },
  ...over,
});

test('price is the SRP in Meta format, rupees with two decimals', () => {
  assert.equal(priceOf(21900), '21900.00 INR');
  assert.equal(priceOf(0), null);
  assert.equal(priceOf(undefined), null);
});

test('a row carries the SKU as id, the product page link and an image link named by SKU', () => {
  const { rows } = buildFeed([product()], { imageBase: 'https://img.test/p' });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { id: rows[0].id, price: rows[0].price, link: rows[0].link, image_link: rows[0].image_link, availability: rows[0].availability, brand: rows[0].brand },
    { id: '1001', price: '21900.00 INR', link: 'https://smartify.in/product/tac-1/', image_link: 'https://img.test/p/1001.jpg', availability: 'in stock', brand: 'Smartify' });
  assert.equal(rows[0].title, 'TAC 1 – Smart Switch');
  assert.equal(rows[0].description, 'One touch.\n\nOne room.\n\nSmart Switch · Zigbee 3.0.');
});

test('disabled, unpriced and photography-pending products are skipped with a reason', () => {
  const { rows, skipped } = buildFeed([
    product({ sku: 'a', enabled: false }),
    product({ sku: 'b', pricing: {} }),
    product({ sku: 'c', images: { hero: '../../images/placeholder-photography-pending.png' } }),
    product({ sku: 'd' }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['d']);
  assert.deepEqual(skipped.map((s) => s.sku), ['a', 'b', 'c']);
  assert.match(skipped[2].reason, /photography pending/);
});

test('supplier name and made-to-order wording stop the build', () => {
  assert.throws(() => buildFeed([product({ description: { consumer: 'Built by Youtomatic' } })]), /banned wording/);
  assert.throws(() => buildFeed([product({ name: 'Made to order switch' })]), /banned wording/);
});

test('a duplicate SKU stops the build', () => {
  assert.throws(() => buildFeed([product(), product({ slug: 'other' })]), /duplicate SKU/);
});

test('CSV quotes commas, quotes and newlines', () => {
  const { rows } = buildFeed([product({ description: { consumer: 'Say "hi", then\nleave' } })]);
  const csv = toCsv(rows);
  assert.ok(csv.startsWith(`${COLUMNS.join(',')}\n`));
  assert.ok(csv.includes('"Say ""hi"", then\nleave'));
});

test('the committed catalog yields a feed: every row valid, SKUs unique, no placeholder photos', () => {
  const products = JSON.parse(readFileSync(new URL('../products.json', import.meta.url), 'utf8'));
  const { rows, skipped } = buildFeed(products);
  assert.equal(rows.length + skipped.length, products.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) {
    assert.match(r.price, /^\d+\.00 INR$/);
    assert.match(r.link, /^https:\/\/smartify\.in\/product\/[a-z0-9-]+\/$/);
    assert.match(r.image_link, /^https:\/\/.+\/\d+\.jpg$/);
    assert.ok(r.title.length <= 150 && r.description.length <= 5000);
  }
  assert.ok(skipped.every((s) => /photography pending/.test(s.reason)), JSON.stringify(skipped));
});

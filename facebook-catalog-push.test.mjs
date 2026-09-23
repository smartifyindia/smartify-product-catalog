import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapProduct, buildBatch, assertNoRejections } from './facebook-catalog-push.js';

const product = {
  sku: '38687599521', slug: 'zigbee-motion-sensor-plus-lux-sensor',
  name: 'Zigbee Motion Sensor + LUX Sensor', enabled: true,
  pricing: { srp_inr: 5700 }, images: { hero: 'motion.png' },
};

const freshBody = (items) => ({
  inventory: { state: 'fresh', fresh_until: '2099-01-01T00:00:00Z' },
  items,
});

test('Meta availability follows verified quantity and purchasability', () => {
  assert.equal(mapProduct(product, { availability_state: 'verified', quantity: 0, purchasable: true }).availability, 'out of stock');
  assert.equal(mapProduct(product, { availability_state: 'verified', quantity: 2, purchasable: true }).availability, 'in stock');
  assert.equal(mapProduct(product, { availability_state: 'verified', quantity: 2, purchasable: false }).availability, 'out of stock');
  assert.equal(mapProduct(product, { availability_state: 'verified', quantity: 2, purchasable: true }).retailer_id, product.sku);
});

test('stale or expired inventory aborts the whole batch', async () => {
  const items = { [product.sku]: { availability_state: 'verified', quantity: 2, purchasable: true } };
  await assert.rejects(() => buildBatch([product], { inventory: { state: 'stale', fresh_until: '2099-01-01T00:00:00Z' }, items }), /fresh inventory/);
  await assert.rejects(() => buildBatch([product], { inventory: { state: 'fresh', fresh_until: '2000-01-01T00:00:00Z' }, items }), /fresh inventory/);
});

test('missing SKU or unverified stock aborts instead of guessing', async () => {
  await assert.rejects(() => buildBatch([product], freshBody({})), /verified.*38687599521/);
  await assert.rejects(() => buildBatch([product], freshBody({ [product.sku]: { availability_state: 'unknown', quantity: 2, purchasable: true } })), /verified.*38687599521/);
  await assert.rejects(() => buildBatch([product], freshBody({ [product.sku]: { availability_state: 'verified', purchasable: true } })), /verified.*38687599521/);
});

test('batch contains only the 47 enabled catalog SKUs, never a legacy listing', async () => {
  const products = JSON.parse(readFileSync(new URL('./products.json', import.meta.url), 'utf8'));
  const active = products.filter(p => p.enabled);
  assert.equal(active.length, 47);
  const items = Object.fromEntries(active.map(p => [p.sku, { availability_state: 'verified', quantity: 1, purchasable: true }]));
  const mapped = await buildBatch([...products, { ...product, sku: 'legacy:fibaro-motion-sensor', enabled: false }], freshBody(items));
  assert.deepEqual(mapped.map(p => p.retailer_id).sort(), active.map(p => p.sku).sort());
});

test('Meta validation and processed batch errors fail the sync', () => {
  assert.throws(() => assertNoRejections({ validation_status: [{ status: 'error', retailer_id: product.sku }] }), /rejected/);
  assert.throws(() => assertNoRejections({ status: 'finished', errors_total_count: 1 }), /rejected/);
  assert.doesNotThrow(() => assertNoRejections({ status: 'finished', errors_total_count: 0 }));
});

test('batch status must report a numeric rejection count before success', () => {
  assert.throws(() => assertNoRejections({ status: 'finished' }), /rejection count/);
  assert.throws(() => assertNoRejections({ status: 'finished', errors_total_count: 'not-a-count' }), /rejection count/);
});

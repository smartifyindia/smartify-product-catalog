import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapProduct, buildBatch, buildMetaRequest, encodeMetaRequest, assertNoRejections, parseBatchStatus } from './facebook-catalog-push.js';

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

test('items_batch product fields use major-unit price and endpoint names', () => {
  const mapped = mapProduct(product, { availability_state: 'verified', quantity: 1, purchasable: true });
  assert.equal(mapped.price, '5700 INR');
  assert.equal(mapped.title, product.name);
  assert.equal(mapped.link, 'https://smartify.in/product/zigbee-motion-sensor-plus-lux-sensor');
  assert.match(mapped.image_link, /motion\.png$/);
  assert.equal(mapped.currency, undefined);
});

test('items_batch request keeps SKU as data.id and sets PRODUCT_ITEM', () => {
  const mapped = mapProduct(product, { availability_state: 'verified', quantity: 1, purchasable: true });
  const body = buildMetaRequest([mapped]);
  assert.equal(body.item_type, 'PRODUCT_ITEM');
  assert.equal(body.requests[0].method, 'UPDATE');
  assert.equal(body.requests[0].data.id, product.sku);
  assert.equal(body.requests[0].retailer_id, undefined);
  assert.equal(body.requests[0].data.retailer_id, undefined);
});

test('items_batch sends requests as a JSON string in form fields', () => {
  const body = buildMetaRequest([mapProduct(product, { availability_state: 'verified', quantity: 1, purchasable: true })]);
  const encoded = encodeMetaRequest(body);
  assert.equal(encoded.get('item_type'), 'PRODUCT_ITEM');
  assert.equal(encoded.get('allow_upsert'), 'true');
  assert.equal(JSON.parse(encoded.get('requests'))[0].data.price, '5700 INR');
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

test('Meta immediate validation errors fail the sync', () => {
  assert.throws(() => assertNoRejections({ validation_status: [{ status: 'error', retailer_id: product.sku }] }), /rejected/);
  assert.throws(() => assertNoRejections({ validation_status: [{ retailer_id: product.sku, errors: [{ message: 'bad price' }] }] }), /rejected/);
});

test('Meta status edge reports pending and finished rows inside data', () => {
  assert.equal(parseBatchStatus({ data: [{ status: 'In Progress' }] }), 'pending');
  assert.equal(parseBatchStatus({ data: [{ status: 'Finished', errors_total_count: 0 }] }), 'finished');
});

test('Meta status edge rejects nested item failures and malformed completion', () => {
  assert.throws(() => parseBatchStatus({ data: [{ status: 'Finished', errors_total_count: 1 }] }), /rejected/);
  assert.throws(() => parseBatchStatus({ data: [{ status: 'Finished' }] }), /rejection count/);
  assert.throws(() => parseBatchStatus({ data: [{ status: 'failed', errors_total_count: 0 }] }), /failed/);
  assert.throws(() => parseBatchStatus({ data: [] }), /status row/);
  assert.throws(() => parseBatchStatus({ status: 'Finished', errors_total_count: 0 }), /status row/);
});

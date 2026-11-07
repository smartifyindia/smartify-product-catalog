import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, CatalogSchemaError } from '../scripts/lib/catalog-schema.mjs';

// Node's built-in assert.throws() does not return the thrown error (unlike
// chai/jest), so tests that need to inspect .problems capture it manually.
function captureThrow(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected function to throw');
}

const valid = (over = {}) => ({
  sku: 'SKU-1',
  name: 'Zigbee Relay',
  slug: 'zigbee-relay',
  brand: 'Smartify',
  category: 'Retrofit',
  description: 'A relay.',
  images: ['relay.jpg'],
  ...over,
});

test('a valid catalog passes', () => {
  assert.doesNotThrow(() => validateCatalog([valid()]));
});

test('a non-array input is rejected', () => {
  assert.throws(() => validateCatalog({}), CatalogSchemaError);
});

test('an empty catalog is rejected', () => {
  assert.throws(() => validateCatalog([]), CatalogSchemaError);
});

test('a missing required field is reported with its slug', () => {
  const error = captureThrow(() => validateCatalog([valid({ brand: undefined })]));
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /zigbee-relay.*brand/);
});

test('duplicate slugs are rejected', () => {
  const error = captureThrow(() => validateCatalog([valid(), valid()]));
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /duplicate slug/i);
});

test('an image on the dead WordPress host is rejected', () => {
  const error = captureThrow(() =>
    validateCatalog([valid({ images: ['https://smartify.in/wp-content/x.jpg'] })])
  );
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /wp-content/);
});

test('dealer pricing is rejected — this catalog is public', () => {
  const error = captureThrow(() =>
    validateCatalog([valid({ pricing: { srp_inr: 100, dealer_price_inr: 60 } })])
  );
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /dealer/i);
});

test('srp-only pricing is fine', () => {
  assert.doesNotThrow(() =>
    validateCatalog([valid({ pricing: { srp_inr: 100, gst_rate: '18', hsn: '85365090' } })])
  );
});

test('nested dealer pricing is rejected', () => {
  const error = captureThrow(() =>
    validateCatalog([valid({ pricing: { tiers: { dealer_price_inr: 100 } } })])
  );
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /dealer/i);
});

test('an empty images object counts as a missing required field', () => {
  const error = captureThrow(() => validateCatalog([valid({ images: {} })]));
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /zigbee-relay.*images/);
});

test('an empty description object counts as a missing required field', () => {
  const error = captureThrow(() => validateCatalog([valid({ description: {} })]));
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /zigbee-relay.*description/);
});

test('unknown pricing keys are rejected (allowlist)', () => {
  const error = captureThrow(() =>
    validateCatalog([valid({ pricing: { srp_inr: 100, mrp_inr: 120 } })])
  );
  assert.ok(error instanceof CatalogSchemaError);
  assert.match(error.problems.join(' '), /pricing\.mrp_inr/);
});

test('dealer-like keys are rejected anywhere in the record', () => {
  for (const key of ['Dealer', 'DP', 'dp', 'wholesale_price', 'cost_price_inr', 'Margin_pct']) {
    const error = captureThrow(() =>
      validateCatalog([valid({ specs: { nested: [{ [key]: 1 }] } })])
    );
    assert.ok(error instanceof CatalogSchemaError, key);
    assert.match(error.problems.join(' '), new RegExp(`"${key}"`));
  }
});

test('pricing.srp_inr must be a positive finite number', () => {
  for (const srp of [0, -5, NaN, Infinity, '100', null, undefined]) {
    const error = captureThrow(() => validateCatalog([valid({ pricing: { srp_inr: srp } })]));
    assert.match(error.problems.join(' '), /srp_inr must be a positive finite number/);
  }
  assert.doesNotThrow(() => validateCatalog([valid({ pricing: { srp_inr: 0.5 } })]));
});

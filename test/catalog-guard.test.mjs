import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffCatalogs,
  assertNoDataLoss,
  CatalogDataLossError,
} from '../scripts/lib/catalog-guard.mjs';

const record = (slug, over = {}) => ({
  slug,
  sku: `SKU-${slug}`,
  description: 'A description',
  images: ['a.jpg'],
  pricing: { srp_inr: 100 },
  ...over,
});

test('identical catalogs report no loss', () => {
  const a = [record('one'), record('two')];
  assert.deepEqual(diffCatalogs(a, a), {
    removedSlugs: [],
    countDelta: 0,
    emptiedFields: [],
  });
  assert.doesNotThrow(() => assertNoDataLoss(a, a));
});

test('additions are allowed', () => {
  const before = [record('one')];
  const after = [record('one'), record('two')];
  assert.equal(diffCatalogs(before, after).countDelta, 1);
  assert.doesNotThrow(() => assertNoDataLoss(before, after));
});

test('a removed slug is reported and blocks the write', () => {
  const before = [record('one'), record('two')];
  const after = [record('one')];
  assert.deepEqual(diffCatalogs(before, after).removedSlugs, ['two']);
  assert.throws(() => assertNoDataLoss(before, after), CatalogDataLossError);
});

test('emptying a guarded field blocks the write', () => {
  const before = [record('one')];
  const after = [record('one', { description: '' })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
    { slug: 'one', field: 'description' },
  ]);
  assert.throws(() => assertNoDataLoss(before, after), CatalogDataLossError);
});

test('emptying an images array counts as loss', () => {
  const before = [record('one')];
  const after = [record('one', { images: [] })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
    { slug: 'one', field: 'images' },
  ]);
});

test('a field that was already empty is not a loss', () => {
  const before = [record('one', { description: '' })];
  const after = [record('one', { description: '' })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, []);
});

test('wiping the catalog reports every slug', () => {
  const before = [record('one'), record('two'), record('three')];
  let error;
  try {
    assertNoDataLoss(before, []);
    assert.fail('expected assertNoDataLoss to throw');
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof CatalogDataLossError);
  assert.equal(error.details.removedSlugs.length, 3);
  assert.equal(error.details.countDelta, -3);
  assert.match(error.message, /3 records? would disappear/);
});

test('allowRemovals permits a deliberate removal', () => {
  const before = [record('one'), record('two')];
  const after = [record('one')];
  assert.doesNotThrow(() => assertNoDataLoss(before, after, { allowRemovals: true }));
});

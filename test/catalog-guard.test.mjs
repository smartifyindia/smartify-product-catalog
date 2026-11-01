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
    changedSkus: [],
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

test('an images container gutted to empty values counts as loss', () => {
  const full = { hero: 'a.png', all: ['a.png'], hero_url: 'a.png', all_urls: ['a.png'] };
  const gutted = { hero: '', all: [], hero_url: '', all_urls: [] };
  const before = [record('one', { images: full })];
  const after = [record('one', { images: gutted })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
    { slug: 'one', field: 'images' },
  ]);
});

test('a populated images container is not a loss', () => {
  const full = { hero: 'a.png', all: ['a.png'], hero_url: 'a.png', all_urls: ['a.png'] };
  const before = [record('one', { images: full })];
  assert.deepEqual(diffCatalogs(before, before).emptiedFields, []);
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

test('allowRemovals still refuses to empty a field on a surviving record', () => {
  const before = [record('one'), record('two')];
  const after = [record('one', { description: '' })];
  assert.throws(
    () => assertNoDataLoss(before, after, { allowRemovals: true }),
    CatalogDataLossError
  );
});

test('allowRemovals permits a deliberate removal', () => {
  const before = [record('one'), record('two')];
  const after = [record('one')];
  assert.doesNotThrow(() => assertNoDataLoss(before, after, { allowRemovals: true }));
});

test('pricing.srp_inr going null counts as emptied, even with other keys left', () => {
  const before = [record('one', { pricing: { srp_inr: 100, gst_rate: '18' } })];
  for (const srp of [null, '', undefined]) {
    const after = [record('one', { pricing: { srp_inr: srp, gst_rate: '18' } })];
    assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
      { slug: 'one', field: 'pricing.srp_inr' },
    ]);
  }
  const missing = [record('one', { pricing: { gst_rate: '18' } })];
  assert.equal(diffCatalogs(before, missing).emptiedFields.length, 1);
});

test('a changed sku on an existing slug is reported and blocks the write', () => {
  const before = [record('one')];
  const after = [record('one', { sku: 'SKU-other' })];
  assert.deepEqual(diffCatalogs(before, after).changedSkus, [
    { slug: 'one', from: 'SKU-one', to: 'SKU-other' },
  ]);
  assert.throws(() => assertNoDataLoss(before, after), CatalogDataLossError);
});

test('--allow-removals does not suppress srp or sku checks', () => {
  const before = [record('one'), record('two')];
  const srpGone = [record('one', { pricing: { srp_inr: null } })];
  assert.throws(
    () => assertNoDataLoss(before, srpGone, { allowRemovals: true }),
    /pricing/
  );
  const skuChanged = [record('one', { sku: 'NEW' }), record('two')];
  assert.throws(
    () => assertNoDataLoss(before, skuChanged, { allowRemovals: true }),
    /SKU/
  );
});

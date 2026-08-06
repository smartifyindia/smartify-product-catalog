import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCatalogHealthy } from '../scripts/verify-catalog.mjs';
import { writeProvenance } from '../scripts/lib/provenance.mjs';

const record = (slug) => ({
  sku: `SKU-${slug}`,
  name: slug,
  slug,
  brand: 'Smartify',
  category: 'Retrofit',
  description: 'desc',
  images: ['a.jpg'],
});

const fixture = (records, { withProvenance = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  const artifact = join(dir, 'products.json');
  writeFileSync(artifact, JSON.stringify(records));
  if (withProvenance) {
    writeProvenance({ artifactPath: artifact, generator: 'test', records: records.length });
  }
  return artifact;
};

test('a healthy catalog passes', () => {
  assert.doesNotThrow(() => assertCatalogHealthy(fixture([record('one')])));
});

test('an invalid record is caught', () => {
  const bad = { ...record('one'), brand: '' };
  assert.throws(() => assertCatalogHealthy(fixture([bad])));
});

test('a missing provenance sidecar is caught', () => {
  assert.throws(() => assertCatalogHealthy(fixture([record('one')], { withProvenance: false })));
});

test('an empty catalog is caught', () => {
  assert.throws(() => assertCatalogHealthy(fixture([])));
});

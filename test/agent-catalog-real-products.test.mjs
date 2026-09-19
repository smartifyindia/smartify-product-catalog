import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgentCatalog, serializeAgentCatalog } from '../scripts/lib/agent-catalog.mjs';

// Mirrors the read pattern in scripts/publish-agent-catalog.mjs: read every
// products/<slug>/product.json from disk, exactly as the real build does.
function loadRealProducts() {
  const productsDir = new URL('../products', import.meta.url).pathname;
  return readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(productsDir, entry.name, 'product.json');
      return JSON.parse(readFileSync(path, 'utf8'));
    });
}

test('buildAgentCatalog succeeds against every real product.json in products/', () => {
  const products = loadRealProducts();

  let artifact;
  assert.doesNotThrow(() => {
    artifact = buildAgentCatalog(products);
  });

  assert.equal(artifact.products.length, 47);

  for (const product of artifact.products) {
    assert.ok(
      Array.isArray(product.aliases) && product.aliases.length > 0,
      `${product.sku} (${product.slug}) must have a non-empty aliases array`
    );
    assert.ok(
      Array.isArray(product.approved_facts) && product.approved_facts.length > 0,
      `${product.sku} (${product.slug}) must have a non-empty approved_facts array`
    );

    for (const fact of product.approved_facts) {
      assert.ok(
        !fact.path.startsWith('pricing.'),
        `${product.slug}: approved fact path "${fact.path}" must not expose pricing`
      );
      assert.ok(
        !fact.path.startsWith('images.'),
        `${product.slug}: approved fact path "${fact.path}" must not expose images`
      );
      assert.ok(
        !fact.path.startsWith('description.'),
        `${product.slug}: approved fact path "${fact.path}" must not expose description`
      );
    }
  }
});

test('buildAgentCatalog + serializeAgentCatalog is deterministic against real product data', () => {
  const products = loadRealProducts();

  const first = buildAgentCatalog(products);
  const second = buildAgentCatalog(products);

  const firstBytes = serializeAgentCatalog(first);
  const secondBytes = serializeAgentCatalog(second);

  assert.doesNotThrow(() => JSON.parse(firstBytes), 'serialized artifact must be valid JSON');
  assert.doesNotThrow(() => JSON.parse(secondBytes), 'serialized artifact must be valid JSON');

  const firstHash = createHash('sha256').update(firstBytes).digest('hex');
  const secondHash = createHash('sha256').update(secondBytes).digest('hex');
  assert.equal(firstHash, secondHash, 'hash must be stable across two consecutive builds');
});

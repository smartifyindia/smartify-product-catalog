import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadBuilder() {
  try {
    return await import('../scripts/lib/agent-catalog.mjs');
  } catch (error) {
    assert.fail(`agent catalog builder is unavailable: ${error.message}`);
  }
}

function product(overrides = {}) {
  return {
    sku: 'SW-TAC-1',
    name: 'TAC 1',
    slug: 'tac-1',
    protocol: 'Zigbee',
    specs: { compatibility: 'Zigbee 3.0', channels: '1' },
    pricing: { srp_inr: 4999, gst_rate: '18' },
    agent: {
      aliases: ['one gang touch switch', 'tac one'],
      approved_fact_paths: ['name', 'protocol', 'specs.compatibility', 'pricing.srp_inr'],
    },
    ...overrides,
  };
}

test('buildAgentCatalog emits stable aliases and addressable approved facts', async () => {
  const { buildAgentCatalog } = await loadBuilder();

  const artifact = buildAgentCatalog([product()]);

  assert.equal(artifact.schema_version, 'smartify.agent-catalog.v1');
  assert.equal('catalog_hash' in artifact, false, 'content cannot contain its own byte hash');
  assert.deepEqual(artifact.products[0].aliases, ['one gang touch switch', 'tac one']);
  assert.deepEqual(artifact.products[0].approved_facts, [
    { fact_id: 'SW-TAC-1:name', path: 'name', value: 'TAC 1' },
    { fact_id: 'SW-TAC-1:protocol', path: 'protocol', value: 'Zigbee' },
    { fact_id: 'SW-TAC-1:specs.compatibility', path: 'specs.compatibility', value: 'Zigbee 3.0' },
    { fact_id: 'SW-TAC-1:pricing.srp_inr', path: 'pricing.srp_inr', value: 4999 },
  ]);
});

test('buildAgentCatalog is byte-deterministic and changes hash when an approved fact changes', async () => {
  const { buildAgentCatalog, serializeAgentCatalog } = await loadBuilder();

  const first = buildAgentCatalog([product()]);
  const same = buildAgentCatalog([product()]);
  const changed = buildAgentCatalog([
    product({ specs: { compatibility: 'Zigbee 3.0', channels: '2' }, agent: {
      aliases: ['one gang touch switch', 'tac one'],
      approved_fact_paths: ['name', 'protocol', 'specs.channels', 'pricing.srp_inr'],
    } }),
  ]);

  assert.equal(serializeAgentCatalog(first), serializeAgentCatalog(same));
  assert.notEqual(serializeAgentCatalog(changed), serializeAgentCatalog(first));
});

test('buildAgentCatalog fails closed when approved metadata points at a missing fact', async () => {
  const { buildAgentCatalog } = await loadBuilder();
  const invalid = product({
    agent: { aliases: ['tac one'], approved_fact_paths: ['specs.nonexistent'] },
  });

  assert.throws(() => buildAgentCatalog([invalid]), /SW-TAC-1.*specs\.nonexistent.*missing/i);
});

test('buildAgentCatalog refuses sensitive pricing paths even when source metadata requests them', async () => {
  const { buildAgentCatalog } = await loadBuilder();
  const invalid = product({
    pricing: { srp_inr: 4999, dealer_price_inr: 2500 },
    agent: { aliases: ['tac one'], approved_fact_paths: ['pricing.dealer_price_inr'] },
  });

  assert.throws(() => buildAgentCatalog([invalid]), /dealer_price_inr.*not allowed/i);
});

test('publish-agent-catalog --target local writes an immutable object and a versioned current pointer', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-catalog-fixture-'));
  const sourceDir = join(root, 'products', 'tac-1');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'product.json'), `${JSON.stringify(product(), null, 2)}\n`);

  execFileSync('node', [
    new URL('../scripts/publish-agent-catalog.mjs', import.meta.url).pathname,
    '--target', 'local',
    '--root', root,
    '--created-at', '2026-09-18T12:00:00.000Z',
  ]);

  const pointer = JSON.parse(readFileSync(join(root, 'agent-catalog', 'current.json'), 'utf8'));
  assert.deepEqual(Object.keys(pointer).sort(), [
    'catalog_hash', 'catalog_version', 'created_at', 'object_key', 'schema_version',
  ]);
  assert.equal(pointer.catalog_version, 1);
  assert.equal(pointer.created_at, '2026-09-18T12:00:00.000Z');
  assert.equal(pointer.object_key, `agent-catalog/${pointer.catalog_hash}.json`);

  const artifactPath = join(root, pointer.object_key);
  const artifactBytes = readFileSync(artifactPath);
  const artifact = JSON.parse(artifactBytes.toString('utf8'));
  assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), pointer.catalog_hash);
  assert.equal('catalog_hash' in artifact, false);
  assert.equal(artifact.products[0].approved_facts[0].fact_id, 'SW-TAC-1:name');
});

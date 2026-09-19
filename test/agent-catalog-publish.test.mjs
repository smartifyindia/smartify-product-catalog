import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadPublish() {
  try {
    return await import('../scripts/lib/agent-catalog-publish.mjs');
  } catch (error) {
    assert.fail(`agent catalog publish logic is unavailable: ${error.message}`);
  }
}

// A minimal Map-backed fake store — deliberately not createLocalStore, to keep
// these tests fast and independent of the filesystem.
function createFakeStore() {
  const map = new Map();
  return {
    get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    put(key, bytes) {
      map.set(key, bytes);
    },
    keyCount() {
      return map.size;
    },
  };
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

function product2(overrides = {}) {
  return {
    sku: 'SW-TAC-2',
    name: 'TAC 2',
    slug: 'tac-2',
    protocol: 'Zigbee',
    specs: { compatibility: 'Zigbee 3.0', channels: '2' },
    pricing: { srp_inr: 5999, gst_rate: '18' },
    agent: {
      aliases: ['two gang touch switch', 'tac two'],
      approved_fact_paths: ['name', 'protocol', 'specs.compatibility', 'pricing.srp_inr'],
    },
    ...overrides,
  };
}

const CREATED_AT = '2026-09-19T00:00:00.000Z';
const LATER_CREATED_AT = '2026-09-20T00:00:00.000Z';

test('publishAgentCatalog: first publish on an empty store creates version 1', async () => {
  const { publishAgentCatalog } = await loadPublish();
  const store = createFakeStore();

  const result = publishAgentCatalog(store, [product(), product2()], { createdAt: CREATED_AT });

  assert.equal(result.published, true);
  assert.equal(result.pointer.catalog_version, 1);
  assert.equal(result.pointer.created_at, CREATED_AT);
  assert.equal(result.pointer.object_key, `agent-catalog/${result.pointer.catalog_hash}.json`);

  const currentRaw = store.get('agent-catalog/current.json');
  assert.ok(currentRaw, 'current.json must be written to the store');
  assert.deepEqual(JSON.parse(currentRaw), result.pointer);

  const objectRaw = store.get(result.pointer.object_key);
  assert.ok(objectRaw, 'the immutable object must be written to the store');
});

test('publishAgentCatalog: republishing identical products is a no-op', async () => {
  const { publishAgentCatalog } = await loadPublish();
  const store = createFakeStore();
  const products = [product(), product2()];

  const first = publishAgentCatalog(store, products, { createdAt: CREATED_AT });
  const keyCountAfterFirst = store.keyCount();

  const second = publishAgentCatalog(store, products, { createdAt: LATER_CREATED_AT });

  assert.equal(second.published, false);
  assert.equal(second.pointer.catalog_version, 1, 'version must not advance for identical content');
  assert.deepEqual(second.pointer, first.pointer);
  assert.equal(store.keyCount(), keyCountAfterFirst, 'no new keys should be written');
});

test('publishAgentCatalog: changing a product publishes a new version and keeps the old object', async () => {
  const { publishAgentCatalog } = await loadPublish();
  const store = createFakeStore();

  const first = publishAgentCatalog(store, [product(), product2()], { createdAt: CREATED_AT });
  const oldObjectKey = first.pointer.object_key;

  const changedProducts = [product({ pricing: { srp_inr: 5499, gst_rate: '18' } }), product2()];
  const second = publishAgentCatalog(store, changedProducts, { createdAt: LATER_CREATED_AT });

  assert.equal(second.published, true);
  assert.equal(second.pointer.catalog_version, 2);
  assert.notEqual(second.pointer.catalog_hash, first.pointer.catalog_hash);

  assert.ok(store.get(oldObjectKey), 'old immutable object must never be deleted');
  assert.ok(store.get(second.pointer.object_key), 'new immutable object must be present');
  assert.notEqual(second.pointer.object_key, oldObjectKey);

  const current = JSON.parse(store.get('agent-catalog/current.json'));
  assert.equal(current.object_key, second.pointer.object_key);
  assert.equal(current.catalog_version, 2);
});

test('publishAgentCatalog: does not re-upload an immutable object that already exists at that hash', async () => {
  const { publishAgentCatalog } = await loadPublish();
  const store = createFakeStore();

  const first = publishAgentCatalog(store, [product()], { createdAt: CREATED_AT });
  let putCount = 0;
  const originalPut = store.put.bind(store);
  store.put = (key, bytes) => {
    putCount += 1;
    return originalPut(key, bytes);
  };

  // Simulate a hash collision / out-of-band prior upload: the object for the
  // *new* content already exists, even though current.json doesn't know about it.
  const changed = [product({ pricing: { srp_inr: 1234, gst_rate: '18' } })];
  // Pre-compute what the new hash's object key will be by publishing once to a
  // scratch store, then seed it into the real store before publishing "for real".
  const scratch = createFakeStore();
  const scratchResult = publishAgentCatalog(scratch, changed, { createdAt: CREATED_AT });
  store.put(scratchResult.pointer.object_key, scratch.get(scratchResult.pointer.object_key));
  putCount = 0; // reset counter after seeding

  const second = publishAgentCatalog(store, changed, { createdAt: LATER_CREATED_AT });

  assert.equal(second.published, true);
  assert.equal(second.pointer.object_key, scratchResult.pointer.object_key);
  // Only current.json should have been written — the immutable object already existed.
  assert.equal(putCount, 1);
  assert.equal(first.pointer.catalog_version, 1);
});

test('publishAgentCatalog: createdAt is required', async () => {
  const { publishAgentCatalog } = await loadPublish();
  const store = createFakeStore();

  assert.throws(() => publishAgentCatalog(store, [product()], {}));
  assert.throws(() => publishAgentCatalog(store, [product()], { createdAt: undefined }));
});

test('publishAgentCatalog: pointer created_at is exactly the injected string, never Date.now()', async () => {
  const { publishAgentCatalog } = await loadPublish();
  const store = createFakeStore();

  const result = publishAgentCatalog(store, [product()], { createdAt: '2020-01-01T00:00:00.000Z' });

  assert.equal(result.pointer.created_at, '2020-01-01T00:00:00.000Z');
});

test('verifyPublishedAgentCatalog accepts a pointer and immutable object rebuilt from the same products', async () => {
  const { publishAgentCatalog, verifyPublishedAgentCatalog } = await loadPublish();
  const store = createFakeStore();
  const products = [product(), product2()];
  const published = publishAgentCatalog(store, products, { createdAt: CREATED_AT });

  const result = verifyPublishedAgentCatalog(store, products);

  assert.equal(result.catalog_hash, published.pointer.catalog_hash);
  assert.equal(result.product_count, 2);
});

test('verifyPublishedAgentCatalog rejects a deliberately stale current pointer', async () => {
  const { publishAgentCatalog, verifyPublishedAgentCatalog } = await loadPublish();
  const store = createFakeStore();
  publishAgentCatalog(store, [product(), product2()], { createdAt: CREATED_AT });

  assert.throws(
    () => verifyPublishedAgentCatalog(store, [product({ name: 'TAC 1 renamed' }), product2()]),
    /published pointer hash does not match rebuilt catalog/i,
  );
});

test('verifyPublishedAgentCatalog rejects corrupt bytes at the content-addressed object key', async () => {
  const { publishAgentCatalog, verifyPublishedAgentCatalog } = await loadPublish();
  const store = createFakeStore();
  const products = [product(), product2()];
  const published = publishAgentCatalog(store, products, { createdAt: CREATED_AT });
  store.put(published.pointer.object_key, '{"products":"corrupt"}\n');

  assert.throws(
    () => verifyPublishedAgentCatalog(store, products),
    /immutable object bytes do not match rebuilt catalog/i,
  );
});

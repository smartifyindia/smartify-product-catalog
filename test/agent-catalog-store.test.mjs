import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadStore() {
  try {
    return await import('../scripts/lib/agent-catalog-store.mjs');
  } catch (error) {
    assert.fail(`agent catalog store is unavailable: ${error.message}`);
  }
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- createLocalStore -------------------------------------------------

test('createLocalStore: get on a missing key returns null, does not throw', async () => {
  const { createLocalStore } = await loadStore();
  withTempDir((dir) => {
    const store = createLocalStore(dir);
    assert.equal(store.get('agent-catalog/current.json'), null);
  });
});

test('createLocalStore: put then get round-trips the exact bytes', async () => {
  const { createLocalStore } = await loadStore();
  withTempDir((dir) => {
    const store = createLocalStore(dir);
    store.put('agent-catalog/current.json', '{"a":1}\n');
    assert.equal(store.get('agent-catalog/current.json'), '{"a":1}\n');
  });
});

test('createLocalStore: put twice on the same key overwrites (last write wins)', async () => {
  const { createLocalStore } = await loadStore();
  withTempDir((dir) => {
    const store = createLocalStore(dir);
    store.put('agent-catalog/current.json', 'first-version');
    store.put('agent-catalog/current.json', 'second-version');
    assert.equal(store.get('agent-catalog/current.json'), 'second-version');
  });
});

test('createLocalStore: put creates the agent-catalog/ subdirectory as needed', async () => {
  const { createLocalStore } = await loadStore();
  withTempDir((dir) => {
    const store = createLocalStore(dir);
    store.put('agent-catalog/deadbeef.json', '{"products":[]}\n');
    assert.equal(
      readFileSync(join(dir, 'agent-catalog', 'deadbeef.json'), 'utf8'),
      '{"products":[]}\n'
    );
  });
});

test('createLocalStore: put writes atomically (no leftover temp file after write)', async () => {
  const { createLocalStore } = await loadStore();
  withTempDir((dir) => {
    const store = createLocalStore(dir);
    store.put('agent-catalog/current.json', '{"x":1}\n');
    const entries = readdirSync(join(dir, 'agent-catalog'));
    assert.deepEqual(entries, ['current.json']);
  });
});

// --- createR2Store ------------------------------------------------------

test('createR2Store: get returns null when the fake run reports a non-zero status', async () => {
  const { createR2Store } = await loadStore();
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return { status: 1, stdout: '' };
  };
  const store = createR2Store({ bucket: 'my-bucket', run });

  assert.equal(store.get('agent-catalog/current.json'), null);
  assert.equal(calls.length, 1);
  const argv = calls[0];
  assert.ok(argv.some((arg) => arg.includes('my-bucket')), 'argv must reference the bucket');
  assert.ok(
    argv.some((arg) => arg.includes('agent-catalog/current.json')),
    'argv must reference the key'
  );
});

test('createR2Store: get returns the fake run stdout when status is zero', async () => {
  const { createR2Store } = await loadStore();
  const run = () => ({ status: 0, stdout: '{"catalog_hash":"abc"}' });
  const store = createR2Store({ bucket: 'my-bucket', run });

  assert.equal(store.get('agent-catalog/current.json'), '{"catalog_hash":"abc"}');
});

test('createR2Store: put invokes run with the bucket, key, and a --file pointing at the exact bytes', async () => {
  const { createR2Store } = await loadStore();
  const calls = [];
  let capturedFileContents = null;
  const run = (args) => {
    calls.push(args);
    const fileIndex = args.indexOf('--file');
    assert.notEqual(fileIndex, -1, '--file flag must be present in argv');
    // Read the temp file back synchronously, before put() deletes it.
    capturedFileContents = readFileSync(args[fileIndex + 1], 'utf8');
    return { status: 0, stdout: '' };
  };
  const store = createR2Store({ bucket: 'my-bucket', run });

  store.put('agent-catalog/deadbeef.json', '{"products":[]}\n');

  assert.equal(calls.length, 1);
  const argv = calls[0];
  assert.ok(argv.some((arg) => arg.includes('my-bucket')), 'argv must reference the bucket');
  assert.ok(
    argv.some((arg) => arg.includes('agent-catalog/deadbeef.json')),
    'argv must reference the key'
  );
  assert.equal(capturedFileContents, '{"products":[]}\n');
});

test('createR2Store: put throws when the fake run reports a non-zero status', async () => {
  const { createR2Store } = await loadStore();
  const run = () => ({ status: 1, stdout: 'boom: access denied' });
  const store = createR2Store({ bucket: 'my-bucket', run });

  assert.throws(() => store.put('agent-catalog/current.json', 'x'), /boom|failed|status/i);
});

test('createR2Store: put deletes its temp file even when run throws or fails', async () => {
  const { createR2Store } = await loadStore();
  let tempPath = null;
  const run = (args) => {
    const fileIndex = args.indexOf('--file');
    tempPath = args[fileIndex + 1];
    return { status: 1, stdout: '' };
  };
  const store = createR2Store({ bucket: 'my-bucket', run });

  assert.throws(() => store.put('agent-catalog/current.json', 'x'));
  assert.ok(tempPath, 'run should have been called with a --file path');
  assert.equal(existsSync(tempPath), false, 'temp file must be cleaned up even on failure');
});

test('createR2Store: put deletes its temp file after a successful upload', async () => {
  const { createR2Store } = await loadStore();
  let tempPath = null;
  const run = (args) => {
    const fileIndex = args.indexOf('--file');
    tempPath = args[fileIndex + 1];
    return { status: 0, stdout: '' };
  };
  const store = createR2Store({ bucket: 'my-bucket', run });

  store.put('agent-catalog/current.json', 'x');

  assert.ok(tempPath);
  assert.equal(existsSync(tempPath), false);
});

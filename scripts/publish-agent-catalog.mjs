import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createLocalStore, createR2Store } from './lib/agent-catalog-store.mjs';
import { publishAgentCatalog, verifyPublishedAgentCatalog } from './lib/agent-catalog-publish.mjs';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function loadProducts(root) {
  const productsDir = join(root, 'products');
  return readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(productsDir, entry.name, 'product.json');
      if (!existsSync(path)) throw new Error(`${entry.name}: product.json is missing`);
      return JSON.parse(readFileSync(path, 'utf8'));
    });
}

function buildStore(target, root) {
  if (target === 'local') {
    // createLocalStore's keys already carry the "agent-catalog/" prefix, so
    // rootDir must be the *repo* root here — this lands files at
    // <root>/agent-catalog/....
    return createLocalStore(root);
  }

  if (target === 'r2') {
    const bucket = option('--bucket');
    if (!bucket) throw new Error('--target r2 requires --bucket <name>');
    const run = (args) => {
      const result = spawnSync('wrangler', args, { encoding: 'utf8' });
      return { stdout: result.stdout ?? '', status: result.status ?? 1 };
    };
    return createR2Store({ bucket, run });
  }

  throw new Error(`--target must be "local" or "r2" (got "${target}")`);
}

function main() {
  const root = resolve(option('--root', new URL('..', import.meta.url).pathname));
  const createdAt = option('--created-at', new Date().toISOString());
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('--created-at must be an ISO timestamp');
  const target = option('--target', 'local');

  const products = loadProducts(root);
  const store = buildStore(target, root);
  const { published, pointer } = publishAgentCatalog(store, products, { createdAt });
  verifyPublishedAgentCatalog(store, products);

  process.stdout.write(`${JSON.stringify({ published, pointer }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`publish-agent-catalog failed: ${error.message}\n`);
  process.exit(1);
}

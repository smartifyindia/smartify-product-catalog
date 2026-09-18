import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { buildAgentCatalog, serializeAgentCatalog } from './lib/agent-catalog.mjs';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const root = resolve(option('--root', new URL('..', import.meta.url).pathname));
const createdAt = option('--created-at', new Date().toISOString());
if (!Number.isFinite(Date.parse(createdAt))) throw new Error('--created-at must be an ISO timestamp');

const productsDir = join(root, 'products');
const products = readdirSync(productsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const path = join(productsDir, entry.name, 'product.json');
    if (!existsSync(path)) throw new Error(`${entry.name}: product.json is missing`);
    return JSON.parse(readFileSync(path, 'utf8'));
  });

const artifact = buildAgentCatalog(products);
const artifactBytes = serializeAgentCatalog(artifact);
const catalogHash = createHash('sha256').update(artifactBytes).digest('hex');
const outputDir = join(root, 'agent-catalog');
const objectKey = `agent-catalog/${catalogHash}.json`;
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(root, objectKey), artifactBytes);

const pointer = {
  schema_version: artifact.schema_version,
  catalog_hash: catalogHash,
  created_at: createdAt,
  object_key: objectKey,
};
const pointerTemp = join(outputDir, '.current.json.tmp');
writeFileSync(pointerTemp, `${JSON.stringify(pointer, null, 2)}\n`);
renameSync(pointerTemp, join(outputDir, 'current.json'));

process.stdout.write(`${objectKey}\n`);

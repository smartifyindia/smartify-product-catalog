#!/usr/bin/env node
/**
 * One health check, used by the ad feeds before they push anything and
 * available as a standalone command for CI.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './lib/catalog-schema.mjs';
import { verifyProvenance } from './lib/provenance.mjs';

export function assertCatalogHealthy(artifactPath) {
  verifyProvenance(artifactPath);
  validateCatalog(JSON.parse(readFileSync(artifactPath, 'utf8')));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const artifact = join(root, 'products.json');
  try {
    assertCatalogHealthy(artifact);
    console.log(`Catalog OK: ${artifact}`);
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

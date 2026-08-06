#!/usr/bin/env node
/**
 * aggregate → validate → gate → promote.
 *
 * The generator writes to a staging directory so that a failed validation or a
 * destructive diff leaves the committed catalog untouched. Nothing is promoted
 * until every gate has passed.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoDataLoss, CatalogDataLossError } from './lib/catalog-guard.mjs';
import { validateCatalog, CatalogSchemaError } from './lib/catalog-schema.mjs';
import { writeProvenance } from './lib/provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED = join(ROOT, 'products.json');
const allowRemovals = process.argv.includes('--allow-removals');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const staging = mkdtempSync(join(tmpdir(), 'catalog-build-'));
try {
  console.log('Building catalog into staging from the per-product JSON...');
  execFileSync(
    'python3',
    [join(ROOT, 'generate_catalog.py'), '--out', staging],
    { stdio: 'inherit' }
  );

  const next = readJson(join(staging, 'products.json'));
  console.log(`Staged ${next.length} records. Validating...`);
  validateCatalog(next);

  if (existsSync(COMMITTED)) {
    const previous = readJson(COMMITTED);
    assertNoDataLoss(previous, next, { allowRemovals });
    console.log(`Delta gate passed (${previous.length} → ${next.length} records).`);
  } else {
    console.log('No committed catalog yet — skipping delta gate.');
  }

  copyFileSync(join(staging, 'products.json'), COMMITTED);
  cpSync(join(staging, 'products'), join(ROOT, 'products'), { recursive: true });

  const provenance = writeProvenance({
    artifactPath: COMMITTED,
    generator: 'scripts/build-catalog.mjs',
    records: next.length,
  });
  console.log(`Promoted. ${provenance.records} records, sha256 ${provenance.sha256.slice(0, 12)}…`);
} catch (error) {
  if (error instanceof CatalogDataLossError || error instanceof CatalogSchemaError) {
    console.error(`\n${error.message}\n`);
    console.error('The committed catalog was NOT modified.');
    process.exit(1);
  }
  throw error;
} finally {
  rmSync(staging, { recursive: true, force: true });
}

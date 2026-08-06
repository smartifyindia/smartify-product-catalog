#!/usr/bin/env node
/**
 * aggregate → validate → gate → promote.
 *
 * The generator writes to a staging directory so that a failed validation or a
 * destructive diff leaves the committed catalog untouched. Nothing is promoted
 * until every gate has passed.
 *
 * --check runs the same aggregate → validate → gate pipeline but never
 * promotes: it compares the staged products.json against the committed one
 * and exits non-zero if they differ, which is how CI catches someone editing
 * products/<slug>/product.json without rebuilding.
 *
 * --root <dir> overrides which directory is treated as the repo root (default:
 * the real repo this script lives in). It exists so tests can point the whole
 * pipeline at a disposable fixture tree instead of the real catalog.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoDataLoss, CatalogDataLossError } from './lib/catalog-guard.mjs';
import { validateCatalog, CatalogSchemaError } from './lib/catalog-schema.mjs';
import { writeProvenance } from './lib/provenance.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function diffSlugs(committedRecords, stagedRecords) {
  const committedBySlug = new Map(committedRecords.map((r) => [r.slug, r]));
  const stagedBySlug = new Map(stagedRecords.map((r) => [r.slug, r]));
  const allSlugs = new Set([...committedBySlug.keys(), ...stagedBySlug.keys()]);
  const differing = [];
  for (const slug of allSlugs) {
    const a = JSON.stringify(committedBySlug.get(slug) ?? null);
    const b = JSON.stringify(stagedBySlug.get(slug) ?? null);
    if (a !== b) differing.push(slug);
  }
  return differing.sort();
}

export function runBuild({ root, allowRemovals = false, checkOnly = false } = {}) {
  const ROOT = root ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const COMMITTED = join(ROOT, 'products.json');

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

    if (checkOnly) {
      if (!existsSync(COMMITTED)) {
        console.error('No committed products.json to check against.');
        process.exitCode = 1;
        return;
      }
      const committedRaw = readFileSync(COMMITTED, 'utf8');
      const stagedRaw = readFileSync(join(staging, 'products.json'), 'utf8');
      if (committedRaw === stagedRaw) {
        console.log('products.json matches products/ — in sync.');
        return;
      }
      const differing = diffSlugs(JSON.parse(committedRaw), JSON.parse(stagedRaw));
      console.error(
        `\nproducts.json is out of sync with products/. Differing slugs:\n` +
          `  - ${differing.join('\n  - ')}\n` +
          `Run "npm run build-catalog" to regenerate products.json.\n`
      );
      process.exitCode = 1;
      return;
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
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const allowRemovals = argv.includes('--allow-removals');
  const checkOnly = argv.includes('--check');
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex !== -1 ? resolve(argv[rootIndex + 1]) : undefined;

  runBuild({ root, allowRemovals, checkOnly });
}

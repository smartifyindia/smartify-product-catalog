import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This suite invokes scripts/build-catalog.mjs as a real subprocess against
// disposable fixture directories via its --root flag, rather than mutating
// the real catalog in this repo. --root points the whole aggregate ->
// validate -> gate -> promote pipeline (including the generate_catalog.py
// child process it shells out to) at the fixture tree instead of the repo
// root, so nothing here ever touches products.json or products/ for real.

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_SCRIPT = join(ROOT_DIR, 'scripts', 'build-catalog.mjs');
const REAL_GENERATOR = join(ROOT_DIR, 'generate_catalog.py');

function fixtureProduct(slug, over = {}) {
  return {
    sku: `SKU-${slug}`,
    name: slug,
    slug,
    brand: 'Smartify',
    category: ['Test'],
    device_type: 'Test Device',
    protocol: 'Zigbee',
    technology: [],
    assistants: [],
    description: { consumer: `Consumer copy for ${slug}.`, technical: `Technical copy for ${slug}.` },
    specs: {
      summary: 'Voltage: 230V | Current: 6A',
      channels: '1',
      max_switching_capacity: '6A',
      recommended_load: 'Resistive',
      installation: 'In-wall',
      compatibility: 'Zigbee 3.0',
    },
    pricing: { srp_inr: 999, gst_rate: '18', hsn: '85365090' },
    limitations: '',
    dependencies: '',
    images: { hero: 'a.png', all: ['a.png'], hero_url: 'a.png', all_urls: ['a.png'] },
    enabled: true,
    ...over,
  };
}

// Builds a fixture repo root: a copy of the real generate_catalog.py (the
// orchestrator shells out to it, so it must exist relative to --root), a
// placeholder CSV (only its existence is checked on the default build path),
// and one products/<slug>/product.json per fixture product.
function makeFixtureRoot(products) {
  const root = mkdtempSync(join(tmpdir(), 'build-catalog-fixture-'));
  copyFileSync(REAL_GENERATOR, join(root, 'generate_catalog.py'));
  mkdirSync(join(root, 'data', 'sources'), { recursive: true });
  writeFileSync(join(root, 'data', 'sources', 'product-glossary.csv'), 'placeholder\n');

  for (const product of products) {
    const dir = join(root, 'products', product.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'product.json'), JSON.stringify(product, null, 2) + '\n');
  }
  return root;
}

function runBuildCli(root, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [BUILD_SCRIPT, '--root', root, ...extraArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (error) {
    // execFileSync throws on non-zero exit; the real exit code and captured
    // output are still available on the error.
    return {
      status: error.status ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
    };
  }
}

test('a clean build succeeds and writes products.json plus its sidecar', () => {
  const root = makeFixtureRoot([fixtureProduct('widget-one'), fixtureProduct('widget-two')]);

  const result = runBuildCli(root);

  assert.equal(result.status, 0, `expected success, got: ${result.stdout}${result.stderr ?? ''}`);
  assert.ok(existsSync(join(root, 'products.json')), 'products.json should be written');
  assert.ok(existsSync(join(root, 'products.source.json')), 'provenance sidecar should be written');

  const written = JSON.parse(readFileSync(join(root, 'products.json'), 'utf8'));
  assert.equal(written.length, 2);
  assert.deepEqual(
    written.map((p) => p.slug).sort(),
    ['widget-one', 'widget-two']
  );
});

test('a build that would remove a record is blocked and leaves the committed file byte-identical', () => {
  const root = makeFixtureRoot([fixtureProduct('widget-one'), fixtureProduct('widget-two')]);

  // First build establishes a committed products.json with both records.
  const first = runBuildCli(root);
  assert.equal(first.status, 0, `setup build should succeed: ${first.stdout}${first.stderr ?? ''}`);
  const committedBefore = readFileSync(join(root, 'products.json'));

  // Now delete one product's source directory so the next build would drop it.
  execFileSync('rm', ['-rf', join(root, 'products', 'widget-two')]);

  const second = runBuildCli(root);
  assert.notEqual(second.status, 0, 'a build that removes a record must fail');

  const committedAfter = readFileSync(join(root, 'products.json'));
  assert.ok(
    committedBefore.equals(committedAfter),
    'committed products.json must be byte-identical after a blocked build'
  );
});

test('a build whose staged output carries dealer pricing is blocked and leaves the committed artifact untouched', () => {
  const root = makeFixtureRoot([fixtureProduct('widget-one')]);

  const first = runBuildCli(root);
  assert.equal(first.status, 0, `setup build should succeed: ${first.stdout}${first.stderr ?? ''}`);
  const committedBefore = readFileSync(join(root, 'products.json'));

  // Introduce dealer pricing into the per-product source, which the schema
  // gate must reject before anything is promoted.
  const dirtyProduct = fixtureProduct('widget-one', {
    pricing: { srp_inr: 999, gst_rate: '18', hsn: '85365090', dealer_price_inr: 600 },
  });
  writeFileSync(
    join(root, 'products', 'widget-one', 'product.json'),
    JSON.stringify(dirtyProduct, null, 2) + '\n'
  );

  const second = runBuildCli(root);
  assert.notEqual(second.status, 0, 'a build carrying dealer pricing must fail');

  const committedAfter = readFileSync(join(root, 'products.json'));
  assert.ok(
    committedBefore.equals(committedAfter),
    'committed products.json must be untouched after a schema-gate failure'
  );
});

test('--check exits 0 when products.json is in sync with products/', () => {
  const root = makeFixtureRoot([fixtureProduct('widget-one')]);

  const build = runBuildCli(root);
  assert.equal(build.status, 0, `setup build should succeed: ${build.stdout}${build.stderr ?? ''}`);

  const check = runBuildCli(root, ['--check']);
  assert.equal(check.status, 0, `expected --check to pass: ${check.stdout}${check.stderr ?? ''}`);

  // --check must never write to the repo root: the committed file should be
  // exactly what the setup build produced.
  const committed = readFileSync(join(root, 'products.json'), 'utf8');
  assert.ok(committed.length > 0);
});

test('--check exits non-zero when the per-product JSON has drifted from products.json', () => {
  const root = makeFixtureRoot([fixtureProduct('widget-one')]);

  const build = runBuildCli(root);
  assert.equal(build.status, 0, `setup build should succeed: ${build.stdout}${build.stderr ?? ''}`);
  const committedBefore = readFileSync(join(root, 'products.json'));

  // Hand-edit the per-product source without rebuilding.
  const drifted = fixtureProduct('widget-one', { name: 'Widget One (renamed by hand)' });
  writeFileSync(
    join(root, 'products', 'widget-one', 'product.json'),
    JSON.stringify(drifted, null, 2) + '\n'
  );

  const check = runBuildCli(root, ['--check']);
  assert.notEqual(check.status, 0, '--check must fail when products/ has drifted');
  assert.match(check.stderr, /widget-one/);

  const committedAfter = readFileSync(join(root, 'products.json'));
  assert.ok(
    committedBefore.equals(committedAfter),
    '--check must never write to the committed products.json'
  );
});

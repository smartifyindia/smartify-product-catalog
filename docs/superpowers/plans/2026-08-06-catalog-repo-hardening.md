# Catalog Repo Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `smartify-product-catalog` self-contained and incapable of silently losing product data, and have it publish a checksummed release that other repos can pull without ever needing a sibling checkout.

**Architecture:** `products/<slug>/product.json` is the source of truth. The Python generator rebuilds `products.json` and the per-product READMEs from those files into a staging directory. A Node orchestrator validates the staged output against a schema, diffs it against the committed catalog through a delta gate that refuses destructive writes, and only then promotes it. The same validation protects the two ad-platform feeds, which are the highest-stakes consumers in this repo. The vendored CSV remains as archival provenance for the original import — it is stale on price and is no longer what a build reads.

**Tech Stack:** Python 3.11 (existing generator), Node 22 with the built-in `node:test` runner (no new dependencies), GitHub Actions for releases.

## Global Constraints

- **No repo may read a sibling repo.** Every input this repo needs lives inside it.
- **No build or feed script fetches catalog data at runtime.** Committed files only.
- **No script degrades silently.** Missing or malformed input throws; never `catch { return {} }`, never warn-and-continue.
- **Guarded fields** are exactly: `description`, `images`, `pricing`, `sku`.
- **Node 22 built-ins only.** No new npm dependencies in this repo.
- Existing catalog record count is **47**. Any change reducing it must be explicit.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Create — npm scripts and `node:test` wiring. Repo currently has none. |
| `data/sources/product-glossary.csv` | Create — vendored copy of the CSV currently read from `~/Downloads`. |
| `scripts/lib/catalog-guard.mjs` | Create — delta gate. Pure functions, no I/O. |
| `scripts/lib/catalog-schema.mjs` | Create — record validation. Pure functions, no I/O. |
| `scripts/lib/provenance.mjs` | Create — checksums and `products.source.json`. |
| `scripts/build-catalog.mjs` | Create — orchestrator: generate → validate → gate → promote. |
| `scripts/verify-catalog.mjs` | Create — standalone CLI verifier, used by feeds and CI. |
| `generate_catalog.py:13` | Modify — read the vendored CSV, fail loudly, accept `--out`. |
| `facebook-catalog-push.js:95` | Modify — verify before pushing. |
| `google-merchant-feed.js:136` | Modify — verify before writing the feed. |
| `.github/workflows/release-catalog.yml` | Create — publish release assets on tag. |
| `test/*.test.mjs` | Create — one test file per lib module. Note: `node --test test/` resolves the directory as a module path on Node 22 and fails with MODULE_NOT_FOUND; the glob form is required. |

---

### Task 1: Vendor the CSV and make the generator fail loudly

Right now `generate_catalog.py` reads `/Users/abhi/Downloads/Product_Photos/Product Glossary …csv`. If that file is deleted the catalog cannot be rebuilt at all. This task moves it into the repo and adds the `--out` flag that Task 5's orchestrator depends on.

**Files:**
- Create: `package.json`
- Create: `data/sources/product-glossary.csv` (copied, not authored)
- Modify: `generate_catalog.py:12-14` (paths), `:266` (`products_dir`), `:284` (`products.json` write), `:344` (`README.md` write), `:347` (`__main__`)

**Interfaces:**
- Consumes: nothing
- Produces: `python3 generate_catalog.py --out <dir>` writes `products.json`, `products/`, `README.md` into `<dir>` **and nowhere else**; defaults to the repo root. Exits non-zero with a clear message if the CSV is missing.

**Critical:** `--out` must be threaded through the writers, not implemented as
build-in-place-then-copy. Task 5 stages the build so that a failed validation or a destructive diff
leaves the committed catalog byte-identical; if the generator writes to `BASE` first, the committed
catalog is already overwritten before any gate runs and that guarantee is void.

- [ ] **Step 1: Vendor the CSV**

```bash
mkdir -p data/sources
cp "/Users/abhi/Downloads/Product_Photos/Product Glossary 31dcd4ab78e280899b7fce8d0ff31547_all.csv" \
   data/sources/product-glossary.csv
wc -l data/sources/product-glossary.csv
```

Expected: a line count greater than 47.

- [ ] **Step 2: Create `package.json`**

`"type": "module"` is safe here: `facebook-catalog-push.js` and `google-merchant-feed.js` already
use static `import` and contain no `require` calls. They currently work only because Node 22
auto-detects module syntax; this makes it explicit.

```json
{
  "name": "smartify-product-catalog",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "build-catalog": "node scripts/build-catalog.mjs",
    "verify-catalog": "node scripts/verify-catalog.mjs"
  }
}
```

- [ ] **Step 3: Point the generator at the vendored CSV and fail loudly**

Replace `generate_catalog.py` lines 12-14 with:

```python
BASE = Path(__file__).parent
CSV_PATH = BASE / "data" / "sources" / "product-glossary.csv"
IMAGES_DIR = BASE / "images"

if not CSV_PATH.exists():
    raise SystemExit(
        f"Product glossary CSV not found at {CSV_PATH}.\n"
        "This file is the source of the entire catalog and is vendored into the repo "
        "so the catalog can be rebuilt without any external checkout.\n"
        "Restore it from git history rather than copying it back from Downloads."
    )
```

- [ ] **Step 4: Thread the output directory through the writers**

Add `import argparse` to the imports at the top of `generate_catalog.py`.

Add an `OUT` global immediately after `IMAGES_DIR` (the block edited in Step 3):

```python
# Where generated artifacts are written. scripts/build-catalog.mjs points this
# at a staging directory so that a failed validation or a destructive diff never
# touches the committed catalog. CSV_PATH and IMAGES_DIR stay under BASE — they
# are inputs, not outputs.
OUT = BASE
```

Change the three write sites from `BASE` to `OUT`:

```python
# line 266, in build_catalog()
    products_dir = OUT / "products"

# line 284, in build_catalog()
    (OUT / "products.json").write_text(json.dumps(all_products, indent=2) + "\n")

# line 344, in write_main_readme()
    (OUT / "README.md").write_text(readme.strip() + "\n")
```

Replace the `if __name__ == "__main__":` block at line 347 with:

```python
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the Smartify product catalog.")
    parser.add_argument(
        "--out",
        type=Path,
        default=BASE,
        help="Directory to write products.json, products/ and README.md into.",
    )
    args = parser.parse_args()

    # Rebinding the module-level global here is what redirects every writer;
    # this block runs at module scope, so build_catalog() and write_main_readme()
    # see the new value when they are called below.
    OUT = args.out
    OUT.mkdir(parents=True, exist_ok=True)

    print("Building catalog...")
    all_products = build_catalog()
    write_main_readme(all_products)
    print(f"Done. Generated {len(all_products)} product pages.")
    print(f"  → {OUT}/products/ ({len(all_products)} folders)")
    print(f"  → {OUT}/products.json")
    print(f"  → {OUT}/README.md")
```

- [ ] **Step 5: Verify the generator still produces 47 products**

```bash
python3 generate_catalog.py && python3 -c "import json;print('records:', len(json.load(open('products.json'))))"
```

Expected: `Done. Generated 47 product pages.` and `records: 47`.

- [ ] **Step 6: Verify `--out` writes nowhere but the staging directory**

This is the check that Task 5's whole guarantee rests on.

```bash
sha256sum products.json README.md > /tmp/before.sha
STAGE=$(mktemp -d)
python3 generate_catalog.py --out "$STAGE"
sha256sum -c /tmp/before.sha && echo "COMMITTED FILES UNTOUCHED"
python3 -c "import json;print('staged records:', len(json.load(open('$STAGE/products.json'))))"
ls "$STAGE/products" | wc -l
```

Expected: `products.json: OK`, `README.md: OK`, `COMMITTED FILES UNTOUCHED`, `staged records: 47`,
and `47` staged product folders. If either committed file changed, `--out` is still writing to
`BASE` — fix that before continuing, as every later gate depends on it.

- [ ] **Step 7: Verify it fails loudly without the CSV**

```bash
mv data/sources/product-glossary.csv /tmp/csv-backup.csv
python3 generate_catalog.py; echo "exit=$?"
mv /tmp/csv-backup.csv data/sources/product-glossary.csv
```

Expected: the "Product glossary CSV not found" message and `exit=1`.

- [ ] **Step 8: Commit**

```bash
git add package.json data/sources/product-glossary.csv generate_catalog.py
git commit -m "Vendor the product glossary CSV and fail loudly without it"
```

#### Amendment: stop the generator republishing dealer pricing

Found while verifying Step 5. Commit `1207bbf` ("remove dealer_price_inr from all products",
2026-04-24) edited the *output* but not the generator, so `generate_catalog.py` still emits the
field and renders a `Dealer Price` row into every product README. Any regeneration silently
republishes dealer pricing to a public repo and, via Tasks 6-7, to the Facebook and Google Merchant
feeds. The delta gate cannot catch this — it guards against losing data, not against unwanted
additions. Fixing it at source is the point of this whole plan.

Nothing depends on this field here: the B2B site sources dealer pricing from its own TSV into
`worker/b2b-prices.json`.

- [ ] **Step 9: Remove the field from the generated JSON**

In `generate_catalog.py`, delete this line from the `"pricing"` dict (around line 176):

```python
            "dealer_price_inr": int(raw_json["DP"]) if raw_json.get("DP") else None,
```

- [ ] **Step 10: Remove the Dealer Price row from the README template**

In `write_product_readme()` (around line 220), delete the `dp` binding and the `Dealer Price` table
row it feeds. Read the surrounding pricing block before editing and remove only the dealer-price
parts — the SRP row, the GST row and the HSN row all stay.

- [ ] **Step 11: Verify a regenerated catalog is free of dealer pricing**

```bash
STAGE=$(mktemp -d)
python3 generate_catalog.py --out "$STAGE"
grep -rc "dealer_price_inr" "$STAGE/products.json" || echo "products.json: clean"
grep -rli "dealer price" "$STAGE/products" | head || echo "READMEs: clean"
python3 -c "import json;print('records:', len(json.load(open('$STAGE/products.json'))))"
rm -rf "$STAGE"
```

Expected: `products.json: clean`, `READMEs: clean`, `records: 47`.

- [ ] **Step 12: Confirm the committed catalog still matches the generator**

```bash
STAGE=$(mktemp -d)
python3 generate_catalog.py --out "$STAGE"
python3 - <<'PY'
import json, os, sys
stage = os.environ["STAGE"]
a = json.load(open("products.json"))
b = json.load(open(f"{stage}/products.json"))
print("committed records:", len(a), "| regenerated records:", len(b))
print("identical:", a == b)
PY
rm -rf "$STAGE"
```

Expected: both counts 47. If `identical` is False, report the differing keys in your report rather
than committing a regenerated `products.json` — reconciling the committed artifact is Task 5's job,
not this one.

- [ ] **Step 13: Commit**

```bash
git add generate_catalog.py
git commit -m "Stop the generator republishing dealer pricing"
```

---

### Task 2: Delta gate

The rule that would have caught the `smartify-business` bug: refuse to write when data would disappear.

**Files:**
- Create: `scripts/lib/catalog-guard.mjs`
- Test: `test/catalog-guard.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `GUARDED_FIELDS: string[]` — `['description', 'images', 'pricing', 'sku']`
  - `diffCatalogs(previous, next)` → `{ removedSlugs: string[], countDelta: number, emptiedFields: Array<{slug: string, field: string}> }`
  - `assertNoDataLoss(previous, next, { allowRemovals = false } = {})` → `void`, throws `CatalogDataLossError`
  - `class CatalogDataLossError extends Error` with `.details` matching the `diffCatalogs` return shape

- [ ] **Step 1: Write the failing tests**

Create `test/catalog-guard.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffCatalogs,
  assertNoDataLoss,
  CatalogDataLossError,
} from '../scripts/lib/catalog-guard.mjs';

const record = (slug, over = {}) => ({
  slug,
  sku: `SKU-${slug}`,
  description: 'A description',
  images: ['a.jpg'],
  pricing: { srp_inr: 100 },
  ...over,
});

test('identical catalogs report no loss', () => {
  const a = [record('one'), record('two')];
  assert.deepEqual(diffCatalogs(a, a), {
    removedSlugs: [],
    countDelta: 0,
    emptiedFields: [],
  });
  assert.doesNotThrow(() => assertNoDataLoss(a, a));
});

test('additions are allowed', () => {
  const before = [record('one')];
  const after = [record('one'), record('two')];
  assert.equal(diffCatalogs(before, after).countDelta, 1);
  assert.doesNotThrow(() => assertNoDataLoss(before, after));
});

test('a removed slug is reported and blocks the write', () => {
  const before = [record('one'), record('two')];
  const after = [record('one')];
  assert.deepEqual(diffCatalogs(before, after).removedSlugs, ['two']);
  assert.throws(() => assertNoDataLoss(before, after), CatalogDataLossError);
});

test('emptying a guarded field blocks the write', () => {
  const before = [record('one')];
  const after = [record('one', { description: '' })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
    { slug: 'one', field: 'description' },
  ]);
  assert.throws(() => assertNoDataLoss(before, after), CatalogDataLossError);
});

test('emptying an images array counts as loss', () => {
  const before = [record('one')];
  const after = [record('one', { images: [] })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
    { slug: 'one', field: 'images' },
  ]);
});

test('an images container gutted to empty values counts as loss', () => {
  const full = { hero: 'a.png', all: ['a.png'], hero_url: 'a.png', all_urls: ['a.png'] };
  const gutted = { hero: '', all: [], hero_url: '', all_urls: [] };
  const before = [record('one', { images: full })];
  const after = [record('one', { images: gutted })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, [
    { slug: 'one', field: 'images' },
  ]);
});

test('a populated images container is not a loss', () => {
  const full = { hero: 'a.png', all: ['a.png'], hero_url: 'a.png', all_urls: ['a.png'] };
  const before = [record('one', { images: full })];
  assert.deepEqual(diffCatalogs(before, before).emptiedFields, []);
});

test('a field that was already empty is not a loss', () => {
  const before = [record('one', { description: '' })];
  const after = [record('one', { description: '' })];
  assert.deepEqual(diffCatalogs(before, after).emptiedFields, []);
});

test('wiping the catalog reports every slug', () => {
  const before = [record('one'), record('two'), record('three')];
  const error = assert.throws(() => assertNoDataLoss(before, []), CatalogDataLossError);
  assert.equal(error.details.removedSlugs.length, 3);
  assert.equal(error.details.countDelta, -3);
  assert.match(error.message, /3 records? would disappear/);
});

test('allowRemovals still refuses to empty a field on a surviving record', () => {
  const before = [record('one'), record('two')];
  const after = [record('one', { description: '' })];
  assert.throws(
    () => assertNoDataLoss(before, after, { allowRemovals: true }),
    CatalogDataLossError
  );
});

test('allowRemovals permits a deliberate removal', () => {
  const before = [record('one'), record('two')];
  const after = [record('one')];
  assert.doesNotThrow(() => assertNoDataLoss(before, after, { allowRemovals: true }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/catalog-guard.mjs'`

- [ ] **Step 3: Implement the guard**

Create `scripts/lib/catalog-guard.mjs`:

```javascript
/**
 * The delta gate. Pure functions, no I/O, so it can be unit tested and reused
 * verbatim by the other repos (each vendors its own copy — repos never import
 * across repo boundaries).
 */

export const GUARDED_FIELDS = ['description', 'images', 'pricing', 'sku'];

export class CatalogDataLossError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'CatalogDataLossError';
    this.details = details;
  }
}

// Emptiness is recursive on purpose. Every real record stores images as
// { hero, all, hero_url, all_urls }, so a container that still has its keys but
// has lost all its values is the realistic way image data disappears — a
// keys-only check would wave that through.
const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty);
  if (typeof value === 'object') {
    const values = Object.values(value);
    return values.length === 0 || values.every(isEmpty);
  }
  return false;
};

export function diffCatalogs(previous, next) {
  const nextBySlug = new Map(next.map((r) => [r.slug, r]));
  const removedSlugs = [];
  const emptiedFields = [];

  for (const before of previous) {
    const after = nextBySlug.get(before.slug);
    if (!after) {
      removedSlugs.push(before.slug);
      continue;
    }
    for (const field of GUARDED_FIELDS) {
      if (!isEmpty(before[field]) && isEmpty(after[field])) {
        emptiedFields.push({ slug: before.slug, field });
      }
    }
  }

  return {
    removedSlugs,
    countDelta: next.length - previous.length,
    emptiedFields,
  };
}

export function assertNoDataLoss(previous, next, { allowRemovals = false } = {}) {
  const details = diffCatalogs(previous, next);
  const problems = [];

  // --allow-removals is for retiring a product on purpose. It is NOT a licence
  // to wipe a field on a product that stays, so the emptiedFields check below
  // runs either way.
  if (!allowRemovals && details.removedSlugs.length > 0) {
    problems.push(
      `${details.removedSlugs.length} record(s) would disappear: ` +
        details.removedSlugs.join(', ')
    );
  }
  if (!allowRemovals && details.countDelta < 0) {
    problems.push(
      `record count would drop by ${Math.abs(details.countDelta)} ` +
        `(${previous.length} → ${next.length})`
    );
  }
  if (details.emptiedFields.length > 0) {
    problems.push(
      `${details.emptiedFields.length} field(s) would be emptied: ` +
        details.emptiedFields.map((f) => `${f.slug}.${f.field}`).join(', ')
    );
  }

  if (problems.length > 0) {
    throw new CatalogDataLossError(
      `Refusing to write: this would lose data.\n  - ${problems.join('\n  - ')}\n` +
        `If this removal is intentional, re-run with --allow-removals.`,
      details
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/catalog-guard.mjs test/catalog-guard.test.mjs
git commit -m "Add delta gate that refuses catalog writes which lose data"
```

---

### Task 3: Schema validation

**Files:**
- Create: `scripts/lib/catalog-schema.mjs`
- Test: `test/catalog-schema.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `REQUIRED_FIELDS: string[]` — `['sku', 'name', 'slug', 'brand', 'category', 'description', 'images']`
  - `validateCatalog(records)` → `void`, throws `CatalogSchemaError`
  - `class CatalogSchemaError extends Error` with `.problems: string[]`

- [ ] **Step 1: Write the failing tests**

Create `test/catalog-schema.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, CatalogSchemaError } from '../scripts/lib/catalog-schema.mjs';

const valid = (over = {}) => ({
  sku: 'SKU-1',
  name: 'Zigbee Relay',
  slug: 'zigbee-relay',
  brand: 'Smartify',
  category: 'Retrofit',
  description: 'A relay.',
  images: ['relay.jpg'],
  ...over,
});

test('a valid catalog passes', () => {
  assert.doesNotThrow(() => validateCatalog([valid()]));
});

test('a non-array input is rejected', () => {
  assert.throws(() => validateCatalog({}), CatalogSchemaError);
});

test('an empty catalog is rejected', () => {
  assert.throws(() => validateCatalog([]), CatalogSchemaError);
});

test('a missing required field is reported with its slug', () => {
  const error = assert.throws(
    () => validateCatalog([valid({ brand: undefined })]),
    CatalogSchemaError
  );
  assert.match(error.problems.join(' '), /zigbee-relay.*brand/);
});

test('duplicate slugs are rejected', () => {
  const error = assert.throws(
    () => validateCatalog([valid(), valid()]),
    CatalogSchemaError
  );
  assert.match(error.problems.join(' '), /duplicate slug/i);
});

test('an image on the dead WordPress host is rejected', () => {
  const error = assert.throws(
    () => validateCatalog([valid({ images: ['https://smartify.in/wp-content/x.jpg'] })]),
    CatalogSchemaError
  );
  assert.match(error.problems.join(' '), /wp-content/);
});

test('dealer pricing is rejected — this catalog is public', () => {
  const error = assert.throws(
    () => validateCatalog([valid({ pricing: { srp_inr: 100, dealer_price_inr: 60 } })]),
    CatalogSchemaError
  );
  assert.match(error.problems.join(' '), /dealer/i);
});

test('srp-only pricing is fine', () => {
  assert.doesNotThrow(() =>
    validateCatalog([valid({ pricing: { srp_inr: 100, gst_rate: '18', hsn: '85365090' } })])
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/catalog-schema.mjs'`

- [ ] **Step 3: Implement the validator**

Create `scripts/lib/catalog-schema.mjs`:

```javascript
/**
 * Record-level validation for the catalog. Deliberately hand-written rather
 * than a JSON Schema library: this repo takes no npm dependencies, and the
 * rules are few enough to read at a glance.
 */

export const REQUIRED_FIELDS = [
  'sku',
  'name',
  'slug',
  'brand',
  'category',
  'description',
  'images',
];

export class CatalogSchemaError extends Error {
  constructor(problems) {
    super(`Catalog failed validation:\n  - ${problems.join('\n  - ')}`);
    this.name = 'CatalogSchemaError';
    this.problems = problems;
  }
}

export function validateCatalog(records) {
  const problems = [];

  if (!Array.isArray(records)) {
    throw new CatalogSchemaError(['catalog is not an array']);
  }
  if (records.length === 0) {
    throw new CatalogSchemaError(['catalog is empty']);
  }

  const seen = new Set();
  for (const [i, record] of records.entries()) {
    const label = record?.slug || `record #${i}`;

    for (const field of REQUIRED_FIELDS) {
      const value = record?.[field];
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (missing) problems.push(`${label}: missing required field "${field}"`);
    }

    if (record?.slug) {
      if (seen.has(record.slug)) problems.push(`duplicate slug "${record.slug}"`);
      seen.add(record.slug);
    }

    for (const image of record?.images ?? []) {
      const url = typeof image === 'string' ? image : image?.src ?? '';
      if (url.includes('wp-content')) {
        problems.push(`${label}: image still points at the dead WordPress host (${url})`);
      }
    }

    // This catalog is published to a public repo and to the Facebook and Google
    // Merchant feeds. Dealer pricing was removed from the data in 1207bbf but
    // the generator kept emitting it; this rule is what makes that removal
    // permanent instead of a thing someone re-breaks by regenerating.
    if (record?.pricing && 'dealer_price_inr' in record.pricing) {
      problems.push(
        `${label}: pricing.dealer_price_inr must not appear in the public catalog`
      );
    }
  }

  if (problems.length > 0) throw new CatalogSchemaError(problems);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 14 tests total across both files.

- [ ] **Step 5: Verify the real catalog validates**

```bash
node --input-type=module -e "
import { validateCatalog } from './scripts/lib/catalog-schema.mjs';
import { readFileSync } from 'node:fs';
validateCatalog(JSON.parse(readFileSync('./products.json','utf8')));
console.log('real catalog: valid');"
```

Expected: `real catalog: valid`. If it reports problems, fix the data — not the validator — unless a rule is genuinely wrong.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/catalog-schema.mjs test/catalog-schema.test.mjs
git commit -m "Add catalog schema validation"
```

---

### Task 4: Provenance and checksums

**Files:**
- Create: `scripts/lib/provenance.mjs`
- Test: `test/provenance.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `sha256OfFile(filePath)` → `string` (hex digest)
  - `writeProvenance({ artifactPath, generator, records })` → the written object
  - `verifyProvenance(artifactPath)` → `void`, throws `ProvenanceError`
  - `class ProvenanceError extends Error`
  - Sidecar file convention: `<artifactPath minus .json>.source.json`

- [ ] **Step 1: Write the failing tests**

Create `test/provenance.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sha256OfFile,
  writeProvenance,
  verifyProvenance,
  ProvenanceError,
} from '../scripts/lib/provenance.mjs';

const fixture = (records) => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  const artifact = join(dir, 'products.json');
  writeFileSync(artifact, JSON.stringify(records));
  return artifact;
};

test('sha256OfFile is stable and content-dependent', () => {
  const a = fixture([{ slug: 'x' }]);
  const b = fixture([{ slug: 'x' }]);
  const c = fixture([{ slug: 'y' }]);
  assert.equal(sha256OfFile(a), sha256OfFile(b));
  assert.notEqual(sha256OfFile(a), sha256OfFile(c));
});

test('writeProvenance records count, generator and digest', () => {
  const artifact = fixture([{ slug: 'x' }, { slug: 'y' }]);
  const written = writeProvenance({
    artifactPath: artifact,
    generator: 'scripts/build-catalog.mjs',
    records: 2,
  });
  assert.equal(written.records, 2);
  assert.equal(written.generator, 'scripts/build-catalog.mjs');
  assert.equal(written.sha256, sha256OfFile(artifact));
  const sidecar = artifact.replace(/\.json$/, '.source.json');
  assert.equal(JSON.parse(readFileSync(sidecar, 'utf8')).records, 2);
});

test('verifyProvenance passes for an untouched artifact', () => {
  const artifact = fixture([{ slug: 'x' }]);
  writeProvenance({ artifactPath: artifact, generator: 'g', records: 1 });
  assert.doesNotThrow(() => verifyProvenance(artifact));
});

test('verifyProvenance detects a hand-edited artifact', () => {
  const artifact = fixture([{ slug: 'x' }]);
  writeProvenance({ artifactPath: artifact, generator: 'g', records: 1 });
  writeFileSync(artifact, JSON.stringify([{ slug: 'x' }, { slug: 'sneaky' }]));
  const error = assert.throws(() => verifyProvenance(artifact), ProvenanceError);
  assert.match(error.message, /checksum/i);
});

test('verifyProvenance fails when the sidecar is missing', () => {
  const artifact = fixture([{ slug: 'x' }]);
  assert.throws(() => verifyProvenance(artifact), ProvenanceError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/provenance.mjs'`

- [ ] **Step 3: Implement provenance**

Create `scripts/lib/provenance.mjs`:

```javascript
/**
 * Provenance sidecars. CI can never see the upstream repo, so verification is
 * self-consistency: does this artifact still match the digest and record count
 * recorded when it was generated? That catches truncation, corruption and
 * hand-edits, which are the realistic failure modes.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export class ProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

const sidecarPath = (artifactPath) => artifactPath.replace(/\.json$/, '.source.json');

export function sha256OfFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function writeProvenance({ artifactPath, generator, records }) {
  const provenance = {
    artifact: artifactPath.split('/').pop(),
    generator,
    records,
    sha256: sha256OfFile(artifactPath),
    commit: currentCommit(),
    generatedAt: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(sidecarPath(artifactPath), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}

export function verifyProvenance(artifactPath) {
  const sidecar = sidecarPath(artifactPath);
  if (!existsSync(sidecar)) {
    throw new ProvenanceError(
      `No provenance sidecar at ${sidecar}. Run "npm run build-catalog" to regenerate it.`
    );
  }

  const recorded = JSON.parse(readFileSync(sidecar, 'utf8'));
  const actualDigest = sha256OfFile(artifactPath);
  if (recorded.sha256 !== actualDigest) {
    throw new ProvenanceError(
      `Checksum mismatch for ${artifactPath}.\n` +
        `  recorded: ${recorded.sha256}\n  actual:   ${actualDigest}\n` +
        `The artifact was edited by hand or is corrupt. Rebuild it rather than ` +
        `updating the sidecar.`
    );
  }

  const actualRecords = JSON.parse(readFileSync(artifactPath, 'utf8')).length;
  if (recorded.records !== actualRecords) {
    throw new ProvenanceError(
      `Record count mismatch for ${artifactPath}: sidecar says ${recorded.records}, ` +
        `file has ${actualRecords}.`
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 19 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/provenance.mjs test/provenance.test.mjs
git commit -m "Add checksum provenance sidecars for catalog artifacts"
```

---

### Task 5: Build orchestrator

Ties the three libraries together. This is the command that replaces running `generate_catalog.py`
directly.

**Source of truth changed after this plan was written.** The original design regenerated everything
from `data/sources/product-glossary.csv`. That CSV turned out to be stale: all 47 SRPs in it predate
a repricing done by hand in the committed JSON (e.g. `convergia` is ₹87,500 in the CSV, ₹114,000 in
the repo). Rebuilding from it would silently revert every price — and the delta gate would not catch
it, because the gate guards removed records and emptied fields, not changed values.

So `products/<slug>/product.json` is now canonical. The CSV stays vendored as archival provenance
for the original import, and `generate_catalog.py`'s CSV path stays available for a fresh re-import,
but it is no longer what a build runs.

This is tractable because `write_product_readme(product_dir, data, row)` already reads **only**
`data` — the `row` parameter is vestigial. README generation needs no CSV at all.

**Files:**
- Modify: `generate_catalog.py` — add a `--from-json` mode and drop the vestigial `row` parameter
- Create: `scripts/build-catalog.mjs`

**Interfaces:**
- Consumes: `assertNoDataLoss` (Task 2), `validateCatalog` (Task 3), `writeProvenance` (Task 4)
- Produces:
  - `python3 generate_catalog.py --from-json --out <dir>` — reads every `products/<slug>/product.json`
    from the repo, writes `products.json`, `products/<slug>/README.md` and `README.md` into `<dir>`
  - `npm run build-catalog [-- --allow-removals]` — writes `products.json` and `products.source.json`
    at the repo root only after all gates pass

- [ ] **Step 1: Add a `--from-json` mode to the generator**

Add this function to `generate_catalog.py`, above `build_catalog()`:

```python
def load_products_from_json() -> list[dict]:
    """Read the per-product JSON files, which are the source of truth.

    The vendored CSV is an archival record of the original import and is now
    stale — prices have since been maintained by hand in these files. Building
    from the CSV would silently revert them, so a normal build reads from here.
    """
    src = BASE / "products"
    if not src.exists():
        raise SystemExit(f"No products/ directory at {src}; nothing to build from.")

    products = []
    for product_dir in sorted(src.iterdir()):
        path = product_dir / "product.json"
        if not path.exists():
            raise SystemExit(
                f"{product_dir.name}/ has no product.json. Every product directory must "
                f"contain one — a missing file would silently drop the product."
            )
        products.append(json.loads(path.read_text(encoding="utf-8")))
    return products
```

- [ ] **Step 2: Make `write_product_readme` stop taking the unused `row`**

`write_product_readme(product_dir, data, row)` never reads `row`. Change its signature to
`write_product_readme(product_dir, data)` and update its one call site inside `build_catalog()`.
Removing it is what lets READMEs be generated without any CSV.

- [ ] **Step 3: Add a `build_from_json()` entry point**

Add above the `__main__` block:

```python
def build_from_json() -> list[dict]:
    """Regenerate products.json and every README from the per-product JSON."""
    all_products = load_products_from_json()
    products_dir = OUT / "products"
    products_dir.mkdir(parents=True, exist_ok=True)

    for data in all_products:
        product_dir = products_dir / data["slug"]
        product_dir.mkdir(parents=True, exist_ok=True)
        (product_dir / "product.json").write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        )
        write_product_readme(product_dir, data)

    (OUT / "products.json").write_text(
        json.dumps(all_products, indent=2, ensure_ascii=False) + "\n"
    )
    return all_products
```

- [ ] **Step 4: Wire `--from-json` into `__main__`**

Add the flag to the argument parser and branch on it:

```python
    parser.add_argument(
        "--from-json",
        action="store_true",
        help="Build from the per-product JSON files (the source of truth) "
             "instead of the archival CSV.",
    )
```

and replace the two build calls with:

```python
    print("Building catalog...")
    if args.from_json:
        all_products = build_from_json()
    else:
        all_products = build_catalog()
    write_main_readme(all_products)
```

- [ ] **Step 5: Verify `--from-json` round-trips the committed catalog exactly**

The committed catalog must survive a rebuild byte-for-byte apart from the root README, which is
hand-written and is dealt with in Step 6.

```bash
STAGE=$(mktemp -d)
python3 generate_catalog.py --from-json --out "$STAGE"
python3 - <<PY
import json
a = json.load(open("products.json"))
b = json.load(open("$STAGE/products.json"))
print("committed:", len(a), "rebuilt:", len(b))
print("identical:", a == b)
PY
diff -q products/convergia/README.md "$STAGE/products/convergia/README.md" && echo "README identical"
grep -c "114000" "$STAGE/products.json"
rm -rf "$STAGE"
```

Expected: `committed: 47 rebuilt: 47`, `identical: True`, `README identical`, and a non-zero count
for `114000` — proving the repriced values survived rather than reverting to the CSV's ₹87,500.

If `identical` is False, report the differing keys in your report and STOP. Do not adjust the
committed catalog to match the generator; the committed data is authoritative now.

- [ ] **Step 6: Protect the hand-written root README**

`write_main_readme()` overwrites `README.md`, but the committed root README is hand-written
marketing copy (commit `b5b709c`) that the generator would destroy — this already happened once
during Task 1. Guard it:

```python
def write_main_readme(all_products: list[dict]):
    target = OUT / "README.md"
    if target.exists() and "<div align=\"center\">" in target.read_text(encoding="utf-8"):
        print("  → README.md left alone (hand-written marketing copy)")
        return
```

Insert those lines at the top of the existing `write_main_readme()`, leaving the rest of the
function unchanged so a fresh checkout without the marketing README still gets a generated one.

- [ ] **Step 7: Verify the root README is no longer clobbered**

```bash
sha256sum README.md > /tmp/readme.sha
python3 generate_catalog.py --from-json
sha256sum -c /tmp/readme.sha && echo "ROOT README INTACT"
git status --porcelain | wc -l
```

Expected: `ROOT README INTACT` and `0` changed files — a build from canonical data is a no-op.

- [ ] **Step 8: Implement the orchestrator**

Create `scripts/build-catalog.mjs`:

```javascript
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
    [join(ROOT, 'generate_catalog.py'), '--from-json', '--out', staging],
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
```

Note this does **not** copy the staged `README.md` over the committed one — Step 6 already stops the
generator writing it, and the root README is not a build artifact.

- [ ] **Step 9: Verify a normal build is a clean no-op**

```bash
npm run build-catalog && cat products.source.json && git status --porcelain | wc -l
```

Expected: `Delta gate passed (47 → 47 records).`, `Promoted. 47 records, sha256 …`, a sidecar
showing `"records": 47`, and `1` changed file — only the new `products.source.json`.

- [ ] **Step 10: Verify the gate blocks a destructive build**

Delete a product directory and confirm the committed catalog survives:

```bash
cp products.json /tmp/products.guard-check.json
mv products/convergia /tmp/convergia-backup
npm run build-catalog; echo "exit=$?"
mv /tmp/convergia-backup products/convergia
diff -q products.json /tmp/products.guard-check.json && echo "COMMITTED CATALOG INTACT"
```

Expected: the build fails with `Refusing to write: this would lose data.` naming `convergia`,
`exit=1`, and `COMMITTED CATALOG INTACT`.

- [ ] **Step 11: Verify dealer pricing cannot be reintroduced**

```bash
cp products/convergia/product.json /tmp/convergia.json
python3 - <<'PY'
import json
p = "products/convergia/product.json"
d = json.load(open(p))
d["pricing"]["dealer_price_inr"] = 35000
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
PY
npm run build-catalog; echo "exit=$?"
cp /tmp/convergia.json products/convergia/product.json
```

Expected: the build fails with `pricing.dealer_price_inr must not appear in the public catalog` and
`exit=1`. This is the regression test for today's exposure.

- [ ] **Step 12: Restore and commit**

```bash
npm run build-catalog
npm test
git add generate_catalog.py scripts/build-catalog.mjs products.source.json
git commit -m "Build the catalog from the per-product JSON behind validation and a delta gate"
```

Expected: build succeeds, all tests pass.

---

### Task 6: Protect the ad feeds

`facebook-catalog-push.js` and `google-merchant-feed.js` push to live ad platforms. A silently truncated catalog here pulls products out of running campaigns, which makes these the highest-stakes consumers in the repo.

The spec calls for "the delta gate" on the feeds. The delta gate compares a *proposed write* against
a committed file, and the feeds never write the catalog — they only read it. The equivalent
protection for a reader is a health check: the provenance sidecar already records the expected
record count and digest, so a truncated or corrupt catalog is caught before anything is pushed. A
legitimate shrink via `--allow-removals` updates the sidecar too, so the feed correctly pushes the
smaller set. That is the intended behaviour, not a gap.

**Files:**
- Create: `scripts/verify-catalog.mjs`
- Modify: `facebook-catalog-push.js:95`, `google-merchant-feed.js:136`
- Test: `test/verify-catalog.test.mjs`

**Interfaces:**
- Consumes: `validateCatalog` (Task 3), `verifyProvenance` (Task 4)
- Produces:
  - `assertCatalogHealthy(artifactPath)` → `void`, throws on any failure
  - CLI: `npm run verify-catalog` → exits 0 or 1

- [ ] **Step 1: Write the failing test**

Create `test/verify-catalog.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCatalogHealthy } from '../scripts/verify-catalog.mjs';
import { writeProvenance } from '../scripts/lib/provenance.mjs';

const record = (slug) => ({
  sku: `SKU-${slug}`,
  name: slug,
  slug,
  brand: 'Smartify',
  category: 'Retrofit',
  description: 'desc',
  images: ['a.jpg'],
});

const fixture = (records, { withProvenance = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  const artifact = join(dir, 'products.json');
  writeFileSync(artifact, JSON.stringify(records));
  if (withProvenance) {
    writeProvenance({ artifactPath: artifact, generator: 'test', records: records.length });
  }
  return artifact;
};

test('a healthy catalog passes', () => {
  assert.doesNotThrow(() => assertCatalogHealthy(fixture([record('one')])));
});

test('an invalid record is caught', () => {
  const bad = { ...record('one'), brand: '' };
  assert.throws(() => assertCatalogHealthy(fixture([bad])));
});

test('a missing provenance sidecar is caught', () => {
  assert.throws(() => assertCatalogHealthy(fixture([record('one')], { withProvenance: false })));
});

test('an empty catalog is caught', () => {
  assert.throws(() => assertCatalogHealthy(fixture([])));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/verify-catalog.mjs'`

- [ ] **Step 3: Implement the verifier**

Create `scripts/verify-catalog.mjs`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 23 tests total.

- [ ] **Step 5: Gate the Facebook feed**

Both feed scripts are ESM, so use a static import. Add alongside the existing imports at the top of
`facebook-catalog-push.js`:

```javascript
import { assertCatalogHealthy } from './scripts/verify-catalog.mjs';
```

Then immediately before line 95's `readFileSync`:

```javascript
  assertCatalogHealthy(path.join(__dirname, 'products.json'));
```

- [ ] **Step 6: Gate the Google Merchant feed**

Add alongside the existing imports at the top of `google-merchant-feed.js`:

```javascript
import { assertCatalogHealthy } from './scripts/verify-catalog.mjs';
```

Then immediately before line 136's `readFileSync`:

```javascript
  assertCatalogHealthy(INPUT_PATH);
```

- [ ] **Step 7: Verify both feeds refuse a corrupt catalog**

```bash
cp products.json /tmp/products.ok.json
python3 -c "open('products.json','w').write('[]')"
node google-merchant-feed.js; echo "merchant exit=$?"
cp /tmp/products.ok.json products.json
npm run verify-catalog
```

Expected: the merchant feed exits non-zero complaining about the checksum or the empty catalog, and `verify-catalog` reports `Catalog OK` once restored.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-catalog.mjs test/verify-catalog.test.mjs facebook-catalog-push.js google-merchant-feed.js
git commit -m "Verify catalog health before pushing to Facebook and Google feeds"
```

---

### Task 7: Publish checksummed releases

Lets the other four repos pull a pinned catalog version over HTTPS without ever needing this repo checked out beside them.

**Files:**
- Create: `.github/workflows/release-catalog.yml`
- Create: `scripts/write-checksums.mjs`

**Interfaces:**
- Consumes: `sha256OfFile` (Task 4)
- Produces: a GitHub Release tagged `catalog-vX.Y.Z` carrying `products.json`, `products.source.json` and `checksums.txt`.

- [ ] **Step 1: Implement the checksum writer**

Create `scripts/write-checksums.mjs`:

```javascript
#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256OfFile } from './lib/provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['products.json', 'products.source.json'];
const lines = files.map((f) => `${sha256OfFile(join(root, f))}  ${basename(f)}`);
writeFileSync(join(root, 'checksums.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
```

- [ ] **Step 2: Verify it runs**

```bash
node scripts/write-checksums.mjs && cat checksums.txt
```

Expected: two lines, each a 64-character digest followed by a filename.

- [ ] **Step 3: Add the release workflow**

Create `.github/workflows/release-catalog.yml`:

```yaml
name: Release catalog

on:
  push:
    tags:
      - 'catalog-v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Run tests
        run: npm test

      - name: Verify the committed catalog
        run: npm run verify-catalog

      - name: Write checksums
        run: node scripts/write-checksums.mjs

      - name: Publish release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            products.json
            products.source.json
            checksums.txt
```

The workflow verifies before publishing, so a corrupt catalog can never become a release that four other repos pull.

- [ ] **Step 4: Commit**

```bash
git add scripts/write-checksums.mjs .github/workflows/release-catalog.yml checksums.txt
git commit -m "Publish checksummed catalog releases for downstream repos"
```

- [ ] **Step 5: Cut the first release**

```bash
git tag catalog-v1.0.0
git push origin main --tags
```

Expected: the workflow runs green and a `catalog-v1.0.0` release appears with three assets. Consumer repos in later plans pin this version.

---

## Follow-on plans

Each of these is a separate plan against this same spec, and each depends only on the release produced by Task 7:

- **Plan 2 — `smartify-website`:** `sync-catalog` + `catalog.lock` for the 47-SKU copy; `verify-catalog` in `prebuild`.
- **Plan 3 — `smartify-business`:** vendor the TSV, XML, retail-cache snapshot and image mapping; rewrite `prepare-data.js` around the delta gate; add `sync-retail-cache`; add the `verify-deploy` gate it currently lacks.
- **Plan 4 — `smartify-docs` and `smartify-pro-frontend`:** sync + lock before `generate_docs.py`; delta gate on `sync-public-catalog-descriptions.mjs`.

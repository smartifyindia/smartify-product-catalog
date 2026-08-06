# Catalog independence and safe sync — design

**Date:** 2026-08-06
**Status:** Approved for planning

## Problem

Product data is forked across five independent git repos with no shared tooling. Copies drift, and
the mechanisms that move data between them fail silently. In one session this produced:

- `smartify-business/scripts/prepare-data.js` reading `../smartify-new/`, a directory renamed to
  `smartify-website` months ago. Both loaders caught the `ENOENT` and returned an empty map, so the
  script would have **written an empty catalog over 371 products and exited 0**.
- A second stale path in the same file (`../../Smartify-archive`, one level too high).
- `business.smartify.in` serving descriptions copied from `smartify.in`, causing 341 URLs to sit in
  Google's "Crawled/Discovered — currently not indexed".
- 47 Smartify-branded SKUs present in one catalog and absent from another, unnoticed.
- `generate_catalog.py` regenerating the canonical catalog from
  `/Users/abhi/Downloads/Product_Photos/…csv` — a file in Downloads, in no repo, deletable at any
  time.

The common thread is not that copies exist. It is that copies are **undeclared and unverified**,
and that failure paths degrade quietly instead of stopping.

## Goals

1. Every repo clones and builds alone in the cloud, with no sibling checkout and no network call.
2. No sync can remove data without an explicit, informed override.
3. No sync can fail silently. Missing or malformed input stops the run.
4. Every generated artifact declares where it came from and can be verified against that claim.

## Non-goals

- Merging the two catalogs. They are disjoint (0 shared SKUs) with different audiences and
  lifecycles.
- Introducing a CMS, database, or npm registry. Evaluated and rejected: a database would freeze
  `lastmod`, which is derived from `git log` and drives sitemap freshness and IndexNow.
- Fetching catalog data at build time. Build inputs stay committed.
- The `business.smartify.in` B2B trade-sheet content work. Separate spec.

## Current state

Two disjoint catalogs:

| Catalog | Records | Canonical today | Consumers |
|---|---|---|---|
| Smartify line | 47 | `smartify-product-catalog/products/<slug>/product.json`, aggregated to `products.json` | website `catalog-products.json`, docs MDX, pro sync, Facebook catalog, Google Merchant feed |
| Reseller range | 584 | `smartify-website/src/data/cache/products.json` | website product pages, business (317 of 371 records) |

Repos: `smartify-website`, `smartify-business`, `smartify-docs`, `smartify-product-catalog`,
`smartify-pro/smartify-pro-frontend` — five separate remotes, no root `package.json`, no workspaces.

`smartify-business` additionally depends on `Smartify-archive/business-smartify-backup/`
(`products-with-pricing.tsv`, `business-smartify-export.xml`), which is not a repo.

## Design

### 1. Builds never fetch

`npm run build` in every repo reads only committed files. Syncing is a separate, deliberate,
locally-run command. This is what makes each repo independently deployable and what guarantees an
upstream problem can never break a deploy.

### 2. Canonical sources, vendored inputs

- Smartify line: `smartify-product-catalog/products/<slug>/product.json` remains canonical;
  `products.json` is its build artifact.
- **Vendor the source CSV** into `smartify-product-catalog/data/sources/product-glossary.csv` and
  point `generate_catalog.py` at it. Remove the `~/Downloads` dependency.
- Reseller range: `smartify-website/src/data/cache/products.json` is canonical **by adoption**. Its
  original upstream (the WooCommerce store) is retired, so the committed file is the source of
  record, not a copy of anything.
- **Vendor every `smartify-business` input** into `smartify-business/data/sources/`:
  - `products-with-pricing.tsv` and `business-smartify-export.xml` from `Smartify-archive/`
  - a snapshot of the website's `products.json` (584) and `image-url-mapping.json`

  The last two matter: `prepare-data.js` reads them today for descriptions and CDN image URLs, so
  vendoring only the archive files would leave `smartify-business` still coupled to
  `smartify-website`. The snapshot is refreshed by an explicit `sync-retail-cache` command under
  the same delta gate, never at build time.

### 3. Publication and provenance

`smartify-product-catalog` publishes on release: `products.json`, `schema.json`, `checksums.txt`,
tagged `catalog-vX.Y.Z` as a GitHub Release.

Each consumer holds a `catalog.lock`:

```json
{ "version": "v1.4.0", "sha256": "…", "records": 47, "syncedAt": "2026-08-06" }
```

and each generated artifact holds a sibling `<name>.source.json` recording source repo, path,
sha256, upstream commit, generator, record count and timestamp.

CI cannot see the upstream repo, so CI verification is **self-consistency**: artifact vs its own
recorded checksum and record count. That still catches truncation, corruption and stray hand-edits.

### 4. Sync, with a delta gate

```bash
npm run sync-catalog                  # pull pinned version, validate, gate, write
npm run sync-catalog -- --to v1.5.0   # deliberate upgrade
```

Pulls over HTTPS from the release. No sibling checkout required anywhere.

Before writing, the gate compares proposed output against the committed artifact and **refuses**
when any of these hold:

- a slug in the committed artifact is absent from the new output
- the record count decreases
- any record loses a previously non-empty `description`, `images`, `price` or `sku`

On refusal it prints the exact records and fields that would be lost and exits non-zero.
`--allow-removals` overrides, printing the full removal list first.

This is the rule that turns today's bug into a caught error: the run dies with
`371 → 0 records, 371 slugs would disappear` instead of committing a wipe.

### 5. Verification in `prebuild`

`verify-catalog` runs before every build and asserts:

- the artifact parses and validates against the committed JSON Schema
- record count matches `catalog.lock` / `.source.json`
- required fields are present on every record
- no image URL points at the dead WordPress host
- the checksum is self-consistent

A bad artifact fails the local build rather than shipping.

### 6. No silent degradation

Every sync and generator script throws on missing or malformed input. No `catch { return {} }`,
no `console.warn` followed by continuing. This rule applies to all scripts touched by this work.

## Per-repo changes

| Repo | Changes |
|---|---|
| `smartify-product-catalog` | vendor source CSV; JSON Schema; `checksums.txt`; release workflow |
| `smartify-website` | `sync-catalog` + `catalog.lock` for the 47-SKU copy; `verify-catalog` in `prebuild` |
| `smartify-business` | vendor TSV/XML **and** the retail cache snapshot; rewrite `prepare-data.js` around the delta gate; add `sync-retail-cache`; `verify-catalog`; add a `verify-deploy` gate (currently has none) |
| `smartify-docs` | `sync-catalog` + lock before `generate_docs.py` |
| `smartify-pro-frontend` | delta gate on `sync-public-catalog-descriptions.mjs` |
| feeds (`facebook-catalog-push.js`, `google-merchant-feed.js`) | delta gate — highest stakes, since silent loss pulls products from live ad campaigns |

## Sequencing

Each step ships independently and leaves every repo working:

1. `smartify-product-catalog` — vendor CSV, schema, checksums, release
2. `smartify-website` — sync + verify
3. `smartify-business` — vendor sources, rewrite sync, verify, deploy gate
4. `smartify-docs`, `smartify-pro`, feeds

## Verification

- Unit tests for the delta gate: removed slug, reduced count, emptied field, and the legitimate
  no-change and additions-only cases.
- A regression test reproducing today's failure: point a sync at a missing source and assert it
  exits non-zero and leaves the committed artifact byte-identical.
- Each repo builds from a clean clone with no siblings present.

## Risks

- **Vendored archive files add repo weight.** The TSV and XML are one-time static costs; acceptable
  against a repo that cannot build alone.
- **A pinned lockfile can go stale silently.** Mitigation: `sync-catalog --check` reports drift
  without writing, suitable for a periodic reminder rather than a build gate.
- **The delta gate can block a legitimate discontinuation.** That is the intended trade-off;
  `--allow-removals` exists for it and prints what it is removing.

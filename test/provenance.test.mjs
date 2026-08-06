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

const record = (slug) => ({ slug });

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
  let error;
  try {
    verifyProvenance(artifact);
    assert.fail('expected verifyProvenance to throw');
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ProvenanceError);
  assert.match(error.message, /checksum/i);
});

test('verifyProvenance detects a stale record count even when the digest matches', () => {
  // The realistic tampering case: someone edits the artifact and updates the
  // sidecar's sha256 to match, but leaves `records` stale. The checksum check
  // passes, so only the record-count check can catch it.
  const artifact = fixture([record('one')]);
  writeProvenance({ artifactPath: artifact, generator: 'test', records: 1 });
  const sidecar = artifact.replace(/\.json$/, '.source.json');
  writeFileSync(artifact, JSON.stringify([record('one'), record('two')]));
  const meta = JSON.parse(readFileSync(sidecar, 'utf8'));
  meta.sha256 = sha256OfFile(artifact);
  writeFileSync(sidecar, JSON.stringify(meta));
  assert.throws(() => verifyProvenance(artifact), ProvenanceError);
});

test('a non-.json artifact path is rejected rather than overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  const artifact = join(dir, 'products.txt');
  writeFileSync(artifact, 'not json');
  assert.throws(
    () => writeProvenance({ artifactPath: artifact, generator: 'test', records: 0 }),
    ProvenanceError
  );
  assert.equal(readFileSync(artifact, 'utf8'), 'not json');
});

test('verifyProvenance fails when the sidecar is missing', () => {
  const artifact = fixture([{ slug: 'x' }]);
  assert.throws(() => verifyProvenance(artifact), ProvenanceError);
});

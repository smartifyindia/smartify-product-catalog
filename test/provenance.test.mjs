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

test('verifyProvenance fails when the sidecar is missing', () => {
  const artifact = fixture([{ slug: 'x' }]);
  assert.throws(() => verifyProvenance(artifact), ProvenanceError);
});

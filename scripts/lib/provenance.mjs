/**
 * Provenance sidecars. CI can never see the upstream repo, so verification is
 * self-consistency: does this artifact still match the digest and record count
 * recorded when it was generated? That catches truncation, corruption and
 * hand-edits, which are the realistic failure modes.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export class ProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

const sidecarPath = (artifactPath) => {
  // Without this guard a non-.json path returns unchanged, and writeProvenance
  // would overwrite the artifact itself with its own metadata — silent
  // destruction of the very file it exists to protect.
  if (!artifactPath.endsWith('.json')) {
    throw new ProvenanceError(
      `Artifact path must end in .json, got: ${artifactPath}. ` +
        `The sidecar is derived from this path, so a non-.json artifact would ` +
        `be overwritten by its own provenance record.`
    );
  }
  return artifactPath.replace(/\.json$/, '.source.json');
};

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
    artifact: basename(artifactPath),
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
        `file has ${actualRecords}.\n` +
        `Rebuild the artifact rather than updating the sidecar to match.`
    );
  }
}

import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export function assertDeploymentContext(env, revision, currentMain) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'smartifyindia/smartify-product-catalog' ||
      env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
      env.CATALOGUE_PRODUCTION_APPROVED !== 'true' || !env.CLOUDFLARE_API_TOKEN ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || env.GITHUB_SHA !== revision || currentMain !== revision) {
    throw new Error('Deployment requires the approved GitHub production job at its exact main revision.');
  }
}

export async function verifyFile(path, record) {
  const info = await stat(path);
  if (info.size !== record.bytes) throw new Error(`PDF size mismatch: ${path}. Check Git LFS checkout.`);
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(5); await file.read(header, 0, 5, 0);
    if (header.toString() !== '%PDF-') throw new Error(`Not a PDF: ${path}`);
  } finally { await file.close(); }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  if (digest.digest('hex') !== record.sha256) throw new Error(`PDF checksum mismatch: ${path}`);
}

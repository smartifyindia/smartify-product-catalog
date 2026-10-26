import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertDeploymentContext, verifyFile } from '../scripts/guards.mjs';

const valid = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'smartifyindia/smartify-product-catalog',
  GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'a'.repeat(40),
  CATALOGUE_PRODUCTION_APPROVED: 'true', CLOUDFLARE_API_TOKEN: 'test-only' };
test('allows the approved production job on main', () => assert.doesNotThrow(() => assertDeploymentContext(valid, 'a'.repeat(40), 'a'.repeat(40))));
for (const [name, value] of [['GITHUB_ACTIONS','false'],['GITHUB_REF','refs/heads/feature'],
  ['GITHUB_REPOSITORY','someone/fork'],['GITHUB_EVENT_NAME','pull_request'],
  ['CATALOGUE_PRODUCTION_APPROVED',''],['CLOUDFLARE_API_TOKEN','']]) {
  test(`fails closed for invalid ${name}`, () => assert.throws(() => assertDeploymentContext({ ...valid, [name]: value }, 'a'.repeat(40), 'a'.repeat(40))));
}
test('rejects a source revision different from the workflow revision', () => assert.throws(() => assertDeploymentContext(valid, 'b'.repeat(40), 'a'.repeat(40))));
test('rejects an older approved run after main has advanced', () => assert.throws(() => assertDeploymentContext(valid, 'a'.repeat(40), 'b'.repeat(40))));
test('verifies input bytes and refuses corruption or an LFS pointer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalogue-'));
  try {
    const file = join(dir, 'test.pdf'); const data = Buffer.from('%PDF-1.4\nfixture\n%%EOF');
    const record = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    await writeFile(file, data); await assert.doesNotReject(() => verifyFile(file, record));
    await writeFile(file, 'version https://git-lfs.github.com/spec/v1');
    await assert.rejects(() => verifyFile(file, record));
    await writeFile(file, Buffer.alloc(data.length, 32));
    await assert.rejects(() => verifyFile(file, record));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects a missing remote main revision', () => assert.throws(() => assertDeploymentContext(valid, 'a'.repeat(40), undefined)));

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDeploymentContext, verifyFile } from './guards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assertDeploymentContext(process.env, revision, revision);
async function assertCurrentMain() {
  if (!process.env.GITHUB_TOKEN) throw new Error('GitHub read token is required to verify the current main revision');
  const response = await fetch('https://api.github.com/repos/smartifyindia/smartify-product-catalog/git/ref/heads/main', {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Cannot verify current main (HTTP ${response.status})`);
  assertDeploymentContext(process.env, revision, (await response.json()).object?.sha);
}
await assertCurrentMain();
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Source checkout is dirty');
const release = JSON.parse(await readFile(join(root, 'dist/release.json')));
if (release.commit !== revision) throw new Error('Build revision does not match checkout');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json')));
for (const item of Object.values(manifest.files)) await verifyFile(join(root, item.source), item);

const account = 'b9f8db8151b55e4e33b0190fd0805f38';
const bucket = 'smartify-catalogue-pdfs';
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
const existing = await fetch(`${api}/${bucket}`, { headers, signal: AbortSignal.timeout(30000) });
if (existing.status === 404) {
  const created = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ name: bucket }), signal: AbortSignal.timeout(30000) });
  if (!created.ok || !(await created.json()).success) throw new Error(`Bucket provisioning failed (HTTP ${created.status})`);
} else if (!existing.ok || !(await existing.json()).success) {
  throw new Error(`Cannot inspect catalogue bucket (HTTP ${existing.status}); check token permissions.`);
}

const wrangler = (...args) => execFileSync(process.execPath, [join(root, '../node_modules/wrangler/bin/wrangler.js'), ...args], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: 'false' }, timeout: 300000,
});
const temp = join(root, '.verify'); await mkdir(temp, { recursive: true });
try {
  for (const item of Object.values(manifest.files)) {
    const key = `${bucket}/files/${item.sha256}/${item.filename}`;
    wrangler('r2', 'object', 'put', key, '--file', join(root, item.source), '--content-type', 'application/pdf', '--cache-control', 'public, max-age=31536000, immutable', '--remote');
    const downloaded = join(temp, item.filename);
    wrangler('r2', 'object', 'get', key, '--file', downloaded, '--remote');
    await verifyFile(downloaded, item);
    console.log(`Uploaded PDF verified: ${item.filename}`);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
// Publication is deliberately last. Failed uploads never publish broken links.
await assertCurrentMain();
wrangler('deploy', '--config', 'wrangler.jsonc');

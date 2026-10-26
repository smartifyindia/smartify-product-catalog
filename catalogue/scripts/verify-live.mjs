import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const origin = 'https://catalog.smartify.in';
const release = JSON.parse(await readFile(new URL('../dist/release.json', import.meta.url)));
const expected = process.env.GITHUB_SHA;
if (!expected || release.commit !== expected) throw new Error('Expected workflow revision is required');
const get = (path, options = {}) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(180000) });
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const r = await get(`/release.json?revision=${expected}`);
    if (r.ok && (await r.json()).commit === expected) { ready = true; break; }
  } catch { /* DNS/certificate propagation can be briefly delayed on the first release. */ }
  await new Promise(resolve => setTimeout(resolve, 10000));
}
if (!ready) throw new Error('Live revision did not become ready. Inspect CI/Cloudflare; do not deploy manually.');
const landing = await get('/');
if (!landing.ok || !landing.headers.get('Content-Type')?.includes('text/html')) throw new Error('Landing page not available');
const html = await landing.text();
for (const item of Object.values(release.files)) {
  const path = `/files/${item.sha256}/${item.filename}`;
  if (!html.includes(path)) throw new Error(`Landing page missing ${item.filename}`);
  const head = await get(path, { method: 'HEAD' });
  if (head.status !== 200 || head.headers.get('Content-Type') !== 'application/pdf' || Number(head.headers.get('Content-Length')) !== item.bytes) throw new Error('Live PDF metadata mismatch');
  const partial = await get(path, { headers: { Range: 'bytes=0-4' } });
  if (partial.status !== 206 || partial.headers.get('Content-Range') !== `bytes 0-4/${item.bytes}` || await partial.text() !== '%PDF-') throw new Error('Live PDF byte-range check failed');
  const download = await get(`${path}?download=1`, { method: 'HEAD' });
  if (download.status !== 200 || !download.headers.get('Content-Disposition')?.startsWith('attachment;')) throw new Error('Download response is not an attachment');
  const r = await get(path);
  if (r.status !== 200) throw new Error('Live PDF download failed');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of r.body) { hash.update(chunk); bytes += chunk.length; }
  if (bytes !== item.bytes || hash.digest('hex') !== item.sha256) throw new Error('Live PDF checksum mismatch');
  console.log(`Verified live ${item.filename}: ${bytes} bytes`);
}
console.log(`Verified live catalogue revision ${expected}`);

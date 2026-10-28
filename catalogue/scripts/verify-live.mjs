import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const origin = 'https://catalog.smartify.in';
const release = JSON.parse(await readFile(new URL('../dist/release.json', import.meta.url)));
const expected = process.env.GITHUB_SHA;
if (!expected || release.commit !== expected) throw new Error('Expected workflow revision is required');
// Cloudflare's bot checks answer the bare `node` User-Agent from CI with 403, so identify the check.
const agent = 'Mozilla/5.0 (compatible; SmartifyCatalogueVerify/1.0; +https://github.com/smartifyindia/smartify-product-catalog)';
const get = (path, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { 'User-Agent': agent, ...options.headers }, signal: AbortSignal.timeout(180000) });
let ready = false, last = 'no response';
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    // A fresh query per attempt: the edge caches release.json by URL, so a stale answer would otherwise stick.
    const r = await get(`/release.json?revision=${expected}&attempt=${attempt}-${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
    const body = r.ok ? await r.json() : null;
    const detail = r.ok ? '' : `, server ${r.headers.get('server')}, mitigated ${r.headers.get('cf-mitigated')}, body ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
    last = `HTTP ${r.status}, cache ${r.headers.get('cf-cache-status')}, ray ${r.headers.get('cf-ray')}, commit ${body?.commit}${detail}`;
    if (body?.commit === expected) { ready = true; break; }
  } catch (error) { last = `fetch failed: ${error.cause?.code || error.message}`; /* DNS/certificate propagation can be briefly delayed on the first release. */ }
  if (attempt % 5 === 0) console.log(`Waiting for ${expected.slice(0, 7)}: ${last}`);
  await new Promise(resolve => setTimeout(resolve, 10000));
}
if (!ready) throw new Error(`Live revision did not become ready (last answer: ${last}). Inspect CI/Cloudflare; do not deploy manually.`);
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
// A page link must be its own HTML page whose preview image is that page, since WhatsApp never runs the viewer.
const { pages } = JSON.parse(await readFile(new URL('../dist/pages.json', import.meta.url)));
const sample = pages.find(entry => entry.slug === 'convergia') || pages[0];
const linked = await get(`/p/${sample.slug}`);
const linkedHtml = await linked.text();
if (!linked.ok || !linkedHtml.includes(`property="og:image" content="https://catalog.smartify.in/previews/${sample.slug}.jpg"`)) throw new Error(`Page link /p/${sample.slug} is missing its own preview tags`);
const preview = await get(`/previews/${sample.slug}.jpg`);
if (!preview.ok || preview.headers.get('Content-Type') !== 'image/jpeg' || (await preview.arrayBuffer()).byteLength < 5000) throw new Error('Page preview image is not a JPEG');
console.log(`Verified live page link /p/${sample.slug}`);
console.log(`Verified live catalogue revision ${expected}`);

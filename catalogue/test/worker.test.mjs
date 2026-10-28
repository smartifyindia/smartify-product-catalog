import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

const key = `files/${'a'.repeat(64)}/SmartifyB2C-mobile.pdf`;
let mf;
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: fileURLToPath(new URL('../worker.mjs', import.meta.url)),
    compatibilityDate: '2026-10-01', r2Buckets: ['CATALOGUE'],
    serviceBindings: { ASSETS: request => {
      const path = new URL(request.url).pathname;
      if (path === '/p/missing') return new Response('Not found', { status: 404 });
      return new Response(path === '/p/convergia' ? '<html>Convergia</html>' : '<html>Catalogue</html>', { headers: { 'Content-Type': 'text/html' } });
    } } }));
  const bucket = await mf.getR2Bucket('CATALOGUE');
  await bucket.put(key, '%PDF-1.7\n0123456789');
});
after(async () => { await mf?.dispose(); });
const get = (path = `/${key}`, options) => mf.dispatchFetch(`https://catalog.smartify.in${path}`, options);

test('serves PDF inline with size and immutable caching', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'application/pdf');
  assert.equal(r.headers.get('Content-Length'), '19');
  assert.match(r.headers.get('Cache-Control'), /immutable/);
  assert.match(r.headers.get('Content-Disposition'), /^inline;/);
  assert.equal(await r.text(), '%PDF-1.7\n0123456789');
});
test('download query uses attachment while preserving the bytes', async () => {
  const r = await get(`/${key}?download=1`);
  assert.match(r.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(await r.text(), '%PDF-1.7\n0123456789');
});
test('HEAD returns metadata and no body even with a Range header', async () => {
  const r = await get(undefined, { method: 'HEAD', headers: { Range: 'bytes=0-4' } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Length'), '19');
  assert.equal(await r.text(), '');
});
for (const [range, body, contentRange] of [
  ['bytes=0-4', '%PDF-', 'bytes 0-4/19'],
  ['bytes=14-', '56789', 'bytes 14-18/19'],
  ['bytes=-3', '789', 'bytes 16-18/19'],
  ['bytes=15-100', '6789', 'bytes 15-18/19'],
]) test(`supports resumable download ${range}`, async () => {
  const r = await get(undefined, { headers: { Range: range } });
  assert.equal(r.status, 206); assert.equal(r.headers.get('Content-Range'), contentRange);
  assert.equal(r.headers.get('Content-Length'), String(body.length)); assert.equal(await r.text(), body);
});
for (const range of ['bytes=99-', 'bytes=8-2', 'bytes=-0', 'bytes=nope', 'bytes=0-1,4-5']) {
  test(`rejects unsupported or unsatisfiable range ${range}`, async () => {
    const r = await get(undefined, { headers: { Range: range } });
    assert.equal(r.status, 416); assert.equal(r.headers.get('Content-Range'), 'bytes */19');
  });
}
test('conditional GET returns 304 for a matching ETag', async () => {
  const first = await get(); const etag = first.headers.get('ETag'); await first.body.cancel();
  const r = await get(undefined, { headers: { 'If-None-Match': etag } });
  assert.equal(r.status, 304); assert.equal(await r.text(), '');
});
test('If-Range mismatch returns the full PDF', async () => {
  const r = await get(undefined, { headers: { Range: 'bytes=0-4', 'If-Range': '"old"' } });
  assert.equal(r.status, 200); assert.equal(await r.text(), '%PDF-1.7\n0123456789');
});
test('unknown PDF and arbitrary bucket paths are 404, never the HTML fallback', async () => {
  assert.equal((await get(`/${key.replace('mobile', 'full-quality')}`)).status, 404);
  assert.equal((await get('/files/private.txt')).status, 404);
});
test('write methods are not permitted', async () => {
  const r = await get(undefined, { method: 'DELETE' });
  assert.equal(r.status, 405); assert.equal(r.headers.get('Allow'), 'GET, HEAD');
});
test('page responses revalidate and include security headers', async () => {
  const r = await get('/');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-cache');
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});
test('reader can load same-origin modules and its PDF worker without allowing remote scripts', async () => {
  const policy = (await get('/')).headers.get('Content-Security-Policy');
  const directives = Object.fromEntries(policy.split(';').map(part => part.trim().split(/\s+/)).map(([key, ...values]) => [key, values]));
  assert.ok(directives['script-src'].includes("'self'"));
  assert.ok(directives['worker-src'].includes("'self'"));
  assert.ok(!directives['script-src'].includes("'unsafe-eval'"));
  assert.ok(!directives['script-src'].includes('*'));
});

test('serves a product link as its own page with the security headers', async () => {
  const r = await get('/p/convergia');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<html>Convergia</html>');
  assert.match(r.headers.get('Content-Security-Policy'), /default-src 'self'/);
});
test('a retired or mistyped product link opens the catalogue instead of a 404', async () => {
  const r = await get('/p/missing');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<html>Catalogue</html>');
});
test('product links are lower-case, so a capitalised link redirects', async () => {
  const r = await get('/p/Convergia', { redirect: 'manual' });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://catalog.smartify.in/p/convergia');
});

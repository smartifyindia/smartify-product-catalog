const PDF_PATH = /^\/files\/[a-f0-9]{64}\/SmartifyB2C-(?:mobile|full-quality)\.pdf$/;
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function rangeFor(value, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return null;
  let start, end;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(m[1]); end = m[2] ? Number(m[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { ...SECURITY, Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    }
    if (!url.pathname.startsWith('/files/')) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(SECURITY)) headers.set(key, value);
      headers.set('Cache-Control', 'no-cache');
      return new Response(response.body, { status: response.status, headers });
    }
    if (!PDF_PATH.test(url.pathname)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    try {
      const key = url.pathname.slice(1);
      const object = await env.CATALOGUE.head(key);
      if (!object) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const filename = key.split('/').at(-1);
      const headers = new Headers({
        'Content-Type': 'application/pdf',
        'Content-Length': String(object.size),
        'Accept-Ranges': 'bytes',
        ETag: object.httpEtag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
      });
      const condition = request.headers.get('If-None-Match');
      if (condition && (condition === '*' || condition.split(',').some(v => v.trim().replace(/^W\//, '') === object.httpEtag))) {
        headers.delete('Content-Length');
        return new Response(null, { status: 304, headers });
      }
      if (request.method === 'HEAD') return new Response(null, { headers });
      let range;
      const requestedRange = request.headers.get('Range');
      const ifRange = request.headers.get('If-Range');
      if (requestedRange && (!ifRange || ifRange === object.httpEtag)) {
        range = rangeFor(requestedRange, object.size);
        if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${object.size}`, 'Cache-Control': 'no-store' } });
        headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
        headers.set('Content-Length', String(range.length));
      }
      const result = await env.CATALOGUE.get(key, range ? { range } : undefined);
      if (!result) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      return new Response(result.body, { status: range ? 206 : 200, headers });
    } catch {
      return new Response('Catalogue temporarily unavailable. Please try again.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
    }
  },
};

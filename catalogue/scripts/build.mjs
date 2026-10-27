import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyFile } from './guards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json')));
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.version) || !Number.isInteger(manifest.pages) || manifest.pages < 1) throw new Error('Invalid catalogue metadata');
for (const [variant, filename] of [['mobile', 'SmartifyB2C-mobile.pdf'], ['full', 'SmartifyB2C-full-quality.pdf']]) {
  const item = manifest.files[variant];
  if (item.filename !== filename || item.source !== `files/${filename}` || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1) throw new Error('Invalid PDF manifest');
  await verifyFile(join(root, item.source), item);
}
const out = join(root, 'dist');
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
// Self-host the pinned reader, including its fonts and image decoders.
const pdfjs = join(root, '../node_modules/pdfjs-dist');
const vendor = join(out, 'vendor/pdfjs');
await mkdir(vendor, { recursive: true });
for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  await cp(join(pdfjs, 'legacy/build', name), join(vendor, name));
}
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) {
  await cp(join(pdfjs, name), join(vendor, name), { recursive: true });
}
await cp(join(pdfjs, 'web/pdf_viewer.css'), join(vendor, 'pdf_viewer.css'));
const tokens = { VERSION: manifest.version, DATE: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${manifest.version}T00:00:00Z`)), PAGES: String(manifest.pages) };
for (const [variant, prefix] of [['mobile', 'MOBILE'], ['full', 'FULL']]) {
  const item = manifest.files[variant];
  tokens[`${prefix}_URL`] = `/files/${item.sha256}/${item.filename}`;
  tokens[`${prefix}_SIZE`] = (item.bytes / 1e6).toFixed(1);
}
let html = await readFile(join(out, 'index.html'), 'utf8');
for (const [key, value] of Object.entries(tokens)) html = html.replaceAll(`{{${key}}}`, value);
if (/\{\{/.test(html)) throw new Error('Unresolved page placeholder');
await writeFile(join(out, 'index.html'), html);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await writeFile(join(out, 'release.json'), JSON.stringify({ commit, version: manifest.version, files: manifest.files }, null, 2) + '\n');
console.log(`Catalogue built for ${commit}; both PDF checksums verified. PDFs remain outside static assets.`);

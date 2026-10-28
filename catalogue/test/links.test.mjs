import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fillTemplate, linkData, pageValues, rootValues, validateLinks } from '../scripts/links.mjs';

const read = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url)));
const manifest = await read('manifest.json');
const links = await read('pages.json');

test('the committed link map matches the catalogue PDF', () => {
  assert.equal(validateLinks(links, manifest).length, 59);
  const convergia = links.pages.find(entry => entry.slug === 'convergia');
  assert.equal(convergia.page, 47);
});
test('a changed PDF must be re-checked against the link map', () => {
  assert.throws(() => validateLinks({ ...links, pdfSha256: 'f'.repeat(64) }, manifest), /PDF changed/);
});
for (const [name, change] of [
  ['bad slug', { slug: 'Not OK' }], ['page 1', { page: 1 }], ['page past the end', { page: 61 }],
  ['fractional page', { page: 3.5 }], ['empty blurb', { blurb: ' ' }], ['empty title', { title: '' }],
]) {
  test(`rejects a link with ${name}`, () => {
    const entry = { ...links.pages[1], ...change };
    assert.throws(() => validateLinks({ ...links, pages: [links.pages[0], entry] }, manifest));
  });
}
test('rejects duplicate slugs and duplicate pages', () => {
  assert.throws(() => validateLinks({ ...links, pages: [links.pages[0], { ...links.pages[1], slug: links.pages[0].slug }] }, manifest), /Duplicate/);
  assert.throws(() => validateLinks({ ...links, pages: [links.pages[0], { ...links.pages[1], page: links.pages[0].page }] }, manifest), /Duplicate/);
});
test('slugs are unique and in page order', () => {
  const slugs = links.pages.map(entry => entry.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.deepEqual(links.pages.map(entry => entry.page), [...links.pages.map(entry => entry.page)].sort((a, b) => a - b));
});
test('a product page gets its own preview tags and escapes them', () => {
  const template = '<title>{{TITLE}}</title><meta content="{{OG_IMAGE}}"><b data-links="{{LINKS}}">';
  const entry = { page: 13, slug: 'tac-6-plus', title: 'TAC 6+ "x"', blurb: 'a & b' };
  const html = fillTemplate(template, { ...pageValues(entry), LINKS: JSON.stringify(linkData([entry])) });
  assert.match(html, /<title>TAC 6\+ &quot;x&quot; \| Smartify product catalogue<\/title>/);
  assert.match(html, /content="https:\/\/catalog\.smartify\.in\/previews\/tac-6-plus\.jpg"/);
  assert.match(html, /data-links="\[\[13,&quot;tac-6-plus&quot;,/);
});
test('the root page keeps the catalogue cover as its preview', () => {
  assert.equal(rootValues(manifest).OG_IMAGE, 'https://catalog.smartify.in/images/og-catalogue.jpg');
  assert.throws(() => fillTemplate('{{MISSING}}', {}), /Unresolved/);
});

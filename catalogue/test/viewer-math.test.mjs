import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ZOOM, clampView, fitSize, pageFromHash, pageFromPath, pathForPage, renderZoom, startPage, stepZoom, swipeDirection, titleForPage, zoomAt } from '../public/viewer-math.mjs';

const geometry = { stageWidth: 400, stageHeight: 300, width: 400, height: 225 };

test('fits a 16:9 page to a portrait phone by width and to a wide window by height', () => {
  const phone = fitSize(375, 600, 720, 405);
  assert.equal(phone.width, 375);
  assert.ok(Math.abs(phone.height - 210.9375) < 1e-9);
  const wide = fitSize(1400, 700, 720, 405, 16);
  assert.ok(Math.abs(wide.height - 668) < 1e-9 && Math.abs(wide.width / wide.height - 16 / 9) < 1e-9);
});

test('a degenerate stage never produces a zero or negative page', () => {
  const size = fitSize(0, 0, 720, 405, 16);
  assert.ok(size.width > 0 && size.height > 0);
});

test('panning is limited to the zoomed page and unzoomed pages stay centred', () => {
  assert.deepEqual(clampView({ zoom: 1, x: 90, y: -90 }, geometry), { zoom: 1, x: 0, y: 0 });
  // At 2x the page is 800x450 in a 400x300 stage: 200 px sideways, 75 px up or down.
  assert.deepEqual(clampView({ zoom: 2, x: 999, y: -999 }, geometry), { zoom: 2, x: 200, y: -75 });
  assert.equal(clampView({ zoom: 99, x: 0, y: 0 }, geometry).zoom, MAX_ZOOM);
});

test('zooming keeps the tapped point under the finger', () => {
  const view = { zoom: 1, x: 0, y: 0 };
  const next = zoomAt(view, 2, 100, 50, geometry);
  // The page point that was at (100, 50) must still be at (100, 50).
  assert.equal((100 - next.x) / next.zoom, 100);
  assert.equal((50 - next.y) / next.zoom, 50);
});

test('zooming back out recentres the page', () => {
  const zoomed = zoomAt({ zoom: 1, x: 0, y: 0 }, 3, 150, 80, geometry);
  assert.deepEqual(zoomAt(zoomed, 1, 150, 80, geometry), { zoom: 1, x: 0, y: 0 });
});

test('zoom buttons walk the preset levels and stop at the ends', () => {
  assert.equal(stepZoom(1, 1), 1.5);
  assert.equal(stepZoom(1.7, 1), 2);
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
  assert.equal(stepZoom(2, -1), 1.5);
  assert.equal(stepZoom(1, -1), 1);
});

test('render sharpness follows zoom but respects the pixel budget', () => {
  assert.equal(renderZoom(1, 375, 211, 2), 1);
  assert.equal(renderZoom(2.1, 375, 211, 2), 2.25);
  // 1400x788 at 2x is 4.4 MP, so only about 1.35x fits in 8 MP.
  assert.ok(renderZoom(5, 1400, 788, 2) < 1.4);
  assert.ok(renderZoom(5, 1400, 788, 2) >= 1);
});

test('swipes turn pages only when mostly horizontal', () => {
  assert.equal(swipeDirection(-80, 10, 400), 1);
  assert.equal(swipeDirection(80, -10, 400), -1);
  assert.equal(swipeDirection(-30, 2, 120), 1);   // quick flick
  assert.equal(swipeDirection(-30, 2, 600), 0);   // slow short drag
  assert.equal(swipeDirection(-80, 70, 300), 0);  // diagonal scroll
  assert.equal(swipeDirection(4, 0, 50), 0);      // tap
});

test('page links parse safely and stay inside the document', () => {
  assert.equal(pageFromHash('#page=12', 60), 11);
  assert.equal(pageFromHash('#page=999', 60), 59);
  assert.equal(pageFromHash('#page=0', 60), 0);
  for (const bad of ['', '#', '#page=', '#page=-3', '#page=1e3', '#other', '#page=1&x=2']) assert.equal(pageFromHash(bad, 60), 0);
});

const links = [[47, 'convergia', 'Convergia'], [13, 'tac-6-plus', 'TAC 6+']];
test('a product path opens that page, and unknown paths open the cover', () => {
  assert.equal(pageFromPath('/p/convergia', links, 60), 46);
  assert.equal(pageFromPath('/p/convergia/', links, 60), 46);
  assert.equal(pageFromPath('/p/tac-6-plus', links, 60), 12);
  for (const path of ['/', '/p/', '/p/nope', '/p/convergia/x', '/q/convergia', '/p/Convergia']) assert.equal(pageFromPath(path, links, 60), 0);
});
test('an explicit #page wins over the path', () => {
  assert.equal(startPage('#page=5', '/p/convergia', links, 60), 4);
  assert.equal(startPage('', '/p/convergia', links, 60), 46);
  assert.equal(startPage('#junk', '/p/convergia', links, 60), 46);
  assert.equal(startPage('', '/', links, 60), 0);
});
test('each page maps back to its shareable path and title', () => {
  assert.equal(pathForPage(0, links), '/');
  assert.equal(pathForPage(46, links), '/p/convergia');
  assert.equal(pathForPage(20, links), '/#page=21');
  assert.equal(titleForPage(46, links), 'Convergia');
  assert.equal(titleForPage(20, links), 'Smartify product catalogue');
});

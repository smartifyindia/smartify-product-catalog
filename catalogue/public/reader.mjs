import { MAX_ZOOM, clamp, clampView, fitSize, pageFromPath, pathForPage, renderZoom, startPage, stepZoom, swipeDirection, titleForPage, zoomAt } from './viewer-math.mjs';

const $ = selector => document.querySelector(selector);
const viewer = $('#viewer'), stage = $('#stage'), sheet = $('#sheet'), cover = $('#cover'), loading = $('#loading');
const counter = $('#counter'), currentLabel = $('#current'), status = $('#status'), notice = $('#notice');
const overview = $('#overview'), tiles = $('#tiles'), save = $('#save');
const buttons = { prev: $('#prev'), next: $('#next'), zoomIn: $('#zoom-in'), zoomOut: $('#zoom-out'), zoomLevel: $('#zoom-level') };
const SITE = 'https://catalog.smartify.in';
const links = JSON.parse(viewer.dataset.links || '[]');   // [[page, slug, title], ...]
const placeholderIndex = pageFromPath(location.pathname, links, Number(viewer.dataset.pages));   // the page the HTML's placeholder image shows

const count = Number(viewer.dataset.pages);
let pdf, pdfjs, ready = false;
let pageSize = { width: 720, height: 405 };   // replaced by the real first page
let box = { width: 0, height: 0 };            // the page's fitted size on the stage
let geometry = { stageWidth: 0, stageHeight: 0, width: 0, height: 0 };
let view = { zoom: 1, x: 0, y: 0 };
let index = 0, generation = 0, sharpenTimer = 0;
let shown = null;                              // cache entry currently on the stage
const cache = new Map();                       // page index -> { canvas, zoom, ratio, width }
const inflight = new Map();                    // page index -> { promise, task, zoom }
const ratio = () => Math.min(window.devicePixelRatio || 1, 2);

// ---- Layout -----------------------------------------------------------------

function layout() {
  const stageWidth = stage.clientWidth, stageHeight = stage.clientHeight;
  if (!stageWidth || !stageHeight) return false;
  const margin = stageWidth >= 940 ? 20 : 0;
  box = fitSize(stageWidth, stageHeight, pageSize.width, pageSize.height, margin);
  geometry = { stageWidth, stageHeight, width: box.width, height: box.height };
  Object.assign(sheet.style, {
    width: `${box.width}px`, height: `${box.height}px`,
    left: `${(stageWidth - box.width) / 2}px`, top: `${(stageHeight - box.height) / 2}px`,
  });
  return true;
}

function applyView() {
  view = clampView(view, geometry);
  sheet.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const zoomed = view.zoom > 1.001;
  stage.classList.toggle('zoomed', zoomed);
  buttons.zoomLevel.textContent = `${Math.round(view.zoom * 100)}%`;
  buttons.zoomIn.disabled = !ready || view.zoom >= MAX_ZOOM - 0.01;
  buttons.zoomOut.disabled = !ready || !zoomed;
  buttons.zoomLevel.disabled = !ready || !zoomed;
}

// ---- Rendering --------------------------------------------------------------

const fresh = entry => entry && entry.width === box.width && entry.ratio === ratio();

function load(i, zoom = 1) {
  const pending = inflight.get(i);
  if (pending && pending.zoom >= zoom) return pending.promise;
  const job = { zoom };
  job.promise = (async () => {
    const page = await pdf.getPage(i + 1);
    const dpr = ratio(), width = box.width;
    const viewport = page.getViewport({ scale: (width * zoom * dpr) / pageSize.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    job.task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    try { await job.task.promise; } finally { page.cleanup(); inflight.get(i) === job && inflight.delete(i); }
    const entry = { canvas, zoom, ratio: dpr, width };
    if (!(cache.get(i)?.zoom > zoom && fresh(cache.get(i)))) cache.set(i, entry);
    evict();
    return entry;
  })();
  inflight.set(i, job);
  return job.promise;
}

// Keep only the current page and its neighbours in memory.
function evict() {
  for (const key of cache.keys()) if (Math.abs(key - index) > 1) cache.delete(key);
  for (const [key, job] of inflight) if (Math.abs(key - index) > 2) { job.task?.cancel(); inflight.delete(key); }
}

function attach(entry) {
  shown?.canvas.remove();
  shown = entry;
  entry.canvas.setAttribute('aria-hidden', 'true');
  sheet.insertBefore(entry.canvas, loading);
  cover.hidden = true; loading.hidden = true;
}

async function show(target, { keepView = false } = {}) {
  if (!ready) return;
  index = clamp(target, 0, count - 1);
  const mine = ++generation;
  if (!keepView) view = { zoom: 1, x: 0, y: 0 };
  clearTimeout(sharpenTimer);
  applyView();
  currentLabel.textContent = index + 1;
  buttons.prev.disabled = $('#prev-edge').disabled = index === 0;
  buttons.next.disabled = $('#next-edge').disabled = index === count - 1;
  status.textContent = `Page ${index + 1} of ${count}`;
  history.replaceState(null, '', pathForPage(index, links));
  const hit = cache.get(index);
  if (fresh(hit)) attach(hit);
  else {
    $('#loading-page').textContent = index + 1;
    if (index !== placeholderIndex || shown) loading.hidden = false;   // the first visit keeps the page's own placeholder image in view
    try {
      const entry = await load(index);
      if (mine !== generation) return;
      attach(entry);
    } catch (error) {
      if (mine === generation && error?.name !== 'RenderingCancelledException') fail();
      return;
    }
  }
  if (view.zoom > 1.05) sharpen();
  for (const next of [index + 1, index - 1, index + 2]) {
    if (mine !== generation) return;
    if (next < 0 || next >= count || fresh(cache.get(next))) continue;
    try { await load(next); } catch { /* neighbours are a bonus; the real load reports errors */ }
  }
}

// After pinching in, redraw the page at the new zoom so text stays crisp.
function sharpen() {
  clearTimeout(sharpenTimer);
  sharpenTimer = setTimeout(async () => {
    const want = renderZoom(view.zoom, box.width, box.height, ratio());
    if (!shown || want <= shown.zoom * 1.1) return;
    const mine = generation, at = index;
    try {
      const entry = await load(at, want);
      if (mine === generation && at === index) attach(entry);
    } catch { /* a cancelled or failed redraw leaves the softer page in place */ }
  }, 220);
}

function fail() {
  notice.hidden = false;
  loading.hidden = true;
}

// ---- Zoom and gestures ------------------------------------------------------

function setZoom(zoom, px = 0, py = 0) {
  view = zoomAt(view, zoom, px, py, geometry);
  applyView(); sharpen();
}
const fromCentre = event => {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
};

const pointers = new Map();
let drag = null, pinch = null, lastTap = null;

stage.addEventListener('pointerdown', event => {
  if (!ready || event.target.closest('button')) return;
  stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = stage.getBoundingClientRect();
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, view: { ...view }, middle, rect };
    drag = null;
  } else if (pointers.size === 1) {
    drag = { x: event.clientX, y: event.clientY, time: event.timeStamp, view: { ...view }, moved: false };
  }
});

stage.addEventListener('pointermove', event => {
  const point = pointers.get(event.pointerId);
  if (!point) return;
  point.x = event.clientX; point.y = event.clientY;
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoom = clamp(pinch.view.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), 1, MAX_ZOOM);
    const px = pinch.middle.x - pinch.rect.left - pinch.rect.width / 2, py = pinch.middle.y - pinch.rect.top - pinch.rect.height / 2;
    view = zoomAt(pinch.view, zoom, px, py, geometry, { x: middle.x - pinch.middle.x, y: middle.y - pinch.middle.y });
    applyView();
  } else if (drag) {
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 8) drag.moved = true;
    if (view.zoom > 1.001 && drag.moved) {
      view = clampView({ zoom: view.zoom, x: drag.view.x + dx, y: drag.view.y + dy }, geometry);
      stage.classList.add('panning'); applyView();
    }
  }
});

function endPointer(event) {
  if (!pointers.has(event.pointerId)) return;
  const wasPinch = Boolean(pinch);
  pointers.delete(event.pointerId);
  stage.classList.remove('panning');
  if (wasPinch) {
    if (pointers.size < 2) pinch = null;
    const left = [...pointers.values()][0];
    drag = left ? { x: left.x, y: left.y, time: event.timeStamp, view: { ...view }, moved: true } : null;
    sharpen();
    return;
  }
  if (!drag || event.type === 'pointercancel') { drag = null; return; }
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y, elapsed = event.timeStamp - drag.time;
  const { moved } = drag; drag = null;
  if (!moved) return tap(event);
  if (view.zoom > 1.001) { sharpen(); return; }
  const turn = swipeDirection(dx, dy, elapsed);
  if (turn) show(index + turn);
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// Two quick taps zoom in on the spot, or back out if already zoomed.
function tap(event) {
  const now = event.timeStamp;
  if (lastTap && now - lastTap.time < 320 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 32) {
    lastTap = null;
    const point = fromCentre(event);
    setZoom(view.zoom > 1.001 ? 1 : 2.5, point.x, point.y);
  } else lastTap = { time: now, x: event.clientX, y: event.clientY };
}

stage.addEventListener('wheel', event => {
  if (!ready) return;
  if (event.ctrlKey) {            // trackpad pinch, or ctrl + wheel
    event.preventDefault();
    const point = fromCentre(event);
    setZoom(clamp(view.zoom * Math.exp(-event.deltaY * 0.01), 1, MAX_ZOOM), point.x, point.y);
  } else if (view.zoom > 1.001) { // scrolling a zoomed page pans it
    event.preventDefault();
    view = clampView({ zoom: view.zoom, x: view.x - event.deltaX, y: view.y - event.deltaY }, geometry);
    applyView(); sharpen();
  }
}, { passive: false });

// ---- Controls ---------------------------------------------------------------

const step = direction => show(index + direction);
buttons.prev.addEventListener('click', () => step(-1));
buttons.next.addEventListener('click', () => step(1));
$('#prev-edge').addEventListener('click', () => step(-1));
$('#next-edge').addEventListener('click', () => step(1));
buttons.zoomIn.addEventListener('click', () => setZoom(stepZoom(view.zoom, 1)));
buttons.zoomOut.addEventListener('click', () => setZoom(stepZoom(view.zoom, -1)));
buttons.zoomLevel.addEventListener('click', () => setZoom(1));

document.addEventListener('keydown', event => {
  if (!ready || overview.open || save.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest?.('button, a')  && [' ', 'Enter'].includes(event.key)) return;
  const keys = {
    ArrowRight: () => view.zoom > 1.001 ? pan(-80, 0) : step(1), ArrowLeft: () => view.zoom > 1.001 ? pan(80, 0) : step(-1),
    ArrowDown: () => view.zoom > 1.001 ? pan(0, -80) : step(1), ArrowUp: () => view.zoom > 1.001 ? pan(0, 80) : step(-1),
    PageDown: () => step(1), PageUp: () => step(-1), ' ': () => step(event.shiftKey ? -1 : 1),
    Home: () => show(0), End: () => show(count - 1),
    '+': () => setZoom(stepZoom(view.zoom, 1)), '=': () => setZoom(stepZoom(view.zoom, 1)),
    '-': () => setZoom(stepZoom(view.zoom, -1)), '0': () => setZoom(1),
  };
  if (keys[event.key]) { event.preventDefault(); keys[event.key](); }
});
function pan(dx, dy) { view = clampView({ zoom: view.zoom, x: view.x + dx, y: view.y + dy }, geometry); applyView(); sharpen(); }

// Full screen where the browser supports it (not iPhone Safari, which has none).
const fullscreen = $('#fullscreen');
if (document.fullscreenEnabled) {
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : viewer.requestFullscreen());
}

// Share the permanent link for the page on screen, never the PDF, so an updated catalogue reaches everyone.
const toast = $('#toast');
let toastTimer = 0;
function say(message) {
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
}
$('#share').addEventListener('click', async () => {
  const url = SITE + pathForPage(index, links);
  const title = titleForPage(index, links);
  const text = index === 0 ? 'Smartify product catalogue' : `${title} | Smartify catalogue`;
  try {
    if (navigator.share) { await navigator.share({ title: text, text, url }); return; }
    await navigator.clipboard.writeText(url);
    say(index === 0 ? 'Link copied' : `Link to ${title} copied`);
  } catch (error) {
    if (error?.name !== 'AbortError') say(`Copy this link: ${url.replace('https://', '')}`);
  }
});

// ---- Dialogs ----------------------------------------------------------------

for (const dialog of [overview, save]) {
  dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('[data-close]')) dialog.close(); });
}
$('#open-save').addEventListener('click', () => save.showModal());

let thumbObserver, thumbQueue = [], thumbBusy = 0, built = false;
function buildTiles() {
  built = true;
  for (let i = 0; i < count; i++) {
    const item = document.createElement('li');
    const tile = document.createElement('button');
    tile.type = 'button'; tile.dataset.index = i; tile.setAttribute('aria-label', `Go to page ${i + 1}`);
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = Math.round(360 * pageSize.height / pageSize.width);
    const label = document.createElement('span'); label.textContent = i + 1;
    tile.className = 'tile'; tile.append(canvas, label); item.append(tile); tiles.append(item);
  }
}
function drawThumbs() {
  while (thumbBusy < 2 && thumbQueue.length) {
    const tile = thumbQueue.shift(); thumbBusy++;
    (async () => {
      const page = await pdf.getPage(Number(tile.dataset.index) + 1);
      const canvas = tile.querySelector('canvas');
      const viewport = page.getViewport({ scale: canvas.width / pageSize.width });
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      tile.dataset.drawn = '1'; page.cleanup();
    })().catch(() => {}).finally(() => { thumbBusy--; drawThumbs(); });
  }
}
function openOverview() {
  if (!built) buildTiles();
  overview.showModal();
  for (const tile of tiles.querySelectorAll('.tile')) tile.setAttribute('aria-current', String(Number(tile.dataset.index) === index));
  tiles.querySelector('[aria-current=true]').scrollIntoView({ block: 'center' });
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      thumbObserver.unobserve(entry.target);
      if (!entry.target.dataset.drawn) { thumbQueue.push(entry.target); drawThumbs(); }
    }
  }, { root: tiles, rootMargin: '300px' });
  for (const tile of tiles.querySelectorAll('.tile:not([data-drawn])')) thumbObserver.observe(tile);
}
overview.addEventListener('close', () => { thumbObserver?.disconnect(); thumbQueue = []; });
counter.addEventListener('click', openOverview);
tiles.addEventListener('click', event => {
  const tile = event.target.closest('.tile');
  if (tile) { overview.close(); show(Number(tile.dataset.index)); }
});

// A page link pasted into an already open tab should move the viewer too.
addEventListener('hashchange', () => {
  if (!ready) return;
  const wanted = startPage(location.hash, location.pathname, links, count);
  if (wanted !== index) show(wanted);
});

// ---- Start ------------------------------------------------------------------

async function start() {
  try {
    pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    pdf = await pdfjs.getDocument({
      url: viewer.dataset.pdf, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144,
      isEvalSupported: false, disableWorkerRendering: true,
      cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', iccUrl: '/vendor/pdfjs/iccs/',
    }).promise;
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    pageSize = { width: first.width, height: first.height };
    layout();
    ready = true;
    for (const control of [buttons.prev, buttons.next, counter]) control.disabled = false;
    const wanted = startPage(location.hash, location.pathname, links, pdf.numPages);
    await show(wanted);
  } catch (error) {
    fail();
  }
}

// Rotating a phone or resizing a window changes the fitted size, so redraw at it.
let resizeTimer = 0, lastSize = '';
new ResizeObserver(() => {
  const size = `${stage.clientWidth}x${stage.clientHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  if (!layout()) return;
  applyView();
  if (!ready) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { cache.clear(); show(index); }, 150);
}).observe(stage);

layout(); applyView();
start();

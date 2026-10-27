import { pageWindow } from './reader-window.mjs';
const reader = document.querySelector('.reader');
const viewport = document.querySelector('#catalogue');
const pagesElement = document.querySelector('#pages');
const pageInput = document.querySelector('#page-number');
const zoomInput = document.querySelector('#zoom');
const status = document.querySelector('#reader-status');
const placeholder = document.querySelector('#reader-placeholder');
let pdf, pdfjs, pageSize, pageWidth, pageHeight, generation = 0, running = false, scheduled = false;
let activeTask;
const pages = [], rendered = new Map();
let wanted = [];

function release(index) {
  const record = rendered.get(index);
  if (!record) return;
  record.textLayer?.cancel();
  record.canvas.width = record.canvas.height = 0;
  record.canvas.remove(); record.text?.remove();
  record.page.cleanup();
  pages[index].querySelector('.page-placeholder').hidden = false;
  rendered.delete(index);
}

function layout() {
  if (!pdf) return;
  const position = pageHeight ? Math.max(0, viewport.scrollTop - 16) / (pageHeight + 16) : 0;
  pageWidth = Math.max(240, Math.min(1040, viewport.clientWidth - 32)) * Number(zoomInput.value);
  pageHeight = pageWidth * pageSize.height / pageSize.width;
  generation++;
  activeTask?.cancel();
  for (const index of rendered.keys()) release(index);
  pagesElement.style.width = `${pageWidth + 32}px`;
  pagesElement.style.paddingBottom = `${Math.max(16, viewport.clientHeight - pageHeight)}px`;
  for (const page of pages) { page.style.width = `${pageWidth}px`; page.style.height = `${pageHeight}px`; }
  viewport.scrollTop = position * (pageHeight + 16) + 16;
  viewport.scrollLeft = 0;
  schedule();
}

function schedule() {
  if (scheduled || !pdf) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const window = pageWindow(viewport.scrollTop, viewport.clientHeight, pageHeight, pages.length);
    const current = window.current;
    wanted = window.indices;
    for (const index of rendered.keys()) if (!wanted.includes(index)) release(index);
    if (document.activeElement !== pageInput) pageInput.value = current + 1;
    void renderNext();
  });
}

async function renderNext() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const index = wanted.find(index => !rendered.has(index));
      if (index === undefined) break;
      const version = generation;
      const page = await pdf.getPage(index + 1);
      if (version !== generation || !wanted.includes(index)) { page.cleanup(); continue; }
      const view = page.getViewport({ scale: pageWidth / pageSize.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (view.width * view.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width * ratio); canvas.height = Math.ceil(view.height * ratio);
      canvas.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div'); text.className = 'textLayer';
      pages[index].style.setProperty('--total-scale-factor', view.scale);
      pages[index].append(canvas, text);
      const record = { page, canvas, text };
      try {
        activeTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] });
        await activeTask.promise;
        activeTask = null;
        if (version !== generation || !wanted.includes(index)) {
          canvas.width = canvas.height = 0; canvas.remove(); text.remove(); page.cleanup(); continue;
        }
        record.textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: view });
        await record.textLayer.render();
        if (version !== generation || !wanted.includes(index)) {
          record.textLayer.cancel(); canvas.width = canvas.height = 0; canvas.remove(); text.remove(); page.cleanup(); continue;
        }
        rendered.set(index, record);
        pages[index].querySelector('.page-placeholder').hidden = true;
        status.textContent = `Scroll through all ${pdf.numPages} pages. Zoom for a closer look.`;
      } catch (error) {
        activeTask = null;
        record.textLayer?.cancel(); canvas.width = canvas.height = 0; canvas.remove(); text.remove(); page.cleanup();
        if (error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') throw error;
      }
    }
  } catch {
    status.textContent = 'This page could not load. Scroll to retry, or open the PDF separately.';
  } finally { running = false; }
}

async function start() {
  status.textContent = 'Loading the catalogue…';
  try {
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/vendor/pdfjs/pdf_viewer.css'; document.head.append(stylesheet);
    pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    pdf = await pdfjs.getDocument({
      url: reader.dataset.pdf, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536,
      isEvalSupported: false, disableWorkerRendering: true,
      cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', iccUrl: '/vendor/pdfjs/iccs/',
    }).promise;
    pageSize = (await pdf.getPage(1)).getViewport({ scale: 1 });
    for (let index = 0; index < pdf.numPages; index++) {
      const page = document.createElement('div'); page.className = 'pdf-page';
      page.setAttribute('role', 'region'); page.setAttribute('aria-label', `Page ${index + 1}`);
      const label = document.createElement('span'); label.className = 'page-placeholder'; label.textContent = `Page ${index + 1}`;
      page.append(label); pagesElement.append(page); pages.push(page);
    }
    placeholder.hidden = true;
    pageInput.max = pdf.numPages;
    pageInput.disabled = zoomInput.disabled = document.querySelector('#page-go').disabled = false;
    layout();
    let lastWidth = viewport.clientWidth, lastHeight = viewport.clientHeight;
    new ResizeObserver(() => {
      if (viewport.clientWidth !== lastWidth || viewport.clientHeight !== lastHeight) {
        lastWidth = viewport.clientWidth; lastHeight = viewport.clientHeight; layout();
      }
    }).observe(viewport);
  } catch {
    status.textContent = 'The reader could not load. You can still open or download the PDF below.';
    placeholder.hidden = false;
  }
}
viewport.addEventListener('scroll', schedule, { passive: true });
zoomInput.addEventListener('change', layout);
document.querySelector('#page-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!pdf || !pageInput.checkValidity()) return;
  viewport.scrollTop = 16 + (Number(pageInput.value) - 1) * (pageHeight + 16);
  viewport.focus({ preventScroll: true }); schedule();
});
// Delay the PDF library and document until the reader is actually on screen.
const observer = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void start(); }
});
observer.observe(reader);

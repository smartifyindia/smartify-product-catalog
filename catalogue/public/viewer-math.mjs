// Pure geometry for the one-page-at-a-time viewer. Coordinates are CSS pixels;
// "stage" points are measured from the stage's centre, which is also the page's
// centre when the view is untouched.
export const MAX_ZOOM = 5;
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, MAX_ZOOM];

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Largest page that fits the stage with `margin` pixels to spare on each side.
export function fitSize(stageWidth, stageHeight, pageWidth, pageHeight, margin = 0) {
  const scale = Math.min(Math.max(1, stageWidth - margin * 2) / pageWidth, Math.max(1, stageHeight - margin * 2) / pageHeight);
  return { width: pageWidth * scale, height: pageHeight * scale };
}

// Keep a zoomed page from being dragged off the stage. An axis where the page is
// smaller than the stage stays centred.
export function clampView(view, { stageWidth, stageHeight, width, height }) {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const maxX = Math.max(0, (width * zoom - stageWidth) / 2);
  const maxY = Math.max(0, (height * zoom - stageHeight) / 2);
  return { zoom, x: clamp(view.x, -maxX, maxX) + 0, y: clamp(view.y, -maxY, maxY) + 0 };
}

// Zoom so the page point under (px, py) stays under it; `pan` moves that anchor
// (used while pinching, when the fingers' midpoint travels).
export function zoomAt(view, zoom, px, py, geometry, pan = { x: 0, y: 0 }) {
  const cx = (px - view.x) / view.zoom, cy = (py - view.y) / view.zoom;
  return clampView({ zoom, x: px + pan.x - cx * zoom, y: py + pan.y - cy * zoom }, geometry);
}

// Next preset zoom level above or below the current one.
export function stepZoom(zoom, direction) {
  if (direction > 0) return ZOOM_STEPS.find(step => step > zoom + 0.01) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find(step => step < zoom - 0.01) ?? 1;
}

// The sharpness to draw a page at: the current zoom in quarter steps, limited so a
// canvas never exceeds the pixel budget (phones run out of memory around 16 MP).
export function renderZoom(zoom, width, height, ratio, maxPixels = 8_000_000) {
  const budget = Math.sqrt(maxPixels / (width * height * ratio * ratio));
  return Math.max(1, Math.min(Math.ceil(zoom * 4) / 4, budget));
}

// -1 previous, 1 next, 0 not a page turn. A short fast flick counts at a smaller distance.
export function swipeDirection(dx, dy, milliseconds) {
  const far = Math.abs(dx) >= 56, flick = Math.abs(dx) >= 28 && milliseconds < 250;
  if ((!far && !flick) || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

// "#page=12" -> 11 (zero based), clamped to the document. Anything else -> 0.
export function pageFromHash(hash, count) {
  const match = /^#page=(\d{1,4})$/.exec(hash);
  return match ? clamp(Number(match[1]) - 1, 0, count - 1) : 0;
}

// ---- Page links ---------------------------------------------------------------
// links: [[page, slug, title], ...] with 1-based pages. /p/<slug> opens that page; page 1 is the root.

export function pageFromPath(pathname, links, count) {
  const match = /^\/p\/([a-z0-9-]+)\/?$/.exec(pathname);
  const link = match && links.find(item => item[1] === match[1]);
  return link ? clamp(link[0] - 1, 0, count - 1) : 0;
}

// An explicit #page=N wins (older shared links), then the product path, then the cover.
export function startPage(hash, pathname, links, count) {
  return /^#page=/.test(hash) ? pageFromHash(hash, count) : pageFromPath(pathname, links, count);
}

export function pathForPage(index, links) {
  const link = links.find(item => item[0] === index + 1);
  return index === 0 ? '/' : link ? `/p/${link[1]}` : `/#page=${index + 1}`;
}

export function titleForPage(index, links) {
  return links.find(item => item[0] === index + 1)?.[2] || 'Smartify product catalogue';
}

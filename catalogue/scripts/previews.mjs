import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const WIDTH = 1200, HEIGHT = 630;   // the size WhatsApp and most link previews show best

// Render the listed catalogue pages as 1200x630 JPEGs, so a shared link previews the page it points at.
export async function renderPreviews({ pdfPath, pdfjsDir, entries, outDir }) {
  const pdfjs = await import(join(pdfjsDir, 'legacy/build/pdf.mjs'));
  const { createCanvas } = require('@napi-rs/canvas');
  const sharp = require('sharp');
  const dir = path => `${join(pdfjsDir, path)}/`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(pdfPath)), isEvalSupported: false,
    cMapUrl: dir('cmaps'), cMapPacked: true, standardFontDataUrl: dir('standard_fonts'), wasmUrl: dir('wasm'), iccUrl: dir('iccs'),
  });
  const pdf = await task.promise;
  await mkdir(outDir, { recursive: true });
  for (const { page: number, slug } of entries) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    // The slide is 16:9 and the card is slightly wider, so the slide keeps full height with white margins.
    const slideWidth = Math.round(HEIGHT * base.width / base.height);
    const viewport = page.getViewport({ scale: (2 * HEIGHT) / base.height });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const slide = await sharp(canvas.toBuffer('image/png')).resize(slideWidth, HEIGHT).toBuffer();
    const jpeg = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#ffffff' } })
      .composite([{ input: slide, left: Math.round((WIDTH - slideWidth) / 2), top: 0 }])
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    await writeFile(join(outDir, `${slug}.jpg`), jpeg);
    page.cleanup();
  }
  await task.destroy();
}

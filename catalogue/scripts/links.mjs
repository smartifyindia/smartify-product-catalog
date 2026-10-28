// Per-page "hot links": https://catalog.smartify.in/p/<slug> opens the catalogue on that page and,
// because it is a real HTML file with its own tags, shows that page as the WhatsApp preview image.
export const SITE = 'https://catalog.smartify.in';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateLinks(links, manifest) {
  if (links?.pdfSha256 !== manifest.files.mobile.sha256) {
    throw new Error('The catalogue PDF changed since catalogue/pages.json was written. Check every page number and title in pages.json against the new PDF, then update pdfSha256.');
  }
  const slugs = new Set(), pages = new Set();
  for (const entry of links.pages) {
    if (!SLUG.test(entry.slug)) throw new Error(`Invalid link slug: ${entry.slug}`);
    if (!Number.isInteger(entry.page) || entry.page < 2 || entry.page > manifest.pages) throw new Error(`Link ${entry.slug} points outside the catalogue: page ${entry.page}`);
    if (!entry.title?.trim() || !entry.blurb?.trim()) throw new Error(`Link ${entry.slug} needs a title and blurb`);
    if (slugs.has(entry.slug) || pages.has(entry.page)) throw new Error(`Duplicate link: ${entry.slug} / page ${entry.page}`);
    slugs.add(entry.slug); pages.add(entry.page);
  }
  return links.pages;
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// [page, slug, title] triples, small enough to ride along in the page as one attribute.
export const linkData = pages => pages.map(({ page, slug, title }) => [page, slug, title]);

export function rootValues(manifest) {
  const size = (manifest.files.mobile.bytes / 1e6).toFixed(1);
  return {
    TITLE: 'Smartify product catalogue | Browse and download',
    DESCRIPTION: 'Flip through the Smartify catalogue on your phone. Swipe to turn pages, double-tap to zoom, or download the PDF.',
    OG_TITLE: 'Smartify product catalogue',
    OG_DESCRIPTION: `Flip through ${manifest.pages} pages of smart home products. Save the mobile PDF (${size} MB), or download the original.`,
    CANONICAL: `${SITE}/`,
    OG_IMAGE: `${SITE}/images/og-catalogue.jpg`,
    OG_IMAGE_ALT: 'Smartify product catalogue cover',
    COVER: '/images/catalogue-cover.webp',
  };
}

export function pageValues(entry) {
  const description = `${entry.title}: ${entry.blurb}. Specs and price on page ${entry.page} of the Smartify catalogue.`;
  const alt = `${entry.title} page from the Smartify catalogue`;
  return {
    TITLE: `${entry.title} | Smartify product catalogue`,
    DESCRIPTION: description,
    OG_TITLE: `${entry.title} | Smartify catalogue`,
    OG_DESCRIPTION: description,
    CANONICAL: `${SITE}/p/${entry.slug}`,
    OG_IMAGE: `${SITE}/previews/${entry.slug}.jpg`,
    OG_IMAGE_ALT: alt,
    COVER: `/previews/${entry.slug}.jpg`,
  };
}

export function fillTemplate(template, values) {
  let html = template;
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`{{${key}}}`, () => escapeHtml(value));
  if (/\{\{/.test(html)) throw new Error('Unresolved page placeholder');
  return html;
}

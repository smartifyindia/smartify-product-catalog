/**
 * Record-level validation for the catalog. Deliberately hand-written rather
 * than a JSON Schema library: this repo takes no npm dependencies, and the
 * rules are few enough to read at a glance.
 */

export const REQUIRED_FIELDS = [
  'sku',
  'name',
  'slug',
  'brand',
  'category',
  'description',
  'images',
];

export class CatalogSchemaError extends Error {
  constructor(problems) {
    super(`Catalog failed validation:\n  - ${problems.join('\n  - ')}`);
    this.name = 'CatalogSchemaError';
    this.problems = problems;
  }
}

// The `images` field's real shape varies: a flat array of strings, an array
// of { src } objects, or (in the committed catalog) an object like
// { hero, all, hero_url, all_urls }. Rather than assume one shape, walk
// whatever is there and pull out every string value to check.
function collectImageUrls(images) {
  const urls = [];
  const visit = (value) => {
    if (typeof value === 'string') {
      urls.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(images);
  return urls;
}

export function validateCatalog(records) {
  const problems = [];

  if (!Array.isArray(records)) {
    throw new CatalogSchemaError(['catalog is not an array']);
  }
  if (records.length === 0) {
    throw new CatalogSchemaError(['catalog is empty']);
  }

  const seen = new Set();
  for (const [i, record] of records.entries()) {
    const label = record?.slug || `record #${i}`;

    for (const field of REQUIRED_FIELDS) {
      const value = record?.[field];
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (missing) problems.push(`${label}: missing required field "${field}"`);
    }

    if (record?.slug) {
      if (seen.has(record.slug)) problems.push(`duplicate slug "${record.slug}"`);
      seen.add(record.slug);
    }

    for (const url of collectImageUrls(record?.images)) {
      if (url.includes('wp-content')) {
        problems.push(`${label}: image still points at the dead WordPress host (${url})`);
      }
    }

    // This catalog is published to a public repo and to the Facebook and Google
    // Merchant feeds. Dealer pricing was removed from the data in 1207bbf but
    // the generator kept emitting it; this rule is what makes that removal
    // permanent instead of a thing someone re-breaks by regenerating.
    if (record?.pricing && 'dealer_price_inr' in record.pricing) {
      problems.push(
        `${label}: pricing.dealer_price_inr must not appear in the public catalog`
      );
    }
  }

  if (problems.length > 0) throw new CatalogSchemaError(problems);
}

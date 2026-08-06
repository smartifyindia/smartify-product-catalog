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

// Same walker shape as collectImageUrls above, but collecting object keys
// instead of string leaves: pricing has been restructured before (nesting,
// renaming), and a flat 'dealer_price_inr' in record.pricing check would
// miss it if it ever moves under a nested object like pricing.tiers.
function collectKeys(value) {
  const keys = [];
  const visit = (v) => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (v && typeof v === 'object') {
      for (const [key, item] of Object.entries(v)) {
        keys.push(key);
        visit(item);
      }
    }
  };
  visit(value);
  return keys;
}

// Recursive emptiness, mirrored from scripts/lib/catalog-guard.mjs's isEmpty:
// a required field that is present but reduced to an empty container (e.g.
// images: {} or description: {}) is not meaningfully present, and the
// simple undefined/''/[] checks below don't catch that shape.
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty);
  if (typeof value === 'object') {
    const values = Object.values(value);
    return values.length === 0 || values.every(isEmpty);
  }
  return false;
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
      if (isEmpty(value)) problems.push(`${label}: missing required field "${field}"`);
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
    // permanent instead of a thing someone re-breaks by regenerating. Walk the
    // whole pricing value (mirroring collectImageUrls above) rather than
    // checking only the top level, so a nested or restructured pricing object
    // (e.g. pricing.tiers.dealer_price_inr) can't smuggle it through.
    if (record?.pricing && collectKeys(record.pricing).includes('dealer_price_inr')) {
      problems.push(
        `${label}: pricing.dealer_price_inr must not appear in the public catalog`
      );
    }
  }

  if (problems.length > 0) throw new CatalogSchemaError(problems);
}

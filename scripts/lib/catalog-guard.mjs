/**
 * The delta gate. Pure functions, no I/O, so it can be unit tested and reused
 * verbatim by the other repos (each vendors its own copy — repos never import
 * across repo boundaries).
 */

export const GUARDED_FIELDS = ['description', 'images', 'pricing', 'sku'];

export class CatalogDataLossError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'CatalogDataLossError';
    this.details = details;
  }
}

const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

export function diffCatalogs(previous, next) {
  const nextBySlug = new Map(next.map((r) => [r.slug, r]));
  const removedSlugs = [];
  const emptiedFields = [];

  for (const before of previous) {
    const after = nextBySlug.get(before.slug);
    if (!after) {
      removedSlugs.push(before.slug);
      continue;
    }
    for (const field of GUARDED_FIELDS) {
      if (!isEmpty(before[field]) && isEmpty(after[field])) {
        emptiedFields.push({ slug: before.slug, field });
      }
    }
  }

  return {
    removedSlugs,
    countDelta: next.length - previous.length,
    emptiedFields,
  };
}

export function assertNoDataLoss(previous, next, { allowRemovals = false } = {}) {
  const details = diffCatalogs(previous, next);
  if (allowRemovals) return;

  const problems = [];
  if (details.removedSlugs.length > 0) {
    const noun = details.removedSlugs.length === 1 ? 'record' : 'records';
    problems.push(
      `${details.removedSlugs.length} ${noun} would disappear: ` +
        details.removedSlugs.join(', ')
    );
  }
  if (details.countDelta < 0) {
    problems.push(
      `record count would drop by ${Math.abs(details.countDelta)} ` +
        `(${previous.length} → ${next.length})`
    );
  }
  if (details.emptiedFields.length > 0) {
    const noun = details.emptiedFields.length === 1 ? 'field' : 'fields';
    problems.push(
      `${details.emptiedFields.length} ${noun} would be emptied: ` +
        details.emptiedFields.map((f) => `${f.slug}.${f.field}`).join(', ')
    );
  }

  if (problems.length > 0) {
    throw new CatalogDataLossError(
      `Refusing to write: this would lose data.\n  - ${problems.join('\n  - ')}\n` +
        `If this removal is intentional, re-run with --allow-removals.`,
      details
    );
  }
}

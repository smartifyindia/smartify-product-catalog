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

// Emptiness is recursive on purpose. Every real record stores images as
// { hero, all, hero_url, all_urls }, so a container that still has its keys but
// has lost all its values is the realistic way image data disappears — a
// keys-only check would wave that through.
const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty);
  if (typeof value === 'object') {
    const values = Object.values(value);
    return values.length === 0 || values.every(isEmpty);
  }
  return false;
};

export function diffCatalogs(previous, next) {
  const nextBySlug = new Map(next.map((r) => [r.slug, r]));
  const removedSlugs = [];
  const emptiedFields = [];
  const changedSkus = [];

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
    // A price that goes null/missing inside a pricing object that still has
    // other keys would slip past the recursive check above.
    if (!isEmpty(before.pricing?.srp_inr) && isEmpty(after.pricing?.srp_inr)) {
      const already = emptiedFields.some((f) => f.slug === before.slug && f.field === 'pricing');
      if (!already) emptiedFields.push({ slug: before.slug, field: 'pricing.srp_inr' });
    }
    if (before.sku !== after.sku && !isEmpty(before.sku) && !isEmpty(after.sku)) {
      changedSkus.push({ slug: before.slug, from: before.sku, to: after.sku });
    }
  }

  return {
    removedSlugs,
    countDelta: next.length - previous.length,
    emptiedFields,
    changedSkus,
  };
}

export function assertNoDataLoss(previous, next, { allowRemovals = false, allowSkuChanges = false } = {}) {
  const details = diffCatalogs(previous, next);
  const problems = [];

  // --allow-removals is for retiring a product on purpose. It is NOT a licence
  // to wipe a field on a product that stays, so the emptiedFields check below
  // runs either way.
  if (!allowRemovals && details.removedSlugs.length > 0) {
    const noun = details.removedSlugs.length === 1 ? 'record' : 'records';
    problems.push(
      `${details.removedSlugs.length} ${noun} would disappear: ` +
        details.removedSlugs.join(', ')
    );
  }
  if (!allowRemovals && details.countDelta < 0) {
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
  // A changed SKU on a surviving slug re-keys the product in downstream feeds
  // (retailer_id / g:id), so it needs its own deliberate opt-in:
  // --allow-sku-changes. --allow-removals does not cover it.
  if (!allowSkuChanges && details.changedSkus.length > 0) {
    const noun = details.changedSkus.length === 1 ? 'SKU' : 'SKUs';
    problems.push(
      `${details.changedSkus.length} ${noun} would change: ` +
        details.changedSkus.map((c) => `${c.slug} (${c.from} → ${c.to})`).join(', ')
    );
  }

  if (problems.length > 0) {
    throw new CatalogDataLossError(
      `Refusing to write: this would lose data.\n  - ${problems.join('\n  - ')}\n` +
        `If this removal is intentional, re-run with --allow-removals.` +
        (!allowSkuChanges && details.changedSkus.length > 0
          ? `\nIf the SKU change is intentional, re-run with --allow-sku-changes.`
          : ''),
      details
    );
  }
}

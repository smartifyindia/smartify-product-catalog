/**
 * Version-aware publish logic for the agent catalog artifact. This module is
 * pure with respect to I/O: all reads/writes go through the injected `store`
 * (see `agent-catalog-store.mjs`), so it works identically against a local
 * disk store, a real R2 store, or an in-memory fake in tests.
 */

import { createHash } from 'node:crypto';
import { buildAgentCatalog, serializeAgentCatalog } from './agent-catalog.mjs';

const CURRENT_POINTER_KEY = 'agent-catalog/current.json';

/**
 * Builds the agent catalog artifact from `products`, then publishes it to
 * `store` if (and only if) its content differs from what's already
 * published. Returns `{ published, pointer }`.
 */
export function publishAgentCatalog(store, products, { createdAt } = {}) {
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    throw new Error('publishAgentCatalog: createdAt is required');
  }

  const artifact = buildAgentCatalog(products);
  const bytes = serializeAgentCatalog(artifact);
  const catalogHash = createHash('sha256').update(bytes).digest('hex');

  const existingRaw = store.get(CURRENT_POINTER_KEY);
  const existingPointer = existingRaw ? JSON.parse(existingRaw) : null;

  if (existingPointer && existingPointer.catalog_hash === catalogHash) {
    // Content hasn't changed — republishing is a no-op, and the version
    // number must not advance for identical content.
    return { published: false, pointer: existingPointer };
  }

  const catalogVersion = (existingPointer?.catalog_version ?? 0) + 1;
  const objectKey = `agent-catalog/${catalogHash}.json`;

  // Defensive: skip re-uploading identical bytes that already exist under
  // this content address. Unreachable in practice (the hash check above
  // already caught "nothing changed"), but a hash collision or an
  // out-of-band prior upload is a real edge case, not an error.
  if (store.get(objectKey) === null) {
    store.put(objectKey, bytes);
  }

  const pointer = {
    schema_version: artifact.schema_version,
    catalog_hash: catalogHash,
    catalog_version: catalogVersion,
    created_at: createdAt,
    object_key: objectKey,
  };
  store.put(CURRENT_POINTER_KEY, `${JSON.stringify(pointer, null, 2)}\n`);

  return { published: true, pointer };
}

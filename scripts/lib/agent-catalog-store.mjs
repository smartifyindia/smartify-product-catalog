/**
 * A tiny object-store abstraction shared by the local build script and the
 * (future) real-R2 publish pipeline. Both stores expose the same
 * `{ get(key), put(key, bytes) }` shape so `agent-catalog-publish.mjs` never
 * has to know which backend it's talking to.
 *
 * Keys are posix-style strings that always include the `agent-catalog/`
 * prefix, e.g. `"agent-catalog/current.json"` or
 * `"agent-catalog/<hash>.json"`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A filesystem-backed store rooted at `rootDir`. Keys are joined onto
 * `rootDir` as-is (they already carry the `agent-catalog/` prefix), so
 * callers pass the repository root here, not `<root>/agent-catalog`.
 */
export function createLocalStore(rootDir) {
  function pathFor(key) {
    return join(rootDir, ...key.split('/'));
  }

  return {
    get(key) {
      const path = pathFor(key);
      if (!existsSync(path)) return null;
      return readFileSync(path, 'utf8');
    },
    put(key, bytes) {
      const path = pathFor(key);
      const dir = dirname(path);
      mkdirSync(dir, { recursive: true });
      // Write-then-rename keeps this atomic even though immutable content
      // objects don't strictly need it — one code path for every key.
      const tempPath = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
      writeFileSync(tempPath, bytes);
      renameSync(tempPath, path);
    },
  };
}

/**
 * A Cloudflare R2-backed store, driven entirely through an injected `run`
 * function so this module never spawns a process itself (and so tests never
 * touch a real bucket). `run(args)` must behave like a synchronous wrapper
 * around `child_process.spawnSync('wrangler', args, { encoding: 'utf8' })`,
 * returning `{ stdout, status }`.
 */
export function createR2Store({ bucket, run }) {
  return {
    get(key) {
      const result = run(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--pipe']);
      if (result.status !== 0) return null;
      return result.stdout;
    },
    put(key, bytes) {
      const tempPath = join(tmpdir(), `agent-catalog-store-${randomBytes(6).toString('hex')}.tmp`);
      writeFileSync(tempPath, bytes);
      try {
        const result = run(['r2', 'object', 'put', `${bucket}/${key}`, '--file', tempPath, '--remote']);
        if (result.status !== 0) {
          throw new Error(
            `wrangler r2 object put failed for ${bucket}/${key} (exit ${result.status}): ${result.stdout}`
          );
        }
      } finally {
        try {
          unlinkSync(tempPath);
        } catch {
          // already removed — nothing left to clean up
        }
      }
    },
  };
}

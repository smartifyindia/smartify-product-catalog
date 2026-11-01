import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This repo is public; dealer (B2B) pricing must never be committed. Scans
// tracked data files (not docs/ or tests, which legitimately mention markers).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKERS = [/Dealer Price/i, /"DP"/, /dealer_price/i];
const ROOT_FILES = ['products.json', 'products.source.json'];
const DIRS = ['data', 'products'];

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
}

function candidateFiles() {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-z', '--', ...DIRS, ...ROOT_FILES], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    files = [];
    for (const d of DIRS) walk(join(root, d), files);
    files.push(...ROOT_FILES);
  }
  return files.filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());
}

test('no tracked data file contains a dealer-pricing marker', () => {
  const files = candidateFiles();
  assert.ok(files.length > 0, 'expected to find data files to scan');
  const hits = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const marker of MARKERS) {
      if (marker.test(text)) hits.push(`${file}: ${marker}`);
    }
  }
  assert.deepEqual(hits, [], `dealer pricing markers found:\n  ${hits.join('\n  ')}`);
});

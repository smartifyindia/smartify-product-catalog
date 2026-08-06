#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256OfFile } from './lib/provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['products.json', 'products.source.json'];
const lines = files.map((f) => `${sha256OfFile(join(root, f))}  ${basename(f)}`);
writeFileSync(join(root, 'checksums.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));

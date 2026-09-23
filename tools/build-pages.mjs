#!/usr/bin/env node

import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'dist');
const REQUIRED_FILES = ['index.html', 'thank-you.html', 'main.js', 'styles.css'];

if (path.relative(ROOT, OUTPUT) !== 'dist') {
  throw new Error('Refusing to build outside the project dist directory.');
}

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });

for (const file of REQUIRED_FILES) {
  await copyFile(path.join(ROOT, file), path.join(OUTPUT, file));
}

await cp(path.join(ROOT, 'assets'), path.join(OUTPUT, 'assets'), { recursive: true });
console.log(`Cloudflare Pages assets prepared in ${path.relative(ROOT, OUTPUT)}.`);

#!/usr/bin/env node
// Emit a DAM ingest manifest for the site's catalog images: maps each image
// (by basename) to its config identity + modules, so `dam ingest --meta` can
// stamp kind/configId/modules/variant onto the assets. Keeps the DAM generic —
// site-specific knowledge (shelving.html product→image mapping) lives here.
//
// Usage: node scripts/dam-export-catalog.mjs [--out dam-catalog-manifest.json]

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const PAGE = path.join(SITE, 'shelving.html');
const CONFIGS = path.join(SITE, 'configs');

const VARIANT_RE = /-(populated|emptied|angle|front|under-mdf|mdf-edge|foot|joint|source)\.[a-z]+$/i;

function extractConfigurations(text) {
  const m = text.match(/const configurations = (\[[\s\S]*?\]);\n\n    \/\* === Catalog \+ Lightbox === \*\//);
  if (!m) throw new Error('configurations array not found in shelving.html');
  return vm.runInNewContext(`(${m[1]})`, {}, { timeout: 1000 });
}

function modulesForConfig(id) {
  const p = path.join(CONFIGS, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  return (cfg.modules || []).map((m) => ({ type: m.type, finish: m.finish ?? cfg.defaultFinish ?? null }));
}

function variantOf(filename, isHero) {
  const m = filename.match(VARIANT_RE);
  if (m) return m[1].toLowerCase();
  return isHero ? 'hero' : 'other';
}

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(SITE, 'dam-catalog-manifest.json');
const products = extractConfigurations(fs.readFileSync(PAGE, 'utf8'));
const manifest = {};
let withModules = 0;

for (const p of products) {
  const modules = modulesForConfig(p.id);
  const imgs = [...new Set([p.image, ...(p.images || [])].filter(Boolean))];
  for (const rel of imgs) {
    const base = path.basename(rel);
    manifest[base] = {
      kind: 'catalog',
      configId: p.id,
      modules,
      variant: variantOf(base, rel === p.image),
    };
    if (modules) withModules += 1;
  }
}

fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({
  wrote: path.relative(SITE, out),
  images: Object.keys(manifest).length,
  withModules,
  products: products.length,
}, null, 2));

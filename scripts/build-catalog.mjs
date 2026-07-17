#!/usr/bin/env node
// build-catalog — regenerate the site catalog + Meta feed from catalog.json
// (the single source of truth). ACTIVE products become the live shelving.html
// `configurations` array and the Meta feed CSV; inactive products are kept in
// catalog.json (so they can be re-activated) but never shipped or advertised.
//
//   node scripts/build-catalog.mjs            # regenerate shelving.html + feed
//   node scripts/build-catalog.mjs --check    # verify catalog vs. site, no writes
//
// This replaces the ad-hoc array-splicing in import-shelving-product.mjs with a
// clean, deterministic regeneration — the robust long-term model.

import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const CATALOG = 'catalog.json';
const PAGE = 'shelving.html';
const FEED_SCRIPT = 'scripts/generate-meta-catalog-feed.mjs';
const CONFIG_IMAGE_DIR = 'images/shelving/configs';
const THUMB_DIR = 'images/shelving/configs/thumbs';
const CONFIG_RE = /const configurations = \[[\s\S]*?\];\n\n    \/\* === Catalog \+ Lightbox === \*\//;

const check = process.argv.includes('--check');

function readCatalog() {
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  if (!Array.isArray(cat.products)) throw new Error('catalog.json: products[] missing');
  const ids = new Set();
  for (const p of cat.products) {
    if (!p.id) throw new Error('catalog.json: a product is missing id');
    if (ids.has(p.id)) throw new Error(`catalog.json: duplicate id ${p.id}`);
    ids.add(p.id);
    const imgs = (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
    if (p.active && !imgs.length) throw new Error(`catalog.json: active product ${p.id} has no images`);
  }
  return cat;
}

// Match the field shape + formatting the site expects (mirrors the legacy import
// script so the array stays stable and the feed generator's regex keeps working).
function formatProduct(p, indent = '          ') {
  const images = (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
  const obj = {
    id: p.id,
    title: p.title || p.id,
    image: p.image || images[0],
    images,
    price: p.price || 'Price on request',
    priceValue: Number(p.priceValue) || 0,
    description: p.description || '',
  };
  // Only carry designerUrl when the product actually has one (accessories like
  // the bookend intentionally have no "open in designer" link).
  if (p.designerUrl) obj.designerUrl = p.designerUrl;
  const json = JSON.stringify(obj, null, 6);
  return json.split('\n').map((line, i) => (i === 0 ? `${indent}{` : `${indent}${line}`)).join('\n');
}

function currentSiteIds(pageText) {
  const m = pageText.match(/const configurations = (\[[\s\S]*?\]);\n\n    \/\* === Catalog \+ Lightbox === \*\//);
  if (!m) throw new Error(`could not find configurations array in ${PAGE}`);
  return vm.runInNewContext(`(${m[1]})`).map((c) => c.id);
}

function validateAssets(active) {
  const missing = [];
  for (const p of active) {
    const imgs = (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
    for (const image of new Set(imgs.concat(p.image).filter(Boolean))) {
      if (!fs.existsSync(image)) missing.push(image);
      const thumb = image.replace(`${CONFIG_IMAGE_DIR}/`, `${THUMB_DIR}/`);
      if (!fs.existsSync(thumb)) missing.push(thumb);
    }
  }
  return missing;
}

const cat = readCatalog();
const active = cat.products.filter((p) => p.active);
const pageText = fs.readFileSync(PAGE, 'utf8');

if (check) {
  const siteIds = currentSiteIds(pageText);
  const wantIds = active.map((p) => p.id);
  const same = siteIds.length === wantIds.length && siteIds.every((id, i) => id === wantIds[i]);
  const missing = validateAssets(active);
  console.log(JSON.stringify({
    catalog: cat.products.length, active: active.length, inactive: cat.products.length - active.length,
    siteInSync: same, siteIds: siteIds.length, missingAssets: missing,
  }, null, 2));
  if (!same || missing.length) process.exit(1);
} else {
  const missing = validateAssets(active);
  if (missing.length) { console.error('Missing catalog assets:\n' + missing.join('\n')); process.exit(1); }
  const arrayText = '[\n' + active.map((p) => formatProduct(p)).join(',\n') + '\n        ]';
  const next = pageText.replace(CONFIG_RE, `const configurations = ${arrayText};\n\n    /* === Catalog + Lightbox === */`);
  if (next === pageText && !CONFIG_RE.test(pageText)) throw new Error('configurations array not found — aborting');
  fs.writeFileSync(PAGE, next);
  const feed = JSON.parse(execFileSync('node', [FEED_SCRIPT], { encoding: 'utf8' }));
  console.log(JSON.stringify({ wrote: PAGE, active: active.length, inactive: cat.products.length - active.length, feed }, null, 2));
}

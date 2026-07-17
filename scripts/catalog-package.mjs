#!/usr/bin/env node
// catalog-package — import/export catalog product "packages" (the folder format
// the catalog tool generates: <id>.json + <id>-*.jpg source images).
//
//   node scripts/catalog-package.mjs import <folder|zip> [--inactive] [--no-build]
//   node scripts/catalog-package.mjs export <id> <destDir> [--zip]
//
// import  → resizes images into the repo, upserts the product in catalog.json,
//           and (unless --no-build) regenerates the site + feed.
// export  → writes a re-importable package (JSON + full-size images) for backup
//           or hand-off. Exported functions are reused by the runner's publish.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CATALOG = 'catalog.json';
const CONFIG_IMAGE_DIR = 'images/shelving/configs';
const THUMB_DIR = 'images/shelving/configs/thumbs';
const FULL_SIZE = '1400';
const THUMB_SIZE = '180';

const normImage = (p) => `${CONFIG_IMAGE_DIR}/${path.basename(String(p || ''))}`;
const normDesigner = (u) => (u ? String(u).replace(/^\/designer#/, 'designer.html#').replace(/^\/sandbox#/, 'sandbox.html#') : u);

function findPackageJson(folder) {
  const preferred = path.join(folder, `${path.basename(folder)}.json`);
  if (fs.existsSync(preferred)) return preferred;
  const jsons = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.json'));
  if (jsons.length !== 1) throw new Error(`Expected exactly one JSON in ${folder}, found ${jsons.length}`);
  return path.join(folder, jsons[0]);
}

export function readPackage(folder) {
  const jsonPath = findPackageJson(folder);
  const p = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const id = String(p.id || path.basename(folder)).trim();
  if (!id) throw new Error(`Missing id in ${jsonPath}`);
  const rawImages = Array.isArray(p.images) && p.images.length ? p.images : [p.image].filter(Boolean);
  if (!rawImages.length) throw new Error(`Missing images in ${jsonPath}`);
  return {
    id,
    title: p.title || id,
    image: normImage(p.image || rawImages[0]),
    images: rawImages.map(normImage),
    price: p.price || 'Price on request',
    priceValue: Number(p.priceValue) || 0,
    description: p.description || '',
    designerUrl: normDesigner(p.designerUrl) || undefined,
    _sourceFolder: folder,
  };
}

function resizeInto(source, target, size) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync('sips', ['-Z', size, source, '--out', target], { stdio: 'ignore' });
}

// Resize every package image into the repo (full + thumbnail).
export function importImages(product) {
  for (const target of [...new Set(product.images.concat(product.image))]) {
    const source = path.join(product._sourceFolder, path.basename(target));
    if (!fs.existsSync(source)) throw new Error(`Source image not found for ${product.id}: ${source}`);
    resizeInto(source, target, FULL_SIZE);
    resizeInto(source, target.replace(`${CONFIG_IMAGE_DIR}/`, `${THUMB_DIR}/`), THUMB_SIZE);
  }
}

// Upsert a product into catalog.json, preserving its active state if it already
// exists (new products default active unless {active:false}).
export function upsertCatalog(product, { active } = {}) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const entry = {
    id: product.id, title: product.title, price: product.price, priceValue: product.priceValue,
    description: product.description, image: product.image, images: product.images,
  };
  if (product.designerUrl) entry.designerUrl = product.designerUrl;
  const idx = cat.products.findIndex((p) => p.id === product.id);
  if (idx >= 0) {
    entry.active = active != null ? active : (cat.products[idx].active !== false);
    cat.products[idx] = { ...cat.products[idx], ...entry };
  } else {
    entry.active = active != null ? active : true;
    cat.products.push(entry);
  }
  cat.updatedAt = new Date().toISOString();
  fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 2) + '\n');
  return idx >= 0 ? 'updated' : 'added';
}

// Full import of a package directory: images + catalog upsert. Returns the action.
export function importPackageDir(folder, { active } = {}) {
  const product = readPackage(folder);
  importImages(product);
  return { id: product.id, action: upsertCatalog(product, { active }) };
}

function unzipToTemp(zipPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catpkg-'));
  execFileSync('unzip', ['-qq', '-o', zipPath, '-d', dir]);
  // The zip may contain a single top folder; descend into it if so.
  const entries = fs.readdirSync(dir).filter((e) => !e.startsWith('__'));
  if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) return path.join(dir, entries[0]);
  return dir;
}

export function exportPackage(id, destDir, { zip } = {}) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const p = cat.products.find((x) => x.id === id);
  if (!p) throw new Error(`No product ${id} in catalog.json`);
  const out = path.join(destDir, id);
  fs.mkdirSync(out, { recursive: true });
  const images = (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({
    id: p.id, title: p.title, image: p.image, images, price: p.price, priceValue: p.priceValue,
    description: p.description, ...(p.designerUrl ? { designerUrl: p.designerUrl } : {}),
  }, null, 2) + '\n');
  for (const img of new Set(images.concat(p.image).filter(Boolean))) {
    if (fs.existsSync(img)) fs.copyFileSync(img, path.join(out, path.basename(img)));
  }
  if (zip) execFileSync('zip', ['-qq', '-r', `${id}.zip`, id], { cwd: destDir });
  return { id, dir: out, images: images.length };
}

// --- CLI --------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'import') {
      let src = rest.find((a) => !a.startsWith('--'));
      const active = rest.includes('--inactive') ? false : undefined;
      if (!src) throw new Error('import needs a folder or zip path');
      if (src.toLowerCase().endsWith('.zip')) src = unzipToTemp(path.resolve(src));
      const res = importPackageDir(path.resolve(src), { active });
      if (!rest.includes('--no-build')) execFileSync('node', ['scripts/build-catalog.mjs'], { stdio: 'inherit' });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === 'export') {
      const [id, dest] = rest.filter((a) => !a.startsWith('--'));
      if (!id || !dest) throw new Error('export needs <id> <destDir>');
      console.log(JSON.stringify(exportPackage(id, path.resolve(dest), { zip: rest.includes('--zip') }), null, 2));
    } else {
      console.log('Usage: catalog-package.mjs import <folder|zip> [--inactive] [--no-build] | export <id> <destDir> [--zip]');
      process.exit(cmd ? 1 : 0);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}

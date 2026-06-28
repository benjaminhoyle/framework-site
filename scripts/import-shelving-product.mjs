#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const DEFAULT_CATALOG_ROOT = '/Users/ben/Library/CloudStorage/Dropbox/01_Current-Projects/Framework/05_Marketing/Website/260628_catalog-products';
const CONFIG_IMAGE_DIR = 'images/shelving/configs';
const THUMB_DIR = 'images/shelving/configs/thumbs';
const PAGE_PATH = 'shelving.html';
const FULL_SIZE = '1400';
const THUMB_SIZE = '180';

function usage() {
  console.log(`
Import one or more shelving product folders.

Usage:
  node scripts/import-shelving-product.mjs /path/to/product-folder
  node scripts/import-shelving-product.mjs --all

Options:
  --all                 Import every product folder in the catalog Dropbox folder.
  --catalog-root PATH   Folder to scan when using --all.
  --dry-run             Validate and preview the catalog update without writing files.
`);
}

function parseArgs(argv) {
  const args = {
    all: false,
    catalogRoot: DEFAULT_CATALOG_ROOT,
    dryRun: false,
    folders: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--catalog-root') {
      args.catalogRoot = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--catalog-root=')) {
      args.catalogRoot = arg.slice('--catalog-root='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      args.folders.push(arg);
    }
  }

  if (!args.all && args.folders.length === 0) {
    throw new Error('Pass a product folder path, or use --all.');
  }

  return args;
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function assertDir(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label} not found: ${dirPath}`);
  }
}

function findProductJson(folder) {
  const folderName = path.basename(folder);
  const preferred = path.join(folder, `${folderName}.json`);
  if (fs.existsSync(preferred)) return preferred;

  const jsonFiles = fs.readdirSync(folder)
    .filter((file) => file.toLowerCase().endsWith('.json'))
    .map((file) => path.join(folder, file));

  if (jsonFiles.length !== 1) {
    throw new Error(`Expected exactly one JSON file in ${folder}, found ${jsonFiles.length}.`);
  }

  return jsonFiles[0];
}

function normalizeDesignerUrl(url) {
  if (!url) return 'designer.html';
  return String(url)
    .replace(/^\/designer#/, 'designer.html#')
    .replace(/^\/sandbox#/, 'sandbox.html#')
    .replace(/^designer#/, 'designer.html#')
    .replace(/^sandbox#/, 'sandbox.html#');
}

function normalizeImagePath(imagePath) {
  const fileName = path.basename(String(imagePath || ''));
  if (!fileName) throw new Error(`Invalid image path: ${imagePath}`);
  return `${CONFIG_IMAGE_DIR}/${fileName}`;
}

function readProduct(folder) {
  const jsonPath = findProductJson(folder);
  const product = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const id = String(product.id || path.basename(folder)).trim();
  if (!id) throw new Error(`Missing product id in ${jsonPath}.`);

  const images = Array.isArray(product.images) && product.images.length
    ? product.images
    : [product.image].filter(Boolean);

  if (!images.length) throw new Error(`Missing product images in ${jsonPath}.`);

  return {
    id,
    title: product.title || id,
    image: normalizeImagePath(product.image || images[0]),
    images: images.map(normalizeImagePath),
    price: product.price || 'Price on request',
    priceValue: Number(product.priceValue) || 0,
    description: product.description || '',
    designerUrl: normalizeDesignerUrl(product.designerUrl),
    sourceFolder: folder,
    jsonPath
  };
}

function sourceImageFor(product, targetPath) {
  const fileName = path.basename(targetPath);
  const source = path.join(product.sourceFolder, fileName);
  assertFile(source, `Source image for ${product.id}`);
  return source;
}

function resizeImage(source, target, size, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync('sips', ['-Z', size, source, '--out', target], { stdio: 'ignore' });
}

function importImages(product, dryRun) {
  const imagePaths = [...new Set(product.images.concat(product.image))];
  for (const targetPath of imagePaths) {
    const source = sourceImageFor(product, targetPath);
    resizeImage(source, targetPath, FULL_SIZE, dryRun);
    resizeImage(source, targetPath.replace(`${CONFIG_IMAGE_DIR}/`, `${THUMB_DIR}/`), THUMB_SIZE, dryRun);
  }
}

function extractConfigurations(pageText) {
  const pattern = /const configurations = (\[[\s\S]*?\]);\n\n    \/\* === Catalog \+ Lightbox === \*\//;
  const match = pageText.match(pattern);
  if (!match) throw new Error(`Could not find configurations array in ${PAGE_PATH}.`);
  return {
    raw: match[1],
    start: match.index + 'const configurations = '.length,
    end: match.index + 'const configurations = '.length + match[1].length
  };
}

function parseConfigurations(raw) {
  return vm.runInNewContext(`(${raw})`, {}, { timeout: 1000 });
}

function formatObject(product, indent = '          ') {
  const json = JSON.stringify({
    id: product.id,
    title: product.title,
    image: product.image,
    images: product.images,
    price: product.price,
    priceValue: product.priceValue,
    description: product.description,
    designerUrl: product.designerUrl
  }, null, 6);

  return json.split('\n').map((line, index) => (
    index === 0 ? `${indent}{` : `${indent}${line}`
  )).join('\n').replace(`${indent}}`, `${indent}}`);
}

function findObjectBlock(raw, id) {
  const idIndex = raw.indexOf(`"id": "${id}"`);
  if (idIndex === -1) return null;

  let start = raw.lastIndexOf('\n          {', idIndex);
  if (start === -1) start = raw.lastIndexOf('{', idIndex);
  else start += 1;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        let end = i + 1;
        if (raw.slice(end, end + 1) === ',') end += 1;
        return { start, end };
      }
    }
  }

  throw new Error(`Could not locate full object block for ${id}.`);
}

function updateCatalog(product, dryRun) {
  const pageText = fs.readFileSync(PAGE_PATH, 'utf8');
  const { raw, start, end } = extractConfigurations(pageText);
  const configs = parseConfigurations(raw);
  const existingIndex = configs.findIndex((config) => config.id === product.id);
  const productBlock = formatObject(product);
  let nextRaw = raw;

  if (existingIndex >= 0) {
    const block = findObjectBlock(raw, product.id);
    nextRaw = `${raw.slice(0, block.start)}${productBlock}${raw.slice(block.end)}`;
  } else {
    const insertBefore = configs.find((config) => (Number(config.priceValue) || 0) > product.priceValue);
    if (insertBefore) {
      const block = findObjectBlock(raw, insertBefore.id);
      nextRaw = `${raw.slice(0, block.start)}${productBlock},\n${raw.slice(block.start)}`;
    } else {
      const trimmed = raw.replace(/\s*\]$/, '');
      nextRaw = `${trimmed},\n${productBlock}\n        ]`;
    }
  }

  if (!dryRun) {
    fs.writeFileSync(PAGE_PATH, `${pageText.slice(0, start)}${nextRaw}${pageText.slice(end)}`);
  }

  return existingIndex >= 0 ? 'updated' : 'added';
}

function validateCatalog() {
  const pageText = fs.readFileSync(PAGE_PATH, 'utf8');
  const { raw } = extractConfigurations(pageText);
  const configs = parseConfigurations(raw);
  const missing = [];

  for (const config of configs) {
    for (const image of new Set([config.image].concat(config.images || []).filter(Boolean))) {
      if (!fs.existsSync(image)) missing.push(image);
      const thumb = image.replace(`${CONFIG_IMAGE_DIR}/`, `${THUMB_DIR}/`);
      if (!fs.existsSync(thumb)) missing.push(thumb);
    }
  }

  if (missing.length) {
    throw new Error(`Missing catalog assets:\n${missing.join('\n')}`);
  }

  return configs.length;
}

function getFolders(args) {
  if (!args.all) return args.folders.map((folder) => path.resolve(folder));
  assertDir(args.catalogRoot, 'Catalog root');
  return fs.readdirSync(args.catalogRoot)
    .map((entry) => path.join(args.catalogRoot, entry))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .filter((entry) => fs.readdirSync(entry).some((file) => file.toLowerCase().endsWith('.json')));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const folders = getFolders(args);
  const results = [];

  for (const folder of folders) {
    assertDir(folder, 'Product folder');
    const product = readProduct(folder);
    importImages(product, args.dryRun);
    const action = updateCatalog(product, args.dryRun);
    results.push({ id: product.id, action, images: product.images.length });
  }

  const productCount = args.dryRun ? 'not validated in dry run' : validateCatalog();
  console.log(JSON.stringify({ dryRun: args.dryRun, results, productCount }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const DEFAULT_INPUT = 'shelving.html';
const DEFAULT_OUTPUT = 'feeds/meta-shelving-catalog.csv';
const DEFAULT_BASE_URL = 'https://www.framework.co.ke/';

const HEADERS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'additional_image_link',
  'brand',
  'google_product_category',
  'fb_product_category',
  'quantity_to_sell_on_facebook',
  'sale_price',
  'sale_price_effective_date',
  'item_group_id',
  'gender',
  'color',
  'size',
  'age_group',
  'material',
  'pattern',
  'shipping',
  'shipping_weight',
  'offer_disclaimer',
  'offer_disclaimer_url',
  'video[0].url',
  'video[0].tag[0]',
  'gtin',
  'product_tags[0]',
  'product_tags[1]',
  'style[0]'
];

function usage() {
  console.log(`
Generate the public Meta catalog CSV feed from shelving.html.

Usage:
  node scripts/generate-meta-catalog-feed.mjs

Options:
  --input PATH      Source HTML file. Defaults to ${DEFAULT_INPUT}.
  --output PATH     CSV output path. Defaults to ${DEFAULT_OUTPUT}.
  --base-url URL    Site base URL. Defaults to ${DEFAULT_BASE_URL}.
`);
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    baseUrl: DEFAULT_BASE_URL
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--input') {
      args.input = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--input=')) {
      args.input = arg.slice('--input='.length);
    } else if (arg === '--output') {
      args.output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--base-url') {
      args.baseUrl = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function extractConfigurations(pageText, inputPath) {
  const pattern = /const configurations = (\[[\s\S]*?\]);\n\n    \/\* === Catalog \+ Lightbox === \*\//;
  const match = pageText.match(pattern);
  if (!match) throw new Error(`Could not find configurations array in ${inputPath}.`);
  return vm.runInNewContext(`(${match[1]})`, {}, { timeout: 1000 });
}

function absoluteUrl(pathOrUrl, baseUrl) {
  return new URL(String(pathOrUrl || '').trim(), baseUrl).href;
}

function productUrl(productId, baseUrl) {
  return new URL(`shelving.html?config=${encodeURIComponent(productId)}`, baseUrl).href;
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || DEFAULT_BASE_URL).trim();
  return value.endsWith('/') ? value : `${value}/`;
}

function priceValue(config) {
  if (config.priceValue) return Number(config.priceValue);
  const match = String(config.price || '').match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, '')) : 0;
}

function descriptionFor(config) {
  const description = String(config.description || '').trim();
  if (description) return description;
  return `${config.title || 'Framework Designs shelving'} modular shelving configuration made in Nairobi.`;
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function rowFor(config, baseUrl) {
  const productId = String(config.id || '').trim();
  if (!productId) throw new Error(`Missing product id for ${config.title || 'unknown product'}.`);

  const images = (Array.isArray(config.images) && config.images.length ? config.images : [config.image])
    .filter(Boolean)
    .map((image) => absoluteUrl(image, baseUrl));
  if (!images.length) throw new Error(`Missing product image for ${productId}.`);

  const price = priceValue(config);
  const values = {
    id: productId,
    title: String(config.title || productId),
    description: descriptionFor(config),
    availability: 'in stock',
    condition: 'new',
    price: price ? `${price.toFixed(2)} KES` : '',
    link: productUrl(productId, baseUrl),
    image_link: images[0],
    additional_image_link: images.slice(1).join(', '),
    brand: 'Framework Designs',
    google_product_category: 'Furniture > Shelving',
    fb_product_category: 'Furniture > Shelving',
    quantity_to_sell_on_facebook: '',
    sale_price: '',
    sale_price_effective_date: '',
    item_group_id: '',
    gender: '',
    color: '',
    size: '',
    age_group: '',
    material: '',
    pattern: '',
    shipping: '',
    shipping_weight: '',
    offer_disclaimer: '',
    offer_disclaimer_url: '',
    'video[0].url': '',
    'video[0].tag[0]': '',
    gtin: '',
    'product_tags[0]': 'Shelving',
    'product_tags[1]': 'Modular furniture',
    'style[0]': ''
  };

  return HEADERS.map((header) => values[header] || '');
}

try {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const pageText = fs.readFileSync(args.input, 'utf8');
  const configurations = extractConfigurations(pageText, args.input);
  const rows = [HEADERS, ...configurations.map((config) => rowFor(config, baseUrl))];
  const csv = `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, csv, 'utf8');
  console.log(JSON.stringify({ output: args.output, products: configurations.length }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

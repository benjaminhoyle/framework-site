/**
 * Turning catalog.json into what the site ships — as pure string functions.
 *
 * Everything here takes text and returns text. No `fs`, no `process`, no
 * network: that is what lets the same code run in `scripts/build-catalog.mjs`
 * against a checkout and in `netlify/functions/catalog-publish.js` against
 * GitHub's API, so publishing from the website and publishing from a laptop can
 * never produce different sites.
 *
 * That is the whole reason this file exists. The alternative — a second
 * implementation inside the function — would drift, and the way it would
 * announce itself is a live catalogue that disagrees with the Meta feed
 * advertising it.
 *
 * Note the deliberate asymmetry: shelving.html carries a **baked** product
 * array rather than fetching catalog.json at runtime. That array feeds the
 * page's structured data and its first paint, so on a public product page it
 * earns the build step. The build step just no longer needs a laptop.
 */

const CONFIG_RE = /const configurations = \[[\s\S]*?\];\n\n    \/\* === Catalog \+ Lightbox === \*\//;
const CONFIG_CAPTURE = /const configurations = (\[[\s\S]*?\]);\n\n    \/\* === Catalog \+ Lightbox === \*\//;

export const CONFIG_IMAGE_DIR = 'images/shelving/configs';
export const THUMB_DIR = 'images/shelving/configs/thumbs';
export const PAGE = 'shelving.html';
export const CATALOG = 'catalog.json';
export const FEED = 'feeds/meta-shelving-catalog.csv';
export const DEFAULT_BASE_URL = 'https://www.framework.co.ke/';

/** Read catalog.json, refusing the shapes that would ship a broken catalogue. */
export function readCatalog(text) {
  const cat = JSON.parse(text);
  if (!Array.isArray(cat.products)) throw new Error('catalog.json: products[] missing');
  const ids = new Set();
  for (const p of cat.products) {
    if (!p.id) throw new Error('catalog.json: a product is missing id');
    if (ids.has(p.id)) throw new Error(`catalog.json: duplicate id ${p.id}`);
    ids.add(p.id);
    const imgs = imagesOf(p);
    if (p.active && !imgs.length) throw new Error(`catalog.json: active product ${p.id} has no images`);
  }
  return cat;
}

export function imagesOf(p) {
  return (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
}

// Match the field shape + formatting the site expects (mirrors the legacy import
// script so the array stays stable and the feed generator's regex keeps working).
export function formatProduct(p, indent = '          ') {
  const images = imagesOf(p);
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

/** The product ids currently baked into the page, in their published order. */
export function readConfigurations(pageText, label = PAGE) {
  const m = pageText.match(CONFIG_CAPTURE);
  if (!m) throw new Error(`could not find configurations array in ${label}`);
  // JSON.parse, not a JS evaluator: the array is JSON.stringify output, so it
  // parses, and parsing cannot execute anything that finds its way in there.
  return JSON.parse(m[1]);
}

/** The page with its product array replaced by the active products. */
export function spliceConfigurations(pageText, active) {
  if (!CONFIG_RE.test(pageText)) throw new Error('configurations array not found — aborting');
  const arrayText = '[\n' + active.map((p) => formatProduct(p)).join(',\n') + '\n        ]';
  return pageText.replace(CONFIG_RE, `const configurations = ${arrayText};\n\n    /* === Catalog + Lightbox === */`);
}

/** Every repo path an active product needs to exist, full images and thumbs. */
export function requiredAssets(active) {
  const needed = new Set();
  for (const p of active) {
    for (const image of new Set(imagesOf(p).concat(p.image).filter(Boolean))) {
      needed.add(image);
      needed.add(image.replace(`${CONFIG_IMAGE_DIR}/`, `${THUMB_DIR}/`));
    }
  }
  return [...needed];
}

/** catalog.json's own canonical text, given the products it should hold. */
export function catalogJson(products) {
  const next = products.map((p) => {
    const out = {
      id: p.id, title: p.title, price: p.price, priceValue: Number(p.priceValue) || 0,
      description: p.description || '', image: p.image, images: p.images || [],
      active: p.active !== false,
    };
    if (p.designerUrl) out.designerUrl = p.designerUrl;
    // Which shelf this product is, when it came from a render. Nothing reads it
    // yet; it is carried because publish is the only moment it can be captured.
    if (p.designCode) out.designCode = p.designCode;
    return out;
  });
  return JSON.stringify({ schema: 'framework-catalog@1', updatedAt: new Date().toISOString(), products: next }, null, 2) + '\n';
}

// --- The Meta feed ----------------------------------------------------------

export const FEED_HEADERS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link',
  'image_link', 'additional_image_link', 'brand', 'google_product_category',
  'fb_product_category', 'quantity_to_sell_on_facebook', 'sale_price',
  'sale_price_effective_date', 'item_group_id', 'gender', 'color', 'size',
  'age_group', 'material', 'pattern', 'shipping', 'shipping_weight',
  'offer_disclaimer', 'offer_disclaimer_url', 'video[0].url', 'video[0].tag[0]',
  'gtin', 'product_tags[0]', 'product_tags[1]', 'style[0]',
];

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || DEFAULT_BASE_URL).trim();
  return value.endsWith('/') ? value : `${value}/`;
}

function priceOf(config) {
  if (config.priceValue) return Number(config.priceValue);
  const match = String(config.price || '').match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, '')) : 0;
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function rowFor(config, baseUrl) {
  const productId = String(config.id || '').trim();
  if (!productId) throw new Error(`Missing product id for ${config.title || 'unknown product'}.`);
  const images = imagesOf(config).map((image) => new URL(String(image || '').trim(), baseUrl).href);
  if (!images.length) throw new Error(`Missing product image for ${productId}.`);

  const price = priceOf(config);
  const values = {
    id: productId,
    title: String(config.title || productId),
    description: String(config.description || '').trim()
      || `${config.title || 'Framework Designs shelving'} modular shelving configuration made in Nairobi.`,
    availability: 'in stock',
    condition: 'new',
    price: price ? `${price.toFixed(2)} KES` : '',
    link: new URL(`shelving.html?config=${encodeURIComponent(productId)}`, baseUrl).href,
    image_link: images[0],
    additional_image_link: images.slice(1).join(', '),
    brand: 'Framework Designs',
    google_product_category: 'Furniture > Shelving',
    fb_product_category: 'Furniture > Shelving',
    'product_tags[0]': 'Shelving',
    'product_tags[1]': 'Modular furniture',
  };
  return FEED_HEADERS.map((header) => values[header] || '');
}

/** The Meta catalogue CSV for a set of products. */
export function feedCsv(configurations, baseUrl = DEFAULT_BASE_URL) {
  const base = normalizeBaseUrl(baseUrl);
  const rows = [FEED_HEADERS, ...configurations.map((config) => rowFor(config, base))];
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

/**
 * Everything a publish would write, from the inputs it would read.
 *
 * One call so the two callers cannot apply the steps in different orders or
 * skip one. `missingAssets` is advisory here — only the caller knows which
 * files exist, since one of them is looking at a disk and the other at a tree.
 */
export function buildPublish({ catalogText, pageText, products, baseUrl = DEFAULT_BASE_URL }) {
  const nextProducts = products || readCatalog(catalogText).products;
  const active = nextProducts.filter((p) => p.active !== false);
  return {
    active,
    inactive: nextProducts.filter((p) => p.active === false),
    files: {
      [CATALOG]: catalogJson(nextProducts),
      [PAGE]: spliceConfigurations(pageText, active),
      [FEED]: feedCsv(active, baseUrl),
    },
    requiredAssets: requiredAssets(active),
  };
}

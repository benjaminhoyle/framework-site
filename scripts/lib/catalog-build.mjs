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
 * shelving.html fetches `data/catalog.json` rather than carrying a copy of the
 * products. There is no HTML surgery here any more, and no round trip through
 * generated markup to build the feed. See docs/catalog-architecture.md.
 */

export const CONFIG_IMAGE_DIR = 'images/shelving/configs';
export const THUMB_DIR = 'images/shelving/configs/thumbs';
export const CATALOG = 'catalog.json';
/** What the public page fetches: active products only, and only the fields it
 *  renders. Separate from CATALOG because the editorial record holds retired
 *  products, their prices, and internal fields that have no business being
 *  readable by anyone who looks. */
export const PUBLIC_CATALOG = 'data/catalog.json';
export const FEED = 'feeds/meta-shelving-catalog.csv';
export const DEFAULT_BASE_URL = 'https://www.framework.co.ke/';
/** Bumped only when the page could not render an older artifact correctly. The
 *  page checks the major part and refuses rather than rendering something wrong. */
export const PUBLIC_SCHEMA = 'framework-catalog-public@1';

/** The products in a published artifact, refusing one this code cannot read. */
export function readPublicCatalog(text, label = PUBLIC_CATALOG) {
  const data = JSON.parse(text);
  if (String(data.schema || '').indexOf('framework-catalog-public@1') !== 0) {
    throw new Error(`${label}: unsupported schema ${data.schema}`);
  }
  if (!Array.isArray(data.products)) throw new Error(`${label}: products[] missing`);
  return data.products;
}

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

/**
 * The published artifact: what shelving.html fetches.
 *
 * A projection, not a copy. Active products only, and only the fields the page
 * renders — so `active` (always true here), `designCode` and anything else we
 * later keep for ourselves stay out of it. That separation is the point: the
 * editorial record can grow without any of it becoming public by accident.
 */
export function publicCatalog(active) {
  return JSON.stringify({
    schema: PUBLIC_SCHEMA,
    updatedAt: new Date().toISOString(),
    products: active.map((p) => {
      const images = imagesOf(p);
      const out = {
        id: p.id,
        title: p.title || p.id,
        image: p.image || images[0],
        images,
        price: p.price || 'Price on request',
        priceValue: Number(p.priceValue) || 0,
        description: p.description || '',
      };
      if (p.designerUrl) out.designerUrl = p.designerUrl;
      return out;
    }),
  }, null, 2) + '\n';
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
export function buildPublish({ catalogText, products, baseUrl = DEFAULT_BASE_URL }) {
  const nextProducts = products || readCatalog(catalogText).products;
  const active = nextProducts.filter((p) => p.active !== false);
  const files = {
    [CATALOG]: catalogJson(nextProducts),
    [PUBLIC_CATALOG]: publicCatalog(active),
    [FEED]: feedCsv(active, baseUrl),
  };
  return {
    active,
    inactive: nextProducts.filter((p) => p.active === false),
    files,
    requiredAssets: requiredAssets(active),
  };
}

#!/usr/bin/env node
/**
 * Tests for scripts/lib/catalog-build.mjs — what actually goes live.
 *
 *   node scripts/test-catalog-build.mjs
 *
 * This module is imported by two callers that cannot check each other:
 * `build-catalog.mjs` on a laptop and `netlify/functions/catalog-publish.js` in
 * a function. A mistake here ships a catalogue that disagrees with the Meta feed
 * advertising it, or a product card pointing at an image that is not there.
 *
 * The first test is the one that matters most: rebuilding the real published
 * files from the real catalog.json must reproduce them exactly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG, FEED, PUBLIC_CATALOG, buildPublish, catalogJson, feedCsv, imagesOf,
  publicCatalog, readCatalog, readPublicCatalog, requiredAssets,
} from './lib/catalog-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL  ${name}\n      ${error.message}`); }
}

const catalogText = fs.readFileSync(path.join(ROOT, CATALOG), 'utf8');
const publicText = fs.readFileSync(path.join(ROOT, PUBLIC_CATALOG), 'utf8');
const feedText = fs.readFileSync(path.join(ROOT, FEED), 'utf8');

test('rebuilding the published files from the live catalog changes nothing', () => {
  const built = buildPublish({ catalogText });
  // updatedAt is a timestamp, so compare everything else.
  const strip = (text) => { const o = JSON.parse(text); delete o.updatedAt; return JSON.stringify(o); };
  assert.equal(strip(built.files[PUBLIC_CATALOG]), strip(publicText), 'data/catalog.json would have changed');
  assert.equal(built.files[FEED], feedText, 'the Meta feed would have changed');
});

test('publishing never writes markup', () => {
  const built = buildPublish({ catalogText });
  assert.deepEqual(Object.keys(built.files).sort(), [CATALOG, PUBLIC_CATALOG, FEED].sort());
  assert.ok(!Object.keys(built.files).some((f) => f.endsWith('.html')), 'a publish touched an HTML file');
});

test('inactive products are kept in catalog.json but never shipped', () => {
  const cat = readCatalog(catalogText);
  const before = buildPublish({ catalogText });
  const off = { ...cat.products[0], id: 'switched-off', active: false };
  const built = buildPublish({ catalogText, products: [...cat.products, off] });

  assert.ok(!built.files[PUBLIC_CATALOG].includes('"switched-off"'), 'an inactive product reached the public catalogue');
  assert.ok(!built.files[FEED].includes('switched-off'), 'an inactive product reached the feed');
  assert.ok(built.files[CATALOG].includes('"switched-off"'), 'an inactive product was dropped from catalog.json');
  assert.equal(built.inactive.length, before.inactive.length + 1);
  assert.equal(built.active.length, before.active.length, 'turning one off changed the active set');
});

test('the published catalogue and the feed always describe the same products', () => {
  const built = buildPublish({ catalogText });
  const published = readPublicCatalog(built.files[PUBLIC_CATALOG]).map((c) => c.id);
  const inFeed = built.files[FEED].trim().split('\n').slice(1).map((row) => row.split(',')[0]);
  assert.deepEqual(inFeed, published);
});

test('the published artifact carries only what the page renders', () => {
  const cat = readCatalog(catalogText);
  const products = cat.products.map((p) => ({ ...p, designCode: '1Y3MK7P', internalNote: 'do not ship' }));
  const published = JSON.parse(publicCatalog(products.filter((p) => p.active)));
  for (const p of published.products) {
    assert.ok(!('active' in p), 'the active flag leaked into the public artifact');
    assert.ok(!('designCode' in p), 'designCode leaked into the public artifact');
    assert.ok(!('internalNote' in p), 'an unknown editorial field leaked through');
  }
  assert.ok(published.schema.startsWith('framework-catalog-public@'), 'no schema version');
});

test('a published artifact this code cannot read is refused, not guessed at', () => {
  assert.throws(() => readPublicCatalog('{"schema":"framework-catalog-public@2","products":[]}'), /unsupported schema/);
  assert.throws(() => readPublicCatalog('{"schema":"framework-catalog-public@1"}'), /products\[\] missing/);
  assert.deepEqual(readPublicCatalog('{"schema":"framework-catalog-public@1","products":[]}'), []);
});

test('every active product demands its thumbnail as well as its image', () => {
  const cat = readCatalog(catalogText);
  const needed = requiredAssets(cat.products.filter((p) => p.active));
  for (const image of needed.filter((p) => !p.includes('/thumbs/'))) {
    assert.ok(
      needed.includes(image.replace('images/shelving/configs/', 'images/shelving/configs/thumbs/')),
      `${image} has no thumbnail in requiredAssets`
    );
  }
  // And that is not vacuous: they are all really there.
  const missing = needed.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  assert.deepEqual(missing, [], 'the live catalogue is missing assets');
});

test('product copy cannot break out of the published artifact', () => {
  // It used to be spliced into a <script> block, where a description containing
  // </script> would have ended the block. It is now fetched as JSON, so this is
  // structurally impossible -- but the round trip is worth asserting.
  const nasty = [{ id: 'x', title: 'a"b', image: 'i.jpg', images: ['i.jpg'], price: 'Ksh 1', priceValue: 1, description: '</script><img onerror=alert(1)>' }];
  const back = readPublicCatalog(publicCatalog(nasty));
  assert.equal(back[0].description, '</script><img onerror=alert(1)>');
});

test('a designCode survives a publish', () => {
  const cat = readCatalog(catalogText);
  const withCode = cat.products.map((p, i) => (i === 0 ? { ...p, designCode: '1Y3MK7P' } : p));
  assert.ok(catalogJson(withCode).includes('"designCode": "1Y3MK7P"'));
  // …and stays out of the published catalogue and feed, which have no use for it.
  const built = buildPublish({ catalogText, products: withCode });
  assert.ok(!built.files[PUBLIC_CATALOG].includes('1Y3MK7P'));
  assert.ok(!built.files[FEED].includes('1Y3MK7P'));
});

test('the feed escapes what would otherwise break a CSV', () => {
  const csv = feedCsv([{
    id: 'comma', title: 'A, B', description: 'He said "hi"\nthen left',
    image: 'i.jpg', images: ['i.jpg'], priceValue: 1200,
  }]);
  const body = csv.split('\n').slice(1).join('\n');
  assert.ok(body.includes('"A, B"'), 'a comma was not quoted');
  assert.ok(body.includes('""hi""'), 'a quote was not doubled');
  assert.equal(csv.split('\n')[0].split(',').length, 32);
});

test('catalog.json is refused when it would ship something broken', () => {
  assert.throws(() => readCatalog('{"products":[{"title":"no id"}]}'), /missing id/);
  assert.throws(() => readCatalog('{"products":[{"id":"a"},{"id":"a"}]}'), /duplicate id a/);
  assert.throws(() => readCatalog('{"products":[{"id":"a","active":true}]}'), /no images/);
  assert.throws(() => readCatalog('{}'), /products\[\] missing/);
  // An inactive product with no images is fine — it ships nothing.
  assert.equal(readCatalog('{"products":[{"id":"a","active":false}]}').products.length, 1);
});

test('images() prefers the list but falls back to the single image', () => {
  assert.deepEqual(imagesOf({ image: 'a.jpg' }), ['a.jpg']);
  assert.deepEqual(imagesOf({ image: 'a.jpg', images: [] }), ['a.jpg']);
  assert.deepEqual(imagesOf({ image: 'a.jpg', images: ['b.jpg', 'c.jpg'] }), ['b.jpg', 'c.jpg']);
});



console.log(failures ? `\n${failures} failing` : '\nall catalog build tests passed');
process.exit(failures ? 1 : 0);

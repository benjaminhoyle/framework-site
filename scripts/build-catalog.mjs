#!/usr/bin/env node
// build-catalog — regenerate the site catalog + Meta feed from catalog.json
// (the single source of truth). ACTIVE products become the live shelving.html
// `configurations` array and the Meta feed CSV; inactive products are kept in
// catalog.json (so they can be re-activated) but never shipped or advertised.
//
//   node scripts/build-catalog.mjs            # regenerate shelving.html + feed
//   node scripts/build-catalog.mjs --check    # verify catalog vs. site, no writes
//
// The work itself lives in scripts/lib/catalog-build.mjs, which is pure string
// functions and no I/O, because netlify/functions/catalog-publish.js does the
// same job against GitHub's API. This file is that module plus a disk.

import fs from 'node:fs';
import path from 'node:path';
import {
  CATALOG, PAGE, FEED, buildPublish, readCatalog, readConfigurations,
} from './lib/catalog-build.mjs';

const check = process.argv.includes('--check');

const catalogText = fs.readFileSync(CATALOG, 'utf8');
const pageText = fs.readFileSync(PAGE, 'utf8');
const cat = readCatalog(catalogText);
const built = buildPublish({ catalogText, pageText });

/** Which of the assets the active products need are not actually on disk. */
const missingAssets = built.requiredAssets.filter((p) => !fs.existsSync(p));

if (check) {
  const siteIds = readConfigurations(pageText).map((c) => c.id);
  const wantIds = built.active.map((p) => p.id);
  const same = siteIds.length === wantIds.length && siteIds.every((id, i) => id === wantIds[i]);
  console.log(JSON.stringify({
    catalog: cat.products.length, active: built.active.length, inactive: built.inactive.length,
    siteInSync: same, siteIds: siteIds.length, missingAssets,
  }, null, 2));
  if (!same || missingAssets.length) process.exit(1);
} else {
  if (missingAssets.length) {
    console.error('Missing catalog assets:\n' + missingAssets.join('\n'));
    process.exit(1);
  }
  // catalog.json is left alone here: it is the input, and rewriting it would
  // only restamp updatedAt. The publish function writes it because there it is
  // the output of applying a draft.
  for (const [file, text] of Object.entries(built.files)) {
    if (file === CATALOG) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  console.log(JSON.stringify({
    wrote: [PAGE, FEED], active: built.active.length, inactive: built.inactive.length,
  }, null, 2));
}

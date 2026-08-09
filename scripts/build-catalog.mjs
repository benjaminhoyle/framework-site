#!/usr/bin/env node
// build-catalog — regenerate the published catalogue + Meta feed from
// catalog.json (the editorial source of truth). ACTIVE products become
// data/catalog.json, which shelving.html fetches, and the Meta feed CSV;
// inactive products stay in catalog.json so they can be re-activated, and are
// never shipped or advertised.
//
//   node scripts/build-catalog.mjs            # regenerate the published files
//   node scripts/build-catalog.mjs --check    # verify, no writes
//
// The work itself lives in scripts/lib/catalog-build.mjs, which is pure string
// functions and no I/O, because netlify/functions/catalog-publish.js does the
// same job against GitHub's API. This file is that module plus a disk.

import fs from 'node:fs';
import path from 'node:path';
import {
  CATALOG, PUBLIC_CATALOG, buildPublish, readCatalog, readPublicCatalog,
} from './lib/catalog-build.mjs';

const check = process.argv.includes('--check');

const catalogText = fs.readFileSync(CATALOG, 'utf8');
const cat = readCatalog(catalogText);
const built = buildPublish({ catalogText });

/** Which of the assets the active products need are not actually on disk. */
const missingAssets = built.requiredAssets.filter((p) => !fs.existsSync(p));

if (check) {
  const publishedIds = fs.existsSync(PUBLIC_CATALOG)
    ? readPublicCatalog(fs.readFileSync(PUBLIC_CATALOG, 'utf8')).map((p) => p.id)
    : [];
  const wantIds = built.active.map((p) => p.id);
  const same = publishedIds.length === wantIds.length && publishedIds.every((id, i) => id === wantIds[i]);
  console.log(JSON.stringify({
    catalog: cat.products.length, active: built.active.length, inactive: built.inactive.length,
    publishedInSync: same, publishedIds: publishedIds.length, missingAssets,
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
    wrote: Object.keys(built.files).filter((f) => f !== CATALOG),
    active: built.active.length, inactive: built.inactive.length,
  }, null, 2));
}

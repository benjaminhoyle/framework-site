#!/usr/bin/env node
// Build a canonical module-type -> price map from the site's designer engine
// (the only place unit prices are recorded), for use by the 3D builder's price
// list and anywhere else that needs a KSh price per canonical module type.
//
// Output: shelving-3d-pipeline/shared/prices.json
//
// Usage:
//   node scripts/build-canonical-prices.mjs [--check]

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolveSiteAlias } from '../../shelving-3d-pipeline/shared/framework-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const ENGINE = path.join(SITE, 'js/designer-engine.js');
const VOCAB = path.resolve(SITE, '../shelving-3d-pipeline/shared/module-vocabulary.json');
const OUT = path.resolve(SITE, '../shelving-3d-pipeline/shared/prices.json');

function loadModuleFilenames() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'designer-engine.js', timeout: 5000 });
  return sandbox.DesignerEngine.moduleFilenames;
}

function build() {
  const modules = loadModuleFilenames();
  const vocab = JSON.parse(fs.readFileSync(VOCAB, 'utf8'));
  const typeSet = new Set(vocab.types.map((t) => t.type));
  const byType = {};
  const conflicts = [];
  const unmapped = [];

  for (const m of modules) {
    if (typeof m.price !== 'number') continue;
    const type = resolveSiteAlias(m.id, vocab);
    if (!typeSet.has(type)) { unmapped.push(m.id); continue; }
    if (byType[type] === undefined) byType[type] = m.price;
    else if (byType[type] !== m.price) conflicts.push({ type, prices: [byType[type], m.price], from: m.id });
  }

  if (conflicts.length) {
    throw new Error(`Price conflicts across orientations: ${JSON.stringify(conflicts)}`);
  }

  const sorted = Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b)));
  return {
    schema: 'framework-prices@1',
    currency: 'KSh',
    generatedFrom: path.relative(path.resolve(SITE, '..'), ENGINE),
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'Price is per module type, independent of finish/orientation. Types not sold individually (hardware, model-pending, or site-unlisted) are absent — treat missing as unpriced, not free.',
    unmapped,
    prices: sorted,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const data = build();
  const json = JSON.stringify(data, null, 2) + '\n';

  if (check) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (existing !== json) {
      console.error('prices.json is stale — run: node scripts/build-canonical-prices.mjs');
      process.exit(1);
    }
    console.log(`OK — ${Object.keys(data.prices).length} priced types, up to date.`);
    return;
  }

  fs.writeFileSync(OUT, json);
  console.log(`Wrote ${path.relative(SITE, OUT)} — ${Object.keys(data.prices).length} priced types` + (data.unmapped.length ? `, ${data.unmapped.length} unmapped (${data.unmapped.join(', ')})` : '') + '.');
}

main();

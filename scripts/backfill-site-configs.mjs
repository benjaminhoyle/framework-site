#!/usr/bin/env node
// Backfill canonical framework-config@1 files from the existing site catalog.
//
// Reads shelving.html, decodes each product's designerUrl sandbox hash into
// module + finish data, maps site pieceIds -> canonical module types via the
// module vocabulary, and writes configs/<id>.json. Emits a report of anything
// that could not be mapped.
//
// Usage:
//   node scripts/backfill-site-configs.mjs [--out configs] [--dry-run]
//     [--vocab <path to module-vocabulary.json>]
//
// See image-generator/specs/dam-step-0-vocabulary.md §6.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validateConfig, resolveSiteAlias, FRAMEWORK_CONFIG_SCHEMA } from
  '../../shelving-3d-pipeline/shared/framework-config.mjs';
import { hashToConfig } from './designer-hash-to-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const PAGE = path.join(SITE, 'shelving.html');
const DEFAULT_VOCAB = path.resolve(SITE, '../shelving-3d-pipeline/shared/module-vocabulary.json');

const THEME_TO_FINISH = { THEME_1: 'marine', THEME_2: 'sage', THEME_3: 'charcoal', THEME_4: 'coral' };

function parseArgs(argv) {
  const args = { out: path.join(SITE, 'configs'), dryRun: false, vocab: DEFAULT_VOCAB };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--vocab') args.vocab = path.resolve(argv[++i]);
    else if (a.startsWith('--out=')) args.out = path.resolve(a.slice(6));
    else if (a.startsWith('--vocab=')) args.vocab = path.resolve(a.slice(8));
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function extractConfigurations(pageText) {
  const pattern = /const configurations = (\[[\s\S]*?\]);\n\n    \/\* === Catalog \+ Lightbox === \*\//;
  const match = pageText.match(pattern);
  if (!match) throw new Error('Could not find configurations array in shelving.html');
  return vm.runInNewContext(`(${match[1]})`, {}, { timeout: 1000 });
}

// Newer sandbox.html SBX format: explicit JSON pieces with per-module
// customTheme and a zIndex placement order. Stacking is taken as the zIndex
// order within a single bay (the SBX canvas does not encode the head/foot
// anchor grammar the way the old designer format does).
function buildConfigFromSBX(product, vocab, report) {
  const marker = product.designerUrl.indexOf('SBX:');
  const themeMatch = product.designerUrl.match(/;(THEME_\d)\s*$/);
  const globalFinish = THEME_TO_FINISH[themeMatch ? themeMatch[1] : null] || null;
  let rest = product.designerUrl.slice(marker + 4);
  if (themeMatch) rest = rest.slice(0, rest.lastIndexOf(';'));
  let arr;
  try { arr = JSON.parse(decodeURIComponent(rest)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const pieces = arr
    .filter((p) => p && p.type === 'module' && p.pieceId)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  if (pieces.length === 0) return null;

  const typeSet = new Set(vocab.types.map((t) => t.type));
  const modules = [];
  pieces.forEach((p, idx) => {
    const type = resolveSiteAlias(p.pieceId, vocab);
    if (!typeSet.has(type)) report.unmappedPieces.push({ id: product.id, pieceId: p.pieceId, resolved: type });
    modules.push({
      id: `item_${String(idx + 1).padStart(3, '0')}`,
      type,
      finish: THEME_TO_FINISH[p.customTheme] || globalFinish,
      ...(idx === 0 ? { placement: 'floor' } : { on: [`item_${String(idx).padStart(3, '0')}`] }),
      x: 0,
      y: 0,
      _designer: { pieceId: p.pieceId, x: p.x, y: p.y, zIndex: p.zIndex },
    });
  });
  return {
    schema: FRAMEWORK_CONFIG_SCHEMA,
    id: product.id,
    description: 'backfilled from site designerUrl (SBX sandbox format)',
    provenance: { source: 'sandbox.html-SBX', bays: 1 },
    ...(globalFinish ? { defaultFinish: globalFinish } : {}),
    modules,
  };
}

function buildConfig(product, vocab, report) {
  const url = product.designerUrl || '';
  if (!url || !/SBX:|%7B|\{/i.test(url)) {
    report.unmapped.push({ id: product.id, reason: 'no decodable designerUrl / no module pieces' });
    return null;
  }

  let config;
  if (url.includes('SBX:')) {
    config = buildConfigFromSBX(product, vocab, report);
  } else {
    // Old designer.html bracket format — faithful bay/stacking reconstruction.
    try {
      const { config: c, warnings } = hashToConfig(url, { id: product.id, vocab });
      config = c;
      warnings.forEach((w) => report.unmappedPieces.push({ id: product.id, warning: w }));
    } catch (err) {
      report.unmapped.push({ id: product.id, reason: err.message });
      return null;
    }
  }
  if (!config) {
    report.unmapped.push({ id: product.id, reason: 'decoder returned no config' });
    return null;
  }

  const v = validateConfig(config, vocab);
  if (!v.ok) report.invalid.push({ id: product.id, errors: v.errors });
  return config;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const vocab = JSON.parse(fs.readFileSync(args.vocab, 'utf8'));
  const products = extractConfigurations(fs.readFileSync(PAGE, 'utf8'));
  const report = { total: products.length, written: 0, unmapped: [], unmappedPieces: [], invalid: [] };

  if (!args.dryRun) fs.mkdirSync(args.out, { recursive: true });

  for (const product of products) {
    const config = buildConfig(product, vocab, report);
    if (!config) continue;
    if (!args.dryRun) {
      fs.writeFileSync(path.join(args.out, `${product.id}.json`), JSON.stringify(config, null, 2) + '\n');
    }
    report.written += 1;
  }

  console.log(JSON.stringify({
    total: report.total,
    written: report.written,
    productsWithUnmappablePieces: [...new Set(report.unmappedPieces.map((u) => u.id))],
    distinctUnmappedPieceIds: [...new Set(report.unmappedPieces.map((u) => u.pieceId))],
    noDesignerUrl: report.unmapped,
    invalid: report.invalid,
    dryRun: args.dryRun,
    out: args.dryRun ? null : path.relative(SITE, args.out),
  }, null, 2));
}

main();

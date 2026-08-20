#!/usr/bin/env node
// Generate static /builder/<CODE> saved-design records for catalogue products
// that already have a canonical configs/<id>.json file, then point catalog.json
// at those builder links. Skips products that cannot be rebuilt legally by the
// public builder engine.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const engine = require('../js/builder/engine.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'catalog.json');
const BUILDER_CATALOG_PATH = path.join(ROOT, 'assets/shelving/catalog.json');
const CONFIG_DIR = path.join(ROOT, 'configs');
const DESIGN_DIR = path.join(ROOT, 'data/builder-designs');
const DESIGN_HOME = 'https://framework.co.ke/builder';
const THEME_ROTATION = { NE: 0, NW: 270, SE: 90, SW: 180 };
const MANUAL_BUILDER_CODES = {
  'asymmetric-display': '0GI7A94',
  'lantern-shelf': '3WU3UN2',
  'terraced-console': '4R4TE7U'
};
const PENDING_BUILDER_PRODUCTS = new Set(['dynamic-corner', 'grand-corner']);
const ROTATION_OFFSET_BY_PRODUCT = {
  'wardrobe-shelf': 180
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function pieceSuffix(pieceId) {
  const match = String(pieceId || '').match(/-(NE|NW|SE|SW)$/);
  return match ? match[1] : null;
}

function desiredRotation(spec, productId) {
  const suffix = pieceSuffix(spec && spec._designer && spec._designer.pieceId);
  const base = suffix ? THEME_ROTATION[suffix] : 0;
  return (base + (ROTATION_OFFSET_BY_PRODUCT[productId] || 0)) % 360;
}

function candidateScore(candidate, spec, refInstance, productId) {
  let score = 0;
  const rotation = desiredRotation(spec, productId);
  const placement = candidate.placement || {};
  const kind = placement.basePlacementKind || '';

  if (candidate.rotationDeg === rotation) score -= 20;
  if (spec.lateralOn) {
    if (placement.nextTo === spec.lateralOn.ref) score -= 1000;
    if (/corner/i.test(spec.type)) {
      if (kind === 'corner_right') score -= 200;
      if (candidate.rotationDeg === 270) score -= 100;
    } else if (kind === 'adjacent_right') {
      score -= 200;
    }
  }

  if (spec._designer && refInstance && refInstance._designer) {
    const dx = Number(spec._designer.x) - Number(refInstance._designer.x);
    const dy = Number(spec._designer.y) - Number(refInstance._designer.y);
    if (dx > 20 && dy < 20 && kind === 'adjacent_right') score -= 30;
    if (dx > 20 && dy < 20 && kind === 'corner_right') score -= 25;
    if (dx < -20 && kind.includes('left')) score -= 30;
  }

  return score;
}

function applyFinish(catalog, state, spec, defaultFinish) {
  if (!spec.finish || spec.finish === defaultFinish) return state;
  const next = engine.setInstanceFinish(catalog, state, spec.id, spec.finish);
  if (!next) throw new Error(`${spec.id}: could not set finish ${spec.finish}`);
  return next;
}

function addConfiguredModule(catalog, state, spec, built, defaultFinish, productId) {
  const module = engine.moduleFor(catalog, spec.type);
  const rotation = desiredRotation(spec, productId);
  let next;

  if (module.role === 'base' && (spec.placement === 'floor' || !spec.on)) {
    if (!state.instances.length) {
      next = engine.addInstance(catalog, state, module.id, 0, 0, {
        id: spec.id,
        placement: { method: 'floor' },
        rotationDeg: rotation
      });
    } else {
      const ref = spec.lateralOn && spec.lateralOn.ref;
      const refInstance = ref ? built.get(ref) : null;
      const candidates = engine.generateCandidates(catalog, state, module.id, { adjacentBasesOnly: true })
        .sort((a, b) => candidateScore(a, spec, refInstance, productId) - candidateScore(b, spec, refInstance, productId));
      const candidate = candidates[0];
      if (!candidate) throw new Error(`${spec.id}: no legal base placement for ${module.id}`);
      next = engine.applyCandidate(catalog, state, candidate, { id: spec.id });
    }
  } else {
    const wantedSupports = new Set(spec.on || []);
    let candidates = engine.generateCandidates(catalog, state, module.id);
    const matching = candidates.filter((candidate) =>
      (candidate.placement.on || []).some((id) => wantedSupports.has(id)));
    if (matching.length) candidates = matching;
    candidates.sort((a, b) => {
      let aScore = a.rotationDeg === rotation ? -10 : 0;
      let bScore = b.rotationDeg === rotation ? -10 : 0;
      for (const id of wantedSupports) {
        if ((a.placement.on || []).includes(id)) aScore -= 1000;
        if ((b.placement.on || []).includes(id)) bScore -= 1000;
      }
      return aScore - bScore;
    });
    const candidate = candidates[0];
    if (!candidate) throw new Error(`${spec.id}: no legal stack placement for ${module.id}`);
    next = engine.applyCandidate(catalog, state, candidate, { id: spec.id });
  }

  next = applyFinish(catalog, next, spec, defaultFinish);
  const builtInstance = next.instances.find((instance) => instance.id === spec.id);
  if (builtInstance) {
    builtInstance._designer = spec._designer || null;
    built.set(spec.id, builtInstance);
  }
  return next;
}

function stateFromConfig(catalog, config) {
  const defaultFinish = config.defaultFinish || 'sage';
  let state = engine.createState(catalog, { finish: defaultFinish, bookends: 0 });
  const built = new Map();
  for (const spec of [...(config.modules || [])].sort((a, b) => a.id.localeCompare(b.id))) {
    state = addConfiguredModule(catalog, state, spec, built, defaultFinish, config.id);
  }
  const valid = engine.validateState(catalog, state);
  if (!valid.isValid) throw new Error(valid.reasons.join('; ') || 'invalid builder state');
  return state;
}

function toBase64Url(text) {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeDesign(state, mode = 'advanced') {
  const types = [];
  const typeIndex = new Map();
  const idIndex = new Map();
  const tints = [];
  const tintIndex = new Map();
  state.instances.forEach((instance, index) => idIndex.set(instance.id, index));

  const rows = state.instances.map((instance) => {
    if (!typeIndex.has(instance.moduleId)) {
      typeIndex.set(instance.moduleId, types.length);
      types.push(instance.moduleId);
    }
    const on = instance.placement && instance.placement.on;
    const supports = on ? (Array.isArray(on) ? on : [on]) : [];
    const row = [
      typeIndex.get(instance.moduleId),
      Math.round(instance.originWorldMm[0]),
      Math.round(instance.originWorldMm[1]),
      instance.rotationDeg || 0,
      instance.placement && instance.placement.method === 'socket' ? 1 : 0,
      supports.map((id) => idIndex.get(id)).filter((index) => index != null)
    ];
    if (instance.finish) {
      if (!tintIndex.has(instance.finish)) {
        tintIndex.set(instance.finish, tints.length);
        tints.push(instance.finish);
      }
      row.push(tintIndex.get(instance.finish) + 1);
    }
    return row;
  });

  const payload = [1, mode, state.finish, state.bookends || 0, types, rows];
  if (tints.length) payload.push(tints);
  return toBase64Url(JSON.stringify(payload));
}

function priceOf(product) {
  if (Number(product.priceValue)) return Number(product.priceValue);
  const match = String(product.price || '').match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, '')) : null;
}

function main() {
  const builderCatalog = engine.normalizeCatalog(readJson(BUILDER_CATALOG_PATH));
  const catalog = readJson(CATALOG_PATH);
  const report = { generated: [], skipped: [] };

  for (const product of catalog.products) {
    if (product.active === false) continue;
    if (PENDING_BUILDER_PRODUCTS.has(product.id)) {
      delete product.designCode;
      delete product.designerUrl;
      report.skipped.push({ id: product.id, reason: 'builder link pending corner-module resolution' });
      continue;
    }
    if (MANUAL_BUILDER_CODES[product.id]) {
      const code = MANUAL_BUILDER_CODES[product.id];
      product.designCode = code;
      product.designerUrl = `${DESIGN_HOME}/${code}`;
      report.generated.push({ id: product.id, code, pieces: null, manual: true });
      continue;
    }
    const configPath = path.join(CONFIG_DIR, `${product.id}.json`);
    if (!fs.existsSync(configPath)) {
      report.skipped.push({ id: product.id, reason: 'no configs/<id>.json' });
      continue;
    }

    try {
      const state = stateFromConfig(builderCatalog, readJson(configPath));
      const design = engine.serializeState(state);
      const code = engine.designCode(state);
      const record = {
        ok: true,
        code,
        hash: encodeDesign(state),
        design,
        mode: 'advanced',
        finish: state.finish,
        pieces: state.instances.length,
        total_ksh: priceOf(product),
        created_at: 'catalog-builder-links',
        source_product_id: product.id
      };
      writeJson(path.join(DESIGN_DIR, `${code}.json`), record);
      product.designCode = code;
      product.designerUrl = `${DESIGN_HOME}/${code}`;
      report.generated.push({ id: product.id, code, pieces: state.instances.length });
    } catch (error) {
      report.skipped.push({ id: product.id, reason: error.message });
    }
  }

  writeJson(CATALOG_PATH, catalog);
  console.log(JSON.stringify(report, null, 2));
}

main();

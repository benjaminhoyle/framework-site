/**
 * Shared parts of the design lab: the headless engine, the identity of a
 * design, and the links that open one.
 *
 * The lab generates shelf designs by driving js/builder/engine.js from Node —
 * the same placement engine the page runs, validated against the pipeline's
 * golden configs — so a design that arrives here is one /builder can open and
 * the workshop can build. Nothing in the lab re-implements a placement rule.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const engine = require(path.join(ROOT, "js/builder/engine.js"));

export function loadCatalog() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/catalog.json"), "utf8"));
  return engine.normalizeCatalog(raw);
}

// ---------------------------------------------------------------- randomness

/** Seeded PRNG, so a corpus can be regenerated exactly from its seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

/** Pick from `items` by weight; `weightOf` returns a non-negative number. */
export function pickWeighted(random, items, weightOf) {
  let total = 0;
  for (const item of items) total += Math.max(0, weightOf(item));
  if (total <= 0) return null;
  let roll = random() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export function shuffled(random, items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ------------------------------------------------------------------ identity

/**
 * The eight ways a shelf can be set down and still be the same shelf: four
 * quarter turns about the vertical, each with or without a mirror.
 *
 * A run along X turned 90 degrees is the same product pushed against a
 * different wall, and its mirror is the same product photographed from the
 * other side. Generating both and reviewing both is reviewing one design twice,
 * which is exactly what the corpus must not contain.
 */
const FOOTPRINT_TRANSFORMS = [
  // [minX, minY, maxX, maxY] -> [minX, minY, maxX, maxY]
  (b) => [b[0], b[1], b[2], b[3]],                    // identity
  (b) => [-b[3], b[0], -b[1], b[2]],                  // rotate 90
  (b) => [-b[2], -b[3], -b[0], -b[1]],                // rotate 180
  (b) => [b[1], -b[2], b[3], -b[0]],                  // rotate 270
  (b) => [-b[2], b[1], -b[0], b[3]],                  // mirror
  (b) => [-b[3], -b[2], -b[1], -b[0]],                // mirror + 90
  (b) => [b[0], -b[3], b[2], -b[1]],                  // mirror + 180
  (b) => [b[1], b[0], b[3], b[2]]                     // mirror + 270
];

/**
 * A design's identity, independent of where it sits and which way it faces.
 *
 * Keyed on each piece's module and its world box rather than on its origin
 * socket, because a box transforms under a turn without any reasoning about
 * where inside the module its origin happens to sit. The module id stays in the
 * key, so a trimmed cut never collapses onto a full one.
 */
export function canonicalKey(catalog, state) {
  return canonicalKeyOfPieces(state.instances.map((instance) => ({
    moduleId: instance.moduleId,
    box: engine.instanceBounds(catalog, instance)
  })));
}

/**
 * The identity itself, over `{ moduleId, box }` pieces.
 *
 * Separate from the state so the invariance can be tested for what it is: turn
 * or mirror the boxes, and the key must not move.
 */
export function canonicalKeyOfPieces(pieces) {
  if (!pieces.length) return "empty";

  let best = null;
  for (const transform of FOOTPRINT_TRANSFORMS) {
    const rows = pieces.map(({ moduleId, box }) => {
      const [minX, minY, maxX, maxY] = transform([box[0], box[1], box[3], box[4]]);
      return { moduleId, minX, minY, maxX, maxY, minZ: box[2], maxZ: box[5] };
    });
    let offsetX = Infinity;
    let offsetY = Infinity;
    let offsetZ = Infinity;
    for (const row of rows) {
      if (row.minX < offsetX) offsetX = row.minX;
      if (row.minY < offsetY) offsetY = row.minY;
      if (row.minZ < offsetZ) offsetZ = row.minZ;
    }
    const key = rows
      .map((row) => [
        row.moduleId,
        Math.round(row.minX - offsetX),
        Math.round(row.minY - offsetY),
        Math.round(row.minZ - offsetZ),
        Math.round(row.maxX - offsetX),
        Math.round(row.maxY - offsetY),
        Math.round(row.maxZ - offsetZ)
      ].join(","))
      .sort()
      .join(";");
    if (best === null || key < best) best = key;
  }
  return best;
}

// ------------------------------------------------------------------ envelope

/** Outside dimensions in mm: width along X, depth along Y, height along Z. */
export function dimensions(catalog, state) {
  const bounds = engine.designBounds(catalog, state);
  if (!bounds) return { widthMm: 0, depthMm: 0, heightMm: 0 };
  return {
    widthMm: Math.round(bounds[3] - bounds[0]),
    depthMm: Math.round(bounds[4] - bounds[1]),
    heightMm: Math.round(bounds[5] - bounds[2])
  };
}

/**
 * The shelf's own envelope, ignoring a lamp -- which is the size /builder
 * quotes, in its summary line and its dimension overlay both.
 *
 * The lab keeps both measurements on purpose. This one is what a person reads,
 * and it has to be the number the page will show them or the two tools appear
 * to disagree about the same shelf. The full box above is what the envelope
 * test uses, because a lamp arm over the top still needs the room to be that
 * tall.
 */
export function shelfDimensions(catalog, state) {
  const shelfOnly = state.instances.filter((instance) =>
    (catalog.modules[instance.moduleId] || {}).role !== "lamp");
  if (!shelfOnly.length) return dimensions(catalog, state);
  return dimensions(catalog, { instances: shelfOnly });
}

/**
 * Does it fit the envelope, in either orientation? A design too deep to stand
 * against one wall may be exactly right against the next one along, and turning
 * it is not a change to the design.
 */
export function fitsEnvelope(size, envelope) {
  if (size.heightMm > envelope.heightMm) return false;
  const square = size.widthMm <= envelope.widthMm && size.depthMm <= envelope.depthMm;
  const turned = size.depthMm <= envelope.widthMm && size.widthMm <= envelope.depthMm;
  return square || turned;
}

// --------------------------------------------------------------------- links

function toBase64Url(text) {
  return Buffer.from(text, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The `#` payload /builder opens a design from — the same schema-1 array
 * app.js's encodeDesign writes, so a generated design opens in the real page
 * with no import step. Kept in sync by scripts/test-design-lab.mjs, which
 * round-trips these links through the page's own decoder.
 */
export function shareHash(state, mode = "advanced") {
  const types = [];
  const typeIndex = new Map();
  const idIndex = new Map();
  state.instances.forEach((instance, index) => idIndex.set(instance.id, index));

  const rows = state.instances.map((instance) => {
    if (!typeIndex.has(instance.moduleId)) {
      typeIndex.set(instance.moduleId, types.length);
      types.push(instance.moduleId);
    }
    const on = instance.placement && instance.placement.on;
    const supports = on ? (Array.isArray(on) ? on : [on]) : [];
    return [
      typeIndex.get(instance.moduleId),
      Math.round(instance.originWorldMm[0]),
      Math.round(instance.originWorldMm[1]),
      instance.rotationDeg || 0,
      instance.placement && instance.placement.method === "socket" ? 1 : 0,
      supports.map((id) => idIndex.get(id)).filter((index) => index != null)
    ];
  });

  const payload = [1, mode, state.finish || "sage", state.bookends || 0, types, rows];
  return toBase64Url(JSON.stringify(payload));
}

export function builderUrl(state, { origin = "https://framework.co.ke", mode = "advanced" } = {}) {
  return `${origin}/builder#${shareHash(state, mode)}`;
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * The inverse: a link somebody pasted, back into a design.
 *
 * The studio's "edit this shelf" is a round trip through /builder — open the
 * shelf, move a piece, copy the address back — so the thing being pasted is a
 * builder URL, a `#hash`, or the bare payload, and all three are the same
 * string with different amounts of noise in front of it.
 *
 * The tint and omission tables app.js appends are read but dropped: this is a
 * bench corpus, where a shelf is a shape and a finish, and a per-piece colour
 * or an unbilled row is a quote's business rather than a design's.
 */
export function decodeShareHash(catalog, encoded) {
  const raw = String(encoded || "").trim().replace(/^.*#/, "").replace(/^\/+/, "");
  if (!raw) throw new Error("no design code");
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(raw));
  } catch {
    throw new Error("that is not a design code — paste a /builder link or the code after its #");
  }
  if (!Array.isArray(payload) || payload[0] !== 1) throw new Error("unsupported design link");
  const [, , finish, bookends, types, rows] = payload;
  if (!Array.isArray(types) || !Array.isArray(rows) || !rows.length) {
    throw new Error("that design code has no pieces in it");
  }
  const instances = rows.map((row, index) => {
    const moduleId = types[row[0]];
    if (!catalog.modules[moduleId]) throw new Error(`the code names a piece that does not exist: ${moduleId}`);
    return {
      id: `item_${String(index + 1).padStart(3, "0")}`,
      type: moduleId,
      originWorldMm: [row[1], row[2], 0],
      rotationDeg: row[3] || 0,
      placement: row[4]
        ? { method: "socket", on: (row[5] || []).map((support) => `item_${String(support + 1).padStart(3, "0")}`) }
        : { method: "floor" }
    };
  });
  // repairCornerGeometry is what /builder runs on the way in, so a link that
  // opens there and one that lands here are the same shelf.
  return engine.repairCornerGeometry(
    catalog,
    engine.deserializeState(catalog, { schemaVersion: 1, finish, bookends: bookends || 0, instances })
  );
}

// -------------------------------------------------------------------- prices

/** Ksh total, plus how many pieces the catalogue has no price for. */
export function priceOf(catalog, state) {
  let total = 0;
  let unpriced = 0;
  for (const instance of state.instances) {
    const module = catalog.modules[instance.moduleId];
    if (!module || module.priceKsh == null) unpriced += 1;
    else total += module.priceKsh;
  }
  const bookendPrice = (catalog.accessoryPrices || {}).bookend;
  if (state.bookends > 0 && bookendPrice != null) total += bookendPrice * state.bookends;
  return { totalKsh: total, unpricedPieces: unpriced };
}

export function moduleCounts(state) {
  const counts = {};
  for (const instance of state.instances) {
    counts[instance.moduleId] = (counts[instance.moduleId] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------- plain runs

/**
 * The variant Simple would reach for: the priced cut of a family and role,
 * trimmed or not. Ported from app.js's simpleVariant so the runs built below
 * are the runs the page builds.
 */
function simpleVariant(catalog, family, role, trimmed) {
  const modules = Object.values(catalog.modules)
    .filter((module) =>
      module.family === family &&
      module.role === role &&
      Boolean(module.trimmed) === Boolean(trimmed) &&
      module.priceKsh != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  return modules[0] ? modules[0].id : null;
}

/**
 * A plain run: `width` units side by side, each carrying `levels - 1` shelves,
 * optionally a lamp. A port of app.js's buildSimpleDesign, growing rightwards
 * and filling the lowest open level left to right, exactly as Simple does.
 */
export function buildPlainRun(catalog, spec) {
  const trimmed = Boolean(spec.trimmed);
  const baseId = simpleVariant(catalog, spec.family, "base", trimmed);
  const extensionId = simpleVariant(catalog, spec.family, "extension", trimmed);
  let state = engine.createState(catalog, { finish: spec.finish || "sage", bookends: 0 });
  if (!baseId || !extensionId) return null;

  for (let unit = 0; unit < spec.width; unit += 1) {
    const candidates = engine.generateCandidates(catalog, state, baseId, { adjacentBasesOnly: true });
    if (!candidates.length) break;
    const furthestRight = candidates.reduce((best, candidate) =>
      candidate.originWorldMm[0] > best.originWorldMm[0] ? candidate : best);
    state = engine.applyCandidate(catalog, state, furthestRight);
  }

  for (let level = 1; level < spec.levels; level += 1) {
    for (let unit = 0; unit < spec.width; unit += 1) {
      const candidates = engine.generateCandidates(catalog, state, extensionId);
      if (!candidates.length) break;
      state = engine.applyCandidate(catalog, state, candidates[0]);
    }
  }

  if (spec.lamp && catalog.modules.lamp) {
    const candidates = engine.generateCandidates(catalog, state, "lamp");
    if (candidates.length) {
      const pick = candidates.reduce((best, candidate) => {
        if (candidate.supportPlaneZ !== best.supportPlaneZ) {
          return candidate.supportPlaneZ > best.supportPlaneZ ? candidate : best;
        }
        if (candidate.originWorldMm[1] !== best.originWorldMm[1]) {
          return candidate.originWorldMm[1] > best.originWorldMm[1] ? candidate : best;
        }
        return candidate.originWorldMm[0] < best.originWorldMm[0] ? candidate : best;
      });
      state = engine.applyCandidate(catalog, state, pick, { rotationDeg: 0 });
    }
  }
  return state;
}

/**
 * Every plain run, by identity — what the corpus must not contain.
 *
 * The rule is "nothing the simplified designer could already have made", and
 * the honest way to enforce it is to build those designs with Simple's own
 * algorithm and compare identities, rather than to hand-write a predicate for
 * "looks like a plain run" that drifts the first time Simple changes. It also
 * covers the two cases called out by name: a single unit is a run of width one,
 * and a stack is a run of width one with levels on it.
 *
 * Built a little past Simple's own 6x6 limits, because a plain run of seven is
 * no more interesting for being out of the stepper's reach.
 */
export function plainRunKeys(catalog, { maxWidth = 8, maxLevels = 8 } = {}) {
  const families = [...new Set(Object.values(catalog.modules).map((module) => module.family).filter(Boolean))];
  const keys = new Set();
  for (const family of families) {
    for (const trimmed of [false, true]) {
      for (let width = 1; width <= maxWidth; width += 1) {
        for (let levels = 1; levels <= maxLevels; levels += 1) {
          for (const lamp of [false, true]) {
            let state = null;
            try {
              state = buildPlainRun(catalog, { family, width, levels, lamp, trimmed });
            } catch {
              state = null;
            }
            if (state && state.instances.length) keys.add(canonicalKey(catalog, state));
          }
        }
      }
    }
  }
  return keys;
}

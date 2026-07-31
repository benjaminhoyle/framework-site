#!/usr/bin/env node
/**
 * Engine + asset tests for /builder.
 *
 *   node scripts/test-builder.mjs
 *
 * The fixtures in scripts/fixtures/builder/ are the shelving pipeline's
 * own golden configs (generated/validation/configs), so a placement rule that
 * drifts away from what the Rhino/Blender pipeline considers buildable fails
 * here rather than on a customer's phone.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = require(path.join(ROOT, "js/builder/engine.js"));

const catalog = engine.normalizeCatalog(
  JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/catalog.json"), "utf8"))
);

const FIXTURES = path.join(ROOT, "scripts/fixtures/builder");
// This fixture exists in the pipeline precisely because it is illegal: two
// accessories fight over one support socket.
const EXPECTED_INVALID = new Set(["wacky-deep-accessory-stack"]);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

/** Same, for the handler tests, which have to await a Response. */
async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

function fixtures() {
  return fs.readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")));
}

// ---------------------------------------------------------------------------

test("catalog ships the modules the interfaces name", () => {
  for (const id of ["standard_base", "standard_extension", "compact_base", "deep_base", "wide_base", "lamp"]) {
    assert.ok(catalog.modules[id], `${id} missing from catalog.json`);
  }
  assert.ok(!catalog.modules.corner_base, "corner modules have no placement rules and must not ship");
  assert.equal(catalog.modules.standard_base_trimmed.canonicalId, "standard_base");
  assert.ok(catalog.modules.standard_base.priceKsh > 0, "prices came through");
  assert.ok(catalog.finishes.length >= 4, "finishes came through");
});

test("every module in the catalog has a geometry bundle", () => {
  for (const id of Object.keys(catalog.modules)) {
    const file = path.join(ROOT, "assets/shelving/modules", `${id}.json`);
    assert.ok(fs.existsSync(file), `${id}.json is missing`);
    assert.ok(fs.statSync(file).size > 256, `${id}.json looks truncated`);
  }
});

test("geometry bundles parse and stay inside their declared bounds", () => {
  for (const id of Object.keys(catalog.modules)) {
    const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/modules", `${id}.json`), "utf8"));
    assert.equal(bundle.format, "framework-module-geometry@1", `${id}: unexpected format`);
    assert.ok(bundle.parts.length > 0, `${id}: no parts`);
    assert.ok(bundle.instances.length > 0, `${id}: no instances`);
    for (const instance of bundle.instances) {
      assert.ok(bundle.parts[instance.part], `${id}: instance points at a missing part`);
      assert.equal(instance.m.length, 12, `${id}: malformed placement matrix`);
    }
    for (const part of bundle.parts) {
      assert.ok(part.vertexCount <= 65535, `${id}: part too large for uint16 indices`);
      const positions = Buffer.from(part.positions, "base64");
      const normals = Buffer.from(part.normals, "base64");
      const indices = Buffer.from(part.indices, "base64");
      assert.equal(positions.length, part.vertexCount * 6, `${id}: position buffer length mismatch`);
      assert.equal(normals.length, part.vertexCount * 4, `${id}: normal buffer length mismatch`);
      assert.equal(indices.length, part.indexCount * 2, `${id}: index buffer length mismatch`);
      // Every index has to address a vertex that exists, or the GPU reads
      // whatever happens to follow the buffer.
      for (let i = 0; i < part.indexCount; i += 1) {
        assert.ok(indices.readUInt16LE(i * 2) < part.vertexCount, `${id}: index out of range`);
      }
    }
    // The catalog's own bbox is what framing and the "+" anchors use; the
    // geometry must actually live inside it (a little slack for the feet,
    // which sit below the module origin).
    const catalogBox = catalog.modules[id].bboxMm;
    if (catalogBox) {
      for (let axis = 0; axis < 3; axis += 1) {
        assert.ok(bundle.bboxMm[axis + 3] - catalogBox[axis + 3] < 60, `${id}: geometry overruns the catalog bbox on axis ${axis}`);
      }
    }
  }
});

test("golden pipeline configs still build and validate", () => {
  for (const config of fixtures()) {
    if (EXPECTED_INVALID.has(config.id)) continue;
    const state = engine.fromPipelineConfig(catalog, config);
    const validation = engine.validateState(catalog, state);
    assert.equal(validation.isValid, true, `${config.id}: ${validation.reasons.join(", ")}`);
  }
});

test("known-bad pipeline config is still rejected", () => {
  for (const config of fixtures()) {
    if (!EXPECTED_INVALID.has(config.id)) continue;
    let reasons = [];
    try {
      reasons = engine.validateState(catalog, engine.fromPipelineConfig(catalog, config)).reasons;
    } catch (error) {
      assert.match(error.message, /missing support|duplicate/i);
      continue;
    }
    assert.ok(reasons.includes("duplicate_support_consumption"), `${config.id} should be rejected`);
  }
});

test("serialise/deserialise round-trips every golden config", () => {
  for (const config of fixtures()) {
    if (EXPECTED_INVALID.has(config.id)) continue;
    const state = engine.fromPipelineConfig(catalog, config);
    const roundTrip = engine.deserializeState(catalog, JSON.parse(JSON.stringify(engine.serializeState(state))));
    assert.deepEqual(
      roundTrip.instances.map((instance) => [instance.moduleId, instance.originWorldMm]),
      state.instances.map((instance) => [instance.moduleId, instance.originWorldMm])
    );
  }
});

/**
 * The incremental check is the whole reason candidate generation is fast
 * enough for a phone, so it has to agree with the authoritative full-state
 * validation everywhere -- including on the placements it rejects.
 */
test("validateAddition agrees with validateState on every golden config", () => {
  const probes = ["standard_extension", "standard_base", "lamp", "standard_spacer", "wide_base", "deep_extension"];
  for (const config of fixtures()) {
    if (EXPECTED_INVALID.has(config.id)) continue;
    const state = engine.fromPipelineConfig(catalog, config);
    const context = engine.additionContext(catalog, state);
    for (const moduleId of probes) {
      for (const candidate of engine.generateCandidates(catalog, state, moduleId)) {
        const incremental = engine.validateAddition(catalog, context, {
          moduleId: candidate.moduleId,
          originWorldMm: candidate.originWorldMm,
          translation: [candidate.transform.x, candidate.transform.y, candidate.transform.z],
          rotationDeg: 0,
          supportPlaneZ: candidate.supportPlaneZ,
          consumedSockets: candidate.consumedSockets,
          placement: candidate.placement
        });
        const applied = engine.applyCandidate(catalog, state, candidate);
        const full = engine.validateState(catalog, applied).isValid;
        assert.equal(
          incremental,
          full,
          `${config.id} + ${moduleId} at ${candidate.originWorldMm}: incremental=${incremental} full=${full}`
        );
      }
    }
  }
});

test("adjacentBasesOnly drops gapped placements but keeps butted ones", () => {
  const state = engine.fromPipelineConfig(catalog, {
    modules: [{ id: "base", type: "standard_base", x: 0, y: 0, placement: "floor" }]
  });
  const all = engine.generateCandidates(catalog, state, "standard_base");
  const adjacent = engine.generateCandidates(catalog, state, "standard_base", { adjacentBasesOnly: true });
  assert.ok(adjacent.length > 0, "a butted neighbour is always offered");
  assert.ok(adjacent.length < all.length, "gapped intervals should have been dropped");
  for (const candidate of adjacent) {
    assert.ok(
      /^adjacent/.test(candidate.placement.basePlacementKind || ""),
      `unexpected ${candidate.placement.basePlacementKind} in adjacent-only mode`
    );
  }
  // And a butted neighbour really does touch: 30mm of clearance, no more.
  const right = adjacent.find((candidate) => candidate.placement.basePlacementKind === "adjacent_right");
  const placed = engine.applyCandidate(catalog, state, right);
  const [first, second] = placed.instances.map((instance) => engine.instanceBounds(catalog, instance));
  assert.ok(Math.abs(second[0] - first[3] - engine.ADJACENT_BASE_GAP_MM) < 1.5, "neighbour is not butted up");
});

test("units of different depths line up on their backs", () => {
  let state = engine.createState(catalog);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "standard_base")[0]);
  const deep = engine.generateCandidates(catalog, state, "deep_base", { adjacentBasesOnly: true })
    .find((candidate) => candidate.placement.basePlacementKind === "adjacent_right");
  assert.ok(deep, "a deeper unit should still fit alongside");
  const placed = engine.applyCandidate(catalog, state, deep);
  const [shallow, deeper] = placed.instances.map((instance) => engine.instanceBounds(catalog, instance));
  // Backs (max depth) coincide; the deeper unit grows forwards into the room.
  assert.ok(Math.abs(deeper[4] - shallow[4]) < 12, `backs not aligned: ${shallow[4]} vs ${deeper[4]}`);
  assert.ok(deeper[1] < shallow[1] - 50, "the deeper unit should extend further forward");
});

test("rotationKeepsSockets tells safe default rotations from unsafe ones", () => {
  // A spacer's four sockets map onto themselves under a half turn, so it can be
  // placed pre-rotated. A booster adapter's do not.
  assert.equal(engine.rotationKeepsSockets(catalog.modules.standard_spacer, 180), true);
  assert.equal(engine.rotationKeepsSockets(catalog.modules.lamp, 45), true);
  assert.equal(engine.rotationKeepsSockets(catalog.modules.booster_adapter, 180), false);
});

test("a pre-rotated spacer still validates and keeps its supports", () => {
  let state = engine.createState(catalog);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "standard_base")[0]);
  const spacer = engine.generateCandidates(catalog, state, "standard_spacer")[0];
  assert.ok(spacer, "a spacer should fit on a base");
  const placed = engine.applyCandidate(catalog, state, spacer, { rotationDeg: 180 });
  assert.equal(placed.instances[1].rotationDeg, 180);
  assert.equal(engine.validateState(catalog, placed).isValid, true);
});

test("a base, a shelf on top and a neighbouring unit all place", () => {
  let state = engine.createState(catalog);
  for (const moduleId of ["standard_base", "standard_extension", "standard_base"]) {
    const candidates = engine.generateCandidates(catalog, state, moduleId, { adjacentBasesOnly: true });
    assert.ok(candidates.length, `no legal placement for ${moduleId}`);
    state = engine.applyCandidate(catalog, state, candidates[0]);
  }
  assert.equal(state.instances.length, 3);
  assert.equal(engine.validateState(catalog, state).isValid, true);
  const bounds = engine.designBounds(catalog, state);
  assert.ok(bounds[3] - bounds[0] > 1000, "two standard units should be over a metre wide");
});

test("removing a load-bearing piece is refused, a free one is allowed", () => {
  let state = engine.createState(catalog);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "standard_base")[0]);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "standard_extension")[0]);
  const [base, extension] = state.instances;
  assert.equal(engine.isLoadBearing(state, base.id), true);
  assert.equal(engine.isLoadBearing(state, extension.id), false);
  assert.equal(engine.removeInstance(catalog, state, extension.id).instances.length, 1);
});

test("candidate generation stays fast on a large design", () => {
  let state = engine.createState(catalog);
  for (let i = 0; i < 6; i += 1) {
    const candidates = engine.generateCandidates(catalog, state, "standard_base", { adjacentBasesOnly: true });
    if (!candidates.length) break;
    state = engine.applyCandidate(catalog, state, candidates[candidates.length - 1]);
    for (let level = 0; level < 3; level += 1) {
      const shelves = engine.generateCandidates(catalog, state, "standard_extension");
      if (!shelves.length) break;
      state = engine.applyCandidate(catalog, state, shelves[shelves.length - 1]);
    }
  }
  assert.ok(state.instances.length >= 12, `only built ${state.instances.length} modules`);

  const ids = Object.keys(catalog.modules);
  const started = Date.now();
  const context = engine.additionContext(catalog, state);
  for (const id of ids) engine.generateCandidates(catalog, state, id, { context });
  const elapsed = Date.now() - started;
  // Desktop budget; a mid-range phone is roughly 6-8x slower, so this keeps a
  // full menu refresh under ~200ms there.
  assert.ok(elapsed < 400, `full ${ids.length}-module candidate sweep took ${elapsed}ms`);
  console.log(`      (${state.instances.length} modules, ${ids.length}-module sweep in ${elapsed}ms)`);
});

/**
 * The legs, posts and rails are lathed tubes, and the decimation grid used to
 * leave them 19% out of round -- 8.6mm to 10.6mm on a 10mm tube, which reads as
 * a broken faceted seam down the front of a unit rather than as a low-poly leg.
 * Regular matters more than fine here, so this asserts the shape, not the count.
 */
test("round parts come out round", () => {
  const decode = (text, Type) => {
    const bytes = Buffer.from(text, "base64");
    return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
  };
  let worst = { spread: 0, where: "none" };
  for (const id of Object.keys(catalog.modules)) {
    const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/modules", `${id}.json`), "utf8"));
    bundle.parts.forEach((part, index) => {
      const positions = decode(part.positions, Uint16Array);
      const points = [];
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < part.vertexCount; i += 1) {
        const point = [0, 1, 2].map((axis) => positions[i * 3 + axis] * part.scale + part.offset[axis]);
        points.push(point);
        for (let axis = 0; axis < 3; axis += 1) {
          if (point[axis] < box[axis]) box[axis] = point[axis];
          if (point[axis] > box[axis + 3]) box[axis + 3] = point[axis];
        }
      }
      // Upright, slim, and square in plan: a leg, a post or a rail.
      const extent = [0, 1, 2].map((axis) => box[axis + 3] - box[axis]);
      if (!(extent[2] > 60 && extent[0] < 60 && extent[1] < 60)) return;
      if (Math.abs(extent[0] - extent[1]) > extent[0] * 0.06) return;

      const centreX = (box[0] + box[3]) / 2;
      const centreY = (box[1] + box[4]) / 2;
      const outer = extent[0] / 2;
      // The outer shell only: a tube's inner wall is deliberately much coarser.
      const radii = points
        .map((point) => Math.hypot(point[0] - centreX, point[1] - centreY))
        .filter((radius) => radius > outer * 0.9);
      if (radii.length < 8) return;
      const spread = (Math.max(...radii) - Math.min(...radii)) / Math.max(...radii);
      if (spread > worst.spread) worst = { spread, where: `${id} part${index}` };
    });
  }
  assert.ok(worst.spread < 0.05, `${worst.where} is ${(worst.spread * 100).toFixed(1)}% out of round`);
  console.log(`      (worst round part is ${(worst.spread * 100).toFixed(2)}% out: ${worst.where})`);
});

test("a piece keeps a colour of its own through every rebuild", () => {
  let state = engine.createState(catalog, { finish: "sage" });
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "standard_base")[0]);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "standard_extension")[0]);
  const [base, extension] = state.instances;

  const tinted = engine.setInstanceFinish(catalog, state, extension.id, "marine");
  assert.ok(tinted, "colouring a piece must not make the design illegal");
  assert.equal(tinted.instances[1].finish, "marine");
  assert.equal(tinted.instances[0].finish, null, "only the named piece changes");

  // The rebuilds every other edit goes through must carry it.
  const rotated = engine.rotateInstance(catalog, tinted, base.id, 180) || tinted;
  assert.equal(rotated.instances[1].finish, "marine", "lost through a rotation");
  const roundTrip = engine.deserializeState(catalog, JSON.parse(JSON.stringify(engine.serializeState(tinted))));
  assert.equal(roundTrip.instances[1].finish, "marine", "lost through serialisation");

  // And "match the rest" has to actually clear it.
  const cleared = engine.setInstanceFinish(catalog, tinted, extension.id, null);
  assert.equal(cleared.instances[1].finish, null);
  assert.ok(!("finish" in engine.serializeState(cleared).instances[1]), "a plain piece serialises with no finish key");
});

// ---------------------------------------------------------------------------
// /api/design — the saved-design store behind framework.co.ke/builder/CODE
//
// The handler is run for real, with Netlify Blobs swapped for a Map. Its import
// is stripped the way test-track-emitter.js runs site.js's emitter: the point is
// to exercise the shipped code, not a copy of it.

async function designHandler() {
  const source = fs.readFileSync(path.join(ROOT, "netlify/functions/design.js"), "utf8")
    // The Blobs import and the route declaration are the deployment's business;
    // everything between them is the logic under test.
    .replace(/^import \{ getStore \} from '@netlify\/blobs';$/m, "")
    .replace(/^export const config = .*$/m, "")
    // `export default` cannot be re-exported from a wrapper, so name it.
    .replace("export default async (req, context) =>", "const handler = async (req, context) =>");

  const blobs = new Map();
  const getStore = () => ({
    get: async (key, options) => {
      if (!blobs.has(key)) return null;
      return options && options.type === "json" ? JSON.parse(blobs.get(key)) : blobs.get(key);
    },
    setJSON: async (key, value) => { blobs.set(key, JSON.stringify(value)); }
  });

  const wrapper = `export const make = (getStore) => {${source}\nreturn handler;};`;
  const built = await import(`data:text/javascript;base64,${Buffer.from(wrapper).toString("base64")}`);
  return { handler: built.make(getStore), blobs };
}

const DESIGN = { schemaVersion: 1, finish: "sage", bookends: 0, instances: [] };

await asyncTest("/api/design rejects anything that is not a design code", async () => {
  const { handler } = await designHandler();
  assert.equal((await handler(new Request("https://x/api/design?code=nope"))).status, 400);
  assert.equal((await handler(new Request("https://x/api/design"))).status, 400);
  assert.equal((await handler(new Request("https://x/api/design", { method: "PUT" }))).status, 405);
});

await asyncTest("/api/design stores a design and resolves its code again", async () => {
  const { handler } = await designHandler();
  const post = await handler(new Request("https://x/api/design", {
    method: "POST",
    body: JSON.stringify({ code: "1Y3MK7P", hash: "WzEs", design: DESIGN, mode: "advanced", pieces: 3 })
  }), {});
  assert.equal(post.status, 200);
  assert.equal((await post.json()).code, "1Y3MK7P");

  const get = await handler(new Request("https://x/api/design?code=1y3mk7p"));
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.equal(body.hash, "WzEs", "the hash is what the page reads back");
  assert.equal(body.mode, "advanced");
  assert.deepEqual(body.design, DESIGN);
});

await asyncTest("/api/design never overwrites a code that already exists", async () => {
  const { handler, blobs } = await designHandler();
  const write = (referrer) => handler(new Request("https://x/api/design", {
    method: "POST",
    body: JSON.stringify({ code: "AAAAAAA", hash: "h", design: DESIGN, referrer })
  }), {});
  await write("https://first.example");
  const second = await write("https://second.example");
  assert.equal((await second.json()).deduped, true);
  // The code is a hash of the design, so a repeat POST is the same shelf; the
  // arrival details of whoever saved it first are the ones worth keeping.
  assert.equal(JSON.parse(blobs.get("AAAAAAA")).referrer, "https://first.example");
});

await asyncTest("/api/design says not found rather than inventing a design", async () => {
  const { handler } = await designHandler();
  const missing = await handler(new Request("https://x/api/design?code=ZZZZZZZ"));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).ok, false);
});

await asyncTest("/api/design refuses a body with no design in it", async () => {
  const { handler } = await designHandler();
  const bad = await handler(new Request("https://x/api/design", {
    method: "POST", body: JSON.stringify({ code: "1Y3MK7P", hash: "h" })
  }), {});
  assert.equal(bad.status, 422);
});

if (failures) {
  console.error(`\n${failures} failing test${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nall builder tests passed");

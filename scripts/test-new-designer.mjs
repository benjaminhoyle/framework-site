#!/usr/bin/env node
/**
 * Engine + asset tests for /new-designer.
 *
 *   node scripts/test-new-designer.mjs
 *
 * The fixtures in scripts/fixtures/new-designer/ are the shelving pipeline's
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
const engine = require(path.join(ROOT, "js/new-designer/engine.js"));

const catalog = engine.normalizeCatalog(
  JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/catalog.json"), "utf8"))
);

const FIXTURES = path.join(ROOT, "scripts/fixtures/new-designer");
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

if (failures) {
  console.error(`\n${failures} failing test${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nall new-designer tests passed");

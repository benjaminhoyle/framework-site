#!/usr/bin/env node
/**
 * Engine + asset tests for /builder.
 *
 *   node scripts/test-builder.mjs
 *
 * The fixtures are the shelving pipeline's own golden configs, carried inside
 * assets/shelving/builder-contract.json, so a placement rule that drifts away
 * from what the Rhino/Blender pipeline considers buildable fails here rather
 * than on a customer's phone. They arrive with the contract rather than as a
 * hand-copy, so there is no way for them to fall behind the pipeline's.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = require(path.join(ROOT, "js/builder/engine.js"));

const rawCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/catalog.json"), "utf8"));
const catalog = engine.normalizeCatalog(rawCatalog);
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/builder-contract.json"), "utf8"));
const PIPELINE = path.resolve(ROOT, "..", "framework-renderer");

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
  return contract.validationConfigs;
}

// ---------------------------------------------------------------------------

/**
 * Everything under assets/shelving/ has to have come from one contract, and
 * that contract has to be the pipeline's. Two ways to end up otherwise, both
 * silent without this: vendor a new contract and forget to rebuild the assets,
 * or change the Rhino model and forget to vendor at all. Either leaves a catalog describing one model and geometry cut
 * from another.
 */
test("the vendored contract, the catalog and the pipeline agree", () => {
  assert.equal(contract.schema, "framework-builder-contract@1");
  assert.ok(contract.validationConfigs.length >= 30, "the contract carries the pipeline's golden configs");
  assert.deepEqual(
    rawCatalog.contract,
    { sourceSha256: contract.sourceSha256, contentHash: contract.contentHash },
    "catalog.json was built from a different contract — run `node scripts/build-builder-assets.mjs`"
  );

  // Only when a pipeline checkout is actually here; the point of vendoring is
  // that this suite passes without one.
  const upstream = path.join(PIPELINE, "generated/contract/builder-contract.json");
  if (!fs.existsSync(upstream)) return;
  const theirs = JSON.parse(fs.readFileSync(upstream, "utf8"));
  assert.equal(
    contract.contentHash,
    theirs.contentHash,
    `the vendored contract is older than the pipeline's (ours ${contract.contentHash.slice(0, 12)}, ` +
    `theirs ${theirs.contentHash.slice(0, 12)}) — run \`make site\` in the pipeline`
  );
});

test("catalog ships the modules the interfaces name", () => {
  for (const id of ["standard_base", "standard_extension", "compact_base", "deep_base", "wide_base", "lamp"]) {
    assert.ok(catalog.modules[id], `${id} missing from catalog.json`);
  }
  assert.ok(catalog.modules.corner_base, "corner units ship: a run turns through them");
  assert.ok(catalog.modules.corner_extension, "and stack like any other extension");
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
 * The design code is the spine of the whole production chain: it addresses a
 * design at framework.co.ke/builder/<code>, keys its record in /api/design, and
 * rides in the filename of every render and scene made from it.
 *
 * So it must never change. A code that shifts orphans every link already sent
 * to a client and every image already filed under the old one. These are frozen
 * answers, not a description of the algorithm -- if this test fails, the fix is
 * to put the hash back, not to update the expectations.
 */
test("the design code is stable, and derived only from the design", () => {
  const frozen = {
    "broad-base-extension": "0NKCEDE",
    "compact-base-extension": "0B8W8UY",
    "broad-hanger-stack": "1VCQ67C"
  };
  let checked = 0;
  for (const config of fixtures()) {
    if (!(config.id in frozen)) continue;
    checked += 1;
    const state = engine.fromPipelineConfig(catalog, config);
    assert.equal(engine.designCode(state), frozen[config.id], `${config.id} changed code`);
    // Seven of uppercase base36, which is what the site's CODE_RE accepts and
    // what the filename convention hunts for.
    assert.match(engine.designCode(state), /^[0-9A-Z]{7}$/);
    // Round-tripping the design must not move the code, or a render loaded from
    // a saved design would file itself under a different one than the builder.
    const roundTrip = engine.deserializeState(catalog, JSON.parse(JSON.stringify(engine.serializeState(state))));
    assert.equal(engine.designCode(roundTrip), frozen[config.id], `${config.id} moved on a round trip`);
  }
  assert.ok(checked > 0, "none of the frozen fixtures are in the contract any more");
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
    // Butted against a neighbour, or turned into a corner. Both are things
    // /designer has always offered; only the gapped intervals are Advanced.
    assert.ok(
      /^(adjacent|corner)/.test(candidate.placement.basePlacementKind || ""),
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

/**
 * The corner: a run turns, and the second run stands against the other wall.
 *
 * The 2D /designer models this as four rotations of one corner unit (NE/NW/SE/
 * SW), and only lets a corner extension sit on a corner base of the same
 * orientation. Here that falls out of the sockets: a turned base presents a
 * turned socket rectangle, and only a turned extension meets it.
 */
test("a run turns a corner, and the corner unit carries the turn", () => {
  let state = engine.createState(catalog);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "corner_base")[0]);
  // The right-hand turn specifically, so the flush edges below are the max ones.
  const turn = engine.generateCandidates(catalog, state, "standard_base", { adjacentBasesOnly: true })
    .find((candidate) => candidate.placement.basePlacementKind === "corner_right");
  assert.ok(turn, "a base should be offered turned into a perpendicular run");
  assert.ok(turn.rotationDeg === 90 || turn.rotationDeg === 270, `unexpected turn of ${turn.rotationDeg} degrees`);

  const turned = engine.applyCandidate(catalog, state, turn);
  assert.equal(engine.validateState(catalog, turned).isValid, true);

  const [corner, second] = turned.instances.map((instance) => engine.instanceBounds(catalog, instance));
  // The two runs are at right angles: the corner unit is wider than it is deep,
  // the turned one deeper than it is wide.
  assert.ok(corner[3] - corner[0] > corner[4] - corner[1], "the first run goes across");
  assert.ok(second[4] - second[1] > second[3] - second[0], "the second run goes back");
  // And no two surfaces are in the same place. Measured on the shelves: the
  // bounding boxes carry foot pads that hang 10mm past the frame and would read
  // as a collision where there is nothing but air.
  const [cornerBoards, secondBoards] = turned.instances.map((instance) => engine.shelfBounds(catalog, instance));
  const overlap = Math.min(cornerBoards[3], secondBoards[3]) - Math.max(cornerBoards[0], secondBoards[0]) > 2
    && Math.min(cornerBoards[4], secondBoards[4]) - Math.max(cornerBoards[1], secondBoards[1]) > 2;
  assert.ok(!overlap, "the two runs must not sit on top of each other");

  /*
   * And the join is continuous, which is the whole reason a corner unit is
   * longer than a standard one: its shelf has to cover the square where the
   * two runs meet. Measured on the shelves, both ways:
   *
   *   - the second run's shelf ends exactly where the corner unit's does, so
   *     the corner unit reaches the second wall,
   *   - and starts exactly where the corner unit's shelf front is, so there is
   *     no notch between them.
   */
  const [cornerShelf, secondShelf] = [cornerBoards, secondBoards];
  assert.ok(
    Math.abs(secondShelf[3] - cornerShelf[3]) < 1,
    `the second run should end flush with the corner unit's shelf (${secondShelf[3]} vs ${cornerShelf[3]})`
  );
  assert.ok(
    Math.abs(secondShelf[4] - cornerShelf[1]) < 1,
    `the second run should meet the corner unit's shelf front (${secondShelf[4]} vs ${cornerShelf[1]})`
  );
  // The corner square itself: the first run's shelf has to cover the whole
  // depth of the second one, or the surface has a notch in it where they meet.
  const covered = Math.min(cornerShelf[3], secondShelf[3]) - Math.max(cornerShelf[0], secondShelf[0]);
  assert.ok(
    covered >= (secondShelf[3] - secondShelf[0]) - 1,
    `the corner unit's shelf should cover the second run's full depth (covers ${covered.toFixed(0)} of ${(secondShelf[3] - secondShelf[0]).toFixed(0)}mm)`
  );

  // Which is what its extra length is for: about a shelf board more than a
  // standard unit, so the board reaches across the join.
  let probe = engine.createState(catalog);
  probe = engine.applyCandidate(catalog, probe, engine.generateCandidates(catalog, probe, "standard_base")[0]);
  const standardShelf = engine.shelfBounds(catalog, probe.instances[0]);
  const extra = (cornerShelf[3] - cornerShelf[0]) - (standardShelf[3] - standardShelf[0]);
  assert.ok(extra > 200, `a corner unit should be a shelf board longer than a standard one (${extra.toFixed(0)}mm)`);
});

test("an extension follows its base around the corner", () => {
  let state = engine.createState(catalog);
  state = engine.applyCandidate(catalog, state, engine.generateCandidates(catalog, state, "corner_base")[0]);
  const turn = engine.generateCandidates(catalog, state, "standard_base", { adjacentBasesOnly: true })
    .find((candidate) => candidate.placement.basePlacementKind === "corner_right");
  state = engine.applyCandidate(catalog, state, turn);

  const onTurned = engine.generateCandidates(catalog, state, "standard_extension")
    .filter((candidate) => candidate.placement.on.includes(state.instances[1].id));
  assert.ok(onTurned.length, "the turned base must accept an extension");
  assert.equal(onTurned[0].rotationDeg, turn.rotationDeg, "which has to be turned the same way to meet its sockets");

  const stacked = engine.applyCandidate(catalog, state, onTurned[0]);
  assert.equal(engine.validateState(catalog, stacked).isValid, true);

  // A corner extension belongs on a corner base, at that base's own rotation --
  // /designer's "suffixes must match" rule, arrived at through the sockets.
  const onCorner = engine.generateCandidates(catalog, stacked, "corner_extension")
    .filter((candidate) => candidate.placement.on.includes(state.instances[0].id));
  assert.ok(onCorner.length, "a corner extension must fit its corner base");
  assert.equal(onCorner[0].rotationDeg, 0, "the corner base was never turned, so neither is its extension");
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

      // A square 20x20 tube has the same slim upright box as a round one, and
      // this only ever meant to police the round ones. It used to exclude
      // itself: a sharp box's outer vertices are its four corners, all at the
      // same radius, so the spread was zero by construction. Now that the long
      // edges carry a fillet those corners are arcs, and the flats read as
      // "out of round" -- which is the shape they are supposed to be. Tell them
      // apart by the flats: a square section puts most of its outer vertices on
      // the bounding planes, a lathed one only touches them four times.
      const onPlane = points.filter((point) =>
        Math.abs(Math.abs(point[0] - centreX) - outer) < outer * 0.02 ||
        Math.abs(Math.abs(point[1] - centreY) - outer) < outer * 0.02
      ).length;
      if (onPlane > points.length * 0.3) return;
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

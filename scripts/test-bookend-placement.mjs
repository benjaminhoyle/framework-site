#!/usr/bin/env node
/**
 * Where the bookends land.
 *
 *   node scripts/test-bookend-placement.mjs
 *
 * A design carries a count of bookends and nothing else about them: which ends
 * they hang on is derived from where the units stand, every time, by
 * `legalBookendAnchors` and `bookendPlacements` in js/builder/engine.js. These
 * tests pin the rules that derivation follows, and the one thing that must not
 * change because of it: the design code.
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

/** A design with one floor unit on it. */
function withBase(moduleId, fields) {
  return engine.addInstance(catalog, engine.createState(catalog, fields || {}), moduleId, 0, 0);
}

/** Add the first candidate for `moduleId` that `pick` accepts. */
function grow(state, moduleId, pick, options) {
  const candidates = engine.generateCandidates(catalog, state, moduleId, options || {});
  const chosen = pick ? candidates.find(pick) : candidates[0];
  assert.ok(chosen, `no ${moduleId} candidate matched`);
  return engine.applyCandidate(catalog, state, chosen);
}

const idsOf = (anchors) => anchors.map((anchor) => `${anchor.instanceId}:${anchor.anchorId}`);

// ---------------------------------------------------------------------------

test("the catalog carries the anchors and the bookend geometry", () => {
  assert.ok(catalog.accessories && catalog.accessories.bookend, "catalog.json has an accessories section");
  assert.deepEqual(catalog.accessories.bookend.attach.anchorLocalMm, [14.75, 50, 170]);
  const withAnchors = Object.values(catalog.modules).filter((module) => (module.accessoryAnchors || []).length);
  assert.equal(withAnchors.length, 18, "18 modules carry End Flat anchors");
  assert.ok(
    fs.existsSync(path.join(ROOT, "assets/shelving/modules/bookend.json")),
    "the bookend geometry bundle was baked"
  );
  for (const module of withAnchors) {
    for (const anchor of module.accessoryAnchors) {
      assert.ok(anchor.id && anchor.end && anchor.normalized_mm && anchor.inboard, `${module.id}: anchor is complete`);
      assert.ok((anchor.takes || []).includes("bookend"), `${module.id}: ${anchor.id} takes a bookend`);
    }
  }
});

test("a lone base offers its two upper ends, and never its lower ones", () => {
  const legal = engine.legalBookendAnchors(catalog, withBase("standard_base"));
  assert.equal(legal.length, 2);
  assert.deepEqual(legal.map((anchor) => anchor.level), [1, 1], "level 0 is 85mm off the floor and unusable");
  assert.deepEqual(legal.map((anchor) => anchor.end), ["left", "right"]);
  assert.deepEqual(legal.map((anchor) => anchor.rotationDeg), [180, 0], "a left end faces one way, a right end the other");
  /*
   * And which way round. The bookend's own +x runs from its screw wall to its
   * stem, so +x turned by the yaw has to point OUT of the run: that puts the
   * screws and the 30 mm window the spine passes through on the inboard side,
   * which is the photograph and what the render draws. Facing it the other way
   * buries the solid back wall in the spine the End Flat caps. The contract's
   * `inboard` says the opposite, and engine.js turns it half round; this is the
   * check that would catch that correction going missing.
   */
  const state = withBase("standard_base");
  for (const anchor of legal) {
    const host = state.instances.find((instance) => instance.id === anchor.instanceId);
    const bounds = engine.instanceBounds(catalog, host);
    const middle = [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2];
    const outward = [middle[0] - anchor.worldMm[0], middle[1] - anchor.worldMm[1]];
    const yaw = anchor.rotationDeg * Math.PI / 180;
    const along = Math.cos(yaw) * outward[0] + Math.sin(yaw) * outward[1];
    assert.ok(along < 0, `the ${anchor.end} end's bookend points its stem out of the run (${along.toFixed(0)})`);
  }
});

test("a trimmed unit has no ends that take one", () => {
  assert.equal(engine.legalBookendAnchors(catalog, withBase("standard_base_trimmed")).length, 0);
  const withSpacer = grow(withBase("standard_base"), "standard_spacer");
  const spacerAnchors = engine.legalBookendAnchors(catalog, withSpacer)
    .filter((anchor) => anchor.moduleId === "standard_spacer");
  assert.equal(spacerAnchors.length, 0, "a spacer has no End Flat");
});

test("the ends come out bottom up", () => {
  let state = withBase("standard_base");
  state = grow(state, "standard_extension");
  state = grow(state, "standard_extension");
  const legal = engine.legalBookendAnchors(catalog, state);
  assert.equal(legal.length, 6, "a base and two extensions: three levels, two ends each");

  const heights = legal.map((anchor) => anchor.worldMm[2]);
  assert.deepEqual(
    heights.slice().sort((first, second) => first - second),
    heights,
    "heights never go down as the list goes on"
  );
  // Within a height, the left end comes before the right one.
  for (let i = 1; i < legal.length; i += 1) {
    if (legal[i].worldMm[2] !== legal[i - 1].worldMm[2]) continue;
    assert.ok(legal[i].worldMm[0] > legal[i - 1].worldMm[0], "same height, ascending across the run");
  }
  assert.equal(legal[0].level, 1, "the lowest usable plate is the base's upper one");

  // Filling from the bottom is exactly the head of that list.
  for (const count of [0, 1, 2, 3, 6, 7, 12]) {
    const placements = engine.bookendPlacements(catalog, Object.assign({}, state, { bookends: count }));
    assert.deepEqual(idsOf(placements), idsOf(legal.slice(0, Math.min(count, legal.length))));
  }
});

test("an end another unit runs into is not an end", () => {
  const lone = withBase("standard_base");
  const pair = grow(lone, "standard_base", (candidate) => candidate.originWorldMm[0] > 0, { adjacentBasesOnly: true });
  const legal = engine.legalBookendAnchors(catalog, pair);
  assert.equal(legal.length, 2, "four upper ends, but the two facing each other are dividers");
  assert.deepEqual(legal.map((anchor) => anchor.end), ["left", "right"]);
  const xs = legal.map((anchor) => anchor.worldMm[0]);
  assert.ok(xs[0] < 0 && xs[1] > 900, "the two that survive are the outside ones");
  // Both units still offer their own outside end.
  assert.equal(new Set(legal.map((anchor) => anchor.instanceId)).size, 2);
});

test("a deep unit offers one plate per end, not two", () => {
  const deep = catalog.modules.deep_base;
  const ends = deep.accessoryAnchors.filter((anchor) => anchor.level === 1 && anchor.end === "left");
  assert.equal(ends.length, 2, "the model really does have two spines at each end");

  const legal = engine.legalBookendAnchors(catalog, withBase("deep_base"));
  assert.equal(legal.length, 2, "one an end, not one a spine");
  assert.deepEqual(legal.map((anchor) => anchor.anchorId), ["end_flat_left_l1_y128", "end_flat_right_l1_y128"]);
  assert.deepEqual(legal.map((anchor) => anchor.worldMm[1]), [128.5, 128.5], "the front spine, the one you see");
});

test("more bookends than ends still places every end there is", () => {
  const state = Object.assign({}, withBase("standard_base"), { bookends: 12 });
  const legal = engine.legalBookendAnchors(catalog, state);
  const placements = engine.bookendPlacements(catalog, state);
  assert.equal(legal.length, 2);
  assert.equal(placements.length, 2, "never more than there are ends");
  assert.deepEqual(idsOf(placements), idsOf(legal));
  assert.equal(state.bookends, 12, "and the count itself is left alone, so all twelve are priced");

  // An empty design, and a design of nothing but trimmed units, place none.
  assert.equal(engine.bookendPlacements(catalog, engine.createState(catalog, { bookends: 4 })).length, 0);
  const trimmed = Object.assign({}, withBase("standard_base_trimmed"), { bookends: 4 });
  assert.equal(engine.bookendPlacements(catalog, trimmed).length, 0);
});

test("the same design always gets the same bookends", () => {
  let state = withBase("wide_base");
  state = grow(state, "wide_extension");
  state = grow(state, "standard_base", (candidate) => candidate.originWorldMm[0] > 1000, { adjacentBasesOnly: true });
  state = Object.assign({}, state, { bookends: 3 });

  const first = engine.bookendPlacements(catalog, state);
  assert.ok(first.length >= 3, "this design has room for three");
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(idsOf(engine.bookendPlacements(catalog, state)), idsOf(first));
  }
  // Round-tripping through the serialised form is the same design, so it is
  // the same picture: this is what the share link and the render console rely
  // on.
  const reloaded = engine.deserializeState(catalog, JSON.parse(JSON.stringify(engine.serializeState(state))));
  assert.deepEqual(idsOf(engine.bookendPlacements(catalog, reloaded)), idsOf(first));
});

test("a turned unit turns its anchors with it", () => {
  let state = withBase("corner_base");
  state = grow(state, "standard_base", (candidate) => candidate.rotationDeg === 90);
  const turned = engine.legalBookendAnchors(catalog, state)
    .filter((anchor) => anchor.instanceId !== state.instances[0].id);
  assert.ok(turned.length, "the turned unit still offers an end");
  for (const anchor of turned) {
    assert.ok([90, 270].includes(anchor.rotationDeg), `a quarter-turned unit's bookend faces along y, not x (${anchor.rotationDeg})`);
  }
  // The anchor is on the unit, not at the origin: it moved with it.
  const host = state.instances.find((instance) => instance.id === turned[0].instanceId);
  const bounds = engine.instanceBounds(catalog, host);
  assert.ok(turned[0].worldMm[0] >= bounds[0] - 1 && turned[0].worldMm[0] <= bounds[3] + 1, "inside its host in x");
  assert.ok(turned[0].worldMm[1] >= bounds[1] - 1 && turned[0].worldMm[1] <= bounds[4] + 1, "inside its host in y");
});

test("a piece left out of the invoice still takes a bookend", () => {
  const state = withBase("standard_base");
  const omitted = engine.setInstanceOmitted(catalog, state, state.instances[0].id, true);
  assert.ok(omitted.instances[0].omitted, "the piece really is marked omitted");
  assert.equal(
    engine.legalBookendAnchors(catalog, omitted).length,
    engine.legalBookendAnchors(catalog, state).length,
    "a shelf the client already owns is still a shelf"
  );
});

test("drawing the bookends changes no design code", () => {
  // The whole point of deriving the placement: nothing about it is serialised,
  // so every code that was ever shared still resolves to the same design. If
  // this fails, something was added to serializeState and must come back out.
  let state = withBase("standard_base");
  state = grow(state, "standard_extension");
  const serialised = engine.serializeState(state);
  assert.deepEqual(
    Object.keys(serialised).sort(),
    ["bookends", "finish", "instances", "schemaVersion"],
    "the serialised design carries a count and nothing else about bookends"
  );
  const codes = new Set();
  for (const count of [0, 1, 5, 12]) {
    const counted = Object.assign({}, state, { bookends: count });
    codes.add(engine.designCode(counted));
    assert.deepEqual(
      engine.serializeState(counted),
      Object.assign({}, serialised, { bookends: count }),
      "the count is the only thing that moves"
    );
  }
  assert.equal(codes.size, 4, "the count still changes the code, as it always did");
});

console.log(failures ? `\n${failures} bookend placement test(s) failed` : "\nall bookend placement tests passed");
process.exit(failures ? 1 : 0);

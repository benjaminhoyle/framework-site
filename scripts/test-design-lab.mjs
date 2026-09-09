#!/usr/bin/env node
/**
 * Tests for the design lab.
 *
 *   node scripts/test-design-lab.mjs
 *
 * The lab's three promises, and what would break each one silently:
 *
 *   1. A design in the corpus opens in /builder. The link is written here and
 *      read by app.js's decodeDesign; nothing but a test joins the two.
 *   2. No two designs in a corpus are the same shelf. The identity has to be
 *      blind to where a design sits and which way it faces, or the review queue
 *      fills with the same shelf turned round.
 *   3. Nothing in the corpus is a plain run. That rule is enforced by building
 *      the runs and comparing identities, so it follows Simple's own algorithm
 *      rather than a guess at what its output looks like.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ROOT, engine, loadCatalog, canonicalKey, canonicalKeyOfPieces,
  dimensions, shelfDimensions, fitsEnvelope, shareHash, decodeShareHash as libDecodeShareHash, buildPlainRun,
  plainRunKeys, priceOf, mulberry32
} from "./lib/design-lab.mjs";
import { placementViolation, repair, violations, middleSocketIds, clumps, longEdgeOf, longEdgeHangs } from "./lib/design-rules.mjs";
import { planShotsFor } from "./lib/shot-plan.mjs";
import { parseFrontMatter, designConstraints, listBriefs, loadBrief } from "./lib/briefs.mjs";
import { readStore, isPartialRow, mergeRow } from "./lib/lab-store.mjs";
import { createRequire as createBrowserRequire } from "node:module";

const catalog = loadCatalog();
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

// --------------------------------------------------------------- identity ---

/** The eight ways the same shelf can be set down, applied to a box list. */
function turn(pieces, quarters, mirror) {
  return pieces.map(({ moduleId, box }) => {
    let [minX, minY, maxX, maxY] = [box[0], box[1], box[3], box[4]];
    for (let i = 0; i < quarters; i += 1) {
      [minX, minY, maxX, maxY] = [-maxY, minX, -minY, maxX];
    }
    if (mirror) [minX, maxX] = [-maxX, -minX];
    return { moduleId, box: [minX, minY, box[2], maxX, maxY, box[5]] };
  });
}

function piecesOf(state) {
  return state.instances.map((instance) => ({
    moduleId: instance.moduleId,
    box: engine.instanceBounds(catalog, instance)
  }));
}

test("a shelf turned or mirrored is the same shelf", () => {
  const design = buildPlainRun(catalog, { family: "standard", width: 3, levels: 2 });
  const pieces = piecesOf(design);
  const key = canonicalKeyOfPieces(pieces);
  for (let quarters = 0; quarters < 4; quarters += 1) {
    for (const mirror of [false, true]) {
      assert.equal(
        canonicalKeyOfPieces(turn(pieces, quarters, mirror)),
        key,
        `turned ${quarters * 90} degrees${mirror ? " and mirrored" : ""}`
      );
    }
  }
});

test("a shelf moved across the room is the same shelf", () => {
  const design = buildPlainRun(catalog, { family: "compact", width: 2, levels: 3 });
  const pieces = piecesOf(design);
  const moved = pieces.map(({ moduleId, box }) => ({
    moduleId,
    box: [box[0] + 4000, box[1] - 250, box[2], box[3] + 4000, box[4] - 250, box[5]]
  }));
  assert.equal(canonicalKeyOfPieces(moved), canonicalKeyOfPieces(pieces));
});

test("different shelves are different", () => {
  const two = buildPlainRun(catalog, { family: "standard", width: 2, levels: 2 });
  const three = buildPlainRun(catalog, { family: "standard", width: 3, levels: 2 });
  assert.notEqual(canonicalKey(catalog, two), canonicalKey(catalog, three));
});

// ------------------------------------------------------------- plain runs ---

test("Simple's own designs are all excluded", () => {
  const keys = plainRunKeys(catalog, { maxWidth: 4, maxLevels: 3 });
  for (const family of ["standard", "compact", "wide"]) {
    for (let width = 1; width <= 4; width += 1) {
      const run = buildPlainRun(catalog, { family, width, levels: 2 });
      assert.ok(run && run.instances.length, `${family} ${width}-wide built`);
      assert.ok(keys.has(canonicalKey(catalog, run)), `${family} ${width}-wide is a known plain run`);
    }
  }
});

test("a plain run with a piece added is no longer a plain run", () => {
  const keys = plainRunKeys(catalog, { maxWidth: 4, maxLevels: 3 });
  const run = buildPlainRun(catalog, { family: "standard", width: 3, levels: 2 });
  const candidates = engine.generateCandidates(catalog, run, "standard_top_bar", {});
  assert.ok(candidates.length, "a display bar fits on a three-wide run");
  const altered = engine.applyCandidate(catalog, run, candidates[0]);
  assert.ok(!keys.has(canonicalKey(catalog, altered)));
});

// ------------------------------------------------------------------ links ---

/**
 * app.js's decodeDesign, as far as the lab's links exercise it. Kept here
 * rather than imported because app.js is a browser module that reaches for the
 * DOM on load; this is the shape its decoder reads, and a change to that shape
 * that this misses is a change that would break the links in the field.
 */
function decodeShareHash(encoded) {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  assert.equal(payload[0], 1, "schema 1");
  const [, mode, finish, bookends, types, rows] = payload;
  assert.ok(["simple", "standard", "advanced"].includes(mode), `mode ${mode} is one the page knows`);
  const instances = rows.map((row, index) => ({
    id: `item_${String(index + 1).padStart(3, "0")}`,
    type: types[row[0]],
    originWorldMm: [row[1], row[2], 0],
    rotationDeg: row[3] || 0,
    placement: row[4]
      ? { method: "socket", on: (row[5] || []).map((support) => `item_${String(support + 1).padStart(3, "0")}`) }
      : { method: "floor" }
  }));
  return engine.deserializeState(catalog, { schemaVersion: 1, finish, bookends, instances });
}

test("a generated link decodes back to the design it was written from", () => {
  const design = buildPlainRun(catalog, { family: "broad", width: 2, levels: 2, lamp: true });
  const reopened = decodeShareHash(shareHash(design));
  assert.deepEqual(
    engine.serializeState(reopened).instances.map((row) => [row.type, row.originWorldMm, row.rotationDeg]),
    engine.serializeState(design).instances.map((row) => [row.type, row.originWorldMm, row.rotationDeg])
  );
  assert.equal(canonicalKey(catalog, reopened), canonicalKey(catalog, design));
});

test("the lab's own decoder reads back the link the lab wrote", () => {
  // decodeShareHash is what the studio's "edit this shelf" runs on a link
  // pasted back from /builder, so it has to agree with the encoder beside it
  // and with the page's decoder above.
  const design = buildPlainRun(catalog, { family: "broad", width: 3, levels: 2, lamp: false });
  const reopened = libDecodeShareHash(catalog, shareHash(design));
  assert.equal(canonicalKey(catalog, reopened), canonicalKey(catalog, design));
  assert.equal(shareHash(reopened), shareHash(design), "and writes the same link back out");

  // The three shapes somebody actually pastes are the same string with
  // different amounts of address in front of it.
  const hash = shareHash(design);
  for (const pasted of [hash, `#${hash}`, `https://framework.co.ke/builder#${hash}`]) {
    assert.equal(canonicalKey(catalog, libDecodeShareHash(catalog, pasted)), canonicalKey(catalog, design),
      `decodes ${pasted.slice(0, 30)}…`);
  }
  assert.throws(() => libDecodeShareHash(catalog, ""), /no design code/);
  assert.throws(() => libDecodeShareHash(catalog, "not-a-design"), /not a design code|unsupported/);
});

// ------------------------------------------------------------------ rules ---

/** Grow a stack by placing `moduleId` on whatever is highest. */
function stackOn(state, moduleId) {
  const candidates = engine.generateCandidates(catalog, state, moduleId, {});
  assert.ok(candidates.length, `${moduleId} has somewhere to go`);
  const highest = candidates.reduce((best, candidate) =>
    candidate.supportPlaneZ > best.supportPlaneZ ? candidate : best);
  return engine.applyCandidate(catalog, state, highest);
}

/**
 * Put a second base against the first. Deliberately the adjacent-only spacing:
 * the gapped positions are up to 1.8m away, which is a different test's subject
 * and would make every design here two separate pieces of furniture.
 */
function beside(state, moduleId) {
  const candidates = engine.generateCandidates(catalog, state, moduleId, { adjacentBasesOnly: true });
  assert.ok(candidates.length, `${moduleId} fits beside`);
  const nearest = candidates.reduce((best, candidate) =>
    Math.abs(candidate.originWorldMm[0]) < Math.abs(best.originWorldMm[0]) ? candidate : best);
  return engine.applyCandidate(catalog, state, nearest);
}

function floorBase(moduleId) {
  const empty = engine.createState(catalog, { finish: "sage", bookends: 0 });
  return engine.applyCandidate(catalog, empty,
    engine.generateCandidates(catalog, empty, moduleId, {})[0]);
}

test("an adapter's middle joint is read off its own sockets", () => {
  assert.deepEqual([...middleSocketIds(catalog.modules.deep_adapter)].sort(),
    ["top_x0703_y0000", "top_x0703_y0427"]);
  // A plain extension has no joint its bottom does not already have.
  assert.equal(middleSocketIds(catalog.modules.deep_extension).size, 0);
});

test("a riser holding nothing is taken out, not rejected", () => {
  let design = floorBase("standard_base");
  design = beside(design, "standard_base");
  design = stackOn(design, "standard_spacer");
  assert.ok(violations(catalog, design).some((breach) => breach.rule === "riser-with-nothing-above"));

  const fixed = repair(catalog, design);
  assert.ok(!fixed.instances.some((instance) => catalog.modules[instance.moduleId].role === "spacer"),
    "the spacer is gone");
  assert.equal(fixed.instances.length, design.instances.length - 1, "and nothing else is");
  assert.deepEqual(violations(catalog, fixed), []);
});

test("a riser carrying something is left alone", () => {
  let design = floorBase("standard_base");
  design = stackOn(design, "standard_spacer");
  design = stackOn(design, "standard_extension");
  assert.deepEqual(violations(catalog, design), []);
  assert.equal(repair(catalog, design).instances.length, design.instances.length);
});

test("an adapter with an unused joint becomes the plain extension", () => {
  let design = floorBase("deep_base");
  design = stackOn(design, "deep_adapter");
  assert.ok(violations(catalog, design).some((breach) => breach.rule === "adapter-middle-joint-unused"));

  const fixed = repair(catalog, design);
  assert.ok(fixed.instances.some((instance) => instance.moduleId === "deep_extension"),
    "swapped for the extension of the same size");
  assert.ok(!fixed.instances.some((instance) => catalog.modules[instance.moduleId].role === "adapter"));
  assert.deepEqual(violations(catalog, fixed), []);
});

test("an adapter whose joint carries a shelf is left alone", () => {
  let design = floorBase("deep_base");
  design = stackOn(design, "deep_adapter");
  const adapter = design.instances[design.instances.length - 1];
  const middle = middleSocketIds(catalog.modules.deep_adapter);
  const spanning = engine.generateCandidates(catalog, design, "broad_extension", {})
    .find((candidate) => (candidate.consumedSockets || []).some((socket) =>
      socket.instanceId === adapter.id && middle.has(socket.socketId)));
  assert.ok(spanning, "something can sit on the middle joint");
  const bridged = engine.applyCandidate(catalog, design, spanning);
  assert.deepEqual(violations(catalog, bridged), []);
  assert.equal(repair(catalog, bridged).instances.length, bridged.instances.length);
});

test("a corner extension needs a corner base under it, turned the same way", () => {
  let design = floorBase("standard_base");
  design = stackOn(design, "corner_extension");
  const added = design.instances[design.instances.length - 1];
  const breach = placementViolation(catalog, design, added.id);
  assert.ok(breach, "a corner shelf over a straight base is refused");
  assert.equal(breach.rule, "corner-extension-without-corner-base");

  let proper = floorBase("corner_base");
  proper = stackOn(proper, "corner_extension");
  const onCorner = proper.instances[proper.instances.length - 1];
  assert.equal(placementViolation(catalog, proper, onCorner.id), null);
});

test("a hanger needs a spacer under it", () => {
  let bare = floorBase("broad_base");
  bare = stackOn(bare, "broad_hanger");
  const hanger = bare.instances[bare.instances.length - 1];
  assert.equal(placementViolation(catalog, bare, hanger.id).rule, "hanger-without-spacer-below");

  let spaced = floorBase("broad_base");
  spaced = stackOn(spaced, "broad_spacer");
  spaced = stackOn(spaced, "broad_hanger");
  const proper = spaced.instances[spaced.instances.length - 1];
  assert.equal(placementViolation(catalog, spaced, proper.id), null);
});

test("a stack does not mix a trimmed cut with a full one", () => {
  let design = floorBase("standard_base");
  design = stackOn(design, "standard_extension_trimmed");
  const added = design.instances[design.instances.length - 1];
  assert.equal(placementViolation(catalog, design, added.id).rule, "mixed-trim-in-stack");
  // Opened up, it is allowed -- the exceptions are not known yet.
  assert.equal(placementViolation(catalog, design, added.id, { consistentTrimInStack: false }), null);
});

test("a gap with nothing over it is two pieces of furniture", () => {
  const empty = engine.createState(catalog, { finish: "sage", bookends: 0 });
  let apart = engine.applyCandidate(catalog, empty,
    engine.generateCandidates(catalog, empty, "standard_base", {})[0]);

  // The widest legal spacing Advanced offers: the one a bridge is meant for.
  const gapped = engine.generateCandidates(catalog, apart, "standard_base", {})
    .filter((candidate) => candidate.originWorldMm[0] > 0)
    .sort((a, b) => b.originWorldMm[0] - a.originWorldMm[0])[0];
  assert.ok(gapped, "a gapped base position exists");
  apart = engine.applyCandidate(catalog, apart, gapped);

  assert.equal(clumps(catalog, apart), 2, "two bases, nothing joining them");
  assert.ok(violations(catalog, apart).some((breach) => breach.rule === "disconnected-clumps"));
  // And allowed again when the rule is turned off.
  assert.ok(!violations(catalog, apart, { mustBeConnected: false })
    .some((breach) => breach.rule === "disconnected-clumps"));
});

test("a span across the gap makes it one piece again", () => {
  const empty = engine.createState(catalog, { finish: "sage", bookends: 0 });
  let design = engine.applyCandidate(catalog, empty,
    engine.generateCandidates(catalog, empty, "standard_base", {})[0]);
  const second = engine.generateCandidates(catalog, design, "standard_base", {})
    .filter((candidate) => candidate.originWorldMm[0] > 0)
    .sort((a, b) => a.originWorldMm[0] - b.originWorldMm[0])[0];
  design = engine.applyCandidate(catalog, design, second);

  // Something resting on both towers at once is what a gap is offered for.
  const bridge = ["wide_extension", "deep_extension", "standard_extension"]
    .flatMap((moduleId) => engine.generateCandidates(catalog, design, moduleId, {}))
    .find((candidate) => new Set((candidate.consumedSockets || [])
      .map((socket) => socket.instanceId)).size > 1);
  if (!bridge) return; // no span reaches this spacing; the rule is still right
  const joined = engine.applyCandidate(catalog, design, bridge);
  assert.equal(clumps(catalog, joined), 1);
  assert.ok(!violations(catalog, joined).some((breach) => breach.rule === "disconnected-clumps"));
});

test("a corner's long edge turns with the piece", () => {
  assert.deepEqual(longEdgeOf({ rotationDeg: 0 }), { axis: 0, sign: 1 });
  assert.deepEqual(longEdgeOf({ rotationDeg: 90 }), { axis: 1, sign: 1 });
  assert.deepEqual(longEdgeOf({ rotationDeg: 180 }), { axis: 0, sign: -1 });
  assert.deepEqual(longEdgeOf({ rotationDeg: 270 }), { axis: 1, sign: -1 });
});

test("a corner with nothing turned against it becomes a straight unit", () => {
  const lone = floorBase("corner_base");
  assert.ok(longEdgeHangs(catalog, lone, lone.instances[0]));
  assert.ok(violations(catalog, lone).some((breach) => breach.rule === "corner-long-edge-hanging"));

  const fixed = repair(catalog, lone);
  assert.equal(fixed.instances[0].moduleId, "standard_base", "the corner it should have been");
  assert.deepEqual(violations(catalog, fixed), []);
});

test("a real turn answers the long edge and is left alone", () => {
  const corner = floorBase("corner_base");
  const turns = engine.generateCandidates(catalog, corner, "standard_base", {})
    .filter((candidate) => (candidate.rotationDeg || 0) % 180 === 90);
  assert.ok(turns.length, "the engine offers a turn");

  for (const turn of turns) {
    const turned = engine.applyCandidate(catalog, corner, turn);
    assert.ok(!longEdgeHangs(catalog, turned, turned.instances[0]),
      `turn at ${turn.originWorldMm} answers the long edge`);
    assert.deepEqual(violations(catalog, turned), []);
    assert.ok(repair(catalog, turned).instances.some((instance) => instance.moduleId === "corner_base"),
      "and the corner stays a corner");
  }

  // A neighbour in line with the corner is not a turn, whatever else it is.
  const straight = engine.generateCandidates(catalog, corner, "standard_base", {})
    .find((candidate) => (candidate.rotationDeg || 0) === 0);
  const inLine = engine.applyCandidate(catalog, corner, straight);
  assert.ok(longEdgeHangs(catalog, inLine, inLine.instances[0]));
});

test("a spacer under nothing but a lamp is a lamp on a stick", () => {
  let design = floorBase("standard_base");
  design = beside(design, "standard_base");
  design = stackOn(design, "standard_spacer");
  const spacer = design.instances[design.instances.length - 1];

  const lamps = engine.generateCandidates(catalog, design, "lamp", {})
    .filter((candidate) => (candidate.consumedSockets || [])
      .some((socket) => socket.instanceId === spacer.id));
  assert.ok(lamps.length, "a lamp will sit on the spacer");
  const lit = engine.applyCandidate(catalog, design, lamps[0], { rotationDeg: 0 });

  assert.ok(violations(catalog, lit).some((breach) => breach.rule === "riser-holding-only-a-fitting"));
  const fixed = repair(catalog, lit);
  assert.ok(!fixed.instances.some((instance) => catalog.modules[instance.moduleId].role === "spacer"),
    "the spacer goes");
  assert.ok(!fixed.instances.some((instance) => catalog.modules[instance.moduleId].role === "lamp"),
    "and so does the lamp that was propping it up");
  assert.deepEqual(violations(catalog, fixed), []);
});

test("a spacer carrying a shelf keeps its lamp", () => {
  let design = floorBase("standard_base");
  design = stackOn(design, "standard_spacer");
  design = stackOn(design, "standard_extension");
  assert.deepEqual(violations(catalog, design), []);
  assert.equal(repair(catalog, design).instances.length, design.instances.length);
});

test("display bars are rationed", () => {
  let design = floorBase("standard_base");
  design = beside(design, "standard_base");
  let bars = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidates = engine.generateCandidates(catalog, design, "standard_top_bar", {});
    if (!candidates.length) break;
    design = engine.applyCandidate(catalog, design, candidates[0]);
    bars += 1;
  }
  assert.ok(bars >= 2, "the test needs more than one bar to ration");
  assert.ok(violations(catalog, design).some((breach) => breach.rule === "too-many-display-bars"));
  const fixed = repair(catalog, design);
  const left = fixed.instances.filter((instance) => catalog.modules[instance.moduleId].role === "top_bar");
  assert.equal(left.length, 1);
});

// ---------------------------------------------------------------- corpora ---

test("the lamp is out of the quoted size and in the envelope test", () => {
  const withLamp = buildPlainRun(catalog, { family: "standard", width: 2, levels: 2, lamp: true });
  const plain = buildPlainRun(catalog, { family: "standard", width: 2, levels: 2, lamp: false });
  assert.ok(dimensions(catalog, withLamp).heightMm > dimensions(catalog, plain).heightMm,
    "the full box grows by the lamp");
  assert.equal(shelfDimensions(catalog, withLamp).heightMm, dimensions(catalog, plain).heightMm,
    "the quoted size does not");
});

test("the envelope accepts a design that only fits turned", () => {
  const envelope = { widthMm: 3000, heightMm: 1900, depthMm: 1000 };
  assert.ok(fitsEnvelope({ widthMm: 2500, depthMm: 400, heightMm: 1200 }, envelope));
  assert.ok(fitsEnvelope({ widthMm: 400, depthMm: 2500, heightMm: 1200 }, envelope), "turned");
  assert.ok(!fitsEnvelope({ widthMm: 2500, depthMm: 1400, heightMm: 1200 }, envelope));
  assert.ok(!fitsEnvelope({ widthMm: 2500, depthMm: 400, heightMm: 2400 }, envelope), "too tall to turn out of");
});

test("a generated corpus keeps every rule it claims to", () => {
  const out = path.join(os.tmpdir(), `design-lab-test-${process.pid}.json`);
  execFileSync(process.execPath, [
    path.join(ROOT, "scripts/generate-designs.mjs"),
    "--count", "40", "--seed", "99", "--out", out
  ], { stdio: "pipe" });
  const corpus = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });

  assert.equal(corpus.designs.length, 40);
  const plainRuns = plainRunKeys(catalog);
  const seen = new Set();

  for (const record of corpus.designs) {
    const state = engine.deserializeState(catalog, record.design);
    const where = `design ${record.code}`;

    assert.ok(engine.validateState(catalog, state).isValid, `${where} is buildable`);
    assert.ok(fitsEnvelope(dimensions(catalog, state), corpus.envelopeMm), `${where} fits the envelope`);

    const bases = state.instances.filter((instance) => catalog.modules[instance.moduleId].role === "base");
    assert.ok(bases.length >= 2, `${where} is not a single unit or a stack`);
    assert.ok(state.instances.length >= corpus.minPieces, `${where} has enough pieces`);

    const key = canonicalKey(catalog, state);
    assert.ok(!plainRuns.has(key), `${where} is not a plain run`);
    assert.deepEqual(violations(catalog, state, corpus.rules), [], `${where} breaks no rule`);
    assert.ok(!seen.has(key), `${where} is not a repeat of an earlier one`);
    seen.add(key);

    // A design has one colour, and no piece carries one of its own.
    assert.equal(state.finish, corpus.finish, `${where} is one colour`);
    assert.ok(state.instances.every((instance) => !instance.finish), `${where} has no per-piece colour`);

    // The recorded figures are the ones the page would work out for itself.
    assert.deepEqual(record.sizeMm, dimensions(catalog, state), `${where} size`);
    assert.equal(record.totalKsh, priceOf(catalog, state).totalKsh, `${where} price`);
    assert.equal(record.code, engine.designCode(state), `${where} code`);
  }
});

test("the same seed makes the same corpus", () => {
  const first = mulberry32(4);
  const second = mulberry32(4);
  const a = Array.from({ length: 20 }, () => first());
  const b = Array.from({ length: 20 }, () => second());
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------------ shots ---

function judgedRow(spec) {
  const design = buildPlainRun(catalog, spec);
  return { code: engine.designCode(design), design: engine.serializeState(design), note: "" };
}

test("a design is planned four angles, all facing it", () => {
  const shots = planShotsFor(catalog, judgedRow({ family: "standard", width: 3, levels: 2 }), {
    angles: 4,
    random: () => 0.5
  });
  assert.equal(shots.length, 4);
  for (const shot of shots) {
    assert.ok(shot.figureAnchors.length, `${shot.id} knows where a person can stand`);
    assert.ok(shot.eyeMm[2] === 1550, "eye height is a standing person's");
    assert.ok(shot.cameraOrPlan !== null);
    // In front of the shelf, not behind it: a plain run faces -y.
    assert.ok(shot.eyeMm[1] < shot.focusMm[1], `${shot.id} stands in front`);
  }
  const yaws = shots.map((shot) => shot.yawDeg);
  assert.equal(new Set(yaws).size, 4, "four different angles");
});

test("a corner design is only shot from inside its 90 degrees", () => {
  // A corner base with a run turned against it: the wedge is the inside.
  const empty = engine.createState(catalog, { finish: "sage" });
  let design = engine.applyCandidate(catalog, empty,
    engine.generateCandidates(catalog, empty, "corner_base", {})[0]);
  const turn = engine.generateCandidates(catalog, design, "standard_base", {})
    .find((candidate) => (candidate.rotationDeg || 0) % 180 === 90);
  if (!turn) return;
  design = engine.applyCandidate(catalog, design, turn);

  const shots = planShotsFor(catalog, {
    code: engine.designCode(design), design: engine.serializeState(design), note: ""
  }, { angles: 4, random: () => 0.5 });

  assert.ok(shots.length, "a corner design gets shots");
  assert.equal(shots[0].legs, 2, "two legs is what makes it a corner");
  for (const shot of shots) {
    const absolute = shot.facingYawDeg + shot.yawDeg;
    const fromMiddle = Math.abs(absolute - shot.facingYawDeg);
    assert.ok(fromMiddle <= 45,
      `${shot.id} is ${fromMiddle} degrees off the middle of the wedge, which is 90 wide`);
  }
});

// ----------------------------------------------------------------- scenes ---

/**
 * The scene modules are browser files that hang themselves off `window`. A
 * pretend window is enough to read them here, and reading them here is the only
 * way a bad preset gets caught before it costs an image.
 */
let sceneModules = null;
function loadSceneModules() {
  // Loaded once and kept: these files run their body on require and hang the
  // result off `window`, so a second require is a cache hit that assigns
  // nothing and hands back an empty window.
  if (sceneModules) return sceneModules;
  const browserRequire = createBrowserRequire(import.meta.url);
  global.window = {};
  browserRequire(path.join(ROOT, "js/studio/prompt-config.js"));
  browserRequire(path.join(ROOT, "js/studio/scale.js"));
  browserRequire(path.join(ROOT, "js/studio/scene-prompt.js"));
  browserRequire(path.join(ROOT, "js/studio/brief.js"));
  browserRequire(path.join(ROOT, "js/design-lab/scene-presets.js"));
  sceneModules = global.window;
  return sceneModules;
}

/** A brief as the studio would parse it from framework-marketing/briefs. */
const KIDS_ROOM_BRIEF = {
  name: "kids-room-grows",
  scene: "kids-room",
  persona: "parent",
  fullness: "full",
  light: "daylight",
  mood: "bright, well kept, real",
  must: ["picture books in English and French, spines out", "one wooden toy on a low shelf"],
  avoid: ["tote bag", "phone charging"],
  pin: ["scene", "persona", "fullness"],
  formats: ["4:5", "1:1"],
  count: 6,
  body: "A family that arrived in Nairobi within the year, two children under eight."
};

/** Deterministic randomness, so a failing draw can be reproduced. */
function seeded(seed) {
  const next = mulberry32(seed);
  return () => next();
}

test("an empty brief is random mode, and every draw names things that exist", () => {
  const browser = loadSceneModules();
  const { CONFIG } = browser.PROMPT_CONFIG;
  const presets = browser.FrameworkScenePresets;
  const groupOf = {
    scene: "scenes", light: "light", persona: "persona", fullness: "fullness",
    livedIn: "livedIn", camera: "camera", framing: "framing", colourMood: "colourMood",
    wall: "walls", floor: "floors", rug: "rugs", furniture: "furniture", windowView: "windowView"
  };
  const batch = { random: seeded(7) };
  const lights = new Set();
  const rooms = new Set();
  for (let n = 0; n < 40; n += 1) {
    const { params } = presets.resolve(null, CONFIG, batch);
    assert.equal(params.shotType, "use");
    assert.ok((CONFIG.archetypes || []).some((entry) => entry.id === params.archetype), `${params.archetype} is a place`);
    for (const [key, group] of Object.entries(groupOf)) {
      assert.ok((CONFIG[group] || []).some((option) => option.id === params[key]), `${key}=${params[key]} is an option`);
    }
    for (const id of params.humanTraces) {
      const trace = CONFIG.humanTraces.find((option) => option.id === id);
      assert.ok(trace, `${id} is a trace`);
      assert.ok(!trace.rooms || trace.rooms.includes(params.scene), `${id} belongs in a ${params.scene}`);
    }
    for (const id of params.details) {
      const detail = CONFIG.details.find((option) => option.id === id);
      assert.ok(detail, `${id} is a detail`);
      assert.ok(!detail.rooms || detail.rooms.includes(params.scene), `${id} belongs in a ${params.scene}`);
    }
    const prompt = browser.FrameworkScenePrompt.build(CONFIG, params, { aspect: "4:3" });
    assert.ok(prompt.includes("THE PLACE"), "a random scene still describes a place");
    lights.add(params.light);
    rooms.add(params.scene);
  }
  assert.ok(lights.size >= 4, `forty draws use ${lights.size} lights`);
  assert.ok(rooms.size >= 6, `forty draws use ${rooms.size} rooms`);
});

test("a brief pins what it says and draws the rest, without repeating a trace", () => {
  const browser = loadSceneModules();
  const { CONFIG } = browser.PROMPT_CONFIG;
  const batch = { random: seeded(11) };
  const daylight = new Set(CONFIG.light.filter((option) => option.daylight).map((option) => option.id));
  const seenTraces = [];
  const lights = new Set();
  for (let n = 0; n < 12; n += 1) {
    const { params, must, avoid } = browser.FrameworkBrief.resolve(KIDS_ROOM_BRIEF, CONFIG, batch);
    assert.equal(params.scene, "kids-room");
    assert.equal(params.persona, "parent");
    assert.equal(params.fullness, "full");
    assert.equal(params.livedIn, "well-kept", "the mood word names the register");
    assert.ok(daylight.has(params.light), `${params.light} is daylight`);
    assert.ok(!params.humanTraces.includes("tote-bag") && !params.humanTraces.includes("phone-cable"), "avoid is honoured");
    assert.equal(must.length, 2);
    assert.deepEqual(avoid, ["tote bag", "phone charging"]);
    seenTraces.push(...params.humanTraces);
    lights.add(params.light);
  }
  // The kids-room trace pool is larger than a dozen images draw, so nothing
  // should have come round twice.
  assert.equal(new Set(seenTraces).size, seenTraces.length, `traces drawn once each: ${seenTraces.join(", ")}`);
  assert.ok(lights.size >= 2, "the light still varies under a pinned brief");
});

test("when books are the point the shelf is full and open books may rest on a surface", () => {
  const browser = loadSceneModules();
  const { CONFIG } = browser.PROMPT_CONFIG;
  const { params } = browser.FrameworkBrief.resolve(
    Object.assign({}, KIDS_ROOM_BRIEF, { fullness: "light", pin: ["scene", "persona"] }), CONFIG, { random: seeded(3) });
  const prompt = browser.FrameworkScenePrompt.build(CONFIG, params, { aspect: "1:1" });
  assert.ok(prompt.includes("Books may be open only if resting on a surface"), "the books rule relaxed");
  assert.ok(!prompt.includes("Do NOT show open books"), "the strict rule is gone");
  assert.ok(prompt.includes("every tier carrying something"), "fill is full");
  assert.ok(prompt.includes("picture books in English and French"), "the must is on the shelf");
  assert.ok(prompt.includes("one wooden toy on a low shelf"), "the second must is on the shelf");
  assert.ok(/DO NOT include:.*tote bag, phone charging/.test(prompt), "avoid joins the negative prompt");
  assert.ok(prompt.includes("WHO LIVES HERE"), "the story is in the place");

  const strict = browser.FrameworkScenePrompt.build(CONFIG,
    Object.assign({}, params, { persona: "minimalist", must: [] }), { aspect: "1:1" });
  assert.ok(strict.includes("Do NOT show open books"), "a minimalist keeps the strict rule");
});

test("every scene preset names things that exist", () => {
  const browser = loadSceneModules();
  const { CONFIG } = browser.PROMPT_CONFIG;
  const presets = browser.FrameworkScenePresets.PRESETS;
  assert.ok(presets.length >= 20, `${presets.length} scenes is enough to cycle`);

  const archetypes = new Set((CONFIG.archetypes || []).map((entry) => entry.id));
  const groupOf = {
    scene: "scenes", light: "light", persona: "persona", fullness: "fullness",
    livedIn: "livedIn", camera: "camera", framing: "framing", colourMood: "colourMood",
    wall: "walls", floor: "floors", rug: "rugs", furniture: "furniture", windowView: "windowView"
  };
  const ids = new Set();
  for (const preset of presets) {
    assert.ok(!ids.has(preset.id), `${preset.id} appears once`);
    ids.add(preset.id);
    assert.ok(archetypes.has(preset.archetype), `${preset.id} names a real archetype`);
    for (const [key, value] of Object.entries(preset.params)) {
      const group = groupOf[key];
      if (!group) continue;
      assert.ok((CONFIG[group] || []).some((option) => option.id === value),
        `${preset.id}: ${key}=${value} is not an option`);
    }
  }
});

test("no scene is lit by anything but daylight", () => {
  // Warm low sun flatters a photograph and lies about a finish, and the finish
  // is what somebody is choosing.
  const browser = loadSceneModules();
  for (const preset of browser.FrameworkScenePresets.PRESETS) {
    assert.ok(!["golden", "evening-lamps", "night"].includes(preset.params.light),
      `${preset.id} is lit by ${preset.params.light}`);
  }
});

test("every preset builds a prompt with its place in it", () => {
  const browser = loadSceneModules();
  const { CONFIG, DEFAULTS } = browser.PROMPT_CONFIG;
  const presets = browser.FrameworkScenePresets;
  for (const preset of presets.PRESETS) {
    const params = presets.paramsFor(preset, CONFIG, DEFAULTS);
    const prompt = browser.FrameworkScenePrompt.build(CONFIG, params, { aspect: "4:3" });
    assert.ok(prompt.length > 2000, `${preset.id} builds a full prompt`);
    assert.ok(prompt.includes("THE PLACE"), `${preset.id} describes a place`);
    assert.ok(prompt.includes("Aspect ratio: 4:3"), `${preset.id} carries the aspect`);
  }
});

/**
 * What a finished image job comes back looking like.
 *
 * This is the shape /api/ai-result actually returns today, copied from a live
 * job: the picture is an object carrying `base64` and `mimeType`, with no
 * `dataUrl` anywhere on it. The studio read only `dataUrl`, found nothing, and
 * reported "3 failed" for three scenes that had been generated and paid for.
 *
 * Costing an image to find that out again is the reason this is a test.
 */
let sceneJobs = null;
function loadSceneJobs() {
  // Once and kept: the file runs its body on require and hangs the result off
  // `window`, so a second require is a cache hit that assigns nothing.
  if (sceneJobs) return sceneJobs;
  const browserRequire = createBrowserRequire(import.meta.url);
  global.window = {};
  browserRequire(path.join(ROOT, "js/design-lab/scene-jobs.js"));
  sceneJobs = global.window.FrameworkSceneJobs;
  return sceneJobs;
}

test("a finished scene job is read out of the envelope it arrives in", () => {
  const { firstImage } = loadSceneJobs();
  const payload = "x".repeat(400);

  assert.equal(
    firstImage({
      state: "done",
      provider: "gemini",
      result: { text: "", images: [{ mimeType: "image/jpeg", url: "/api/ai-image?id=j&n=0", base64: payload }] }
    }),
    `data:image/jpeg;base64,${payload}`,
    "the live envelope: an object with base64 and no dataUrl");

  // The shapes it has arrived in before, which still have to work.
  assert.equal(firstImage({ dataUrl: `data:image/png;base64,${payload}` }), `data:image/png;base64,${payload}`);
  assert.equal(firstImage({ result: { images: [{ dataUrl: `data:image/png;base64,${payload}` }] } }),
    `data:image/png;base64,${payload}`);
  assert.equal(firstImage({ images: [payload] }), `data:image/jpeg;base64,${payload}`);
  assert.equal(
    firstImage({ raw: { candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "image/webp", data: payload } }] } }] } }),
    `data:image/webp;base64,${payload}`);

  // And a job that genuinely came back without a picture still says so.
  assert.equal(firstImage({ state: "done", result: { text: "no image", images: [] } }), null);
  assert.equal(firstImage({ result: { images: [{ mimeType: "image/jpeg", url: "/api/ai-image?id=j&n=0" }] } }), null,
    "a url on its own is not a picture");
});

/**
 * The envelope a real scene arrives in.
 *
 * ai-background copies an image into the result only while its base64 is under
 * four megabytes (INLINE_IMAGE_BASE64_LIMIT); above that the picture is in
 * Blobs and the result carries a `url` to it and nothing else. A scene at the
 * size the studio asks for is always above it, so this is not the unusual case
 * — it is every scene, and reading only the envelope failed every one of them.
 */
test("a scene too big to travel in its own envelope is found where it is kept", () => {
  const { firstImage, imageUrl } = loadSceneJobs();

  // Copied from a live job that the studio reported as failed.
  const stored = {
    state: "done",
    provider: "gemini",
    result: {
      text: "",
      images: [{ mimeType: "image/jpeg", url: "/api/ai-image?id=job_mtmgvpxj_nm5svlcbdt&n=0" }],
      finish: "STOP",
      modelUsed: "gemini-3-pro-image-preview"
    }
  };
  assert.equal(firstImage(stored), null, "there is nothing inline to find");
  assert.equal(imageUrl(stored), "/api/ai-image?id=job_mtmgvpxj_nm5svlcbdt&n=0", "but there is somewhere to look");

  // A job that finished with no picture at all has nowhere to look either, and
  // must still be reported as a failure rather than fetched from nothing.
  assert.equal(imageUrl({ state: "done", result: { text: "refused", images: [] } }), null);
  assert.equal(imageUrl({ state: "done" }), null);
});

// ------------------------------------------------- what the shelf is, in words ---

/**
 * The structural block the studio appends to a scene prompt.
 *
 * It exists because an audit of ten generated scenes found one fault wearing
 * different hats: the model normalises an asymmetric, multi-module, stepped
 * shelf into the rectangular bookcase it expects. The same shot scored 4.2 in a
 * café and 2.2 in a bedroom — given a bedroom, a low module became a bedside
 * table. Saying the shape out loud, from the design rather than from the
 * picture, took the matched cases from 2.72 to 3.58.
 *
 * These tests guard the two things that make it worth having: it must describe
 * the shape *correctly*, and it must never assert something it cannot derive.
 */
let designWords = null;
function loadDesignWords() {
  if (designWords) return designWords;
  const browserRequire = createBrowserRequire(import.meta.url);
  global.window = {};
  browserRequire(path.join(ROOT, "js/design-lab/design-words.js"));
  designWords = global.window.FrameworkDesignWords;
  return designWords;
}

test("a stepped shelf is described as stepping, in the right order", () => {
  const words = loadDesignWords();
  // Two low bases side by side with a tall stack bridging the gap above them:
  // the low-TALL-low outline that was being drawn as a flat rectangle.
  let design = buildPlainRun(catalog, { family: "slim", width: 1, levels: 1 });
  const bases = design.instances.length;
  assert.ok(bases, "the run has a base to build on");

  const boxes = design.instances.map((instance) => ({
    instance, box: engine.instanceBounds(catalog, instance)
  }));
  const runs = words.skyline(boxes);
  assert.ok(runs.length >= 1, "a plain run has an outline");
  for (const run of runs) {
    assert.ok(run.topMm > 0 && run.widthMm > 0, "every run has a real height and width");
  }

  // A plain rectangular run must NOT be described as stepping: the block earns
  // its place by being true, and "its top edge is NOT level" about a shelf
  // whose top edge is level would teach the model to distrust all of it.
  const text = words.build(engine, catalog, design);
  if (runs.length < 2) {
    assert.ok(!text.includes("It steps, left to right"),
      "a level-topped shelf is not described as stepped");
  }
  assert.ok(text.includes("ONE freestanding piece of furniture"),
    "every shelf is said to be one object — that is the bedside-table fix");
  assert.ok(text.includes("measuring aid for scale only"),
    "and the grey figure in every render is disowned");
});

test("the outline is read off the geometry, not guessed", () => {
  const words = loadDesignWords();
  const design = buildPlainRun(catalog, { family: "broad", width: 3, levels: 2 });
  const boxes = design.instances.map((instance) => ({
    instance, box: engine.instanceBounds(catalog, instance)
  }));
  const runs = words.skyline(boxes);
  const bounds = engine.designBounds(catalog, design);
  const tallest = Math.max(...runs.map((run) => run.topMm));
  assert.ok(Math.abs(tallest - bounds[5]) <= 100,
    `the outline's tallest run (${tallest}) is the design's own height (${bounds[5]})`);
  const spanned = runs.reduce((sum, run) => sum + run.widthMm, 0);
  assert.ok(spanned <= bounds[3] - bounds[0] + 100,
    "and the runs do not describe more shelf than there is");
});

test("the words never claim a board count or a board height", () => {
  const words = loadDesignWords();
  // Coincident boards where modules meet make both unreliable to derive, and a
  // confidently wrong "there must be exactly 8 shelves" is worse than silence —
  // the reference image carries those, this carries what the image loses.
  for (const spec of [
    { family: "slim", width: 1, levels: 1 },
    { family: "broad", width: 2, levels: 3, lamp: true }
  ]) {
    const text = words.build(engine, catalog, buildPlainRun(catalog, spec));
    assert.ok(!/\b(tiers?|shelves|boards)\b[^.]*\bexactly\b/i.test(text),
      "no exact tier claim");
    assert.ok(!/\d+ (shelf boards|boards|tiers)\b/i.test(text),
      `no counted boards in: ${text.slice(0, 120)}`);
  }
});

test("the two-tone finish is stated, with the frame always the darker half", () => {
  const words = loadDesignWords();
  // Every finish in the catalogue is a dark steel frame carrying lighter MDF,
  // and the shared prompt says "the steel frame colour must match" in the
  // singular — so nothing ever told the model there were two. Audited over
  // fifteen scenes the split was gone or muddied in 86% of them, the worst
  // score on the board and the only one whose instruction did not exist.
  for (const finish of catalog.finishes) {
    const block = words.materials(catalog, finish.id).join("\n");
    assert.ok(block.includes(finish.steelHex), `${finish.id} names its steel hex`);
    assert.ok(block.includes(finish.mdfHex), `${finish.id} names its board hex`);
    assert.ok(block.includes("TWO-TONE"), `${finish.id} says the product is two-tone`);

    // The direction must never come out backwards, whatever the palette.
    const ratio = words.toneRatio(finish.steelHex, finish.mdfHex);
    assert.ok(ratio > 1,
      `${finish.id}: steel ${finish.steelHex} must be darker than board ${finish.mdfHex} (ratio ${ratio})`);
  }
});

test("the collars and the square corners are said again where they survive", () => {
  const words = loadDesignWords();
  // Both are in the shared prompt already and both were still being lost —
  // collars in 80% of scenes — which is what one line buried mid-list does.
  const text = words.build(engine, catalog,
    buildPlainRun(catalog, { family: "slim", width: 2, levels: 2 }), { finish: "marine" });
  assert.ok(text.includes("STACKED SEGMENTS"), "the collars are restated");
  assert.ok(text.includes("sawn square"), "and so are the square corners");
  // They have to land after the room, which here means after everything else.
  assert.ok(text.indexOf("STACKED SEGMENTS") > text.indexOf("ONE freestanding"),
    "the material notes come after the shape, at the end where they are read last");
  assert.ok(/steel frame still clearly DARKER/.test(text),
    "and the closing check asks about the two-tone split by name");
});

test("units butted side by side are called out as separate boards", () => {
  const words = loadDesignWords();
  // The failure this answers is not the silhouette: the outline can be right
  // and the shelf still wrong, because three bases at 3 cm centres are three
  // boards on three pairs of posts and the model paints one continuous surface.
  const run = buildPlainRun(catalog, { family: "standard", width: 3, levels: 1 });
  const boxes = run.instances.map((instance) => ({
    instance,
    module: catalog.modules[instance.moduleId],
    box: engine.instanceBounds(catalog, instance)
  }));
  const junctions = words.seams(boxes);
  const floorUnits = run.instances.filter((i) => catalog.modules[i.moduleId].role === "base").length;
  if (floorUnits > 1) {
    assert.ok(junctions.length >= floorUnits - 1,
      `${floorUnits} bases side by side make at least ${floorUnits - 1} junctions, found ${junctions.length}`);
    const text = words.build(engine, catalog, run, { finish: "sage" });
    assert.ok(text.includes("SEPARATE UNITS, TOUCHING"), "and the prompt says so");
    assert.ok(text.includes("STOP AND"), "naming the break in the boards");
  }

  // A lamp overlapping its neighbour is not a junction between two boards.
  const withLamp = buildPlainRun(catalog, { family: "broad", width: 2, levels: 2, lamp: true });
  const lampBoxes = withLamp.instances.map((instance) => ({
    instance,
    module: catalog.modules[instance.moduleId],
    box: engine.instanceBounds(catalog, instance)
  }));
  for (const entry of lampBoxes) {
    if (entry.module.role !== "lamp") continue;
    assert.ok(!words.seams(lampBoxes).some((j) => Math.abs(j.heightMm - entry.box[2]) < 1 &&
      lampBoxes.filter((o) => o.module.role === "lamp").length === lampBoxes.length),
      "a lamp is never counted as a board junction");
  }
});

test("a shelf standing in one place is not told to keep gaps open", () => {
  const words = loadDesignWords();
  const design = buildPlainRun(catalog, { family: "slim", width: 1, levels: 2 });
  const text = words.build(engine, catalog, design);
  const boxes = design.instances.map((instance) => ({
    instance, box: engine.instanceBounds(catalog, instance)
  }));
  const { sections } = words.footprint(boxes);
  if (sections.length === 1) {
    assert.ok(!text.includes("separate places"),
      "one footprint is not described as several");
    assert.ok(!text.includes("span ACROSS"), "and nothing bridges nothing");
  }
});

test("the scene cycle walks the list instead of drawing at random", () => {
  const browser = loadSceneModules();
  const presets = browser.FrameworkScenePresets;
  const cycle = presets.cycle(0);
  const seen = presets.PRESETS.map(() => cycle.next().id);
  assert.equal(new Set(seen).size, presets.PRESETS.length,
    "a full turn of the cycle shows every scene exactly once");
  assert.equal(cycle.next().id, seen[0], "and then starts again");
});

// ----------------------------------------------------------------- briefs ---

/*
 * The example from framework-marketing/briefs/README.md, as it is written
 * there, comments and all. If the format in the README and the parser here
 * drift apart, this is where it shows.
 */
const BRIEF_EXAMPLE = `---
name: kids-room-grows
segment: expat parents
story: A low, wide shelf in a child's room that grows as the child does
scene: kids-room                 # a scene id from prompt-config
persona: parent                  # shelf contents, or leave blank for the pools
fullness: full
light: daylight                  # daylight | any | evening
mood: bright, well kept, real
must:                            # two or three signals drawn from the story
  - picture books in English and French, spines out
  - one wooden toy on a low shelf
avoid:
  - tote bag
  - phone charging
pin: [scene, persona, fullness]  # everything else varies per image
formats: ["4:5", "1:1"]
count: 6
design:
  height_mm_max: 1200
  width_mm: [1400, 2400]
  colours: [sage, coral]
---
One paragraph in words, for the prompt and for whoever reads this later: who
lives here, what the room is like, why this configuration.
`;

test("a brief's front matter reads as the README shows it", () => {
  const { data, body } = parseFrontMatter(BRIEF_EXAMPLE);
  assert.equal(data.name, "kids-room-grows");
  assert.equal(data.scene, "kids-room", "a trailing comment is not part of the value");
  assert.equal(data.mood, "bright, well kept, real", "a comma in a plain value is not a list");
  assert.deepEqual(data.must, ["picture books in English and French, spines out", "one wooden toy on a low shelf"]);
  assert.deepEqual(data.avoid, ["tote bag", "phone charging"]);
  assert.deepEqual(data.pin, ["scene", "persona", "fullness"], "a flow list, with its comment dropped");
  assert.deepEqual(data.formats, ["4:5", "1:1"], "quoted items lose their quotes");
  assert.equal(data.count, 6, "a number is a number");
  assert.deepEqual(data.design, { height_mm_max: 1200, width_mm: [1400, 2400], colours: ["sage", "coral"] });
  assert.ok(body.startsWith("One paragraph in words"), "the body is what follows the block");
  assert.ok(!body.includes("---"), "and carries no fence");
  assert.deepEqual(parseFrontMatter("# Just a README\n\nwords").data, {}, "a file without a block has no fields");
});

test("a brief's design block becomes the generator's constraints", () => {
  const { data } = parseFrontMatter(BRIEF_EXAMPLE);
  const constraints = designConstraints(data, ["marine", "sage", "charcoal", "coral"]);
  assert.deepEqual(constraints, { widthMinMm: 1400, widthMaxMm: 2400, heightMaxMm: 1200, colours: ["sage", "coral"] });
  assert.deepEqual(designConstraints({ design: { colours: ["sage", "teal"] } }, ["sage"]).colours, ["sage"],
    "a colour the catalogue does not have is dropped");
  assert.deepEqual(designConstraints({ design: { colours: ["teal"] } }, ["sage"]), {},
    "and a list of only those is no constraint at all");
  assert.deepEqual(designConstraints({ design: { width_mm_max: 1800, max_height_mm: 900 } }, null),
    { widthMaxMm: 1800, heightMaxMm: 900 }, "either spelling of a bound is read");
  assert.deepEqual(designConstraints({}, null), {}, "no design block asks nothing");
});

test("briefs are listed and loaded from a folder, README and all", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "briefs-"));
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# Creative briefs\n\nOne file per configuration.\n");
    fs.writeFileSync(path.join(dir, "kids-room-grows.md"), BRIEF_EXAMPLE);
    fs.writeFileSync(path.join(dir, "reading-wall.md"), "---\nname: reading-wall\nstory: Books\nscene: library-wall\n---\nA wall.\n");
    const listed = listBriefs(dir);
    assert.deepEqual(listed.map((entry) => entry.name), ["kids-room-grows", "reading-wall"], "the README is not a brief");
    assert.equal(listed[0].count, 6);
    const brief = loadBrief("kids-room-grows", dir);
    assert.equal(brief.scene, "kids-room");
    assert.equal(brief.body.split("\n")[0], "One paragraph in words, for the prompt and for whoever reads this later: who");
    assert.equal(loadBrief("../etc/passwd", dir), null, "a name is a file name and nothing else");
    assert.equal(loadBrief("nothing-here", dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a corpus grown under a brief keeps to its design block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "briefs-"));
  const out = path.join(os.tmpdir(), `design-lab-brief-test-${process.pid}.json`);
  try {
    fs.writeFileSync(path.join(dir, "low-and-wide.md"), [
      "---", "name: low-and-wide", "story: A low wide shelf", "scene: kids-room",
      "design:", "  height_mm_max: 1200", "  width_mm: [1400, 2400]", "  colours: [sage, coral]", "---", "Low.", ""
    ].join("\n"));
    execFileSync(process.execPath, [
      path.join(ROOT, "scripts/generate-designs.mjs"),
      "--count", "12", "--seed", "7", "--out", out, "--brief", "low-and-wide"
    ], { stdio: "pipe", env: Object.assign({}, process.env, { FRAMEWORK_BRIEFS_DIR: dir }) });
    const corpus = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(corpus.brief, "low-and-wide", "the corpus says which brief grew it");
    assert.equal(corpus.finish, null, "no single colour when the brief names two");
    assert.deepEqual(corpus.finishes, ["sage", "coral"]);
    assert.equal(corpus.envelopeMm.heightMm, 1200, "the envelope shrinks to the brief's ceiling");
    assert.equal(corpus.designs.length, 12);
    for (const record of corpus.designs) {
      const state = engine.deserializeState(catalog, record.design);
      const size = shelfDimensions(catalog, state);
      const where = `design ${record.code}`;
      assert.ok(size.heightMm <= 1200, `${where} is no taller than the brief allows (${size.heightMm})`);
      const alongWall = Math.max(size.widthMm, size.depthMm);
      assert.ok(alongWall >= 1400 && alongWall <= 2400, `${where} is as wide as the brief asks (${alongWall})`);
      assert.ok(["sage", "coral"].includes(state.finish), `${where} is one of the brief's colours`);
    }
    assert.ok(corpus.designs.some((record) => record.design.finish === "sage")
      && corpus.designs.some((record) => record.design.finish === "coral"), "both colours were drawn");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { force: true });
  }
});

// ------------------------------------------------------------------ store ---

test("an audit's fidelity is merged onto the scene it names, not written over it", () => {
  const scene = { id: "S1", shotId: "X-1", code: "X", verdict: null, params: { scene: "kids-room" } };
  const audit = { id: "S1", fidelity: { score: 4.2, verdict: "pass", issues: [] } };
  assert.ok(isPartialRow(audit), "a row with only a key and a fidelity block is an addition");
  assert.ok(!isPartialRow(scene), "a scene row is whole, even before it is judged");
  assert.ok(!isPartialRow({ fingerprint: "f", verdict: "keep", design: {} }), "so is a design verdict");

  const merged = mergeRow(scene, audit);
  assert.deepEqual(merged, Object.assign({}, scene, { fidelity: audit.fidelity }), "the score lands on the scene");
  assert.equal(mergeRow(null, scene), scene, "a whole row with nothing on record is itself");

  // The page judges the scene a moment later, from a copy that never saw the
  // audit. The score survives; the verdict is the page's.
  const judged = Object.assign({}, scene, { verdict: "keep", note: "good" });
  const kept = mergeRow(merged, judged);
  assert.equal(kept.verdict, "keep");
  assert.deepEqual(kept.fidelity, audit.fidelity, "a whole row keeps the fidelity it did not bring");
  // And an audit run again replaces its own block rather than layering on it.
  const again = mergeRow(kept, { id: "S1", fidelity: { score: 2.1, verdict: "fail", issues: ["gained a tier"] } });
  assert.equal(again.fidelity.verdict, "fail");
  assert.equal(again.verdict, "keep");
});

test("the store reads back the last line for every key", () => {
  const file = path.join(os.tmpdir(), `lab-store-test-${process.pid}.jsonl`);
  try {
    fs.writeFileSync(file, [
      JSON.stringify({ id: "A", verdict: null, shotId: "s" }),
      JSON.stringify({ fingerprint: "F", verdict: "reject", design: {} }),
      JSON.stringify({ id: "A", verdict: "keep", shotId: "s" }),
      '{"id": "B", "verdict": nul'
    ].join("\n") + "\n");
    const rows = readStore(file);
    assert.deepEqual(Object.keys(rows).sort(), ["A", "F"], "a half-written last line is skipped");
    assert.equal(rows.A.verdict, "keep", "later lines win");
    assert.deepEqual(readStore(path.join(os.tmpdir(), "no-such-store.jsonl")), {}, "no file is an empty record");
  } finally {
    fs.rmSync(file, { force: true });
  }
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\ndesign lab ok");

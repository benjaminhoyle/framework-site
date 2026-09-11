#!/usr/bin/env node
/**
 * Guards on the /how-b story, js/assembly/story-b.js.
 *
 *   node scripts/test-assembly-story-b.mjs
 *
 * The same arithmetic walk scripts/test-assembly-story.mjs makes over the
 * current story, against this one, plus the checks that are particular to a
 * story that takes a plain shelf apart and trades two of its parts for The
 * Curator's Shelf's:
 *
 *  - the two derived Wide Extensions are where the builder's own engine puts
 *    them, and the plain shelf they make is a shelf the engine will build;
 *  - nothing ever passes through anything, checked pair by pair over the
 *    whole timeline, not just against what a piece rests on;
 *  - a part waiting to arrive or gone after leaving is outside the frame on
 *    every aspect ratio up to 21:9, measured with the renderer's own view;
 *  - every part the finished shelf is made of reaches its resting place;
 *  - the three pins carry the bake's names for the parts they follow;
 *  - the finish is the catalogue's Sage, not a hand-typed pair that drifts;
 *  - every word is what this story means to say, with no em dash anywhere.
 *
 * Not in `npm test`: package.json is shared and was not touched for this
 * version. Run it by hand, or add it to the test line if B is the one kept.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT, engine as placement, loadCatalog } from "./lib/design-lab.mjs";

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) return;
  failures += 1;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
};

// --- load the browser files into one fake window ---------------------------

const context = {
  window: {
    location: { search: "" },
    matchMedia: () => ({ matches: false }),
    URLSearchParams
  },
  navigator: {},
  document: { createElement: () => ({ getContext: () => null }) },
  URLSearchParams,
  performance: { now: () => 0 }
};
context.window.window = context.window;
vm.createContext(context);
// The renderer is loaded for its view direction: the story anchors its pins
// against it and this test measures the frame with it.
for (const file of ["builder/renderer.js", "assembly/curator-shelf.js", "assembly/story-b.js", "assembly/scroll-story.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), context, { filename: file });
}

const shelf = context.window.FrameworkAssemblyShelf;
const story = context.window.FrameworkAssemblyStory;
const engine = context.window.FrameworkAssembly;
const VIEW = context.window.FrameworkDesignerRenderer && context.window.FrameworkDesignerRenderer.VIEW_DIRECTION;
check("all four scripts define their global", Boolean(shelf && story && engine && VIEW));

// --- the pieces: the bake's seven and the two derived from it ----------------

const byId = new Map(shelf.pieces.map((piece) => [piece.id, piece]));
for (const piece of story.plain) byId.set(piece.id, piece);
const ids = new Set(story.pieces.map((piece) => piece.id));
check("the story carries the bake's seven pieces and two more", story.pieces.length === 9 && story.plain.length === 2,
  `${story.pieces.length} pieces, ${story.plain.length} derived`);
for (const piece of shelf.pieces) check(`the bake's ${piece.id} is in the story`, ids.has(piece.id));

/*
 * The derived pieces against the engine. The plain shelf is built as a
 * design (the shape data/assembly/curator.design.json has), from the bake's
 * own joints, and run through the placement engine; its translations,
 * bounds and supports must be the story's exactly.
 */
{
  const catalog = loadCatalog();
  const origin = (id) => byId.get(id).joints[0];
  const record = {
    schemaVersion: 1, finish: story.finish, bookends: 0,
    instances: [
      { id: "item_001", type: "wide_base", originWorldMm: [0, 0, 0], rotationDeg: 0, placement: { method: "floor" } },
      { id: "item_002", type: byId.get("item_002").moduleId, originWorldMm: origin("item_002"), rotationDeg: byId.get("item_002").rot, placement: { method: "socket", on: ["item_001"] } },
      { id: "plain_2", type: "wide_extension", originWorldMm: origin("plain_2"), rotationDeg: 0, placement: { method: "socket", on: ["item_002"] } },
      { id: "plain_3", type: "wide_extension", originWorldMm: origin("plain_3"), rotationDeg: 0, placement: { method: "socket", on: ["plain_2"] } },
      { id: "item_007", type: "wide_extension", originWorldMm: origin("item_007"), rotationDeg: 0, placement: { method: "socket", on: ["plain_3"] } }
    ]
  };
  // The adapter's origin in the design is the joint at the origin corner,
  // which for a piece rotated 180 is the last of its joints, not the first.
  record.instances[1].originWorldMm = byId.get("item_002").joints.find((j) => j[0] === 0 && j[1] === 0) || origin("item_002");
  const state = placement.deserializeState(catalog, record.design || record);
  const validation = placement.validateState(catalog, state);
  check("the plain shelf is a shelf the engine will build", validation.isValid, (validation.reasons || []).join("; "));
  for (const instance of state.instances) {
    const piece = byId.get(instance.id);
    const t = instance.translation.map((n) => Math.round(n * 100) / 100);
    check(`${instance.id} rests where the engine puts it`, t.every((n, i) => Math.abs(n - piece.t[i]) < 0.01), `engine ${t.join(",")}, story ${piece.t.join(",")}`);
    const bounds = placement.instanceBounds(catalog, instance).map(Math.round);
    check(`${instance.id} has the bounds the engine gives it`, bounds.every((n, i) => Math.abs(n - piece.bounds[i]) < 0.5), `engine ${bounds.join(",")}, story ${piece.bounds.join(",")}`);
    const supports = [...new Set((instance.consumedSockets || []).map((s) => s.instanceId))].sort();
    const stated = instance.id === "item_007" ? ["plain_3"] : (piece.on || []).slice().sort();
    check(`${instance.id} rests on what the engine says`, supports.join(",") === stated.join(","), `engine ${supports.join(",")}, story ${stated.join(",")}`);
  }
  const plainModules = new Set(state.instances.map((i) => i.moduleId));
  check("the plain shelf asks for no bundle the page does not already load", [...plainModules].every((id) => shelf.modules.includes(id)));

  // The finish: the catalogue's pair for the story's finish, not a hand copy.
  const finish = catalog.finishes.find((f) => f.id === story.finish);
  check("the story names a finish the catalogue has", Boolean(finish), story.finish);
  if (finish) {
    check("the story paints in Sage", finish.id === "sage");
    check("the palette is the catalogue's own pair for that finish",
      story.palette.steel === finish.builder.steel && story.palette.surface === finish.builder.surface,
      `story ${JSON.stringify(story.palette)}, catalogue ${JSON.stringify({ steel: finish.builder.steel, surface: finish.builder.surface })}`);
    check("the finish's name is the catalogue's", story.finishName === finish.displayName, story.finishName);
  }
}

// --- the timeline ----------------------------------------------------------

const times = story.keys.map((key) => key.at);
const clashes = times.filter((at, index) => times.indexOf(at) !== index);
check("no two keys sit at the same instant", clashes.length === 0, `repeated: ${[...new Set(clashes)].join(", ")}`);

const sorted = [...times].sort((a, b) => a - b);
check("the timeline starts at 0 and ends at 1",
  sorted[0] === 0 && sorted[sorted.length - 1] === 1,
  `starts ${sorted[0]}, ends ${sorted[sorted.length - 1]}`);

for (const key of story.keys) {
  for (const id of Object.keys(key.pieces || {})) {
    check(`key ${key.at} names a real piece`, ids.has(id), `no piece "${id}"`);
  }
}

const keys = engine.fillCameras(engine.resolveKeys(story));

let finite = true;
let ordering = true;
let anyHidden = false;
for (let step = 0; step <= 1000; step += 1) {
  const moment = engine.sample(keys, step / 1000);
  if (moment.focus.some((n) => !Number.isFinite(n)) || !Number.isFinite(moment.padding)) finite = false;
  for (let axis = 0; axis < 3; axis += 1) {
    if (!(moment.focus[axis] < moment.focus[axis + 3])) ordering = false;
  }
  for (const id of Object.keys(moment.pieces)) {
    if (moment.pieces[id].off.some((n) => !Number.isFinite(n))) finite = false;
    if (moment.pieces[id].hidden) anyHidden = true;
  }
}
check("every sampled frame is finite", finite);
check("every focus box has its min below its max on all three axes", ordering);
check("nothing is ever hidden: a part that is not in the picture is outside the frame, not switched off", !anyHidden);

// --- who is where, when ------------------------------------------------------

const PLAIN = ["item_001", "item_002", "plain_2", "plain_3", "item_007"];
const CURATOR = shelf.pieces.map((piece) => piece.id);
const LEAVING = ["plain_2", "plain_3"];
const ARRIVING = CURATOR.filter((id) => !PLAIN.includes(id));
const atRest = (state) => state.off.every((n) => Math.abs(n) < 0.01);

// The first frame is the plain shelf, whole; the last is The Curator's
// Shelf, whole. In both, the parts that are not in the picture are a full
// travel away along x, at the height of their tier in the air.
{
  const first = engine.sample(keys, 0);
  for (const id of PLAIN) check(`${id} is assembled at p=0`, atRest(first.pieces[id]), `offset ${first.pieces[id].off.join(",")}`);
  for (const id of ARRIVING) {
    check(`${id} waits off-frame at p=0`, Math.abs(first.pieces[id].off[0] + story.outMm) < 0.01, `offset ${first.pieces[id].off.join(",")}`);
  }
  const last = engine.sample(keys, 1);
  for (const id of CURATOR) check(`${id} is assembled at p=1`, atRest(last.pieces[id]), `offset ${last.pieces[id].off.join(",")}`);
  for (const id of LEAVING) {
    check(`${id} is gone off-frame at p=1`, Math.abs(last.pieces[id].off[0] - story.outMm) < 0.01, `offset ${last.pieces[id].off.join(",")}`);
  }
}

const tierOf = { item_001: 0, item_002: 1, item_003: 2, item_004: 2, plain_2: 2, item_005: 3, item_006: 3, plain_3: 3, item_007: 4 };
const LIFT = 120;

// The first hold: the plain shelf fully exploded, every tier 120 mm per tier
// above where it rests, and the Curator's parts still waiting.
{
  const hold = engine.sample(keys, 0.42);
  for (const id of PLAIN) {
    const off = hold.pieces[id].off;
    check(`${id} is exploded by ${tierOf[id] * LIFT} mm in the first hold`,
      Math.abs(off[2] - tierOf[id] * LIFT) < 0.5 && Math.abs(off[0]) < 0.5 && Math.abs(off[1]) < 0.5, `offset ${off.join(",")}`);
  }
  for (const id of ARRIVING) check(`${id} is still waiting in the first hold`, hold.pieces[id].off[0] < -story.outMm + 0.5);
  const topExploded = byId.get("item_007").bounds[5] + 4 * LIFT;
  check("the exploded frame is taller than the hero frame", hold.focus[5] > engine.sample(keys, 0).focus[5]);
  check("the exploded frame clears the top piece", hold.focus[5] >= topExploded, `ceiling ${hold.focus[5]}, top ${topExploded}`);
}

// The second hold: The Curator's Shelf fully exploded, the two wide units
// gone, and the frame unchanged, so the swap happened inside one picture.
{
  const hold = engine.sample(keys, 0.70);
  for (const id of CURATOR) {
    const off = hold.pieces[id].off;
    check(`${id} is exploded by ${tierOf[id] * LIFT} mm in the second hold`,
      Math.abs(off[2] - tierOf[id] * LIFT) < 0.5 && Math.abs(off[0]) < 0.5 && Math.abs(off[1]) < 0.5, `offset ${off.join(",")}`);
  }
  for (const id of LEAVING) check(`${id} is gone in the second hold`, hold.pieces[id].off[0] > story.outMm - 0.5);
  check("the frame is the same in both holds", hold.focus.join(",") === engine.sample(keys, 0.42).focus.join(","));
}

// The swap: a leaving part moves only along x, and only outward; an arriving
// part moves only along x, and only inward. Neither ever moves in z during
// the swap, so the tiers stay where the explosion put them.
{
  let monotone = true;
  let level = true;
  let where = "";
  const prev = {};
  for (let step = 400; step <= 700; step += 1) {
    const moment = engine.sample(keys, step / 1000);
    for (const id of [...LEAVING, ...ARRIVING]) {
      const off = moment.pieces[id].off;
      if (Math.abs(off[2] - tierOf[id] * LIFT) > 0.5 || Math.abs(off[1]) > 0.5) { level = false; where = `${id} at p=${step / 1000}: ${off.join(",")}`; }
      if (prev[id] !== undefined && off[0] < prev[id] - 0.01) { monotone = false; where = `${id} at p=${step / 1000}`; }
      prev[id] = off[0];
    }
  }
  check("during the swap every part moves along x only, at its tier's height", level, where);
  check("during the swap every part moves one way only, rightward", monotone, where);
  const before = engine.sample(keys, 0.44);
  const after = engine.sample(keys, 0.66);
  check("the swap begins with everything in the first hold's places", [...LEAVING].every((id) => Math.abs(before.pieces[id].off[0]) < 0.5));
  check("the swap ends with everything in the second hold's places", [...ARRIVING].every((id) => Math.abs(after.pieces[id].off[0]) < 0.5));
  // Tier two before tier three, the reassembly's order kept in the air.
  const arrivedAt = (id) => {
    for (let step = 400; step <= 700; step += 1) {
      if (Math.abs(engine.sample(keys, step / 1000).pieces[id].off[0]) < 0.5) return step / 1000;
    }
    return null;
  };
  check("the slim unit and its post arrive before the shelf above them",
    arrivedAt("item_003") < arrivedAt("item_005") && arrivedAt("item_004") < arrivedAt("item_005"),
    `${arrivedAt("item_003")}, ${arrivedAt("item_004")} against ${arrivedAt("item_005")}`);
}

// --- nothing passes through anything -----------------------------------------

/*
 * Pair by pair, over the whole timeline: no two parts' boxes overlap on all
 * three axes at once. Parts that rest on one another share a face, and the
 * booster's box sits inside the adapter's footprint above it, so touching is
 * allowed and overlap by more than half a millimetre is not.
 */
{
  const boxOf = (id, off) => {
    const b = byId.get(id).bounds;
    return [b[0] + off[0], b[1] + off[1], b[2] + off[2], b[3] + off[0], b[4] + off[1], b[5] + off[2]];
  };
  let worst = 0;
  let where = "";
  const all = [...ids];
  for (let step = 0; step <= 1000; step += 1) {
    const moment = engine.sample(keys, step / 1000);
    const boxes = all.map((id) => boxOf(id, moment.pieces[id].off));
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        let depth = Infinity;
        for (let axis = 0; axis < 3; axis += 1) {
          depth = Math.min(depth, Math.min(a[axis + 3], b[axis + 3]) - Math.max(a[axis], b[axis]));
        }
        if (depth > worst) { worst = depth; where = `${all[i]} into ${all[j]} at p=${step / 1000}`; }
      }
    }
  }
  check("no two parts ever overlap", worst <= 0.5, `${worst.toFixed(1)} mm: ${where}`);
}

// A piece rises and falls with the pieces it rests on: at every point of the
// story its offset is at least its support's, in whichever shelf it belongs
// to at the time.
{
  let worst = 0;
  let where = "";
  const plainSupports = { item_002: ["item_001"], plain_2: ["item_002"], plain_3: ["plain_2"], item_007: ["plain_3"] };
  for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000;
    const moment = engine.sample(keys, p);
    const graph = p < 0.44 ? Object.entries(plainSupports) : p > 0.66 ? shelf.pieces.map((piece) => [piece.id, piece.on]) : [];
    for (const [id, on] of graph) {
      for (const support of on) {
        const gap = moment.pieces[id].off[2] - moment.pieces[support].off[2];
        if (gap < worst) { worst = gap; where = `${id} below ${support} at p=${p}`; }
      }
    }
  }
  check("no piece ever drops below what it rests on", worst >= -0.5, `${worst.toFixed(1)} mm: ${where}`);
}

// --- in and out of the frame -------------------------------------------------

/*
 * The renderer's fit(): the focus box is projected onto the camera's right
 * and up, and the half-height is the larger of the two after the aspect
 * ratio, times the padding. Rebuilt here from the renderer's own view
 * direction so the story's "outside the frame" is measured the way the
 * page draws it. A part that is waiting or gone must be outside the visible
 * frame on every aspect ratio up to 21:9, at every point of the story; a
 * part that is in the picture must be inside the focus box's ceiling.
 */
function normalise(v) { const n = Math.hypot(v[0], v[1], v[2]); return v.map((c) => c / n); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const forward = [-VIEW[0], -VIEW[1], -VIEW[2]];
const right = normalise(cross(forward, [0, 0, 1]));
const up = cross(right, forward);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function frameOf(focus, padding, aspect) {
  const centre = [(focus[0] + focus[3]) / 2, (focus[1] + focus[4]) / 2, (focus[2] + focus[5]) / 2];
  let halfWidth = 0;
  let halfHeight = 0;
  for (const x of [focus[0], focus[3]]) for (const y of [focus[1], focus[4]]) for (const z of [focus[2], focus[5]]) {
    const d = [x - centre[0], y - centre[1], z - centre[2]];
    halfWidth = Math.max(halfWidth, Math.abs(dot(right, d)));
    halfHeight = Math.max(halfHeight, Math.abs(dot(up, d)));
  }
  const half = Math.max(halfHeight, halfWidth / aspect, 120) * padding;
  return { centre, halfAcross: half * aspect, halfUp: half };
}
function screenExtent(id, off) {
  const b = byId.get(id).bounds;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
    const s = dot(right, [x + off[0], y + off[1], z + off[2]]);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [lo, hi];
}
for (const aspect of [0.67, 1.6, 1.78, 2.0, 2.33]) {
  let inside = 0;
  let where = "";
  for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000;
    for (const calm of [false, true]) {
      const moment = engine.sample(keys, p, calm);
      const frame = frameOf(moment.focus, moment.padding, aspect);
      const centre = dot(right, frame.centre);
      for (const id of [...ARRIVING, ...LEAVING]) {
        const off = moment.pieces[id].off;
        if (Math.abs(off[0]) < story.outMm - 0.5) continue; // travelling or in place
        const [lo, hi] = screenExtent(id, off);
        const over = Math.max(0, hi - (centre - frame.halfAcross), (centre + frame.halfAcross) - lo);
        const overlap = off[0] < 0 ? hi - (centre - frame.halfAcross) : (centre + frame.halfAcross) - lo;
        if (overlap > inside) { inside = overlap; where = `${id} at p=${p}${calm ? " (calm)" : ""}, ${overlap.toFixed(0)} mm of screen-right inside; over ${over.toFixed(0)}`; }
      }
    }
  }
  check(`a part that is waiting or gone is outside the frame at aspect ${aspect}`, inside <= 0, where);
}

// The top piece stays under the frame's ceiling at every point, in both the
// moving camera and the calm cuts. The focus box is what fit() is told to
// keep in frame, so this is the conservative form of "nothing leaves the
// picture".
for (const calm of [false, true]) {
  let worst = 0;
  let worstAt = 0;
  for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000;
    const moment = engine.sample(keys, p, calm);
    for (const id of ids) {
      const off = moment.pieces[id].off;
      if (Math.abs(off[0]) > 0.5) continue; // off to the side: judged above
      const top = byId.get(id).bounds[5] + off[2];
      const over = top - moment.focus[5];
      if (over > worst) { worst = over; worstAt = p; }
    }
  }
  check(`no piece rises above the frame's ceiling (${calm ? "calm" : "full"})`, worst <= 0,
    `${worst.toFixed(0)} mm over at p=${worstAt}`);
}

// --- lift order and landing order ----------------------------------------------

function firstMoveAt(id, from, to) {
  const start = engine.sample(keys, from).pieces[id].off;
  for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000;
    if (p < from || p > to) continue;
    const off = engine.sample(keys, p).pieces[id].off;
    if (off.some((n, i) => Math.abs(n - start[i]) > 0.5)) return p;
  }
  return null;
}
function restsAt(id, from, to) {
  for (let step = 1000; step >= 0; step -= 1) {
    const p = step / 1000;
    if (p < from || p > to) continue;
    if (!atRest(engine.sample(keys, p).pieces[id])) return Math.min(1, p + 0.001);
  }
  return from;
}
{
  const starts = Object.fromEntries(PLAIN.map((id) => [id, firstMoveAt(id, 0, 0.43)]));
  check("the base never moves", starts.item_001 === null);
  for (const id of ARRIVING) check(`${id} does not move before the swap`, firstMoveAt(id, 0, 0.43) === null);
  const order = ["item_007", "plain_3", "plain_2", "item_002"];
  for (let i = 1; i < order.length; i += 1) {
    check(`${order[i]} lifts after ${order[i - 1]} has started`, starts[order[i]] > starts[order[i - 1]],
      `${order[i - 1]} at ${starts[order[i - 1]]}, ${order[i]} at ${starts[order[i]]}`);
  }
  check("the lift begins at about 12%", starts.item_007 >= 0.11 && starts.item_007 <= 0.13, `at ${starts.item_007}`);
  check("the lift is done by 41%", PLAIN.every((id) => id === "item_001" || firstMoveAt(id, 0.41, 0.43) === null));
}
{
  const landed = Object.fromEntries(CURATOR.map((id) => [id, restsAt(id, 0.66, 1)]));
  for (const piece of shelf.pieces) {
    for (const support of piece.on) {
      check(`${piece.id} lands after ${support}`, landed[piece.id] > landed[support],
        `${piece.id} at ${landed[piece.id]}, ${support} at ${landed[support]}`);
    }
  }
  check("nothing lands before 74%", CURATOR.every((id) => id === "item_001" || landed[id] > 0.74),
    Object.entries(landed).map(([id, p]) => `${id} ${p}`).join(", "));
  check("everything has landed by 91%", Object.values(landed).every((p) => p <= 0.91),
    Object.entries(landed).map(([id, p]) => `${id} ${p}`).join(", "));
}

// --- captions and pins -----------------------------------------------------

let overlap = null;
for (let i = 1; i < story.captions.length; i += 1) {
  if (story.captions[i].from < story.captions[i - 1].to) {
    overlap = `"${story.captions[i - 1].title}" runs to ${story.captions[i - 1].to}, "${story.captions[i].title}" starts at ${story.captions[i].from}`;
  }
}
check("no two captions are on screen at once", !overlap, overlap);

let widest = 0;
for (let i = 1; i < story.captions.length; i += 1) {
  widest = Math.max(widest, story.captions[i].from - story.captions[i - 1].to);
}
check("no silent stretch longer than 6% of the story", widest <= 0.06, `widest gap ${(widest * 100).toFixed(1)}%`);

for (const caption of story.captions) {
  check("captions have both a title and a body", Boolean(caption.title && caption.body), caption.title);
  const middle = engine.windowOpacity((caption.from + caption.to) / 2, caption.from, caption.to);
  check("every caption reaches full opacity", middle > 0.999, `"${caption.title}" peaks at ${middle.toFixed(2)}`);
  const words = caption.body.split(/\s+/).length;
  check("every caption body is under 25 words, so the phone band keeps its room", words < 25, `"${caption.title}" body is ${words} words`);
}
const apart = story.captions.find((caption) => caption.id === "apart");
check("the swap's caption is up as the swap begins and through the hold", apart && apart.from <= 0.44 && apart.to >= 0.70, apart && `${apart.from} to ${apart.to}`);

check("three pins, and no more", story.pins.length === 3, `${story.pins.length} pins`);
for (const pin of story.pins) {
  const middle = engine.windowOpacity((pin.from + pin.to) / 2, pin.from, pin.to);
  check("every pin reaches full opacity", middle > 0.999, `"${pin.label}" peaks at ${middle.toFixed(2)}`);
  check(`pin "${pin.label}" opens in the second hold`, pin.from >= 0.66 && pin.from <= 0.70, `${pin.from}`);
  check(`pin "${pin.label}" is gone before its part has landed`, pin.to <= restsAt(pin.follow, 0.66, 1), `${pin.to} against ${restsAt(pin.follow, 0.66, 1)}`);
  const rides = byId.get(pin.follow);
  check(`pin "${pin.label}" follows a real piece`, Boolean(rides), pin.follow);
  check(`pin "${pin.label}" is the bake's name for ${pin.follow}`, rides && pin.label === rides.label, rides && rides.label);
  check(`pin "${pin.label}" names a part that arrived`, ARRIVING.includes(pin.follow), pin.follow);
  check(`pin "${pin.label}" is anchored on its part`, rides && pin.point[2] > rides.bounds[2] && pin.point[2] < rides.bounds[5]
    && rides.joints.some((j) => j[0] === pin.point[0] && j[1] === pin.point[1]), JSON.stringify(pin.point));
  check(`pin "${pin.label}" is three words or fewer`, pin.label.split(/\s+/).length <= 3);
}
check("the pins name the slim unit, a post and the shelf",
  story.pins.map((pin) => pin.label).sort().join(",") === "Slim Extension,Standard Booster,Standard Extension",
  story.pins.map((pin) => pin.label).join(","));

// --- the words -----------------------------------------------------------------

const WORDS = {
  "parts.title": "Five parts, one joint.",
  "parts.body": "A base and four units. Each one slides onto a pin on the one below. No tools.",
  "apart.title": "Choose different parts and it is a different shelf.",
  "apart.body": "Taller, wider, a low one for a child's room. The price is known before you order.",
  "together.title": "It comes apart again when you move.",
  "together.body": "Delivered assembled within Nairobi. Start with one unit, from Ksh 6,500/-, and add to it later.",
  "hero.title": "As shown: Ksh 36,500/- in Sage.",
  "hero.body": "The Curator's Shelf. Made in our Dagoretti Corner workshop."
};
for (const caption of story.captions) {
  check(`caption "${caption.id}" title is the story's`, caption.title === WORDS[`${caption.id}.title`], caption.title);
  check(`caption "${caption.id}" body is the story's`, caption.body === WORDS[`${caption.id}.body`], caption.body);
}
const hero = story.captions.find((caption) => caption.id === "hero");
check("the close names the finish the animation is drawn in", hero && hero.title.includes(story.finishName), hero && hero.title);
check("the close carries the bake's price", hero && hero.title.includes(shelf.totalKsh.toLocaleString("en-KE")), hero && hero.title);
check("the close has no photograph of the shelf in another finish", hero && hero.photo === null);

const PAGE_FILE = path.join(ROOT, "how-b.html");
const page = fs.readFileSync(PAGE_FILE, "utf8");
check("the page never says TCC", !/\bTCC\b/.test(page));

for (const file of ["how-b.html", "css/how-b.css", "js/assembly/story-b.js", "scripts/test-assembly-story-b.mjs"]) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  check(`${file} has no em dash`, !text.includes("\u2014"), `found at ${text.indexOf("\u2014")}`);
}

// --- the assets the page will actually ask for ------------------------------

const bundles = new Map();
for (const piece of story.pieces) bundles.set(piece.moduleId, "/assets/shelving/modules");
for (const [moduleId, base] of bundles) {
  check(`${moduleId}.json is on disk`, fs.existsSync(path.join(ROOT, base.replace(/^\//, ""), `${moduleId}.json`)));
}
const preloaded = [...page.matchAll(/href="([^"]*\/modules\/([a-z0-9_]+)\.json)"/g)].map((m) => m[2]);
for (const moduleId of bundles.keys()) {
  check(`${moduleId} is preloaded by the page`, preloaded.includes(moduleId));
}
for (const moduleId of preloaded) {
  check(`the page does not preload ${moduleId}, which this story never uses`, bundles.has(moduleId));
}
for (const src of [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s.startsWith("/"))) {
  check(`the page's script ${src} exists`, fs.existsSync(path.join(ROOT, src.replace(/^\//, ""))));
}
for (const caption of story.captions) {
  if (!caption.photo) continue;
  check(`the photograph for "${caption.id}" is on disk`, fs.existsSync(path.join(ROOT, story.photoBase.replace(/^\//, ""), `${caption.photo}.jpg`)));
}

// --- reduced motion still tells the whole story ------------------------------

{
  const shots = new Set();
  let calmFinite = true;
  for (let step = 0; step <= 1000; step += 1) {
    const moment = engine.sample(keys, step / 1000, true);
    if (moment.focus.some((n) => !Number.isFinite(n))) calmFinite = false;
    shots.add(moment.focus.join(","));
  }
  check("every calm frame is finite", calmFinite);
  const framings = new Set(keys.cameras.map((key) => key.focus.join(",")));
  check("calm cuts, never interpolates", shots.size === framings.size,
    `${shots.size} framings shown, ${framings.size} in the story`);
  const first = engine.sample(keys, 0.42, true);
  check("calm shows the plain shelf exploded", PLAIN.every((id) => Math.abs(first.pieces[id].off[2] - tierOf[id] * LIFT) < 0.5));
  const second = engine.sample(keys, 0.70, true);
  check("calm shows The Curator's Shelf exploded", CURATOR.every((id) => Math.abs(second.pieces[id].off[2] - tierOf[id] * LIFT) < 0.5 && Math.abs(second.pieces[id].off[0]) < 0.5));
  const mid = engine.sample(keys, 0.51, true);
  check("calm shows the swap in motion", Math.abs(mid.pieces.plain_2.off[0]) > 100 && Math.abs(mid.pieces.item_003.off[0]) > 100 && Math.abs(mid.pieces.item_003.off[0]) < story.outMm - 100);
  const calmEnd = engine.sample(keys, 1, true);
  for (const id of CURATOR) {
    check(`${id} still lands in calm`, atRest(calmEnd.pieces[id]));
  }
}

if (failures) {
  console.error(`\n${failures} story-b check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`story b ok: ${story.keys.length} keys (${keys.cameras.length} camera), ${story.pieces.length} pieces`
  + ` over ${bundles.size} bundles, ${story.captions.length} captions, ${story.pins.length} pins, ${story.finishName}`);

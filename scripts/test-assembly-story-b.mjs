#!/usr/bin/env node
/**
 * Guards on the /how-b story, js/assembly/story-b.js.
 *
 *   node scripts/test-assembly-story-b.mjs
 *
 * The same arithmetic walk scripts/test-assembly-story.mjs makes over the
 * current story, against this one, plus the checks that are particular to a
 * story that takes the shelf apart: that it is fully exploded in the hold,
 * that the frame opens to hold it, that the lift runs top-down and the
 * reassembly keeps the support order, that the four pins are the four the
 * brief names and appear in the hold only, and that every word on the page is
 * the brief's, with no em dash anywhere.
 *
 * Not in `npm test`: package.json is shared and was not touched for this
 * version. Run it by hand, or add it to the test line if B is the one kept.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT } from "./lib/design-lab.mjs";

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
  URLSearchParams
};
context.window.window = context.window;
vm.createContext(context);
for (const file of ["curator-shelf.js", "story-b.js", "scroll-story.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/assembly", file), "utf8"), context, { filename: file });
}

const shelf = context.window.FrameworkAssemblyShelf;
const story = context.window.FrameworkAssemblyStory;
const engine = context.window.FrameworkAssembly;
check("all three scripts define their global", Boolean(shelf && story && engine));

// --- the timeline ----------------------------------------------------------

const times = story.keys.map((key) => key.at);
const clashes = times.filter((at, index) => times.indexOf(at) !== index);
check("no two keys sit at the same instant", clashes.length === 0, `repeated: ${[...new Set(clashes)].join(", ")}`);

const sorted = [...times].sort((a, b) => a - b);
check("the timeline starts at 0 and ends at 1",
  sorted[0] === 0 && sorted[sorted.length - 1] === 1,
  `starts ${sorted[0]}, ends ${sorted[sorted.length - 1]}`);

const ids = new Set(story.pieces.map((piece) => piece.id));
for (const key of story.keys) {
  for (const id of Object.keys(key.pieces || {})) {
    check(`key ${key.at} names a real piece`, ids.has(id), `no piece "${id}"`);
  }
}
for (const pin of story.pins) {
  check("every pin follows a real piece", !pin.follow || ids.has(pin.follow), `no piece "${pin.follow}"`);
}

const keys = engine.fillCameras(engine.resolveKeys(story));

let finite = true;
let ordering = true;
for (let step = 0; step <= 1000; step += 1) {
  const moment = engine.sample(keys, step / 1000);
  if (moment.focus.some((n) => !Number.isFinite(n)) || !Number.isFinite(moment.padding)) finite = false;
  for (let axis = 0; axis < 3; axis += 1) {
    if (!(moment.focus[axis] < moment.focus[axis + 3])) ordering = false;
  }
  for (const id of Object.keys(moment.pieces)) {
    if (moment.pieces[id].off.some((n) => !Number.isFinite(n))) finite = false;
  }
}
check("every sampled frame is finite", finite);
check("every focus box has its min below its max on all three axes", ordering);

// The first frame and the last frame are both the product: nothing hidden,
// nothing in the air.
for (const p of [0, 1]) {
  const moment = engine.sample(keys, p);
  for (const id of Object.keys(moment.pieces)) {
    const state = moment.pieces[id];
    check(`${id} is assembled at p=${p}`, !state.hidden && state.off.every((n) => Math.abs(n) < 0.01),
      `${state.hidden ? "hidden" : "offset " + state.off.join(",")}`);
  }
}

// --- B's own shape: apart, held, together ------------------------------------

const byId = new Map(shelf.pieces.map((piece) => [piece.id, piece]));
const tierOf = { item_001: 0, item_002: 1, item_003: 2, item_004: 2, item_005: 3, item_006: 3, item_007: 4 };

// In the hold every piece stands 120 mm per tier above where it rests, and
// the frame's ceiling clears the top piece.
{
  const hold = engine.sample(keys, 0.525);
  for (const [id, tier] of Object.entries(tierOf)) {
    const off = hold.pieces[id].off;
    check(`${id} is exploded by ${tier * 120} mm in the hold`,
      Math.abs(off[2] - tier * 120) < 0.5 && Math.abs(off[0]) < 0.5 && Math.abs(off[1]) < 0.5, `offset ${off.join(",")}`);
  }
  const topExploded = byId.get("item_007").bounds[5] + 4 * 120;
  check("the exploded frame is taller than the hero frame", hold.focus[5] > engine.sample(keys, 0).focus[5]);
  check("the exploded frame clears the top piece", hold.focus[5] >= topExploded, `ceiling ${hold.focus[5]}, top ${topExploded}`);
}

// The top piece stays under the frame's ceiling at every point, in both the
// moving camera and the calm cuts. The focus box is what fit() is told to keep
// in frame, so this is the conservative form of "nothing leaves the picture".
for (const calm of [false, true]) {
  let worst = 0;
  let worstAt = 0;
  for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000;
    const moment = engine.sample(keys, p, calm);
    for (const piece of shelf.pieces) {
      const top = piece.bounds[5] + moment.pieces[piece.id].off[2];
      const over = top - moment.focus[5];
      if (over > worst) { worst = over; worstAt = p; }
    }
  }
  check(`no piece rises above the frame's ceiling (${calm ? "calm" : "full"})`, worst <= 0,
    `${worst.toFixed(0)} mm over at p=${worstAt}`);
}

// Nothing passes through anything. A piece rises and falls with the pieces
// it rests on, so at every point of the story its offset is at least its
// support's: the gap between them can open and close but never go negative,
// in the moving camera and in the calm cuts alike.
{
  let worst = 0;
  let where = "";
  for (let step = 0; step <= 1000; step += 1) {
    const moment = engine.sample(keys, step / 1000);
    for (const piece of shelf.pieces) {
      for (const support of piece.on) {
        const gap = moment.pieces[piece.id].off[2] - moment.pieces[support].off[2];
        if (gap < worst) { worst = gap; where = `${piece.id} below ${support} at p=${step / 1000}`; }
      }
    }
  }
  check("no piece ever drops below what it rests on", worst >= -0.5, `${worst.toFixed(1)} mm: ${where}`);
}

// Lift order: top-down. A piece leaves its resting place no earlier than the
// piece above it did.
function firstMoveAt(id, from, to) {
  for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000;
    if (p < from || p > to) continue;
    if (Math.abs(engine.sample(keys, p).pieces[id].off[2] - engine.sample(keys, from).pieces[id].off[2]) > 0.5) return p;
  }
  return null;
}
function restsAt(id, from, to) {
  for (let step = 1000; step >= 0; step -= 1) {
    const p = step / 1000;
    if (p < from || p > to) continue;
    if (Math.abs(engine.sample(keys, p).pieces[id].off[2]) > 0.5) return Math.min(1, p + 0.001);
  }
  return from;
}
{
  const starts = Object.fromEntries(Object.keys(tierOf).map((id) => [id, firstMoveAt(id, 0, 0.5)]));
  check("the base never moves", starts.item_001 === null);
  const order = ["item_007", "item_005", "item_006", "item_004", "item_003", "item_002"];
  for (let i = 1; i < order.length; i += 1) {
    check(`${order[i]} lifts after ${order[i - 1]} has started`, starts[order[i]] > starts[order[i - 1]],
      `${order[i - 1]} at ${starts[order[i - 1]]}, ${order[i]} at ${starts[order[i]]}`);
  }
  check("the lift begins at about 12%", starts.item_007 >= 0.11 && starts.item_007 <= 0.13, `at ${starts.item_007}`);
}

// Reassembly order: the engine's rule, a piece lands only after what it rests
// on has landed.
{
  const landed = Object.fromEntries(Object.keys(tierOf).map((id) => [id, restsAt(id, 0.5, 1)]));
  for (const piece of shelf.pieces) {
    for (const support of piece.on) {
      check(`${piece.id} lands after ${support}`, landed[piece.id] > landed[support],
        `${piece.id} at ${landed[piece.id]}, ${support} at ${landed[support]}`);
    }
  }
  check("everything has landed by 90%", Object.values(landed).every((p) => p <= 0.9),
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

check("four pins, and no more", story.pins.length === 4, `${story.pins.length} pins`);
check("the pins name base, unit, post and shelf",
  story.pins.map((pin) => pin.label).sort().join(",") === "base,post,shelf,unit",
  story.pins.map((pin) => pin.label).join(","));
for (const pin of story.pins) {
  const middle = engine.windowOpacity((pin.from + pin.to) / 2, pin.from, pin.to);
  check("every pin reaches full opacity", middle > 0.999, `"${pin.label}" peaks at ${middle.toFixed(2)}`);
  check(`pin "${pin.label}" is in the hold only`, pin.from >= 0.45 && pin.to <= 0.60, `${pin.from} to ${pin.to}`);
  const rides = shelf.pieces.find((piece) => piece.id === pin.follow);
  check(`pin "${pin.label}" follows its piece`, Boolean(rides), pin.follow);
}
const labelFor = Object.fromEntries(story.pins.map((pin) => [pin.label, pin.follow]));
check("base is on the Wide Base", labelFor.base === "item_001");
check("unit is on the Slim Extension", labelFor.unit === "item_003");
check("post is on a Standard Booster", byId.get(labelFor.post)?.moduleId === "standard_booster");
check("shelf is on the Standard Extension", labelFor.shelf === "item_005");

// --- the words are the brief's -----------------------------------------------

const BRIEF = {
  "parts.title": "Seven parts, one joint.",
  "parts.body": "A base, three units, two posts and a shelf. Each one slides onto a pin on the one below. No tools.",
  "apart.title": "Choose different parts and it is a different shelf.",
  "apart.body": "Taller, wider, a low one for a child's room. The price is known before you order.",
  "together.title": "It comes apart again when you move.",
  "together.body": "Delivered assembled within Nairobi. Start with one unit, from Ksh 6,500/-, and add to it later.",
  "hero.title": "As shown: Ksh 36,500/- in Coral.",
  "hero.body": "The Curator's Shelf. Made in our Dagoretti Corner workshop."
};
for (const caption of story.captions) {
  check(`caption "${caption.id}" title is the brief's`, caption.title === BRIEF[`${caption.id}.title`], caption.title);
  check(`caption "${caption.id}" body is the brief's`, caption.body === BRIEF[`${caption.id}.body`], caption.body);
}

const PAGE_FILE = path.join(ROOT, "how-b.html");
const page = fs.readFileSync(PAGE_FILE, "utf8");
const PAGE_STRINGS = [
  "Shelving, made in Nairobi",
  "Custom shelving, from parts that stack together.",
  "The shelf you want is a matter of which parts. Scroll, and this one comes apart.",
  "As shown: The Curator's Shelf, Ksh 36,500/- in Coral. Units from Ksh 6,500/-.",
  "A price before you order, delivery within a week, and a shelf that moves house with you.",
  "Your space",
  "Kindly share what the shelf is for and roughly where it would go, and we'll revert back with design ideas and a price.",
  "Message us on WhatsApp",
  "Made in our Dagoretti Corner workshop. Delivered assembled within Nairobi. ETR invoice provided.",
  "See the range",
  "Popular configurations with prices. Units from Ksh 6,500/-.",
  "Design your own",
  "Build one in the browser and it prices itself as you go.",
  "Marine, Sage, Charcoal and Coral"
];
const flat = page.replace(/\s+/g, " ").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'");
for (const line of PAGE_STRINGS) {
  check(`the page carries "${line.slice(0, 40)}"`, flat.includes(line));
}
check("the page never says TCC", !/\bTCC\b/.test(page));

for (const file of ["how-b.html", "css/how-b.css", "js/assembly/story-b.js"]) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  check(`${file} has no em dash`, !text.includes("\u2014"), `found at ${text.indexOf("\u2014")}`);
}

// Every WhatsApp link on the page opens with a message typed in, and is
// marked so the lake knows which page handed the visitor over.
for (const match of page.matchAll(/<a\b[^>]*href="([^"]*wa\.me[^"]*)"[^>]*>/g)) {
  check("the WhatsApp link carries a message", /[?&]text=/.test(match[1]), match[1]);
  check("the WhatsApp link names its handoff source", /data-fwk-handoff="how-b"/.test(match[0]));
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
for (const href of [...page.matchAll(/<link rel="stylesheet" href="(\/[^"]+)"/g)].map((m) => m[1])) {
  check(`the page's stylesheet ${href} exists`, fs.existsSync(path.join(ROOT, href.replace(/^\//, ""))));
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
  const calmHold = engine.sample(keys, 0.525, true);
  check("calm shows the exploded view", Object.entries(tierOf).every(([id, tier]) => Math.abs(calmHold.pieces[id].off[2] - tier * 120) < 0.5));
  const calmEnd = engine.sample(keys, 1, true);
  for (const id of Object.keys(calmEnd.pieces)) {
    check(`${id} still lands in calm`, !calmEnd.pieces[id].hidden && calmEnd.pieces[id].off.every((n) => Math.abs(n) < 0.01));
  }
}

if (failures) {
  console.error(`\n${failures} story-b check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`story b ok: ${story.keys.length} keys (${keys.cameras.length} camera), ${story.pieces.length} pieces`
  + ` over ${bundles.size} bundles, ${story.captions.length} captions, ${story.pins.length} pins`);

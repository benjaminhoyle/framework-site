#!/usr/bin/env node
/**
 * Guards on the scroll-driven assembly story.
 *
 *   node scripts/test-assembly-story.mjs
 *
 * The page cannot be tested by looking at it -- it is a function of scroll
 * position, and the failures that matter are the ones you only see at one
 * particular percentage on one particular phone. So the timeline is checked
 * here, arithmetically, at every point.
 *
 * The most important check is the last one: that js/assembly/<shelf>.js is
 * still what scripts/bake-assembly-story.mjs would generate today. That file is
 * derived from the design and from the module catalogue, and the catalogue is
 * itself generated from the pipeline's contract. Without this check, a geometry
 * change in Rhino lands a shelf on the site whose animation is assembling the
 * previous one -- silently, because every frame still draws.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
for (const file of ["curator-shelf.js", "story.js", "scroll-story.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/assembly", file), "utf8"), context, { filename: file });
}

const shelf = context.window.FrameworkAssemblyShelf;
const story = context.window.FrameworkAssemblyStory;
const engine = context.window.FrameworkAssembly;
check("all three scripts define their global", Boolean(shelf && story && engine));

// --- the timeline ----------------------------------------------------------

/*
 * Keys are sorted before sampling, so they need not be written in order -- but
 * two keys at the same instant are ambiguous under carry-forward: which one
 * wins depends on the sort's stability, which is not a thing to depend on.
 */
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

/*
 * Sample the whole story, finely. Every number the renderer is handed has to be
 * finite at every point -- a NaN in a focus box does not throw, it just draws
 * nothing, which is a blank screen halfway down a page and nowhere else.
 */
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

// The last frame is the product. Anything still in the air at p=1 is a piece
// the reader was shown and never saw land.
const final = engine.sample(keys, 1);
for (const id of Object.keys(final.pieces)) {
  const state = final.pieces[id];
  check(`${id} has landed by the end`, !state.hidden && state.off.every((n) => Math.abs(n) < 0.01),
    `${state.hidden ? "still hidden" : "offset " + state.off.join(",")}`);
}

/*
 * A piece must be revealed before it is asked to move, and must never appear
 * already at rest -- either one is a piece that pops into the picture instead
 * of arriving in it.
 */
for (const piece of story.pieces) {
  let revealedAt = null;
  for (const key of keys) {
    if (!key.pieces[piece.id].hidden) { revealedAt = key; break; }
  }
  check(`${piece.id} is revealed at some point`, Boolean(revealedAt));
  if (revealedAt && revealedAt.at > 0) {
    const off = revealedAt.pieces[piece.id].off;
    check(`${piece.id} is revealed away from its resting place`,
      off.some((n) => Math.abs(n) > 1), `revealed at offset ${off.join(",")}`);
  }
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
}

/*
 * A caption whose window never reaches full opacity is one nobody can read.
 * windowOpacity fades over a fifth of the window or 5.5% of the story,
 * whichever is smaller, so a window under about 2% never gets there.
 */
for (const caption of story.captions) {
  const middle = engine.windowOpacity((caption.from + caption.to) / 2, caption.from, caption.to);
  check("every caption reaches full opacity", middle > 0.999, `"${caption.title}" peaks at ${middle.toFixed(2)}`);
}
for (const pin of story.pins) {
  const middle = engine.windowOpacity((pin.from + pin.to) / 2, pin.from, pin.to);
  check("every pin reaches full opacity", middle > 0.999, `"${pin.label}" peaks at ${middle.toFixed(2)}`);
}

// --- the assets the page will actually ask for ------------------------------

// Derived from the story rather than from the shelf: what the page fetches is
// what the story names, and a missing bundle draws nothing at all -- silently,
// for one piece, part way down the page.
const bundles = new Map();
for (const piece of story.pieces) {
  bundles.set(piece.moduleId, "/assets/shelving/modules");
}
for (const [moduleId, base] of bundles) {
  check(`${moduleId}.json is on disk`, fs.existsSync(path.join(ROOT, base.replace(/^\//, ""), `${moduleId}.json`)),
    `expected ${base}/${moduleId}.json`);
}

const STORY_FILE = path.join(ROOT, "js/assembly/story.js");
const PAGE_FILE = path.join(ROOT, "assembly-lab.html");
const page = fs.readFileSync(PAGE_FILE, "utf8");
const PAGE_STRINGS = [...page.matchAll(/data-copy="/g)].length;
const captionsWithAlt = story.captions.filter((caption) => caption.photoAlt).length;
const preloaded = [...page.matchAll(/href="([^"]*\/modules\/([a-z0-9_]+)\.json)"/g)];
const preloadedIds = preloaded.map((m) => m[2]);
for (const moduleId of bundles.keys()) {
  check(`${moduleId} is preloaded by the page`, preloadedIds.includes(moduleId),
    "add it to the <link rel=preload> list, or its first frame waits on a round trip");
}
for (const moduleId of preloadedIds) {
  check(`the page does not preload ${moduleId}, which this story never uses`,
    bundles.has(moduleId), "a preload nothing fetches is a wasted request on a slow connection");
}
for (const [href] of preloaded.map((m) => [m[1]])) {
  check(`the preload path ${href} exists`, fs.existsSync(path.join(ROOT, href.replace(/^\//, ""))));
}

/*
 * --- the generated shelf is still what the bake would produce ---------------
 *
 * The one check that stands between a Rhino edit and a page whose animation is
 * assembling last month's shelf. Same guard, and the same reasoning, as the
 * contract check in scripts/test-builder.mjs.
 */
const derived = [
  { file: "js/assembly/curator-shelf.js", script: "scripts/bake-assembly-story.mjs" }
];
for (const { file, script } of derived) {
  const full = path.join(ROOT, file);
  const before = fs.readFileSync(full, "utf8");
  try {
    execFileSync(process.execPath, [path.join(ROOT, script)], { stdio: "pipe" });
    const after = fs.readFileSync(full, "utf8");
    if (before !== after) fs.writeFileSync(full, before); // leave the tree as we found it
    check(`${file} is in step with what generates it`, before === after, `run: node ${script}`);
  } catch (error) {
    check(`${script} runs`, false, error.message);
  }
}

/*
 * --- the copy round trip -------------------------------------------------
 *
 * scripts/assembly-copy.mjs finds strings in story.js and assembly-lab.html by
 * pattern, so a tidy-up of either file can quietly stop it finding them --
 * and the failure is silent in the worst way: an edited caption is reported as
 * applied and simply is not. Exporting and re-applying must change nothing.
 */
{
  const tmp = path.join(ROOT, "data", "assembly", ".copy-roundtrip.txt");
  const before = [STORY_FILE, PAGE_FILE].map((file) => fs.readFileSync(file, "utf8"));
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/assembly-copy.mjs"), tmp], { stdio: "pipe" });
    const exported = fs.readFileSync(tmp, "utf8");
    const ids = [...exported.matchAll(/^\[([A-Za-z0-9_.]+)\]$/gm)].map((m) => m[1]);
    check("the copy file carries every caption, pin and page string",
      ids.length === story.captions.length * 2 + story.pins.length + captionsWithAlt + PAGE_STRINGS,
      `${ids.length} blocks for ${story.captions.length} captions, ${story.pins.length} pins, ${captionsWithAlt} alts, ${PAGE_STRINGS} page strings`);

    const result = execFileSync(process.execPath,
      [path.join(ROOT, "scripts/assembly-copy.mjs"), "--apply", tmp], { stdio: "pipe" }).toString();
    // Both halves matter: nothing changed *and* nothing skipped. A skip is how
    // a broken pattern reports itself, and "0 changed" alone cannot tell the
    // two apart.
    check("re-applying an unedited copy file changes nothing and skips nothing",
      /^0 of \d+ blocks changed, 0 skipped/.test(result), result.split("\n").slice(0, 4).join(" / "));
    const after = [STORY_FILE, PAGE_FILE].map((file) => fs.readFileSync(file, "utf8"));
    check("the round trip leaves story.js byte-identical", before[0] === after[0]);
    check("the round trip leaves assembly-lab.html byte-identical", before[1] === after[1]);
    if (before[0] !== after[0]) fs.writeFileSync(STORY_FILE, before[0]);
    if (before[1] !== after[1]) fs.writeFileSync(PAGE_FILE, before[1]);
  } catch (error) {
    check("scripts/assembly-copy.mjs runs", false, error.message);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

/*
 * Reduced motion must still tell the whole story.
 *
 * The calm tier cuts the camera rather than moving it, which is a different
 * sampling path -- easy to get subtly wrong, and wrong in a way nobody sees
 * unless they have the setting on. So it is walked end to end like the others,
 * and checked for the property that makes it worth having: every shot the
 * moving camera would travel through is still shown.
 */
{
  const shots = new Set();
  let finite = true;
  for (let step = 0; step <= 1000; step += 1) {
    const moment = engine.sample(keys, step / 1000, true);
    if (moment.focus.some((n) => !Number.isFinite(n))) finite = false;
    shots.add(moment.focus.join(","));
  }
  check("every calm frame is finite", finite);
  // Against the *distinct* framings, not the key count: a hold is two camera
  // keys with the same box, and cutting from a shot to itself is not a shot.
  const framings = new Set(keys.cameras.map((key) => key.focus.join(",")));
  check("calm cuts, never interpolates", shots.size === framings.size,
    `${shots.size} framings shown, ${framings.size} in the story`
    + " — more means it is blending between them, fewer means a shot is skipped");

  const calmEnd = engine.sample(keys, 1, true);
  for (const id of Object.keys(calmEnd.pieces)) {
    check(`${id} still lands in calm`, !calmEnd.pieces[id].hidden
      && calmEnd.pieces[id].off.every((n) => Math.abs(n) < 0.01));
  }
}

if (failures) {
  console.error(`\n${failures} assembly-story check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`assembly story ok — ${story.keys.length} keys (${keys.cameras.length} camera), ${story.pieces.length} pieces`
  + ` over ${bundles.size} bundles, ${story.captions.length} captions, ${story.pins.length} pins`);

#!/usr/bin/env node
/**
 * Guards on landing A ("One unit first"): js/assembly/story-a.js and how-a.html.
 *
 *   node scripts/test-landing-a.mjs
 *
 * The same timeline checks scripts/test-assembly-story.mjs runs on story.js,
 * against this page's story, and then the things that make this version what
 * it is: every pin carries the catalogue price of the piece it rides; the
 * running total in each caption is true by the time the caption leaves; the
 * whole comes to Ksh 36,500; the words on the page are the brief's words,
 * verbatim, when the brief is on disk beside this repo; no em dash anywhere.
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
for (const file of ["curator-shelf.js", "story-a.js", "scroll-story.js"]) {
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

const final = engine.sample(keys, 1);
for (const id of Object.keys(final.pieces)) {
  const state = final.pieces[id];
  check(`${id} has landed by the end`, !state.hidden && state.off.every((n) => Math.abs(n) < 0.01),
    `${state.hidden ? "still hidden" : "offset " + state.off.join(",")}`);
}

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

/*
 * Nothing lands in pairs. Two pieces that land at the same key read as one
 * event; the brief keeps the ordering rule from story.js.
 */
{
  const landings = new Map();
  let previous = null;
  for (const key of keys) {
    for (const id of Object.keys(key.pieces)) {
      const now = key.pieces[id];
      const was = previous && previous.pieces[id];
      if (was && !was.hidden && !now.hidden && was.off.some((n) => Math.abs(n) > 0.01) && now.off.every((n) => Math.abs(n) < 0.01)) {
        landings.set(key.at, (landings.get(key.at) || []).concat(id));
      }
    }
    previous = key;
  }
  for (const [at, landed] of landings) {
    check(`one piece lands at ${at}`, landed.length === 1, `${landed.join(" and ")} land together`);
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
  const words = `${caption.title} ${caption.body}`.trim().split(/\s+/).length;
  check("every caption is under 25 words, so the phone band keeps its room", words < 25, `"${caption.title}" is ${words} words`);
}
for (const caption of story.captions) {
  const middle = engine.windowOpacity((caption.from + caption.to) / 2, caption.from, caption.to);
  check("every caption reaches full opacity", middle > 0.999, `"${caption.title}" peaks at ${middle.toFixed(2)}`);
}
for (const pin of story.pins) {
  const middle = engine.windowOpacity((pin.from + pin.to) / 2, pin.from, pin.to);
  check("every pin reaches full opacity", middle > 0.999, `"${pin.label}" peaks at ${middle.toFixed(2)}`);
}

// --- the prices --------------------------------------------------------------

const ksh = (n) => `Ksh ${n.toLocaleString("en-GB")}/-`;
const priceOf = new Map(shelf.pieces.map((piece) => [piece.id, piece.priceKsh]));
const total = shelf.pieces.reduce((sum, piece) => sum + piece.priceKsh, 0);
check("the seven pieces sum to the catalogue price", total === 36500 && shelf.totalKsh === 36500, `sum ${total}, totalKsh ${shelf.totalKsh}`);

for (const pin of story.pins) {
  check(`the tag on ${pin.follow} carries its catalogue price`, pin.label === ksh(priceOf.get(pin.follow)),
    `label "${pin.label}", price ${priceOf.get(pin.follow)}`);
  // A tag rides its piece down and fades once it has landed: it must be up
  // while the piece is moving and gone by, or shortly after, the landing.
  let landedAt = null;
  for (const key of keys) {
    const state = key.pieces[pin.follow];
    if (!state.hidden && state.off.every((n) => Math.abs(n) < 0.01)) { landedAt = key.at; break; }
  }
  // The base is on the floor from the start; its tag is simply up for the
  // first beat, so the arrival rule does not apply to it.
  if (landedAt > 0) {
    check(`the tag on ${pin.follow} is up while it arrives and fades once it lands`,
      landedAt !== null && pin.to >= landedAt - 0.01 && pin.to <= landedAt + 0.05,
      `tag ends ${pin.to}, piece lands ${landedAt}`);
  }
}

/*
 * The running total. By the time a caption leaves, every piece it counts has
 * landed and the figure it quotes is the sum of what is on the floor.
 */
function landedTotal(p) {
  const moment = engine.sample(keys, p);
  let sum = 0;
  for (const id of Object.keys(moment.pieces)) {
    const state = moment.pieces[id];
    if (!state.hidden && state.off.every((n) => Math.abs(n) < 0.01)) sum += priceOf.get(id);
  }
  return sum;
}
for (const caption of story.captions) {
  const figures = [...caption.body.matchAll(/Ksh ([\d,]+)\/-/g)].map((m) => Number(m[1].replace(/,/g, "")));
  check(`"${caption.title}" quotes one price`, figures.length === 1, caption.body);
  const at = Math.min(1, caption.to);
  check(`"${caption.title}" quotes what has landed by the time it leaves (${figures[0]})`,
    landedTotal(at) === figures[0], `landed ${landedTotal(at)} at ${at}`);
  const before = landedTotal(Math.max(0, caption.from));
  check(`"${caption.title}" never quotes less than what is already there`, figures[0] >= before, `${before} on the floor at ${caption.from}`);
}
check("the last caption quotes the whole", story.captions[story.captions.length - 1].body.includes(ksh(36500)));

// --- the page ----------------------------------------------------------------

const PAGE_FILE = path.join(ROOT, "how-a.html");
const STORY_FILE = path.join(ROOT, "js/assembly/story-a.js");
const CSS_FILE = path.join(ROOT, "css/how-a.css");
const page = fs.readFileSync(PAGE_FILE, "utf8");
const storySource = fs.readFileSync(STORY_FILE, "utf8");
const cssSource = fs.readFileSync(CSS_FILE, "utf8");

for (const [name, text] of [["how-a.html", page], ["story-a.js", storySource], ["how-a.css", cssSource]]) {
  check(`${name} has no em dash`, !/—/.test(text));
}
check("the page loads this page's story and not /how's", page.includes('/js/assembly/story-a.js') && !page.includes('/js/assembly/story.js"'));
check("the page never says TCC", !/\bTCC\b/.test(page));
check("the page says ETR", /\bETR\b/.test(page));
check("the page says 'your space', never 'your measurements'", page.includes("your space") && !page.includes("measurements"));

const wa = /href="(https:\/\/wa\.me\/\d+\?text=[^"]+)"/.exec(page);
check("the WhatsApp button opens a chat with a message typed in", Boolean(wa));
if (wa) {
  const message = decodeURIComponent(/text=([^&"]*)/.exec(wa[1])[1]);
  check("the typed-in message is a complete sentence in the customer's words", /^Hello, I'm interested in your shelving\..+\.$/.test(message), message);
}
check("the WhatsApp button names its handoff source", /data-fwk-handoff="how-a"/.test(page));
check("the doors put the range first", page.indexOf('href="/shelving.html"') < page.indexOf('href="/builder"'));
check("the colours strip sits between the ask and the doors",
  page.indexOf('class="pg-ask"') < page.indexOf('class="ha-colours"') && page.indexOf('class="ha-colours"') < page.indexOf('class="pg-doors"'));

const bundles = new Set(story.pieces.map((piece) => piece.moduleId));
const preloaded = [...page.matchAll(/href="\/assets\/shelving\/modules\/([a-z0-9_]+)\.json"/g)].map((m) => m[1]);
for (const moduleId of bundles) check(`${moduleId} is preloaded by the page`, preloaded.includes(moduleId));
for (const moduleId of preloaded) check(`the page does not preload ${moduleId}, which this story never uses`, bundles.has(moduleId));
for (const moduleId of bundles) {
  check(`${moduleId}.json is on disk`, fs.existsSync(path.join(ROOT, "assets/shelving/modules", `${moduleId}.json`)));
}
for (const caption of story.captions) {
  if (caption.photo) {
    check(`${caption.photo}.jpg is on disk`, fs.existsSync(path.join(ROOT, "images/shelving/configs", `${caption.photo}.jpg`)));
  }
}

/*
 * --- the words are the brief's words ---------------------------------------
 *
 * research/landing-strategy.md in the marketing repo gives every on-screen
 * string for contender A. When it is on disk beside this repo the strings are
 * read out of it and compared; when it is not, this block is skipped and says
 * so, rather than carrying a second copy of the copy.
 */
const BRIEF = path.resolve(ROOT, "../framework-marketing/research/landing-strategy.md");
if (!fs.existsSync(BRIEF)) {
  console.log("note: the brief is not beside this repo; the verbatim check was skipped");
} else {
  const brief = fs.readFileSync(BRIEF, "utf8");
  const a = brief.slice(brief.indexOf("### Contender A"), brief.indexOf("### Contender B"));
  check("the brief still has a contender A section", a.length > 100);

  // Captions, from the beats table.
  const rows = [...a.matchAll(/title: \*\*(.+?)\*\* body: (.+?) \|\s*$/gm)];
  check("the brief lists four captions for A", rows.length === 4, `${rows.length} found`);
  rows.forEach((row, index) => {
    const caption = story.captions[index];
    check(`caption ${index + 1} title is the brief's`, caption && caption.title === row[1], `story: "${caption && caption.title}"\n      brief: "${row[1]}"`);
    check(`caption ${index + 1} body is the brief's`, caption && caption.body === row[2], `story: "${caption && caption.body}"\n      brief: "${row[2]}"`);
  });

  // Pins, from the pins paragraph.
  const tags = [...a.matchAll(/`(Ksh [\d,]+\/-)`/g)].map((m) => m[1]);
  check("the brief lists seven tags", tags.length === 7, `${tags.length} found`);
  tags.forEach((tag, index) => {
    check(`tag ${index + 1} is the brief's`, story.pins[index] && story.pins[index].label === tag, `story "${story.pins[index] && story.pins[index].label}", brief "${tag}"`);
  });

  // The page's own strings, from the blockquotes, joined across wrapped lines.
  const quoted = (label, from) => {
    const start = a.indexOf(`> ${label}: `, from);
    if (start < 0) return null;
    const lines = [];
    for (const line of a.slice(start).split("\n")) {
      if (!line.startsWith(">")) break;
      const text = line.replace(/^>\s?/, "");
      if (lines.length && /^[a-z0-9 ]+: /.test(text)) break;
      if (!text.trim()) break;
      lines.push(text);
    }
    return lines.join(" ").replace(/^[a-z0-9 ]+: /, "").replace(/\s+/g, " ").trim();
  };
  const collapse = (text) => text.replace(/\s+/g, " ").trim();
  const onPage = (id) => {
    const m = new RegExp(`data-copy="${id}"[^>]*>([\\s\\S]*?)<`).exec(page);
    return m ? collapse(m[1]) : null;
  };
  const before = a.indexOf("**Before the animation");
  const after = a.indexOf("**After the animation");
  const expected = {
    "page.kicker": quoted("kicker", before),
    "page.title": quoted("h1", before),
    "page.intro": quoted("intro", before),
    "page.prices": quoted("prices", before),
    "page.hint": quoted("hint", before),
    "page.outroKicker": quoted("kicker", after),
    "page.outroBody": quoted("body", after),
    "page.cta": quoted("button", after),
    "page.fine": quoted("small line under the button", after)
  };
  for (const [id, text] of Object.entries(expected)) {
    check(`the brief has ${id}`, Boolean(text));
    check(`${id} is the brief's, verbatim`, onPage(id) === text, `page:  "${onPage(id)}"\n      brief: "${text}"`);
  }
  for (const door of ["Popular configurations with prices. Units from Ksh 6,500/-.", "Build one in the browser and it prices itself as you go."]) {
    check("the doors say what the brief says", a.includes(door) && page.includes(door), door);
  }
  check("the brief's colours line is on the page", page.includes("Marine, Sage, Charcoal and Coral"));
}

/*
 * Reduced motion still tells the whole story: the calm tier cuts between
 * every distinct framing the moving camera would travel through.
 */
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
  const calmEnd = engine.sample(keys, 1, true);
  for (const id of Object.keys(calmEnd.pieces)) {
    check(`${id} still lands in calm`, !calmEnd.pieces[id].hidden && calmEnd.pieces[id].off.every((n) => Math.abs(n) < 0.01));
  }
}

if (failures) {
  console.error(`\n${failures} landing A check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`landing A ok: ${story.keys.length} keys (${keys.cameras.length} camera), ${story.pieces.length} pieces`
  + ` summing to Ksh ${total.toLocaleString("en-GB")}, ${story.captions.length} captions, ${story.pins.length} pins`);

#!/usr/bin/env node
/**
 * Every word of the assembly story, out to a text file and back again.
 *
 *   node scripts/assembly-copy.mjs                     # write data/assembly/copy.txt
 *   node scripts/assembly-copy.mjs --apply <file>      # read an edited one back in
 *
 * The point is that the copy can be edited by somebody who is not editing an
 * animation, and edited *in place* -- no retyping into a JavaScript file, no
 * chance of a stray quote taking the page down, and no chance of an edit landing
 * on the wrong caption.
 *
 * Two files hold the strings: js/assembly/story.js (captions, pin labels, photo
 * alt text) in its COPY block, and assembly-lab.html (everything before and
 * after the animation) on elements carrying a `data-copy` attribute. Both are
 * addressed by id, so the round trip does not depend on order or position.
 *
 * The rules of the text format, which the file itself repeats:
 *   - a line that is exactly `[some.id]` starts a block
 *   - everything until the next such line is that block's text
 *   - line breaks inside a block are yours to make; they are collapsed to
 *     spaces on the way back in, so wrap however you like
 *   - lines starting with `#` are notes and are ignored
 *   - an id that is missing from the file keeps whatever it has now
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT } from "./lib/design-lab.mjs";

const STORY = path.join(ROOT, "js/assembly/story.js");
const PAGE = path.join(ROOT, "assembly-lab.html");
const DEFAULT_OUT = path.join(ROOT, "data/assembly/copy.txt");

// --- reading ---------------------------------------------------------------

/** The story, evaluated, so the strings come from the same place the page reads. */
function loadStory() {
  const scope = { window: {} };
  vm.createContext(scope);
  for (const file of ["curator-shelf.js", "story.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js/assembly", file), "utf8"), scope, { filename: file });
  }
  return scope.window.FrameworkAssemblyStory;
}

/*
 * The page's own strings, by `data-copy` id.
 *
 * A regex over HTML is usually a mistake; it is safe here because these are
 * single elements holding only text, and because the guard below refuses to
 * write anything back into an element whose content has grown a tag since.
 */
const PAGE_TAG = (id) => new RegExp(`(<([a-z0-9]+)([^>]*\\sdata-copy="${id}"[^>]*)>)([\\s\\S]*?)(</\\2>)`, "i");

function readPage(html) {
  const found = new Map();
  for (const match of html.matchAll(/data-copy="([^"]+)"/g)) {
    const id = match[1];
    const tag = PAGE_TAG(id).exec(html);
    if (tag) found.set(id, collapse(tag[4]));
  }
  return found;
}

const collapse = (text) => text.replace(/\s+/g, " ").trim();

// --- the text file ---------------------------------------------------------

const RULE = "-".repeat(78);

function render(story, page) {
  const percent = (from, to) => `${Math.round(from * 100)}%–${Math.round(Math.min(1, to) * 100)}% of the scroll`;
  const out = [];
  const block = (id, text, note) => {
    if (note) out.push(`# ${note}`);
    out.push(`[${id}]`, text, "");
  };

  out.push(
    "=".repeat(78),
    "  THE CURATOR'S SHELF — every word in the assembly animation",
    "=".repeat(78),
    "",
    "  Edit the text. Leave the [square-bracket] lines exactly as they are:",
    "  they are how each piece of text finds its way back to the right place.",
    "",
    "  - a line that is exactly [some.id] starts a block",
    "  - everything under it, until the next such line, is that block's text",
    "  - wrap lines however you like; they are re-joined into one paragraph",
    "  - lines starting with # are notes to you and are ignored",
    "  - delete a block entirely and that text simply stays as it is",
    "  - &nbsp; is a space that will not break across two lines. Leave it where",
    "    it is or write a normal space; both work.",
    "",
    "  Send the edited file back and it goes in with:",
    "      node scripts/assembly-copy.mjs --apply <file>",
    "",
    RULE,
    "  ON-PAGE TEXT — before and after the animation",
    RULE,
    ""
  );
  const pageNotes = {
    "page.kicker": "small label above the headline",
    "page.title": "the headline",
    "page.hint": "sits under the intro with a downward rule; keep it very short",
    "page.noscriptTitle": "only ever seen with JavaScript turned off",
    "page.noscriptBody": "same",
    "page.outroKicker": "small label after the animation",
    "page.cta": "the button. Keep it to a few words"
  };
  for (const [id, text] of page) block(id, text, pageNotes[id]);

  out.push(
    RULE,
    "  CAPTIONS — the cards that appear as you scroll",
    RULE,
    "",
    "  Two lines each: a title and a body. The title is set large, so it wants",
    "  to be one short sentence. The body runs to about four lines on a phone;",
    "  much past that and the picture above it starts giving up room.",
    ""
  );
  for (const caption of story.captions) {
    out.push(`# ${percent(caption.from, caption.to)}`);
    block(`caption.${caption.id}.title`, caption.title);
    block(`caption.${caption.id}.body`, caption.body);
  }

  out.push(
    RULE,
    "  PIN LABELS — the small dark tags pointing at the model",
    RULE,
    "",
    "  These sit on the drawing itself, so they have to be very short — two or",
    "  three words. A long one crowds the thing it is pointing at.",
    ""
  );
  for (const pin of story.pins) {
    out.push(`# ${percent(pin.from, pin.to)}`);
    block(`pin.${pin.id}`, pin.label);
  }

  out.push(
    RULE,
    "  IMAGE DESCRIPTIONS — read aloud by screen readers, and shown if a",
    "  photograph fails to load. Only used in the no-WebGL fallback.",
    RULE,
    ""
  );
  for (const caption of story.captions) {
    if (caption.photoAlt) block(`alt.${caption.id}`, caption.photoAlt);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function parse(text) {
  const blocks = new Map();
  let id = null;
  let lines = [];
  const flush = () => {
    if (id) blocks.set(id, collapse(lines.join(" ")));
    lines = [];
  };
  for (const raw of text.split("\n")) {
    const header = /^\[([A-Za-z0-9_.]+)\]\s*$/.exec(raw);
    if (header) { flush(); id = header[1]; continue; }
    if (/^\s*#/.test(raw)) continue;
    if (/^\s*[=-]{6,}\s*$/.test(raw)) { flush(); id = null; continue; }
    if (id) lines.push(raw);
  }
  flush();
  for (const [key, value] of [...blocks]) if (!value) blocks.delete(key);
  return blocks;
}

// --- writing ---------------------------------------------------------------

/** Replace one `key: 'value'` inside the COPY block, and nowhere else. */
function replaceInCopy(source, keyPath, value) {
  const open = source.indexOf("    var COPY = {");
  const close = source.indexOf("\n    };", open);
  if (open < 0 || close < 0) throw new Error("could not find the COPY block in story.js");
  const head = source.slice(0, open);
  const body = source.slice(open, close);
  const tail = source.slice(close);

  const key = keyPath[keyPath.length - 1];
  const pattern = new RegExp(`(\\n\\s*${key}: ')(?:[^'\\\\]|\\\\.)*(')`);
  // Narrow to the right nested object first, so `title` under `base` is not
  // confused with `title` under `joint`.
  let scopeStart = 0;
  let scopeEnd = body.length;
  if (keyPath.length > 1) {
    const parent = new RegExp(`\\n\\s{8}${keyPath[0]}: \\{`);
    const at = parent.exec(body);
    if (!at) throw new Error(`no "${keyPath[0]}" in the COPY block`);
    scopeStart = at.index;
    const after = body.indexOf("\n        }", scopeStart);
    scopeEnd = after < 0 ? body.length : after;
  }
  const scope = body.slice(scopeStart, scopeEnd);
  if (!pattern.test(scope)) throw new Error(`no "${keyPath.join(".")}" in the COPY block`);
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return head + body.slice(0, scopeStart) + scope.replace(pattern, `$1${escaped}$2`) + body.slice(scopeEnd) + tail;
}

function apply(file) {
  const edited = parse(fs.readFileSync(file, "utf8"));
  let story = fs.readFileSync(STORY, "utf8");
  let page = fs.readFileSync(PAGE, "utf8");
  const changed = [];
  const skipped = [];

  for (const [id, value] of edited) {
    try {
      if (id.startsWith("page.")) {
        const tag = PAGE_TAG(id).exec(page);
        if (!tag) { skipped.push(`${id} (no element carries data-copy="${id}")`); continue; }
        if (/<[a-z]/i.test(tag[4])) { skipped.push(`${id} (contains markup; edit the HTML directly)`); continue; }
        if (collapse(tag[4]) === value) continue;
        page = page.slice(0, tag.index) + tag[1] + value + tag[5] + page.slice(tag.index + tag[0].length);
        changed.push(id);
        continue;
      }
      const parts = id.split(".");
      const before = story;
      if (parts[0] === "caption") story = replaceInCopy(story, [parts[1], parts[2]], value);
      else if (parts[0] === "pin") story = replaceInCopy(story, ["pins", parts[1]], value);
      else if (parts[0] === "alt") story = replaceInCopy(story, ["alt", parts[1]], value);
      else { skipped.push(`${id} (not a known kind of text)`); continue; }
      if (story !== before) changed.push(id);
    } catch (error) {
      skipped.push(`${id} (${error.message})`);
    }
  }

  fs.writeFileSync(STORY, story);
  fs.writeFileSync(PAGE, page);

  console.log(`${changed.length} of ${edited.size} blocks changed, ${skipped.length} skipped`);
  for (const id of changed) console.log(`  ${id}`);
  if (skipped.length) {
    console.log("\nskipped:");
    for (const line of skipped) console.log(`  ${line}`);
  }

  /*
   * Nothing applied at all is not a quiet outcome, it is a broken one.
   *
   * The ids are found by pattern, so a tidy-up of story.js or the page can stop
   * them matching -- and the whole point of this script is that somebody who is
   * not reading the code can trust what it says. "0 of 33 blocks changed" looks
   * like "your edits were already in" and must not be how that failure reads.
   */
  if (edited.size && !changed.length && skipped.length) {
    console.error("\nNothing could be applied. The ids in this file no longer match "
      + "anything in js/assembly/story.js or assembly-lab.html — most likely one of them "
      + "has been restructured since. Re-export a fresh copy file and move the edits across.");
    process.exit(1);
  }

  console.log("\nNow run: npm test");
}

// --- entry -----------------------------------------------------------------

const args = process.argv.slice(2);
const applyAt = args.indexOf("--apply");
if (applyAt >= 0) {
  const file = args[applyAt + 1];
  if (!file) { console.error("usage: node scripts/assembly-copy.mjs --apply <file>"); process.exit(1); }
  apply(path.resolve(file));
} else {
  const out = args[0] ? path.resolve(args[0]) : DEFAULT_OUT;
  const text = render(loadStory(), readPage(fs.readFileSync(PAGE, "utf8")));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`${path.relative(ROOT, out)} — ${text.split("\n").filter((l) => /^\[/.test(l)).length} blocks`);
}

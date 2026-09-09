/**
 * Creative briefs, read from ../framework-marketing: `briefs/*.md`, and the
 * `brief.md` inside each story folder under `stories/<slug>/`.
 *
 * A brief is Markdown with a front-matter block: which room, who lives there,
 * what must and must not appear, how many pictures, and a `design` block the
 * generator reads as constraints. The studio loads one by name and the
 * generator takes one as `--brief`; random mode is no brief.
 *
 * A brief in `briefs/` is named by its file; a story's brief is named by the
 * story's slug, which is its folder. Both answer to the same `name`, so the
 * studio's select and `--brief` do not care which kind they were given. The
 * stories are the home a brief moves into once it belongs to one (the first
 * did on 2026-09-09); `briefs/` keeps the format and anything not yet a story.
 *
 * The front matter is a small subset of YAML, and only that subset is read:
 *
 *     key: value                 a string, number, true/false, or null
 *     key: [a, "b", 3]           a flow list
 *     key:                       a block list
 *       - item
 *     key:                       one level of nested map
 *       inner: value
 *     # a comment
 *
 * That is everything briefs/README.md uses. A parser for exactly that is
 * shorter than the note explaining why a YAML dependency was added to a repo
 * that has one dependency, so there is no dependency.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the briefs live: next door, unless told otherwise. */
export const BRIEFS_DIR = process.env.FRAMEWORK_BRIEFS_DIR
  || path.resolve(ROOT, "..", "framework-marketing", "briefs");

/** Where the stories live: beside the briefs, one folder per story. */
export const STORIES_DIR = process.env.FRAMEWORK_STORIES_DIR
  || path.resolve(BRIEFS_DIR, "..", "stories");

/**
 * The stories folder that goes with a briefs folder. A folder named
 * explicitly (the tests do this) is only that folder, unless its stories are
 * named too; the default location brings its stories along.
 */
function storiesFor(dir, stories) {
  if (stories !== undefined) return stories || null;
  return dir ? null : STORIES_DIR;
}

/** One listing entry from a parsed brief, or null when it is not one. */
function entryFor(parsed, name, file, absolute) {
  // README.md and the like carry no front matter and are not briefs.
  if (!Object.keys(parsed.data).length) return null;
  const safe = safeName(name);
  if (!safe) return null;
  return {
    name: safe,
    file,
    path: absolute,
    story: parsed.data.story || "",
    segment: parsed.data.segment || "",
    scene: parsed.data.scene || "",
    count: Number(parsed.data.count) || 0
  };
}

function readParsed(file) {
  try {
    return parseFrontMatter(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The story folders under `root` that hold a brief.md, by slug. */
function storyBriefs(root) {
  if (!root || !fs.existsSync(root)) return [];
  const found = [];
  for (const slug of fs.readdirSync(root).sort()) {
    const file = path.join(root, slug, "brief.md");
    if (!fs.existsSync(file)) continue;
    const parsed = readParsed(file);
    const entry = parsed && entryFor(parsed, slug, path.join("stories", slug, "brief.md"), file);
    if (entry) found.push(entry);
  }
  return found;
}

/** A brief's name is its file name, and only these characters. */
export function safeName(name) {
  return String(name || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function stripComment(text) {
  // A # starts a comment when it begins the text or follows whitespace, and
  // is not inside quotes.
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

/** One scalar, the way a person would read it. */
export function scalar(raw) {
  const text = stripComment(String(raw)).trim();
  if (text === "") return null;
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return text.slice(1, -1);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    return splitFlow(text.slice(1, -1)).map(scalar).filter((item) => item !== null);
  }
  return text;
}

/** Split `a, "b, c", d` on the commas that are not inside quotes. */
function splitFlow(text) {
  const parts = [];
  let current = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * Parse `text`, a whole Markdown file, into its front matter and its body.
 * A file with no front matter is `{ data: {}, body: text }`.
 */
export function parseFrontMatter(text) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { data: {}, body: source.trim() };
  const lines = match[1].split("\n");
  let at = 0;

  const isBlank = (line) => !stripComment(line).trim();
  const listItem = (line) => /^\s*-\s+(.*)$/.exec(line) || /^\s*-$/.exec(line);
  const mapEntry = (line) => /^\s*([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line);

  function parseList(indent) {
    const items = [];
    while (at < lines.length) {
      const line = lines[at];
      if (isBlank(line)) { at += 1; continue; }
      if (indentOf(line) < indent) break;
      const item = listItem(line);
      if (!item) break;
      items.push(scalar(item[1] || ""));
      at += 1;
    }
    return items.filter((item) => item !== null);
  }

  function parseMap(indent) {
    const map = {};
    while (at < lines.length) {
      const line = lines[at];
      if (isBlank(line)) { at += 1; continue; }
      const here = indentOf(line);
      if (here < indent) break;
      const entry = mapEntry(line);
      if (!entry || here > indent) { at += 1; continue; }
      at += 1;
      const key = entry[1];
      const rest = entry[2] == null ? "" : stripComment(entry[2]).trim();
      if (rest !== "") {
        map[key] = scalar(rest);
        continue;
      }
      // Nothing on the line: the value is the block under it, if any.
      let next = at;
      while (next < lines.length && isBlank(lines[next])) next += 1;
      const below = lines[next];
      if (below != null && listItem(below) && indentOf(below) >= indent) {
        at = next;
        map[key] = parseList(indentOf(below));
      } else if (below != null && indentOf(below) > indent && mapEntry(below)) {
        at = next;
        map[key] = parseMap(indentOf(below));
      } else {
        map[key] = null;
      }
    }
    return map;
  }

  const data = parseMap(0);
  return { data, body: source.slice(match[0].length).trim() };
}

/**
 * The briefs on offer, by name, with the line or two a list wants: the files
 * in the briefs folder, then each story's brief under its slug. A story whose
 * slug collides with a file in `briefs/` is listed once, as the file.
 */
export function listBriefs(dir, stories) {
  const folder = dir || BRIEFS_DIR;
  const briefs = [];
  if (fs.existsSync(folder)) {
    for (const file of fs.readdirSync(folder).sort()) {
      if (!file.endsWith(".md")) continue;
      const absolute = path.join(folder, file);
      const parsed = readParsed(absolute);
      const entry = parsed && entryFor(parsed, parsed.data.name || file.replace(/\.md$/, ""), file, absolute);
      if (entry) briefs.push(entry);
    }
  }
  const taken = new Set(briefs.map((entry) => entry.name));
  for (const entry of storyBriefs(storiesFor(dir, stories))) {
    if (!taken.has(entry.name)) briefs.push(entry);
  }
  return briefs;
}

/**
 * One brief by name: its front matter as fields, plus `body` (the paragraph
 * under it) and `file`. Null when there is no such brief.
 *
 * The name is the file name, or the story's slug. A brief in `briefs/` whose
 * `name:` disagrees with its file is found by either, since the file is what
 * a person sees and the field is what the record keeps; a story's brief
 * answers to its slug only, because the folder is the story's one address.
 */
export function loadBrief(name, dir, stories) {
  const folder = dir || BRIEFS_DIR;
  const root = storiesFor(dir, stories);
  const wanted = safeName(name);
  if (!wanted) return null;
  const candidates = [
    { file: path.join(folder, `${wanted}.md`), shown: `${wanted}.md` },
    { file: root ? path.join(root, wanted, "brief.md") : "", shown: path.join("stories", wanted, "brief.md") }
  ];
  let found = candidates.find((candidate) => candidate.file && fs.existsSync(candidate.file));
  if (!found) {
    const listed = listBriefs(dir, stories).find((entry) => entry.name === wanted);
    found = listed ? { file: listed.path, shown: listed.file } : null;
  }
  if (!found) return null;
  const parsed = readParsed(found.file);
  if (!parsed || !Object.keys(parsed.data).length) return null;
  return Object.assign({}, parsed.data, {
    name: safeName(parsed.data.name) || wanted,
    body: parsed.body,
    file: found.shown
  });
}

/**
 * What a brief's `design` block asks of the generator, in millimetres and
 * finish ids, with anything it does not say left undefined. Read leniently:
 * `width_mm: [min, max]`, `width_mm_max`, `max_width_mm` and `width_max_mm`
 * all mean the same thing, because the person writing a brief should not
 * have to remember which.
 */
export function designConstraints(brief, finishIds) {
  const design = brief && brief.design && typeof brief.design === "object" ? brief.design : {};
  const number = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined);
  const bound = (axis, which) => {
    const range = design[`${axis}_mm`];
    if (Array.isArray(range)) return number(which === "min" ? range[0] : range[1]);
    if (!Array.isArray(range) && which === "max" && number(range)) return number(range);
    return number(design[`${axis}_mm_${which}`])
      ?? number(design[`${which}_${axis}_mm`])
      ?? number(design[`${axis}_${which}_mm`]);
  };
  const named = design.colours ?? design.colors ?? design.finishes ?? design.finish;
  const colours = (Array.isArray(named) ? named : named ? [named] : [])
    .map((id) => String(id).trim().toLowerCase())
    .filter((id) => !finishIds || finishIds.includes(id));
  const constraints = {
    widthMinMm: bound("width", "min"),
    widthMaxMm: bound("width", "max"),
    heightMinMm: bound("height", "min"),
    heightMaxMm: bound("height", "max"),
    depthMaxMm: bound("depth", "max"),
    piecesMin: number(design.pieces_min ?? design.min_pieces),
    piecesMax: number(design.pieces_max ?? design.max_pieces),
    colours: colours.length ? colours : undefined
  };
  for (const key of Object.keys(constraints)) {
    if (constraints[key] === undefined) delete constraints[key];
  }
  return constraints;
}

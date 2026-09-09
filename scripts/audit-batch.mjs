#!/usr/bin/env node
/**
 * Count what a batch of scenes keeps repeating.
 *
 * Nobody can tell from one picture that the prompt puts a tote bag in every
 * room; it takes the batch. And a model cannot say whether a picture is good,
 * but it can say what is in it, and "the same thing again" is a count. So:
 * a short structured inventory of each image from the cheap validate model,
 * then a table of anything that appears in more than a third of the batch,
 * and how the light fell across it.
 *
 *     node scripts/audit-batch.mjs --dir ../framework-marketing/research/batches/new
 *     node scripts/audit-batch.mjs a.jpg b.jpg c.jpg --out sameness.json
 *
 * Writes `sameness.json` beside the images (or to --out) and prints the
 * tables. The key is read from ../gemini-api.txt and never printed; without
 * it the call goes through the dev server's /api/ai proxy.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.STUDIO_ORIGIN || "http://127.0.0.1:8770";
const KEY_FILE = process.env.GEMINI_KEY_FILE || path.resolve(ROOT, "..", "gemini-api.txt");

/** "More than a third of the batch" is the line between a scene and a habit. */
export const REPEAT_SHARE = 1 / 3;

const AUDIT_PX = 1024;
const JOBS = 3;

const LIGHTS = ["overcast", "soft daylight", "hard sun", "golden hour", "evening lamps", "night", "mixed"];
const TIMES = ["morning", "midday", "afternoon", "evening", "night", "unclear"];
const FILLS = ["empty", "sparse", "moderate", "full", "packed"];

const INVENTORY = `You are cataloguing a photograph of a room with a freestanding steel shelving unit in it, for a batch audit that counts repeated objects across many photographs.

List what is in the picture, plainly. Name objects with a short generic noun of one or two words, singular, lower case, no adjectives and no colours ("picture book", "teddy bear", "toy car", "potted plant", "tote bag", "phone", "mug", "framed print", "storage box", "wooden toy", "laptop", "glasses"). Do not describe the shelf itself. Be complete about the shelf's contents and about anything lying around near it; the point is to notice the same object turning up again in another picture.

Respond with ONLY a JSON object, no markdown fence:

{
  "room": "<what room this is, two or three words>",
  "on_shelf": [<every distinct kind of object on the shelf>],
  "near_shelf": [<every distinct kind of object on the floor, walls and furniture within reach of the shelf>],
  "shelf_fill": <one of ${JSON.stringify(FILLS)}>,
  "light": <one of ${JSON.stringify(LIGHTS)}>,
  "time_of_day": <one of ${JSON.stringify(TIMES)}>,
  "window_visible": <true|false>,
  "people_visible": <true|false>,
  "wall_colour": "<one or two words>",
  "floor": "<one or two words: material or covering>",
  "mood": [<three plain words for the feel of the room, lower case, e.g. "bright", "busy", "calm", "dim", "warm", "cluttered", "tidy", "glamorous", "ordinary">]
}`;

function j(...args) { return path.join(...args); }

function shrink(source, out) {
  if (!fs.existsSync(source)) return null;
  const result = spawnSync("sips", ["-s", "format", "jpeg", "-Z", String(AUDIT_PX), source, "--out", out], { stdio: "ignore" });
  return result.status === 0 && fs.existsSync(out) ? out : null;
}

// --------------------------------------------------------------- the call ---

let runActionPromise = null;
async function vision(partsOrText) {
  if (fs.existsSync(KEY_FILE)) {
    if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
    runActionPromise = runActionPromise || import("../netlify/functions/ai.mjs").then((m) => m.runAction);
    const runAction = await runActionPromise;
    const { status, body } = await runAction({ action: "text", provider: "gemini", partsOrText });
    if (status !== 200) throw new Error(`inventory call failed (${status}): ${JSON.stringify(body).slice(0, 200)}`);
    return body.text || "";
  }
  const response = await fetch(`${API}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "text", provider: "gemini", partsOrText }),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`inventory call failed (${response.status}): ${raw.slice(0, 200)}`);
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`inventory returned non-JSON: ${raw.slice(0, 200)}`); }
  return body.text || body.result?.text || "";
}

export async function inventory(imagePath) {
  const tmp = fs.mkdtempSync(j(process.env.TMPDIR || "/tmp", "batch-audit-"));
  const small = shrink(imagePath, j(tmp, "image.jpg"));
  if (!small) throw new Error(`could not read ${imagePath}`);
  let text;
  try {
    text = await vision([
      { text: INVENTORY },
      { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(small).toString("base64") } }
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error(`no JSON in inventory reply: ${String(text).slice(0, 200)}`);
  return JSON.parse(match[0]);
}

// -------------------------------------------------------------- counting ---

const PLURAL_KEEP = new Set(["glasses", "headphones", "scissors", "sunglasses", "jeans", "trousers", "blinds", "curtains", "bookends", "lego", "clothes"]);

/** "two teddy bears" and "a teddy bear" are the same thing turning up again. */
export function canon(name) {
  let text = String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  // Leading counts, articles and sizes, stripped until none is left.
  const leading = /^(a|an|the|one|two|three|four|five|six|several|some|few|many|pair|set|stack|pile|bunch|couple|of|small|large|little|big|tiny)\s+/;
  while (leading.test(text)) text = text.replace(leading, "");
  const words = text.split(" ");
  const last = words[words.length - 1];
  if (last && !PLURAL_KEEP.has(last) && last.length > 3) {
    if (/ies$/.test(last)) words[words.length - 1] = last.replace(/ies$/, "y");
    else if (/ves$/.test(last)) words[words.length - 1] = last.replace(/ves$/, "f");
    else if (/(ches|shes|xes|sses)$/.test(last)) words[words.length - 1] = last.replace(/es$/, "");
    else if (/s$/.test(last) && !/ss$/.test(last)) words[words.length - 1] = last.replace(/s$/, "");
  }
  return words.join(" ").trim();
}

/** How many images each thing appears in, from a list of per-image sets. */
function tally(sets) {
  const counts = new Map();
  for (const set of sets) for (const item of set) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarise(entries) {
  const n = entries.length;
  const shelfSets = entries.map((e) => new Set((e.inventory.on_shelf || []).map(canon).filter(Boolean)));
  const nearSets = entries.map((e) => new Set((e.inventory.near_shelf || []).map(canon).filter(Boolean)));
  const anySets = entries.map((e, i) => new Set([...shelfSets[i], ...nearSets[i]]));
  const moodSets = entries.map((e) => new Set((e.inventory.mood || []).map(canon).filter(Boolean)));
  const threshold = n * REPEAT_SHARE;

  const repeated = tally(anySets)
    .filter(([, count]) => count > threshold)
    .map(([item, count]) => ({
      item, count, share: Number((count / n).toFixed(2)),
      onShelf: shelfSets.filter((set) => set.has(item)).length,
      nearShelf: nearSets.filter((set) => set.has(item)).length,
      images: entries.filter((e, i) => anySets[i].has(item)).map((e) => e.id)
    }));
  const moods = tally(moodSets).map(([word, count]) => ({ word, count, share: Number((count / n).toFixed(2)), repeated: count > threshold }));
  const distribution = (key, labels) => {
    const counts = Object.fromEntries(labels.map((label) => [label, 0]));
    for (const e of entries) {
      const value = String(e.inventory[key] || "").toLowerCase().trim();
      counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  };
  return {
    images: n,
    repeatShare: REPEAT_SHARE,
    repeated,
    light: distribution("light", LIGHTS),
    timeOfDay: distribution("time_of_day", TIMES),
    shelfFill: distribution("shelf_fill", FILLS),
    moods,
    windows: entries.filter((e) => e.inventory.window_visible).length,
    people: entries.filter((e) => e.inventory.people_visible).length,
    allObjects: tally(anySets).map(([item, count]) => ({ item, count }))
  };
}

// ------------------------------------------------------------------ main ---

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /\.(jpe?g|png)$/i.test(name) && !/\.thumb\.jpe?g$/i.test(name))
    .sort()
    .map((name) => j(dir, name));
}

function printTables(summary) {
  const n = summary.images;
  const bar = (count) => "#".repeat(count) + ".".repeat(Math.max(0, n - count));
  console.log(`\n${n} images · a thing is a repeat when it is in more than ${Math.round(REPEAT_SHARE * 100)}% of them\n`);
  console.log("REPEATED OBJECTS (on or near the shelf)");
  if (!summary.repeated.length) console.log("  none: nothing appears in more than a third of the batch");
  for (const r of summary.repeated) {
    console.log(`  ${r.item.padEnd(22)} ${String(r.count).padStart(2)}/${n}  ${bar(r.count)}  shelf ${r.onShelf}, near ${r.nearShelf}`);
  }
  const dist = (title, counts) => {
    console.log(`\n${title}`);
    for (const [label, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      if (count) console.log(`  ${label.padEnd(22)} ${String(count).padStart(2)}/${n}  ${bar(count)}`);
    }
  };
  dist("LIGHT", summary.light);
  dist("TIME OF DAY", summary.timeOfDay);
  dist("SHELF FILL", summary.shelfFill);
  console.log("\nMOOD WORDS");
  for (const m of summary.moods.slice(0, 12)) {
    console.log(`  ${m.word.padEnd(22)} ${String(m.count).padStart(2)}/${n}  ${bar(m.count)}${m.repeated ? "  repeat" : ""}`);
  }
  console.log(`\nwindows visible ${summary.windows}/${n} · people visible ${summary.people}/${n}`);
}

async function main() {
  const args = process.argv.slice(2);
  let dir = null, out = null, jobs = JOBS;
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--dir") dir = args[i + 1], (i += 1);
    else if (args[i] === "--out") out = args[i + 1], (i += 1);
    else if (args[i] === "--jobs") jobs = Number(args[i + 1]), (i += 1);
    else if (args[i].startsWith("--")) throw new Error(`unknown argument ${args[i]}`);
    else files.push(path.resolve(args[i]));
  }
  if (dir) files.push(...listImages(path.resolve(dir)));
  if (!files.length) {
    console.error("nothing to audit: pass --dir <folder> or image files");
    process.exit(1);
  }
  const target = out ? path.resolve(out) : dir ? j(path.resolve(dir), "sameness.json") : j(process.cwd(), "sameness.json");

  const entries = [];
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      const id = path.basename(file);
      try {
        const result = await inventory(file);
        entries.push({ id, file, inventory: result });
        process.stderr.write(`  ${id}: ${result.light}, ${result.time_of_day}, shelf ${result.shelf_fill}, ${(result.on_shelf || []).length + (result.near_shelf || []).length} things\n`);
      } catch (error) {
        process.stderr.write(`  ${id}: ${error.message}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  if (!entries.length) {
    console.error("no inventories came back");
    process.exit(1);
  }

  const summary = summarise(entries);
  fs.writeFileSync(target, JSON.stringify({ ...summary, entries }, null, 1));
  printTables(summary);
  console.log(`\nwritten to ${target}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}

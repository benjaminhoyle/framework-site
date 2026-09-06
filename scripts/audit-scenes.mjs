#!/usr/bin/env node
/**
 * Score a generated scene against the render it was supposed to preserve.
 *
 * The studio's complaint is not that the scenes are ugly — they are often very
 * good rooms — but that the shelf inside them is not the shelf. That is a hard
 * thing to argue about from memory and an easy thing to measure: put the render
 * and the scene in front of a vision model and ask it to count.
 *
 * It runs on the cheap validate model (gemini-3.5-flash), not the image model,
 * so a hundred of these cost less than one generation. That is the point — it
 * makes prompt changes testable instead of arguable.
 *
 * The rubric has two halves that pull against each other on purpose:
 *
 *   - FIDELITY: is this the same shelf, from the same place, in the same
 *     colour? Counted, not felt — tiers and posts are integers.
 *   - PLACE: is this a real Nairobi room, or the beige nowhere an unconstrained
 *     model returns? A prompt that fixes fidelity by flattening the room into a
 *     studio backdrop has not fixed anything, so both are scored every time and
 *     neither is allowed to win alone.
 *
 *     node scripts/audit-scenes.mjs                 # every scene on record
 *     node scripts/audit-scenes.mjs --scene <id>    # one
 *     node scripts/audit-scenes.mjs --out audit.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIPELINE = path.resolve(ROOT, "..", "framework-renderer");
const SCENES_DIR = path.join(ROOT, "data/design-lab/scenes");
const RECORD = path.join(ROOT, "data/design-lab/scenes.jsonl");
const API = process.env.STUDIO_ORIGIN || "http://127.0.0.1:8770";

/*
 * Big enough to count tiers and read a joint, small enough to stay cheap. The
 * render is 1800px and the scene 2400px; neither needs to travel at that size
 * to answer "how many shelves are there".
 */
const AUDIT_PX = 1024;

/** One audit is two images and a page of rubric; a minute is generous. */
const CALL_TIMEOUT_MS = 150_000;

const RUBRIC = `You are auditing an image pipeline for a modular steel shelving company.

IMAGE A is a clean 3D render of a shelf: the exact product, on a white background, with a grey untextured human figure beside it for scale.
IMAGE B is a photorealistic image an AI generated from IMAGE A. It was told to place THAT EXACT SHELF in a real room in Nairobi, preserving its geometry, colour and the vantage it is seen from, while inventing the room around it.

Judge IMAGE B against IMAGE A. Be strict and literal. Count things rather than describing them. The grey figure in IMAGE A is a measuring aid and is CORRECTLY absent from IMAGE B — never penalise its absence, and never count it as a fault.

Respond with ONLY a JSON object, no markdown fence:

{
  "tiers_a": <integer: how many horizontal shelf boards in IMAGE A>,
  "tiers_b": <integer: how many horizontal shelf boards on the shelf in IMAGE B>,
  "uprights_a": <integer: how many vertical posts/legs visible in IMAGE A>,
  "uprights_b": <integer: how many vertical posts/legs visible in IMAGE B>,
  "silhouette": <0-5: would IMAGE B's shelf outline trace onto IMAGE A's? 5 = same asymmetry, same widths, same heights, same steps. 0 = a different piece of furniture>,
  "viewpoint": <0-5: same camera height and horizontal angle around the shelf? 5 = identical vantage. 0 = shot from somewhere else entirely>,
  "colour": <0-5: same frame colour and finish? 5 = identical hue and sheen>,
  "material": <0-5: still powder-coated steel tube with flat shelves and visible bolts? 5 = identical construction>,
  "two_tone": <0-5: in IMAGE A the steel frame (tubes, posts, legs) is clearly DARKER than the flat board faces. Is that same two-tone contrast present in IMAGE B? 5 = same clear dark-frame/light-board split. 0 = flattened to a single colour, or inverted>,
  "collars": <0-5: the uprights in IMAGE A are stacked segments with a slim collar at each join, recurring up the leg. Are they still there in IMAGE B? 5 = present and correct. 0 = smooth continuous poles, joins gone>,
  "square_corners": <0-5: board ends and corners in IMAGE A are sawn square — sharp right angles. In IMAGE B? 5 = still sharp and square. 0 = rounded, radiused or softened>,
  "separate_units": <0-5: where two units stand side by side at the same height in IMAGE A, their shelf boards STOP and START AGAIN — separate boards, a visible break, a doubled pair of posts at the meeting. Is that still true in IMAGE B? 5 = every junction still reads as two units. 0 = one continuous surface runs across, the units merged into a single wider bay. Answer 5 if IMAGE A has no side-by-side junction at all>,
  "faults": [<short strings: concrete structural differences, e.g. "gained a 5th tier", "wings are symmetric but reference is asymmetric", "tubes thickened", "boards now wooden">],
  "craft_note": "<one short sentence on the material/finish differences specifically, or 'faithful'>",
  "nairobi_real": <0-5: does this read as a real occupied Nairobi room? 5 = convincingly real and specific. 0 = generic showroom or render>,
  "beige_nowhere": <0-5: how much is this the generic beige/greige AI interior with no specificity? 0 = not at all, richly specific. 5 = entirely generic beige>,
  "shelf_is_subject": <true|false: is the shelf clearly visible, well lit, unobstructed>,
  "one_line": "<one sentence: the single biggest fidelity problem, or 'faithful' if there is none>"
}`;

function j(...args) { return path.join(...args); }

/** A smaller JPEG copy, cut with sips, so the audit call stays cheap. */
function shrink(source, out) {
  if (!fs.existsSync(source)) return null;
  const result = spawnSync("sips", ["-s", "format", "jpeg", "-Z", String(AUDIT_PX), source, "--out", out],
    { stdio: "ignore" });
  return result.status === 0 && fs.existsSync(out) ? out : null;
}

function sceneRows() {
  if (!fs.existsSync(RECORD)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(RECORD, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.id) byId.set(row.id, row);
    } catch { /* a half-written last line; the rest still counts */ }
  }
  return [...byId.values()];
}

async function audit(referencePath, generatedPath) {
  const tmp = fs.mkdtempSync(j(process.env.TMPDIR || "/tmp", "scene-audit-"));
  const a = shrink(referencePath, j(tmp, "a.jpg"));
  const b = shrink(generatedPath, j(tmp, "b.jpg"));
  if (!a || !b) throw new Error(`could not read ${!a ? referencePath : generatedPath}`);

  const partsOrText = [
    { text: RUBRIC },
    { text: "IMAGE A — the render, product truth:" },
    { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(a).toString("base64") } },
    { text: "IMAGE B — what the model generated from it:" },
    { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(b).toString("base64") } },
  ];

  // A hung call must not hang the run. Without this a single stalled request
  // stopped a sixteen-scene audit for half an hour with nothing to show for it.
  const response = await fetch(`${API}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "text", provider: "gemini", partsOrText }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const raw = await response.text();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!response.ok) throw new Error(`audit call failed (${response.status}): ${raw.slice(0, 200)}`);

  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`audit returned non-JSON: ${raw.slice(0, 200)}`); }
  const text = body.text || body.result?.text || "";
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error(`no JSON in audit reply: ${String(text).slice(0, 200)}`);
  return JSON.parse(match[0]);
}

/** One number for "is this the same shelf", so runs can be compared at a glance. */
export function fidelityScore(verdict) {
  const tiers = verdict.tiers_a === verdict.tiers_b ? 5 : Math.max(0, 5 - Math.abs(verdict.tiers_a - verdict.tiers_b) * 2.5);
  return Number((
    (tiers + verdict.silhouette + verdict.viewpoint + verdict.colour + verdict.material) / 5
  ).toFixed(2));
}

/**
 * The three the product is actually recognised by, close up.
 *
 * Two-tone is the one nothing ever said out loud: every finish in the catalogue
 * is a dark steel frame carrying lighter MDF boards (marine is #143F68 against
 * #82AAD0), and a prompt that says "the steel frame colour must match" in the
 * singular invites the model to flatten both into one.
 */
export function craftScore(verdict) {
  const parts = [verdict.two_tone, verdict.collars, verdict.square_corners, verdict.separate_units]
    .filter((value) => typeof value === "number");
  if (!parts.length) return null;
  return Number((parts.reduce((sum, value) => sum + value, 0) / parts.length).toFixed(2));
}

/** And one for "is it still somewhere real", which fidelity must not buy. */
export function placeScore(verdict) {
  return Number((((verdict.nairobi_real + (5 - verdict.beige_nowhere)) / 2)).toFixed(2));
}

export async function auditPair(referencePath, generatedPath) {
  const verdict = await audit(referencePath, generatedPath);
  return {
    ...verdict,
    fidelity: fidelityScore(verdict),
    craft: craftScore(verdict),
    place: placeScore(verdict)
  };
}

async function main() {
  const args = process.argv.slice(2);
  const wanted = [];
  let out = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--scene") wanted.push(args[i + 1]), (i += 1);
    else if (args[i] === "--out") out = args[i + 1], (i += 1);
  }

  const rows = sceneRows().filter((row) => !wanted.length || wanted.includes(row.id));
  if (!rows.length) {
    console.error("no scenes to audit");
    process.exit(1);
  }

  const results = [];
  for (const row of rows) {
    const reference = j(PIPELINE, "generated/scenes/design-lab", `${row.shotId}.blender-render.png`);
    const generated = j(SCENES_DIR, `${row.id}.jpg`);
    process.stderr.write(`auditing ${row.id}…\n`);
    try {
      const verdict = await auditPair(reference, generated);
      results.push({ id: row.id, preset: row.preset, ...verdict });
      process.stderr.write(`  fid ${verdict.fidelity} craft ${verdict.craft} place ${verdict.place}\n`);
      // Written as they arrive: an audit is cheap but not instant, and losing
      // fifteen good verdicts to a sixteenth bad one is a waste of the wait.
      if (out) fs.writeFileSync(path.isAbsolute(out) ? out : j(ROOT, out), JSON.stringify(results, null, 1));
    } catch (error) {
      console.error(`  ${row.id}: ${error.message}`);
    }
  }

  console.log("");
  console.log("id                                     fid craft place 2tone collar sqcnr split  note");
  for (const r of results) {
    console.log(
      `${r.id.slice(0, 37).padEnd(37)} ${String(r.fidelity).padStart(4)} ${String(r.craft).padStart(4)} ${String(r.place).padStart(4)} ` +
      `${String(r.two_tone).padStart(4)} ${String(r.collars).padStart(5)} ${String(r.square_corners).padStart(4)} ${String(r.separate_units).padStart(4)}   ` +
      `${String(r.craft_note || r.one_line).slice(0, 52)}`);
  }
  if (results.length) {
    const mean = (key) => (results.reduce((sum, r) => sum + (r[key] || 0), 0) / results.length).toFixed(2);
    console.log("");
    console.log(`mean fidelity ${mean("fidelity")} · craft ${mean("craft")} · place ${mean("place")} · ${results.length} scenes`);
    console.log(`  two-tone ${mean("two_tone")} · collars ${mean("collars")} · square corners ${mean("square_corners")} · separate units ${mean("separate_units")}`);
    const faults = results.flatMap((r) => r.faults || []);
    if (faults.length) {
      console.log("\nfaults seen:");
      for (const fault of faults) console.log(`  - ${fault}`);
    }
  }
  if (out) {
    fs.writeFileSync(path.isAbsolute(out) ? out : j(ROOT, out), JSON.stringify(results, null, 1));
    console.log(`\nwritten to ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

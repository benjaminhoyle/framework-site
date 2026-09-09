#!/usr/bin/env node
/**
 * Score a generated scene against the render it was supposed to preserve.
 *
 * The studio's complaint is not that the scenes are ugly (they are often very
 * good rooms) but that the shelf inside them is not the shelf. That is a hard
 * thing to argue about from memory and an easy thing to measure: put the render
 * and the scene in front of a vision model and ask it to count.
 *
 * It runs on the cheap validate model in netlify/functions/ai.mjs, not the
 * image model, so a hundred of these cost less than one generation. That is
 * the point: it makes prompt changes testable instead of arguable.
 *
 * The rubric has two halves that pull against each other on purpose:
 *
 *   - FIDELITY: is this the same shelf, from the same place, in the same
 *     colour? Counted, not felt: tiers and posts are integers.
 *   - PLACE: is this a real Nairobi room, or the beige nowhere an unconstrained
 *     model returns? A prompt that fixes fidelity by flattening the room into a
 *     studio backdrop has not fixed anything, so both are scored every time and
 *     neither is allowed to win alone.
 *
 * On top of the scores sits the GATE: one number from 0 to 100 built from
 * geometry, viewpoint and colour, and a pass or fail against PASS_SCORE. The
 * gate is written onto the scene's row through the dev server, so the studio
 * can rank failures down before Ben sees them.
 *
 *     node scripts/audit-scenes.mjs                 # every scene on record
 *     node scripts/audit-scenes.mjs --scene <id>    # one
 *     node scripts/audit-scenes.mjs --image scene.jpg --reference render.png
 *     node scripts/audit-scenes.mjs --dir batches/new [--reference render.png]
 *     node scripts/audit-scenes.mjs --out audit.json --no-write
 *
 * The key is read from ../gemini-api.txt when that file exists and is never
 * printed; without it the call goes through the dev server's /api/ai proxy.
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
const KEY_FILE = process.env.GEMINI_KEY_FILE || path.resolve(ROOT, "..", "gemini-api.txt");

/**
 * The gate. A scene scoring under this is a fail: the studio ranks it down
 * and Ben mostly sees passers. A tier count that differs from the render is a
 * fail on its own, whatever the rest says, because a different number of
 * shelves is a different product.
 */
export const PASS_SCORE = 70;

/*
 * Big enough to count tiers and read a joint, small enough to stay cheap. The
 * render is 1800px and the scene 2400px; neither needs to travel at that size
 * to answer "how many shelves are there".
 */
const AUDIT_PX = 1024;

/** One audit is two images and a page of rubric; a minute is generous. */
const CALL_TIMEOUT_MS = 150_000;

const RUBRIC = `You are auditing an image pipeline for a modular steel shelving company.

IMAGE A is a clean 3D render of a shelf: the exact product, on a plain background, sometimes with a grey untextured human figure beside it for scale.
IMAGE B is a photorealistic image an AI generated from IMAGE A. It was told to place THAT EXACT SHELF in a real room in Nairobi, preserving its geometry, colour and the vantage it is seen from, while inventing the room around it.

Judge IMAGE B against IMAGE A. Be strict and literal. Count things rather than describing them. The grey figure in IMAGE A, when present, is a measuring aid and is CORRECTLY absent from IMAGE B: never penalise its absence, and never count it as a fault.

Respond with ONLY a JSON object, no markdown fence:

{
  "tiers_a": <integer: how many horizontal shelf boards in IMAGE A>,
  "tiers_b": <integer: how many horizontal shelf boards on the shelf in IMAGE B>,
  "uprights_a": <integer: how many vertical posts/legs visible in IMAGE A>,
  "uprights_b": <integer: how many vertical posts/legs visible in IMAGE B>,
  "silhouette": <0-5: would IMAGE B's shelf outline trace onto IMAGE A's? 5 = same asymmetry, same widths, same heights, same steps. 0 = a different piece of furniture. Posts standing above the top board where IMAGE A has none are a fail-level fault: score 2 or lower and name it in faults>,
  "viewpoint": <0-5: same camera height and horizontal angle around the shelf? 5 = identical vantage. 0 = shot from somewhere else entirely>,
  "colour": <0-5: same frame colour and finish? 5 = identical hue and sheen>,
  "material": <0-5: still powder-coated steel tube with flat shelves and visible bolts? 5 = identical construction>,
  "two_tone": <0-5: in IMAGE A the steel frame (tubes, posts, legs) is clearly DARKER than the flat board faces. Is that same two-tone contrast present in IMAGE B? 5 = same clear dark-frame/light-board split. 0 = flattened to a single colour, or inverted>,
  "collars": <0-5: the uprights in IMAGE A are stacked segments with a slim collar at each join, recurring up the leg. Are they still there in IMAGE B? 5 = present and correct. 0 = smooth continuous poles, joins gone>,
  "square_corners": <0-5: board ends and corners in IMAGE A are sawn square, sharp right angles. In IMAGE B? 5 = still sharp and square. 0 = rounded, radiused or softened>,
  "separate_units": <0-5: where two units stand side by side at the same height in IMAGE A, their shelf boards STOP and START AGAIN: separate boards, a visible break, a doubled pair of posts at the meeting. Is that still true in IMAGE B? 5 = every junction still reads as two units. 0 = one continuous surface runs across, the units merged into a single wider bay. Answer 5 if IMAGE A has no side-by-side junction at all>,
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

// --------------------------------------------------------------- the call ---

/**
 * The vision call: the validate model and its fallbacks exactly as ai.mjs
 * runs them, with the key read from the key file into this process only.
 * Without a key file the dev server's proxy does the same thing.
 */
let runActionPromise = null;
async function vision(partsOrText) {
  if (fs.existsSync(KEY_FILE)) {
    if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
    runActionPromise = runActionPromise || import("../netlify/functions/ai.mjs").then((m) => m.runAction);
    const runAction = await runActionPromise;
    const { status, body } = await runAction({ action: "text", provider: "gemini", partsOrText });
    if (status !== 200) throw new Error(`audit call failed (${status}): ${JSON.stringify(body).slice(0, 200)}`);
    return body.text || "";
  }
  // A hung call must not hang the run. Without this a single stalled request
  // stopped a sixteen-scene audit for half an hour with nothing to show for it.
  const response = await fetch(`${API}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "text", provider: "gemini", partsOrText }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`audit call failed (${response.status}): ${raw.slice(0, 200)}`);
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`audit returned non-JSON: ${raw.slice(0, 200)}`); }
  return body.text || body.result?.text || "";
}

async function audit(referencePath, generatedPath) {
  const tmp = fs.mkdtempSync(j(process.env.TMPDIR || "/tmp", "scene-audit-"));
  const a = shrink(referencePath, j(tmp, "a.jpg"));
  const b = shrink(generatedPath, j(tmp, "b.jpg"));
  if (!a || !b) throw new Error(`could not read ${!a ? referencePath : generatedPath}`);

  const partsOrText = [
    { text: RUBRIC },
    { text: "IMAGE A, the render, product truth:" },
    { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(a).toString("base64") } },
    { text: "IMAGE B, what the model generated from it:" },
    { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(b).toString("base64") } },
  ];
  let text;
  try {
    text = await vision(partsOrText);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error(`no JSON in audit reply: ${String(text).slice(0, 200)}`);
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------- scores ---

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

/**
 * The gate: geometry, viewpoint and colour as one score out of 100, and the
 * verdict against PASS_SCORE. Geometry carries half the weight because it is
 * what the audit was built to catch; viewpoint a third of the rest, because
 * drift there is the hardest fault to see by eye; colour the remainder.
 */
export function fidelityGate(verdict) {
  const n = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0);
  const tiersMatch = Number.isFinite(verdict.tiers_a) && verdict.tiers_a === verdict.tiers_b;
  const tiers = tiersMatch ? 5 : Math.max(0, 5 - Math.abs((verdict.tiers_a || 0) - (verdict.tiers_b || 0)) * 2.5);
  const geometry = (tiers + n(verdict.silhouette) + n(verdict.material)) / 3;
  const viewpoint = n(verdict.viewpoint);
  const colour = typeof verdict.two_tone === "number" ? (n(verdict.colour) + n(verdict.two_tone)) / 2 : n(verdict.colour);
  const score = Math.round((geometry * 0.5 + viewpoint * 0.3 + colour * 0.2) / 5 * 100);

  const issues = [];
  if (!tiersMatch) issues.push(`tier count ${verdict.tiers_b} against ${verdict.tiers_a} in the render`);
  if (n(verdict.silhouette) <= 2) issues.push(`silhouette ${verdict.silhouette}/5`);
  if (viewpoint <= 2) issues.push(`viewpoint ${verdict.viewpoint}/5`);
  if (n(verdict.colour) <= 2) issues.push(`colour ${verdict.colour}/5`);
  if (n(verdict.material) <= 2) issues.push(`material ${verdict.material}/5`);
  for (const fault of verdict.faults || []) if (fault && !issues.includes(fault)) issues.push(String(fault));
  if (verdict.shelf_is_subject === false) issues.push("shelf is not the clear subject");
  if (verdict.one_line && !/^faithful\b/i.test(verdict.one_line) && !issues.includes(verdict.one_line)) issues.push(String(verdict.one_line));

  return { score, verdict: tiersMatch && score >= PASS_SCORE ? "pass" : "fail", issues };
}

export async function auditPair(referencePath, generatedPath) {
  const verdict = await audit(referencePath, generatedPath);
  return {
    ...verdict,
    fidelity: fidelityScore(verdict),
    craft: craftScore(verdict),
    place: placeScore(verdict),
    gate: fidelityGate(verdict)
  };
}

// ------------------------------------------------------- writing it back ---

/**
 * Put the gate onto the scene's row. The contract with the studio is a
 * partial row, `{ id, fidelity }`, which the dev server merges onto what it
 * has. A server from before that merge would replace the row instead, so
 * the store is read back and, if the row lost its shot, the whole row is
 * sent again with the gate on it.
 */
async function writeGate(row, gate) {
  const fidelity = { score: gate.score, verdict: gate.verdict, issues: gate.issues, at: new Date().toISOString() };
  const post = (body) => fetch(`${API}/api/design-lab/scenes`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  let response = await post({ id: row.id, fidelity });
  if (!response.ok) throw new Error(`could not write the gate (${response.status})`);
  const store = await (await fetch(`${API}/api/design-lab/scenes`, { signal: AbortSignal.timeout(10_000) })).json();
  const stored = store[row.id];
  if (!stored || !stored.shotId) {
    response = await post(Object.assign({}, row, { fidelity }));
    if (!response.ok) throw new Error(`could not repair the row after the gate (${response.status})`);
    process.stderr.write(`  ${row.id}: the server replaced the row; sent it whole with the gate\n`);
  }
  return fidelity;
}

/** For a folder of images: the gate goes into the image's sidecar JSON when it has one. */
function writeSidecar(imagePath, result) {
  const sidecar = imagePath.replace(/\.(jpe?g|png)$/i, ".json");
  const fidelity = { score: result.gate.score, verdict: result.gate.verdict, issues: result.gate.issues, at: new Date().toISOString() };
  let record = {};
  if (fs.existsSync(sidecar)) {
    try { record = JSON.parse(fs.readFileSync(sidecar, "utf8")); } catch { record = {}; }
  }
  record.fidelity = fidelity;
  record.audit = { fidelity: result.fidelity, craft: result.craft, place: result.place, tiers: [result.tiers_a, result.tiers_b],
    viewpoint: result.viewpoint, colour: result.colour, two_tone: result.two_tone, collars: result.collars, one_line: result.one_line };
  fs.writeFileSync(sidecar, JSON.stringify(record, null, 1));
}

// ------------------------------------------------------------------ main ---

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /\.(jpe?g|png)$/i.test(name) && !/\.thumb\.jpe?g$/i.test(name))
    .sort()
    .map((name) => j(dir, name));
}

async function main() {
  const args = process.argv.slice(2);
  const wanted = [];
  let out = null, image = null, reference = null, dir = null, write = true;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--scene") wanted.push(args[i + 1]), (i += 1);
    else if (args[i] === "--out") out = args[i + 1], (i += 1);
    else if (args[i] === "--image") image = args[i + 1], (i += 1);
    else if (args[i] === "--reference") reference = args[i + 1], (i += 1);
    else if (args[i] === "--dir") dir = args[i + 1], (i += 1);
    else if (args[i] === "--no-write") write = false;
    else throw new Error(`unknown argument ${args[i]}`);
  }

  // What to audit: a list of { id, reference, generated, row? }.
  const jobs = [];
  if (image) {
    if (!reference) throw new Error("--image needs --reference");
    jobs.push({ id: path.basename(image), reference: path.resolve(reference), generated: path.resolve(image) });
  } else if (dir) {
    const folder = path.resolve(dir);
    let ref = reference ? path.resolve(reference) : null;
    if (!ref && fs.existsSync(j(folder, "batch.json"))) ref = JSON.parse(fs.readFileSync(j(folder, "batch.json"), "utf8")).reference;
    if (!ref) throw new Error("--dir needs --reference, or a batch.json in the folder naming one");
    for (const file of listImages(folder)) jobs.push({ id: path.basename(file), reference: ref, generated: file });
  } else {
    for (const row of sceneRows().filter((r) => !wanted.length || wanted.includes(r.id))) {
      jobs.push({
        id: row.id, row,
        reference: j(PIPELINE, "generated/scenes/design-lab", `${row.shotId}.blender-render.png`),
        generated: j(SCENES_DIR, `${row.id}.jpg`)
      });
    }
  }
  if (!jobs.length) {
    console.error("no scenes to audit");
    process.exit(1);
  }

  const results = [];
  const save = () => { if (out) fs.writeFileSync(path.isAbsolute(out) ? out : j(ROOT, out), JSON.stringify(results, null, 1)); };
  for (const job of jobs) {
    process.stderr.write(`auditing ${job.id}...\n`);
    try {
      const verdict = await auditPair(job.reference, job.generated);
      results.push({ id: job.id, preset: job.row ? job.row.preset : undefined, ...verdict });
      process.stderr.write(`  gate ${verdict.gate.score} ${verdict.gate.verdict} · fid ${verdict.fidelity} craft ${verdict.craft} place ${verdict.place}\n`);
      if (write && job.row) await writeGate(job.row, verdict.gate);
      if (write && !job.row) writeSidecar(job.generated, verdict);
      // Written as they arrive: an audit is cheap but not instant, and losing
      // fifteen good verdicts to a sixteenth bad one is a waste of the wait.
      save();
    } catch (error) {
      console.error(`  ${job.id}: ${error.message}`);
    }
  }
  if (dir && write) {
    fs.writeFileSync(j(path.resolve(dir), "fidelity.json"), JSON.stringify(results.map((r) => ({
      id: r.id, score: r.gate.score, verdict: r.gate.verdict, issues: r.gate.issues,
      fidelity: r.fidelity, craft: r.craft, place: r.place, tiers: [r.tiers_a, r.tiers_b]
    })), null, 1));
  }

  console.log("");
  console.log("id                                    gate      fid craft place 2tone collar sqcnr split  note");
  for (const r of results) {
    console.log(
      `${r.id.slice(0, 36).padEnd(36)} ${String(r.gate.score).padStart(3)} ${r.gate.verdict.padEnd(4)} ` +
      `${String(r.fidelity).padStart(4)} ${String(r.craft).padStart(4)} ${String(r.place).padStart(4)} ` +
      `${String(r.two_tone).padStart(4)} ${String(r.collars).padStart(5)} ${String(r.square_corners).padStart(4)} ${String(r.separate_units).padStart(4)}   ` +
      `${String(r.craft_note || r.one_line).slice(0, 52)}`);
  }
  if (results.length) {
    const mean = (pick) => (results.reduce((sum, r) => sum + (pick(r) || 0), 0) / results.length).toFixed(2);
    const passed = results.filter((r) => r.gate.verdict === "pass").length;
    console.log("");
    console.log(`gate: ${passed} of ${results.length} pass at ${PASS_SCORE} · mean score ${mean((r) => r.gate.score)}`);
    console.log(`mean fidelity ${mean((r) => r.fidelity)} · craft ${mean((r) => r.craft)} · place ${mean((r) => r.place)} · ${results.length} scenes`);
    console.log(`  two-tone ${mean((r) => r.two_tone)} · collars ${mean((r) => r.collars)} · square corners ${mean((r) => r.square_corners)} · separate units ${mean((r) => r.separate_units)}`);
    const faults = results.flatMap((r) => r.faults || []);
    if (faults.length) {
      console.log("\nfaults seen:");
      for (const fault of faults) console.log(`  - ${fault}`);
    }
  }
  if (out) {
    save();
    console.log(`\nwritten to ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

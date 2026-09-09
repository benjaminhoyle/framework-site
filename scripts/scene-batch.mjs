#!/usr/bin/env node
/**
 * A batch of scenes from one render, outside the studio.
 *
 * The studio makes one scene at a time off the back of a keypress. Comparing
 * two prompt configs needs a dozen of each from the same reference with the
 * draws recorded, and that is a script, not a page:
 *
 *   node scripts/scene-batch.mjs --reference render.png --out batches/new \
 *        --brief ../framework-marketing/briefs/kids-room-grows.md --count 12
 *
 *   node scripts/scene-batch.mjs --reference render.png --out batches/old \
 *        --legacy <dir with the old prompt-config.js and scene-prompt.js> \
 *        --scene kids-room --count 12
 *
 * The prompt is built by the same browser files the studio loads (from the
 * repo, or from `--legacy <dir>` for an older config), and the request is the
 * shape netlify/functions/ai.mjs sends: the prompt, the reference labelled the
 * way scene-jobs.js labels it, then the image.
 *
 * Every call is counted in `--count-file` before it is made, and the script
 * refuses to go past `--cap` whatever happens. A failed call still counts:
 * it was still a call.
 *
 * The key is read from `--key-file` (default ../gemini-api.txt) and is never
 * printed, logged or written anywhere.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const IMAGE_TIMEOUT_MS = 240_000;
const REFERENCE_LABEL = "REFERENCE IMAGE 1: GEOMETRY AND VIEWPOINT MASTER - copy the shelf's exact silhouette, tier count, board endpoints, tube and post positions, overhangs, colour, material, joints, and the vantage it is seen from. Do not copy its room or styling.";

// ------------------------------------------------------------------ args ---

function parseArgs(argv) {
  const args = {
    reference: null, out: null, brief: null, legacy: null, scene: null, count: 12,
    aspect: "1:1", size: "2K", cap: 26, seed: null,
    countFile: path.resolve(ROOT, "..", "framework-marketing/research/tmp/image-calls.txt"),
    keyFile: path.resolve(ROOT, "..", "gemini-api.txt"),
    dryRun: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === "--reference") args.reference = next();
    else if (a === "--out") args.out = next();
    else if (a === "--brief") args.brief = next();
    else if (a === "--legacy") args.legacy = next();
    else if (a === "--scene") args.scene = next();
    else if (a === "--count") args.count = Number(next());
    else if (a === "--aspect") args.aspect = next();
    else if (a === "--size") args.size = next();
    else if (a === "--cap") args.cap = Number(next());
    else if (a === "--seed") args.seed = Number(next());
    else if (a === "--count-file") args.countFile = next();
    else if (a === "--key-file") args.keyFile = next();
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.reference || !args.out) throw new Error("--reference and --out are required");
  return args;
}

// ------------------------------------------------------- the browser files ---

/**
 * The studio's own files, run against a pretend window. `dir` is the repo for
 * the current config, or a folder holding an older prompt-config.js and
 * scene-prompt.js pulled out of git.
 */
function loadBrowser(dir) {
  const browserRequire = createRequire(import.meta.url);
  global.window = {};
  browserRequire(path.join(dir, "prompt-config.js"));
  browserRequire(path.join(ROOT, "js/studio/scale.js"));
  browserRequire(path.join(dir, "scene-prompt.js"));
  if (fs.existsSync(path.join(dir, "brief.js"))) browserRequire(path.join(dir, "brief.js"));
  return global.window;
}

// ----------------------------------------------------------------- briefs ---

/**
 * The front matter of a brief file. A deliberately small reader: `key: value`,
 * `key: [a, b]`, a list of `- item` lines, and one level of nesting for
 * `design:`. That is every shape briefs/README.md shows.
 */
export function parseBrief(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
  if (!match) return { body: markdown.trim() };
  const brief = { body: match[2].trim() };
  const scalar = (raw) => {
    const text = raw.replace(/\s+#.*$/, "").trim();
    if (/^\[.*\]$/.test(text)) return text.slice(1, -1).split(",").map((s) => scalar(s)).filter((s) => s !== "");
    if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return text.slice(1, -1);
    if (text !== "" && !Number.isNaN(Number(text))) return Number(text);
    return text;
  };
  let holder = brief;
  let listKey = null;
  for (const line of match[1].split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = /^(\s*)/.exec(line)[1].length;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      holder[listKey] = holder[listKey] || [];
      holder[listKey].push(scalar(item[1]));
      continue;
    }
    const pair = /^\s*([A-Za-z_][\w.-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    if (indent === 0) holder = brief;
    const [, key, raw] = pair;
    if (raw.trim() === "" || /^\s*#/.test(raw)) {
      holder[key] = indent === 0 && key === "design" ? {} : [];
      if (indent === 0 && key === "design") { holder = brief.design; listKey = null; } else listKey = key;
      continue;
    }
    holder[key] = scalar(raw);
    listKey = null;
  }
  return brief;
}

// ----------------------------------------------------- the old randomiser ---

/**
 * What "random" meant before the pools: the scene studio's Surprise scene,
 * verbatim in its pools, with the room and the persona held so the two
 * batches differ in the draw and not in the subject. The place is the nearest
 * old archetype's, because the new batch gets a place paragraph too.
 */
function legacyDraw(config, random, scene, persona) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const pickN = (list, n) => [...list].sort(() => random() - 0.5).slice(0, Math.min(n, list.length));
  const commercial = ["office-commercial", "cafe-display", "retail-boutique", "creative-studio"];
  const settingType = commercial.includes(scene) ? "commercial" : "residential";
  const archetype = (config.archetypes || []).find((entry) => entry.id === "south-b-family") || config.archetypes[0];
  const detailPool = settingType === "residential"
    ? ["british-socket", "wall-scuffs", "floor-wear", "light-switch", "aluminium-window", "extension-cable", "shelf-plants", "floor-plant"]
    : ["british-socket", "conduit", "light-switch", "aluminium-window", "floor-wear", "extension-cable"];
  const tracePool = ["mug", "phone-cable", "glasses", "book-facedown", "laptop", "tote-bag"];
  return Object.assign({}, archetype.params, {
    shotType: "use",
    productBackground: "warm-wall-floor",
    settingType,
    scene,
    archetype: archetype.id,
    persona: persona || pick(["reader", "collector", "minimalist", "creative", "plant-parent"]),
    fullness: pick(["sparse", "light", "moderate", "full"]),
    livedIn: pick(["tidy", "lived-in", "settled"]),
    camera: pick(["decent-phone", "entry-camera", "pro"]),
    framing: pick(["casual", "considered", "professional"]),
    light: pick(["soft-cloudy", "bright-soft", "flat-overcast", "golden"]),
    details: pickN(detailPool, 3),
    humanTraces: pickN(tracePool, 2),
    customNotes: ""
  });
}

// ------------------------------------------------------------ the counter ---

/**
 * Reserve one call, or refuse. The file is the only memory of how many calls
 * this task has made across every process that made them, so it is locked
 * for the read-and-bump.
 */
function reserveCall(countFile, cap) {
  const lock = `${countFile}.lock`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let fd = null;
    try {
      fd = fs.openSync(lock, "wx");
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      continue;
    }
    try {
      const used = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8").trim() || 0) : 0;
      if (used >= cap) return { ok: false, used };
      fs.writeFileSync(countFile, `${used + 1}\n`);
      return { ok: true, used: used + 1 };
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
  throw new Error("could not take the call counter's lock");
}

// -------------------------------------------------------------- the call ---

function readKey(file) {
  if (!fs.existsSync(file)) throw new Error(`no key file at ${file}`);
  const key = fs.readFileSync(file, "utf8").trim();
  if (!key) throw new Error("the key file is empty");
  return key;
}

async function generate(key, prompt, reference, options) {
  const contents = [{
    parts: [
      { text: prompt },
      { text: REFERENCE_LABEL },
      { inlineData: { mimeType: reference.mimeType, data: reference.base64 } }
    ]
  }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${GEMINI_API_BASE}/${IMAGE_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents,
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: options.aspect, imageSize: options.size }
        }
      })
    });
  } catch (error) {
    throw new Error(error?.name === "AbortError" ? `timed out after ${IMAGE_TIMEOUT_MS / 1000}s` : String(error?.message || error));
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    // The body never carries the key, but the URL would: only the body is kept.
    throw new Error(`${IMAGE_MODEL} ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const body = await response.json();
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const image = parts.find((part) => part.inlineData);
  if (!image) {
    const reason = body?.promptFeedback?.blockReason || candidate?.finishReason || "empty response";
    throw new Error(`no image: ${reason} ${parts.filter((p) => p.text).map((p) => p.text).join(" ").slice(0, 200)}`);
  }
  return {
    mimeType: image.inlineData.mimeType,
    base64: image.inlineData.data,
    text: parts.filter((p) => p.text).map((p) => p.text).join("\n").slice(0, 2000)
  };
}

// ------------------------------------------------------------------ main ---

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  const random = args.seed == null ? Math.random : mulberry(args.seed);

  const dir = args.legacy ? path.resolve(args.legacy) : path.join(ROOT, "js/studio");
  const browser = loadBrowser(dir);
  const CONFIG = browser.PROMPT_CONFIG.CONFIG;
  const build = browser.FrameworkScenePrompt.build;

  let brief = null;
  if (args.brief) {
    brief = parseBrief(fs.readFileSync(path.resolve(args.brief), "utf8"));
    if (!browser.FrameworkBrief) throw new Error("a brief needs js/studio/brief.js, which this config folder does not have");
  }
  const mode = args.legacy ? "legacy" : brief ? "brief" : "random";
  const batch = { random };

  const reference = {
    mimeType: /\.jpe?g$/i.test(args.reference) ? "image/jpeg" : "image/png",
    base64: fs.readFileSync(path.resolve(args.reference)).toString("base64")
  };
  const key = args.dryRun ? null : readKey(args.keyFile);

  const summary = { mode, reference: path.resolve(args.reference), brief: args.brief ? path.resolve(args.brief) : null,
    legacy: args.legacy ? path.resolve(args.legacy) : null, aspect: args.aspect, size: args.size, model: IMAGE_MODEL, images: [] };

  for (let n = 1; n <= args.count; n += 1) {
    const id = String(n).padStart(2, "0");
    let params;
    if (mode === "legacy") params = legacyDraw(CONFIG, random, args.scene || "kids-room", "parent");
    else params = browser.FrameworkBrief.resolve(brief || browser.FrameworkBrief.emptyBrief(), CONFIG, batch).params;
    if (args.scene && mode !== "legacy") params.scene = args.scene;
    const prompt = build(CONFIG, params, { aspect: args.aspect });
    const record = { id, mode, params, prompt, model: IMAGE_MODEL, aspect: args.aspect, size: args.size, startedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(record, null, 1));
    summary.images.push({ id, file: null, error: null });
    if (args.dryRun) { process.stderr.write(`${id} dry run: ${params.light} / ${(params.humanTraces || []).join("+")}\n`); continue; }

    const reserved = reserveCall(args.countFile, args.cap);
    if (!reserved.ok) {
      process.stderr.write(`${id}: the cap of ${args.cap} image calls is used up (${reserved.used}); stopping\n`);
      record.error = "cap reached";
      fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(record, null, 1));
      summary.images[summary.images.length - 1].error = record.error;
      break;
    }
    process.stderr.write(`${id}: call ${reserved.used} of ${args.cap}, ${params.light}, traces ${(params.humanTraces || []).join("+") || "none"}\n`);
    const started = Date.now();
    try {
      const image = await generate(key, prompt, reference, args);
      const ext = image.mimeType.includes("png") ? "png" : "jpg";
      const file = path.join(out, `${id}.${ext}`);
      fs.writeFileSync(file, Buffer.from(image.base64, "base64"));
      record.file = path.basename(file);
      record.modelText = image.text;
      record.seconds = Math.round((Date.now() - started) / 1000);
      summary.images[summary.images.length - 1].file = record.file;
      process.stderr.write(`${id}: saved ${record.file} in ${record.seconds}s\n`);
    } catch (error) {
      record.error = String(error.message || error);
      record.seconds = Math.round((Date.now() - started) / 1000);
      summary.images[summary.images.length - 1].error = record.error;
      process.stderr.write(`${id}: failed after ${record.seconds}s: ${record.error}\n`);
    }
    fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(record, null, 1));
    fs.writeFileSync(path.join(out, "batch.json"), JSON.stringify(summary, null, 1));
  }
  fs.writeFileSync(path.join(out, "batch.json"), JSON.stringify(summary, null, 1));
  const made = summary.images.filter((image) => image.file).length;
  console.log(`${made} of ${summary.images.length} scenes saved to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}

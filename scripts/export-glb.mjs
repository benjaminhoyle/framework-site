#!/usr/bin/env node
/**
 * A design code, as a glTF binary.
 *
 *   node scripts/export-glb.mjs 01H0NP1
 *   node scripts/export-glb.mjs 01H0NP1 --out /tmp/shelf.glb --quantise
 *   node scripts/export-glb.mjs --hash 'WzEsImFkdmFuY2Vk...'
 *   node scripts/export-glb.mjs --all --out-dir /tmp/glb        # every catalogue design
 *
 * The exporter itself is netlify/functions/_glb.mjs, which is what the site
 * serves; this is the bench end of it, reading the catalogue and the module
 * bundles off the disk instead of over HTTP. Both drive js/builder/engine.js
 * and js/builder/geometry.js, so a file written here and a file served from
 * /api/design-glb are the same bytes.
 *
 * It prints the measurements worth arguing with: the size of the file, and the
 * bounding box of the model in metres beside the size the design record states
 * in centimetres. Those two have to agree, because the whole promise of AR is
 * that what stands on the floor is the real thing at the real size.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  engine, geometryLoader, buildGlb, stateFromRecord, stateFromHash,
  modulesNeeded, priceOf, shelfSizeMm, designSizeMm
} from "../netlify/functions/_glb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULES = path.join(ROOT, "assets/shelving/modules");
const DESIGNS = path.join(ROOT, "data/builder-designs");

export function loadCatalog() {
  return engine.normalizeCatalog(
    JSON.parse(fs.readFileSync(path.join(ROOT, "assets/shelving/catalog.json"), "utf8"))
  );
}

const bundles = new Map();
export function loadModules(ids) {
  const modules = new Map();
  for (const id of ids) {
    if (!bundles.has(id)) {
      const file = path.join(MODULES, `${id}.json`);
      if (!fs.existsSync(file)) throw new Error(`no geometry bundle for ${id}`);
      bundles.set(id, geometryLoader.expand(JSON.parse(fs.readFileSync(file, "utf8"))));
    }
    modules.set(id, bundles.get(id));
  }
  return modules;
}

/** A saved design off the disk: the 77 catalogue files are the ones here. */
export function readDesignRecord(code) {
  const file = path.join(DESIGNS, `${String(code).toUpperCase()}.json`);
  if (!fs.existsSync(file)) throw new Error(`no design file for ${code} in data/builder-designs`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Everything about one design, file included. */
export function exportDesign(catalog, state, options = {}) {
  const result = buildGlb(catalog, state, loadModules(modulesNeeded(catalog, state)), options);
  return Object.assign(result, {
    sizeMm: shelfSizeMm(catalog, state),
    boxMm: designSizeMm(catalog, state),
    priceKsh: priceOf(catalog, state).totalKsh,
    finish: state.finish,
    pieces: state.instances.length
  });
}

// ------------------------------------------------------------------- CLI ---

function parseArgs(argv) {
  const out = { codes: [], quantise: false, palette: "material", all: false, out: null, outDir: null, hash: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--quantise") out.quantise = true;
    else if (arg === "--builder-palette") out.palette = "builder";
    else if (arg === "--all") out.all = true;
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--out-dir") out.outDir = argv[++i];
    else if (arg === "--hash") out.hash = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else out.codes.push(arg.toUpperCase());
  }
  return out;
}

function report(label, result, file) {
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  const gz = zlib.gzipSync(result.glb, { level: 9 }).length;
  const size = result.sizeMm;
  const box = result.boxM;
  /*
   * The check that matters: the model's own box against what the engine says
   * the design measures. Against the WHOLE box, lamp arm included, because the
   * size /builder quotes leaves a lamp out on purpose and the model cannot.
   * Reported as a difference in millimetres, not a verdict: the residual is
   * real geometry outside the catalogue's declared module boxes (a standard
   * foot reaches 13mm below the plane it is stood on), and it is better seen
   * than rounded away.
   */
  const full = result.boxMm;
  const delta = [
    Math.round(box.widthM * 1000 - full.widthMm),
    Math.round(box.heightM * 1000 - full.heightMm),
    Math.round(box.depthM * 1000 - full.depthMm)
  ];
  console.log([
    label.padEnd(9),
    `${kb(result.glb.length).padStart(9)}`,
    `gz ${kb(gz).padStart(8)}`,
    `${result.counts.nodes}n/${result.counts.meshes}m/${result.counts.materials}mat`,
    `${String(result.counts.vertices).padStart(6)}v`,
    `${(box.widthM).toFixed(3)} x ${(box.heightM).toFixed(3)} x ${(box.depthM).toFixed(3)} m`,
    `design ${(full.widthMm / 10).toFixed(1)} x ${(full.heightMm / 10).toFixed(1)} x ${(full.depthMm / 10).toFixed(1)} cm`,
    `quoted ${(size.widthMm / 10).toFixed(1)} x ${(size.heightMm / 10).toFixed(1)} x ${(size.depthMm / 10).toFixed(1)} cm`,
    `delta ${delta.map((d) => `${d >= 0 ? "+" : ""}${d}`).join("/")} mm`,
    file ? `-> ${path.relative(process.cwd(), file)}` : ""
  ].join("  "));
  return { bytes: result.glb.length, gzip: gz, delta };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();

  if (options.hash) {
    const state = stateFromHash(catalog, options.hash);
    const result = exportDesign(catalog, state, options);
    const file = options.out || path.join(process.cwd(), `${engine.designCode(state)}.glb`);
    fs.writeFileSync(file, result.glb);
    report(engine.designCode(state), result, file);
    return;
  }

  const codes = options.all
    ? fs.readdirSync(DESIGNS).filter((name) => name.endsWith(".json")).map((name) => name.replace(".json", ""))
    : options.codes;
  if (!codes.length) {
    console.error("usage: node scripts/export-glb.mjs <CODE...> [--out file] [--out-dir dir] [--quantise] [--all]");
    process.exit(2);
  }

  const outDir = options.outDir || (options.out ? null : process.cwd());
  if (outDir) fs.mkdirSync(outDir, { recursive: true });

  let bytes = 0;
  let gzip = 0;
  let worst = 0;
  for (const code of codes) {
    let state;
    try {
      state = stateFromRecord(catalog, readDesignRecord(code));
    } catch (error) {
      console.error(`${code.padEnd(9)}  ${error.message}`);
      continue;
    }
    const result = exportDesign(catalog, state, options);
    const file = outDir ? path.join(outDir, `${code}.glb`) : options.out;
    fs.writeFileSync(file, result.glb);
    const row = report(code, result, file);
    bytes += row.bytes;
    gzip += row.gzip;
    worst = Math.max(worst, ...row.delta.map(Math.abs));
  }
  if (codes.length > 1) {
    console.log(`\n${codes.length} designs: mean ${(bytes / codes.length / 1024).toFixed(1)} kB`
      + ` (${(gzip / codes.length / 1024).toFixed(1)} kB gzipped), worst size delta ${worst} mm`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

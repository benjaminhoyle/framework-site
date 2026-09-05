#!/usr/bin/env node
/**
 * Turn the approved shots into render jobs.
 *
 *   node scripts/export-shots.mjs
 *   node scripts/export-shots.mjs --out ../framework-renderer/generated/lab
 *
 * Each approved shot becomes three files the pipeline already understands: the
 * design (a /builder export, which render-config.py reads unchanged), the
 * camera, and the scale figure. Plus a shell script that renders them.
 *
 * Nothing here derives a camera. The camera is the one the shot was previewed
 * through, captured in the browser from the renderer that drew it and carried
 * on the verdict; deriving it a second time would be two cameras that
 * eventually disagree, and the whole value of the preview is that it showed
 * what would be rendered. Same for where the figure stands.
 */

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/design-lab.mjs";

const PIPELINE = path.resolve(ROOT, "..", "framework-renderer");
const MM_TO_M = 0.001;

function parseArgs(argv) {
  const args = {
    shots: "data/design-lab/shots.jsonl",
    out: "data/design-lab/render-queue",
    /*
     * "viewport" is the only view that honours a camera JSON. Every other one
     * is a preset that frames from the design's bounding box and ignores the
     * camera entirely — which is what the first run did, silently: a hundred
     * renders came out framed by the `reference` preset while the camera the
     * shot was chosen through sat unread on disk beside them.
     */
    view: "viewport",
    width: 1800,
    height: 1800,
    samples: 96
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--shots") { args.shots = value; i += 1; }
    else if (argv[i] === "--out") { args.out = value; i += 1; }
    else if (argv[i] === "--view") { args.view = value; i += 1; }
    else if (argv[i] === "--width") { args.width = Number(value); i += 1; }
    else if (argv[i] === "--height") { args.height = Number(value); i += 1; }
    else if (argv[i] === "--samples") { args.samples = Number(value); i += 1; }
  }
  return args;
}

function resolve(target) {
  return path.isAbsolute(target) ? target : path.join(ROOT, target);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = resolve(args.shots);
  if (!fs.existsSync(file)) {
    console.error(`no shot verdicts at ${args.shots} — choose some angles at shot-lab.html first`);
    process.exit(1);
  }

  // Append-only, last line wins, same as the design verdicts.
  const rows = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.id) rows.set(row.id, row);
  }
  const approved = [...rows.values()].filter((row) => row.verdict === "render");
  if (!approved.length) {
    console.error("nothing approved to render yet");
    process.exit(1);
  }

  const outDir = resolve(args.out);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  for (const row of approved) {
    /*
     * The design carries the shot's colour. The preview showed the shelf in one
     * finish, and a render in a different one is a different picture — the
     * whole point of rolling a colour per shot was to choose among them.
     */
    const design = Object.assign({}, row.design, { finish: row.finish });
    fs.writeFileSync(path.join(outDir, `${row.id}.builder.json`), JSON.stringify(design, null, 1));

    // Metres, and the pipeline's own key names: this is the shape the render
    // console writes, so render-shelf-blender.py reads it without a translator.
    const camera = row.cameraMm;
    fs.writeFileSync(path.join(outDir, `${row.id}.camera.json`), JSON.stringify({
      coordinateSystem: "rhino-mm",
      frame: "walking-person",
      type: camera.type,
      position: camera.positionMm.map((value) => value * MM_TO_M),
      target: camera.targetMm.map((value) => value * MM_TO_M),
      near: Math.max(0.01, (camera.nearMm || 50) * MM_TO_M),
      far: (camera.farMm || 20000) * MM_TO_M,
      fovDeg: camera.fovDeg || 38
    }, null, 1) + "\n");

    fs.writeFileSync(path.join(outDir, `${row.id}.scale-figure.json`), JSON.stringify({
      mode: "manual",
      placement: "manual",
      heightMm: row.scaleFigureMm ? row.scaleFigureMm.heightMm : 1800,
      positionMm: row.scaleFigureMm ? row.scaleFigureMm.positionMm : [0, 0, 0],
      opacity: 1.0
    }, null, 1) + "\n");

    manifest.push({
      id: row.id,
      code: row.code,
      finish: row.finish,
      yawDeg: row.yawDeg,
      figureClear: row.figure ? row.figure.clear : null,
      note: row.note || ""
    });
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
    schema: "framework-render-queue@2",
    exportedAt: new Date().toISOString(),
    view: args.view,
    shots: manifest
  }, null, 1));

  const queue = path.relative(PIPELINE, outDir);
  const lines = [
    "#!/usr/bin/env bash",
    "# Generated by framework-site/scripts/export-shots.mjs — re-run it to refresh.",
    "# Run from the framework-renderer checkout.",
    "set -euo pipefail",
    "",
    ...manifest.flatMap((shot) => [
      `echo "--- ${shot.id}  ${shot.finish}  ${shot.yawDeg}deg"`,
      `python3 scripts/render/render-config.py "${queue}/${shot.id}.builder.json" \\`,
      `  --out-dir generated/scenes/design-lab \\`,
      `  --output-name "${shot.id}" \\`,
      `  --camera-json "${queue}/${shot.id}.camera.json" \\`,
      `  --scale-figure-json "${queue}/${shot.id}.scale-figure.json" \\`,
      `  --view ${args.view} \\`,
      `  --width ${args.width} --height ${args.height} --samples ${args.samples}`,
      ""
    ])
  ];
  const script = path.join(outDir, "render.sh");
  fs.writeFileSync(script, lines.join("\n"));
  fs.chmodSync(script, 0o755);

  console.log(`${approved.length} approved shots of ${new Set(manifest.map((shot) => shot.code)).size} designs`);
  const unclear = manifest.filter((shot) => shot.figureClear === false);
  if (unclear.length) console.log(`  ${unclear.length} with the figure not fully clear of the shelf`);
  console.log(`\n-> ${path.relative(ROOT, outDir)}`);
  console.log(`   from ${path.relative(ROOT, PIPELINE)}:  bash ${path.relative(PIPELINE, script)}`);
}

main();

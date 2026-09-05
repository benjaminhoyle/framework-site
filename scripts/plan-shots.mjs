#!/usr/bin/env node
/**
 * Plan the camera angles for every design that survived review.
 *
 *   node scripts/plan-shots.mjs
 *   node scripts/plan-shots.mjs --angles 4 --seed 5
 *
 * The planning itself lives in scripts/lib/shot-plan.mjs, because the studio
 * plans one design at a time through the dev server and two copies of it would
 * be two different cameras. This is the whole-corpus pass, for looking at a
 * plan before working through it — the studio does not need it.
 */

import fs from "node:fs";
import path from "node:path";
import { ROOT, loadCatalog, mulberry32 } from "./lib/design-lab.mjs";
import { planShotsFor } from "./lib/shot-plan.mjs";

function parseArgs(argv) {
  const args = {
    verdicts: "data/design-lab/verdicts.jsonl",
    out: "data/design-lab/shots.json",
    include: ["keep", "maybe"],
    angles: 4,
    seed: 1
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--verdicts") { args.verdicts = value; i += 1; }
    else if (argv[i] === "--out") { args.out = value; i += 1; }
    else if (argv[i] === "--angles") { args.angles = Number(value); i += 1; }
    else if (argv[i] === "--seed") { args.seed = Number(value); i += 1; }
    else if (argv[i] === "--include") { args.include = value.split(",").map((word) => word.trim()); i += 1; }
  }
  return args;
}

function resolve(target) {
  return path.isAbsolute(target) ? target : path.join(ROOT, target);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const random = mulberry32(args.seed);

  const rows = [];
  for (const line of fs.readFileSync(resolve(args.verdicts), "utf8").split("\n")) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }

  /*
   * A design whose spacing has since been evened out is represented by the row
   * that superseded it, not by the one it replaced. Reading the record is
   * enough — normalise-maybes.mjs writes the improved design back into it as a
   * new row naming its predecessor.
   */
  const superseded = new Set(rows.map((row) => row.supersedes).filter(Boolean));
  const judged = new Map();
  for (const row of rows) {
    if (!row.design || !args.include.includes(row.verdict)) continue;
    if (superseded.has(row.code)) continue;
    judged.set(row.code, row);
  }
  const normalisedCount = [...judged.values()].filter((row) => row.supersedes).length;

  const shots = [];
  for (const row of judged.values()) {
    shots.push(...planShotsFor(catalog, row, { angles: args.angles, random }));
  }

  const outPath = resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    schema: "framework-shot-plan@1",
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    angles: args.angles,
    camera: { kind: "walking-person" },
    contract: catalog.contract || null,
    shots
  }, null, 1));

  console.log(`${judged.size} designs (${normalisedCount} with their spacing evened out)`);
  console.log(`${shots.length} shots at ${args.angles} angles each -> ${path.relative(ROOT, outPath)}`);
}

main();

#!/usr/bin/env node
/**
 * What the verdicts say about what a good design looks like.
 *
 *   node scripts/analyse-verdicts.mjs
 *
 * Reads the review record, measures a handful of things about every design in
 * it, and reports where the kept ones and the rejected ones actually differ.
 *
 * It is deliberately a report and not a model. With a couple of dozen keeps
 * there is nothing to fit that would not mostly be fitting noise, but there is
 * plenty to *look* at — and a feature where the two groups sit on top of each
 * other is as useful to know about as one where they separate.
 */

import fs from "node:fs";
import path from "node:path";
import { ROOT, engine, loadCatalog } from "./lib/design-lab.mjs";

const catalog = loadCatalog();

/**
 * The skyline: how tall each ground stack finishes, left to right.
 *
 * Almost everything below is derived from this, because it is what a shelf
 * looks like from across the room — the thing a person is actually judging in
 * the second they spend on a thumbnail.
 */
function skyline(state) {
  const { rootOf } = engine.stacksOf(state);
  const tops = new Map();
  const lefts = new Map();
  for (const instance of state.instances) {
    const module = catalog.modules[instance.moduleId];
    if (!module || module.role === "lamp") continue;
    const root = rootOf(instance.id);
    const box = engine.instanceBounds(catalog, instance);
    tops.set(root, Math.max(tops.get(root) ?? 0, box[5]));
    lefts.set(root, Math.min(lefts.get(root) ?? Infinity, box[0]));
  }
  return [...tops.keys()]
    .sort((a, b) => lefts.get(a) - lefts.get(b))
    .map((root) => Math.round(tops.get(root)));
}

function monotonic(profile) {
  if (profile.length < 3) return false;
  const up = profile.every((value, i) => i === 0 || value >= profile[i - 1]);
  const down = profile.every((value, i) => i === 0 || value <= profile[i - 1]);
  return up || down;
}

function symmetric(profile) {
  if (profile.length < 3) return false;
  return profile.every((value, i) => Math.abs(value - profile[profile.length - 1 - i]) < 60);
}

function features(row) {
  const state = engine.deserializeState(catalog, row.design);
  const profile = skyline(state);
  const roles = new Map();
  for (const instance of state.instances) {
    const role = (catalog.modules[instance.moduleId] || {}).role;
    roles.set(role, (roles.get(role) || 0) + 1);
  }
  const families = new Set(state.instances
    .map((instance) => (catalog.modules[instance.moduleId] || {}).family)
    .filter(Boolean));
  const size = row.shelfSizeMm || row.sizeMm;

  return {
    pieces: row.pieceCount,
    stacks: profile.length,
    // How many clearly different heights the silhouette has, at 150mm apart.
    heightZones: new Set(profile.map((top) => Math.round(top / 150))).size,
    spreadMm: profile.length ? Math.max(...profile) - Math.min(...profile) : 0,
    stepped: monotonic(profile) ? 1 : 0,
    symmetric: symmetric(profile) ? 1 : 0,
    families: families.size,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    // Long and low, or tall and narrow?
    aspect: Math.round((size.widthMm / Math.max(1, size.heightMm)) * 100) / 100,
    spacers: roles.get("spacer") || 0,
    bars: roles.get("top_bar") || 0
  };
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return { mean, median: sorted[Math.floor(sorted.length / 2)] };
}

function main() {
  /*
   * Comparing across generator versions is how you learn something false.
   * Display bars looked like the strongest reason for rejection in the whole
   * record — until the record was split by corpus, and it turned out the old
   * generator simply made a great many of them and the old corpus was bad for
   * other reasons. Within one era the difference vanished. So the default is to
   * read the newest corpus era only, and --seeds says otherwise.
   */
  const flag = process.argv.indexOf("--seeds");
  const asked = flag >= 0 ? new Set(process.argv[flag + 1].split(",").map(Number)) : null;
  const file = path.join(ROOT, "data/design-lab/verdicts.jsonl");

  const all = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.design) all.set(row.fingerprint, row);
  }

  // Newest first, and take eras until there are enough kept designs to compare.
  // One era would usually be too few and every era is the trap above, so the
  // rule is "the fewest recent corpora that add up to something".
  const eras = [...new Set([...all.values()].map((row) => row.corpusSeed))]
    .filter((seed) => seed != null)
    .sort((a, b) => b - a);
  let wanted = asked;
  if (!wanted) {
    wanted = new Set();
    let liked = 0;
    for (const seed of eras) {
      wanted.add(seed);
      liked += [...all.values()].filter((row) =>
        row.corpusSeed === seed && (row.verdict === "keep" || row.verdict === "maybe")).length;
      if (liked >= 10) break;
    }
  }

  const rows = new Map();
  for (const [fingerprint, row] of all) {
    if (wanted.has(row.corpusSeed)) rows.set(fingerprint, row);
  }
  console.log(`corpora ${[...wanted].sort((a, b) => a - b).join(", ")}` +
    `${asked ? "" : " (newest with enough judged; --seeds to override)"}\n`);

  const groups = { keep: [], maybe: [], reject: [] };
  for (const row of rows.values()) {
    if (groups[row.verdict]) groups[row.verdict].push(features(row));
  }
  const liked = groups.keep.concat(groups.maybe);
  const rejected = groups.reject;

  console.log(`${rows.size} judged: ${groups.keep.length} keep, ${groups.maybe.length} maybe, ${rejected.length} reject\n`);
  if (liked.length < 5) {
    console.log("too few kept designs to say anything. Review more first.");
    return;
  }

  const names = Object.keys(liked[0]);
  console.log("feature          liked    rejected    lift");
  console.log("".padEnd(46, "-"));
  const lifts = [];
  for (const name of names) {
    const a = stats(liked.map((row) => row[name]));
    const b = stats(rejected.map((row) => row[name]));
    // How far apart the two averages are, in units of the rejected spread, so
    // features on different scales can be put in one list.
    const spread = Math.sqrt(rejected.reduce((total, row) =>
      total + Math.pow(row[name] - b.mean, 2), 0) / rejected.length) || 1;
    const lift = (a.mean - b.mean) / spread;
    lifts.push({ name, lift, liked: a.mean, rejected: b.mean });
  }
  lifts.sort((first, second) => Math.abs(second.lift) - Math.abs(first.lift));
  for (const row of lifts) {
    console.log(
      row.name.padEnd(15),
      row.liked.toFixed(2).padStart(7),
      row.rejected.toFixed(2).padStart(9),
      (row.lift > 0 ? "+" : "") + row.lift.toFixed(2).padStart(7)
    );
  }

  console.log("\nshare of designs with the trait:");
  for (const name of ["stepped", "symmetric"]) {
    const likedShare = liked.filter((row) => row[name]).length / liked.length;
    const rejectedShare = rejected.filter((row) => row[name]).length / rejected.length;
    console.log(`  ${name.padEnd(12)} liked ${(likedShare * 100).toFixed(0)}%   rejected ${(rejectedShare * 100).toFixed(0)}%`);
  }

  console.log("\nheight zones (how many clearly different heights the silhouette has):");
  for (let zones = 1; zones <= 4; zones += 1) {
    const likedShare = liked.filter((row) => row.heightZones === zones).length / liked.length;
    const rejectedShare = rejected.filter((row) => row.heightZones === zones).length / rejected.length;
    console.log(`  ${zones}  liked ${(likedShare * 100).toFixed(0).padStart(3)}%   rejected ${(rejectedShare * 100).toFixed(0).padStart(3)}%`);
  }
}

main();

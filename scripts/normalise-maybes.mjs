#!/usr/bin/env node
/**
 * Even out the spacing in the designs that survived review.
 *
 *   node scripts/normalise-maybes.mjs
 *   node scripts/normalise-maybes.mjs --include keep,maybe --out data/design-lab/corpora/kept-normalised.json
 *
 * A unit standing in the gap under a bridging span lands wherever the socket
 * grid allowed, which is hard against one side of the gap. That reads as a
 * mistake rather than a decision, and it is the same mistake in every design
 * that has one. `engine.normaliseSpacing` evens the gaps in a run out, moving
 * each unit's stack with it and leaving the ends where they are.
 *
 * The result is written as a corpus of its own rather than over the review
 * record. Evening the spacing changes the design, so it changes the design's
 * identity, and a verdict belongs to the shelf it was given to — overwriting
 * would quietly restate what was judged. Open it in the lab with
 * `design-lab.html?corpus=/data/design-lab/corpora/maybes-normalised.json`, or
 * hand it to scripts/export-for-render.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ROOT, engine, loadCatalog, canonicalKey, dimensions, shelfDimensions,
  shareHash, builderUrl, priceOf, moduleCounts
} from "./lib/design-lab.mjs";
import { violations } from "./lib/design-rules.mjs";

function parseArgs(argv) {
  const args = {
    verdicts: "data/design-lab/verdicts.jsonl",
    out: "data/design-lab/corpora/maybes-normalised.json",
    include: ["keep", "maybe"]
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--verdicts") { args.verdicts = value; i += 1; }
    else if (argv[i] === "--out") { args.out = value; i += 1; }
    else if (argv[i] === "--include") { args.include = value.split(",").map((word) => word.trim()); i += 1; }
  }
  return args;
}

/**
 * Even out every run in the design that can be evened out.
 *
 * Repeated because a design can have more than one run — an L-shape has two —
 * and each pass returns the first one it finds. It settles when nothing is
 * offered, which is the same condition the button in the sheet uses.
 */
function normaliseAll(catalog, state) {
  let current = state;
  let passes = 0;
  const before = violations(catalog, state).length;

  for (let pass = 0; pass < 12; pass += 1) {
    const next = engine.normaliseSpacing(catalog, current);
    // Either nothing left to even out, or the result would be illegal. Both
    // mean stop; neither means try the same thing again.
    if (!next) break;
    /*
     * Evening the gaps can push a free end unit out of contact with the rest,
     * which reads as two pieces of furniture standing near each other -- worse
     * than the uneven spacing it set out to fix. A person pressing the button
     * in the builder sees that happen and can undo it; a batch cannot, so a
     * pass that makes a design worse is thrown away rather than banked.
     */
    if (violations(catalog, next).length > before) break;
    current = next;
    passes += 1;
  }
  return { state: current, passes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();

  const file = path.isAbsolute(args.verdicts) ? args.verdicts : path.join(ROOT, args.verdicts);
  const rows = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.design) rows.set(row.fingerprint, row);
  }

  const wanted = [...rows.values()].filter((row) => args.include.includes(row.verdict));
  const designs = [];
  const unchanged = [];

  for (const row of wanted) {
    const original = engine.deserializeState(catalog, row.design);
    const { state, passes } = normaliseAll(catalog, original);
    if (!passes) {
      unchanged.push(row.code);
      continue;
    }
    const key = canonicalKey(catalog, state);
    const price = priceOf(catalog, state);
    designs.push({
      code: engine.designCode(state),
      fingerprint: crypto.createHash("sha1").update(key).digest("hex").slice(0, 16),
      normalisedFrom: row.code,
      runsEvened: passes,
      verdict: row.verdict,
      note: row.note || "",
      shareHash: shareHash(state),
      url: builderUrl(state),
      sizeMm: dimensions(catalog, state),
      shelfSizeMm: shelfDimensions(catalog, state),
      pieceCount: state.instances.length,
      moduleCounts: moduleCounts(state),
      totalKsh: price.totalKsh,
      unpricedPieces: price.unpricedPieces,
      breaksRules: violations(catalog, state).map((breach) => breach.rule),
      // What was already wrong with it. Some of these designs were judged
      // before the later rules existed, and a fault this script did not cause
      // is not a fault this script should be blamed for.
      brokeRulesBefore: violations(catalog, original).map((breach) => breach.rule),
      design: engine.serializeState(state)
    });
  }

  const outPath = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    schema: "framework-design-corpus@1",
    generatedAt: new Date().toISOString(),
    seed: "normalised",
    finish: "sage",
    source: args.verdicts,
    included: args.include,
    contract: catalog.contract || null,
    designs
  }, null, 1));

  /*
   * The improved design goes into the review record too, as a NEW row carrying
   * the same verdict and naming the one it supersedes.
   *
   * Not as an edit of the original: a verdict belongs to the shelf it was given
   * to, and rewriting it would quietly restate what was judged. As a new row it
   * is additive — the original is still there, still says what it said — and
   * the bench can prefer the newer one, which is what "I am not seeing the
   * normalised spacing in my maybes" was asking for.
   */
  const record = path.isAbsolute(args.verdicts) ? args.verdicts : path.join(ROOT, args.verdicts);
  const known = new Set();
  for (const line of fs.readFileSync(record, "utf8").split("\n")) {
    if (!line.trim()) continue;
    known.add(JSON.parse(line).fingerprint);
  }
  const added = designs.filter((design) => !known.has(design.fingerprint));
  if (added.length) {
    fs.appendFileSync(record, added.map((design) => JSON.stringify({
      fingerprint: design.fingerprint,
      code: design.code,
      verdict: design.verdict,
      note: design.note,
      at: new Date().toISOString(),
      supersedes: design.normalisedFrom,
      sizeMm: design.sizeMm,
      shelfSizeMm: design.shelfSizeMm,
      pieceCount: design.pieceCount,
      moduleCounts: design.moduleCounts,
      totalKsh: design.totalKsh,
      url: design.url,
      design: design.design
    })).join("\n") + "\n");
  }

  console.log(`${wanted.length} judged ${args.include.join("/")}`);
  console.log(`  ${designs.length} had spacing to even out`);
  console.log(`  ${unchanged.length} were already even, had one gap size, or could not be evened without spoiling them`);
  const introduced = designs.filter((design) =>
    design.breaksRules.some((rule) => !design.brokeRulesBefore.includes(rule)));
  const inherited = designs.filter((design) =>
    design.breaksRules.length && !introduced.includes(design));
  if (introduced.length) {
    console.log(`  ${introduced.length} break a rule that evening them out CAUSED: ` +
      introduced.map((design) => `${design.code} (${design.breaksRules.join(", ")})`).join(", "));
  }
  if (inherited.length) {
    console.log(`  ${inherited.length} already broke a rule before, and still do: ` +
      inherited.map((design) => `${design.normalisedFrom} (${design.breaksRules.join(", ")})`).join(", "));
  }
  console.log(`  ${added.length} added to the review record, superseding the originals`);
  console.log(`\n-> ${path.relative(ROOT, outPath)}`);
  console.log(`   design-lab.html?corpus=/${path.relative(ROOT, outPath)}`);
}

main();

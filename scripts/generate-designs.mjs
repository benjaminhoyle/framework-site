#!/usr/bin/env node
/**
 * Generate a corpus of shelf designs for review.
 *
 *   node scripts/generate-designs.mjs --count 200
 *   node scripts/generate-designs.mjs --count 500 --seed 7 --out data/design-lab/corpus.json
 *   node scripts/generate-designs.mjs --count 60 --brief kids-room-grows
 *
 * `--brief <name>` reads ../framework-marketing/briefs/<name>.md and takes its
 * `design` block (height_mm_max, width_mm: [min, max], colours, and the like)
 * as constraints on top of everything below. Random is the default.
 *
 * Designs are grown piece by piece through the builder's own placement engine,
 * with Advanced's rules (every module, and the gapped base spacing that
 * bridging spans need), so what comes out is buildable and opens in /builder.
 *
 * Four things are excluded, in this order, because each is cheaper than the
 * next: anything that leaves the envelope, anything with fewer than two base
 * units, anything the simplified designer could already have made, and anything
 * the corpus already holds, including the same shelf turned or mirrored.
 *
 * The generator is deliberately not clever about what looks good. It is a
 * source of legal variety; judgement happens at review.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ROOT, engine, loadCatalog, mulberry32, pick, pickWeighted, shuffled,
  canonicalKey, dimensions, shelfDimensions, fitsEnvelope, shareHash, builderUrl,
  priceOf, moduleCounts, plainRunKeys
} from "./lib/design-lab.mjs";
import { placementViolation, repair, violations, DEFAULTS as RULE_DEFAULTS } from "./lib/design-rules.mjs";
import { compose } from "./lib/design-motifs.mjs";
import { loadBrief, designConstraints } from "./lib/briefs.mjs";

/*
 * A wall's worth of shelf, under a low ceiling.
 *
 * Wider and deeper than the brief's first figures, for two measured reasons.
 * Depth: a corner turn is about 1.24m front to back for a standard unit, so at
 * 1m only the shortest trimmed cut could complete one and corners were being
 * excluded by arithmetic rather than by judgement. Width: a real design from
 * the builder (two towers, an adapter bridging their inner posts, boosters
 * staggering the storeys above) measures 3266mm, and at 3000 the generator
 * could not have produced it even in principle.
 */
const DEFAULT_ENVELOPE = { widthMm: 3600, heightMm: 1900, depthMm: 1300 };

/**
 * A design's recipe: the handful of dials that decide what kind of shelf this
 * one is going to be, rolled once per design and then held. Rolling them per
 * design rather than per piece is what stops the corpus converging on one
 * average shelf: a run of tall narrow towers and a run of long low benches
 * both come out of the same loop.
 */
function rollRecipe(random, envelope) {
  // Not always filling the envelope is a requirement, not an accident: a corpus
  // where every design is 3m wide is a corpus of one idea. The floor is not
  // arbitrary: below about 1.3m no two bases fit side by side, and a target
  // that can only hold one unit can only produce the stack the brief excludes.
  const widthMm = Math.round(envelope.widthMm * (0.45 + random() * 0.55));
  const heightMm = Math.round(envelope.heightMm * (0.25 + random() * 0.75));
  return {
    envelope: { widthMm, heightMm, depthMm: envelope.depthMm },
    familyCount: random() < 0.55 ? 1 : random() < 0.8 ? 2 : 3,
    baseCount: 2 + Math.floor(random() * 5),
    gapAppetite: random() < 0.45 ? 0 : random(),
    cornerChance: random() < 0.15 ? 0.5 : 0,
    buildUpSteps: 6 + Math.floor(random() * 28),
    lampChance: random() < 0.25 ? 1 : 0,
    roleWeights: {
      extension: 3 + random() * 6,
      spacer: random() * 3,
      hanger: random() * 2.5,
      // "Sparingly if at all": most recipes want none at all, and the ones that
      // do are still allowed only the one that survives the repair pass.
      top_bar: random() < 0.75 ? 0 : random() * 0.8,
      adapter: random() * 2,
      booster: random() * 1.5,
      booster_adapter: random() * 1.5,
      base: random() * 1.5
    }
  };
}

function modulesByRole(catalog) {
  const byRole = new Map();
  for (const module of Object.values(catalog.modules)) {
    if (!byRole.has(module.role)) byRole.set(module.role, []);
    byRole.get(module.role).push(module);
  }
  return byRole;
}

/**
 * Apply a candidate only if the result still fits. Measuring after the fact is
 * the only honest test (a piece's contribution to the outside dimensions
 * depends on what it landed on), and states are cloned on every add, so the
 * rejected branch costs nothing but the clone.
 */
function tryApply(catalog, state, candidate, envelope, fields, rules) {
  let next;
  try {
    next = engine.applyCandidate(catalog, state, candidate, fields);
  } catch {
    return null;
  }
  if (!fitsEnvelope(dimensions(catalog, next), envelope)) return null;
  // The sensibleness rules, asked at the point of choice rather than at the
  // end. A corner against a corner is wrong the moment it lands, and finding
  // that out twenty pieces later means throwing away the twenty as well.
  const added = next.instances[next.instances.length - 1];
  if (added && placementViolation(catalog, next, added.id, rules)) return null;
  return next;
}

/**
 * Place the bases. Gapped intervals are the ones Advanced adds over Standard,
 * so which of them a design uses is the difference between a solid bank of
 * units and a run with air in it; `gapAppetite` is that dial. Which candidates
 * count as gapped is asked of the engine (the adjacent-only set is exactly the
 * spacing Standard would have offered) rather than recomputed from intervals
 * here, where it would drift.
 */
function placeBases(catalog, random, recipe, families) {
  let state = engine.createState(catalog, { finish: recipe.finish, bookends: 0 });
  const baseIds = families.flatMap((family) =>
    Object.values(catalog.modules)
      .filter((module) => module.role === "base" && module.family === family)
      .map((module) => module.id));
  if (!baseIds.length) return null;

  for (let placed = 0; placed < recipe.baseCount; placed += 1) {
    const moduleId = pick(random, baseIds);
    let candidates;
    try {
      candidates = engine.generateCandidates(catalog, state, moduleId, {});
    } catch {
      continue;
    }
    if (!candidates.length) continue;

    let adjacent = new Set();
    if (state.instances.length) {
      try {
        adjacent = new Set(engine.generateCandidates(catalog, state, moduleId, { adjacentBasesOnly: true })
          .map((candidate) => `${candidate.originWorldMm[0]},${candidate.originWorldMm[1]},${candidate.rotationDeg || 0}`));
      } catch { /* fall back to treating everything as adjacent */ }
    }

    const ordered = shuffled(random, candidates);
    const wantGap = random() < recipe.gapAppetite;
    ordered.sort((a, b) => {
      const aGapped = !adjacent.has(`${a.originWorldMm[0]},${a.originWorldMm[1]},${a.rotationDeg || 0}`);
      const bGapped = !adjacent.has(`${b.originWorldMm[0]},${b.originWorldMm[1]},${b.rotationDeg || 0}`);
      if (aGapped === bGapped) return 0;
      return (aGapped === wantGap ? -1 : 1);
    });

    let applied = null;
    for (const candidate of ordered) {
      applied = tryApply(catalog, state, candidate, recipe.envelope, null, recipe.rules);
      if (applied) break;
    }
    if (applied) state = applied;
  }
  return state;
}

/** Which families the design already has on the floor. */
function familiesInPlay(catalog, state) {
  const families = new Set();
  for (const instance of state.instances) {
    const module = catalog.modules[instance.moduleId];
    if (module && module.family) families.add(module.family);
  }
  return families;
}

/**
 * Stack, hang and bridge on top of the bases until the design stops growing.
 *
 * Modules are drawn from the families already standing, most of the time. A
 * uniformly random extension almost always names a family the design does not
 * contain, has nothing to sit on, and spends a step doing nothing -- which is
 * what held the first corpus down to a couple of pieces and half a metre. The
 * occasional out-of-family draw is left in on purpose: it is where a design
 * lands a slim shelf on a broad run, which is the sort of thing worth seeing.
 */
function buildUp(catalog, random, recipe, byRole, state) {
  const roles = Object.keys(recipe.roleWeights).filter((role) => byRole.has(role));
  let stalled = 0;

  for (let step = 0; step < recipe.buildUpSteps && stalled < 12; step += 1) {
    const role = pickWeighted(random, roles, (name) => recipe.roleWeights[name]);
    if (!role) break;
    const standing = familiesInPlay(catalog, state);
    const options = byRole.get(role);
    const inFamily = options.filter((module) => !module.family || standing.has(module.family));
    const module = pick(random, inFamily.length && random() < 0.85 ? inFamily : options);
    let candidates;
    try {
      candidates = engine.generateCandidates(catalog, state, module.id, {});
    } catch {
      stalled += 1;
      continue;
    }
    if (!candidates.length) {
      stalled += 1;
      continue;
    }
    let applied = null;
    for (const candidate of shuffled(random, candidates)) {
      applied = tryApply(catalog, state, candidate, recipe.envelope, null, recipe.rules);
      if (applied) break;
    }
    if (applied) {
      state = applied;
      stalled = 0;
    } else {
      stalled += 1;
    }
  }
  return state;
}

function addLamp(catalog, random, recipe, state) {
  if (!recipe.lampChance || !catalog.modules.lamp) return state;
  let candidates;
  try {
    candidates = engine.generateCandidates(catalog, state, "lamp", {});
  } catch {
    return state;
  }
  if (!candidates.length) return state;
  const applied = tryApply(catalog, state, pick(random, candidates), recipe.envelope, { rotationDeg: 0 }, recipe.rules);
  return applied || state;
}

/** The narrowest base any of these families offers. */
function narrowestBaseMm(catalog, families) {
  let narrowest = Infinity;
  for (const module of Object.values(catalog.modules)) {
    if (module.role !== "base" || !families.includes(module.family)) continue;
    const width = (module.dimensionsMm || [])[0];
    if (width != null && width < narrowest) narrowest = width;
  }
  return narrowest;
}

function generateOne(catalog, random, envelope, finish, byRole, families, rules, floor) {
  const recipe = rollRecipe(random, envelope);
  aimAbove(recipe.envelope, floor);
  recipe.finish = finish;
  recipe.rules = rules;
  const chosen = shuffled(random, families).slice(0, recipe.familyCount);
  // A width target rolled before the family is known can be one that family's
  // base does not fit twice into, and a run of one unit is the stack the brief
  // excludes -- the attempt is spent before it starts. Raise the target to hold
  // two of the narrowest chosen base, or give up if the real envelope cannot.
  const pair = narrowestBaseMm(catalog, chosen) * 2 + 60;
  if (pair > envelope.widthMm) return null;
  recipe.envelope.widthMm = Math.max(recipe.envelope.widthMm, Math.ceil(pair));
  let state = placeBases(catalog, random, recipe, chosen);
  if (!state) return null;
  state = buildUp(catalog, random, recipe, byRole, state);
  state = addLamp(catalog, random, recipe, state);
  // Whether a riser was pointless, or an adapter's joint went unused, can only
  // be told once nothing more is going to land on them. Repairing beats
  // rejecting: the arrangement that made the design worth looking at survives,
  // and only the mistake in it goes.
  return repair(catalog, state, rules);
}

/**
 * A design built out of motifs rather than out of random legal moves.
 *
 * The envelope is still rolled per design, and for the same reason (a corpus
 * where every shelf is 3m wide is a corpus of one idea), but everything inside
 * it is a deliberate gesture rather than a walk. Which motifs were actually
 * used is kept on the record, so the review can be asked later which gestures
 * are worth making.
 */
function composeOne(catalog, random, envelope, finish, rules, floor) {
  const target = {
    widthMm: Math.round(envelope.widthMm * (0.45 + random() * 0.55)),
    heightMm: Math.round(envelope.heightMm * (0.35 + random() * 0.65)),
    depthMm: envelope.depthMm
  };
  aimAbove(target, floor);
  const state = compose(catalog, random, target, finish, rules);
  const repaired = repair(catalog, state, rules);
  repaired.motifs = state.motifs;
  return repaired;
}

/**
 * A brief can ask for a shelf no narrower or lower than so much. A target
 * rolled below that would spend the attempt on a design the brief refuses,
 * so the roll is lifted to the floor first. The ceiling is the envelope's.
 */
function aimAbove(target, floor) {
  if (!floor) return;
  if (floor.widthMinMm) target.widthMm = Math.max(target.widthMm, floor.widthMinMm);
  if (floor.heightMinMm) target.heightMm = Math.max(target.heightMm, floor.heightMinMm);
}

/**
 * What a brief's design block refuses, over and above the rules. The width is
 * the shelf's longer side on the floor, because a corner design's run along
 * the wall is whichever leg is longer; the height leaves the lamp out, as the
 * quoted size does.
 */
function briefRejection(catalog, state, constraints) {
  if (!constraints) return null;
  const size = shelfDimensions(catalog, state);
  const alongWall = Math.max(size.widthMm, size.depthMm);
  if (constraints.widthMinMm && alongWall < constraints.widthMinMm) return "brief:too-narrow";
  if (constraints.widthMaxMm && alongWall > constraints.widthMaxMm) return "brief:too-wide";
  if (constraints.heightMinMm && size.heightMm < constraints.heightMinMm) return "brief:too-low";
  if (constraints.heightMaxMm && size.heightMm > constraints.heightMaxMm) return "brief:too-tall";
  if (constraints.piecesMax && state.instances.length > constraints.piecesMax) return "brief:too-many-pieces";
  return null;
}

// --------------------------------------------------------------------- rules

function baseCount(catalog, state) {
  return state.instances.filter((instance) => {
    const module = catalog.modules[instance.moduleId];
    return module && module.role === "base";
  }).length;
}

/**
 * Everything the corpus refuses, with the reason kept, because a run that
 * rejects 90% of what it makes is telling you which dial is wrong and a bare
 * count is not.
 */
function rejectionOf(catalog, state, envelope, plainRuns, seen, minPieces, rules) {
  if (!state || !state.instances.length) return "empty";
  if (!fitsEnvelope(dimensions(catalog, state), envelope)) return "envelope";
  if (baseCount(catalog, state) < 2) return "single-unit-or-stack";
  // Two bases with a gap between them is not a plain run and so survives the
  // check below, but nobody needs it drawn to know what it looks like. A design
  // earns its place in the review queue by having something on top of the
  // floor units: enough pieces to be worth a look, and more than one kind.
  if (state.instances.length < minPieces) return "too-few-pieces";
  const roles = new Set(state.instances.map((instance) => (catalog.modules[instance.moduleId] || {}).role));
  if (roles.size < 2) return "one-kind-of-piece";
  const validation = engine.validateState(catalog, state);
  if (!validation.isValid) return `invalid:${validation.reasons.join("+")}`;
  // What repair could not fix is structural -- a corner against a corner, a
  // stack of mixed cuts -- and correcting it would be a different design rather
  // than this one put right.
  const broken = violations(catalog, state, rules);
  if (broken.length) return `rule:${broken[0].rule}`;
  const key = canonicalKey(catalog, state);
  if (plainRuns.has(key)) return "plain-run";
  if (seen.has(key)) return "duplicate";
  return null;
}

// ---------------------------------------------------------------------- main

function parseArgs(argv) {
  const args = { count: 200, seed: 1, finish: "sage", minPieces: 4, maxDisplayBars: 1, consistentTrim: true, mustBeConnected: true, motifs: true, out: "data/design-lab/corpus.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--count") { args.count = Number(value); i += 1; }
    else if (flag === "--seed") { args.seed = Number(value); i += 1; }
    else if (flag === "--finish") { args.finish = value; i += 1; }
    else if (flag === "--out") { args.out = value; i += 1; }
    else if (flag === "--width") { args.widthMm = Number(value); i += 1; }
    else if (flag === "--height") { args.heightMm = Number(value); i += 1; }
    else if (flag === "--depth") { args.depthMm = Number(value); i += 1; }
    else if (flag === "--min-pieces") { args.minPieces = Number(value); i += 1; }
    else if (flag === "--max-display-bars") { args.maxDisplayBars = Number(value); i += 1; }
    else if (flag === "--mixed-trim") { args.consistentTrim = false; }
    else if (flag === "--allow-clumps") { args.mustBeConnected = false; }
    else if (flag === "--random-walk") { args.motifs = false; }
    else if (flag === "--brief") { args.brief = value; i += 1; }
  }
  return args;
}

/**
 * A brief's `design` block, as constraints on top of the rules: the envelope
 * shrinks to its maxima, its minima refuse what falls short, and its colours
 * are drawn per design. Random stays the default; this only runs for --brief.
 */
function briefFor(args, catalog) {
  if (!args.brief) return null;
  const brief = loadBrief(args.brief);
  if (!brief) {
    console.error(`no brief named ${args.brief} in ../framework-marketing/briefs`);
    process.exit(1);
  }
  const finishIds = (catalog.finishes || []).map((finish) => finish.id);
  const constraints = designConstraints(brief, finishIds);
  const asked = brief.design && (brief.design.colours || brief.design.colors || brief.design.finishes);
  if (asked && !constraints.colours) {
    console.error(`the brief ${brief.name} names colours the catalogue does not have (${[].concat(asked).join(", ")}); it has ${finishIds.join(", ")}`);
    process.exit(1);
  }
  return { name: brief.name, constraints };
}

/**
 * The plain-run identities take half a minute to build and only change when the
 * catalogue does, so they are cached against the catalogue's contract hash. A
 * new contract invalidates the cache by not matching it.
 */
function plainRunCache(catalog) {
  const cachePath = path.join(ROOT, "data/design-lab/plain-runs.json");
  const stamp = (catalog.contract && catalog.contract.contentHash) || "unknown";
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (cached.contentHash === stamp) return new Set(cached.keys);
    } catch { /* rebuild below */ }
  }
  const keys = plainRunKeys(catalog);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ contentHash: stamp, keys: [...keys] }));
  return keys;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const brief = briefFor(args, catalog);
  const constraints = brief ? brief.constraints : null;
  const envelope = {
    widthMm: args.widthMm || DEFAULT_ENVELOPE.widthMm,
    heightMm: args.heightMm || DEFAULT_ENVELOPE.heightMm,
    depthMm: args.depthMm || DEFAULT_ENVELOPE.depthMm
  };
  if (constraints) {
    if (constraints.widthMaxMm) envelope.widthMm = Math.min(envelope.widthMm, constraints.widthMaxMm);
    if (constraints.heightMaxMm) envelope.heightMm = Math.min(envelope.heightMm, constraints.heightMaxMm);
    if (constraints.depthMaxMm) envelope.depthMm = Math.min(envelope.depthMm, constraints.depthMaxMm);
    if (constraints.piecesMin) args.minPieces = Math.max(args.minPieces, constraints.piecesMin);
    process.stderr.write(`brief ${brief.name}: ${JSON.stringify(constraints)}\n`);
  }
  // One colour for the corpus, or the brief's few, drawn per design.
  const finishes = constraints && constraints.colours ? constraints.colours : [args.finish];

  process.stderr.write("building the plain-run exclusion set... ");
  const plainRuns = plainRunCache(catalog);
  process.stderr.write(`${plainRuns.size} identities\n`);

  const random = mulberry32(args.seed);
  const byRole = modulesByRole(catalog);
  const families = [...new Set(Object.values(catalog.modules)
    .filter((module) => module.role === "base")
    .map((module) => module.family))];

  const rules = Object.assign({}, RULE_DEFAULTS, {
    maxDisplayBars: args.maxDisplayBars,
    consistentTrimInStack: args.consistentTrim,
    mustBeConnected: args.mustBeConnected
  });

  const seen = new Set();
  const designs = [];
  const rejected = {};
  // Enough attempts to reach the target without spinning forever when the
  // envelope is too small to hold `count` distinct designs at all.
  const maxAttempts = args.count * 40;
  let attempts = 0;

  while (designs.length < args.count && attempts < maxAttempts) {
    attempts += 1;
    let state = null;
    const finish = finishes.length === 1 ? finishes[0] : pick(random, finishes);
    try {
      state = args.motifs
        ? composeOne(catalog, random, envelope, finish, rules, constraints)
        : generateOne(catalog, random, envelope, finish, byRole, families, rules, constraints);
    } catch (error) {
      rejected.threw = (rejected.threw || 0) + 1;
      continue;
    }
    const reason = rejectionOf(catalog, state, envelope, plainRuns, seen, args.minPieces, rules)
      || briefRejection(catalog, state, constraints);
    if (reason) {
      rejected[reason] = (rejected[reason] || 0) + 1;
      continue;
    }
    const key = canonicalKey(catalog, state);
    seen.add(key);
    const size = dimensions(catalog, state);
    const price = priceOf(catalog, state);
    designs.push({
      code: engine.designCode(state),
      motifs: state.motifs || null,
      fingerprint: crypto.createHash("sha1").update(key).digest("hex").slice(0, 16),
      shareHash: shareHash(state),
      url: builderUrl(state),
      sizeMm: size,
      shelfSizeMm: shelfDimensions(catalog, state),
      pieceCount: state.instances.length,
      baseCount: baseCount(catalog, state),
      moduleCounts: moduleCounts(state),
      totalKsh: price.totalKsh,
      unpricedPieces: price.unpricedPieces,
      design: engine.serializeState(state)
    });
    if (designs.length % 25 === 0) process.stderr.write(`  ${designs.length}/${args.count}\n`);
  }

  const outPath = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    schema: "framework-design-corpus@1",
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    // One colour for the whole corpus, or null when a brief drew from several.
    finish: finishes.length === 1 ? finishes[0] : null,
    finishes,
    brief: brief ? brief.name : null,
    briefDesign: constraints,
    minPieces: args.minPieces,
    generator: args.motifs ? "motifs" : "random-walk",
    rules,
    envelopeMm: envelope,
    contract: catalog.contract || null,
    attempts,
    rejected,
    designs
  }, null, 1));

  /*
   * A copy that is never overwritten, named for what made it. Belt and braces
   * now that a verdict carries its own design, but cheap: regenerating over
   * corpus.json is the most ordinary thing anyone does here, and it once took
   * three hundred reviewed designs with it.
   */
  const stamp = ((catalog.contract && catalog.contract.contentHash) || "nocontract").slice(0, 8);
  const archive = path.join(ROOT, "data/design-lab/corpora",
    `seed${args.seed}-${stamp}${brief ? `-${brief.name}` : ""}.json`);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.copyFileSync(outPath, archive);

  console.log(`${designs.length} designs in ${attempts} attempts -> ${path.relative(ROOT, outPath)}`);
  console.log(`  archived as ${path.relative(ROOT, archive)}`);
  const reasons = Object.entries(rejected).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of reasons) console.log(`  rejected ${String(count).padStart(6)}  ${reason}`);
}

main();

/**
 * Designs built out of moves rather than pieces.
 *
 * The random generator picks a legal piece and puts it somewhere legal, which
 * produces legal noise. Furniture has structure a piece-at-a-time walk cannot
 * reach — a run that steps down, a pair of towers with a shelf bridging them, a
 * bay left open — because those are properties of the whole, and each random
 * piece is as likely to spoil one as to build it.
 *
 * So the unit of generation here is a **motif**: a small, complete, deliberate
 * gesture. A design is two or three of them placed left to right. Coherence
 * comes from the motif; the surprise comes from which ones get combined, at
 * what sizes, in what order.
 *
 * Every motif still goes through the placement engine and the rules — nothing
 * here knows where a socket is, and nothing here may break a rule the bench
 * laid down. A motif that cannot place what it wanted returns what it had.
 */

import { engine } from "./design-lab.mjs";
import { placementViolation } from "./design-rules.mjs";
import { dimensions, fitsEnvelope, pick, shuffled } from "./design-lab.mjs";

// -------------------------------------------------------------- placement ---

/** Apply a candidate if it fits the envelope and breaks no rule. */
function accept(ctx, state, candidate, fields) {
  let next;
  try {
    next = engine.applyCandidate(ctx.catalog, state, candidate, fields);
  } catch {
    return null;
  }
  if (!fitsEnvelope(dimensions(ctx.catalog, next), ctx.envelope)) return null;
  const added = next.instances[next.instances.length - 1];
  if (added && placementViolation(ctx.catalog, next, added.id, ctx.rules)) return null;
  return next;
}

/**
 * Put a base down at the right-hand end.
 *
 * `gap` asks for one of the spaced intervals Advanced offers rather than a
 * butted one — the spacing a bridge is meant to land on. Which candidates count
 * as butted is asked of the engine, by taking the set it offers under
 * Standard's rules, rather than recomputed from the intervals here.
 */
function addBase(ctx, state, moduleId, { gap = false } = {}) {
  let candidates;
  try {
    candidates = engine.generateCandidates(ctx.catalog, state, moduleId, {});
  } catch {
    return null;
  }
  if (!candidates.length) return null;
  if (!state.instances.length) return accept(ctx, state, candidates[0]);

  let butted = new Set();
  try {
    butted = new Set(engine.generateCandidates(ctx.catalog, state, moduleId, { adjacentBasesOnly: true })
      .map((candidate) => candidate.originWorldMm.join(",")));
  } catch { /* treat everything as butted */ }

  const wanted = candidates.filter((candidate) => {
    const isButted = butted.has(candidate.originWorldMm.join(","));
    return gap ? !isButted : isButted;
  });
  // Grow rightwards, so a composition reads left to right the way it was built.
  const ordered = (wanted.length ? wanted : candidates)
    .filter((candidate) => candidate.originWorldMm[0] >= 0)
    .sort((a, b) => a.originWorldMm[0] - b.originWorldMm[0]);
  for (const candidate of ordered) {
    const next = accept(ctx, state, candidate);
    if (next) return next;
  }
  return null;
}

/** Every instance sitting in the same stack as `baseId`. */
function stackIds(state, baseId) {
  const ids = new Set([baseId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const instance of state.instances) {
      if (ids.has(instance.id)) continue;
      const on = instance.placement && instance.placement.on;
      const supports = on ? (Array.isArray(on) ? on : [on]) : [];
      if (supports.some((id) => ids.has(id))) {
        ids.add(instance.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Put one piece on top of a named stack. */
function addOnStack(ctx, state, baseId, moduleId, fields) {
  const ids = stackIds(state, baseId);
  let candidates;
  try {
    candidates = engine.generateCandidates(ctx.catalog, state, moduleId, {});
  } catch {
    return null;
  }
  const mine = candidates.filter((candidate) => {
    const on = candidate.placement && candidate.placement.on;
    const supports = on ? (Array.isArray(on) ? on : [on]) : [];
    return supports.some((id) => ids.has(id));
  });
  if (!mine.length) return null;
  // The top of that stack, not the lowest gap somewhere else.
  const highest = mine.reduce((best, candidate) =>
    candidate.supportPlaneZ > best.supportPlaneZ ? candidate : best);
  return accept(ctx, state, highest, fields);
}

function lastBaseId(catalog, state) {
  let best = null;
  let bestX = -Infinity;
  for (const instance of state.instances) {
    if ((catalog.modules[instance.moduleId] || {}).role !== "base") continue;
    if (instance.originWorldMm[0] > bestX) {
      bestX = instance.originWorldMm[0];
      best = instance.id;
    }
  }
  return best;
}

// ------------------------------------------------------------- vocabulary ---

/** The base and extension of one family, in one cut. */
function kit(catalog, family, trimmed) {
  const of = (role) => Object.values(catalog.modules).find((module) =>
    module.family === family && module.role === role && Boolean(module.trimmed) === Boolean(trimmed));
  return {
    base: of("base"),
    extension: of("extension"),
    spacer: of("spacer"),
    hanger: of("hanger"),
    adapter: of("adapter")
  };
}

// ----------------------------------------------------------------- motifs ---

/**
 * A run: `width` units side by side, each carrying `levels - 1` shelves.
 *
 * The plain case, and on its own it is what the simplified designer already
 * makes — so it earns its place here only as one part of a composition beside
 * something of a different height.
 */
function run(ctx, state, spec) {
  const parts = kit(ctx.catalog, spec.family, spec.trimmed);
  if (!parts.base || !parts.extension) return state;
  const bases = [];
  for (let unit = 0; unit < spec.width; unit += 1) {
    const next = addBase(ctx, state, parts.base.id);
    if (!next) break;
    state = next;
    bases.push(lastBaseId(ctx.catalog, state));
  }
  for (const baseId of bases) {
    for (let level = 1; level < spec.levels; level += 1) {
      const next = addOnStack(ctx, state, baseId, parts.extension.id);
      if (!next) break;
      state = next;
    }
  }
  return state;
}

/**
 * A run whose height changes across it.
 *
 * The whole point of the motif: a silhouette with more than one height in it.
 * The heights are drawn per bay rather than marched monotonically up or down —
 * a plain staircase is one idea, and the review so far has not been kinder to
 * it than to a flat run.
 */
function terrace(ctx, state, spec) {
  const parts = kit(ctx.catalog, spec.family, spec.trimmed);
  if (!parts.base || !parts.extension) return state;
  for (let unit = 0; unit < spec.width; unit += 1) {
    const next = addBase(ctx, state, parts.base.id);
    if (!next) break;
    state = next;
    const baseId = lastBaseId(ctx.catalog, state);
    const levels = spec.levels[unit % spec.levels.length];
    for (let level = 1; level < levels; level += 1) {
      const raised = addOnStack(ctx, state, baseId, parts.extension.id);
      if (!raised) break;
      state = raised;
    }
  }
  return state;
}

/**
 * A bay left open: a spacer where a shelf would be, so the gap under the next
 * shelf is a double one.
 *
 * Spacers are the strongest thing in the review record so far — the designs
 * marked "maybe" carry about half as many again as the ones rejected — which
 * makes sense, since an open bay is the only way this system makes a space big
 * enough to stand something tall in.
 */
function openBay(ctx, state, spec) {
  const parts = kit(ctx.catalog, spec.family, spec.trimmed);
  if (!parts.base || !parts.extension || !parts.spacer) return state;
  /*
   * The bay stands in a run, not on its own.
   *
   * One base carrying an open bay is a single stack, which every design has to
   * be more than — so a lone openBay was always rejected, and the hanger it
   * sometimes carried appeared once in three hundred designs. Its neighbours
   * are what let it be a design.
   */
  const width = Math.max(2, spec.width || 2);
  const bases = [];
  for (let unit = 0; unit < width; unit += 1) {
    const next = addBase(ctx, state, parts.base.id);
    if (!next) break;
    state = next;
    bases.push(lastBaseId(ctx.catalog, state));
  }
  if (!bases.length) return state;

  // The plain neighbours, at the height the bay is built up from.
  for (const neighbour of bases.slice(0, -1)) {
    for (let level = 1; level < Math.max(1, spec.below); level += 1) {
      const next = addOnStack(ctx, state, neighbour, parts.extension.id);
      if (!next) break;
      state = next;
    }
  }

  const baseId = bases[bases.length - 1];
  for (let level = 1; level < spec.below; level += 1) {
    const next = addOnStack(ctx, state, baseId, parts.extension.id);
    if (!next) break;
    state = next;
  }
  const spaced = addOnStack(ctx, state, baseId, parts.spacer.id);
  if (!spaced) return state;
  state = spaced;

  /*
   * A hanger goes straight onto the spacer, not on top of everything else.
   *
   * It is 528mm tall — taller than a shelf and a spacer together — so stacked
   * last it put the design over almost every height target and appeared in none
   * of three hundred. Landed on the spacer it is what the spacer is holding up,
   * which is what the rule asks for anyway: a hanger needs the clearance a
   * spacer makes, and a riser has to carry something that is not a fitting.
   */
  if (spec.hanger && parts.hanger) {
    const hung = addOnStack(ctx, state, baseId, parts.hanger.id);
    if (hung) return hung;
  }

  // A riser has to carry a shelf or the repair pass takes it out again.
  for (let level = 0; level < Math.max(1, spec.above); level += 1) {
    const next = addOnStack(ctx, state, baseId, parts.extension.id);
    if (!next) break;
    state = next;
  }
  return state;
}

/**
 * Two towers with a span across the gap between them.
 *
 * This is the shape the gapped base spacing exists for, and the random
 * generator reached it about twice in three hundred tries — an adapter only
 * earns its place when something lands on the middle joint, and nothing was
 * aiming at the middle joint. Here the span is the point and the towers are
 * built to suit it.
 */
function bridge(ctx, state, spec) {
  const parts = kit(ctx.catalog, spec.family, spec.trimmed);
  if (!parts.base || !parts.extension) return state;

  const first = addBase(ctx, state, parts.base.id);
  if (!first) return state;
  const left = first.instances[first.instances.length - 1];

  let butted = new Set();
  try {
    butted = new Set(engine.generateCandidates(ctx.catalog, first, parts.base.id, { adjacentBasesOnly: true })
      .map((candidate) => candidate.originWorldMm.join(",")));
  } catch { /* treat everything as butted */ }

  let gaps = [];
  try {
    gaps = engine.generateCandidates(ctx.catalog, first, parts.base.id, {})
      .filter((candidate) => !butted.has(candidate.originWorldMm.join(",")))
      .filter((candidate) => candidate.originWorldMm[0] > 0)
      .sort((a, b) => a.originWorldMm[0] - b.originWorldMm[0]);
  } catch { /* none */ }

  /*
   * Every spacing is tried, not just the first that works.
   *
   * For a 703mm family the nearest gap leaves 440mm between the inner posts,
   * which a compact shelf crosses — a real bridge, but never an adapter, because
   * adapters only come 1143mm wide. The spacing that wants an adapter is the
   * next one out. Stopping at the first spacing that admitted anything is why
   * adapters almost never appeared: the answer was always found one interval too
   * early.
   */
  const options = [];
  for (const gap of gaps) {
    let attempt = accept(ctx, first, gap);
    if (!attempt) continue;
    const right = attempt.instances[attempt.instances.length - 1];

    for (const base of [left, right]) {
      for (let level = 1; level < spec.levels; level += 1) {
        const next = addOnStack(ctx, attempt, base.id, parts.extension.id);
        if (!next) break;
        attempt = next;
      }
    }

    /*
     * The span has to cross the gap, not straddle it.
     *
     * Two towers 703mm wide standing 1143mm apart have posts at 0, 703, 1846
     * and 2989, and a 1143mm adapter fits twice over: at 0, reaching from the
     * left tower's left post to the right tower's left post and sitting mostly
     * on top of the left tower; and at 703, reaching between the two *inner*
     * posts with the whole of it over the empty gap. Only the second is a
     * bridge. The first is whichever candidate the engine happens to list
     * first, which is what this took, and it is why every generated bridge
     * joined left post to left post.
     */
    const innerLeft = left.originWorldMm[0] + (ctx.catalog.modules[left.moduleId].widthSpanMm || 0);
    const innerRight = right.originWorldMm[0];
    const needed = innerRight - innerLeft;

    const spans = Object.values(ctx.catalog.modules).filter((module) =>
      (module.role === "adapter" || module.role === "extension") && module.widthSpanMm === needed);

    for (const module of spans) {
      let candidates = [];
      try {
        candidates = engine.generateCandidates(ctx.catalog, attempt, module.id, {});
      } catch {
        continue;
      }
      for (const candidate of candidates) {
        if (Math.abs(candidate.originWorldMm[0] - innerLeft) >= 1) continue;
        if (new Set((candidate.consumedSockets || []).map((socket) => socket.instanceId)).size < 2) continue;
        options.push({ attempt, candidate, isAdapter: module.role === "adapter" });
      }
    }
  }

  // The middle joint is the reason an adapter exists, so those go first; among
  // equals the order is the caller's shuffle, not the catalogue's.
  const ordered = options.filter((option) => option.isAdapter)
    .concat(options.filter((option) => !option.isAdapter));
  for (const option of ordered) {
    const spanned = accept(ctx, option.attempt, option.candidate);
    if (!spanned) continue;
    return spec.stagger ? stagger(ctx, spanned, spec) : spanned;
  }

  // No spacing this family can cross. A tower on its own is a better answer
  // than a gap nothing bridges, which is only going to be rejected later.
  return run(ctx, first, { family: spec.family, trimmed: spec.trimmed, width: 1, levels: spec.levels });
}

/**
 * Raise one post and shelve across it, so the levels on either side no longer
 * line up.
 *
 * This is what a booster is for, and the random generator never found it: a
 * booster is a 20mm column that lifts a single post half a level, and it only
 * pays off if the next shelf then rests on the booster *and* on something else
 * at the same height. Nothing aiming at one piece at a time will place a
 * 20mm column and then find the shelf that justifies it.
 *
 * The move is therefore: put a booster on top of something, then look for a
 * shelf that lands on it together with at least one other piece. A shelf on two
 * different supports is the interlock; a shelf on the booster alone is a shelf
 * that did not need the booster.
 */
function stagger(ctx, state, spec) {
  const boosters = Object.values(ctx.catalog.modules)
    .filter((module) => module.role === "booster" || module.role === "booster_adapter");
  const shelves = Object.values(ctx.catalog.modules).filter((module) => module.role === "extension");
  if (!boosters.length) return state;

  const rounds = Math.max(1, spec.staggerRounds || 1);
  for (let round = 0; round < rounds; round += 1) {
    /*
     * The booster and the shelf have to be found together.
     *
     * A booster only pays off if its top lands level with something else, so
     * that the next shelf can rest on both — that is the interlock, and it is
     * the whole point. Picking the highest booster position and then hoping is
     * what this did first, and it never once worked: the highest spot is on top
     * of the span, where the booster's top is level with nothing at all.
     *
     * So each position is tried and kept only if a shelf actually lands across
     * it. The engine decides what lands; nothing here computes a height.
     */
    let placed = null;
    for (const booster of shuffled(ctx.random, boosters)) {
      let positions = [];
      try {
        positions = engine.generateCandidates(ctx.catalog, state, booster.id, {});
      } catch {
        continue;
      }
      // High first, so a stagger reads as the top storey rather than something
      // buried under the shelves already there.
      positions.sort((a, b) => b.supportPlaneZ - a.supportPlaneZ);

      for (const position of positions) {
        const raised = accept(ctx, state, position);
        if (!raised) continue;
        const boosterId = raised.instances[raised.instances.length - 1].id;

        for (const shelf of shelves) {
          let candidates = [];
          try {
            candidates = engine.generateCandidates(ctx.catalog, raised, shelf.id, {});
          } catch {
            continue;
          }
          const interlocking = candidates.filter((candidate) => {
            const supports = new Set((candidate.consumedSockets || []).map((socket) => socket.instanceId));
            return supports.has(boosterId) && supports.size > 1;
          });
          for (const candidate of interlocking) {
            const landed = accept(ctx, raised, candidate);
            if (landed) {
              placed = landed;
              break;
            }
          }
          if (placed) break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    // Nothing interlocked. A booster on its own is a 20mm column the repair
    // pass would take out again, so the round is dropped rather than banked.
    if (!placed) break;
    state = placed;
  }
  return state;
}

/**
 * A run that turns a corner.
 *
 * Built corner-first: place the corner, then find the turn that answers its
 * long edge, then carry on away at right angles. Reached by accident about
 * eight times in three hundred, and every one that was not answered got quietly
 * straightened by the repair pass.
 *
 * It needs depth. A turn measures about 1.24m front to back for a standard
 * unit, so inside a 1m envelope only the shortest trimmed cut can complete one.
 */
function corner(ctx, state, spec) {
  const parts = kit(ctx.catalog, spec.family, spec.trimmed);
  const cornerBase = Object.values(ctx.catalog.modules).find((module) =>
    module.family === "corner" && module.role === "base" && Boolean(module.trimmed) === Boolean(spec.trimmed));
  if (!cornerBase || !parts.base) return state;

  const withCorner = addBase(ctx, state, cornerBase.id);
  if (!withCorner) return state;
  const cornerId = lastBaseId(ctx.catalog, withCorner);

  let turned = null;
  let candidates = [];
  try {
    candidates = engine.generateCandidates(ctx.catalog, withCorner, parts.base.id, {})
      .filter((candidate) => (candidate.rotationDeg || 0) % 180 === 90);
  } catch { /* none */ }
  for (const candidate of candidates) {
    const next = accept(ctx, withCorner, candidate);
    if (!next) continue;
    if (!placementViolation(ctx.catalog, next, cornerId, ctx.rules)) {
      turned = next;
      break;
    }
  }
  // Without a turn the corner is an overhang into the room, and the repair pass
  // would straighten it anyway. Hand back what came in and let another motif
  // have the space.
  if (!turned) return state;
  state = turned;
  const turnedId = lastBaseId(ctx.catalog, state);

  for (const baseId of [cornerId, turnedId]) {
    for (let level = 1; level < spec.levels; level += 1) {
      const next = addOnStack(ctx, state, baseId, parts.extension.id);
      if (!next) break;
      state = next;
    }
  }
  return state;
}

export const MOTIFS = { run, terrace, openBay, bridge, corner, stagger };

// ------------------------------------------------------------ composition ---

function rollSpec(random, family, trimmed, tallness) {
  const levels = 1 + Math.floor(random() * tallness);
  return {
    family,
    trimmed,
    width: 1 + Math.floor(random() * 3),
    levels: Math.max(1, levels),
    below: 1 + Math.floor(random() * 2),
    above: 1 + Math.floor(random() * 2),
    hanger: random() < 0.4,
    // Most bridges get the staggered storey. It is the move that turns two
    // towers and a shelf into something worth looking at, and it is the one the
    // random generator could never reach.
    stagger: random() < 0.7,
    staggerRounds: 1 + Math.floor(random() * 3)
  };
}

/**
 * A design: two or three motifs, left to right.
 *
 * The heights are rolled per motif from a shared ceiling rather than
 * independently, so a composition tends to have a tall part and a short part
 * instead of three of the same — the one thing the review record points at with
 * any confidence.
 */
export function compose(catalog, random, envelope, finish, rules) {
  const ctx = { catalog, envelope, rules, random };
  const families = [...new Set(Object.values(catalog.modules)
    .filter((module) => module.role === "base" && module.family !== "corner")
    .map((module) => module.family))];

  const family = pick(random, families);
  const trimmed = random() < 0.4;
  const count = random() < 0.3 ? 1 : random() < 0.8 ? 2 : 3;
  const tallness = 2 + Math.floor(random() * 4);

  let state = engine.createState(catalog, { finish, bookends: 0 });
  const used = [];

  for (let index = 0; index < count; index += 1) {
    /*
     * A plain run is the one motif that cannot be a design by itself — that is
     * exactly what the simplified designer already makes, and it gets rejected
     * a few steps later for being one. It earns its place beside something of a
     * different height, so it is only ever offered as a second or third move.
     */
    const offered = Object.keys(MOTIFS).filter((name) => name !== "run" || used.length > 0);

    /*
     * Several motifs can find they have nowhere to go — a corner turn needs
     * more depth than most envelopes have, a bridge needs a spacing its family
     * can cross. Taken as a refusal that ends the design, they left a third of
     * all attempts empty. So the shuffled list is worked through until one of
     * them actually places something.
     */
    let placed = false;
    for (const name of shuffled(random, offered)) {
      // One family per design most of the time: a composition is one shelf, and
      // the mixing that makes it read as two is a different decision.
      const motifFamily = random() < 0.8 ? family : pick(random, families);
      const spec = rollSpec(random, motifFamily, trimmed, tallness);
      if (name === "terrace") {
        spec.width = 2 + Math.floor(random() * 3);
        spec.levels = Array.from({ length: spec.width }, () => 1 + Math.floor(random() * tallness));
      }
      const before = state.instances.length;
      const next = MOTIFS[name](ctx, state, spec) || state;
      if (next.instances.length > before) {
        state = next;
        used.push(name);
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }

  state.motifs = used;
  return state;
}

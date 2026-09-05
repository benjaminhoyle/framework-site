/**
 * What makes a legal shelf a sensible one.
 *
 * The placement engine answers "will this stand up". These rules answer the
 * question after it — "would anyone build this" — and they came out of looking
 * at three hundred generated designs and keeping two.
 *
 * They are stated once here and used three ways, because a rule written down
 * three times is a rule that will disagree with itself:
 *
 *   - `placementViolation` filters candidates while a design is being grown, so
 *     the generator does not spend its attempts making things it will throw
 *     away;
 *   - `repair` fixes what can only be judged once a design is finished — a
 *     riser is not pointless until nothing has landed on it;
 *   - `violations` is the check afterwards, and the one the tests assert on.
 *
 * The split between the first and the second is not stylistic. "This spacer has
 * nothing above it" is true of every spacer the moment it is placed, so it
 * cannot be a placement rule; "this corner is against another corner" is true or
 * false immediately, so it should not wait.
 */

import { engine } from "./design-lab.mjs";

const TOLERANCE_MM = 1;
const ADJACENT_GAP_MM = 30;

// Pieces whose whole purpose is to raise what sits on them.
const RISER_ROLES = new Set(["spacer", "booster", "booster_adapter"]);

export const DEFAULTS = {
  maxDisplayBars: 1,
  // Not one of the seven rules from the bench, but the commonest thing left
  // wrong after them: a design that is two clumps with air between them.
  mustBeConnected: true,
  // Left adjustable because the exceptions, if there are any, are not known
  // yet. A stack that mixes a trimmed cut with a full one is odd rather than
  // impossible, so this is the one rule expected to be relaxed one day.
  consistentTrimInStack: true
};

// --------------------------------------------------------------- the parts ---

function moduleOf(catalog, instance) {
  return catalog.modules[instance.moduleId] || {};
}

function roleOf(catalog, instance) {
  return moduleOf(catalog, instance).role;
}

function supportsOf(instance) {
  const on = instance.placement && instance.placement.on;
  if (!on) return [];
  return Array.isArray(on) ? on : [on];
}

/**
 * Is anything resting on this piece?
 *
 * The engine's own answer, read off the sockets a piece actually consumed
 * rather than off the support list a caller declared. The two agree on a design
 * the engine built, and only the first is still right about one that was edited.
 */
function carriesSomething(state, id) {
  return engine.isLoadBearing(state, id);
}

/** Roles that are fitted TO a shelf rather than being one. */
const FITTING_ROLES = new Set(["lamp", "top_bar"]);

/**
 * Is what rests on this piece worth having raised?
 *
 * A spacer under a lamp is a lamp on a stick. The riser is there so that a
 * shelf clears what is under it, so the load has to include something that is
 * not just a fitting.
 */
function carriesShelf(catalog, state, id) {
  return state.instances.some((instance) =>
    (instance.consumedSockets || []).some((socket) => socket.instanceId === id) &&
    !FITTING_ROLES.has(roleOf(catalog, instance)));
}

function byId(state, id) {
  return state.instances.find((instance) => instance.id === id) || null;
}

/**
 * The extra top sockets an adapter has and its bottom does not: the middle
 * joint, which is the only reason to choose an adapter over a plain extension
 * of the same size. Derived from the module's own sockets rather than hard-coded
 * to x=703, so a new adapter arrives with its joint already understood.
 */
export function middleSocketIds(module) {
  const bottomX = new Set((module.sockets || [])
    .filter((socket) => socket.kind === "bottom")
    .map((socket) => socket.normalized_mm[0]));
  return new Set((module.sockets || [])
    .filter((socket) => socket.kind === "top" && !bottomX.has(socket.normalized_mm[0]))
    .map((socket) => socket.id));
}

/** Does this module come in both a trimmed and a full cut? */
function trimIsMeaningful(catalog, module) {
  return Object.values(catalog.modules).some((other) =>
    other.id !== module.id &&
    other.family === module.family &&
    other.role === module.role &&
    Boolean(other.trimmed) !== Boolean(module.trimmed));
}

function stacks(catalog, state) {
  const { rootOf, groups } = engine.stacksOf(state);
  return { rootOf, groups };
}

/** Everything in the same stack as `instance`, itself included. */
function stackMates(catalog, state, instance) {
  const { rootOf, groups } = stacks(catalog, state);
  const ids = groups.get(rootOf(instance.id)) || [instance.id];
  return ids.map((id) => byId(state, id)).filter(Boolean);
}

function quarterTurn(degrees) {
  return ((Math.round((degrees || 0) / 90) * 90) % 360 + 360) % 360;
}

/** Boards overlapping along one axis and touching, or nearly, along the other. */
function boardsAdjacent(first, second) {
  const overlapX = Math.min(first[3], second[3]) - Math.max(first[0], second[0]);
  const overlapY = Math.min(first[4], second[4]) - Math.max(first[1], second[1]);
  const gapX = Math.max(0, first[0] - second[3], second[0] - first[3]);
  const gapY = Math.max(0, first[1] - second[4], second[1] - first[4]);
  return (overlapX > TOLERANCE_MM && gapY <= ADJACENT_GAP_MM + TOLERANCE_MM)
    || (overlapY > TOLERANCE_MM && gapX <= ADJACENT_GAP_MM + TOLERANCE_MM);
}

/**
 * Which way a corner unit's long edge points, as an axis and a sign.
 *
 * A corner is an ordinary unit whose shelf runs about a shelf-board longer than
 * a standard one, and that extra length is what covers the square where two
 * runs meet. Measured, not assumed: a standard base's board overhangs its
 * socket grid evenly at both ends, and a corner's overhangs by the same at one
 * end and by the board's length at the other. The long end is the one that
 * turns with the piece — +x at 0 degrees, +y at 90, and so on round.
 */
export function longEdgeOf(instance) {
  const quarter = quarterTurn(instance.rotationDeg) / 90;
  return [{ axis: 0, sign: 1 }, { axis: 1, sign: 1 }, { axis: 0, sign: -1 }, { axis: 1, sign: -1 }][quarter];
}

/**
 * Is the corner's long edge answered by this turned unit?
 *
 * Not "does it butt against it end to end", which is what a straight join looks
 * like and which no real turn satisfies. A turn is placed against the first
 * run's *shelf*: the turned unit runs away at right angles with its back flush
 * with that shelf's far edge and its near end meeting the shelf's front edge.
 * So the test is that the turned board reaches the long edge, and lies
 * alongside the corner across its depth.
 */
function answersLongEdge(board, other, axis, sign) {
  const edge = sign > 0 ? board[axis + 3] : board[axis];
  const reach = ADJACENT_GAP_MM + TOLERANCE_MM;
  if (other[axis] > edge + reach || other[axis + 3] < edge - reach) return false;
  const across = axis === 0 ? 1 : 0;
  const gap = Math.max(0, board[across] - other[across + 3], other[across] - board[across + 3]);
  return gap <= reach;
}

// ------------------------------------------------------- placement-time -----

/**
 * Why this piece must not go here — or null.
 *
 * Called with a state that already contains the candidate, so it can see the
 * piece in its context. Only rules that are decidable the moment a piece lands
 * belong here.
 */
export function placementViolation(catalog, state, instanceId, options) {
  const settings = Object.assign({}, DEFAULTS, options || {});
  const instance = byId(state, instanceId);
  if (!instance) return null;
  const module = moduleOf(catalog, instance);
  const role = module.role;

  // A corner is where a run turns. Two of them against each other is not a
  // turn, and back to back their long edges collide into a shape nobody wants.
  if (module.family === "corner" && role === "base") {
    const board = engine.boardBounds(catalog, instance);
    for (const other of state.instances) {
      if (other.id === instance.id) continue;
      const otherModule = moduleOf(catalog, other);
      if (otherModule.family !== "corner" || otherModule.role !== "base") continue;
      if (boardsAdjacent(board, engine.boardBounds(catalog, other))) {
        return { rule: "corners-adjacent", detail: `${instance.id} against ${other.id}` };
      }
    }
  }

  // A corner extension is the corner unit's shelf. It belongs over a corner
  // base, turned the same way, or its overhang hangs off nothing.
  if (module.family === "corner" && role === "extension") {
    const root = stackMates(catalog, state, instance)
      .find((mate) => roleOf(catalog, mate) === "base");
    const rootModule = root ? moduleOf(catalog, root) : null;
    if (!rootModule || rootModule.family !== "corner") {
      return { rule: "corner-extension-without-corner-base", detail: instance.id };
    }
    if (quarterTurn(root.rotationDeg) !== quarterTurn(instance.rotationDeg)) {
      return { rule: "corner-extension-turned-against-its-base", detail: instance.id };
    }
  }

  // Two boosters facing each other are a spacer, made awkwardly out of two
  // parts that then have to be aligned.
  if (role === "booster" || role === "booster_adapter") {
    const opposed = stackMates(catalog, state, instance).some((mate) => {
      if (mate.id === instance.id) return false;
      const mateRole = roleOf(catalog, mate);
      if (mateRole !== "booster" && mateRole !== "booster_adapter") return false;
      return Math.abs(quarterTurn(mate.rotationDeg) - quarterTurn(instance.rotationDeg)) === 180;
    });
    if (opposed) return { rule: "opposed-boosters-in-stack", detail: instance.id };
  }

  // A hanger needs the clearance under it that a spacer makes.
  if (role === "hanger") {
    const hasSpacer = stackMates(catalog, state, instance).some((mate) =>
      roleOf(catalog, mate) === "spacer" && mate.supportPlaneZ < instance.supportPlaneZ);
    if (!hasSpacer) return { rule: "hanger-without-spacer-below", detail: instance.id };
  }

  // The middle joint carries a shelf, not a lamp.
  if (role === "lamp") {
    for (const support of supportsOf(instance)) {
      const carrier = byId(state, support);
      if (!carrier || roleOf(catalog, carrier) !== "adapter") continue;
      const middle = middleSocketIds(moduleOf(catalog, carrier));
      const usesMiddle = (instance.consumedSockets || []).some((socket) =>
        socket.instanceId === carrier.id && middle.has(socket.socketId));
      if (usesMiddle) return { rule: "lamp-on-adapter-middle-joint", detail: instance.id };
    }
  }

  if (settings.consistentTrimInStack && trimIsMeaningful(catalog, module)) {
    const clash = stackMates(catalog, state, instance).find((mate) => {
      const mateModule = moduleOf(catalog, mate);
      return mate.id !== instance.id &&
        trimIsMeaningful(catalog, mateModule) &&
        Boolean(mateModule.trimmed) !== Boolean(module.trimmed);
    });
    if (clash) return { rule: "mixed-trim-in-stack", detail: `${instance.id} with ${clash.id}` };
  }

  return null;
}

/**
 * Does the design hang together as one thing?
 *
 * The gapped base spacing exists so that a bridge or an adapter span has
 * somewhere to land — that is the whole reason Advanced offers intervals
 * Standard does not. A gap with nothing spanning it is therefore not a design
 * decision, it is two pieces of furniture standing near each other, and it was
 * the commonest thing left wrong with a generated corpus after every other rule
 * was in.
 *
 * So: bases are joined when their boards touch, and when anything above rests
 * on both. Anything else is a separate clump.
 *
 * `engine.stacksOf` cannot answer this — it follows only a piece's first
 * support, so a shelf bridging two towers is filed under one of them — and it
 * is right not to, because what it is for is naming the stack a piece belongs
 * to rather than what the design is connected through.
 */
export function clumps(catalog, state) {
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let walk = id;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk);
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const instance of state.instances) parent.set(instance.id, instance.id);

  // Every support, not just the first: a bridge is exactly the piece that has
  // more than one, and it is the piece that makes a gap deliberate.
  for (const instance of state.instances) {
    const supports = new Set(supportsOf(instance));
    for (const socket of instance.consumedSockets || []) supports.add(socket.instanceId);
    for (const support of supports) {
      if (parent.has(support)) union(instance.id, support);
    }
  }

  const bases = state.instances.filter((instance) => roleOf(catalog, instance) === "base");
  for (let i = 0; i < bases.length; i += 1) {
    for (let j = i + 1; j < bases.length; j += 1) {
      if (boardsAdjacent(engine.boardBounds(catalog, bases[i]), engine.boardBounds(catalog, bases[j]))) {
        union(bases[i].id, bases[j].id);
      }
    }
  }

  /*
   * A unit standing under something that passes over it is part of the design,
   * whether or not it touches anything.
   *
   * Without this, evening out the spacing broke the very designs it was meant
   * to fix: the free-standing unit in a bridged gap had been counted as
   * connected only because it happened to be butted against its neighbour, and
   * moving it into the middle of the gap made it — by this rule's reckoning —
   * a second piece of furniture standing nearby. Nobody looking at the picture
   * would say that. Overlapping in plan is the test, so two towers with real
   * air between them and nothing over it still count as two.
   */
  const boxes = new Map(state.instances.map((instance) =>
    [instance.id, engine.instanceBounds(catalog, instance)]));
  for (let i = 0; i < state.instances.length; i += 1) {
    for (let j = i + 1; j < state.instances.length; j += 1) {
      const first = boxes.get(state.instances[i].id);
      const second = boxes.get(state.instances[j].id);
      const overlapX = Math.min(first[3], second[3]) - Math.max(first[0], second[0]);
      const overlapY = Math.min(first[4], second[4]) - Math.max(first[1], second[1]);
      if (overlapX > TOLERANCE_MM && overlapY > TOLERANCE_MM) {
        union(state.instances[i].id, state.instances[j].id);
      }
    }
  }

  return new Set(bases.map((base) => find(base.id))).size;
}

/**
 * Is this corner's long edge answered by something turned against it?
 *
 * A completion rule rather than a placement one, and it has to be: the first
 * corner in a design is always hanging, because the run it turns into has not
 * been built yet. Checked at placement it would make a corner unplaceable and
 * quietly delete the whole family from the corpus.
 */
export function longEdgeHangs(catalog, state, instance) {
  const module = moduleOf(catalog, instance);
  if (module.family !== "corner") return false;
  const role = module.role;
  if (role !== "base" && role !== "extension") return false;

  const { axis, sign } = longEdgeOf(instance);
  const board = engine.boardBounds(catalog, instance);
  return !state.instances.some((other) => {
    if (other.id === instance.id) return false;
    const otherModule = moduleOf(catalog, other);
    if (otherModule.role !== "base" && otherModule.role !== "extension") return false;
    if (Math.abs(quarterTurn(other.rotationDeg) - quarterTurn(instance.rotationDeg)) % 180 !== 90) return false;
    // At its own level. A corner shelf meets the turned run's shelf, and a base
    // three levels below does not stop this one hanging over the room.
    if (Math.abs(other.supportPlaneZ - instance.supportPlaneZ) > TOLERANCE_MM) return false;
    return answersLongEdge(board, engine.boardBounds(catalog, other), axis, sign);
  });
}

/** The straight unit a corner should have been: same role, same cut. */
function straightEquivalent(catalog, module) {
  return Object.values(catalog.modules).find((candidate) =>
    candidate.family === "standard" &&
    candidate.role === module.role &&
    Boolean(candidate.trimmed) === Boolean(module.trimmed)) || null;
}

// ------------------------------------------------------------ completion -----

/**
 * Everything wrong with a finished design.
 *
 * The placement rules are re-run over every piece, so a design that was built
 * without the filter — one loaded from a file, or from an older corpus — is
 * judged by the same standard as one that was.
 */
export function violations(catalog, state, options) {
  const settings = Object.assign({}, DEFAULTS, options || {});
  const found = [];

  for (const instance of state.instances) {
    const breach = placementViolation(catalog, state, instance.id, settings);
    if (breach) found.push(breach);

    const role = roleOf(catalog, instance);

    if (longEdgeHangs(catalog, state, instance)) {
      found.push({ rule: "corner-long-edge-hanging", detail: instance.id });
    }

    // A riser with nothing on it is a raised nothing -- and a riser holding
    // only a lamp or a display bar is barely more, because the point of raising
    // is the shelf that goes on top. Both are the same mistake, so both are
    // reported as one and repaired the same way.
    if (RISER_ROLES.has(role) && !carriesShelf(catalog, state, instance.id)) {
      found.push({
        rule: carriesSomething(state, instance.id) ? "riser-holding-only-a-fitting" : "riser-with-nothing-above",
        detail: instance.id
      });
    }

    // An adapter whose middle joint carries nothing is a plain extension that
    // costs more and looks busier.
    if (role === "adapter") {
      const middle = middleSocketIds(moduleOf(catalog, instance));
      const used = state.instances.some((other) =>
        (other.consumedSockets || []).some((socket) =>
          socket.instanceId === instance.id && middle.has(socket.socketId)));
      if (!used) found.push({ rule: "adapter-middle-joint-unused", detail: instance.id });
    }
  }

  if (settings.mustBeConnected && clumps(catalog, state) > 1) {
    found.push({ rule: "disconnected-clumps", detail: `${clumps(catalog, state)} separate pieces` });
  }

  const displayBars = state.instances.filter((instance) => roleOf(catalog, instance) === "top_bar").length;
  if (displayBars > settings.maxDisplayBars) {
    found.push({ rule: "too-many-display-bars", detail: `${displayBars} bars` });
  }

  return found;
}

// --------------------------------------------------------------- repair ------

/**
 * Fix what is fixable, rather than throwing the design away.
 *
 * Three of the completion rules have an obvious right answer, and two of them
 * are the answer the brief gives: a riser holding nothing comes out, and an
 * adapter whose joint is unused becomes the plain extension of the same size it
 * should have been. Both leave a design that is still recognisably the one the
 * generator made — which is the point, because rejecting instead would throw
 * away the interesting arrangement along with the mistake.
 *
 * Everything else — a corner against a corner, a stack of mixed cuts — is
 * structural, and a repair would be a different design rather than this one
 * corrected. Those are left for the caller to reject.
 */
export function repair(catalog, state, options) {
  const settings = Object.assign({}, DEFAULTS, options || {});
  let next = state;

  // An adapter carrying nothing in its middle becomes the extension of the same
  // size. Done before the pruning below, because the swap can only get simpler.
  for (const instance of next.instances.slice()) {
    if (roleOf(catalog, instance) !== "adapter") continue;
    const module = moduleOf(catalog, instance);
    const middle = middleSocketIds(module);
    const used = next.instances.some((other) =>
      (other.consumedSockets || []).some((socket) =>
        socket.instanceId === instance.id && middle.has(socket.socketId)));
    if (used) continue;
    const plain = Object.values(catalog.modules).find((candidate) =>
      candidate.role === "extension" &&
      candidate.family === module.family &&
      Boolean(candidate.trimmed) === Boolean(module.trimmed));
    if (!plain) continue;
    // replaceInstance rebuilds the whole assembly and hands back null rather
    // than throwing when the result would be illegal, so the answer has to be
    // looked at. Keeping the adapter is the safe outcome; violations() will
    // still name it.
    const swapped = engine.replaceInstance(catalog, next, instance.id, plain.id);
    if (swapped) next = swapped;
  }

  /*
   * A corner whose long edge hangs becomes the straight unit of the same size.
   * The same move as an adapter whose joint goes unused, for the same reason:
   * the special piece was only ever justified by the thing that is not there,
   * and swapping keeps the design while dropping the mistake.
   *
   * Looped, because turning one corner straight can leave a corner extension
   * above it over a base that is no longer a corner.
   */
  for (let pass = 0; pass < 6; pass += 1) {
    const hanging = next.instances.filter((instance) => {
      const module = moduleOf(catalog, instance);
      if (module.family !== "corner") return false;
      if (longEdgeHangs(catalog, next, instance)) return true;
      if (module.role !== "extension") return false;
      const base = stackMates(catalog, next, instance).find((mate) => roleOf(catalog, mate) === "base");
      return !base || moduleOf(catalog, base).family !== "corner";
    });
    if (!hanging.length) break;
    let changed = false;
    for (const instance of hanging) {
      const straight = straightEquivalent(catalog, moduleOf(catalog, instance));
      if (!straight) continue;
      const swapped = engine.replaceInstance(catalog, next, instance.id, straight.id);
      if (swapped) {
        next = swapped;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Risers holding nothing, and display bars past the allowance. Repeated,
  // because taking the top off a stack can expose another riser under it.
  for (let pass = 0; pass < 12; pass += 1) {
    const doomed = [];
    for (const instance of next.instances) {
      const role = roleOf(catalog, instance);
      if (!RISER_ROLES.has(role)) continue;
      if (!carriesSomething(next, instance.id)) {
        doomed.push(instance.id);
      } else if (!carriesShelf(catalog, next, instance.id)) {
        // Take the lamp or the bar off first; the riser under it then has
        // nothing on it and goes on the next pass.
        for (const fitting of next.instances) {
          if ((fitting.consumedSockets || []).some((socket) => socket.instanceId === instance.id)) {
            doomed.push(fitting.id);
          }
        }
      }
    }
    const bars = next.instances.filter((instance) => roleOf(catalog, instance) === "top_bar");
    for (const bar of bars.slice(settings.maxDisplayBars)) {
      if (!carriesSomething(next, bar.id)) doomed.push(bar.id);
    }
    if (!doomed.length) break;
    let changed = false;
    for (const id of doomed) {
      const pruned = engine.removeInstance(catalog, next, id);
      if (pruned) {
        next = pruned;
        changed = true;
      }
    }
    // Nothing could be taken out without breaking the rest; stop rather than
    // spin through the remaining passes finding the same pieces again.
    if (!changed) break;
  }

  return next;
}

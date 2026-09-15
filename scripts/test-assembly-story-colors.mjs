#!/usr/bin/env node
/**
 * Guards on the /colors add-ons story, js/assembly/story-colors.js.
 *
 *   node scripts/test-assembly-story-colors.mjs
 *
 * The arithmetic walk the other two story tests make, plus what is particular
 * to a story that hangs four bookends, slides three rows of books in, puts
 * objects on the shelf and swings a lamp that comes on, with an angled camera:
 *
 *  - the generated files (the shelf and the props) are what their scripts make
 *    today, and every bookend hangs on an end the builder's engine allows;
 *  - every surface a prop stands on is a board the engine places, each row
 *    starts at a bookend's foot, and a capped row fits between two feet;
 *  - nothing passes through anything at any point: book or object against each
 *    other, against the bookends' actual parts, the boards, the rails under
 *    the board above, the legs, and the lamp's shade wherever it swings;
 *  - the order holds: three right-hand bookends, the books, the left-hand one,
 *    the objects, the lamp, the swing, the light; never two of those at once;
 *  - the close-up is from below the bar, the light rig is the builder's at the
 *    builder's own angle, and the palette is lifted as /builder lifts it;
 *  - nothing pops, on every aspect from a phone to 21:9, in the calm cuts too;
 *  - the lamp comes on by its shade alone turning yellow;
 *  - the page loads the story lazily, carries the copy, the links, the /addons
 *    address, and no em dash.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { ROOT, engine as placement, loadCatalog } from "./lib/design-lab.mjs";

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) return;
  failures += 1;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
};
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// --- the generated files are what generates them ------------------------------

function inStep(files, args, name) {
  const before = new Map(files.map((file) => [file, fs.existsSync(path.join(ROOT, file)) ? read(file) : null]));
  try {
    execFileSync(process.execPath, args.map((a, i) => (i === 0 ? path.join(ROOT, a) : a)), { stdio: "pipe", cwd: ROOT });
    const drifted = files.filter((file) => !fs.existsSync(path.join(ROOT, file)) || read(file) !== before.get(file));
    for (const file of drifted) if (before.get(file) != null) fs.writeFileSync(path.join(ROOT, file), before.get(file));
    check(`${name} is in step with what generates it`, drifted.length === 0, `run: node ${args.join(" ")} (${drifted.join(", ")})`);
  } catch (error) {
    check(`${args[0]} runs`, false, error.message);
  }
}
inStep(["js/assembly/lantern-shelf.js"], ["scripts/bake-assembly-story.mjs", "data/assembly/lantern.design.json"], "js/assembly/lantern-shelf.js");
inStep(["js/assembly/props.js", "assets/assembly/props.json"], ["scripts/build-shelf-props.mjs"], "the props");

// --- load the browser files into one fake window ---------------------------

const context = {
  window: { location: { search: "" }, matchMedia: () => ({ matches: false }), URLSearchParams },
  navigator: {},
  document: { createElement: () => ({ getContext: () => null }) },
  URLSearchParams,
  performance: { now: () => 0 }
};
context.window.window = context.window;
vm.createContext(context);
for (const file of ["builder/renderer.js", "assembly/lantern-shelf.js", "assembly/props.js", "assembly/story-colors.js", "assembly/scroll-story.js"]) {
  vm.runInContext(read(`js/${file}`), context, { filename: file });
}
const { FrameworkAssemblyShelf: shelf, FrameworkAssemblyStory: story, FrameworkAssembly: engine, FrameworkProps: props, FrameworkDesignerRenderer: renderer } = context.window;
check("all the scripts define their globals", Boolean(shelf && story && engine && props && renderer));

const BOOKENDS = story.bookendOrder;
const [CLOSE_UP, MIDDLE_RIGHT, TOP_RIGHT, TOP_LEFT] = BOOKENDS;
const BOOK_IDS = story.books.map((b) => b.id);
const OBJECT_IDS = story.objects.map((o) => o.id);
const ADDONS = [...BOOKENDS, ...BOOK_IDS, ...OBJECT_IDS, story.lamp];
const bake = new Map([...shelf.pieces, ...shelf.ends].map((p) => [p.id, p]));
const propById = new Map([...story.books, ...story.objects].map((p) => [p.id, p]));

// --- the shelf and the bookends against the engine --------------------------------

const catalog = loadCatalog();
const record = JSON.parse(read("data/assembly/lantern.design.json"));
const saved = JSON.parse(read("data/builder-designs/3WU3UN2.json"));
check("the design is 3WU3UN2's, with bookends added and nothing else changed",
  JSON.stringify({ ...record.design, bookends: 0 }) === JSON.stringify(saved.design));
check("the design prices as many bookends as the story hangs", record.design.bookends === BOOKENDS.length, `${record.design.bookends} priced, ${BOOKENDS.length} hung`);
const state = placement.deserializeState(catalog, record.design);
const legal = placement.legalBookendAnchors(catalog, state);
const pocket = catalog.accessories.bookend.attach.anchorLocalMm;
check("the bake writes every end the engine allows", shelf.ends.length === legal.length);
check("four different ends", new Set(BOOKENDS).size === 4);
for (const id of BOOKENDS) {
  const end = bake.get(id);
  const match = end && legal.find((a) => a.worldMm.every((n, i) => Math.abs(n - end.anchor[i]) < 0.01));
  check(`${id} hangs on an end the engine allows, as /builder would hang it`,
    Boolean(match) && match.rotationDeg === end.rot && match.worldMm.every((n, i) => Math.abs(n - pocket[i] - end.t[i]) < 0.01));
}
check("the three right-hand bookends are on three different shelves", new Set([CLOSE_UP, MIDDLE_RIGHT, TOP_RIGHT].map((id) => bake.get(id).anchor[2])).size === 3);
check("the fourth is at the left of the top shelf", bake.get(TOP_LEFT).anchor[2] === bake.get(TOP_RIGHT).anchor[2] && bake.get(TOP_LEFT).anchor[0] < bake.get(TOP_RIGHT).anchor[0]);
check("the close-up is the bottom shelf, which has one rail under its board", bake.get(CLOSE_UP).anchor[2] === Math.min(...BOOKENDS.map((id) => bake.get(id).anchor[2])));
check("the bake prices the shelf as the catalogue does", shelf.totalKsh === 24500);

function partBoxes(file) {
  const geometry = JSON.parse(read(file));
  return geometry.parts.map((part) => {
    const bytes = Buffer.from(part.positions, "base64");
    const q = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < q.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const v = part.offset[axis] + q[i + axis] * part.scale;
        box[axis] = Math.min(box[axis], v);
        box[axis + 3] = Math.max(box[axis + 3], v);
      }
    }
    return box;
  });
}
const bookendParts = partBoxes("assets/shelving/modules/bookend.json");
function bookendWorld(id, off) {
  const b = bake.get(id);
  const sign = b.rot === 180 ? -1 : 1;
  return bookendParts.map((p) => {
    const xs = [p[0], p[3]].map((x) => b.anchor[0] + sign * (x - pocket[0]) + off[0]);
    const ys = [p[1], p[4]].map((y) => b.anchor[1] + sign * (y - pocket[1]) + off[1]);
    const z0 = b.anchor[2] - pocket[2] + off[2];
    return [Math.min(...xs), Math.min(...ys), z0 + p[2], Math.max(...xs), Math.max(...ys), z0 + p[5]];
  });
}

// --- surfaces, rows and objects ------------------------------------------------------

const boards = state.instances.filter((i) => i.moduleId !== "lamp").flatMap((i) => placement.boardBoxes(catalog, i));
for (const [name, surface] of Object.entries(story.surfaces)) {
  const board = boards.find((b) => Math.abs(b[5] - surface.z) < 0.01 && b[0] <= surface.from + 0.5 && b[3] >= surface.to - 0.5);
  check(`the ${name} surface is the top of a board the engine places`, Boolean(board), `${surface.z} from ${surface.from} to ${surface.to}`);
}
{
  const below = bookendParts.filter((p) => p[5] <= 150.5);
  const inset = pocket[0] - Math.min(...below.map((p) => p[0]));
  check("a row starts at a bookend's foot", Math.abs(inset - story.footInset) < 0.05, `foot inset ${inset.toFixed(2)}`);
}
for (const row of story.rows) {
  const hanger = bake.get(row.right);
  check(`the ${row.id} row's bookend hangs over it`, hanger && hanger.anchor[2] > row.shelfTop && hanger.anchor[2] - row.shelfTop < 320);
  const rowBooks = row.books.map((id) => propById.get(id));
  check(`the ${row.id} row's books all stand on it`, rowBooks.every((b) => b.bounds[2] >= row.shelfTop - 0.01 && b.bounds[3] <= row.from + 0.01));
  if (row.left) {
    check(`the ${row.id} row fills the space between its bookends, a fraction apart`, row.gap >= 0 && row.gap < 1 && Math.abs(row.end - row.to) < 0.01, `gap ${row.gap}`);
  }
}
check("the top row is capped at both ends", story.rows[0].left === TOP_LEFT);
check("a shelf of books, not a token few", story.books.length >= 45, `${story.books.length} books`);
check("the lower rows leave room for the objects", story.rows.filter((row) => !row.left).every((row) => (row.from - row.end) / (row.from + 138) < 0.75));
{
  const inks = new Set(story.books.map((b) => b.ink));
  check("the books are in at least ten inks", inks.size >= 10, `${inks.size}`);
  for (const row of story.rows) {
    const list = row.books.map((id) => propById.get(id));
    const repeats = list.slice(1).filter((b, i) => b.shape === list[i].shape && b.ink === list[i].ink);
    check(`no two neighbours on the ${row.id} row are the same book`, repeats.length === 0, repeats.map((b) => b.id).join(", "));
  }
  check("a stack of five lies flat", story.rows.some((row) => row.books.filter((id) => props.shapes[propById.get(id).shape].flat).length >= 5));
  check("some books lean", story.books.filter((b) => props.shapes[b.shape].leanDeg).length >= 2);
  const coral = parseInt(story.palette.steel.slice(1), 16);
  const near = Object.entries(story.inks).filter(([, [cover]]) => {
    const c = parseInt(cover.slice(1), 16);
    return Math.hypot(((c >> 16) & 255) - ((coral >> 16) & 255), ((c >> 8) & 255) - ((coral >> 8) & 255), (c & 255) - (coral & 255)) < 70;
  });
  check("no book is the shelf's own coral", near.length === 0, near.map(([name]) => name).join(", "));
}
check("a few objects, not a clutter", story.objects.length >= 6 && story.objects.length <= 12, `${story.objects.length}`);
for (const object of story.objects) {
  const surface = story.surfaces[object.surface];
  check(`${object.id} stands on the ${object.surface} surface`, Math.abs(object.bounds[2] - surface.z) < 0.01
    && object.bounds[0] >= surface.from && object.bounds[3] <= surface.to, JSON.stringify(object.bounds));
  check(`${object.id} is a simple solid in the props`, props.shapes[object.moduleId] && props.shapes[object.moduleId].kind === "object");
}

// Everything a prop could run into, standing still.
const obstacles = [];
for (const b of boards) {
  obstacles.push({ name: `board at ${b[2]}`, box: b });
  obstacles.push({ name: `rails under the board at ${b[2]}`, box: [b[0], b[1] - 20, b[2] - 20, b[3], b[4] + 20, b[2]] });
}
for (const [x, z0, z1] of [[0, 0, 1026], [1143, 0, 724], [440, 692, 1026]]) {
  for (const y of [0, 257]) obstacles.push({ name: `post at ${x},${y}`, box: [x - 12, y - 12, z0, x + 12, y + 12, z1] });
}
{
  // The lamp's post, and its shade everywhere it swings.
  const lamp = bake.get(story.lamp);
  // Only once the lamp is on the shelf: an object dropping onto the board
  // before the lamp arrives passes where its shade will later swing.
  obstacles.push({ name: "lamp post", lamp: true, box: [lamp.t[0] - 14, lamp.t[1] - 14, lamp.t[2], lamp.t[0] + 14, lamp.t[1] + 14, lamp.t[2] + 800] });
  const [low, high] = [Math.min(0, ...story.lampSwingDeg), Math.max(0, ...story.lampSwingDeg)];
  for (let turn = low; turn <= high; turn += 2) {
    const a = ((lamp.rot + turn) * Math.PI) / 180;
    const x = lamp.t[0] + props.shade.cx * Math.cos(a) - props.shade.cy * Math.sin(a);
    const y = lamp.t[1] + props.shade.cx * Math.sin(a) + props.shade.cy * Math.cos(a);
    obstacles.push({ name: `lamp shade turned ${turn}`, lamp: true, box: [x - props.shade.r, y - props.shade.r, lamp.t[2] + props.shade.z0, x + props.shade.r, y + props.shade.r, lamp.t[2] + props.shade.z1] });
  }
}
const overlap = (a, b) => Math.min(...[0, 1, 2].map((axis) => Math.min(a[axis + 3], b[axis + 3]) - Math.max(a[axis], b[axis])));
const moved = (box, off) => [box[0] + off[0], box[1] + off[1], box[2] + off[2], box[3] + off[0], box[4] + off[1], box[5] + off[2]];

// --- the timeline -------------------------------------------------------------

const keys = engine.fillCameras(engine.resolveKeys(story));
check("the story is drawn with the angled camera", keys.angled === true);
check("every camera key states a long lens", keys.cameras.every((key) => key.view && key.view.fovDeg <= 26));
check("the timeline starts at 0 and ends at 1", keys[0].at === 0 && keys[keys.length - 1].at === 1);
check("every piece with a track is a real piece", Object.keys(story.tracks).every((id) => story.pieces.some((p) => p.id === id)));

const STEPS = 1000;
const moments = [];
for (let step = 0; step <= STEPS; step += 1) moments.push(engine.sample(keys, step / STEPS));
let finite = true;
for (const m of moments) {
  if (m.focus.some((n) => !Number.isFinite(n)) || !m.view || Math.abs(m.view.elevationDeg) > 85) finite = false;
  for (const id of Object.keys(m.pieces)) if (m.pieces[id].off.some((n) => !Number.isFinite(n)) || !Number.isFinite(m.pieces[id].turn)) finite = false;
}
check("every sampled frame is finite", finite);

const atRest = (s) => s.off.every((n) => Math.abs(n) < 0.01) && Math.abs(s.turn) < 0.01;
check("no add-on is drawn at the start", ADDONS.every((id) => moments[0].pieces[id].hidden));
for (const calm of [false, true]) {
  const last = engine.sample(keys, 1, calm);
  const out = story.pieces.filter((p) => !atRest(last.pieces[p.id]) || last.pieces[p.id].hidden).map((p) => p.id);
  check(`everything is home and drawn at the end${calm ? " (calm)" : ""}`, out.length === 0, out.join(", "));
}

function window_(ids) {
  let start = null;
  let end = null;
  for (let step = 1; step <= STEPS; step += 1) {
    const moving = ids.some((id) => {
      const a = moments[step - 1].pieces[id];
      const b = moments[step].pieces[id];
      return !b.hidden && (b.off.some((n, axis) => Math.abs(n - a.off[axis]) > 0.01) || Math.abs(b.turn - a.turn) > 0.01);
    });
    if (moving) { if (start === null) start = (step - 1) / STEPS; end = step / STEPS; }
  }
  return [start, end];
}
const order = [[CLOSE_UP], [MIDDLE_RIGHT], [TOP_RIGHT], BOOK_IDS, [TOP_LEFT], OBJECT_IDS, [story.lamp]].map((ids) => window_(ids));
const orderNames = ["the close-up bookend", "the middle bookend", "the top right bookend", "the books", "the top left bookend", "the objects", "the lamp"];
for (let i = 1; i < order.length; i += 1) {
  check(`${orderNames[i - 1]} is done before ${orderNames[i]} moves`, order[i - 1][1] <= order[i][0], `${order[i - 1]} then ${order[i]}`);
}
const [first, , , , , , lamp] = order;
{
  const firstLit = story.tracks[story.lamp].find((p) => p.lit === true);
  check("the lamp comes on only after it has swung back", Boolean(firstLit) && firstLit.at >= lamp[1] && firstLit.at === story.switchOn, `${firstLit && firstLit.at} against ${lamp[1]}`);
  check("the lamp is off until then", moments.every((m, step) => step / STEPS >= story.switchOn || !m.pieces[story.lamp].lit));
  check("the lamp is on at the end", engine.sample(keys, 1).pieces[story.lamp].lit === true && engine.sample(keys, 1, true).pieces[story.lamp].lit === true);
}

for (const id of BOOKENDS) {
  let bad = "";
  let prev = null;
  for (const [step, m] of moments.entries()) {
    const s = m.pieces[id];
    if (s.hidden) continue;
    const [x, y, z] = s.off;
    const across = Math.hypot(x, y);
    if (Math.abs(x) > 0.01 && Math.abs(y) > 0.01) bad = `moves diagonally at ${step / STEPS}`;
    if (across > 0.5 && Math.abs(z + story.riseMm) > 0.5) bad = `moves sideways off the rise height at ${step / STEPS}`;
    if (prev && across > Math.hypot(prev[0], prev[1]) + 0.01) bad = `moves outward at ${step / STEPS}`;
    if (prev && z < prev[2] - 0.01) bad = `drops at ${step / STEPS}`;
    prev = s.off;
  }
  check(`${id} slides in under its bar and rises onto it`, !bad, bad);
}
{
  let bad = "";
  for (const id of [...BOOK_IDS, ...OBJECT_IDS]) {
    let prev = null;
    for (const [step, m] of moments.entries()) {
      const s = m.pieces[id];
      if (s.hidden) continue;
      const sliding = Math.abs(s.off[0]) > 0.01;
      const dropping = Math.abs(s.off[2]) > 0.01;
      if (Math.abs(s.off[1]) > 0.01 || Math.abs(s.turn) > 0.01 || (sliding && dropping)) bad = `${id} leaves its line at ${step / STEPS}`;
      if (s.off[2] < -0.01) bad = `${id} goes through what it stands on at ${step / STEPS}`;
      if (prev !== null && s.off[0] < prev - 0.01) bad = `${id} moves back at ${step / STEPS}`;
      prev = s.off[0];
    }
  }
  check("every book and object slides straight in, or drops straight down onto its surface", !bad, bad);
}
{
  let bad = "";
  let prev = Infinity;
  let most = 0;
  let least = 0;
  for (const [step, m] of moments.entries()) {
    const s = m.pieces[story.lamp];
    if (Math.abs(s.off[0]) > 0.01 || Math.abs(s.off[1]) > 0.01) bad = "moves sideways";
    if (s.off[2] > prev + 0.01) bad = `rises at ${step / STEPS}`;
    if (Math.abs(s.turn) > 0.01 && Math.abs(s.off[2]) > 0.01) bad = `turns before it is in its post, at ${step / STEPS}`;
    prev = s.off[2];
    most = Math.max(most, s.turn);
    least = Math.min(least, s.turn);
  }
  check("the lamp comes straight down and only turns once it is in its post", !bad, bad);
  check("the lamp swings both ways, and not far", most >= 15 && least <= -15 && most <= 40 && least >= -40, `${least} to ${most}`);
  const hover = story.tracks[story.lamp].find((p) => p.off && Math.abs(p.off[2] - story.lampHoverMm) < 0.01);
  check("the lamp pauses over its post higher than the real 10 cm pin", Boolean(hover) && story.lampHoverMm > 100);
}

// --- nothing passes through anything ---------------------------------------------

{
  let worst = 0;
  let where = "";
  const note = (depth, text) => { if (depth > worst) { worst = depth; where = text; } };
  const levelOf = new Map([...story.books.map((b) => [b.id, b.bounds[2] < 120 ? 97 : b.row]), ...story.objects.map((o) => [o.id, o.surface])]);
  // Things on the same board can meet; things on different boards cannot.
  const board = (id) => {
    const p = propById.get(id);
    return Math.round(p.bounds[2] < 120 ? 97 : p.bounds[2] < 450 ? 402 : p.bounds[2] < 900 ? 704 : 1006);
  };
  for (const [step, m] of moments.entries()) {
    const p = step / STEPS;
    const live = [...BOOK_IDS, ...OBJECT_IDS].filter((id) => !m.pieces[id].hidden).map((id) => [id, moved(propById.get(id).bounds, m.pieces[id].off)]);
    const liveBookends = BOOKENDS.filter((id) => !m.pieces[id].hidden).map((id) => [id, bookendWorld(id, m.pieces[id].off)]);
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        if (board(live[i][0]) === board(live[j][0])) note(overlap(live[i][1], live[j][1]) - 0.5, `${live[i][0]} into ${live[j][0]} at ${p}`);
      }
      for (const obstacle of obstacles) {
        if (obstacle.lamp && m.pieces[story.lamp].hidden) continue;
        note(overlap(live[i][1], obstacle.box) - 0.5, `${live[i][0]} into the ${obstacle.name} at ${p}`);
      }
      for (const [id, parts] of liveBookends) for (const part of parts) note(overlap(live[i][1], part) - 0.5, `${live[i][0]} into ${id} at ${p}`);
    }
    for (const [id, parts] of liveBookends) {
      for (const part of parts) for (const b of boards) note(overlap(part, b) - 0.5, `${id} into the board at ${b[2]} at ${p}`);
    }
  }
  void levelOf;
  check("nothing passes through anything", worst <= 0, `${worst.toFixed(1)} mm: ${where}`);
}

// --- the orbit camera, rebuilt ------------------------------------------------

function cameraFor(moment, aspect) {
  const f = moment.focus;
  const centre = [(f[0] + f[3]) / 2, (f[1] + f[4]) / 2, (f[2] + f[5]) / 2];
  const az = (moment.view.azimuthDeg * Math.PI) / 180;
  const el = (moment.view.elevationDeg * Math.PI) / 180;
  const offset = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
  const forward = offset.map((n) => -n);
  const rl = Math.hypot(forward[1], forward[0]);
  const right = [forward[1] / rl, -forward[0] / rl, 0];
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const distance = engine.orbitDistance(f, moment.padding, moment.view, aspect);
  const tanV = Math.tan(((moment.view.fovDeg || engine.ORBIT_FOV_DEG) * Math.PI) / 360);
  const tanH = tanV * aspect;
  const eye = centre.map((c, axis) => c + offset[axis] * distance);
  return {
    eye,
    sees(box) {
      for (let i = 0; i <= 4; i += 1) for (let j = 0; j <= 2; j += 1) for (let k = 0; k <= 4; k += 1) {
        const p = [box[0] + ((box[3] - box[0]) * i) / 4, box[1] + ((box[4] - box[1]) * j) / 2, box[2] + ((box[5] - box[2]) * k) / 4];
        const d = p.map((n, axis) => n - eye[axis]);
        const z = dot(d, forward);
        if (z <= 20) continue;
        if (Math.abs(dot(d, right)) <= z * tanH && Math.abs(dot(d, up)) <= z * tanV) return true;
      }
      return false;
    }
  };
}
const restBox = (id) => (bake.get(id) || propById.get(id)).bounds;

{
  const anchorZ = bake.get(CLOSE_UP).anchor[2];
  const track = story.tracks[CLOSE_UP];
  for (const aspect of [0.6, 1.0, 1.78, 2.33]) {
    let worst = -Infinity;
    for (let step = Math.round(track[2].at * STEPS); step <= Math.round(track[track.length - 1].at * STEPS); step += 1) {
      worst = Math.max(worst, cameraFor(moments[step], aspect).eye[2]);
    }
    check(`the close-up looks up from under the bar at aspect ${aspect}`, worst < anchorZ, `eye at ${worst.toFixed(0)}, bar at ${anchorZ}`);
  }
}

{
  const d = renderer.VIEW_DIRECTION;
  const view = { azimuthDeg: (Math.atan2(d[0], -d[1]) * 180) / Math.PI, elevationDeg: (Math.asin(d[2]) * 180) / Math.PI };
  const rig = engine.turnedLights(view);
  check("the turned light rig is the builder's at the builder's angle",
    ["key", "rim", "up"].every((k) => rig[k].every((n, i) => Math.abs(n - renderer.LIGHTS[k][i]) < 1e-9)));
}

for (const aspect of [0.6, 0.8, 1.0, 1.6, 1.78, 2.33]) {
  for (const calm of [false, true]) {
    let where = "";
    for (const id of ADDONS) {
      const reveal = story.tracks[id].find((p) => p.hidden === false);
      for (let step = Math.ceil(reveal.at * STEPS - 1e-9); step <= STEPS; step += 1) {
        const m = engine.sample(keys, step / STEPS, calm);
        const s = m.pieces[id];
        if (s.off.some((n, axis) => Math.abs(n - reveal.off[axis]) > 0.5)) break;
        if (cameraFor(m, aspect).sees(moved(restBox(id), s.off))) { where = `${id} is in the frame at p=${step / STEPS}, before it moves`; break; }
      }
      if (where) break;
    }
    check(`no add-on appears inside the frame at aspect ${aspect}${calm ? " (calm)" : ""}`, !where, where);
  }
}

for (const aspect of [0.6, 1.0, 1.78, 2.33]) {
  const camera = cameraFor(moments[STEPS], aspect);
  const missing = [...shelf.pieces.map((p) => p.id), ...BOOKENDS, ...OBJECT_IDS].filter((id) => !camera.sees(restBox(id)));
  check(`the shelf, its bookends and its objects are in the last frame at aspect ${aspect}`, missing.length === 0, missing.join(", "));
}

// --- the palette is lifted as /builder lifts it -----------------------------------

{
  const app = read("js/builder/app.js");
  const gain = (name) => Number((app.match(new RegExp(`const ${name} = ([0-9.]+);`)) || [])[1]);
  check("the steel and boards are lifted by /builder's own gains", gain("STEEL_GAIN") === story.gains.steel && gain("SURFACE_GAIN") === story.gains.surface);
  const lifted = (hex, g) => "#" + [16, 8, 0].map((s) => Math.min(255, Math.round(((parseInt(hex.slice(1), 16) >> s) & 255) * g)).toString(16).padStart(2, "0")).join("");
  check("the story paints with the lifted pair", story.palette.steel.toLowerCase() === lifted(shelf.palette.steel, story.gains.steel)
    && story.palette.surface.toLowerCase() === lifted(shelf.palette.surface, story.gains.surface));
}

// --- the lamp comes on as a light ---------------------------------------------------

{
  const lampPiece = story.pieces.find((piece) => piece.id === story.lamp);
  const light = story.light;
  const hex = /^#[0-9a-f]{6}$/i;
  check("the lamp's shade glows when it comes on", Boolean(lampPiece && lampPiece.glow
    && hex.test(lampPiece.glow.inside) && hex.test(lampPiece.glow.outside)));
  check("nothing else glows", story.pieces.every((piece) => piece.id === story.lamp || !piece.glow));
  check("the light is the lamp's", Boolean(light) && light.piece === story.lamp && hex.test(light.color) && light.reach > 0);
  check("the bulb is in the middle of the shade, and the light leaves by its two open ends",
    light.bulb[0] === props.shade.cx && light.bulb[1] === props.shade.cy
    && light.bulb[2] > props.shade.z0 && light.bulb[2] < props.shade.z1
    && light.radius === props.shade.r && light.below === props.shade.z0 && light.above === props.shade.z1);
  const lit = engine.lampFor(story, engine.sample(keys, 1));
  const board = story.surfaces.besideSlim;
  check("at the end the light is on, over the board the lamp stands on, which stops it",
    Boolean(lit) && light.floor === board.z && lit.bulbMm[0] >= board.from && lit.bulbMm[0] <= board.to
    && lit.bulbMm[2] > light.floor && lit.belowMm > light.floor,
    JSON.stringify(lit));
  check("the light is off until the lamp comes on", engine.lampFor(story, engine.sample(keys, story.switchOn - 0.005)) === null);
  check("no light beams are left in the props", Object.values(props.shapes).every((shape) => shape.kind !== "light"));
}

// --- captions ----------------------------------------------------------------------

const WORDS = {
  bookend: ["The Bookend", "Slides up onto the bar under a shelf and holds a row of books upright. Ksh 1,000 each.", "/shelving.html?config=bookend"],
  rest: ["Fully detachable", "Put one at each end of a shelf and move them as your books move. Compatible with all but our trimmed units.", null],
  lamp: ["The Lamp", "A steel lamp that drops into the shelving and pivots. Lamp shade and bulb not included.", "/shelving.html?config=lighted-console"]
};
check("three captions", story.captions.length === 3);
for (let i = 1; i < story.captions.length; i += 1) check("no two captions are on screen at once", story.captions[i].from >= story.captions[i - 1].to);
const catalogData = JSON.parse(read("data/catalog.json"));
const catalogIds = new Set((catalogData.products || catalogData).map((p) => p.id));
for (const caption of story.captions) {
  const [title, body, href] = WORDS[caption.id];
  check(`caption "${caption.id}" is the story's`, caption.title === title && caption.body === body, `${caption.title}: ${caption.body}`);
  check(`caption "${caption.id}" links where it should`, caption.href === href, String(caption.href));
  if (caption.href) {
    const config = new URL(caption.href, "https://x").searchParams.get("config");
    check(`caption "${caption.id}" links to a product the catalogue has`, catalogIds.has(config), config);
  }
  check(`caption "${caption.id}" reaches full opacity`, engine.windowOpacity((caption.from + caption.to) / 2, caption.from, caption.to) > 0.999);
  check(`caption "${caption.id}" body is under 25 words`, caption.body.split(/\s+/).length < 25);
  if (caption.photo) {
    const file = caption.photo.startsWith("/") ? caption.photo.slice(1) : `${story.photoBase.slice(1)}${caption.photo}.jpg`;
    check(`the photograph for "${caption.id}" is on disk`, fs.existsSync(path.join(ROOT, file)), file);
  }
}
{
  const lampCaption = story.captions.find((c) => c.id === "lamp");
  check("the lamp's words arrive with the swing", story.tracks[story.lamp].some((p) => p.turn && Math.abs(p.at - lampCaption.from) < 0.04), `${lampCaption.from}`);
  check("the lamp's words stay up while it comes on", lampCaption.to >= story.switchOn + 0.03, `${lampCaption.to}`);
  const bookendCaption = story.captions.find((c) => c.id === "bookend");
  check("the bookend's words are up while the first bookend rises", bookendCaption.from <= first[0] && bookendCaption.to >= first[1]);
  const scroll = read("js/assembly/scroll-story.js");
  check("a caption with a link draws its title as the link", /caption\.href/.test(scroll) && /createElement\('a'\)/.test(scroll));
  check("the link takes the pointer back from the overlay", /\.fa-caption h2 a[^{]*\{[^}]*pointer-events:\s*auto/.test(read("css/assembly.css")));
}

// --- the page and the address ---------------------------------------------------------

const page = read("customize.html");
{
  const loader = (page.match(/var SCRIPTS = \[([\s\S]*?)\];/) || [])[1] || "";
  const listed = [...loader.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check("the story's scripts are loaded in order, when the track comes near",
    JSON.stringify(listed) === JSON.stringify(["/js/builder/geometry.js", "/js/builder/renderer.js", "/js/assembly/lantern-shelf.js", "/js/assembly/props.js", "/js/assembly/story-colors.js", "/js/assembly/scroll-story.js"]),
    listed.join(", "));
  for (const src of listed) check(`${src} is on disk`, fs.existsSync(path.join(ROOT, src.slice(1))));
  check("none of the story's scripts is on the page's critical path", !/<script src="\/js\/(assembly|builder)\//.test(page));
  check("the loader waits for the track to come near", /IntersectionObserver/.test(page) && /rootMargin/.test(page));
}
check("the add-ons section carries the id /addons lands on", /<section class="co-addons" id="addons">/.test(page));
check("the add-ons open in the title's size, with their own heading", page.includes('<h2 class="co-title">Upgrade your shelf with add-ons.</h2>'));
check("the add-ons say what they are for", page.includes("Custom-designed for Framework shelving. Include in your next order, or buy separately to elevate your existing unit."));
check("the page does not preload geometry it may never show", !/rel="preload"[^>]*(modules|assembly)\//.test(page));
check("the \"As shown\" line counts the bookends in the picture", page.includes(`Ksh&nbsp;${shelf.totalKsh.toLocaleString("en-KE")} (excl. shade), plus four bookends at Ksh&nbsp;1,000 each.`));
check("the coat hanger says which units take it", page.includes("Compatible with deep and compact units."));
check("the page links to /how", page.includes('href="/how"'));
{
  const pack = JSON.parse(read("assets/assembly/props.json"));
  for (const piece of story.pieces) {
    if (piece.pack) check(`${piece.moduleId} is in the props pack`, Boolean(pack.modules[piece.moduleId]));
    else check(`${piece.moduleId}.json is on disk`, fs.existsSync(path.join(ROOT, "assets/shelving/modules", `${piece.moduleId}.json`)));
  }
}
{
  const toml = read("netlify.toml");
  const redirect = (from, to, status) => new RegExp(`from = "${from}"\\s+to = "${to}"\\s+status = ${status}`).test(toml);
  check("the page is at /customize", redirect("/customize", "/customize.html", 200));
  check("/addons goes to the add-ons section", redirect("/addons", "/customize#addons", 301));
  for (const old of ["/colors", "/colors.html", "/colours", "/colours.html"]) {
    check(`${old} lands on /customize in one hop`, redirect(old.replace(".", "\\."), "/customize", 301));
  }
  check("there is no page left at colors.html", !fs.existsSync(path.join(ROOT, "colors.html")));
  check("the page names its own address", page.includes('<link rel="canonical" href="https://www.framework.co.ke/customize">')
    && page.includes('<meta property="og:url" content="https://www.framework.co.ke/customize">'));
  check("the ask is about customizing", page.includes("<h2>How will you customize yours?</h2>"));
  const sitemap = read("sitemap.xml");
  check("the sitemap lists /customize and not /colors", sitemap.includes("<loc>https://www.framework.co.ke/customize</loc>") && !sitemap.includes("framework.co.ke/colors<"));
  const dev = read("scripts/dev-builder.mjs");
  check("the dev server serves /customize and redirects the old addresses", dev.includes('[/^\\/customize\\/?$/, "/customize.html"]') && dev.includes('"/customize#addons"'));
  for (const file of ["how.html", "blog/template.html", "blog/modularity-for-kenya.html"]) {
    const html = read(file);
    check(`${file} links to /customize, not to the old addresses`, html.includes('href="/customize"') && !/href="\/colou?rs"/.test(html));
  }
  check("/how's box names both the colors and the add-ons", /<a class="pg-colors" href="\/customize">[\s\S]*?colors[\s\S]*?add-ons[\s\S]*?<\/a>/.test(read("how.html")));
  check("the blog's box names both", read("blog/template.html").includes('<a href="/customize">four colors and add-ons</a>'));
}
check("the add-ons stage carries the loading mark", /<div class="fa-stage" id="addons-stage">\s*<canvas[^>]*><\/canvas>\s*<div class="fa-loading" aria-hidden="true">/.test(page)
  && page.includes('d="M216 332H145V35H442V352L265 529V225L442 48"'));
check("a script that never arrives leaves the shelf's photograph, not a blank stage",
  /script\.onerror = function \(\) \{[\s\S]*?giveUp\(\);/.test(page) && /track\.parentNode\.replaceChild\(still, track\)/.test(page)
  && /\.catch\(function \(error\) \{\s*console\.error\('assembly:', error\);\s*giveUp\(\);/.test(page));
for (const file of ["customize.html","css/colors.css", "js/assembly/story-colors.js", "scripts/test-assembly-story-colors.mjs", "scripts/build-shelf-props.mjs", "scripts/lib/props-geometry.mjs", "data/assembly/lantern.design.json"]) {
  check(`${file} has no em dash`, !read(file).includes("\u2014"));
}

if (failures) {
  console.error(`\n${failures} story check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`story ok: ${keys.cameras.length} camera keys, ${story.pieces.length} pieces (${story.books.length} books in ${story.rows.length} rows, ${story.objects.length} objects), ${story.captions.length} captions, ${story.finishName}`);

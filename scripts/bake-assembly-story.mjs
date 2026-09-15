#!/usr/bin/env node
/**
 * Bake the assembly story's geometry from a saved design.
 *
 *   node scripts/bake-assembly-story.mjs [data/assembly/curator.design.json]
 *
 * Writes js/assembly/<slug>.js: the pieces, where each one rests, what holds it
 * up, and the world point of the joint it lands on. The scroll story's own file
 * (js/assembly/story.js) holds the direction -- camera, captions, timing -- and
 * refers to these by name, so a geometry change downstream of Rhino moves the
 * animation without anybody retyping a coordinate.
 *
 * Everything here comes out of js/builder/engine.js, the same placement engine
 * /builder runs. That is the point: the story cannot show a shelf the workshop
 * could not build, because the story's numbers *are* the builder's numbers.
 *
 * The input is a design as /api/design stores it, captured once from a saved
 * link and checked in, because Netlify Blobs is not reachable from a script and
 * a published product's shelf should not change under the page silently.
 *
 * Re-run it after `make site` in the pipeline, alongside the builder assets.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, engine, loadCatalog } from "./lib/design-lab.mjs";

const input = path.resolve(ROOT, process.argv[2] || "data/assembly/curator.design.json");
const record = JSON.parse(fs.readFileSync(input, "utf8"));
const catalog = loadCatalog();
const state = engine.deserializeState(catalog, record.design);

const validation = engine.validateState(catalog, state);
if (!validation.isValid) {
  console.error(`${path.basename(input)} does not describe a buildable shelf:`);
  for (const reason of validation.reasons) console.error(`  - ${reason}`);
  process.exit(1);
}

const round = (n) => Math.round(n * 100) / 100;
const box = (b) => b.map((n) => Math.round(n));

/*
 * Build order.
 *
 * A piece can only be animated into place after everything holding it up is
 * already there, so the order is read off the support graph rather than off the
 * order the design happens to be stored in -- which is the order somebody
 * clicked, and need not be a sequence you could actually assemble in.
 */
function buildOrder(instances) {
  const placed = new Set();
  const order = [];
  const pending = instances.slice();
  while (pending.length) {
    const next = pending.findIndex((instance) => {
      const supports = new Set((instance.consumedSockets || []).map((s) => s.instanceId));
      return [...supports].every((id) => placed.has(id));
    });
    if (next < 0) throw new Error(`cannot order: ${pending.map((i) => i.id).join(", ")} have unmet supports`);
    const [instance] = pending.splice(next, 1);
    placed.add(instance.id);
    order.push(instance);
  }
  return order;
}

const ordered = buildOrder(state.instances);

const pieces = ordered.map((instance, index) => {
  const module = catalog.modules[instance.moduleId];
  const supports = [...new Set((instance.consumedSockets || []).map((s) => s.instanceId))];
  /*
   * Every joint this piece lands on, in world mm.
   *
   * All of them, not just one: which leg a close-up should point at depends on
   * where the camera is, and the camera is the story's business, not this
   * script's. The page ranks them against the renderer's own view direction.
   */
  const joints = (instance.consumedSockets || []).map((socket) => socket.worldMm.map(round));
  return {
    id: instance.id,
    step: index,
    moduleId: instance.moduleId,
    label: module.label,
    family: module.family,
    role: module.role,
    t: instance.translation.map(round),
    rot: instance.rotationDeg || 0,
    pivot: module.localPivotMm || [0, 0],
    bounds: box(engine.instanceBounds(catalog, instance)),
    on: supports,
    joints: joints,
    priceKsh: module.priceKsh == null ? null : module.priceKsh
  };
});

/*
 * Bookends.
 *
 * They are not pieces: a design carries a count, and the engine works out which
 * ends they hang on from where the units stand. So they are baked the way
 * /builder draws them (bookendSceneEntries in js/builder/app.js): the pocket in
 * the bookend's top lands on the anchor and is the point it turns about, so the
 * translation is the anchor less that pocket and the pivot is the pocket.
 *
 * Written only when the design asks for some, so a story without bookends
 * bakes to exactly the file it always did.
 */
const accessory = (catalog.accessories || {}).bookend;
const pocket = (accessory && accessory.attach && accessory.attach.anchorLocalMm) || [0, 0, 0];
function bookendEntry(placement, id) {
  const t = [0, 1, 2].map((axis) => round(placement.worldMm[axis] - pocket[axis]));
  const size = accessory.bboxMm;
  // The bookend's own box, turned about its pocket.
  const corners = [[size[0], size[1]], [size[3], size[4]]].map(([x, y]) => {
    const radians = placement.rotationDeg * Math.PI / 180;
    const dx = x - pocket[0];
    const dy = y - pocket[1];
    return [
      placement.worldMm[0] + dx * Math.cos(radians) - dy * Math.sin(radians),
      placement.worldMm[1] + dx * Math.sin(radians) + dy * Math.cos(radians)
    ];
  });
  return {
    id,
    moduleId: "bookend",
    label: accessory.label,
    on: [placement.instanceId],
    end: placement.end,
    anchor: placement.worldMm.map(round),
    t,
    rot: placement.rotationDeg,
    pivot: [pocket[0], pocket[1]],
    bounds: box([
      Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), t[2] + size[2],
      Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1]), t[2] + size[5]
    ]),
    priceKsh: accessory.priceKsh == null ? null : accessory.priceKsh
  };
}

const bookends = engine.bookendPlacements(catalog, state).map((placement, index) => bookendEntry(placement, `bookend_${index + 1}`));

/*
 * Every end of the design that can take a bookend, whichever the count would
 * fill. /builder fills from the bottom up, and a story may want a different set
 * of the same ends (the right-hand end of every shelf, say), so it chooses from
 * these by name. Named by the unit and by which side of the design it is on,
 * not by the anchor's own `end`, which is module-local and reads "left" on a
 * unit turned round.
 */
// Which side of its own unit, not of the design: the slim unit's right-hand
// end is left of the whole shelf's middle.
const unitCentre = (instanceId) => {
  const b = engine.instanceBounds(catalog, state.instances.find((instance) => instance.id === instanceId));
  return (b[0] + b[3]) / 2;
};
const ends = bookends.length
  ? engine.legalBookendAnchors(catalog, state).map((anchor) =>
    bookendEntry(anchor, `end_${anchor.instanceId}_${anchor.worldMm[0] > unitCentre(anchor.instanceId) ? "right" : "left"}`))
  : [];

const bounds = box(engine.designBounds(catalog, state));
const modules = [...new Set(pieces.map((p) => p.moduleId))].sort();
const priced = pieces.filter((p) => p.priceKsh != null);
const total = priced.reduce((sum, p) => sum + p.priceKsh, 0);

/*
 * The finish, resolved to the two colours the shader actually wants.
 *
 * Baking these is what lets the page skip catalog.json altogether: the only
 * things it was ever fetched for are a per-module pivot and a pair of hex
 * values, both of which belong to this design and neither of which is worth a
 * round trip on the critical path of an animation.
 */
const finish = catalog.finishes.find((f) => f.id === state.finish) || catalog.finishes[0];

const slug = path.basename(input).replace(/\.design\.json$/, "");
const global = "FrameworkAssemblyShelf";
const out = path.join(ROOT, "js", "assembly", `${slug}-shelf.js`);

const lines = [
  "/**",
  ` * ${record.title} — geometry for the assembly story. GENERATED, do not edit.`,
  " *",
  ` *   node scripts/bake-assembly-story.mjs ${path.relative(ROOT, input)}`,
  " *",
  " * Every coordinate here came out of js/builder/engine.js placing this design,",
  " * so it is the same shelf /builder draws and the workshop builds. `step` is the",
  " * order it can actually be assembled in, read off the support graph.",
  " *",
  ` * Source: ${record.source}`,
  " */",
  `window.${global} = {`,
  `    code: ${JSON.stringify(record.code)},`,
  `    title: ${JSON.stringify(record.title)},`,
  `    finish: ${JSON.stringify(finish.id)},`,
  `    finishName: ${JSON.stringify(finish.displayName)},`,
  `    palette: ${JSON.stringify({ steel: finish.builder.steel, surface: finish.builder.surface })},`,
  `    modules: ${JSON.stringify(modules)},`,
  `    boundsMm: ${JSON.stringify(bounds)},`,
  `    sizeMm: ${JSON.stringify([bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]])},`,
  `    totalKsh: ${total},`,
  "    pieces: [",
  ...pieces.map((piece, index) => "        " + JSON.stringify(piece) + (index < pieces.length - 1 ? "," : "")),
  bookends.length ? "    ]," : "    ]",
  ...(bookends.length ? [
    "    bookends: [",
    ...bookends.map((bookend, index) => "        " + JSON.stringify(bookend) + (index < bookends.length - 1 ? "," : "")),
    "    ],",
    "    ends: [",
    ...ends.map((end, index) => "        " + JSON.stringify(end) + (index < ends.length - 1 ? "," : "")),
    "    ]"
  ] : []),
  "};",
  ""
];

fs.writeFileSync(out, lines.join("\n"));

console.log(`${record.title} (${record.code})`);
console.log(`  ${pieces.length} pieces, ${modules.length} modules, ${bounds[3] - bounds[0]}w x ${bounds[4] - bounds[1]}d x ${bounds[5] - bounds[2]}h mm`);
console.log(`  Ksh ${total.toLocaleString("en-KE")} over ${priced.length} priced pieces`);
console.log("  build order:");
for (const piece of pieces) {
  console.log(`    ${piece.step}. ${piece.label.padEnd(22)} ${piece.on.length ? "on " + piece.on.join(" + ") : "on the floor"}`
    + `${piece.joints.length ? `  (${piece.joints.length} joints)` : ""}`);
}
for (const bookend of bookends) {
  console.log(`    +  ${bookend.label.padEnd(22)} under ${bookend.on[0]}, ${bookend.end} end, anchor ${bookend.anchor.join(",")}`);
}
console.log(`  -> ${path.relative(ROOT, out)}`);

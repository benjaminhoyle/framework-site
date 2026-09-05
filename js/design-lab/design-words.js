/**
 * Saying, in words, what shape this particular shelf is.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The scene prompt's constraints are all *attributes*: tier count, spacing,
 * colour, tube thickness, joint style. Every one of them is true of any shelf,
 * so none of them tells the model what THIS shelf looks like. The only thing
 * carrying the actual shape is the reference image — and it is one image against
 * seven thousand characters describing a room.
 *
 * Audited against the render (scripts/audit-scenes.mjs), that loses. The
 * failure is not random noise, it is a prior: the model normalises an
 * asymmetric, multi-module, stepped composition into the bookcase it expects.
 * The recorded faults are all one fault —
 *
 *     "stepped pyramid inverted to a bridge shape"
 *     "merged three stepped modular units into a single double-bay shelf"
 *     "separated left section into a bedside table"
 *     "central bridge became a standard three-tier shelving unit"
 *
 * — and the last one is the tell. The same shot scored 4.2 in a café and 2.2 in
 * a bedroom: given a bedroom, the model reassigns a low module to the furniture
 * the room implies. It is not being stupid. A shelf in three separated stacks
 * genuinely is ambiguous, and nothing in the prompt says it is one object.
 *
 * ── What this does about it ───────────────────────────────────────────────
 *
 * This tool knows something the scene studio never can: it has the design, not
 * just a photograph of one. So the shape can be *stated* rather than left to be
 * read off a picture. Words plus the image beat the image alone.
 *
 * ── What it will and will not claim ───────────────────────────────────────
 *
 * Only what is exactly derivable. The skyline and the floor footprint come
 * straight out of instance bounding boxes and were checked against the renders.
 * Board *counts* and board *heights* are deliberately absent: coincident boards
 * where modules meet make both fragile, and a confidently wrong "there must be
 * exactly 8 shelves" would do more damage than saying nothing. The image
 * carries those; this carries what the image is losing.
 */
window.FrameworkDesignWords = (function () {
  "use strict";

  // How finely the outline is sampled, and how much of a step is worth saying.
  const SAMPLE_MM = 20;
  const HEIGHT_SNAP_MM = 100;
  const MIN_RUN_MM = 120;
  // Two floor sections closer than this are read as standing together.
  const TOUCHING_MM = 60;

  const cm = (mm) => Math.round(mm / 10);

  function boxesOf(engine, catalog, state) {
    return state.instances.map((instance) => ({
      instance,
      box: engine.instanceBounds(catalog, instance)
    }));
  }

  /**
   * The top edge of the shelf, left to right, as a few flat runs.
   *
   * This is the thing being lost. A shelf whose outline steps low-tall-low is
   * described by three runs, and "it is not a rectangular bookcase" follows
   * from the fact that there is more than one of them.
   */
  function skyline(boxes) {
    if (!boxes.length) return [];
    const minX = Math.min(...boxes.map((entry) => entry.box[0]));
    const maxX = Math.max(...boxes.map((entry) => entry.box[3]));
    const runs = [];
    for (let x = minX; x < maxX; x += SAMPLE_MM) {
      const at = x + SAMPLE_MM / 2;
      let top = 0;
      for (const entry of boxes) {
        if (entry.box[0] <= at && entry.box[3] >= at && entry.box[5] > top) top = entry.box[5];
      }
      const snapped = Math.round(top / HEIGHT_SNAP_MM) * HEIGHT_SNAP_MM;
      const last = runs[runs.length - 1];
      if (last && last.topMm === snapped) last.widthMm += SAMPLE_MM;
      else runs.push({ topMm: snapped, widthMm: SAMPLE_MM });
    }
    // A one-sample sliver is a rounding artefact at a join, not a step.
    return runs.filter((run) => run.widthMm >= MIN_RUN_MM && run.topMm > 0);
  }

  /** Where the shelf actually meets the floor, and where it does not. */
  function footprint(boxes) {
    const feet = boxes
      .filter((entry) => (entry.instance.placement || {}).method === "floor")
      .map((entry) => [entry.box[0], entry.box[3]])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of feet) {
      const last = merged[merged.length - 1];
      if (last && span[0] - last[1] <= TOUCHING_MM) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    const gaps = [];
    for (let i = 1; i < merged.length; i += 1) gaps.push(merged[i][0] - merged[i - 1][1]);
    return { sections: merged, gaps };
  }

  /**
   * The parts that stand on nothing — spanning from one stack across to the
   * next with open air beneath them.
   *
   * A bridge is the hardest thing in this catalogue for a model to believe. It
   * has no prior for a shelf that floats between two towers, so it lands the
   * span on the floor and the design becomes an ordinary bookcase. "Separate
   * elevated bridge structure is missing" was the fault that survived saying
   * everything else, so it gets said too.
   */
  function bridges(engine, catalog, state, boxes) {
    const byId = new Map(state.instances.map((instance) => [instance.id, instance]));
    const supportsOf = (instance) => {
      const on = (instance.placement || {}).on;
      if (!on) return [];
      return Array.isArray(on) ? on : [on];
    };
    // Which floor-standing pieces does this one ultimately rest on?
    const feetUnder = (instance, seen) => {
      const visited = seen || new Set();
      if (visited.has(instance.id)) return new Set();
      visited.add(instance.id);
      if ((instance.placement || {}).method === "floor") return new Set([instance.id]);
      const found = new Set();
      for (const id of supportsOf(instance)) {
        const parent = byId.get(id);
        if (!parent) continue;
        for (const foot of feetUnder(parent, visited)) found.add(foot);
      }
      return found;
    };
    const boxOf = new Map(boxes.map((entry) => [entry.instance.id, entry.box]));
    const spans = [];
    for (const instance of state.instances) {
      if ((instance.placement || {}).method === "floor") continue;
      // Two different feet under one piece means it reaches across the gap
      // between them rather than sitting on a single stack.
      if (feetUnder(instance).size < 2) continue;
      const box = boxOf.get(instance.id);
      if (box) spans.push({ underMm: box[2], widthMm: box[3] - box[0] });
    }
    return spans;
  }

  function describeSkyline(runs) {
    if (runs.length < 2) return null;
    const lines = runs.map((run) => `    - a section ${cm(run.widthMm)} cm wide standing ${cm(run.topMm)} cm tall`);
    return lines.join("\n");
  }

  /**
   * The block appended to the scene prompt.
   *
   * Last on purpose. The room description is long and vivid and everything
   * before it has already been said once; this is the part that has to survive
   * contact with a paragraph about a Karen garden house, so it goes where it is
   * read last and is written as a check rather than a wish.
   */
  function build(engine, catalog, state, options) {
    const settings = options || {};
    const boxes = boxesOf(engine, catalog, state);
    if (!boxes.length) return "";

    const minX = Math.min(...boxes.map((entry) => entry.box[0]));
    const maxX = Math.max(...boxes.map((entry) => entry.box[3]));
    const topZ = Math.max(...boxes.map((entry) => entry.box[5]));
    const runs = skyline(boxes);
    const { sections, gaps } = footprint(boxes);

    const lines = [];
    lines.push("THIS PARTICULAR SHELF — the reference image and these lines describe the same object.");
    lines.push("Use these lines to read the image correctly. Where they seem to disagree, look again at the image.");
    lines.push("");
    lines.push(`- Overall it is ${cm(maxX - minX)} cm wide and ${cm(topZ)} cm tall.`);

    /*
     * The single most useful sentence in the whole prompt, and the one the
     * evidence asked for: a shelf standing in separated stacks is read as
     * several pieces of furniture, and a room full of furniture names is
     * offered to the model as somewhere to file them.
     */
    lines.push("- It is ONE freestanding piece of furniture. Every part described below belongs to it and is");
    lines.push("  made of the same steel frame in the same colour. Do NOT split it into separate pieces of");
    lines.push("  furniture, do NOT turn any part of it into a side table, bedside table, console, sideboard,");
    lines.push("  cabinet or bench, and do NOT leave any part of it out — however much the room might suggest one.");

    if (runs.length >= 2) {
      // Heights rather than "low/tall": with more than two steps, calling a
      // 100 cm section "low" because something else is 120 is a worse summary
      // than the numbers it is summarising.
      const shape = runs.map((run) => `${cm(run.topMm)}`).join(" · ");
      lines.push("- Seen from the front its top edge is NOT level. It steps, left to right:");
      lines.push(describeSkyline(runs));
      lines.push(`  In short, its heights left to right are: ${shape} cm.`);
      lines.push("  This stepped outline is the most important thing to get right. It is not a rectangular");
      lines.push("  bookcase and it is not symmetrical unless the steps above say it is. Keep the tall and low");
      lines.push("  sections in exactly these places, in these proportions.");
    }

    if (sections.length > 1) {
      const gapWords = gaps.map((gap) => `${cm(gap)} cm`).join(" and ");
      lines.push(`- It meets the floor in ${sections.length} separate places, with open floor visible between`);
      lines.push(`  them (${gapWords} of clear floor). Those gaps are part of the design: keep them open, keep`);
      lines.push("  the shelf's parts standing apart exactly as the reference shows, and do not push them");
      lines.push("  together into one solid unit or fill the gaps with anything structural.");
    }

    const spans = bridges(engine, catalog, state, boxes);
    if (spans.length && sections.length > 1) {
      const lowest = Math.min(...spans.map((span) => span.underMm));
      lines.push(`- ${spans.length === 1 ? "One section" : `${spans.length} sections`} of the shelf ${spans.length === 1 ? "spans" : "span"} ACROSS the gap between the floor-standing stacks,`);
      lines.push(`  carried at each end and standing on nothing in the middle — a bridge, with open air and`);
      lines.push(`  visible floor underneath, starting about ${cm(lowest)} cm above the ground. This is not a`);
      lines.push("  mistake in the reference and it is not a solid cabinet: keep the span raised, keep the space");
      lines.push("  beneath it empty, and do not run legs, panels or extra shelves down to the floor to support it.");
    }

    if (settings.omitFigure !== false) {
      lines.push("- The grey untextured human figure in the reference is a measuring aid for scale only.");
      lines.push("  Do not reproduce it, or any person, mannequin or silhouette, in the output.");
    }

    lines.push("");
    lines.push("BEFORE RETURNING THE IMAGE, trace the outline of the shelf you have drawn and compare it to the");
    lines.push("steps listed above. If it has become a plain rectangle, if the tall and low sections have moved");
    lines.push("or changed proportion, if separate sections have merged, or if any part has become a different");
    lines.push("piece of furniture, redraw it correctly. The room may be anything you like; the shelf may not.");

    return lines.filter((line) => line !== null).join("\n");
  }

  return { build, skyline, footprint };
})();

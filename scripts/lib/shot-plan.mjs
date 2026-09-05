/**
 * Planning the shots for one design: the angles, and where a person can stand.
 *
 * A library rather than a step in a script, because the shots are planned in
 * two places — up front for a whole corpus by scripts/plan-shots.mjs, and one
 * design at a time by the dev server when the studio flow reaches it. Two
 * copies of this would be two different cameras.
 */

/**
 * Plan the camera angles to preview before spending a render on them.
 *
 *   node scripts/plan-shots.mjs                 # the designs that survived review
 *   node scripts/plan-shots.mjs --angles 4 --seed 5
 *
 * A Blender render is minutes of a laptop's attention, and most angles of most
 * shelves are not worth one. So each design gets several *shots* — an angle and
 * a colour — which are drawn in the browser by the builder's own renderer,
 * chosen there, and only then rendered.
 *
 * The camera is a person standing in the room looking at the shelf: eye height,
 * a natural distance back, no orbiting. That is the render console's "walk"
 * mode, and the numbers here are its numbers, so a shot planned here frames the
 * way the console would frame it by hand.
 *
 * What this file does NOT decide is the exact camera or where the figure
 * stands. Both are worked out in the preview page, against the projection it is
 * actually drawing with, and travel back attached to the shot that was
 * approved. A camera derived twice is a camera that will eventually disagree
 * with itself, and the whole point of a preview is that it shows what will be
 * rendered.
 */

import { engine, pick, shelfDimensions, shareHash } from "./design-lab.mjs";

// The console's walking camera, in its own numbers (console/console.js).
const EYE_HEIGHT_MM = 1550;
const MIN_STANDOFF_MM = 1650;
const FOCUS_DROP_MM = 80;
const MIN_FOCUS_Z_MM = 350;
// The renderer's orbit camera and the console's render camera are both 38.
const FOV_DEG = 38;
// The scale figure the pipeline renders, which is also in the shot.
const FIGURE_HEIGHT_MM = 1800;
// A little air around the subject rather than a tight crop.
const FRAME_BUFFER = 1.08;
// How far past a run's end to leave room for the person to stand.
const FIGURE_ROOM_MM = 600;
// The real asset's diagonal, measured; see js/design-lab/shots.js.
const FIGURE_WIDTH_MM = 711;

/**
 * Which way the design faces, as a yaw.
 *
 * A shelf has a front, and the engine already knows which: every rotation has a
 * back axis and sign, so the front is the opposite of that. Summing over the
 * units gives the direction that faces the room — straight out for a plain run,
 * and the diagonal of the 90 degrees for a shelf that turns a corner.
 *
 * This is what keeps a corner shelf from being photographed from behind. The
 * inside of the angle is the only side both legs face, and it is the only side
 * worth standing on: from the other 270 degrees you are looking at the backs.
 */
function facingYawDeg(catalog, state) {
  // rotation -> the direction the front of a unit faces, from the engine's own
  // frame table: back is (backAxis, backSign), so front is its opposite.
  const FRONTS = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] };
  /*
   * The DISTINCT directions, not one per unit.
   *
   * Weighting by how many units face each way pulls the camera round towards
   * whichever leg is longer — on a corner with four units one side and two the
   * other it came out at 63 degrees off, and the arc of shots around it then
   * reached past the end of the 90-degree wedge and round the back of the short
   * leg. The bisector of the directions themselves is the middle of the wedge
   * whatever the legs are made of.
   */
  const quarters = new Set(state.instances
    .filter((instance) => (catalog.modules[instance.moduleId] || {}).role === "base")
    .map((instance) => ((Math.round((instance.rotationDeg || 0) / 90) * 90) % 360 + 360) % 360));
  const legs = quarters.size || 1;
  let x = 0;
  let y = 0;
  for (const quarter of quarters) {
    const front = FRONTS[quarter] || FRONTS[0];
    x += front[0];
    y += front[1];
  }
  // Facing directions that cancel (a run seen from both sides) leave nothing to
  // bisect; the default front is as good an answer as any.
  if (!quarters.size || (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6)) return { yawDeg: 0, legs };
  // eye = centre + (sin y, -cos y) * distance, so the yaw that looks along a
  // front direction f is atan2(fx, -fy).
  return { yawDeg: (Math.atan2(x, -y) * 180) / Math.PI, legs };
}

/**
 * How far back the camera has to be for the subject to fit the frame.
 *
 * Worked out rather than guessed at. The console's stand-off is a rule of thumb
 * over the shelf's width and depth, which is close enough looking straight on
 * and wrong at an angle: turned 40 degrees a 3m run presents its diagonal, and
 * a distance chosen for its width crops both ends off.
 *
 * So every corner of the subject is put into the camera's own frame — right, up
 * and forward — and the distance is the smallest that keeps all of them inside
 * the 38-degree field, plus a margin. Solved by iteration because the camera's
 * tilt depends on the distance and the distance depends on the tilt; three
 * passes is well past converged for these numbers.
 */
function fittingStandoff(subject, focus, yaw) {
  const half = Math.tan((FOV_DEG * Math.PI) / 360);
  const corners = [];
  for (const x of [subject[0], subject[3]]) {
    for (const y of [subject[1], subject[4]]) {
      for (const z of [subject[2], subject[5]]) corners.push([x, y, z]);
    }
  }

  let standOff = MIN_STANDOFF_MM;
  for (let pass = 0; pass < 3; pass += 1) {
    const eye = [
      focus[0] + Math.sin(yaw) * standOff,
      focus[1] - Math.cos(yaw) * standOff,
      EYE_HEIGHT_MM
    ];
    const away = [focus[0] - eye[0], focus[1] - eye[1], focus[2] - eye[2]];
    const span = Math.hypot(away[0], away[1], away[2]) || 1;
    const forward = [away[0] / span, away[1] / span, away[2] / span];
    // Right and up in the camera's own frame, world z being up.
    const right = [forward[1], -forward[0], 0];
    const rightLength = Math.hypot(right[0], right[1]) || 1;
    right[0] /= rightLength;
    right[1] /= rightLength;
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0]
    ];

    let needed = MIN_STANDOFF_MM;
    for (const corner of corners) {
      const delta = [corner[0] - focus[0], corner[1] - focus[1], corner[2] - focus[2]];
      const across = delta[0] * right[0] + delta[1] * right[1] + delta[2] * right[2];
      const above = delta[0] * up[0] + delta[1] * up[1] + delta[2] * up[2];
      const along = delta[0] * forward[0] + delta[1] * forward[1] + delta[2] * forward[2];
      // A point sits inside the frame when it is within the cone at its own
      // depth; the frame is square, so across and above share the half-angle.
      needed = Math.max(needed,
        (Math.abs(across) * FRAME_BUFFER) / half - along,
        (Math.abs(above) * FRAME_BUFFER) / half - along);
    }
    // `needed` is along the view; the shot is described by its distance across
    // the floor, so take the height out of it again.
    const drop = EYE_HEIGHT_MM - focus[2];
    standOff = Math.sqrt(Math.max(MIN_STANDOFF_MM * MIN_STANDOFF_MM, needed * needed - drop * drop));
  }
  return Math.round(standOff);
}

/**
 * Where the person stands, and what they look at.
 *
 * Straight on is one shot out of four and rarely the best one, so the arc runs
 * from well off to one side to well off to the other. The stand-off is the
 * console's: far enough back that a wide shelf still fits, never closer than
 * about a metre and a half, which is where a room stops feeling like a room.
 *
 * The arc is centred on the way the design faces, and narrowed where it turns a
 * corner: the wedge between two legs is 90 degrees wide, so anything past 45
 * from its middle is round the back of one of them.
 */
function walkPositions(bounds, angles, facing, anchors) {
  const centre = [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2];
  const width = Math.max(400, bounds[3] - bounds[0]);
  const depth = Math.max(250, bounds[4] - bounds[1]);

  /*
   * The shot contains a shelf AND a person, so it is framed on both.
   *
   * The console's walking camera frames the shelf alone, which is right when
   * that is all there is. Beside a 724mm shelf it put the camera 1.65m away
   * looking at 355mm off the floor — and a 1.8m figure standing next to it had
   * its head a hundred pixels above the top of the frame, at every angle and
   * every distance. There was no placement to find, because the person did not
   * fit in the picture.
   *
   * So the eye looks at the middle of what has to be in shot, and stands far
   * enough back that the whole of it fits the 38-degree field.
   */
  const tallest = Math.max(bounds[5], FIGURE_HEIGHT_MM);
  const focusZ = Math.max(MIN_FOCUS_Z_MM, Math.min(EYE_HEIGHT_MM - FOCUS_DROP_MM, tallest / 2));
  const focus = [centre[0], centre[1], Math.round(focusZ)];

  /*
   * Everything that has to be in shot: the shelf, and the figure where it will
   * actually stand.
   *
   * Where it will actually stand, not a blanket margin all round. Adding 700mm
   * to every side put a 2m-deep L-shape's near corners a metre closer to the
   * camera and a metre further off-axis at once, and the distance needed to
   * keep them in frame came out at nearly seven metres for a shelf 800mm wide.
   * The anchors say which two ends a person can stand at; nothing has to be
   * left in shot for the two sides where nobody will be.
   */
  const shelf = [bounds[0], bounds[1], 0, bounds[3], bounds[4], tallest];
  // One subject per end, because only one end gets the figure. Framing for both
  // reserves room at a side nobody will stand at, and on a 2.2m run that alone
  // pushed the camera from four metres back to six.
  const subjects = anchors.length ? anchors.map((anchor) => {
    const x = anchor.pointMm[0] + anchor.outMm[0] * FIGURE_ROOM_MM;
    const y = anchor.pointMm[1] + anchor.outMm[1] * FIGURE_ROOM_MM;
    return [
      Math.min(shelf[0], x - FIGURE_WIDTH_MM / 2),
      Math.min(shelf[1], y - FIGURE_WIDTH_MM / 2),
      0,
      Math.max(shelf[3], x + FIGURE_WIDTH_MM / 2),
      Math.max(shelf[4], y + FIGURE_WIDTH_MM / 2),
      tallest
    ];
  }) : [shelf];

  // Never closer than the console's own walking distance, which is where a
  // room stops feeling like a room however small the shelf is.
  const floor = Math.max(MIN_STANDOFF_MM, depth * 1.75, width * 0.72);

  const shots = [];
  // Inside a 90-degree wedge, +-40 leaves five degrees of margin at each end.
  const spread = facing.legs > 1 ? 80 : 84;
  for (let index = 0; index < angles; index += 1) {
    const offsetDeg = angles === 1 ? 0 : -spread / 2 + (spread * index) / (angles - 1);
    const yawDeg = facing.yawDeg + offsetDeg;
    const yaw = (yawDeg * Math.PI) / 180;
    // The end that frames closest wins, and the page is told which so it puts
    // the figure at the end the camera was chosen for.
    let standOff = Infinity;
    let anchorIndex = 0;
    subjects.forEach((candidate, index) => {
      const distance = fittingStandoff(candidate, focus, yaw);
      if (distance < standOff) {
        standOff = distance;
        anchorIndex = index;
      }
    });
    standOff = Math.max(floor, standOff);
    shots.push({
      yawDeg: Math.round(offsetDeg),
      facingYawDeg: Math.round(facing.yawDeg),
      anchorIndex,
      eyeMm: [
        Math.round(centre[0] + Math.sin(yaw) * standOff),
        Math.round(centre[1] - Math.cos(yaw) * standOff),
        EYE_HEIGHT_MM
      ],
      focusMm: focus.map(Math.round)
    });
  }
  return shots;
}

/**
 * Where the figure may stand: off the open end of a run, never at the corner.
 *
 * A person standing in the inside angle of an L is standing in the shelf, and
 * the render has nowhere to put them that is not against one leg or the other.
 * The ends are the only places a person naturally stands beside a shelf, so
 * they are the only ones offered — and an end that another leg runs past is not
 * an end, it is the corner.
 */
function figureAnchors(catalog, state) {
  const runs = engine.spacingRuns(catalog, state);
  const anchors = [];

  for (const run of runs) {
    const axis = run.axis;
    const across = axis === 0 ? 1 : 0;
    const boxes = run.units.map((unit) => engine.instanceBounds(catalog, unit));
    const low = Math.min(...boxes.map((box) => box[axis]));
    const high = Math.max(...boxes.map((box) => box[axis + 3]));
    const middle = (Math.min(...boxes.map((box) => box[across]))
      + Math.max(...boxes.map((box) => box[across + 3]))) / 2;

    for (const [edge, direction] of [[low, -1], [high, 1]]) {
      const point = [0, 0];
      point[axis] = edge;
      point[across] = middle;
      const out = [0, 0];
      out[axis] = direction;

      // Is another leg running past this end? Then it is the corner, not an end.
      const blocked = runs.some((other) => {
        if (other === run) return false;
        return other.units.some((unit) => {
          const box = engine.instanceBounds(catalog, unit);
          const beyond = direction > 0 ? box[axis + 3] > edge - 1 : box[axis] < edge + 1;
          const alongside = box[across] < middle + 900 && box[across + 3] > middle - 900;
          return beyond && alongside;
        });
      });
      if (blocked) continue;
      anchors.push({ pointMm: point.map(Math.round), outMm: out });
    }
  }
  return anchors;
}


/**
 * Every shot for one judged design.
 *
 * `random` picks the colours, so the caller decides whether a corpus is
 * reproducible (a seeded generator) or a session is varied (Math.random).
 */
export function planShotsFor(catalog, row, options) {
  const settings = options || {};
  const angles = settings.angles || 4;
  const random = settings.random || Math.random;
  const finishes = settings.finishes || catalog.finishes.map((finish) => finish.id);

  const state = engine.deserializeState(catalog, row.design);
  const bounds = engine.designBounds(catalog, state);
  if (!bounds) return [];

  const facing = facingYawDeg(catalog, state);
  const anchors = figureAnchors(catalog, state);
  const hash = shareHash(state);
  const size = shelfDimensions(catalog, state);

  return walkPositions(bounds, angles, facing, anchors).map((position) => ({
    id: `${row.code}-y${position.yawDeg >= 0 ? "p" : "m"}${Math.abs(position.yawDeg)}`,
    code: row.code,
    supersedes: row.supersedes || null,
    note: row.note || "",
    yawDeg: position.yawDeg,
    facingYawDeg: position.facingYawDeg,
    eyeMm: position.eyeMm,
    focusMm: position.focusMm,
    // One colour for the whole shelf, rolled per shot: it samples the finishes
    // across the set as a side effect of sampling the angles.
    finish: pick(random, finishes),
    boundsMm: bounds.map(Math.round),
    legs: facing.legs,
    anchorIndex: position.anchorIndex,
    figureAnchors: anchors,
    shareHash: hash,
    shelfSizeMm: size,
    pieceCount: state.instances.length,
    design: row.design
  }));
}

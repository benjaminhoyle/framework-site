/**
 * Drawing a shot: the camera, the figure, and the picture.
 *
 * Shared by the shot bench and the studio flow, because the camera a shot is
 * previewed through is the camera it is rendered through — and two copies of
 * that derivation would eventually be two cameras.
 *
 * Everything here is about matching what Blender will do:
 *
 *   - the walking-person eye point becomes the shared renderer's orbit camera
 *     exactly as the render console does it;
 *   - the figure's footprint is the real asset's, measured, not a guess;
 *   - the frame is judged with the snapshot's own projector, because the live
 *     camera and canvas size are gone by the time the pixels exist.
 */
window.FrameworkShotPreview = (function () {
  "use strict";

  const engine = window.FrameworkDesignerEngine;

  const SURFACE_GAIN = 1.07;
  const STEEL_GAIN = 1.26;
  const MIN_LOOK_DISTANCE_MM = 400;

  const FIGURE_HEIGHT_MM = 1800;
  /*
   * The real asset's footprint, measured off assets/render/scale-figure-woman.obj
   * in the pipeline: scaled to 1.8m tall it is 549 x 451mm, and its diagonal is
   * 711mm. The diagonal is what matters, because the render chooses the
   * figure's yaw itself and a circle of that diameter is the only footprint
   * that holds whichever way it ends up turned.
   *
   * A guessed 480 x 280 box was 40% too narrow and put an arm out of frame in
   * every render of the first run. It is a scanned person with a hand raised to
   * her head, not a cylinder.
   */
  const FIGURE_SPAN_MM = 711;
  const FIGURE_STEP_MM = 40;
  const FIGURE_MAX_NUDGE_MM = 2000;
  const CLEAR_GAP = 0.015;
  const FRAME_MARGIN = 0.02;
  // How much further back to stand, tried in order. 1 is the planned distance.
  const STAND_BACK_STEPS = [1, 1.2, 1.45, 1.75, 2.1];
  // Small enough to be cheap, and only ever used for its projector.
  const PROBE_PX = 160;

  // ------------------------------------------------------------- colours ---

  function scaleHex(hex, gain) {
    const value = parseInt(String(hex).replace("#", ""), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
      .map((channel) => Math.min(255, Math.round(channel * gain)));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  function shaderPalette(finish) {
    return {
      surface: scaleHex(finish.builder.surface, SURFACE_GAIN),
      steel: scaleHex(finish.builder.steel, STEEL_GAIN)
    };
  }

  function renderInstance(catalog, instance) {
    const module = catalog.modules[instance.moduleId];
    const pivot = engine.localPivot(module);
    return {
      id: instance.id,
      moduleId: instance.moduleId,
      translation: instance.translation,
      rotationDeg: instance.rotationDeg || 0,
      pivotMm: [instance.translation[0] + pivot[0], instance.translation[1] + pivot[1]],
      boundsMm: engine.instanceBounds(catalog, instance),
      highlight: false,
      palette: null,
      muted: false
    };
  }

  // -------------------------------------------------------------- camera ---

  function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function length3(v) { return Math.hypot(v[0], v[1], v[2]); }
  function normalise3(v, fallback) {
    const len = length3(v);
    return len < 1e-6 ? fallback.slice() : [v[0] / len, v[1] / len, v[2] / len];
  }

  /**
   * Point the renderer at a shot, and hand back the world point it looks at.
   *
   * A straight port of the render console's applyWalkingCamera: its orbit
   * camera is exactly an eye point around a target, and a point-sized fit is
   * how the console sets that target without a console-only renderer API.
   *
   * `focusOverride` recentres the frame while keeping the shot's own angle and
   * distance, which is how the picture ends up centred on the shelf AND the
   * person rather than on one of them.
   */
  function aimAt(renderer, shot, standBack, focusOverride) {
    const focus = focusOverride || shot.focusMm;
    const anchor = shot.focusMm;
    const back = standBack || 1;
    const eye = [
      focus[0] + (shot.eyeMm[0] - anchor[0]) * back,
      focus[1] + (shot.eyeMm[1] - anchor[1]) * back,
      shot.eyeMm[2]
    ];
    const base = normalise3(subtract(focus, eye), [0, 1, -0.08]);
    const yaw = Math.atan2(base[0], base[1]);
    const pitch = Math.asin(Math.max(-1, Math.min(1, base[2])));
    const horizontal = Math.cos(pitch);
    const reach = Math.max(MIN_LOOK_DISTANCE_MM, length3(subtract(focus, eye)));
    const target = [
      eye[0] + Math.sin(yaw) * horizontal * reach,
      eye[1] + Math.cos(yaw) * horizontal * reach,
      eye[2] + Math.sin(pitch) * reach
    ];
    const offset = subtract(eye, target);
    const distance = Math.max(MIN_LOOK_DISTANCE_MM, length3(offset));
    const direction = normalise3(offset, [0, -1, 0]);

    renderer.setViewMode("orbit");
    renderer.fit([target[0], target[1], target[2], target[0], target[1], target[2]], 1);
    renderer.setOrbit({
      azimuthDeg: (Math.atan2(direction[0], -direction[1]) * 180) / Math.PI,
      elevationDeg: (Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180) / Math.PI,
      distanceMm: distance
    });
    return target;
  }

  /** Frame exactly at `target` — a point-sized box is how you say "do not reframe". */
  function snapshotAt(renderer, target, size) {
    return renderer.snapshot({
      width: size,
      height: size,
      boundsMm: [target[0], target[1], target[2], target[0], target[1], target[2]]
    });
  }

  // -------------------------------------------------------------- figure ---

  function boxOf(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (!point) return null;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function projectBox(project, bounds) {
    const corners = [];
    for (const x of [bounds[0], bounds[3]]) {
      for (const y of [bounds[1], bounds[4]]) {
        for (const z of [bounds[2], bounds[5]]) corners.push(project([x, y, z]));
      }
    }
    return boxOf(corners);
  }

  function overlapArea(a, b) {
    const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    return width > 0 && height > 0 ? width * height : 0;
  }

  /**
   * The box the figure occupies, `out` millimetres past an anchor.
   *
   * Anchors are the open ends of the design's runs — never the inside of a
   * corner, where a person would be standing in the shelf, and never the middle
   * of a run, where they would be standing in front of it.
   *
   * It stands at the run's own depth, which is where the render pipeline puts
   * the figure by default. A figure a few hundred millimetres in FRONT of the
   * shelf is a metre and a half nearer a camera two and a half metres away, so
   * it projects half as tall again and crops out of the top of every frame.
   */
  function figureBounds(anchor, out) {
    const x = anchor.pointMm[0] + anchor.outMm[0] * out;
    const y = anchor.pointMm[1] + anchor.outMm[1] * out;
    return [
      x - FIGURE_SPAN_MM / 2, y - FIGURE_SPAN_MM / 2, 0,
      x + FIGURE_SPAN_MM / 2, y + FIGURE_SPAN_MM / 2, FIGURE_HEIGHT_MM
    ];
  }

  /**
   * Stand the figure at whichever end works, as close in as it can be.
   *
   * Where nothing clears — a shelf wide enough to fill the frame — the least
   * obstructive position that is still fully in shot wins, because a figure
   * half out of frame is worse than one slightly overlapping.
   */
  function placeFigure(shot, snapshot) {
    const project = snapshot.project;
    const width = snapshot.width;
    const height = snapshot.height;
    const shelf = projectBox(project, shot.boundsMm);
    const anchors = shot.figureAnchors || [];
    if (!shelf || !anchors.length) return null;

    const ordered = anchors.slice();
    const preferred = shot.anchorIndex || 0;
    if (ordered[preferred]) ordered.unshift(ordered.splice(preferred, 1)[0]);

    const clearance = Math.max(width, height) * CLEAR_GAP;
    const marginX = width * FRAME_MARGIN;
    const marginY = height * FRAME_MARGIN;

    let best = null;
    let fallback = null;
    for (const anchor of ordered) {
      for (let step = 0; step * FIGURE_STEP_MM <= FIGURE_MAX_NUDGE_MM; step += 1) {
        const out = FIGURE_SPAN_MM / 2 + step * FIGURE_STEP_MM;
        const bounds = figureBounds(anchor, out);
        const box = projectBox(project, bounds);
        if (!box) continue;
        const inFrame = box.minX >= marginX && box.maxX <= width - marginX
          && box.minY >= marginY && box.maxY <= height - marginY;
        const grown = {
          minX: box.minX - clearance, maxX: box.maxX + clearance,
          minY: box.minY - clearance, maxY: box.maxY + clearance
        };
        const overlap = overlapArea(grown, shelf);
        const position = [
          Math.round((bounds[0] + bounds[3]) / 2),
          Math.round((bounds[1] + bounds[4]) / 2),
          0
        ];
        if (inFrame && !overlap) {
          if (!best || out < best.outMm) best = { positionMm: position, outMm: out, box, clear: true };
          break;
        }
        // How badly it misses, not whether it misses: a flat penalty made every
        // distance equally bad and the search kept the closest camera, which is
        // the one with least room.
        const area = (box.maxX - box.minX) * (box.maxY - box.minY);
        const inside = overlapArea(box, {
          minX: marginX, minY: marginY, maxX: width - marginX, maxY: height - marginY
        });
        const penalty = overlap * 2 + Math.max(0, area - inside);
        if (!fallback || penalty < fallback.penalty) {
          fallback = { positionMm: position, outMm: out, box, penalty, clear: false, inFrame };
        }
      }
    }
    return best || fallback;
  }

  /**
   * The figure, marked. NOT the figure that gets rendered.
   *
   * Blender puts a scanned human in the shot. What this draws is a placeholder
   * at exactly the height and position the real one will occupy, so what is
   * being judged — does she stand clear, in frame, at a believable size — is
   * judged truthfully. Drawn as an outline for that reason: a silhouette
   * invites you to look at its face.
   */
  function drawFigure(context, box) {
    const height = box.maxY - box.minY;
    const midX = (box.minX + box.maxX) / 2;
    const half = height * 0.093;
    const headR = height * 0.055;
    context.save();
    context.strokeStyle = "rgba(70, 78, 84, 0.75)";
    context.setLineDash([5, 4]);
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(midX, box.minY + headR, headR, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(midX - half, box.maxY);
    context.lineTo(midX - half, box.minY + headR * 2.5);
    context.lineTo(midX + half, box.minY + headR * 2.5);
    context.lineTo(midX + half, box.maxY);
    context.stroke();
    context.setLineDash([]);
    context.font = "500 11px -apple-system, system-ui, sans-serif";
    context.fillStyle = "rgba(70, 78, 84, 0.85)";
    context.textAlign = "center";
    context.fillText("1.8 m", midX, box.maxY + 14);
    context.restore();
  }

  function paint(snapshot, figure) {
    const canvas = document.createElement("canvas");
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(snapshot.width, snapshot.height);
    const rowBytes = snapshot.width * 4;
    for (let row = 0; row < snapshot.height; row += 1) {
      const from = (snapshot.height - 1 - row) * rowBytes;
      image.data.set(snapshot.pixels.subarray(from, from + rowBytes), row * rowBytes);
    }
    context.putImageData(image, 0, 0);
    if (figure) drawFigure(context, figure.box);
    return canvas.toDataURL("image/png");
  }

  // ---------------------------------------------------------------- draw ---

  /**
   * Draw one shot: choose how far back to stand, place the figure, recentre on
   * the pair, and take the picture. Returns the image and the camera and figure
   * that produced it — which is what an approved shot carries to Blender.
   */
  function draw(renderer, catalog, shot, state, finish, size) {
    renderer.setPalette(shaderPalette(finish));
    renderer.setInstances(state.instances.map((instance) => renderInstance(catalog, instance)));

    /*
     * How far back to stand is decided by whether a person fits beside the
     * shelf, and then by how close in she can stand. Stopping at the first
     * distance that merely worked left her marooned nearly three metres past
     * the end of a run, because from there the shelf's projected box is wide
     * and the way out of it runs along the line of sight.
     */
    let best = null;
    for (const standBack of STAND_BACK_STEPS) {
      const target = aimAt(renderer, shot, standBack);
      const probe = snapshotAt(renderer, target, PROBE_PX);
      const figure = placeFigure(shot, probe);
      const attempt = { standBack, figure };
      if (!best) {
        best = attempt;
        continue;
      }
      const wasClear = Boolean(best.figure && best.figure.clear);
      const isClear = Boolean(figure && figure.clear);
      if (isClear !== wasClear) {
        if (isClear) best = attempt;
      } else if (isClear) {
        if (figure.outMm < best.figure.outMm) best = attempt;
      } else if (figure && (!best.figure || figure.penalty < best.figure.penalty)) {
        best = attempt;
      }
    }

    // Aim at the middle of what is in shot — the shelf AND the person. Aimed at
    // the shelf alone the pair sits to one side with a third of the picture
    // empty. Her position is only known once placed, so this is a second pass.
    let target = aimAt(renderer, shot, best.standBack);
    if (best.figure) {
      target = aimAt(renderer, shot, best.standBack, [
        (Math.min(shot.boundsMm[0], best.figure.positionMm[0]) + Math.max(shot.boundsMm[3], best.figure.positionMm[0])) / 2,
        (Math.min(shot.boundsMm[1], best.figure.positionMm[1]) + Math.max(shot.boundsMm[4], best.figure.positionMm[1])) / 2,
        shot.focusMm[2]
      ]);
    }
    const camera = renderer.getCamera();
    const snapshot = snapshotAt(renderer, target, size);
    const figure = placeFigure(shot, snapshot);
    return { image: paint(snapshot, figure), camera, figure, standBack: best.standBack };
  }

  return {
    FIGURE_HEIGHT_MM,
    FIGURE_SPAN_MM,
    aimAt,
    draw,
    drawFigure,
    figureBounds,
    paint,
    placeFigure,
    projectBox,
    renderInstance,
    shaderPalette,
    snapshotAt
  };
})();

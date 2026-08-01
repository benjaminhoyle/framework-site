/**
 * Framework shelving placement engine.
 *
 * Pure logic: no DOM, no WebGL. Ported from the desktop builder's core
 * (shelving-3d-pipeline/app/js/shelving-builder-v2-core.js), which is validated
 * against the Python pipeline's golden configs; scripts/test-builder.mjs
 * re-runs those same fixtures against this copy.
 *
 * Two things are new here, both for the website:
 *
 *  1. `options.adjacentBasesOnly` -- the Simple and Standard interfaces only
 *     let a run grow by butting units directly against each other, matching the
 *     current /designer page. Advanced additionally offers the gapped intervals
 *     that bridge/adapter spans need.
 *
 *  2. Candidate generation validates *incrementally*. The desktop version
 *     re-validated the entire assembly once per candidate per module, which is
 *     O(modules x candidates x instances^2) -- a few hundred milliseconds of
 *     main-thread jank per click on a mid-range phone. Adding one module can
 *     only introduce a conflict that involves that module, so validateAddition
 *     checks the candidate against a snapshot of the existing assembly instead.
 *     The full validateState is still what reports on a finished design.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FrameworkDesignerEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TOLERANCE_MM = 1;
  const ROUND_PLACES = 3;
  const BASE_INTERVALS_MM = [440, 703, 1143];
  const ADJACENT_BASE_GAP_MM = 30;
  const OVERLAP_TOLERANCE_MM = 2;

  function rounded(value, places = ROUND_PLACES) {
    if (Math.abs(value) < Math.pow(10, -places)) return 0;
    return Number(value.toFixed(places));
  }

  function close(a, b, tolerance = TOLERANCE_MM) {
    return Math.abs(Number(a) - Number(b)) <= tolerance;
  }

  function pointKey(x, y) {
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function socketKind(module, kind) {
    return (module.sockets || []).filter((socket) => socket.kind === kind);
  }

  function rotationSockets(module) {
    return socketKind(module, "bottom").length ? socketKind(module, "bottom")
      : socketKind(module, "floor").length ? socketKind(module, "floor")
        : socketKind(module, "top");
  }

  function rotationPivot(module) {
    const sockets = rotationSockets(module);
    if (!sockets.length) return [0, 0];
    const points = sockets.map((socket) => socket.normalized_mm || [0, 0]);
    const xs = points.map((point) => Number(point[0]) || 0);
    const ys = points.map((point) => Number(point[1]) || 0);
    return [
      (Math.min(...xs) + Math.max(...xs)) * 0.5,
      (Math.min(...ys) + Math.max(...ys)) * 0.5
    ];
  }

  function rotatedOffset(module, socket, rotationDeg) {
    const [x, y] = socket.normalized_mm || [0, 0];
    const rotation = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
    if (!rotation) return [Number(x) || 0, Number(y) || 0];
    const [pivotX, pivotY] = rotationPivot(module);
    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = (Number(x) || 0) - pivotX;
    const dy = (Number(y) || 0) - pivotY;
    return [
      rounded(pivotX + dx * cos - dy * sin),
      rounded(pivotY + dx * sin + dy * cos)
    ];
  }

  function originSocket(module, kind) {
    const match = socketKind(module, kind).find((socket) => {
      const [x, y] = socket.normalized_mm || [0, 0];
      return close(x, 0) && close(y, 0);
    });
    if (!match) throw new Error(`${module.id} has no ${kind} socket at normalized origin`);
    return match;
  }

  function normalizeCatalog(rawCatalog) {
    const modules = {};
    const aliases = Object.assign({}, rawCatalog.aliases || {});
    for (const [id, module] of Object.entries(rawCatalog.modules || {})) {
      modules[id] = Object.assign({}, module, {
        id,
        canonicalId: module.canonicalId || aliases[id] || id,
        role: module.role === "adapter" && id === "booster_adapter" ? "booster_adapter" : module.role,
        sockets: module.sockets || [],
        horizontalBoxes: module.horizontalBoxes || []
      });
    }
    return Object.assign({}, rawCatalog, { modules, aliases });
  }

  function moduleFor(catalog, moduleId) {
    const id = moduleId in catalog.modules ? moduleId : catalog.aliases && catalog.aliases[moduleId];
    const module = catalog.modules[id] || catalog.modules[moduleId];
    if (!module) throw new Error(`Unknown module type: ${moduleId}`);
    return module;
  }

  function createState(catalog, fields) {
    return Object.assign({
      schemaVersion: 1,
      catalogVersion: catalog.schemaVersion || 1,
      instances: [],
      nextInstanceNumber: 1,
      finish: "sage",
      bookends: 0
    }, fields || {});
  }

  function worldSocket(instance, socket, module) {
    const [tx, ty, tz] = instance.translation;
    const [, , z] = socket.local_mm;
    const [nx, ny] = module ? rotatedOffset(module, socket, instance.rotationDeg || 0) : socket.normalized_mm || [0, 0];
    return {
      instanceId: instance.id,
      moduleId: instance.moduleId,
      socketId: socket.id,
      kind: socket.kind,
      worldMm: module ? [
        rounded(instance.originWorldMm[0] + nx),
        rounded(instance.originWorldMm[1] + ny),
        rounded(tz + z)
      ] : [rounded(tx + socket.local_mm[0]), rounded(ty + socket.local_mm[1]), rounded(tz + z)],
      normalizedMm: [nx, ny, 0]
    };
  }

  function topProviders(catalog, state, allowedProviderIds) {
    const consumed = consumedSupportKeys(catalog, state);
    const providers = new Map();
    for (const instance of state.instances) {
      if (allowedProviderIds && !allowedProviderIds.has(instance.id)) continue;
      const module = moduleFor(catalog, instance.moduleId);
      for (const socket of socketKind(module, "top")) {
        const provider = worldSocket(instance, socket, module);
        const supportKey = `${provider.instanceId}:${provider.socketId}:${rounded(provider.worldMm[2], 1)}`;
        if (consumed.has(supportKey)) continue;
        const [x, y] = provider.worldMm;
        const key = pointKey(x, y);
        if (!providers.has(key)) providers.set(key, []);
        providers.get(key).push(provider);
      }
    }
    for (const values of providers.values()) {
      values.sort((a, b) => b.worldMm[2] - a.worldMm[2] || a.instanceId.localeCompare(b.instanceId));
    }
    return providers;
  }

  function providerCandidates(providers, x, y) {
    const matches = [];
    for (const [key, values] of providers.entries()) {
      const parts = key.split(",");
      if (close(Number(parts[0]), x) && close(Number(parts[1]), y)) matches.push.apply(matches, values);
    }
    matches.sort((a, b) => b.worldMm[2] - a.worldMm[2] || a.instanceId.localeCompare(b.instanceId));
    return matches;
  }

  function consumedSupportKeys(catalog, state) {
    const keys = new Set();
    for (const instance of state.instances) {
      for (const support of instance.consumedSockets || []) {
        const z = support.worldMm ? support.worldMm[2] : (instance.supportPlaneZ || 0);
        keys.add(`${support.instanceId}:${support.socketId}:${rounded(z, 1)}`);
      }
    }
    return keys;
  }

  function baseTranslation(module, originX, originY) {
    const socket = originSocket(module, "floor");
    const [localX, localY, localZ] = socket.local_mm;
    return [rounded(originX - localX), rounded(originY - localY), rounded(0 - localZ)];
  }

  /**
   * How a unit turned by `rotationDeg` lies in the world.
   *
   * A run grows along the unit's own width (local +X) and its back is its local
   * +Y face. Under a quarter turn those become world axes with a sign, and
   * everything about placing the next unit -- butting it against this one,
   * lining their backs up, turning a corner -- is expressed in those terms
   * rather than in x and y. That is what lets a run continue along a wall that
   * is not the x axis.
   */
  const ROTATION_FRAMES = {
    0: { runAxis: 0, runSign: 1, backAxis: 1, backSign: 1 },
    90: { runAxis: 1, runSign: 1, backAxis: 0, backSign: -1 },
    180: { runAxis: 0, runSign: -1, backAxis: 1, backSign: -1 },
    270: { runAxis: 1, runSign: -1, backAxis: 0, backSign: 1 }
  };

  function normaliseQuarterTurn(degrees) {
    const rotation = ((Math.round(Number(degrees) || 0) % 360) + 360) % 360;
    return ROTATION_FRAMES[rotation] ? rotation : 0;
  }

  function frameOf(rotationDeg) {
    return ROTATION_FRAMES[normaliseQuarterTurn(rotationDeg)];
  }

  /** Index into a bounds array of the face an axis+sign points at. */
  function edgeIndex(axis, sign) {
    return sign > 0 ? axis + 3 : axis;
  }

  function baseBounds(catalog, module, rotationDeg, originX, originY) {
    return instanceBounds(catalog, {
      moduleId: module.id,
      translation: baseTranslation(module, originX, originY),
      rotationDeg
    });
  }

  /** World extent of an instance's own sockets, which is what backs align on. */
  function socketBounds(instance, module) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const socket of rotationSockets(module)) {
      const [dx, dy] = rotatedOffset(module, socket, instance.rotationDeg || 0);
      const x = instance.originWorldMm[0] + dx;
      const y = instance.originWorldMm[1] + dy;
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
    return Number.isFinite(bounds[0]) ? [bounds[0], bounds[1], 0, bounds[2], bounds[3], 0] : null;
  }

  /**
   * World extent of an instance's shelf surfaces -- the boards, without the
   * feet and stubs its bounding box also carries. This is the surface a design
   * reads as continuous, so it is what a corner has to line up.
   */
  function shelfBounds(catalog, instance) {
    const module = moduleFor(catalog, instance.moduleId);
    const boxes = collectHorizontalBoxes(catalog, [instance]);
    if (!boxes.length) return instanceBounds(catalog, instance);
    const bounds = boxes[0].bbox.slice();
    for (const box of boxes) {
      for (let axis = 0; axis < 3; axis += 1) {
        bounds[axis] = Math.min(bounds[axis], box.bbox[axis]);
        bounds[axis + 3] = Math.max(bounds[axis + 3], box.bbox[axis + 3]);
      }
    }
    return bounds.map(rounded);
  }

  /**
   * Where a unit has to stand for the named faces to land where we want them.
   *
   * Bounds move one-for-one with the origin, so one probe placement is enough
   * to solve both axes -- no search, and it works for any rotation.
   */
  function baseOriginForFaces(catalog, module, rotationDeg, targets) {
    const probe = {
      moduleId: module.id,
      originWorldMm: [0, 0, 0],
      translation: baseTranslation(module, 0, 0),
      rotationDeg
    };
    const probeBox = instanceBounds(catalog, probe);
    const probes = {
      box: probeBox,
      sockets: socketBounds(probe, module) || probeBox,
      shelf: shelfBounds(catalog, probe)
    };
    const origin = [0, 0];
    for (const target of targets) {
      const bounds = probes[target.measure || "box"];
      origin[target.axis] = rounded(target.value - bounds[edgeIndex(target.axis, target.sign)]);
    }
    return { x: origin[0], y: origin[1] };
  }

  function stackInstanceIds(state, baseInstanceId) {
    const childrenOf = new Map();
    for (const instance of state.instances) {
      for (const support of instance.consumedSockets || []) {
        if (!childrenOf.has(support.instanceId)) childrenOf.set(support.instanceId, []);
        childrenOf.get(support.instanceId).push(instance.id);
      }
    }
    const ids = new Set([baseInstanceId]);
    const queue = [baseInstanceId];
    while (queue.length) {
      const current = queue.shift();
      for (const childId of childrenOf.get(current) || []) {
        if (ids.has(childId)) continue;
        ids.add(childId);
        queue.push(childId);
      }
    }
    return ids;
  }

  /**
   * The footprint of a base plus everything standing on it.
   *
   * A run whose shelves overhang wider than the base itself has to clear the
   * whole stack, not just the base's own feet.
   */
  function stackBounds(catalog, state, baseInstance) {
    const bounds = instanceBounds(catalog, baseInstance).slice();
    const stackIds = stackInstanceIds(state, baseInstance.id);
    const boxes = collectHorizontalBoxes(catalog, state.instances.filter((instance) => stackIds.has(instance.id)));
    for (const box of boxes) {
      for (let axis = 0; axis < 3; axis += 1) {
        bounds[axis] = Math.min(bounds[axis], box.bbox[axis]);
        bounds[axis + 3] = Math.max(bounds[axis + 3], box.bbox[axis + 3]);
      }
    }
    return bounds.map(rounded);
  }

  function supportedPlacement(catalog, state, moduleId, originX, originY, allowedProviderIds, rotationDeg, providersOverride) {
    const module = moduleFor(catalog, moduleId);
    const required = socketKind(module, "bottom");
    if (!required.length) throw new Error(`${module.id} has no bottom sockets`);

    const providers = providersOverride || topProviders(catalog, state, allowedProviderIds);
    const groups = required.map((socket) => {
      const [nx, ny] = rotatedOffset(module, socket, rotationDeg || 0);
      return { socket, candidates: providerCandidates(providers, originX + nx, originY + ny) };
    });
    const missing = groups.filter((group) => !group.candidates.length);
    if (missing.length) {
      return { ok: false, reason: `missing support for ${missing.map((group) => group.socket.id).join(", ")}` };
    }

    const possibleZ = Array.from(
      new Set(groups.reduce((all, group) => all.concat(group.candidates.map((provider) => rounded(provider.worldMm[2]))), []))
    ).sort((a, b) => b - a);
    const targetZ = possibleZ.find((z) =>
      groups.every((group) => group.candidates.some((provider) => close(provider.worldMm[2], z)))
    );
    if (targetZ === undefined) {
      const detail = groups
        .map((group) => `${group.socket.id}: [${group.candidates.map((p) => `${p.instanceId}@${p.worldMm[2]}`).join(", ")}]`)
        .join("; ");
      return { ok: false, reason: `support sockets are not coplanar (${detail})` };
    }

    const matches = groups.map((group) => {
      const provider = group.candidates.find((candidate) => close(candidate.worldMm[2], targetZ));
      return {
        bottomSocket: group.socket.id,
        instanceId: provider.instanceId,
        moduleId: provider.moduleId,
        socketId: provider.socketId,
        worldMm: provider.worldMm
      };
    });
    const origin = originSocket(module, "bottom");
    const [localX, localY, localZ] = origin.local_mm;
    return {
      ok: true,
      translation: [rounded(originX - localX), rounded(originY - localY), rounded(targetZ - localZ)],
      supportPlaneZ: rounded(targetZ),
      consumedSockets: matches
    };
  }

  function createInstance(catalog, state, moduleId, originX, originY, fields) {
    const module = moduleFor(catalog, moduleId);
    const id = (fields && fields.id) || `item_${String(state.nextInstanceNumber || state.instances.length + 1).padStart(3, "0")}`;
    if (state.instances.some((instance) => instance.id === id)) {
      throw new Error(`Instance id "${id}" already exists`);
    }
    const placement = (fields && fields.placement) || {};
    let translation;
    let supportPlaneZ = 0;
    let consumedSockets = [];

    if (placement.method === "floor" || (module.role === "base" && placement.method !== "socket")) {
      translation = baseTranslation(module, originX, originY);
      supportPlaneZ = 0;
    } else {
      const allowed = placement.on ? new Set(Array.isArray(placement.on) ? placement.on : [placement.on]) : null;
      const snap = supportedPlacement(catalog, state, module.id, originX, originY, allowed, (fields && fields.rotationDeg) || 0);
      if (!snap.ok) throw new Error(`${id}: ${snap.reason}`);
      translation = snap.translation;
      supportPlaneZ = snap.supportPlaneZ;
      consumedSockets = snap.consumedSockets;
    }

    return {
      id,
      moduleId: module.id,
      canonicalId: module.canonicalId,
      originWorldMm: [rounded(originX), rounded(originY), rounded(supportPlaneZ)],
      translation,
      rotationDeg: (fields && fields.rotationDeg) || 0,
      supportPlaneZ,
      consumedSockets,
      placement,
      // A colour of its own, overriding the design's. Null means "match the
      // rest", which is what almost every piece is. Nothing about placement
      // depends on it -- it rides along so that a piece keeps its colour through
      // a rebuild, an undo, or a share link.
      finish: (fields && fields.finish) || null
    };
  }

  function nextInstanceNumberFor(instances) {
    let max = 0;
    for (const instance of instances) {
      const match = /^item_(\d+)$/.exec(instance.id || "");
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }

  function addInstance(catalog, state, moduleId, originX = 0, originY = 0, fields) {
    const next = clone(state);
    const instance = createInstance(catalog, next, moduleId, originX, originY, fields);
    next.instances.push(instance);
    // Derived from the highest existing "item_NNN", not instances.length: after
    // a removal the count shrinks but the surviving ids must stay unique.
    next.nextInstanceNumber = nextInstanceNumberFor(next.instances);
    return next;
  }

  /**
   * Place a candidate.
   *
   * A candidate that carries its own `rotationDeg` was generated and validated
   * at that rotation -- the turn into a perpendicular run, and everything that
   * then stacks on it. `fields.rotationDeg` is the other case: turning a piece
   * that was placed square, which is only safe for a rotation its socket layout
   * is invariant under, or its consumed sockets would no longer be the ones it
   * rests on. Callers get that guarantee from rotationKeepsSockets().
   */
  function applyCandidate(catalog, state, candidate, fields) {
    return addInstance(catalog, state, candidate.moduleId, candidate.originWorldMm[0], candidate.originWorldMm[1], {
      id: fields && fields.id,
      placement: candidate.placement,
      rotationDeg: (fields && fields.rotationDeg) || candidate.rotationDeg || 0
    });
  }

  /** True when turning `module` by `degrees` maps its socket set onto itself. */
  function rotationKeepsSockets(module, degrees) {
    const sockets = module.sockets || [];
    if (!sockets.length) return true;
    const keys = new Set(sockets.map((socket) => {
      const [x, y] = socket.normalized_mm || [0, 0];
      return `${socket.kind}:${rounded(x, 1)}:${rounded(y, 1)}`;
    }));
    return sockets.every((socket) => {
      const [x, y] = rotatedOffset(module, socket, degrees);
      return keys.has(`${socket.kind}:${rounded(x, 1)}:${rounded(y, 1)}`);
    });
  }

  // ---- Geometry helpers ----------------------------------------------------

  function localPivot(module) {
    const sockets = rotationSockets(module);
    const origin = sockets.find((socket) => {
      const [x, y] = socket.normalized_mm || [0, 0];
      return close(x, 0) && close(y, 0);
    }) || sockets[0];
    if (!origin) return [0, 0];
    const [pivotX, pivotY] = rotationPivot(module);
    const [originX, originY] = origin.normalized_mm || [0, 0];
    const [localX, localY] = origin.local_mm || [0, 0];
    return [localX + pivotX - originX, localY + pivotY - originY];
  }

  function rotateLocalPoint(module, x, y, rotationDeg) {
    const rotation = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
    if (!rotation) return [x, y];
    const [pivotX, pivotY] = localPivot(module);
    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = x - pivotX;
    const dy = y - pivotY;
    return [rounded(pivotX + dx * cos - dy * sin), rounded(pivotY + dx * sin + dy * cos)];
  }

  function transformBox(instance, module, bbox) {
    const translation = instance.translation;
    const corners = [
      [bbox[0], bbox[1]],
      [bbox[0], bbox[4]],
      [bbox[3], bbox[1]],
      [bbox[3], bbox[4]]
    ].map(([x, y]) => rotateLocalPoint(module, x, y, instance.rotationDeg || 0));
    const xs = corners.map(([x]) => x + translation[0]);
    const ys = corners.map(([, y]) => y + translation[1]);
    return [
      rounded(Math.min.apply(null, xs)),
      rounded(Math.min.apply(null, ys)),
      rounded(bbox[2] + translation[2]),
      rounded(Math.max.apply(null, xs)),
      rounded(Math.max.apply(null, ys)),
      rounded(bbox[5] + translation[2])
    ];
  }

  function boxIntersection(a, b) {
    return [
      Math.max(0, Math.min(a[3], b[3]) - Math.max(a[0], b[0])),
      Math.max(0, Math.min(a[4], b[4]) - Math.max(a[1], b[1])),
      Math.max(0, Math.min(a[5], b[5]) - Math.max(a[2], b[2]))
    ];
  }

  function boxesOverlap(a, b) {
    const [dx, dy, dz] = boxIntersection(a, b);
    return dx > OVERLAP_TOLERANCE_MM && dy > OVERLAP_TOLERANCE_MM && dz > OVERLAP_TOLERANCE_MM;
  }

  function collectHorizontalBoxes(catalog, instances) {
    const boxes = [];
    for (const instance of instances) {
      const module = moduleFor(catalog, instance.moduleId);
      for (const box of module.horizontalBoxes || []) {
        if (!box.bbox) continue;
        boxes.push({ instanceId: instance.id, moduleId: instance.moduleId, bbox: transformBox(instance, module, box.bbox) });
      }
    }
    return boxes;
  }

  /** World bounding box of one placed instance, in Rhino mm. */
  function instanceBounds(catalog, instance) {
    const module = moduleFor(catalog, instance.moduleId);
    const bbox = module.bboxMm || [0, 0, 0, 0, 0, 0];
    return transformBox(instance, module, bbox);
  }

  /** World bounding box of a whole design, in Rhino mm; null when empty. */
  function designBounds(catalog, state) {
    if (!state.instances.length) return null;
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const instance of state.instances) {
      const box = instanceBounds(catalog, instance);
      for (let axis = 0; axis < 3; axis += 1) {
        if (box[axis] < bounds[axis]) bounds[axis] = box[axis];
        if (box[axis + 3] > bounds[axis + 3]) bounds[axis + 3] = box[axis + 3];
      }
    }
    return bounds;
  }

  // ---- Validation ----------------------------------------------------------

  function validateState(catalog, state) {
    const reasons = [];
    const missingSupports = [];
    const supportMatches = [];
    const providers = topProviders(
      catalog,
      { instances: state.instances.map((instance) => Object.assign({}, instance, { consumedSockets: [] })) },
      null
    );

    for (const instance of state.instances) {
      const module = moduleFor(catalog, instance.moduleId);
      for (const socket of socketKind(module, "bottom")) {
        const consumer = worldSocket(instance, socket, module);
        const matches = providerCandidates(providers, consumer.worldMm[0], consumer.worldMm[1]).filter(
          (provider) => provider.instanceId !== instance.id && close(provider.worldMm[2], consumer.worldMm[2])
        );
        if (matches.length) supportMatches.push({ instanceId: instance.id, bottomSocket: socket.id, provider: matches[0] });
        else missingSupports.push({ instanceId: instance.id, moduleId: instance.moduleId, bottomSocket: socket.id, worldMm: consumer.worldMm });
      }
    }
    if (missingSupports.length) reasons.push("missing_supports");

    const supportUsage = new Map();
    for (const match of supportMatches) {
      const key = `${match.provider.instanceId}:${match.provider.socketId}:${rounded(match.provider.worldMm[2], 1)}`;
      if (!supportUsage.has(key)) supportUsage.set(key, []);
      supportUsage.get(key).push(match.instanceId);
    }
    const duplicateSupportConsumption = Array.from(supportUsage.entries())
      .filter(([, consumers]) => consumers.length > 1)
      .map(([support, consumers]) => ({ support, consumers }));
    if (duplicateSupportConsumption.length) reasons.push("duplicate_support_consumption");

    const coplanar = [];
    for (const instance of state.instances) {
      const zValues = supportMatches
        .filter((match) => match.instanceId === instance.id)
        .map((match) => match.provider.worldMm[2]);
      if (zValues.length > 1 && Math.max.apply(null, zValues) - Math.min.apply(null, zValues) > TOLERANCE_MM) {
        coplanar.push({ instanceId: instance.id, supportZMm: zValues });
      }
    }
    if (coplanar.length) reasons.push("non_coplanar_supports");

    const duplicatePlacements = [];
    const placementGroups = new Map();
    for (const instance of state.instances) {
      const key = instance.originWorldMm.map((value) => rounded(value, 1)).join(",");
      if (!placementGroups.has(key)) placementGroups.set(key, []);
      placementGroups.get(key).push(instance.id);
    }
    for (const [origin, ids] of placementGroups.entries()) {
      if (ids.length > 1) duplicatePlacements.push({ originWorldMm: origin.split(",").map(Number), instances: ids });
    }
    if (duplicatePlacements.length) reasons.push("duplicate_placements");

    const horizontalBoxes = collectHorizontalBoxes(catalog, state.instances);
    const horizontalOverlaps = [];
    for (let index = 0; index < horizontalBoxes.length; index += 1) {
      for (let secondIndex = index + 1; secondIndex < horizontalBoxes.length; secondIndex += 1) {
        const first = horizontalBoxes[index];
        const second = horizontalBoxes[secondIndex];
        if (first.instanceId === second.instanceId) continue;
        if (boxesOverlap(first.bbox, second.bbox)) {
          const [dx, dy, dz] = boxIntersection(first.bbox, second.bbox);
          horizontalOverlaps.push({ a: first.instanceId, b: second.instanceId, overlapMm: [rounded(dx), rounded(dy), rounded(dz)] });
        }
      }
    }
    if (horizontalOverlaps.length) reasons.push("horizontal_overlaps");

    return {
      isValid: reasons.length === 0,
      reasons,
      missingSupports,
      nonCoplanarSupports: coplanar,
      duplicatePlacements,
      horizontalOverlaps,
      duplicateSupportConsumption,
      supportSocketMatches: supportMatches.length
    };
  }

  /**
   * Everything about the current assembly that a candidate has to be checked
   * against. Built once per generateCandidates() call and reused for every
   * candidate, instead of re-deriving it inside a full validateState each time.
   */
  function additionContext(catalog, state) {
    const providers = topProviders(
      catalog,
      { instances: state.instances.map((instance) => Object.assign({}, instance, { consumedSockets: [] })) },
      null
    );
    const claimedSupports = new Set();
    for (const instance of state.instances) {
      const module = moduleFor(catalog, instance.moduleId);
      for (const socket of socketKind(module, "bottom")) {
        const consumer = worldSocket(instance, socket, module);
        const match = providerCandidates(providers, consumer.worldMm[0], consumer.worldMm[1]).find(
          (provider) => provider.instanceId !== instance.id && close(provider.worldMm[2], consumer.worldMm[2])
        );
        if (match) claimedSupports.add(`${match.instanceId}:${match.socketId}:${rounded(match.worldMm[2], 1)}`);
      }
    }
    return {
      providers,
      claimedSupports,
      boxes: collectHorizontalBoxes(catalog, state.instances),
      origins: new Set(state.instances.map((instance) => instance.originWorldMm.map((value) => rounded(value, 1)).join(",")))
    };
  }

  /**
   * Is adding exactly this one instance to `context`'s assembly legal?
   *
   * Equivalent to validateState(state + candidate).isValid whenever the state
   * itself is already valid: a new module can only break a rule it takes part
   * in. The engine test asserts that equivalence across every golden config.
   */
  function validateAddition(catalog, context, candidateInstance) {
    const module = moduleFor(catalog, candidateInstance.moduleId);
    const instance = Object.assign({ id: "__candidate__" }, candidateInstance);

    if (context.origins.has(instance.originWorldMm.map((value) => rounded(value, 1)).join(","))) return false;

    const supportZ = [];
    for (const socket of socketKind(module, "bottom")) {
      const consumer = worldSocket(instance, socket, module);
      const match = providerCandidates(context.providers, consumer.worldMm[0], consumer.worldMm[1]).find(
        (provider) => close(provider.worldMm[2], consumer.worldMm[2])
      );
      if (!match) return false; // missing_supports
      if (context.claimedSupports.has(`${match.instanceId}:${match.socketId}:${rounded(match.worldMm[2], 1)}`)) {
        return false; // duplicate_support_consumption
      }
      supportZ.push(match.worldMm[2]);
    }
    if (supportZ.length > 1 && Math.max.apply(null, supportZ) - Math.min.apply(null, supportZ) > TOLERANCE_MM) {
      return false; // non_coplanar_supports
    }

    for (const box of collectHorizontalBoxes(catalog, [instance])) {
      for (const existing of context.boxes) {
        if (boxesOverlap(box.bbox, existing.bbox)) return false; // horizontal_overlaps
      }
    }
    return true;
  }

  // ---- Candidate generation ------------------------------------------------

  function compareCandidates(a, b) {
    return (
      a.supportPlaneZ - b.supportPlaneZ ||
      a.originWorldMm[0] - b.originWorldMm[0] ||
      a.originWorldMm[1] - b.originWorldMm[1] ||
      a.moduleId.localeCompare(b.moduleId)
    );
  }

  function uniqueCandidate(candidates, seen, candidate) {
    const key = `${candidate.moduleId}:${rounded(candidate.originWorldMm[0], 1)}:${rounded(candidate.originWorldMm[1], 1)}:${rounded(candidate.supportPlaneZ, 1)}:${candidate.consumedSockets.map((socket) => `${socket.instanceId}/${socket.socketId}`).join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidate.id = `candidate_${String(seen.size).padStart(3, "0")}`;
    candidates.push(candidate);
  }

  /**
   * Where a new base sits front-to-back next to an existing one.
   *
   * Units of different depths line up on their BACKS, not their fronts: a run
   * stands against a wall, so a deeper unit should grow forwards into the room
   * rather than push its back through the wall. `depthSpanMm` is the module's
   * own front-to-back socket span, so this is the offset that makes the two
   * back rows coincide.
   */
  function baseOrigins(catalog, state, module, options) {
    const origins = [];
    const baseInstances = state.instances.filter((instance) => moduleFor(catalog, instance.moduleId).role === "base");
    if (!baseInstances.length) {
      origins.push({ x: 0, y: 0, kind: "first_base", rotationDeg: 0 });
      return origins;
    }
    for (const base of baseInstances) {
      const baseModule = moduleFor(catalog, base.moduleId);
      const rotationDeg = normaliseQuarterTurn(base.rotationDeg);
      const frame = frameOf(rotationDeg);
      const ownBox = instanceBounds(catalog, base);
      const stackBox = stackBounds(catalog, state, base);
      const ownSockets = socketBounds(base, baseModule) || ownBox;
      const ownShelf = shelfBounds(catalog, base);

      /*
       * Along the run: butt the new unit against this one, both ways.
       * Across it: line the two BACKS up, not the fronts -- a run stands
       * against a wall, so a deeper unit grows forwards into the room rather
       * than pushing its back through the wall. Backs are measured on the
       * sockets, the legs that actually stand against the wall, while the butt
       * uses the footprint, because that is what would collide.
       */
      const backTarget = {
        axis: frame.backAxis,
        sign: frame.backSign,
        measure: "sockets",
        value: ownSockets[edgeIndex(frame.backAxis, frame.backSign)]
      };

      for (const direction of [1, -1]) {
        const sign = frame.runSign * direction;
        const side = direction > 0 ? "right" : "left";
        for (const [name, box] of [["adjacent", ownBox], ["adjacent_stack", stackBox]]) {
          origins.push(Object.assign(
            baseOriginForFaces(catalog, module, rotationDeg, [
              {
                axis: frame.runAxis,
                sign: -sign,
                value: rounded(box[edgeIndex(frame.runAxis, sign)] + sign * ADJACENT_BASE_GAP_MM)
              },
              backTarget
            ]),
            { kind: `${name}_${side}`, rotationDeg, nextTo: base.id }
          ));
        }

        /*
         * The turn into a perpendicular run: the corner.
         *
         * Two walls meet; this run stands against one of them and the new one
         * against the other. The square where they meet is covered by *this*
         * run's last shelf, which is why a corner unit is longer than a
         * standard one by exactly the depth of a run -- the extra length is
         * the corner. So the new unit is placed to sit against that:
         *
         *   - its back plane flush with this run's far shelf edge, which is
         *     where the second wall is,
         *   - its near end meeting this run's front shelf edge, so the two
         *     surfaces read as one turning through the corner.
         *
         * Measured on the shelves rather than the footprints: the boards are
         * what the eye follows around the corner, and a bounding box carries
         * feet and stubs that would push the second run out by 50mm and leave
         * the notch this is here to avoid. Matches /designer, which models the
         * same join as four rotations of one corner unit.
         */
        const turned = normaliseQuarterTurn(rotationDeg + (direction > 0 ? 270 : 90));
        origins.push(Object.assign(
          baseOriginForFaces(catalog, module, turned, [
            {
              axis: frame.runAxis,
              sign,
              measure: "shelf",
              value: ownShelf[edgeIndex(frame.runAxis, sign)]
            },
            {
              axis: frame.backAxis,
              sign: frame.backSign,
              measure: "shelf",
              value: ownShelf[edgeIndex(frame.backAxis, -frame.backSign)]
            }
          ]),
          { kind: `corner_${side}`, rotationDeg: turned, nextTo: base.id }
        ));
      }

      // Gapped placements exist so a later bridging span has two owned columns
      // to land on, and so a run can be broken up deliberately. Advanced only:
      // /designer has never offered them and they read as a mistake in a
      // simple UI.
      if (!options.adjacentBasesOnly) {
        for (const direction of [1, -1]) {
          const sign = frame.runSign * direction;
          const side = direction > 0 ? "right" : "left";
          for (const span of BASE_INTERVALS_MM) {
            origins.push(Object.assign(
              baseOriginForFaces(catalog, module, rotationDeg, [
                {
                  axis: frame.runAxis,
                  sign: -sign,
                  sockets: true,
                  value: rounded(ownSockets[edgeIndex(frame.runAxis, sign)] + sign * span)
                },
                backTarget
              ]),
              { kind: `interval_${side}_${span}`, rotationDeg, nextTo: base.id }
            ));
          }
        }
      }
    }
    return origins;
  }

  function baseCandidates(catalog, state, module, options, context) {
    const candidates = [];
    const seen = new Set();
    for (const origin of baseOrigins(catalog, state, module, options)) {
      const rotationDeg = origin.rotationDeg || 0;
      const instance = {
        moduleId: module.id,
        originWorldMm: [rounded(origin.x), rounded(origin.y), 0],
        translation: baseTranslation(module, origin.x, origin.y),
        rotationDeg,
        supportPlaneZ: 0,
        consumedSockets: [],
        // `nextTo` names the unit this placement was worked out from, which is
        // what lets the interface gather every piece that could go in one spot
        // behind a single "+" instead of one per piece.
        placement: { method: "floor", basePlacementKind: origin.kind, nextTo: origin.nextTo || null }
      };
      if (!validateAddition(catalog, context, instance)) continue;
      uniqueCandidate(candidates, seen, {
        moduleId: module.id,
        canonicalId: module.canonicalId,
        transform: { x: instance.translation[0], y: instance.translation[1], z: instance.translation[2], rotation: rotationDeg },
        originWorldMm: instance.originWorldMm,
        rotationDeg,
        supportPlaneZ: 0,
        consumedSockets: [],
        placement: instance.placement
      });
    }
    return candidates.sort(compareCandidates);
  }

  /**
   * The quarter turns worth trying when stacking something.
   *
   * Square on is always tried. Beyond that, only the turns the design already
   * contains: once a run has turned a corner, everything that stacks on it has
   * to be turned the same way to meet its sockets, and a design with no corner
   * in it pays nothing for the possibility.
   */
  function rotationsInPlay(state) {
    const rotations = new Set([0]);
    for (const instance of state.instances) rotations.add(normaliseQuarterTurn(instance.rotationDeg));
    return Array.from(rotations);
  }

  function supportedCandidates(catalog, state, module, options, context) {
    const required = socketKind(module, "bottom");
    if (!required.length) return [];
    const first = required[0];
    const providers = topProviders(catalog, state, null);
    const candidates = [];
    const seen = new Set();

    for (const rotationDeg of rotationsInPlay(state)) {
      for (const providerList of providers.values()) {
        for (const provider of providerList) {
          const [firstOffsetX, firstOffsetY] = rotatedOffset(module, first, rotationDeg);
          const originX = rounded(provider.worldMm[0] - firstOffsetX);
          const originY = rounded(provider.worldMm[1] - firstOffsetY);
          const snap = supportedPlacement(catalog, state, module.id, originX, originY, null, rotationDeg, providers);
          if (!snap.ok) continue;
          const instance = {
            moduleId: module.id,
            originWorldMm: [originX, originY, snap.supportPlaneZ],
            translation: snap.translation,
            rotationDeg,
            supportPlaneZ: snap.supportPlaneZ,
            consumedSockets: snap.consumedSockets,
            placement: { method: "socket", on: Array.from(new Set(snap.consumedSockets.map((socket) => socket.instanceId))) }
          };
          if (!validateAddition(catalog, context, instance)) continue;
          uniqueCandidate(candidates, seen, {
            moduleId: module.id,
            canonicalId: module.canonicalId,
            transform: { x: snap.translation[0], y: snap.translation[1], z: snap.translation[2], rotation: rotationDeg },
            originWorldMm: instance.originWorldMm,
            rotationDeg,
            supportPlaneZ: snap.supportPlaneZ,
            consumedSockets: snap.consumedSockets,
            placement: instance.placement
          });
        }
      }
    }
    return candidates.sort(compareCandidates);
  }

  /**
   * Every legal placement of `moduleId` on the current design.
   *
   * `options.context` lets a caller that is about to ask for many modules build
   * the assembly snapshot once (see additionContext) instead of once per call.
   */
  function generateCandidates(catalog, state, moduleId, options) {
    const settings = options || {};
    const module = moduleFor(catalog, moduleId);
    const context = settings.context || additionContext(catalog, state);
    return module.role === "base"
      ? baseCandidates(catalog, state, module, settings, context)
      : supportedCandidates(catalog, state, module, settings, context);
  }

  function moduleHasDistinctRotation(module) {
    const sockets = module.sockets || [];
    if (!sockets.length) return false;
    const originalKeys = new Set(sockets.map((socket) => {
      const [x, y] = socket.normalized_mm || [0, 0];
      return `${socket.kind}:${x}:${y}`;
    }));
    return sockets.some((socket) => {
      const [rx, ry] = rotatedOffset(module, socket, 180);
      return !originalKeys.has(`${socket.kind}:${rx}:${ry}`);
    });
  }

  // ---- Serialisation -------------------------------------------------------

  function fromPipelineConfig(catalog, config) {
    let state = createState(catalog);
    for (const spec of config.modules || []) {
      const moduleId = spec.type || spec.module;
      const module = moduleFor(catalog, moduleId);
      const placement = spec.placement === "floor" || (spec.on == null && module.role === "base")
        ? { method: "floor" }
        : { method: "socket", on: spec.on };
      state = addInstance(catalog, state, module.id, Number(spec.x || 0), Number(spec.y || 0), { id: spec.id, placement });
    }
    return state;
  }

  function serializeState(state) {
    return {
      schemaVersion: 1,
      finish: state.finish || "sage",
      bookends: state.bookends || 0,
      instances: state.instances.map((instance) => {
        const spec = {
          id: instance.id,
          type: instance.moduleId,
          originWorldMm: instance.originWorldMm,
          rotationDeg: instance.rotationDeg || 0,
          placement: instance.placement
        };
        // Only when it has one, so an ordinary design serialises exactly as it
        // did before per-piece colour existed.
        if (instance.finish) spec.finish = instance.finish;
        return spec;
      })
    };
  }

  function deserializeState(catalog, payload) {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    let state = createState(catalog, {
      finish: parsed.finish || "sage",
      bookends: Number(parsed.bookends) || 0
    });
    for (const instance of parsed.instances || []) {
      const [x, y] = instance.originWorldMm || [0, 0];
      const placement = instance.placement
        || { method: moduleFor(catalog, instance.type).role === "base" ? "floor" : "socket" };
      state = addInstance(catalog, state, instance.type, x, y, {
        id: instance.id,
        placement,
        rotationDeg: instance.rotationDeg || 0,
        finish: instance.finish || null
      });
    }
    return state;
  }

  function removeInstance(catalog, state, instanceId) {
    const specs = serializeState(state).instances.filter((spec) => spec.id !== instanceId);
    return rebuild(catalog, state, specs);
  }

  function replaceInstance(catalog, state, instanceId, moduleId) {
    const specs = serializeState(state).instances.map((spec) =>
      spec.id === instanceId ? Object.assign({}, spec, { type: moduleId }) : spec);
    return rebuild(catalog, state, specs);
  }

  /**
   * Give one piece a colour of its own, or `null` to put it back to the
   * design's.
   *
   * Routed through the same rebuild as rotation and replacement even though a
   * colour cannot make an assembly illegal: one path in means there is one place
   * for an instance's fields to survive, and no second way for them to be lost.
   */
  function setInstanceFinish(catalog, state, instanceId, finishId) {
    const specs = serializeState(state).instances.map((spec) => {
      if (spec.id !== instanceId) return spec;
      const next = Object.assign({}, spec);
      if (finishId) next.finish = finishId;
      else delete next.finish;
      return next;
    });
    return rebuild(catalog, state, specs);
  }

  function rotateInstance(catalog, state, instanceId, degrees) {
    const specs = serializeState(state).instances.map((spec) =>
      spec.id === instanceId
        ? Object.assign({}, spec, { rotationDeg: (((spec.rotationDeg || 0) + degrees) % 360 + 360) % 360 })
        : spec);
    return rebuild(catalog, state, specs);
  }

  /** Rebuild from specs, returning null when the result would be illegal. */
  function rebuild(catalog, state, specs) {
    try {
      const next = deserializeState(catalog, {
        schemaVersion: 1,
        finish: state.finish,
        bookends: state.bookends,
        instances: specs
      });
      return validateState(catalog, next).isValid ? next : null;
    } catch (error) {
      return null;
    }
  }

  /** True when nothing rests on this instance, so removing it is safe. */
  function isLoadBearing(state, instanceId) {
    return state.instances.some((instance) =>
      (instance.consumedSockets || []).some((socket) => socket.instanceId === instanceId));
  }

  /**
   * Instances grouped into stacks (a floor base plus everything resting on it),
   * following each instance's placement chain to its floor root.
   */
  function stacksOf(state) {
    const parentOf = {};
    state.instances.forEach((instance) => {
      const on = instance.placement && instance.placement.on;
      if (on) parentOf[instance.id] = Array.isArray(on) ? on[0] : on;
    });
    const rootOf = (id) => {
      let current = id;
      const seen = new Set();
      while (parentOf[current] && !seen.has(current)) {
        seen.add(current);
        current = parentOf[current];
      }
      return current;
    };
    const groups = new Map();
    state.instances.forEach((instance) => {
      const root = rootOf(instance.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(instance.id);
    });
    return { rootOf, groups };
  }

  return {
    ADJACENT_BASE_GAP_MM,
    BASE_INTERVALS_MM,
    TOLERANCE_MM,
    addInstance,
    additionContext,
    applyCandidate,
    createState,
    designBounds,
    deserializeState,
    fromPipelineConfig,
    generateCandidates,
    instanceBounds,
    isLoadBearing,
    localPivot,
    moduleFor,
    moduleHasDistinctRotation,
    normalizeCatalog,
    removeInstance,
    replaceInstance,
    rotateInstance,
    rotationKeepsSockets,
    serializeState,
    setInstanceFinish,
    shelfBounds,
    stacksOf,
    validateAddition,
    validateState
  };
});

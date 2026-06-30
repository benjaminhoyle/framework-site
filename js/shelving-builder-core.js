(function (root) {
  "use strict";

  const EPSILON_MM = 1;

  const FINISHES = {
    sage: {
      label: "Sage",
      mdf: "#cddfc8",
      mdfEdge: "#a9c29f",
      steel: "#6f8a62"
    },
    marine: {
      label: "Marine",
      mdf: "#bfd8e8",
      mdfEdge: "#8fb7cf",
      steel: "#315f8e"
    },
    coral: {
      label: "Coral",
      mdf: "#f4c2ad",
      mdfEdge: "#df8568",
      steel: "#b44a37"
    },
    charcoal: {
      label: "Charcoal",
      mdf: "#c7cbd2",
      mdfEdge: "#9ba1ad",
      steel: "#3f403d"
    }
  };

  const FINISH_ORDER = ["sage", "marine", "coral", "charcoal"];

  const GAP_TYPES = {
    adjacent: {
      id: "adjacent",
      label: "Adjacent",
      span: 0
    },
    slim_gap: {
      id: "slim_gap",
      label: "Slim gap",
      span: 440,
      spanName: "slim"
    },
    standard_gap: {
      id: "standard_gap",
      label: "Standard gap",
      span: 703,
      spanName: "standard"
    },
    wide_gap: {
      id: "wide_gap",
      label: "Wide gap",
      span: 1143,
      spanName: "wide"
    }
  };

  const MODULES = {
    standard_base: {
      id: "standard_base",
      label: "Standard Base",
      role: "base",
      canStartRun: true,
      depth: 280,
      height: 430,
      span: 703,
      bottomColumns: [],
      topColumns: [0, 703],
      topSpans: [{ name: "standard", start: 0, end: 703 }],
      hasShelf: true,
      price: 6500
    },
    wide_base: {
      id: "wide_base",
      label: "Wide Base",
      role: "base",
      canStartRun: true,
      depth: 280,
      height: 430,
      span: 1143,
      bottomColumns: [],
      topColumns: [0, 1143],
      topSpans: [{ name: "wide", start: 0, end: 1143 }],
      hasShelf: true,
      price: 8000
    },
    standard_extension: {
      id: "standard_extension",
      label: "Standard Extension",
      role: "extension",
      depth: 280,
      height: 300,
      span: 703,
      bottomColumns: [0, 703],
      topColumns: [0, 703],
      topSpans: [{ name: "standard", start: 0, end: 703 }],
      hasShelf: true,
      price: 5500
    },
    slim_extension: {
      id: "slim_extension",
      label: "Slim Extension",
      role: "extension",
      depth: 280,
      height: 300,
      span: 440,
      bottomColumns: [0, 440],
      topColumns: [0, 440],
      topSpans: [{ name: "slim", start: 0, end: 440 }],
      hasShelf: true,
      price: 4500
    },
    wide_extension: {
      id: "wide_extension",
      label: "Wide Extension",
      role: "extension",
      depth: 280,
      height: 300,
      span: 1143,
      bottomColumns: [0, 1143],
      topColumns: [0, 1143],
      topSpans: [{ name: "wide", start: 0, end: 1143 }],
      hasShelf: true,
      price: 7000
    },
    wide_adapter: {
      id: "wide_adapter",
      label: "Wide Adapter",
      role: "adapter",
      depth: 280,
      height: 300,
      span: 1143,
      bottomColumns: [0, 1143],
      topColumns: [0, 703, 1143],
      topSpans: [
        { name: "wide", start: 0, end: 1143 },
        { name: "standard", start: 0, end: 703 },
        { name: "slim", start: 703, end: 1143 }
      ],
      hasShelf: true,
      price: 7000
    },
    standard_booster: {
      id: "standard_booster",
      label: "Standard Booster",
      role: "booster",
      depth: 280,
      height: 300,
      span: 0,
      bottomColumns: [0],
      topColumns: [0],
      topSpans: [],
      hasShelf: false,
      price: 3500
    }
  };

  const MODULES_BY_SPAN = {
    slim: ["slim_extension"],
    standard: ["standard_extension"],
    wide: ["wide_extension", "wide_adapter"],
    point: ["standard_booster"]
  };

  const BASE_TYPES = ["standard_base", "wide_base"];

  function roundMm(value) {
    return Math.round(value / EPSILON_MM) * EPSILON_MM;
  }

  function sameMm(a, b) {
    return Math.abs(roundMm(a) - roundMm(b)) <= EPSILON_MM;
  }

  function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
  }

  function nextFinish(index) {
    return FINISH_ORDER[index % FINISH_ORDER.length];
  }

  function getDefinition(type) {
    const definition = MODULES[type];
    if (!definition) throw new Error(`Unknown module type: ${type}`);
    return definition;
  }

  function moduleSpan(definition) {
    return definition.span || 0;
  }

  function gapSpan(gapType) {
    const gap = GAP_TYPES[gapType || "adjacent"];
    if (!gap) throw new Error(`Unknown gap type: ${gapType}`);
    return gap.span;
  }

  function createBaseSlot(type, fields) {
    getDefinition(type);
    return {
      id: fields.id,
      type,
      gapBefore: fields.gapBefore || "adjacent",
      finish: fields.finish || "sage"
    };
  }

  function createConfig(baseSlots) {
    return {
      selectedRunId: "run_main",
      runs: [
        {
          id: "run_main",
          label: "Main run",
          direction: 0,
          placement: {
            kind: "root",
            origin: [0, 0],
            angle: 0
          },
          baseSlots: baseSlots || [
            createBaseSlot("standard_base", {
              id: "base_01",
              finish: "sage"
            })
          ],
          levels: []
        }
      ]
    };
  }

  function getRun(config, runId) {
    const id = runId || config.selectedRunId || config.runs[0]?.id;
    return (config.runs || []).find((run) => run.id === id);
  }

  function nextSlotId(run, type) {
    const count = (run.baseSlots || []).filter((slot) => slot.type === type).length + 1;
    return `${type.replace("_base", "")}_base_${String(count).padStart(2, "0")}`;
  }

  function nextLevelId(run) {
    return `level_${String((run.levels || []).length + 1).padStart(2, "0")}`;
  }

  function socketId(moduleId, columnIndex) {
    return `${moduleId}:top:${columnIndex}`;
  }

  function columnSocket(module, column) {
    return module.topSockets.find((socket) => sameMm(socket.column, column));
  }

  function makeTopSockets(module) {
    return module.definition.topColumns.map((column, index) => ({
      id: socketId(module.id, index),
      ownerId: module.id,
      ownerType: module.type,
      runId: module.runId,
      levelIndex: module.levelIndex,
      column,
      x: roundMm(module.x + column),
      y: module.y,
      z: roundMm(module.z + module.definition.height)
    }));
  }

  function createPlacedModule(fields) {
    const definition = getDefinition(fields.type);
    const module = {
      id: fields.id,
      type: fields.type,
      runId: fields.runId,
      levelIndex: fields.levelIndex,
      source: fields.source,
      x: roundMm(fields.x || 0),
      y: roundMm(fields.y || 0),
      z: roundMm(fields.z || 0),
      supportSocketIds: fields.supportSocketIds || [],
      finish: fields.finish || "sage",
      definition
    };
    module.topSockets = makeTopSockets(module);
    return module;
  }

  function layoutBaseSlots(run, errors) {
    const modules = [];
    let x = 0;

    (run.baseSlots || []).forEach((slot, index) => {
      let definition;
      try {
        definition = getDefinition(slot.type);
      } catch (error) {
        errors.push({
          severity: "error",
          message: error.message,
          source: slot.id || `base_${index + 1}`
        });
        return;
      }

      if (!definition.canStartRun) {
        errors.push({
          severity: "error",
          message: `${definition.label} cannot start a floor run.`,
          source: slot.id
        });
      }

      if (index > 0) {
        const previous = modules[modules.length - 1];
        x = previous.x + moduleSpan(previous.definition) + gapSpan(slot.gapBefore);
      }

      modules.push(createPlacedModule({
        id: slot.id || `base_${index + 1}`,
        type: slot.type,
        runId: run.id,
        levelIndex: 0,
        source: "base",
        x,
        y: 0,
        z: 0,
        finish: slot.finish || nextFinish(index)
      }));
    });

    return modules;
  }

  function socketsById(modules) {
    const map = new Map();
    modules.forEach((module) => {
      module.topSockets.forEach((socket) => map.set(socket.id, socket));
    });
    return map;
  }

  function validateSupportSockets(level, moduleSpec, definition, supportMap, errors) {
    const ids = moduleSpec.supportSocketIds || [];
    if (ids.length !== definition.bottomColumns.length) {
      errors.push({
        severity: "error",
        message: `${definition.label} expected ${definition.bottomColumns.length} support sockets, got ${ids.length}.`,
        source: moduleSpec.id || level.id
      });
      return [];
    }

    const sockets = ids.map((id) => supportMap.get(id));
    ids.forEach((id, index) => {
      if (!sockets[index]) {
        errors.push({
          severity: "error",
          message: `Missing support socket ${id}.`,
          source: moduleSpec.id || level.id
        });
      }
    });

    const present = sockets.filter(Boolean);
    if (!present.length) return [];

    const z = present[0].z;
    if (present.some((socket) => !sameMm(socket.z, z))) {
      errors.push({
        severity: "error",
        message: `${definition.label} support sockets are not coplanar.`,
        source: moduleSpec.id || level.id
      });
    }

    definition.bottomColumns.forEach((column, index) => {
      const socket = sockets[index];
      if (!socket) return;
      const expectedX = roundMm((moduleSpec.x || 0) + column);
      if (!sameMm(socket.x, expectedX)) {
        errors.push({
          severity: "error",
          message: `${definition.label} support ${socket.id} is at x=${socket.x}, expected x=${expectedX}.`,
          source: moduleSpec.id || level.id
        });
      }
    });

    return present;
  }

  function layoutLevel(run, level, supportModules, levelNumber, errors) {
    const supportMap = socketsById(supportModules);
    const consumed = new Set();
    const modules = [];

    (level.modules || []).forEach((moduleSpec, index) => {
      let definition;
      try {
        definition = getDefinition(moduleSpec.type);
      } catch (error) {
        errors.push({
          severity: "error",
          message: error.message,
          source: moduleSpec.id || level.id
        });
        return;
      }

      const supportSockets = validateSupportSockets(level, moduleSpec, definition, supportMap, errors);
      const duplicate = (moduleSpec.supportSocketIds || []).find((id) => consumed.has(id));
      if (duplicate) {
        errors.push({
          severity: "error",
          message: `Socket ${duplicate} is consumed more than once on ${level.label || level.id}.`,
          source: moduleSpec.id || level.id
        });
      }

      (moduleSpec.supportSocketIds || []).forEach((id) => consumed.add(id));
      const z = supportSockets[0]?.z || 0;
      modules.push(createPlacedModule({
        id: moduleSpec.id || `${level.id}_module_${index + 1}`,
        type: moduleSpec.type,
        runId: run.id,
        levelIndex: levelNumber,
        source: "level",
        x: moduleSpec.x || 0,
        y: 0,
        z,
        supportSocketIds: moduleSpec.supportSocketIds || [],
        finish: moduleSpec.finish || nextFinish(levelNumber + index)
      }));
    });

    return modules;
  }

  function moduleShelfInterval(module) {
    if (!module.definition.hasShelf) return null;
    return {
      moduleId: module.id,
      x0: roundMm(module.x),
      x1: roundMm(module.x + moduleSpan(module.definition)),
      y0: module.y,
      y1: module.y + module.definition.depth,
      z: roundMm(module.z + module.definition.height)
    };
  }

  function intervalsOverlap(a, b) {
    if (!sameMm(a.z, b.z)) return false;
    if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= EPSILON_MM) return false;
    if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= EPSILON_MM) return false;
    return true;
  }

  function validateSurfaceOverlaps(modules, errors) {
    const intervals = modules.map(moduleShelfInterval).filter(Boolean);
    intervals.forEach((interval, index) => {
      intervals.slice(index + 1).forEach((other) => {
        if (!intervalsOverlap(interval, other)) return;
        errors.push({
          severity: "error",
          message: `${interval.moduleId} overlaps ${other.moduleId} at z=${interval.z}.`,
          source: interval.moduleId
        });
      });
    });
  }

  function layoutRun(config, runId) {
    const run = getRun(config, runId);
    const errors = [];
    if (!run) {
      return { run: null, modules: [], levels: [], errors: [{ severity: "error", message: "Missing run." }] };
    }

    const modules = [];
    const levelLayouts = [];
    const baseModules = layoutBaseSlots(run, errors);
    modules.push(...baseModules);

    let supportModules = baseModules;
    (run.levels || []).forEach((level, index) => {
      const levelModules = layoutLevel(run, level, supportModules, index + 1, errors);
      levelLayouts.push({
        id: level.id,
        label: level.label,
        modules: levelModules
      });
      modules.push(...levelModules);
      supportModules = levelModules;
    });

    validateSurfaceOverlaps(modules, errors);

    return {
      run,
      modules,
      baseModules,
      supportModules,
      levels: levelLayouts,
      errors
    };
  }

  function layoutConfig(config) {
    const runs = (config.runs || []).map((run) => layoutRun(config, run.id));
    const errors = runs.flatMap((runLayout) => runLayout.errors);
    const modules = runs.flatMap((runLayout) => runLayout.modules);
    return {
      runs,
      modules,
      errors
    };
  }

  function validateConfig(config) {
    const layout = layoutConfig(config);
    return {
      valid: layout.errors.length === 0,
      errors: layout.errors,
      layout
    };
  }

  function collectTopSockets(modules) {
    return (modules || []).flatMap((module) => module.topSockets || []);
  }

  function computeBoosterDepths(modules) {
    const moduleById = new Map((modules || []).map((module) => [module.id, module]));
    const socketOwnerById = new Map();
    (modules || []).forEach((module) => {
      module.topSockets.forEach((socket) => socketOwnerById.set(socket.id, module.id));
    });

    const memo = new Map();
    function depthFor(moduleId) {
      if (memo.has(moduleId)) return memo.get(moduleId);
      const module = moduleById.get(moduleId);
      if (!module || module.type !== "standard_booster") {
        memo.set(moduleId, 0);
        return 0;
      }

      const supportDepth = (module.supportSocketIds || []).reduce((maxDepth, socketId) => {
        const ownerId = socketOwnerById.get(socketId);
        return Math.max(maxDepth, depthFor(ownerId));
      }, 0);
      const depth = supportDepth + 1;
      memo.set(moduleId, depth);
      return depth;
    }

    (modules || []).forEach((module) => depthFor(module.id));
    return memo;
  }

  function spanLengthName(length) {
    const match = Object.values(GAP_TYPES).find((gap) => gap.spanName && sameMm(gap.span, length));
    return match?.spanName || null;
  }

  function ownerTypesFor(modules) {
    return Array.from(new Set(modules.map((module) => module.definition.role)));
  }

  function maxBoosterDepth(modules, boosterDepths) {
    return modules.reduce((depth, module) => Math.max(depth, boosterDepths.get(module.id) || 0), 0);
  }

  function makeOwnedSpans(module, boosterDepths) {
    return (module.definition.topSpans || []).map((span, index) => {
      const startSocket = columnSocket(module, span.start);
      const endSocket = columnSocket(module, span.end);
      if (!startSocket || !endSocket) return null;
      return {
        id: `${module.id}:owned:${index}`,
        kind: "owned",
        spanName: span.name,
        label: `${span.name} span on ${module.id}`,
        x0: startSocket.x,
        x1: endSocket.x,
        z: startSocket.z,
        socketIds: [startSocket.id, endSocket.id],
        owners: [module.id],
        ownerTypes: ownerTypesFor([module]),
        ownerBoosterDepth: maxBoosterDepth([module], boosterDepths)
      };
    }).filter(Boolean);
  }

  function makePointSpans(module, boosterDepths) {
    return module.topSockets.map((socket, index) => ({
      id: `${module.id}:point:${index}`,
      kind: "point",
      spanName: "point",
      label: `point on ${module.id} at x=${socket.x}`,
      x0: socket.x,
      x1: socket.x,
      z: socket.z,
      socketIds: [socket.id],
      owners: [module.id],
      ownerTypes: ownerTypesFor([module]),
      ownerBoosterDepth: maxBoosterDepth([module], boosterDepths)
    }));
  }

  function makeGapSpans(modules, boosterDepths) {
    const sorted = [...modules].sort((a, b) => a.x - b.x);
    const spans = [];

    sorted.forEach((left, index) => {
      const right = sorted[index + 1];
      if (!right) return;
      if (!sameMm(left.z + left.definition.height, right.z + right.definition.height)) return;

      const leftSocket = [...left.topSockets].sort((a, b) => b.x - a.x)[0];
      const rightSocket = [...right.topSockets].sort((a, b) => a.x - b.x)[0];
      if (!leftSocket || !rightSocket) return;

      const length = roundMm(rightSocket.x - leftSocket.x);
      const spanName = spanLengthName(length);
      if (!spanName) return;

      spans.push({
        id: `${left.id}:${right.id}:gap:${spanName}`,
        kind: "gap",
        spanName,
        label: `${spanName} gap between ${left.id} and ${right.id}`,
        x0: leftSocket.x,
        x1: rightSocket.x,
        z: leftSocket.z,
        socketIds: [leftSocket.id, rightSocket.id],
        owners: [left.id, right.id],
        ownerTypes: ownerTypesFor([left, right]),
        ownerBoosterDepth: maxBoosterDepth([left, right], boosterDepths)
      });
    });

    return spans;
  }

  function makeCompositeSpans(modules, boosterDepths) {
    if (modules.length < 2) return [];
    const sockets = collectTopSockets(modules);
    if (!sockets.length) return [];

    const z = sockets[0].z;
    if (sockets.some((socket) => !sameMm(socket.z, z))) return [];

    const sorted = [...sockets].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first.ownerId === last.ownerId) return [];

    const spanName = spanLengthName(last.x - first.x);
    if (!spanName) return [];

    const owners = Array.from(new Set(modules.map((module) => module.id)));
    return [{
      id: `composite:${owners.join("+")}:${spanName}`,
      kind: "composite",
      spanName,
      label: `${spanName} composite across ${owners.join(" + ")}`,
      x0: first.x,
      x1: last.x,
      z,
      socketIds: [first.id, last.id],
      owners,
      ownerTypes: ownerTypesFor(modules),
      ownerBoosterDepth: maxBoosterDepth(modules, boosterDepths)
    }];
  }

  function getCurrentSupportModules(config, runId) {
    const runLayout = layoutRun(config, runId);
    return {
      runLayout,
      supportModules: runLayout.supportModules || runLayout.baseModules || []
    };
  }

  function listSupportSpans(config, runId) {
    const { runLayout, supportModules } = getCurrentSupportModules(config, runId);
    if (runLayout.errors.length) return [];
    const boosterDepths = computeBoosterDepths(runLayout.modules);

    return [
      ...supportModules.flatMap((module) => makeOwnedSpans(module, boosterDepths)),
      ...makeGapSpans(supportModules, boosterDepths),
      ...makeCompositeSpans(supportModules, boosterDepths),
      ...supportModules.flatMap((module) => makePointSpans(module, boosterDepths))
    ];
  }

  function moduleAllowedOnSpan(moduleType, span) {
    if (moduleType === "wide_adapter" && (span.ownerTypes || []).includes("booster")) {
      return false;
    }

    if (moduleType === "standard_booster" && (span.ownerBoosterDepth || 0) >= 2) {
      return false;
    }

    return true;
  }

  function patternModuleFromSpan(span, moduleType, index, finish) {
    const definition = getDefinition(moduleType);
    return {
      id: `module_${index + 1}`,
      type: moduleType,
      x: span.x0,
      supportSocketIds: [...span.socketIds],
      finish: finish || "sage",
      preview: {
        spanId: span.id,
        spanKind: span.kind,
        spanName: span.spanName
      },
      _definition: definition
    };
  }

  function moduleIntervalsForPattern(modules) {
    return modules.map((module) => {
      if (!module._definition.hasShelf) return null;
      return {
        x0: roundMm(module.x),
        x1: roundMm(module.x + moduleSpan(module._definition))
      };
    }).filter(Boolean);
  }

  function modulesReuseSockets(modules) {
    const seen = new Set();
    return modules.some((module) => {
      return module.supportSocketIds.some((id) => {
        if (seen.has(id)) return true;
        seen.add(id);
        return false;
      });
    });
  }

  function modulesOverlapInPattern(modules) {
    const intervals = moduleIntervalsForPattern(modules);
    return intervals.some((interval, index) => (
      intervals.slice(index + 1).some((other) => (
        Math.min(interval.x1, other.x1) - Math.max(interval.x0, other.x0) > EPSILON_MM
      ))
    ));
  }

  function cleanPatternModules(modules) {
    return modules.map((module, index) => ({
      id: module.id || `module_${index + 1}`,
      type: module.type,
      x: module.x,
      supportSocketIds: [...module.supportSocketIds],
      finish: module.finish || nextFinish(index)
    }));
  }

  function makePattern(id, label, modules, kind) {
    return {
      id,
      label,
      kind: kind || "single",
      modules: cleanPatternModules(modules),
      supportSocketIds: modules.flatMap((module) => module.supportSocketIds),
      spanIds: modules.map((module) => module.preview?.spanId).filter(Boolean)
    };
  }

  function singlePatternsFromSpan(span, index) {
    const moduleTypes = MODULES_BY_SPAN[span.spanName] || [];
    return moduleTypes.filter((moduleType) => moduleAllowedOnSpan(moduleType, span)).map((moduleType, moduleIndex) => {
      const module = patternModuleFromSpan(span, moduleType, 0, nextFinish(index + moduleIndex));
      return makePattern(
        `single:${span.id}:${moduleType}`,
        `${getDefinition(moduleType).label} - ${span.label}`,
        [module],
        "single"
      );
    });
  }

  function combineSingles(singlePatterns, limit) {
    const combos = [];
    const candidateModules = singlePatterns
      .filter((pattern) => pattern.modules.length === 1)
      .map((pattern) => {
        const module = { ...pattern.modules[0] };
        module._definition = getDefinition(module.type);
        module.preview = {
          spanId: pattern.spanIds[0]
        };
        return {
          pattern,
          module
        };
      });

    for (let a = 0; a < candidateModules.length; a += 1) {
      for (let b = a + 1; b < candidateModules.length; b += 1) {
        const modules = [
          { ...candidateModules[a].module, id: "module_1" },
          { ...candidateModules[b].module, id: "module_2" }
        ];
        if (modulesReuseSockets(modules) || modulesOverlapInPattern(modules)) continue;
        const labels = modules.map((module) => getDefinition(module.type).label);
        combos.push(makePattern(
          `combo:${candidateModules[a].pattern.id}:${candidateModules[b].pattern.id}`,
          `${labels.join(" + ")}`,
          modules,
          "combo"
        ));
        if (combos.length >= limit) return combos;
      }
    }

    return combos;
  }

  function listNextLevelPatterns(config, runId) {
    const spans = listSupportSpans(config, runId);
    const singles = spans.flatMap((span, index) => singlePatternsFromSpan(span, index));
    const combos = combineSingles(singles, 12);
    return [...singles, ...combos].filter((pattern, index, patterns) => (
      patterns.findIndex((other) => other.id === pattern.id) === index
    ));
  }

  function applyPattern(config, pattern, runId) {
    const next = cloneConfig(config);
    const run = getRun(next, runId);
    if (!run) return next;

    const levelId = nextLevelId(run);
    run.levels.push(levelFromPattern(levelId, pattern, run.levels.length));

    return next;
  }

  function levelFromPattern(levelId, pattern, levelIndex) {
    return {
      id: levelId,
      label: pattern.label,
      patternId: pattern.id,
      modules: pattern.modules.map((module, index) => ({
        id: `${levelId}_${module.type}_${index + 1}`,
        type: module.type,
        x: module.x,
        supportSocketIds: [...module.supportSocketIds],
        finish: module.finish || nextFinish(levelIndex + index)
      }))
    };
  }

  function coordinateKey(socket) {
    return `${roundMm(socket.x)}:${roundMm(socket.y)}:${roundMm(socket.z)}`;
  }

  function configWithLevelCount(config, runId, levelCount) {
    const next = cloneConfig(config);
    const run = getRun(next, runId);
    if (run) run.levels = run.levels.slice(0, levelCount);
    return next;
  }

  function replaceLevelWithPattern(config, levelIndex, pattern, runId) {
    const next = cloneConfig(config);
    const run = getRun(next, runId);
    if (!run || levelIndex < 0 || levelIndex >= run.levels.length) return next;

    const oldLayout = layoutRun(config, run.id);
    const oldLevel = oldLayout.levels[levelIndex];
    const oldSocketsById = new Map(collectTopSockets(oldLevel?.modules || []).map((socket) => [socket.id, socket]));
    const levelId = run.levels[levelIndex].id;
    run.levels[levelIndex] = levelFromPattern(levelId, pattern, levelIndex);

    if (run.levels[levelIndex + 1]) {
      const partial = configWithLevelCount(next, run.id, levelIndex + 1);
      const newLayout = layoutRun(partial, run.id);
      const newLevel = newLayout.levels[levelIndex];
      const newSocketByCoordinate = new Map();
      collectTopSockets(newLevel?.modules || []).forEach((socket) => {
        if (!newSocketByCoordinate.has(coordinateKey(socket))) {
          newSocketByCoordinate.set(coordinateKey(socket), socket.id);
        }
      });

      run.levels[levelIndex + 1].modules = run.levels[levelIndex + 1].modules.map((moduleSpec) => ({
        ...moduleSpec,
        supportSocketIds: moduleSpec.supportSocketIds.map((socketId) => {
          const oldSocket = oldSocketsById.get(socketId);
          if (!oldSocket) return socketId;
          return newSocketByCoordinate.get(coordinateKey(oldSocket)) || `missing:${socketId}`;
        })
      }));
    }

    return next;
  }

  function listReplacementPatterns(config, levelIndex, runId) {
    const run = getRun(config, runId);
    if (!run || levelIndex < 0 || levelIndex >= run.levels.length) return [];
    const baseConfig = configWithLevelCount(config, run.id, levelIndex);
    return listNextLevelPatterns(baseConfig, run.id).filter((pattern) => {
      const candidate = replaceLevelWithPattern(config, levelIndex, pattern, run.id);
      return validateConfig(candidate).valid;
    });
  }

  function removeTopLevel(config, runId) {
    const next = cloneConfig(config);
    const run = getRun(next, runId);
    if (run && run.levels.length) run.levels.pop();
    return next;
  }

  function addBaseSlot(config, type, gapBefore, runId) {
    const next = cloneConfig(config);
    const run = getRun(next, runId);
    if (!run) return next;
    run.baseSlots.push(createBaseSlot(type, {
      id: nextSlotId(run, type),
      gapBefore: gapBefore || "adjacent",
      finish: nextFinish(run.baseSlots.length)
    }));
    run.levels = [];
    return next;
  }

  function removeLastBaseSlot(config, runId) {
    const next = cloneConfig(config);
    const run = getRun(next, runId);
    if (!run || run.baseSlots.length <= 1) return next;
    run.baseSlots.pop();
    run.levels = [];
    return next;
  }

  function getBounds(layout) {
    const modules = layout.modules || [];
    if (!modules.length) {
      return {
        minX: -300,
        maxX: 900,
        minY: 0,
        maxY: 280,
        minZ: 0,
        maxZ: 800
      };
    }

    return modules.reduce((bounds, module) => ({
      minX: Math.min(bounds.minX, module.x),
      maxX: Math.max(bounds.maxX, module.x + moduleSpan(module.definition)),
      minY: Math.min(bounds.minY, module.y),
      maxY: Math.max(bounds.maxY, module.y + module.definition.depth),
      minZ: Math.min(bounds.minZ, module.z),
      maxZ: Math.max(bounds.maxZ, module.z + module.definition.height)
    }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity
    });
  }

  function findPattern(config, predicate, runId) {
    return listNextLevelPatterns(config, runId).find(predicate);
  }

  function createDemoConfig(name) {
    if (name === "slim_gap_bridge") {
      let config = createConfig([
        createBaseSlot("standard_base", { id: "left_base", finish: "sage" }),
        createBaseSlot("standard_base", { id: "right_base", gapBefore: "slim_gap", finish: "marine" })
      ]);
      const bridge = findPattern(config, (pattern) => (
        pattern.modules.length === 1 &&
        pattern.modules[0].type === "slim_extension" &&
        pattern.id.includes(":gap:")
      ));
      return bridge ? applyPattern(config, bridge) : config;
    }

    if (name === "adjacent_pair") {
      return createConfig([
        createBaseSlot("standard_base", { id: "left_base", finish: "sage" }),
        createBaseSlot("standard_base", { id: "right_base", gapBefore: "adjacent", finish: "marine" })
      ]);
    }

    if (name === "adapter_booster_slim") {
      let config = createConfig([
        createBaseSlot("wide_base", { id: "wide_base_01", finish: "sage" })
      ]);
      const adapter = findPattern(config, (pattern) => (
        pattern.modules.length === 1 && pattern.modules[0].type === "wide_adapter"
      ));
      config = adapter ? applyPattern(config, adapter) : config;
      const combo = findPattern(config, (pattern) => {
        const types = pattern.modules.map((module) => module.type).sort();
        return types.join("+") === "slim_extension+standard_booster";
      });
      return combo ? applyPattern(config, combo) : config;
    }

    let config = createConfig([
      createBaseSlot("standard_base", { id: "standard_base_01", finish: "sage" })
    ]);
    for (let index = 0; index < 3; index += 1) {
      const standard = findPattern(config, (pattern) => (
        pattern.modules.length === 1 && pattern.modules[0].type === "standard_extension"
      ));
      if (!standard) break;
      config = applyPattern(config, standard);
    }
    return config;
  }

  function sceneConfigFromLayout(layout) {
    return {
      modules: (layout.modules || []).map((module) => ({
        id: module.id,
        type: module.type,
        x: module.x,
        y: module.y,
        z: module.z,
        finish: module.finish,
        supportSocketIds: module.supportSocketIds
      }))
    };
  }

  const api = {
    EPSILON_MM,
    BASE_TYPES,
    FINISHES,
    FINISH_ORDER,
    GAP_TYPES,
    MODULES,
    addBaseSlot,
    applyPattern,
    cloneConfig,
    collectTopSockets,
    createBaseSlot,
    createConfig,
    createDemoConfig,
    getBounds,
    getDefinition,
    getRun,
    layoutConfig,
    layoutRun,
    listNextLevelPatterns,
    listReplacementPatterns,
    listSupportSpans,
    moduleSpan,
    nextFinish,
    removeLastBaseSlot,
    removeTopLevel,
    replaceLevelWithPattern,
    sceneConfigFromLayout,
    validateConfig
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ShelvingBuilderCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

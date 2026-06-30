(function () {
  "use strict";

  const Core = window.ShelvingBuilderCore;
  const state = {
    config: Core.createDemoConfig("slim_gap_bridge"),
    selectedLevelIndex: null,
    patternIndex: 0,
    selectedGap: "adjacent",
    selectedBaseType: "standard_base",
    showSockets: false
  };

  const elements = {};

  function $(selector) {
    return document.querySelector(selector);
  }

  function svgEl(name, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes || {}).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  }

  function pointString(points) {
    return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  }

  function shadeHex(hex, amount) {
    const clean = hex.replace("#", "");
    const channels = [0, 2, 4].map((offset) => {
      const value = parseInt(clean.slice(offset, offset + 2), 16);
      return Math.max(0, Math.min(255, value + amount));
    });
    return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function currentRunId() {
    return state.config.selectedRunId || state.config.runs[0]?.id;
  }

  function moduleShortName(type) {
    const names = {
      standard_base: "Standard base",
      wide_base: "Wide base",
      standard_extension: "Standard shelf",
      slim_extension: "Slim shelf",
      wide_extension: "Wide shelf",
      wide_adapter: "Wide adapter",
      standard_booster: "Booster"
    };
    return names[type] || Core.MODULES[type]?.label || type;
  }

  function patternTitle(pattern) {
    if (!pattern) return "No legal pattern";
    return pattern.modules.map((module) => moduleShortName(module.type)).join(" + ");
  }

  function patternContext(pattern) {
    if (!pattern) return "Try a different base run or remove the top layer.";
    if (pattern.spanIds.some((id) => id.includes(":gap:"))) return "Bridge a named gap";
    if (pattern.spanIds.some((id) => id.includes("composite"))) return "Span across a split support";
    if (pattern.kind === "combo") return "Multiple modules in one layer";
    return "Single module layer";
  }

  function activePatterns() {
    if (state.selectedLevelIndex === null) {
      return Core.listNextLevelPatterns(state.config, currentRunId());
    }
    return Core.listReplacementPatterns(state.config, state.selectedLevelIndex, currentRunId());
  }

  function normalizePatternIndex(patterns) {
    if (!patterns.length) {
      state.patternIndex = 0;
      return null;
    }
    state.patternIndex = ((state.patternIndex % patterns.length) + patterns.length) % patterns.length;
    return patterns[state.patternIndex];
  }

  function buildProjector(bounds, width, height) {
    const padding = 66;
    const fitBounds = {
      minX: bounds.minX - 110,
      maxX: bounds.maxX + 110,
      minY: bounds.minY - 70,
      maxY: bounds.maxY + 70,
      minZ: bounds.minZ - 50,
      maxZ: bounds.maxZ + 45
    };
    const centerX = (fitBounds.minX + fitBounds.maxX) / 2;
    const centerY = (fitBounds.minY + fitBounds.maxY) / 2;
    const centerZ = (fitBounds.minZ + fitBounds.maxZ) / 2;

    function rawProject(x, y, z) {
      return {
        x: (x - centerX) - (y - centerY) * 0.72,
        y: (x - centerX) * 0.38 + (y - centerY) * 0.38 - (z - centerZ)
      };
    }

    const corners = [
      [fitBounds.minX, fitBounds.minY, fitBounds.minZ],
      [fitBounds.maxX, fitBounds.minY, fitBounds.minZ],
      [fitBounds.minX, fitBounds.maxY, fitBounds.minZ],
      [fitBounds.maxX, fitBounds.maxY, fitBounds.minZ],
      [fitBounds.minX, fitBounds.minY, fitBounds.maxZ],
      [fitBounds.maxX, fitBounds.minY, fitBounds.maxZ],
      [fitBounds.minX, fitBounds.maxY, fitBounds.maxZ],
      [fitBounds.maxX, fitBounds.maxY, fitBounds.maxZ]
    ].map((corner) => rawProject(corner[0], corner[1], corner[2]));

    const projectedBounds = corners.reduce((box, point) => ({
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y)
    }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity
    });

    const projectedWidth = Math.max(1, projectedBounds.maxX - projectedBounds.minX);
    const projectedHeight = Math.max(1, projectedBounds.maxY - projectedBounds.minY);
    const scale = Math.min(
      (width - padding * 2) / projectedWidth,
      (height - padding * 2) / projectedHeight
    );
    const offsetX = width / 2 - ((projectedBounds.minX + projectedBounds.maxX) / 2) * scale;
    const offsetY = height / 2 - ((projectedBounds.minY + projectedBounds.maxY) / 2) * scale;

    return function project(x, y, z) {
      const point = rawProject(x, y, z);
      const worldX = x - centerX;
      const worldY = y - centerY;
      const worldZ = z - centerZ;
      return {
        x: offsetX + point.x * scale,
        y: offsetY + point.y * scale,
        depth: worldX * 0.72 + worldY + worldZ * 0.65
      };
    };
  }

  function cuboidFaces(x0, x1, y0, y1, z0, z1, project) {
    const p000 = project(x0, y0, z0);
    const p100 = project(x1, y0, z0);
    const p010 = project(x0, y1, z0);
    const p110 = project(x1, y1, z0);
    const p001 = project(x0, y0, z1);
    const p101 = project(x1, y0, z1);
    const p011 = project(x0, y1, z1);
    const p111 = project(x1, y1, z1);

    return [
      { name: "left", points: [p000, p010, p011, p001] },
      { name: "right", points: [p100, p110, p111, p101] },
      { name: "front", points: [p000, p100, p101, p001] },
      { name: "top", points: [p001, p101, p111, p011] }
    ];
  }

  function addPolygon(group, points, className, fill, stroke) {
    const polygon = svgEl("polygon", {
      points: pointString(points),
      class: className,
      fill,
      stroke: stroke || "rgba(28, 34, 32, 0.28)"
    });
    group.appendChild(polygon);
  }

  function drawRod(group, x, y, z0, z1, color, project) {
    const start = project(x, y, z0);
    const end = project(x, y, z1);
    group.appendChild(svgEl("line", {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      class: "builder-rod-shadow",
      stroke: shadeHex(color, -34),
      "stroke-width": 9.2,
      "stroke-linecap": "round"
    }));
    group.appendChild(svgEl("line", {
      x1: start.x - 0.7,
      y1: start.y,
      x2: end.x - 0.7,
      y2: end.y,
      class: "builder-rod",
      stroke: color,
      "stroke-width": 7.2,
      "stroke-linecap": "round"
    }));
    group.appendChild(svgEl("line", {
      x1: start.x - 1.8,
      y1: start.y,
      x2: end.x - 1.8,
      y2: end.y,
      class: "builder-rod-highlight",
      stroke: shadeHex(color, 36),
      "stroke-width": 1.5,
      "stroke-linecap": "round"
    }));
  }

  function drawRodCap(group, x, y, z, color, project) {
    const p = project(x, y, z);
    group.appendChild(svgEl("ellipse", {
      cx: p.x - 0.7,
      cy: p.y - 0.7,
      rx: 5.4,
      ry: 3.8,
      class: "builder-rod-cap",
      fill: shadeHex(color, 18),
      stroke: shadeHex(color, -32)
    }));
  }

  function drawFoot(group, x, y, project) {
    const p = project(x, y, 0);
    group.appendChild(svgEl("ellipse", {
      cx: p.x,
      cy: p.y + 8,
      rx: 4.8,
      ry: 2.6,
      class: "builder-foot-pad"
    }));
    group.appendChild(svgEl("line", {
      x1: p.x,
      y1: p.y + 1,
      x2: p.x,
      y2: p.y + 7,
      class: "builder-foot"
    }));
  }

  function shelfBox(module) {
    const definition = module.definition;
    const span = Core.moduleSpan(definition);
    const overhangX = definition.role === "booster" ? 0 : 78;
    const overhangY = definition.role === "booster" ? 0 : 24;
    const thickness = 30;
    const z1 = module.z + definition.height;
    return {
      x0: module.x - overhangX,
      x1: module.x + span + overhangX,
      y0: module.y - overhangY,
      y1: module.y + definition.depth + overhangY,
      z0: z1 - thickness,
      z1
    };
  }

  function drawShelf(group, module, finish, project) {
    const box = shelfBox(module);
    const faces = cuboidFaces(box.x0, box.x1, box.y0, box.y1, box.z0, box.z1, project);
    const faceColors = {
      left: shadeHex(finish.mdfEdge, -10),
      right: shadeHex(finish.mdfEdge, 2),
      front: shadeHex(finish.mdfEdge, -18),
      top: shadeHex(finish.mdf, 12)
    };
    ["left", "right", "front", "top"].forEach((faceName) => {
      const face = faces.find((candidate) => candidate.name === faceName);
      addPolygon(group, face.points, `board-face ${face.name}`, faceColors[face.name]);
    });
  }

  function drawModule(svg, module, project) {
    const finish = Core.FINISHES[module.finish] || Core.FINISHES.sage;
    const definition = module.definition;
    const group = svgEl("g", {
      class: `module-shape module-${definition.role}`,
      "data-module-id": module.id
    });

    if (definition.hasShelf) {
      drawShelf(group, module, finish, project);
    }

    definition.topColumns.forEach((column) => {
      const x = module.x + column;
      drawRod(group, x, 0, module.z, module.z + definition.height, finish.steel, project);
      drawRod(group, x, definition.depth, module.z, module.z + definition.height, finish.steel, project);
      drawRodCap(group, x, 0, module.z + definition.height, finish.steel, project);
      drawRodCap(group, x, definition.depth, module.z + definition.height, finish.steel, project);
      if (definition.canStartRun) {
        drawFoot(group, x, 0, project);
        drawFoot(group, x, definition.depth, project);
      }
    });

    if (definition.role === "booster" && state.showSockets) {
      const p = project(module.x, definition.depth / 2, module.z + definition.height + 26);
      const label = svgEl("text", {
        x: p.x,
        y: p.y,
        class: "tiny-label",
        "text-anchor": "middle"
      });
      label.textContent = "booster";
      group.appendChild(label);
    }

    svg.appendChild(group);
  }

  function duplicateSocketOffsets(sockets) {
    const groups = new Map();
    sockets.forEach((socket) => {
      const key = `${socket.x}:${socket.y}:${socket.z}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(socket.id);
    });
    const offsets = new Map();
    groups.forEach((ids) => {
      ids.forEach((id, index) => {
        const offset = ids.length > 1 ? (index - (ids.length - 1) / 2) * 7 : 0;
        offsets.set(id, offset);
      });
    });
    return offsets;
  }

  function drawSockets(svg, modules, project) {
    if (!state.showSockets) return;
    const sockets = Core.collectTopSockets(modules);
    const offsets = duplicateSocketOffsets(sockets);
    sockets.forEach((socket) => {
      const p = project(socket.x, socket.y, socket.z);
      svg.appendChild(svgEl("circle", {
        cx: p.x + (offsets.get(socket.id) || 0),
        cy: p.y,
        r: 4.2,
        class: "socket-dot"
      }));
    });
  }

  function drawGapGuides(svg, runLayout, project) {
    if (!state.showSockets) return;
    const spans = Core.listSupportSpans(state.config, currentRunId()).filter((span) => span.kind === "gap");
    spans.forEach((span) => {
      const p0 = project(span.x0, 310, span.z);
      const p1 = project(span.x1, 310, span.z);
      svg.appendChild(svgEl("line", {
        x1: p0.x,
        y1: p0.y,
        x2: p1.x,
        y2: p1.y,
        class: "gap-guide"
      }));
      const labelPoint = project((span.x0 + span.x1) / 2, 360, span.z);
      const label = svgEl("text", {
        x: labelPoint.x,
        y: labelPoint.y,
        class: "gap-label",
        "text-anchor": "middle"
      });
      label.textContent = span.spanName;
      svg.appendChild(label);
    });
  }

  function drawScene(validation) {
    const svg = elements.scene;
    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 620;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";

    const layout = validation.layout;
    const bounds = Core.getBounds(layout);
    const project = buildProjector(bounds, width, height);

    svg.appendChild(svgEl("rect", {
      x: 0,
      y: 0,
      width,
      height,
      class: "stage-bg"
    }));

    const modules = [...layout.modules].sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      if (a.y !== b.y) return b.y - a.y;
      return a.x - b.x;
    });

    modules.forEach((module) => drawModule(svg, module, project));
    drawGapGuides(svg, layout.runs[0], project);
    drawSockets(svg, modules, project);
  }

  function renderBaseSlots(run) {
    elements.baseSlots.innerHTML = "";
    (run.baseSlots || []).forEach((slot, index) => {
      const row = document.createElement("div");
      row.className = "base-row";
      const gap = Core.GAP_TYPES[slot.gapBefore || "adjacent"];
      row.innerHTML = `
        <span>
          <strong>${Core.MODULES[slot.type].label}</strong>
          <small>${index === 0 ? "start" : gap.label}</small>
        </span>
        <span class="finish-chip" style="background:${Core.FINISHES[slot.finish].mdf};">${Core.FINISHES[slot.finish].label}</span>
      `;
      elements.baseSlots.appendChild(row);
    });
  }

  function renderLevels(run) {
    elements.levels.innerHTML = "";
    if (!run.levels.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No upper levels yet.";
      elements.levels.appendChild(empty);
      return;
    }

    run.levels.forEach((level, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = state.selectedLevelIndex === index ? "level-row selected" : "level-row";
      row.innerHTML = `
        <span>
          <strong>Level ${index + 1}</strong>
          <small>${level.modules.map((module) => moduleShortName(module.type)).join(" + ")}</small>
        </span>
        <span>Cycle</span>
      `;
      row.addEventListener("click", () => {
        state.selectedLevelIndex = index;
        state.patternIndex = 0;
        render();
      });
      elements.levels.appendChild(row);
    });
  }

  function renderPatternChooser(patterns) {
    const pattern = normalizePatternIndex(patterns);
    elements.layerTarget.textContent = state.selectedLevelIndex === null
      ? "Adding a new top layer"
      : `Cycling level ${state.selectedLevelIndex + 1}`;

    elements.patternCard.innerHTML = "";
    if (!pattern) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No legal pattern for this layer.";
      elements.patternCard.appendChild(empty);
    } else {
      const title = document.createElement("strong");
      title.textContent = patternTitle(pattern);
      elements.patternCard.appendChild(title);

      const context = document.createElement("small");
      context.textContent = `${patternContext(pattern)} / ${state.patternIndex + 1} of ${patterns.length}`;
      elements.patternCard.appendChild(context);

      const chips = document.createElement("div");
      chips.className = "module-chips";
      pattern.modules.forEach((module) => {
        const chip = document.createElement("span");
        chip.className = "module-chip";
        chip.textContent = moduleShortName(module.type);
        chips.appendChild(chip);
      });
      elements.patternCard.appendChild(chips);
    }

    elements.patternPrev.disabled = patterns.length <= 1;
    elements.patternNext.disabled = patterns.length <= 1;
    elements.patternApply.disabled = !pattern;
    elements.patternApply.textContent = state.selectedLevelIndex === null ? "+" : "Apply";
  }

  function renderStatus(validation) {
    elements.validation.innerHTML = "";
    if (!validation.errors.length) {
      const ok = document.createElement("div");
      ok.className = "validation-ok";
      ok.textContent = "Valid level build";
      elements.validation.appendChild(ok);
      return;
    }

    validation.errors.forEach((error) => {
      const row = document.createElement("div");
      row.className = "validation-error";
      row.textContent = error.message;
      elements.validation.appendChild(row);
    });
  }

  function renderStats(validation) {
    const bounds = Core.getBounds(validation.layout);
    const modules = validation.layout.modules || [];
    const total = modules.reduce((sum, module) => sum + module.definition.price, 0);
    elements.stats.innerHTML = `
      <span>${modules.length} modules</span>
      <span>${Math.round(bounds.maxX - bounds.minX)} mm run</span>
      <span>${Math.round(bounds.maxZ - bounds.minZ)} mm high</span>
      <span>Ksh ${total.toLocaleString()}</span>
    `;
  }

  function renderJson(validation) {
    elements.json.value = JSON.stringify({
      builder: state.config,
      generatedScene: Core.sceneConfigFromLayout(validation.layout)
    }, null, 2);
  }

  function renderSelectors() {
    elements.gapSelect.value = state.selectedGap;
    elements.baseTypeSelect.value = state.selectedBaseType;
    elements.socketToggle.classList.toggle("active", state.showSockets);
  }

  function render() {
    const validation = Core.validateConfig(state.config);
    const run = Core.getRun(state.config, currentRunId());
    const patterns = activePatterns();

    drawScene(validation);
    renderBaseSlots(run);
    renderLevels(run);
    renderPatternChooser(patterns);
    renderStatus(validation);
    renderStats(validation);
    renderJson(validation);
    renderSelectors();
  }

  function bind() {
    elements.scene = $("#builder-scene");
    elements.stats = $("#builder-stats");
    elements.baseSlots = $("#builder-base-slots");
    elements.levels = $("#builder-levels");
    elements.layerTarget = $("#builder-layer-target");
    elements.patternCard = $("#builder-pattern-card");
    elements.patternPrev = $("#pattern-prev");
    elements.patternNext = $("#pattern-next");
    elements.patternApply = $("#pattern-apply");
    elements.validation = $("#builder-validation");
    elements.json = $("#builder-json");
    elements.gapSelect = $("#gap-select");
    elements.baseTypeSelect = $("#base-type-select");
    elements.socketToggle = $("#toggle-sockets");

    elements.gapSelect.addEventListener("change", () => {
      state.selectedGap = elements.gapSelect.value;
    });

    elements.baseTypeSelect.addEventListener("change", () => {
      state.selectedBaseType = elements.baseTypeSelect.value;
    });

    $("#add-base").addEventListener("click", () => {
      state.config = Core.addBaseSlot(state.config, state.selectedBaseType, state.selectedGap, currentRunId());
      state.selectedLevelIndex = null;
      state.patternIndex = 0;
      render();
    });

    $("#remove-base").addEventListener("click", () => {
      state.config = Core.removeLastBaseSlot(state.config, currentRunId());
      state.selectedLevelIndex = null;
      state.patternIndex = 0;
      render();
    });

    $("#select-new-level").addEventListener("click", () => {
      state.selectedLevelIndex = null;
      state.patternIndex = 0;
      render();
    });

    $("#remove-level").addEventListener("click", () => {
      state.config = Core.removeTopLevel(state.config, currentRunId());
      state.selectedLevelIndex = null;
      state.patternIndex = 0;
      render();
    });

    $("#reset-builder").addEventListener("click", () => {
      state.config = Core.createConfig();
      state.selectedLevelIndex = null;
      state.patternIndex = 0;
      render();
    });

    elements.patternPrev.addEventListener("click", () => {
      state.patternIndex -= 1;
      render();
    });

    elements.patternNext.addEventListener("click", () => {
      state.patternIndex += 1;
      render();
    });

    elements.patternApply.addEventListener("click", () => {
      const patterns = activePatterns();
      const pattern = normalizePatternIndex(patterns);
      if (!pattern) return;
      if (state.selectedLevelIndex === null) {
        state.config = Core.applyPattern(state.config, pattern, currentRunId());
      } else {
        state.config = Core.replaceLevelWithPattern(state.config, state.selectedLevelIndex, pattern, currentRunId());
      }
      state.patternIndex = 0;
      render();
    });

    elements.socketToggle.addEventListener("click", () => {
      state.showSockets = !state.showSockets;
      render();
    });

    document.querySelectorAll("[data-demo]").forEach((button) => {
      button.addEventListener("click", () => {
        state.config = Core.createDemoConfig(button.dataset.demo);
        state.selectedLevelIndex = null;
        state.patternIndex = 0;
        render();
      });
    });

    $("#load-json").addEventListener("click", () => {
      try {
        const parsed = JSON.parse(elements.json.value);
        state.config = parsed.builder || parsed;
        state.selectedLevelIndex = null;
        state.patternIndex = 0;
        render();
      } catch (error) {
        elements.validation.innerHTML = `<div class="validation-error">${error.message}</div>`;
      }
    });

    window.addEventListener("resize", render);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    render();
  });
})();

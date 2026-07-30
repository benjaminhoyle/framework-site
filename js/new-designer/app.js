/**
 * Shelf designer — the three interfaces.
 *
 *   Simple    pick a unit type, a width, a height, a colour, a lamp, bookends.
 *             The design is generated, not assembled by hand. Mirrors the
 *             current /simplified-designer page.
 *   Standard  in-viewport "+" buttons, a limited set of pieces, and units that
 *             can only butt directly against each other. Mirrors /designer.
 *   Advanced  every piece, gapped unit spacing for bridging spans, rotation,
 *             and save/load.
 *
 * All three share one viewport, one control column, one summary bar, and one
 * placement engine. Only the contents of the control column change.
 *
 * The view is a locked isometric: pan and zoom, auto-fit as the shelf grows.
 * There is no orbit, so nobody can lose the shelf off-screen or end up looking
 * at it from underneath.
 */
(function () {
  "use strict";

  const engine = window.FrameworkDesignerEngine;
  const geometryLoader = window.FrameworkDesignerGeometry;
  const rendererFactory = window.FrameworkDesignerRenderer;

  const CATALOG_URL = "assets/shelving/catalog.json";
  const MODULE_BASE_URL = "assets/shelving/modules";
  const WHATSAPP_PHONE = "254783891005";

  const MODES = ["simple", "standard", "advanced"];

  // Which pieces each interface offers. Simple never shows a piece list at all
  // -- it only ever generates bases, extensions and a lamp -- but the same
  // filter decides what its generator is allowed to reach for.
  const TIER_ROLES = {
    simple: ["base", "extension", "lamp"],
    standard: ["base", "extension", "spacer", "hanger", "top_bar", "lamp"]
  };

  // Unit families, in the order the current site presents them. "Trimmed"
  // variants are shortened cuts of the same unit and only appear in Advanced.
  const FAMILY_LABELS = {
    standard: "Standard",
    compact: "Compact",
    wide: "Wide",
    deep: "Deep",
    slim: "Slim",
    broad: "Broad"
  };
  const FAMILY_ORDER = ["standard", "compact", "wide", "deep", "slim", "broad"];

  /*
   * Render colours come from the catalog's real product hexes, so the swatch in
   * the panel and the shelf in the viewport can never drift apart. They are
   * scaled up first because the shader's light term lands a shelf top at about
   * 0.94 of its base colour and a vertical steel tube at about 0.79 -- feeding
   * the raw hex straight in makes every finish read a shade too dark.
   */
  const SURFACE_GAIN = 1.07;
  const STEEL_GAIN = 1.26;

  function scaleHex(hex, gain) {
    const value = parseInt(String(hex).replace("#", ""), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
      .map((channel) => Math.min(255, Math.round(channel * gain)));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  const SIMPLE_LIMITS = { width: [1, 6], levels: [1, 6] };
  const HISTORY_LIMIT = 40;

  // ---------------------------------------------------------------- helpers --

  function el(id) {
    return document.getElementById(id);
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Millimetres to whole centimetres, rounding the way the shop quotes it. */
  function mmToCm(mm) {
    return Math.max(0, Math.round(mm / 10));
  }

  function formatKsh(amount) {
    return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
  }

  function toBase64Url(text) {
    return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(text) {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  }

  function track(event, params) {
    try {
      if (typeof window.gtag === "function") window.gtag("event", event, params || {});
      if (typeof window.fbq === "function" && event === "order_click") window.fbq("track", "Lead", params || {});
    } catch (error) {
      /* analytics must never break the tool */
    }
  }

  // ------------------------------------------------------------------- boot --

  const dom = {
    app: el("nd-app"),
    stage: el("nd-stage"),
    canvas: el("nd-canvas"),
    overlay: el("nd-overlay"),
    controls: el("nd-controls"),
    panelTitle: el("nd-panel-title"),
    collapse: el("nd-collapse"),
    modes: el("nd-modes"),
    undo: el("nd-undo"),
    zoomIn: el("nd-zoom-in"),
    zoomOut: el("nd-zoom-out"),
    fit: el("nd-fit"),
    hint: el("nd-hint"),
    busy: el("nd-busy"),
    fallback: el("nd-fallback"),
    fallbackTitle: el("nd-fallback-title"),
    fallbackBody: el("nd-fallback-body"),
    total: el("nd-total"),
    totalNote: el("nd-total-note"),
    order: el("nd-order"),
    modal: el("nd-modal"),
    modalTitle: el("nd-modal-title"),
    modalBody: el("nd-modal-body"),
    modalClose: el("nd-modal-close")
  };

  const ui = {
    mode: "simple",
    catalog: null,
    renderer: null,
    design: null,
    history: [],
    selectedId: null,
    activeModuleId: null, // Advanced: the piece whose placements are on screen
    candidates: [],
    candidateContext: null,
    candidateCache: new Map(),
    pendingModules: new Set(),
    simple: { family: "standard", width: 1, levels: 2, lamp: false },
    search: "",
    actionMenu: null,
    hintTimer: 0
  };

  function showFallback(title, body) {
    dom.fallbackTitle.textContent = title;
    dom.fallbackBody.textContent = body;
    dom.fallback.hidden = false;
  }

  function setHint(text, isError) {
    window.clearTimeout(ui.hintTimer);
    if (!text) {
      dom.hint.hidden = true;
      return;
    }
    dom.hint.textContent = text;
    dom.hint.classList.toggle("is-error", Boolean(isError));
    dom.hint.hidden = false;
    ui.hintTimer = window.setTimeout(() => { dom.hint.hidden = true; }, isError ? 6000 : 4500);
  }

  function setBusy(busy) {
    dom.busy.hidden = !busy;
  }

  function boot() {
    if (!engine || !geometryLoader || !rendererFactory) {
      showFallback("Could not start the designer", "Some files did not load. Please refresh the page.");
      return;
    }

    showFallback("Loading the designer…", "Fetching the shelf catalogue.");

    // The page starts this fetch inline in <head>, before these deferred
    // scripts have even parsed; fall back to starting it here if that is gone.
    const catalogRequest = window.frameworkDesignerCatalog
      || fetch(CATALOG_URL).then((response) => {
        if (!response.ok) throw new Error(`catalogue HTTP ${response.status}`);
        return response.json();
      });

    catalogRequest
      .then((catalog) => {
        ui.catalog = engine.normalizeCatalog(catalog);
        computeSiteVariants();
        return start();
      })
      .catch((error) => {
        console.error(error);
        showFallback(
          "Could not load the shelf catalogue",
          "Check your connection and refresh. You can also message us on WhatsApp and we will design it with you."
        );
      });
  }

  function start() {
    // A low pixel ratio is the single biggest fill-rate saving on a phone, and
    // at this zoom level the difference is barely visible.
    const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 4)
      || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    const renderer = rendererFactory.create(dom.canvas, {
      antialias: !lowEnd,
      onFrame: positionOverlays
    });
    if (!renderer) {
      showFallback(
        "3D is not available in this browser",
        "Your browser could not start WebGL. Try Chrome, or message us on WhatsApp and we will design it with you."
      );
      return;
    }
    ui.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2));

    dom.fallback.hidden = true;
    bindEvents();

    // Support hook: lets us inspect or reproduce a customer's design from the
    // console without instrumenting the page. Read-mostly, no UI depends on it.
    window.FrameworkDesignerApp = {
      ui,
      renderer,
      engine,
      refresh,
      getDesign: () => engine.serializeState(ui.design)
    };

    const restored = readHash();
    if (restored) {
      ui.mode = restored.mode;
      ui.design = restored.design;
      if (restored.simple) ui.simple = restored.simple;
    } else {
      ui.design = buildSimpleDesign(ui.simple, "sage", 0);
    }
    applyMode(ui.mode, { silent: true });
    refresh({ fit: true });
  }

  // ------------------------------------------------------------ design state --

  function pushHistory() {
    ui.history.push(engine.serializeState(ui.design));
    if (ui.history.length > HISTORY_LIMIT) ui.history.shift();
    dom.undo.disabled = ui.history.length === 0;
  }

  function undo() {
    const previous = ui.history.pop();
    if (!previous) return;
    try {
      ui.design = engine.deserializeState(ui.catalog, previous);
    } catch (error) {
      console.error(error);
      return;
    }
    dom.undo.disabled = ui.history.length === 0;
    ui.selectedId = null;
    ui.activeModuleId = null;
    if (ui.mode === "simple") ui.simple = deriveSimpleSpec(ui.design) || ui.simple;
    refresh({ fit: true });
  }

  function commit(nextDesign, options) {
    if (!nextDesign) {
      setHint("That does not fit here.", true);
      return false;
    }
    pushHistory();
    ui.design = nextDesign;
    ui.selectedId = null;
    ui.activeModuleId = null;
    refresh(options || {});
    return true;
  }

  // ----------------------------------------------------- Simple generation ---

  function availableFamilies() {
    return FAMILY_ORDER.filter((family) => siteVariant(family, "base") && siteVariant(family, "extension"));
  }

  /**
   * Build a plain run from a Simple-mode spec: `width` units side by side, each
   * carrying `levels - 1` shelves, optionally one lamp on top.
   *
   * Generated rather than hand-assembled, so the same spec always produces the
   * same shelf and Simple's steppers stay predictable.
   */
  function buildSimpleDesign(spec, finish, bookends) {
    let state = engine.createState(ui.catalog, { finish, bookends });
    const baseId = siteVariant(spec.family, "base");
    const extensionId = siteVariant(spec.family, "extension");
    if (!baseId || !extensionId) return state;

    for (let unit = 0; unit < spec.width; unit += 1) {
      const candidates = engine.generateCandidates(ui.catalog, state, baseId, { adjacentBasesOnly: true });
      if (!candidates.length) break;
      // Grow rightwards: the right-most legal origin.
      const pick = candidates.reduce((best, candidate) =>
        candidate.originWorldMm[0] > best.originWorldMm[0] ? candidate : best);
      state = engine.applyCandidate(ui.catalog, state, pick);
    }

    for (let level = 1; level < spec.levels; level += 1) {
      for (let unit = 0; unit < spec.width; unit += 1) {
        const candidates = engine.generateCandidates(ui.catalog, state, extensionId);
        if (!candidates.length) break;
        // Candidates are sorted by support height then x, so taking the first
        // fills the lowest open level left to right.
        state = engine.applyCandidate(ui.catalog, state, candidates[0]);
      }
    }

    if (spec.lamp && ui.catalog.modules.lamp) {
      const candidates = engine.generateCandidates(ui.catalog, state, "lamp");
      if (candidates.length) {
        // Highest, then left-most: a lamp belongs on top of the run.
        const pick = candidates.reduce((best, candidate) => {
          if (candidate.supportPlaneZ > best.supportPlaneZ) return candidate;
          if (candidate.supportPlaneZ < best.supportPlaneZ) return best;
          return candidate.originWorldMm[0] < best.originWorldMm[0] ? candidate : best;
        });
        state = engine.applyCandidate(ui.catalog, state, pick);
      }
    }
    return state;
  }

  /**
   * Read a Simple-mode spec back out of an arbitrary design, so switching down
   * from Standard/Advanced lands on the nearest simple shelf instead of an
   * empty one. Returns null when there is nothing to read.
   */
  function deriveSimpleSpec(design) {
    const bases = design.instances.filter((instance) => ui.catalog.modules[instance.moduleId].role === "base");
    if (!bases.length) return null;
    const counts = new Map();
    for (const base of bases) {
      const family = ui.catalog.modules[base.moduleId].family;
      if (family) counts.set(family, (counts.get(family) || 0) + 1);
    }
    let family = ui.simple.family;
    let best = 0;
    counts.forEach((count, name) => {
      if (count > best) {
        best = count;
        family = name;
      }
    });
    const { groups } = engine.stacksOf(design);
    let levels = 1;
    groups.forEach((ids) => {
      const stacked = ids.filter((id) => {
        const instance = design.instances.find((candidate) => candidate.id === id);
        return instance && ui.catalog.modules[instance.moduleId].role === "extension";
      });
      levels = Math.max(levels, stacked.length + 1);
    });
    return {
      family: availableFamilies().indexOf(family) >= 0 ? family : "standard",
      width: Math.min(SIMPLE_LIMITS.width[1], Math.max(SIMPLE_LIMITS.width[0], bases.length)),
      levels: Math.min(SIMPLE_LIMITS.levels[1], Math.max(SIMPLE_LIMITS.levels[0], levels)),
      lamp: design.instances.some((instance) => instance.moduleId === "lamp")
    };
  }

  function rebuildSimple(changes) {
    Object.assign(ui.simple, changes || {});
    const next = buildSimpleDesign(ui.simple, ui.design.finish, ui.design.bookends);
    const actual = deriveSimpleSpec(next);
    if (actual) {
      // If the engine could not fit everything asked for, show what it did fit
      // rather than leaving the steppers lying.
      ui.simple.width = actual.width;
      ui.simple.levels = actual.levels;
    }
    commit(next, { fit: true });
  }

  // -------------------------------------------------------------- catalogue --

  /**
   * Which variant of each (family, role) the website actually sells.
   *
   * Several units exist as both a full and a "trimmed" (shortened) cut, and the
   * shop does not always list the full one: a compact unit is only sold as
   * compact_base_trimmed, so excluding every trimmed module — as a first pass
   * did — left Simple and Standard offering a compact shelf with no price. Pick
   * the priced variant, preferring the untrimmed one where both are priced.
   */
  function computeSiteVariants() {
    const chosen = new Map(); // "family:role" -> module id
    const groups = new Map();
    for (const module of Object.values(ui.catalog.modules)) {
      if (module.isCorner) continue;
      const key = `${module.family || ""}:${module.role}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(module);
    }
    groups.forEach((modules, key) => {
      const priced = modules.filter((module) => module.priceKsh != null);
      const pool = priced.length ? priced : modules;
      const pick = pool.find((module) => !module.trimmed) || pool[0];
      chosen.set(key, pick.id);
    });
    ui.siteVariants = chosen;
    ui.siteVariantIds = new Set(chosen.values());
  }

  function siteVariant(family, role) {
    return ui.siteVariants.get(`${family || ""}:${role}`) || null;
  }

  function moduleAllowed(module, mode) {
    if (module.isCorner) return false;
    if (mode === "advanced") return true;
    if (!ui.siteVariantIds.has(module.id)) return false;
    return TIER_ROLES[mode].indexOf(module.role) >= 0;
  }

  function moduleLabel(module) {
    const label = module.label || module.id.replace(/_/g, " ");
    // Where the trimmed cut IS the product the shop sells, "(Trimmed)" is
    // internal vocabulary that would only confuse a customer. Advanced keeps it:
    // there both variants are on offer and the labels have to tell them apart.
    if (ui.mode === "advanced" || !ui.siteVariantIds.has(module.id)) return label;
    return label.replace(/\s*\(Trimmed\)\s*$/i, "");
  }

  function tierModules(mode) {
    return Object.keys(ui.catalog.modules)
      .map((id) => ui.catalog.modules[id])
      .filter((module) => moduleAllowed(module, mode))
      .sort((a, b) => {
        const familyRank = FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family);
        if (a.family !== b.family) return familyRank;
        return String(a.role).localeCompare(String(b.role)) || a.id.localeCompare(b.id);
      });
  }

  function candidateOptions(mode) {
    return { adjacentBasesOnly: mode !== "advanced", context: ui.candidateContext };
  }

  /**
   * Legal placements for every piece the current interface offers, computed
   * once per change. One shared additionContext turns what used to be a
   * quadratic re-validation per piece into a single pass.
   */
  function computeCandidateCache() {
    ui.candidateContext = engine.additionContext(ui.catalog, ui.design);
    ui.candidateCache = new Map();
    for (const module of tierModules(ui.mode)) {
      ui.candidateCache.set(module.id, engine.generateCandidates(ui.catalog, ui.design, module.id, candidateOptions(ui.mode)));
    }
  }

  // --------------------------------------------------------------- geometry --

  /** Fetch any module geometry the current design needs, then redraw. */
  function ensureGeometry(moduleIds) {
    const wanted = moduleIds.filter((id) => !ui.renderer.hasModule(id) && !ui.pendingModules.has(id));
    if (!wanted.length) return;
    wanted.forEach((id) => ui.pendingModules.add(id));
    setBusy(true);
    Promise.all(wanted.map((id) =>
      geometryLoader.load(MODULE_BASE_URL, id)
        .then((geometry) => ui.renderer.addModule(id, geometry))
        .catch((error) => {
          console.error(error);
          setHint("A shelf part could not load. Check your connection.", true);
        })
        .then(() => { ui.pendingModules.delete(id); })
    )).then(() => {
      setBusy(ui.pendingModules.size > 0);
      syncScene();
      positionOverlays();
    });
  }

  function renderInstance(instance) {
    const module = ui.catalog.modules[instance.moduleId];
    const pivot = engine.localPivot(module);
    return {
      id: instance.id,
      moduleId: instance.moduleId,
      translation: instance.translation,
      rotationDeg: instance.rotationDeg || 0,
      // The renderer rotates about the same point the engine's geometry maths
      // does, otherwise a rotated piece and its sockets would disagree.
      pivotMm: [instance.translation[0] + pivot[0], instance.translation[1] + pivot[1]],
      boundsMm: engine.instanceBounds(ui.catalog, instance),
      highlight: instance.id === ui.selectedId
    };
  }

  function syncScene() {
    ui.renderer.setInstances(ui.design.instances.map(renderInstance));
  }

  // --------------------------------------------------------------- overlays --

  /*
   * Overlay items are HTML positioned over the canvas. Each carries the world
   * point it belongs to, so a camera move only re-projects them (cheap) instead
   * of rebuilding the DOM.
   */
  let overlayItems = [];

  function buildOverlay() {
    clear(dom.overlay);
    overlayItems = [];
    ui.actionMenu = null;

    if (ui.mode !== "simple") {
      if (ui.activeModuleId) buildCandidateMarkers();
      else buildAddButtons();
      if (ui.selectedId) buildActionMenu();
    }
    positionOverlays();
  }

  function addOverlay(node, pointMm, offset) {
    dom.overlay.appendChild(node);
    overlayItems.push({ node, pointMm, offset: offset || [0, 0] });
    return node;
  }

  function positionOverlays() {
    if (!ui.renderer) return;
    const width = dom.stage.clientWidth;
    const height = dom.stage.clientHeight;
    for (const item of overlayItems) {
      const point = ui.renderer.project(item.pointMm);
      const x = point.x + item.offset[0];
      const y = point.y + item.offset[1];
      // Hide rather than clamp: a "+" pinned to the frame edge would point at
      // the wrong place on the shelf.
      const visible = x > -40 && y > -40 && x < width + 40 && y < height + 40;
      item.node.style.visibility = visible ? "visible" : "hidden";
      item.node.style.left = `${Math.round(x)}px`;
      item.node.style.top = `${Math.round(y)}px`;
    }
  }

  function centreOf(bounds) {
    return [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2];
  }

  function candidateBounds(candidate) {
    return engine.instanceBounds(ui.catalog, {
      moduleId: candidate.moduleId,
      translation: [candidate.transform.x, candidate.transform.y, candidate.transform.z],
      rotationDeg: 0
    });
  }

  /**
   * The "+" affordances: one at each end of the run, and one above each stack.
   *
   * Each carries every piece that legally fits at that spot, so tapping it
   * opens a short list instead of the app guessing.
   */
  function buildAddButtons() {
    const groupedSide = { left: [], right: [] };
    const groupedTop = new Map();
    const { rootOf, groups } = engine.stacksOf(ui.design);

    const baseXs = ui.design.instances
      .filter((instance) => ui.catalog.modules[instance.moduleId].role === "base")
      .map((instance) => instance.originWorldMm[0]);
    const minX = baseXs.length ? Math.min.apply(null, baseXs) : 0;
    const maxX = baseXs.length ? Math.max.apply(null, baseXs) : 0;

    ui.candidateCache.forEach((candidates, id) => {
      const module = ui.catalog.modules[id];
      for (const candidate of candidates) {
        if (module.role === "base") {
          if (!baseXs.length) {
            groupedSide.right.push({ module, candidate });
            continue;
          }
          const side = candidate.originWorldMm[0] > maxX ? "right" : candidate.originWorldMm[0] < minX ? "left" : null;
          if (!side) continue;
          // Keep only the nearest origin per piece per side: the further
          // gapped offsets are the same action, just spaced out.
          const existing = groupedSide[side].find((entry) => entry.module.id === id);
          const closer = side === "right"
            ? (!existing || candidate.originWorldMm[0] < existing.candidate.originWorldMm[0])
            : (!existing || candidate.originWorldMm[0] > existing.candidate.originWorldMm[0]);
          if (existing && closer) existing.candidate = candidate;
          else if (!existing) groupedSide[side].push({ module, candidate });
        } else {
          const consumed = candidate.consumedSockets || [];
          if (!consumed.length) continue;
          const roots = new Set(consumed.map((socket) => rootOf(socket.instanceId)));
          // A piece spanning two stacks has no single "above this stack" home.
          if (roots.size !== 1) continue;
          const root = consumed[0] && rootOf(consumed[0].instanceId);
          if (!groupedTop.has(root)) groupedTop.set(root, []);
          const options = groupedTop.get(root);
          if (!options.some((entry) => entry.module.id === id)) options.push({ module, candidate });
        }
      }
    });

    const designBounds = engine.designBounds(ui.catalog, ui.design);
    ["left", "right"].forEach((side) => {
      const options = groupedSide[side];
      if (!options.length) return;
      // Anchor on whichever option is nearest the current run, so the button
      // sits where the new unit would actually appear.
      const anchor = options.reduce((best, entry) =>
        Math.abs(entry.candidate.originWorldMm[0]) < Math.abs(best.candidate.originWorldMm[0]) ? entry : best);
      const spot = centreOf(candidateBounds(anchor.candidate));
      // Level with the middle of the existing run rather than the middle of the
      // new unit. In an isometric view those differ, and the low one lands in
      // the bottom-right corner underneath the zoom controls.
      if (designBounds) spot[2] = (designBounds[2] + designBounds[5]) / 2;
      const label = ui.design.instances.length ? "Add a unit here" : "Start your shelf";
      addOverlay(plusButton(label, options), spot);
    });

    groups.forEach((ids, root) => {
      const options = groupedTop.get(root);
      if (!options || !options.length) return;
      const bounds = stackBounds(ids);
      if (!bounds) return;
      addOverlay(
        plusButton("Add on top", options),
        [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, bounds[5]],
        [0, -26]
      );
    });
  }

  function stackBounds(ids) {
    const set = new Set(ids);
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let any = false;
    for (const instance of ui.design.instances) {
      if (!set.has(instance.id)) continue;
      const box = engine.instanceBounds(ui.catalog, instance);
      any = true;
      for (let axis = 0; axis < 3; axis += 1) {
        if (box[axis] < bounds[axis]) bounds[axis] = box[axis];
        if (box[axis + 3] > bounds[axis + 3]) bounds[axis + 3] = box[axis + 3];
      }
    }
    return any ? bounds : null;
  }

  function plusButton(label, options) {
    const button = make("button", "nd-plus", "+");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(label, options.map((entry) => ({
        module: entry.module,
        onPick: () => placeCandidate(entry.candidate)
      })));
    });
    return button;
  }

  function placeCandidate(candidate) {
    let next = null;
    try {
      next = engine.applyCandidate(ui.catalog, ui.design, candidate);
    } catch (error) {
      console.error(error);
    }
    if (commit(next, {})) track("designer_place", { module: candidate.moduleId, mode: ui.mode });
  }

  /**
   * Advanced: show every legal spot for the chosen piece as a tappable dot.
   *
   * Anchored on the footprint centre at the support plane -- where the piece
   * will actually land -- rather than the centre of its bounding box. A lamp is
   * 80cm tall, so its box centre floats far above the shelf it attaches to.
   *
   * Near-duplicates are merged in WORLD space, not screen space. Screen space
   * looked tidier but the dedupe ran before the camera had re-framed, so on a
   * mode switch every spot collapsed to the same point and three of the lamp's
   * four positions silently disappeared.
   */
  const CANDIDATE_MERGE_MM = 40;

  function buildCandidateMarkers() {
    const candidates = ui.candidateCache.get(ui.activeModuleId) || [];
    const module = ui.catalog.modules[ui.activeModuleId];
    const placed = [];
    for (const candidate of candidates) {
      const bounds = candidateBounds(candidate);
      const point = [
        (bounds[0] + bounds[3]) / 2,
        (bounds[1] + bounds[4]) / 2,
        candidate.supportPlaneZ + 40
      ];
      if (placed.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1], other[2] - point[2]) < CANDIDATE_MERGE_MM)) {
        continue;
      }
      placed.push(point);
      const button = make("button", "nd-plus", "+");
      button.type = "button";
      button.title = `Put the ${moduleLabel(module)} here`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        placeCandidate(candidate);
      });
      addOverlay(button, point);
    }
    setHint(placed.length
      ? `Tap a + to place the ${moduleLabel(module)}.`
      : `The ${moduleLabel(module)} does not fit anywhere yet.`);
  }

  function buildActionMenu() {
    const instance = ui.design.instances.find((candidate) => candidate.id === ui.selectedId);
    if (!instance) {
      ui.selectedId = null;
      return;
    }
    const menu = make("div", "nd-actions");
    const swaps = swapOptions(instance);
    const rotateStep = rotationStepFor(instance);
    const canRemove = !engine.isLoadBearing(ui.design, instance.id)
      && Boolean(engine.removeInstance(ui.catalog, ui.design, instance.id));

    if (swaps.length) {
      const swap = make("button", null, "Swap");
      swap.type = "button";
      swap.addEventListener("click", (event) => {
        event.stopPropagation();
        openPicker(`Swap this ${moduleLabel(ui.catalog.modules[instance.moduleId])}`, swaps);
      });
      menu.appendChild(swap);
    }
    if (ui.mode === "advanced" && rotateStep) {
      const rotate = make("button", null, "Rotate");
      rotate.type = "button";
      rotate.addEventListener("click", (event) => {
        event.stopPropagation();
        commit(engine.rotateInstance(ui.catalog, ui.design, instance.id, rotateStep), {});
      });
      menu.appendChild(rotate);
    }
    if (canRemove) {
      const remove = make("button", "is-danger", "Remove");
      remove.type = "button";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        commit(engine.removeInstance(ui.catalog, ui.design, instance.id), {});
      });
      menu.appendChild(remove);
    }
    if (!menu.childNodes.length) {
      setHint("This piece is holding the shelf up — remove what is on top of it first.");
      ui.selectedId = null;
      return;
    }
    const bounds = engine.instanceBounds(ui.catalog, instance);
    ui.actionMenu = addOverlay(menu, centreOf(bounds), [0, 0]);
    // Centre the menu on the piece once it has a measured width.
    window.requestAnimationFrame(() => {
      if (!ui.actionMenu) return;
      const rect = ui.actionMenu.getBoundingClientRect();
      const item = overlayItems.find((entry) => entry.node === ui.actionMenu);
      if (item) {
        item.offset = [-rect.width / 2, -rect.height / 2];
        positionOverlays();
      }
    });
  }

  function rotationStepFor(instance) {
    const module = ui.catalog.modules[instance.moduleId];
    if (!module) return 0;
    if (module.role === "lamp") return 45;
    return engine.moduleHasDistinctRotation(module) ? 180 : 0;
  }

  /**
   * Pieces that could take this one's place.
   *
   * Two sources: an in-place type change (safe even when something rests on
   * this piece), and — only when nothing depends on it — vacating the spot and
   * re-placing a different piece at the nearest legal position, which is what
   * lets an end-of-run unit become a wider one.
   */
  function swapOptions(instance) {
    const current = ui.catalog.modules[instance.moduleId];
    const group = swapGroup(current.role);
    if (!group) return [];
    const peers = tierModules(ui.mode).filter((module) =>
      module.id !== instance.moduleId && swapGroup(module.role) === group);

    const byModule = new Map();
    for (const module of peers) {
      const next = engine.replaceInstance(ui.catalog, ui.design, instance.id, module.id);
      if (next) byModule.set(module.id, { module, onPick: () => commit(next, {}) });
    }

    if (!engine.isLoadBearing(ui.design, instance.id)) {
      const vacated = engine.removeInstance(ui.catalog, ui.design, instance.id);
      if (vacated) {
        const [originX, originY] = instance.originWorldMm;
        const context = engine.additionContext(ui.catalog, vacated);
        for (const module of peers) {
          if (byModule.has(module.id)) continue;
          const options = engine.generateCandidates(ui.catalog, vacated, module.id, {
            adjacentBasesOnly: ui.mode !== "advanced",
            context
          });
          if (!options.length) continue;
          const nearest = options.reduce((best, candidate) =>
            Math.hypot(candidate.originWorldMm[0] - originX, candidate.originWorldMm[1] - originY)
              < Math.hypot(best.originWorldMm[0] - originX, best.originWorldMm[1] - originY) ? candidate : best);
          byModule.set(module.id, {
            module,
            onPick: () => {
              let next = null;
              try {
                next = engine.applyCandidate(ui.catalog, vacated, nearest);
              } catch (error) {
                console.error(error);
              }
              commit(next, {});
            }
          });
        }
      }
    }
    return Array.from(byModule.values());
  }

  function swapGroup(role) {
    if (role === "base") return "base";
    if (["extension", "spacer", "hanger"].indexOf(role) >= 0) return "shelf";
    if (role === "adapter") return "adapter";
    if (role === "top_bar") return "top_bar";
    if (role === "booster") return "booster";
    return null;
  }

  // ------------------------------------------------------------------ modal --

  function openPicker(title, options) {
    dom.modalTitle.textContent = title;
    clear(dom.modalBody);

    if (options.length > 8) {
      const search = make("input", "nd-search");
      search.type = "search";
      search.placeholder = "Search pieces";
      search.autocomplete = "off";
      search.addEventListener("input", () => renderPickerRows(options, search.value));
      dom.modalBody.appendChild(search);
    }
    const list = make("div", "nd-list");
    list.id = "nd-picker-list";
    dom.modalBody.appendChild(list);
    renderPickerRows(options, "");

    dom.modal.hidden = false;
    dom.modalClose.focus();
  }

  function renderPickerRows(options, query) {
    const list = el("nd-picker-list");
    if (!list) return;
    clear(list);
    const needle = String(query || "").trim().toLowerCase();
    const matches = options.filter((option) => {
      if (!needle) return true;
      const haystack = `${option.module.id} ${moduleLabel(option.module)} ${option.module.family || ""} ${option.module.role}`;
      return haystack.toLowerCase().indexOf(needle) >= 0;
    });
    if (!matches.length) {
      list.appendChild(make("p", "nd-list-empty", "No matching pieces."));
      return;
    }
    for (const option of matches) {
      const row = make("button", "nd-list-row");
      row.type = "button";
      row.appendChild(make("b", null, moduleLabel(option.module)));
      row.appendChild(make("small", null, option.module.priceKsh != null ? formatKsh(option.module.priceKsh) : "on request"));
      row.addEventListener("click", () => {
        closePicker();
        option.onPick();
      });
      list.appendChild(row);
    }
  }

  function closePicker() {
    dom.modal.hidden = true;
    clear(dom.modalBody);
  }

  // ---------------------------------------------------------------- pricing --

  function priceBreakdown() {
    const counts = new Map();
    for (const instance of ui.design.instances) {
      counts.set(instance.moduleId, (counts.get(instance.moduleId) || 0) + 1);
    }
    const lines = [];
    let total = 0;
    let unpriced = 0;
    Array.from(counts.keys()).sort().forEach((id) => {
      const module = ui.catalog.modules[id];
      const quantity = counts.get(id);
      const unit = module.priceKsh;
      if (unit == null) {
        unpriced += quantity;
        lines.push({ label: moduleLabel(module), quantity, amount: null });
        return;
      }
      total += unit * quantity;
      lines.push({ label: moduleLabel(module), quantity, amount: unit * quantity });
    });

    const bookendPrice = ui.catalog.accessoryPrices && ui.catalog.accessoryPrices.bookend;
    if (ui.design.bookends > 0) {
      if (bookendPrice == null) {
        unpriced += ui.design.bookends;
        lines.push({ label: "Bookend", quantity: ui.design.bookends, amount: null });
      } else {
        total += bookendPrice * ui.design.bookends;
        lines.push({ label: "Bookend", quantity: ui.design.bookends, amount: bookendPrice * ui.design.bookends });
      }
    }
    return { lines, total, unpriced };
  }

  function sizeLabel() {
    const bounds = engine.designBounds(ui.catalog, ui.design);
    if (!bounds) return null;
    return `${mmToCm(bounds[3] - bounds[0])} × ${mmToCm(bounds[4] - bounds[1])} × ${mmToCm(bounds[5] - Math.min(0, bounds[2]))} cm`;
  }

  /**
   * The shelf's own envelope, ignoring a lamp.
   *
   * Simple's Width/Height/Depth read out what its steppers control. A lamp adds
   * 77cm of arm and shade, so including it made "Height 149 cm" appear next to a
   * button that only ever adds a 30cm shelf level.
   */
  function shelfBounds() {
    const shelfOnly = ui.design.instances.filter((instance) => ui.catalog.modules[instance.moduleId].role !== "lamp");
    if (!shelfOnly.length) return null;
    return engine.designBounds(ui.catalog, { instances: shelfOnly });
  }

  function updateSummary() {
    const { total, unpriced } = priceBreakdown();
    dom.total.textContent = formatKsh(total);
    const size = sizeLabel();
    const notes = ["VAT inclusive"];
    if (size) notes.unshift(size);
    if (unpriced) notes.push(`${unpriced} piece${unpriced === 1 ? "" : "s"} quoted separately`);
    dom.totalNote.textContent = notes.join(" · ");

    const empty = ui.design.instances.length === 0;
    dom.order.setAttribute("aria-disabled", empty ? "true" : "false");
    dom.order.href = empty ? "#" : whatsappUrl(total);
  }

  function whatsappUrl(total) {
    const { lines } = priceBreakdown();
    const parts = lines.map((line) => `${line.quantity} x ${line.label}`);
    const finish = (ui.catalog.finishes.find((entry) => entry.id === ui.design.finish) || {}).displayName || ui.design.finish;
    const size = sizeLabel();
    const message = [
      "Hi Framework! I designed a shelf and would like to order it.",
      "",
      `Pieces: ${parts.join(", ")}`,
      `Colour: ${finish}`,
      size ? `Size: ${size} (width x depth x height)` : null,
      `Total: ${formatKsh(total)}`,
      "",
      `My design: ${shareUrl()}`
      // Only drop the size line when there is no size; the empty strings above
      // are deliberate blank lines in the WhatsApp message.
    ].filter((line) => line !== null).join("\n");
    return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
  }

  // ------------------------------------------------------ share / URL state --

  /**
   * Compact hash encoding: a table of piece types plus one short row per
   * placed piece. A WhatsApp order carries this link, so it has to stay short
   * enough to survive being pasted into a chat.
   */
  function encodeDesign() {
    const types = [];
    const typeIndex = new Map();
    const idIndex = new Map();
    ui.design.instances.forEach((instance, index) => idIndex.set(instance.id, index));

    const rows = ui.design.instances.map((instance) => {
      if (!typeIndex.has(instance.moduleId)) {
        typeIndex.set(instance.moduleId, types.length);
        types.push(instance.moduleId);
      }
      const on = instance.placement && instance.placement.on;
      const supports = on ? (Array.isArray(on) ? on : [on]) : [];
      return [
        typeIndex.get(instance.moduleId),
        Math.round(instance.originWorldMm[0]),
        Math.round(instance.originWorldMm[1]),
        instance.rotationDeg || 0,
        instance.placement && instance.placement.method === "socket" ? 1 : 0,
        supports.map((id) => idIndex.get(id)).filter((index) => index != null)
      ];
    });
    return toBase64Url(JSON.stringify([1, ui.mode, ui.design.finish, ui.design.bookends || 0, types, rows]));
  }

  function decodeDesign(encoded) {
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!Array.isArray(payload) || payload[0] !== 1) throw new Error("unsupported design link");
    const [, mode, finish, bookends, types, rows] = payload;
    const instances = rows.map((row, index) => ({
      id: `item_${String(index + 1).padStart(3, "0")}`,
      type: types[row[0]],
      originWorldMm: [row[1], row[2], 0],
      rotationDeg: row[3] || 0,
      placement: row[4]
        ? { method: "socket", on: (row[5] || []).map((support) => `item_${String(support + 1).padStart(3, "0")}`) }
        : { method: "floor" }
    }));
    return {
      mode: MODES.indexOf(mode) >= 0 ? mode : "simple",
      design: engine.deserializeState(ui.catalog, { schemaVersion: 1, finish, bookends, instances })
    };
  }

  function shareUrl() {
    return `${location.origin}${location.pathname}#${encodeDesign()}`;
  }

  function writeHash() {
    try {
      // replaceState so the browser Back button leaves the page rather than
      // walking through every edit.
      history.replaceState(null, "", `#${encodeDesign()}`);
    } catch (error) {
      /* a failed history write must not stop the designer */
    }
  }

  function readHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return null;
    try {
      const decoded = decodeDesign(raw);
      return Object.assign(decoded, { simple: deriveSimpleSpec(decoded.design) });
    } catch (error) {
      console.warn("could not read the design link:", error.message);
      setHint("That design link could not be read, so we started a new shelf.", true);
      return null;
    }
  }

  // ----------------------------------------------------------------- panels --

  function stepper(label, value, min, max, onChange) {
    const row = make("div", "nd-stepper");
    row.appendChild(make("span", "nd-label", label));
    row.appendChild(make("span", "nd-stepper-value", value.text));
    const buttons = make("div", "nd-stepper-buttons");
    const minus = make("button", null, "−");
    minus.type = "button";
    minus.setAttribute("aria-label", `Fewer: ${label}`);
    minus.disabled = value.n <= min;
    minus.addEventListener("click", () => onChange(value.n - 1));
    const plus = make("button", null, "+");
    plus.type = "button";
    plus.setAttribute("aria-label", `More: ${label}`);
    plus.disabled = value.n >= max;
    plus.addEventListener("click", () => onChange(value.n + 1));
    buttons.appendChild(minus);
    buttons.appendChild(plus);
    row.appendChild(buttons);
    return row;
  }

  function finishField() {
    const field = make("div", "nd-field");
    field.appendChild(make("span", "nd-label", "Colour"));
    const row = make("div", "nd-swatches");
    for (const finish of ui.catalog.finishes) {
      const swatch = make("button", "nd-swatch");
      swatch.type = "button";
      swatch.title = finish.displayName;
      swatch.setAttribute("aria-label", finish.displayName);
      swatch.setAttribute("aria-pressed", String(ui.design.finish === finish.id));
      const steel = make("span");
      steel.style.background = finish.steelHex;
      const mdf = make("span");
      mdf.style.background = finish.mdfHex;
      swatch.appendChild(steel);
      swatch.appendChild(mdf);
      swatch.addEventListener("click", () => {
        if (ui.design.finish === finish.id) return;
        pushHistory();
        ui.design = Object.assign({}, ui.design, { finish: finish.id });
        refresh({});
      });
      row.appendChild(swatch);
    }
    field.appendChild(row);
    return field;
  }

  function bookendField() {
    return stepper(
      "Bookends",
      { n: ui.design.bookends || 0, text: String(ui.design.bookends || 0) },
      0,
      12,
      (next) => {
        pushHistory();
        ui.design = Object.assign({}, ui.design, { bookends: Math.max(0, next) });
        refresh({});
      }
    );
  }

  function breakdownSection() {
    const { lines } = priceBreakdown();
    const field = make("div", "nd-field");
    field.appendChild(make("span", "nd-label", "What is in it"));
    if (!lines.length) {
      field.appendChild(make("p", "nd-note", "Nothing yet — add a unit to get started."));
      return field;
    }
    const list = make("div", "nd-lines");
    for (const line of lines) {
      const row = make("div", `nd-line${line.amount == null ? " is-unpriced" : ""}`);
      row.appendChild(make("span", null, line.label));
      row.appendChild(make("span", "nd-qty", `x${line.quantity}`));
      row.appendChild(make("span", "nd-amount", line.amount == null ? "on request" : formatKsh(line.amount)));
      list.appendChild(row);
    }
    field.appendChild(list);
    return field;
  }

  function renderSimplePanel(body) {
    const families = availableFamilies();
    const typeField = make("div", "nd-field");
    typeField.appendChild(make("span", "nd-label", "I'd like a shelf made of…"));
    const select = make("select", "nd-select");
    select.id = "nd-family";
    for (const family of families) {
      const option = make("option", null, `${FAMILY_LABELS[family]} units`);
      option.value = family;
      if (family === ui.simple.family) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => rebuildSimple({ family: select.value }));
    typeField.appendChild(select);
    body.appendChild(typeField);

    const bounds = shelfBounds();
    body.appendChild(stepper(
      "Width",
      {
        n: ui.simple.width,
        text: bounds ? `${mmToCm(bounds[3] - bounds[0])} cm` : `${ui.simple.width} units`
      },
      SIMPLE_LIMITS.width[0],
      SIMPLE_LIMITS.width[1],
      (next) => rebuildSimple({ width: next })
    ));
    body.appendChild(stepper(
      "Height",
      {
        n: ui.simple.levels,
        text: bounds ? `${mmToCm(bounds[5] - Math.min(0, bounds[2]))} cm` : `${ui.simple.levels} levels`
      },
      SIMPLE_LIMITS.levels[0],
      SIMPLE_LIMITS.levels[1],
      (next) => rebuildSimple({ levels: next })
    ));
    if (bounds) {
      const depth = make("div", "nd-stepper");
      depth.appendChild(make("span", "nd-label", "Depth"));
      depth.appendChild(make("span", "nd-stepper-value", `${mmToCm(bounds[4] - bounds[1])} cm`));
      body.appendChild(depth);
    }

    body.appendChild(finishField());

    if (ui.catalog.modules.lamp) {
      const label = make("label", "nd-toggle");
      const input = make("input");
      input.type = "checkbox";
      input.checked = ui.simple.lamp;
      input.addEventListener("change", () => rebuildSimple({ lamp: input.checked }));
      label.appendChild(input);
      label.appendChild(make("span", null, "Add a lamp (excludes shade and bulb)"));
      body.appendChild(label);
    }

    body.appendChild(bookendField());
    body.appendChild(breakdownSection());
    body.appendChild(make(
      "p",
      "nd-note",
      "Want to mix unit sizes, add hanging rails or leave gaps? Switch to Standard or Advanced above — your shelf comes with you."
    ));
  }

  function renderStandardPanel(body) {
    body.appendChild(make(
      "p",
      "nd-note",
      "Tap a + in the view to add a unit beside the run or a shelf on top. Tap any piece to swap or remove it."
    ));
    body.appendChild(finishField());
    body.appendChild(bookendField());
    body.appendChild(breakdownSection());
  }

  function renderAdvancedPanel(body) {
    body.appendChild(make(
      "p",
      "nd-note",
      "Every piece, including adapters, boosters and trimmed cuts. Units may also sit apart so a shelf can span the gap."
    ));

    const field = make("div", "nd-field");
    field.appendChild(make("span", "nd-label", "Add a piece"));
    const search = make("input", "nd-search");
    search.type = "search";
    search.placeholder = "Search pieces";
    search.autocomplete = "off";
    search.value = ui.search;
    search.addEventListener("input", () => {
      ui.search = search.value;
      renderModuleList();
    });
    field.appendChild(search);
    const list = make("div", "nd-list");
    list.id = "nd-module-list";
    field.appendChild(list);
    body.appendChild(field);

    body.appendChild(finishField());
    body.appendChild(bookendField());
    body.appendChild(breakdownSection());

    const actions = make("div", "nd-button-row");
    const save = make("button", "nd-button", "Save design");
    save.type = "button";
    save.addEventListener("click", saveDesignFile);
    const load = make("button", "nd-button", "Load design");
    load.type = "button";
    load.addEventListener("click", () => fileInput.click());
    const reset = make("button", "nd-button", "Start again");
    reset.type = "button";
    reset.addEventListener("click", () => {
      if (!ui.design.instances.length) return;
      commit(engine.createState(ui.catalog, { finish: ui.design.finish, bookends: ui.design.bookends }), { fit: true });
    });
    actions.appendChild(save);
    actions.appendChild(load);
    actions.appendChild(reset);
    body.appendChild(actions);

    renderModuleList();
  }

  function renderModuleList() {
    const list = el("nd-module-list");
    if (!list) return;
    clear(list);
    const needle = ui.search.trim().toLowerCase();
    const rows = tierModules("advanced").filter((module) => {
      if (!(ui.candidateCache.get(module.id) || []).length) return false;
      if (!needle) return true;
      return `${module.id} ${moduleLabel(module)} ${module.family || ""} ${module.role}`.toLowerCase().indexOf(needle) >= 0;
    });
    if (!rows.length) {
      list.appendChild(make("p", "nd-list-empty", needle ? "No matching pieces fit right now." : "Nothing fits yet — add a unit first."));
      return;
    }
    for (const module of rows) {
      const count = (ui.candidateCache.get(module.id) || []).length;
      const row = make("button", "nd-list-row");
      row.type = "button";
      row.setAttribute("aria-pressed", String(ui.activeModuleId === module.id));
      row.appendChild(make("b", null, moduleLabel(module)));
      row.appendChild(make("small", null, `${count} spot${count === 1 ? "" : "s"}`));
      row.addEventListener("click", () => {
        ui.activeModuleId = ui.activeModuleId === module.id ? null : module.id;
        ui.selectedId = null;
        if (ui.activeModuleId) ensureGeometry([ui.activeModuleId]);
        buildOverlay();
        renderModuleList();
      });
      list.appendChild(row);
    }
  }

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    file.text().then((text) => {
      try {
        const next = engine.deserializeState(ui.catalog, text);
        commit(next, { fit: true });
      } catch (error) {
        setHint(`That file could not be read: ${error.message}`, true);
      }
    });
  });

  function saveDesignFile() {
    const blob = new Blob([JSON.stringify(engine.serializeState(ui.design), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `framework-shelf-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 20000);
  }

  // ------------------------------------------------------------------ modes --

  function applyMode(mode, options) {
    const next = MODES.indexOf(mode) >= 0 ? mode : "simple";
    ui.mode = next;
    dom.app.dataset.mode = next;
    dom.panelTitle.textContent = next === "simple" ? "Build" : next === "standard" ? "Shelf" : "Pieces";
    Array.prototype.forEach.call(dom.modes.querySelectorAll("button"), (button) => {
      button.setAttribute("aria-selected", String(button.dataset.mode === next));
    });
    ui.selectedId = null;
    ui.activeModuleId = null;
    if (options && options.silent) return;

    if (next === "simple") {
      // Simple can only express a plain run, so entering it rebuilds the shelf
      // from the nearest simple spec. Say so rather than quietly discarding work.
      const derived = deriveSimpleSpec(ui.design);
      const before = ui.design.instances.length;
      if (derived) {
        ui.simple = derived;
        const rebuilt = buildSimpleDesign(ui.simple, ui.design.finish, ui.design.bookends);
        const changed = rebuilt.instances.length !== before;
        pushHistory();
        ui.design = rebuilt;
        if (changed) {
          setHint(`Simple shows plain runs, so this is now ${ui.simple.width} unit${ui.simple.width === 1 ? "" : "s"} wide and ${ui.simple.levels} high. Undo to go back.`);
        }
      }
    }
    refresh({ fit: true });
  }

  // ----------------------------------------------------------------- refresh --

  function refresh(options) {
    const settings = options || {};
    computeCandidateCache();

    const finish = ui.catalog.finishes.find((entry) => entry.id === ui.design.finish) || ui.catalog.finishes[0];
    ui.renderer.setPalette({
      surface: scaleHex(finish.mdfHex, SURFACE_GAIN),
      steel: scaleHex(finish.steelHex, STEEL_GAIN)
    });

    const needed = Array.from(new Set(ui.design.instances.map((instance) => instance.moduleId)));
    ensureGeometry(needed);
    syncScene();

    dom.panelTitle.textContent = ui.mode === "simple" ? "Build" : ui.mode === "standard" ? "Shelf" : "Pieces";
    const body = dom.controls;
    clear(body);
    if (ui.mode === "simple") renderSimplePanel(body);
    else if (ui.mode === "standard") renderStandardPanel(body);
    else renderAdvancedPanel(body);

    updateSummary();

    // Frame before laying out the overlay: the "+" anchors are projected with
    // the camera, so re-framing afterwards would place them for the old view.
    // Re-frame on an explicit request (mode change, load, Simple rebuild), or
    // when the edit just made pushed part of the shelf out of view.
    if (settings.fit || !ui.renderer.containsBounds(engine.designBounds(ui.catalog, ui.design))) {
      ui.renderer.fit();
    } else {
      ui.renderer.invalidate();
    }

    buildOverlay();
    writeHash();
  }

  // ------------------------------------------------------------------ input --

  /*
   * Pointer handling: one finger pans, two fingers pinch-zoom, a tap that did
   * not move selects a piece. The movement threshold is what stops a slightly
   * shaky tap on a phone from being read as a pan and swallowing the selection.
   */
  const TAP_SLOP_PX = 9;
  const pointers = new Map();
  let panState = null;
  let pinchState = null;

  function bindEvents() {
    dom.canvas.addEventListener("pointerdown", onPointerDown);
    dom.canvas.addEventListener("pointermove", onPointerMove);
    dom.canvas.addEventListener("pointerup", onPointerUp);
    dom.canvas.addEventListener("pointercancel", onPointerUp);
    dom.canvas.addEventListener("wheel", onWheel, { passive: false });
    dom.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    dom.modes.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button || button.dataset.mode === ui.mode) return;
      track("designer_mode", { mode: button.dataset.mode });
      applyMode(button.dataset.mode, {});
    });

    dom.undo.addEventListener("click", undo);
    dom.zoomIn.addEventListener("click", () => ui.renderer.zoomBy(1.25));
    dom.zoomOut.addEventListener("click", () => ui.renderer.zoomBy(1 / 1.25));
    dom.fit.addEventListener("click", () => ui.renderer.fit());

    dom.collapse.addEventListener("click", () => {
      const collapsed = dom.app.dataset.panel === "collapsed";
      dom.app.dataset.panel = collapsed ? "open" : "collapsed";
      dom.collapse.setAttribute("aria-expanded", String(collapsed));
      dom.collapse.setAttribute("aria-label", collapsed ? "Hide options" : "Show options");
      // The viewport just changed size, so re-fit rather than leave the shelf
      // cropped or floating.
      window.requestAnimationFrame(() => ui.renderer.fit());
    });

    dom.modalClose.addEventListener("click", closePicker);
    dom.modal.addEventListener("click", (event) => {
      if (event.target === dom.modal) closePicker();
    });
    dom.order.addEventListener("click", () => {
      if (dom.order.getAttribute("aria-disabled") === "true") return;
      const { total } = priceBreakdown();
      track("order_click", { value: total, currency: "KES", mode: ui.mode });
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!dom.modal.hidden) return closePicker();
        if (ui.activeModuleId || ui.selectedId) {
          ui.activeModuleId = null;
          ui.selectedId = null;
          syncScene();
          buildOverlay();
          renderModuleList();
        }
      }
    });

    if ("ResizeObserver" in window) {
      new ResizeObserver(() => ui.renderer.resize()).observe(dom.stage);
    } else {
      window.addEventListener("resize", () => ui.renderer.resize());
    }
    window.addEventListener("hashchange", () => {
      // Only react to a link someone actually navigated to, not our own writes.
      const restored = readHash();
      if (!restored || encodeDesign() === location.hash.replace(/^#/, "")) return;
      ui.design = restored.design;
      if (restored.simple) ui.simple = restored.simple;
      applyMode(restored.mode, { silent: true });
      refresh({ fit: true });
    });
  }

  function onPointerDown(event) {
    try {
      // Capture keeps a pan tracking even when the finger leaves the canvas.
      // It throws if the pointer is already gone, which must not abort the tap.
      dom.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* not capturable; panning still works via the canvas listeners */
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchState = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      panState = null;
      return;
    }
    panState = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchState && pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchState.distance > 8 && distance > 8) {
        ui.renderer.zoomBy(distance / pinchState.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      pinchState.distance = distance;
      return;
    }
    if (!panState) return;
    const dx = event.clientX - panState.x;
    const dy = event.clientY - panState.y;
    if (!panState.moved
      && Math.hypot(event.clientX - panState.startX, event.clientY - panState.startY) < TAP_SLOP_PX) {
      return;
    }
    panState.moved = true;
    panState.x = event.clientX;
    panState.y = event.clientY;
    ui.renderer.panByPixels(dx, dy);
  }

  function onPointerUp(event) {
    const wasTap = panState && !panState.moved && pointers.size === 1;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchState = null;
    if (!pointers.size) {
      const tap = wasTap;
      panState = null;
      if (tap) handleTap(event.clientX, event.clientY);
    }
    try {
      dom.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* the pointer may already be gone */
    }
  }

  function handleTap(clientX, clientY) {
    if (ui.mode === "simple") return; // Simple is driven entirely from the panel
    if (ui.activeModuleId) {
      // Tapping empty space is how you back out of placing a piece.
      ui.activeModuleId = null;
      buildOverlay();
      renderModuleList();
      return;
    }
    const hit = ui.renderer.pick(clientX, clientY);
    if (hit === ui.selectedId) return;
    ui.selectedId = hit;
    syncScene();
    buildOverlay();
  }

  function onWheel(event) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0016));
    ui.renderer.zoomBy(factor, event.clientX, event.clientY);
  }

  boot();
})();

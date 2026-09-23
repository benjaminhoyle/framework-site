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

  // Set by the page; see the note there about keeping every asset on one version.
  // Root-absolute, not relative: a saved design is served at
  // /builder/<CODE>, one level down, where "assets/..." would resolve
  // inside that directory and 404.
  const ASSET_VERSION = window.frameworkDesignerVersion || "";
  const CATALOG_URL = `/assets/shelving/catalog.json?v=${ASSET_VERSION}`;
  const MODULE_BASE_URL = "/assets/shelving/modules";
  const WHATSAPP_PHONE = "254783891005";

  /*
   * Where a saved design lives. Written on the share image and handed out by
   * "Create link", so it is the production address rather than whatever host
   * the page happens to be served from -- an image shared from a preview build
   * still has to point somewhere a client can reach.
   */
  const DESIGN_LINK_HOME = "framework.co.ke/builder";
  const DESIGN_API = "/api/design";

  const MODES = ["simple", "standard", "advanced"];
  const ENTRY_MODES = { simple: "simple", flexible: "standard", standard: "standard", advanced: "advanced" };
  const MODE_LABELS = {
    simple: "Simple",
    standard: "Flexible",
    advanced: "Advanced"
  };

  // Which pieces each interface offers. Simple never shows a piece list at all
  // -- it only ever generates bases, extensions and a lamp -- but the same
  // filter decides what its generator is allowed to reach for.
  const TIER_ROLES = {
    simple: ["base", "extension", "lamp"],
    standard: ["base", "extension", "spacer", "hanger", "top_bar", "lamp"]
  };

  /*
   * Pieces that exist in the catalogue but are only offered in Advanced.
   *
   * `deep_spacer_base` is a deep base carrying no shelves -- four legs to the
   * floor and the bracing a spacer has, so a run can start at desk height. It
   * is a base by role, which is the problem: computeSiteVariants() picks ONE
   * module per family and role as the one the site sells, and a second
   * untrimmed `deep:base` would be in the running to become that one. Which of
   * the two won would come down to catalogue order, and the losing case sells
   * every Simple deep shelf with no shelves in it.
   *
   * Naming it here keeps it out of that pick, which is also what makes it
   * Advanced-only: moduleAllowed() needs a module to be the site's variant
   * before Simple or Flexible will offer it.
   */
  const ADVANCED_ONLY = new Set(["deep_spacer_base"]);

  // Unit families, in the order the current site presents them. "Trimmed"
  // variants are shortened cuts of the same unit and only appear in Advanced.
  const FAMILY_LABELS = {
    standard: "Standard",
    corner: "Corner",
    compact: "Compact",
    wide: "Wide",
    deep: "Deep",
    slim: "Slim",
    broad: "Broad"
  };
  const FAMILY_ORDER = ["standard", "compact", "wide", "deep", "slim", "broad", "corner"];
  const TRACKING_CODE_ALPHABET = "123456789ABCDEFGHJKMNPQRSTUVWXYZ";
  // Simple builds a plain run from one family, and a run of corner units is not
  // a thing anyone wants: the corner is where a run turns, so it belongs to
  // Standard and Advanced, where a design can have two runs in it.
  const SIMPLE_FAMILIES = FAMILY_ORDER.filter((family) => family !== "corner");

  /*
   * Render colours come from the catalogue's `builder` palette, which the build
   * script reads out of the /designer page's own theme table -- so the two site
   * designers show the same product in the same colours. The real material
   * hexes (steelHex/mdfHex) stay reserved for Blender renders and the DAM.
   *
   * They are scaled up first because the shader's light term lands a shelf top
   * at about 0.94 of its base colour and a vertical post at about 0.79; feeding
   * the flat hex straight in makes every finish read a shade too dark.
   */
  const SURFACE_GAIN = 1.07;
  const STEEL_GAIN = 1.26;

  function currentFinish() {
    return finishById(ui.design.finish);
  }

  function finishById(id) {
    return ui.catalog.finishes.find((entry) => entry.id === id) || ui.catalog.finishes[0];
  }

  /** The scaled hexes the shader wants, for one finish. */
  function shaderPalette(finish) {
    return {
      surface: scaleHex(finish.builder.surface, SURFACE_GAIN),
      steel: scaleHex(finish.builder.steel, STEEL_GAIN)
    };
  }

  /**
   * Every finish actually on screen, the design's first.
   *
   * Used wherever the colour has to be named rather than shown -- the share
   * image and the WhatsApp order -- because with per-piece colours "Sage" alone
   * would be a half-truth.
   */
  function finishesInUse() {
    const ids = [ui.design.finish];
    for (const instance of ui.design.instances) {
      if (instance.finish && ids.indexOf(instance.finish) < 0) ids.push(instance.finish);
    }
    return ids.map(finishById);
  }

  function finishLabel() {
    return finishesInUse().map((finish) => finish.displayName).join(" & ");
  }

  function scaleHex(hex, gain) {
    const value = parseInt(String(hex).replace("#", ""), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
      .map((channel) => Math.min(255, Math.round(channel * gain)));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  const SIMPLE_LIMITS = { width: [1, 6], levels: [1, 6] };
  const HISTORY_LIMIT = 40;

  // The lamp's arm reaches along +x when unrotated. Simple stands it on the back
  // left upright. 315 degrees aims it diagonally in over the shelf, which is
  // right on paper but happens to lie along the view direction, so the arm
  // collapses to a vertical line on screen; one step anticlockwise from there
  // gives the same reach with the arm clearly visible.
  const LAMP_INWARD_DEG = 0;

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

  /*
   * The two events that are a person opening a WhatsApp conversation with us:
   * the order at the foot of the page, and the help button in the header. Both
   * are a lead, and both report the same way.
   *
   * The Google Ads conversion is the one the rest of the site sends on a
   * handoff (js/site.js, trackContactConversion). /builder deliberately does
   * not load site.js, so until 11 September 2026 an order started here reached
   * GA4 and Meta and never reached Google Ads at all: the Search campaign could
   * not bid towards the one action this page exists for. Same conversion id as
   * every other page, so the two count the same thing.
   */
  const ADS_CONVERSION = "AW-16875113878/1BgKCJjg0bYaEJab1-4-";
  const HANDOFF_EVENTS = { order_click: true, help_click: true };

  function track(event, params) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", event, params || {});
        if (HANDOFF_EVENTS[event]) {
          window.gtag("event", "conversion", {
            send_to: ADS_CONVERSION,
            value: (params && params.value) || 1.0,
            currency: "KES"
          });
        }
      }
      if (typeof window.fbq === "function" && HANDOFF_EVENTS[event]) window.fbq("track", "Lead", params || {});
    } catch (error) {
      /* analytics must never break the tool */
    }
  }

  function mintTrackingCode(length) {
    let out = "";
    try {
      const bytes = new Uint8Array(length);
      window.crypto.getRandomValues(bytes);
      for (let i = 0; i < bytes.length; i += 1) out += TRACKING_CODE_ALPHABET[bytes[i] % TRACKING_CODE_ALPHABET.length];
    } catch (error) {
      for (let i = 0; i < length; i += 1) {
        out += TRACKING_CODE_ALPHABET[Math.floor(Math.random() * TRACKING_CODE_ALPHABET.length)];
      }
    }
    return out;
  }

  function builderSessionId() {
    try {
      let id = sessionStorage.getItem("fwk_sid") || sessionStorage.getItem("nd_session");
      if (!id || !/^[0-9A-Z]{6,36}$/i.test(id)) id = mintTrackingCode(12);
      id = String(id).toUpperCase();
      sessionStorage.setItem("fwk_sid", id);
      sessionStorage.setItem("nd_session", id);
      return id;
    } catch (error) {
      return mintTrackingCode(12);
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
    redo: el("nd-redo"),
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
    help: el("nd-help"),
    breakdown: el("nd-breakdown"),
    breakdownToggle: el("nd-breakdown-toggle"),
    add: el("nd-add"),
    addLabel: el("nd-add-label"),
    customise: el("nd-customise"),
    bookends: el("nd-bookends"),
    modal: el("nd-modal"),
    modalTitle: el("nd-modal-title"),
    modalBody: el("nd-modal-body"),
    modalClose: el("nd-modal-close"),
    dimensions: el("nd-dimensions"),
    perspective: el("nd-perspective"),
    present: el("nd-present"),
    presentModal: el("nd-present-modal"),
    presentImage: el("nd-present-image"),
    presentClose: el("nd-present-close"),
    presentHint: el("nd-present-hint"),
    presentCode: el("nd-present-code"),
    presentCodeValue: el("nd-present-code-value"),
    presentCodeCopy: el("nd-present-code-copy")
  };

  const ui = {
    mode: "simple",
    catalog: null,
    renderer: null,
    design: null,
    history: [],
    future: [],
    selectedId: null,
    activeModuleId: null, // Advanced: the piece whose placements are on screen
    // Whether anything has been placed since that piece was chosen. It is the
    // difference between "Cancel" (I have not started) and "Done" (I have, and
    // I am finished), which are not the same offer.
    placedSinceChoose: false,
    previewCandidateId: null, // Advanced: the placement currently ghosted
    taughtPlacing: false, // whether the two-tap preview has been explained once
    recentModuleIds: [], // the add sheet's chips, newest first, this visit only
    showTrimmed: false, // whether the add sheet lists the shortened cuts too
    candidates: [],
    candidateContext: null,
    candidateCache: new Map(),
    pendingModules: new Set(),
    simple: { family: "standard", width: 1, levels: 2, lamp: false, trimmed: false },
    search: "",
    actionMenu: null,
    savedCode: null, // the last design saved, so a repeat costs no second write
    // The code this page was opened from, and the design as it opened. A design
    // saved unchanged keeps that code rather than minting a second one.
    openedDesign: null,
    breakdownOpen: false,
    // The sheet on screen, kept so an edit made inside one redraws it. A colour
    // picked in the options sheet changes the swatch that was pressed, and
    // refresh() rebuilds panels, not modals.
    sheet: null,
    onModalDismiss: null,
    hintTimer: 0,
    dimensionsOn: false,
    dimensionsSvg: null
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

  function setBusyMessage(text) {
    dom.busy.textContent = text || "Loading...";
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
    ui.dimensionsSvg = document.createElementNS(SVG_NS, "svg");
    ui.dimensionsSvg.setAttribute("class", "nd-dim-layer");
    ui.dimensionsSvg.setAttribute("aria-hidden", "true");
    dom.stage.insertBefore(ui.dimensionsSvg, dom.overlay);
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
    const savedCode = savedCodeInPath();
    if (restored) {
      ui.mode = restored.mode;
      ui.design = restored.design;
      if (restored.simple) ui.simple = restored.simple;
    } else if (savedCode) {
      dom.app.dataset.loading = "saved";
      setBusyMessage(`Opening design ${savedCode}...`);
      setBusy(true);
      loadSavedDesign(savedCode, { fallbackToDefault: true });
      return;
    } else {
      const requestedMode = new URLSearchParams(location.search).get("mode");
      ui.mode = ENTRY_MODES[String(requestedMode || "").toLowerCase()] || ui.mode;
      ui.design = buildSimpleDesign(ui.simple, "sage", 0);
    }
    applyMode(ui.mode, { silent: true });
    refresh({ fit: true });
  }

  // ------------------------------------------------------------ design state --

  function pushHistory() {
    ui.history.push(engine.serializeState(ui.design));
    if (ui.history.length > HISTORY_LIMIT) ui.history.shift();
    // A new edit is a new branch: whatever had been undone is no longer ahead.
    ui.future.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    dom.undo.disabled = ui.history.length === 0;
    dom.redo.disabled = ui.future.length === 0;
  }

  /** Move one step along the history, pushing the current design the other way. */
  function stepHistory(from, to) {
    const target = from.pop();
    if (!target) return;
    let restored;
    try {
      restored = engine.deserializeState(ui.catalog, target);
    } catch (error) {
      console.error(error);
      return;
    }
    to.push(engine.serializeState(ui.design));
    if (to.length > HISTORY_LIMIT) to.shift();
    ui.design = restored;
    updateHistoryButtons();
    ui.selectedId = null;
    ui.activeModuleId = null;
    ui.placedSinceChoose = false;
    if (ui.mode === "simple") ui.simple = deriveSimpleSpec(ui.design) || ui.simple;
    refresh({ fit: true });
  }

  const undo = () => stepHistory(ui.history, ui.future);
  const redo = () => stepHistory(ui.future, ui.history);

  function commit(nextDesign, options) {
    if (!nextDesign) {
      setHint("That does not fit here.", true);
      return false;
    }
    const settings = options || {};
    pushHistory();
    ui.design = nextDesign;
    // An edit normally means the piece is done with. Colour is the exception:
    // people try two or three before settling, and closing the menu each time
    // means finding the piece again.
    if (!settings.keepSelection) ui.selectedId = null;
    // Placing is the other exception, in Advanced: a part is a thing you have a
    // quantity of, and dropping it after every one cost a round trip through a
    // two-dozen-row sheet per booster. `placeCandidate` is the only caller that
    // asks to keep it; every other edit still ends the placement.
    if (!settings.keepModule) {
      ui.activeModuleId = null;
      ui.placedSinceChoose = false;
    }
    refresh(settings);
    return true;
  }

  // ----------------------------------------------------- Simple generation ---

  function availableFamilies() {
    return SIMPLE_FAMILIES.filter((family) => siteVariant(family, "base") && siteVariant(family, "extension"));
  }

  function defaultSimpleTrimmed(family) {
    return family === "compact" || family === "slim";
  }

  function simpleVariant(family, role, trimmed) {
    const modules = Object.values(ui.catalog.modules)
      .filter((module) =>
        !ADVANCED_ONLY.has(module.id) &&
        module.family === family &&
        module.role === role &&
        Boolean(module.trimmed) === Boolean(trimmed) &&
        module.priceKsh != null)
      .sort((a, b) => a.id.localeCompare(b.id));
    return modules[0] ? modules[0].id : siteVariant(family, role);
  }

  function hasSimpleTrimmedVariant(family) {
    return Boolean(simpleVariant(family, "base", true) && simpleVariant(family, "extension", true));
  }

  /**
   * Build a plain run from a Simple-mode spec: `width` units side by side, each
   * carrying `levels - 1` shelves, optionally one lamp on top.
   *
   * Generated rather than hand-assembled, so the same spec always produces the
   * same shelf and Simple's steppers stay predictable.
   */
  function buildSimpleDesign(spec, finish, bookends) {
    const trimmed = Boolean(spec.trimmed);
    let state = engine.createState(ui.catalog, { finish, bookends: trimmed ? 0 : bookends });
    const baseId = simpleVariant(spec.family, "base", trimmed);
    const extensionId = simpleVariant(spec.family, "extension", trimmed);
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
        // Top of the run, on the back left upright: highest support plane, then
        // furthest back, then furthest left.
        const pick = candidates.reduce((best, candidate) => {
          if (candidate.supportPlaneZ !== best.supportPlaneZ) {
            return candidate.supportPlaneZ > best.supportPlaneZ ? candidate : best;
          }
          if (candidate.originWorldMm[1] !== best.originWorldMm[1]) {
            return candidate.originWorldMm[1] > best.originWorldMm[1] ? candidate : best;
          }
          return candidate.originWorldMm[0] < best.originWorldMm[0] ? candidate : best;
        });
        state = engine.applyCandidate(ui.catalog, state, pick, { rotationDeg: LAMP_INWARD_DEG });
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
      lamp: design.instances.some((instance) => instance.moduleId === "lamp"),
      trimmed: bases.some((instance) => ui.catalog.modules[instance.moduleId].trimmed)
    };
  }

  function rebuildSimple(changes) {
    Object.assign(ui.simple, changes || {});
    const bookends = ui.simple.trimmed ? 0 : ui.design.bookends;
    const next = buildSimpleDesign(ui.simple, ui.design.finish, bookends);
    const addsPieces = next.instances.length > ui.design.instances.length;
    const actual = deriveSimpleSpec(next);
    if (actual) {
      // If the engine could not fit everything asked for, show what it did fit
      // rather than leaving the steppers lying.
      ui.simple.width = actual.width;
      ui.simple.levels = actual.levels;
      ui.simple.trimmed = actual.trimmed;
    }
    commit(next, { fit: addsPieces });
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
      if (ADVANCED_ONLY.has(module.id)) continue;
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
      geometryLoader.load(MODULE_BASE_URL, id, ASSET_VERSION)
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
      highlight: instance.id === ui.selectedId,
      // Null for almost every piece, which is what tells the renderer to use the
      // design's own palette rather than build a second one.
      palette: instance.finish ? shaderPalette(finishById(instance.finish)) : null,
      // A piece left out of the invoice is drawn as a flat pale blank, so the
      // picture says which parts of the shelf are being quoted for without a
      // caption having to.
      muted: instance.omitted === true
    };
  }

  /**
   * The bookends, as renderer entries.
   *
   * They are not pieces: the design carries a count, and the engine works out
   * which ends they hang on from where the units stand (see
   * `bookendPlacements`). So they are appended to the scene rather than to the
   * design, and nothing about them reaches `serializeState`, the share link or
   * the design code.
   *
   * The pocket in the bookend's top is what sits on the plate, so that is both
   * the point that has to land on the anchor and the point it turns about: put
   * the pivot there and the translation is a plain subtraction.
   */
  function bookendSceneEntries() {
    const accessory = ui.catalog.accessories && ui.catalog.accessories.bookend;
    if (!accessory) return [];
    const anchorMm = (accessory.attach && accessory.attach.anchorLocalMm) || [0, 0, 0];
    return engine.bookendPlacements(ui.catalog, ui.design).map((placement, index) => ({
      id: `bookend_${index + 1}`,
      moduleId: "bookend",
      translation: [
        placement.worldMm[0] - anchorMm[0],
        placement.worldMm[1] - anchorMm[1],
        placement.worldMm[2] - anchorMm[2]
      ],
      rotationDeg: placement.rotationDeg,
      pivotMm: [placement.worldMm[0], placement.worldMm[1]],
      // No bounds on purpose. They are what the camera frames and what a tap
      // hit-tests, and a bookend is neither the size of the shelf nor a thing
      // anyone means to select.
      boundsMm: null,
      highlight: false,
      // A bookend ships in the colour of the unit it hangs on.
      palette: placement.finish ? shaderPalette(finishById(placement.finish)) : null,
      muted: false
    }));
  }

  function syncScene() {
    ui.renderer.setInstances(ui.design.instances.map(renderInstance).concat(bookendSceneEntries()));
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
    // The markers the ghost belonged to have just been thrown away.
    if (ui.renderer) ui.renderer.setGhost(null);
    ui.previewCandidateId = null;

    // The front view is for looking, not building: its perspective projection
    // would put the "+" anchors and the dimension witness lines at angles that
    // parallel-projection maths cannot produce.
    if (ui.mode !== "simple" && !isPerspective()) {
      // Advanced starts from a piece, not from a place. Its "+" markers appear
      // only once one has been chosen, so the model is a model until someone
      // asks it to be a workbench -- which is the difference between the two
      // upper interfaces. Flexible keeps its standing "+" anchors: offering the
      // few places a unit can go IS its guidance.
      if (ui.activeModuleId) buildCandidateMarkers();
      else if (ui.mode !== "advanced") buildAddButtons();
      if (ui.selectedId) buildActionMenu();
    }
    updateStageActions();
    positionOverlays();
    // Labelled markers and the action menu are centred and clamped from their
    // measured size, which only exists once they are in the document.
    window.requestAnimationFrame(measureOverlays);
  }

  function addOverlay(node, pointMm, offset, options) {
    dom.overlay.appendChild(node);
    overlayItems.push({
      node,
      pointMm,
      offset: offset || [0, 0],
      // A wide overlay -- a labelled marker, the action menu -- is centred on
      // its anchor and then kept inside the frame, because .nd-stage clips and
      // an overlay half off the edge loses the button nearest that edge. A bare
      // disc needs neither: it is 38px and centred by its own margin.
      wide: Boolean(options && options.wide),
      push: Boolean(options && options.push)
    });
    return node;
  }

  /**
   * Re-place the wide overlays once they have been laid out.
   *
   * There is one of them -- the action menu -- so its size is read at the
   * moment it is clamped rather than cached. Caching looked cheaper and was
   * wrong: Red Hat Display loads with `display: swap`, so a menu measured
   * before the webfont arrives is clamped from fallback metrics, and the button
   * nearest the frame edge can still be cut off.
   */
  function measureOverlays() {
    if (overlayItems.some((item) => item.wide)) positionOverlays();
  }

  // Clear of the frame edge, and of the bottom bar's furniture.
  const OVERLAY_INSET_PX = 8;
  const OVERLAY_BOTTOM_INSET_PX = 62;

  function positionOverlays() {
    if (!ui.renderer) return;
    drawDimensions();
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
      if (visible && item.push) {
        // The anchor is on the shelf and inside the frame; it is the outward
        // push that can carry the disc past the edge, which on an L at 320px
        // clipped two of three markers by 5px and took most of the touch slop
        // with them. Pulling the disc back is not the case the "hide rather
        // than clamp" rule was written for -- it still points at its own end,
        // 11px nearer to it.
        const half = MARKER_HALF_PX;
        item.node.style.left = `${Math.round(Math.min(Math.max(x, half), Math.max(half, width - half)))}px`;
        item.node.style.top = `${Math.round(Math.min(Math.max(y, half), Math.max(half, height - half)))}px`;
        continue;
      }
      if (item.wide) {
        const w = item.node.offsetWidth;
        const h = item.node.offsetHeight;
        if (!w) continue;
        const left = Math.min(
          Math.max(x - w / 2, OVERLAY_INSET_PX),
          Math.max(OVERLAY_INSET_PX, width - w - OVERLAY_INSET_PX)
        );
        const top = Math.min(
          Math.max(y - h / 2, OVERLAY_INSET_PX),
          Math.max(OVERLAY_INSET_PX, height - h - OVERLAY_BOTTOM_INSET_PX)
        );
        item.node.style.left = `${Math.round(left)}px`;
        item.node.style.top = `${Math.round(top)}px`;
        continue;
      }
      item.node.style.left = `${Math.round(x)}px`;
      item.node.style.top = `${Math.round(y)}px`;
    }
  }

  function centreOf(bounds) {
    return [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2];
  }

  // ------------------------------------------------------------ dimensions --

  /*
   * Drafting-style dimensions on the design's envelope: width along the bottom
   * front edge, depth along the bottom right edge, height up the front left
   * corner.
   *
   * Every witness line runs along a world axis, so nothing sits at an arbitrary
   * screen angle, and each dimension is pushed clear of the model along a
   * *different* axis from the one it measures. Because the camera is a locked
   * isometric, those screen directions are constant and the three never collide.
   *
   * Offsets are in screen pixels rather than millimetres so the gap stays the
   * same at any zoom.
   */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DIM_GAP_PX = 10; // model edge -> start of the witness line
  // The two depths leave almost no gap, so each witness line reads as the leg or
  // the board edge carrying on. That is what tells them apart, not a word.
  const DIM_TOUCH_GAP_PX = 2;
  // How much further out the overall depth sits than the board depth inside it.
  const DIM_NEST_PX = 30;
  // The depths stand further off the shelf's end than width does off its front.
  const DIM_DEPTH_CLEAR_PX = 20;
  const DIM_OFFSET_PX = 34; // model edge -> the dimension line
  const DIM_OVERSHOOT_PX = 3; // witness line past the dimension line
  const DIM_LABEL_PX = 13; // dimension line -> the number
  const DIM_ARROW_LENGTH_PX = 8;
  const DIM_ARROW_WIDTH_PX = 3.5;
  // Matches .nd-dim-text in the stylesheet, which is where the live overlay gets
  // it. Needed here too because the share image draws the same numbers onto a
  // canvas, where there is no CSS -- and because everything in the overlay has
  // to scale together, or the numbers crowd the lines they belong to.
  const DIM_FONT_PX = 11.5;

  // Width and depth run along an edge of the envelope. Height does not: a run of
  // units of different heights has no single height, so heights are called out
  // per stack instead (see addHeightCallouts).
  // [measured axis, offset axis, sign, which corner of the box to run along]
  const DIMENSION_SPECS = [
    { axis: 0, offsetAxis: 2, sign: -1, at: { 1: "min", 2: "min" } },
    { axis: 1, offsetAxis: 0, sign: 1, at: { 0: "max", 2: "min" } }
  ];
  const CALLOUT_TAIL_PX = 46;
  const CALLOUT_HEAD_PX = 9;
  const CALLOUT_ARROW_PX = 5;

  function svgNode(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  /** Unit screen vector for a world axis, under the given projection. */
  function axisScreenDirection(axis, project) {
    const origin = project([0, 0, 0]);
    const tip = [0, 0, 0];
    tip[axis] = 1000;
    const end = project(tip);
    const dx = end.x - origin.x;
    const dy = end.y - origin.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  /**
   * The whole overlay as plain screen geometry: line segments and numbers, in
   * the pixel space of whatever projected them.
   *
   * Built once and drawn twice, through two different cameras. The live overlay
   * follows the viewport's pan and zoom; the share image re-frames the design
   * into its own box and is a different size again. Taking the projector as an
   * argument is what lets the second one reuse all of this rather than
   * re-deriving it.
   *
   * `scale` multiplies every offset. They are in screen pixels so the drawing
   * keeps its proportions at any zoom, but the share image is a large canvas
   * that gets looked at small, so it asks for the whole overlay bigger.
   */
  function dimensionGeometry(project, scale) {
    const lines = [];
    const labels = [];
    const bounds = shelfBounds();
    if (!bounds) return { lines, labels };

    const size = scale || 1;
    const gapPx = DIM_GAP_PX * size;
    const offsetPx = DIM_OFFSET_PX * size;
    const overshootPx = DIM_OVERSHOOT_PX * size;
    const labelPx = DIM_LABEL_PX * size;
    const arrowLengthPx = DIM_ARROW_LENGTH_PX * size;
    const arrowWidthPx = DIM_ARROW_WIDTH_PX * size;

    const depths = depthDimensions();
    const specs = depths ? DIMENSION_SPECS.filter((spec) => spec.axis !== 1) : DIMENSION_SPECS;
    const runs = specs.map((spec) => {
      const from = [0, 0, 0];
      const to = [0, 0, 0];
      for (let axis = 0; axis < 3; axis += 1) {
        const pick = spec.at[axis];
        const low = bounds[axis];
        const high = bounds[axis + 3];
        from[axis] = axis === spec.axis ? low : (pick === "max" ? high : low);
        to[axis] = axis === spec.axis ? high : (pick === "max" ? high : low);
      }
      return { from, to, offsetAxis: spec.offsetAxis, sign: spec.sign, valueMm: bounds[spec.axis + 3] - bounds[spec.axis], gapPx };
    }).concat(depths ? depths.map((run) => Object.assign({ gapPx: DIM_TOUCH_GAP_PX * size }, run)) : []);

    for (const run of runs) {
      const { from, to, valueMm } = run;
      if (valueMm < 20) continue;

      const screenFrom = project(from);
      const screenTo = project(to);
      const raw = axisScreenDirection(run.offsetAxis, project);
      const dir = { x: raw.x * run.sign, y: raw.y * run.sign };
      const along = {
        x: (screenTo.x - screenFrom.x) / (Math.hypot(screenTo.x - screenFrom.x, screenTo.y - screenFrom.y) || 1),
        y: (screenTo.y - screenFrom.y) / (Math.hypot(screenTo.x - screenFrom.x, screenTo.y - screenFrom.y) || 1)
      };

      const runOffsetPx = offsetPx + ((run.extraOffsetPx || 0) + (run.nested ? DIM_NEST_PX : 0)) * size;
      const lineFrom = { x: screenFrom.x + dir.x * runOffsetPx, y: screenFrom.y + dir.y * runOffsetPx };
      const lineTo = { x: screenTo.x + dir.x * runOffsetPx, y: screenTo.y + dir.y * runOffsetPx };

      // A witness line normally starts at the measured point; `witnessFrom` lets
      // it start further in, at the part it belongs to, and run out past it.
      const starts = run.witnessFrom ? [project(run.witnessFrom), project(run.witnessTo)] : [screenFrom, screenTo];
      [screenFrom, screenTo].forEach((end, index) => {
        lines.push({
          witness: true,
          x1: starts[index].x + dir.x * run.gapPx,
          y1: starts[index].y + dir.y * run.gapPx,
          x2: end.x + dir.x * (runOffsetPx + overshootPx),
          y2: end.y + dir.y * (runOffsetPx + overshootPx)
        });
      });
      lines.push({ x1: lineFrom.x, y1: lineFrom.y, x2: lineTo.x, y2: lineTo.y });
      // Open arrowheads point into the measured span. Unlike drafting ticks,
      // they do not cross the witness lines and stay readable on small screens.
      const side = { x: -along.y, y: along.x };
      for (const [end, inward] of [[lineFrom, 1], [lineTo, -1]]) {
        const back = {
          x: end.x + along.x * inward * arrowLengthPx,
          y: end.y + along.y * inward * arrowLengthPx
        };
        for (const sign of [1, -1]) {
          lines.push({
            arrow: true,
            x1: end.x,
            y1: end.y,
            x2: back.x + side.x * arrowWidthPx * sign,
            y2: back.y + side.y * arrowWidthPx * sign
          });
        }
      }

      const mid = { x: (lineFrom.x + lineTo.x) / 2, y: (lineFrom.y + lineTo.y) / 2 };
      // The number turns with its line, as isometric drawings letter them. Level
      // type needs clearance for its whole width; turned, only for its height,
      // which is what leaves room to set the board depth between the two depths.
      let angle = Math.atan2(along.y, along.x) * 180 / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      const across = side.x * dir.x + side.y * dir.y;
      const outward = across < 0 ? -1 : 1;
      const clearPx = run.labelBetween ? DIM_NEST_PX * size * Math.abs(across) / 2 : labelPx * 0.75;
      labels.push({
        x: mid.x + side.x * outward * clearPx,
        y: mid.y + side.y * outward * clearPx,
        angle,
        text: `${mmToCm(valueMm)} cm`
      });
    }

    addHeightCallouts(lines, labels, project, size);
    return { lines, labels, fontPx: DIM_FONT_PX * size };
  }

  /*
   * Depth twice, nested on the lowest board's surface off its right-hand end:
   * across the board nearest, and over the legs one step further out. The legs
   * stand just outside the board's front and back edges, so the outer one's
   * witness lines start at the last pair of posts and run out past the board;
   * the nesting and where each line starts say which is which, not a word.
   *
   * Only for a straight run. A run that turns a corner has no single depth, so
   * it keeps the envelope dimension.
   */
  function depthDimensions() {
    const shelf = ui.design.instances.filter((instance) => ui.catalog.modules[instance.moduleId].role !== "lamp");
    if (!shelf.length || shelf.some((instance) => (instance.rotationDeg || 0) % 180 !== 0)) return null;

    let posts = null;
    for (const instance of shelf) {
      const module = ui.catalog.modules[instance.moduleId];
      for (const socket of module.sockets || []) {
        if (socket.kind !== "top") continue;
        const [x, , z] = engine.worldSocket(instance, socket, module).worldMm;
        if (!posts || x > posts.x + 1 || (Math.abs(x - posts.x) <= 1 && z > posts.z)) {
          posts = { x, z, bounds: engine.instanceBounds(ui.catalog, instance) };
        }
      }
    }

    // The lowest board at the right-hand end. Top bars are boards too, to the
    // module, so anything shallower than a shelf is passed over.
    let board = null;
    for (const instance of shelf) {
      for (const box of engine.boardBoxes(ui.catalog, instance)) {
        if (box[4] - box[1] < 100) continue;
        if (!board || box[3] > board[3] + 1 || (Math.abs(box[3] - board[3]) <= 1 && box[5] < board[5])) board = box;
      }
    }
    if (!posts || !board) return null;

    const legs = posts.bounds;
    const z = board[5];
    return [
      {
        from: [board[3], board[1], z], to: [board[3], board[4], z], offsetAxis: 0, sign: 1,
        valueMm: board[4] - board[1], labelBetween: true, extraOffsetPx: DIM_DEPTH_CLEAR_PX
      },
      {
        from: [board[3], legs[1], z], to: [board[3], legs[4], z], offsetAxis: 0, sign: 1,
        witnessFrom: [posts.x, legs[1], z], witnessTo: [posts.x, legs[4], z],
        valueMm: legs[4] - legs[1], nested: true, extraOffsetPx: DIM_DEPTH_CLEAR_PX
      }
    ];
  }

  function drawDimensions() {
    if (!ui.dimensionsSvg) return;
    const svg = ui.dimensionsSvg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!ui.dimensionsOn || isPerspective()) return;

    const width = dom.stage.clientWidth;
    const height = dom.stage.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const { lines, labels } = dimensionGeometry(ui.renderer.project);
    for (const line of lines) {
      svg.appendChild(svgNode("line", {
        class: line.witness ? "nd-dim-witness" : line.arrow ? "nd-dim-arrow" : "nd-dim-line",
        x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2
      }));
    }
    for (const label of labels) {
      const node = svgNode("text", {
        class: "nd-dim-text", x: label.x, y: label.y,
        "text-anchor": "middle", "dominant-baseline": "middle",
        transform: `rotate(${label.angle || 0} ${label.x} ${label.y})`
      });
      node.textContent = label.text;
      svg.appendChild(node);
    }
  }

  /**
   * One height callout per distinct stack height: the number above the stack with
   * a short arrow pointing down at its top, centred on the stack it measures.
   *
   * Floor-to-top is implicit, so there is no line spanning the whole height --
   * that would run down through the shelf. Stacks of equal height share a single
   * callout, so a symmetric run reads as one number rather than four.
   *
   * Height is the usable shelf assembly from the floor to its top. Accessories
   * such as lamps do not turn a 72cm shelf into a 149cm shelf, and small mesh
   * details below the floor plane are never counted.
   */
  function addHeightCallouts(lines, labels, project, scale) {
    const { groups } = engine.stacksOf(ui.design);
    const byHeight = new Map();
    groups.forEach((ids) => {
      const unit = stackBounds(ids, { excludeLamps: true });
      if (!unit) return;
      const valueMm = Math.round(heightAboveFloor(unit));
      if (valueMm < 50) return;
      const centreX = (unit[0] + unit[3]) / 2;
      const key = mmToCm(valueMm);
      const existing = byHeight.get(key);
      if (!existing || centreX < existing.centreX) {
        // The arrow lands in the middle of the top board, on its surface, rather
        // than at the post tops that set the height it quotes.
        const top = ids.flatMap((id) => {
          const instance = ui.design.instances.find((item) => item.id === id);
          return instance && ui.catalog.modules[instance.moduleId].role !== "lamp"
            ? engine.boardBoxes(ui.catalog, instance)
            : [];
        }).filter((box) => box[4] - box[1] >= 100)
          .reduce((highest, box) => (!highest || box[5] > highest[5] ? box : highest), null);
        const surface = top || unit;
        byHeight.set(key, {
          valueMm,
          centreX,
          anchorX: (surface[0] + surface[3]) / 2,
          centreY: (surface[1] + surface[4]) / 2,
          topZ: surface[5]
        });
      }
    });

    const size = scale || 1;
    const tailPx = CALLOUT_TAIL_PX * size;
    const headPx = CALLOUT_HEAD_PX * size;
    const arrowPx = CALLOUT_ARROW_PX * size;
    const up = axisScreenDirection(2, project);
    for (const stack of byHeight.values()) {
      const top = project([stack.anchorX, stack.centreY, stack.topZ]);
      // Shorten the tail rather than let the number ride up out of the view.
      // The number is what has to stay inside, so the room it needs is measured
      // to the top of the type, not to the end of the arrow -- reserving only
      // the arrow's length is what let a callout on a wide design, where the
      // model reaches nearly to the frame, put its number above the frame edge.
      const labelRoom = (DIM_LABEL_PX + DIM_FONT_PX) * size;
      const tailLength = Math.min(tailPx, Math.max(headPx + 2, top.y - labelRoom));
      const tail = { x: top.x + up.x * tailLength, y: top.y + up.y * tailLength };
      const head = { x: top.x + up.x * headPx, y: top.y + up.y * headPx };
      lines.push({ x1: tail.x, y1: tail.y, x2: head.x, y2: head.y });
      // Arrowhead at the model end.
      const side = { x: -up.y, y: up.x };
      const back = { x: head.x + up.x * arrowPx * 1.6, y: head.y + up.y * arrowPx * 1.6 };
      for (const sign of [1, -1]) {
        lines.push({
          x1: head.x, y1: head.y,
          x2: back.x + side.x * arrowPx * sign,
          y2: back.y + side.y * arrowPx * sign
        });
      }
      labels.push({
        x: tail.x + up.x * DIM_LABEL_PX * size,
        y: tail.y + up.y * DIM_LABEL_PX * size,
        text: `${mmToCm(stack.valueMm)} cm`
      });
    }
  }

  // Dimension lines and their numbers hang outside the model, so the view needs
  // more margin than usual while they are showing.
  const DIMENSION_FIT_PADDING = 1.36;

  function isPerspective() {
    return Boolean(ui.renderer) && ui.renderer.getViewMode() === "perspective";
  }

  /**
   * The front view frames itself from the design, so there is no pan or zoom to
   * preserve; switching back to isometric re-fits rather than restoring whatever
   * the camera happened to be doing before.
   */
  function setPerspective(on) {
    ui.renderer.setViewMode(on ? "perspective" : "iso");
    dom.perspective.setAttribute("aria-pressed", String(Boolean(on)));
    dom.perspective.classList.toggle("is-active", Boolean(on));
    dom.app.dataset.view = on ? "perspective" : "iso";
    if (!on) ui.renderer.fit(null, ui.dimensionsOn ? DIMENSION_FIT_PADDING : null);
    ui.selectedId = null;
    ui.activeModuleId = null;
    buildOverlay();
    drawDimensions();
  }

  function setDimensions(on) {
    ui.dimensionsOn = Boolean(on);
    dom.dimensions.setAttribute("aria-pressed", String(ui.dimensionsOn));
    dom.dimensions.classList.toggle("is-active", ui.dimensionsOn);
    ui.renderer.fit(null, ui.dimensionsOn ? DIMENSION_FIT_PADDING : null);
    drawDimensions();
  }

  function candidateBounds(candidate) {
    const module = ui.catalog.modules[candidate.moduleId];
    return engine.instanceBounds(ui.catalog, {
      moduleId: candidate.moduleId,
      translation: [candidate.transform.x, candidate.transform.y, candidate.transform.z],
      rotationDeg: candidateRotation(module, candidate)
    });
  }

  /*
   * Spacing between neighbouring units, named rather than measured.
   *
   * Listing them as "43 cm gap" made a wall of numbers nobody was choosing
   * between; a size is a decision. These name Advanced's placement markers,
   * which is the only interface that offers a gapped spacing at all -- and, for
   * a long time, the only one that never said which of its four identical discs
   * was which. The centimetres survive in each marker's label.
   *
   * The engine leaves 30mm of working clearance even between touching units, so
   * anything at or under that is "against its neighbour", not a gap.
   */
  const GAP_NAMES = ["No gap", "Small gap", "Medium gap", "Large gap"];

  function gapName(index) {
    return GAP_NAMES[Math.min(index, GAP_NAMES.length - 1)];
  }

  function isTouching(gapMm) {
    return gapMm <= engine.ADJACENT_BASE_GAP_MM + 6;
  }

  /**
   * Which way a candidate leaves the unit it was placed against, snapped to a
   * world axis.
   *
   * This is what replaced comparing the candidate's X against the design's
   * envelope. A run created by turning a corner runs along Y, so on an L every
   * continuation of the second run had an X between the design's min and max,
   * was classified as neither side, and was thrown away -- which is why a
   * Standard L would not take a fourth Standard unit while offering Wide and
   * Deep, whose extra depth happened to push them past the envelope.
   */
  function outwardFrom(host, candidate) {
    const board = engine.boardBounds(ui.catalog, host);
    const box = candidateBounds(candidate);
    const delta = [
      (box[0] + box[3]) / 2 - (board[0] + board[3]) / 2,
      (box[1] + box[4]) / 2 - (board[1] + board[4]) / 2
    ];
    // Which axis the new unit actually gets past the host on, not merely which
    // way its centre lies. A corner unit turned off a long side sits well along
    // the run as well as beside it, so its centre can be further away on the
    // axis it still overlaps -- and keyed by that axis it became a marker of
    // its own, on the far face, a metre from where the piece lands.
    const clears = [0, 1].filter((axis) => box[axis] >= board[axis + 3] || box[axis + 3] <= board[axis]);
    const axis = clears.length === 1
      ? clears[0]
      : (Math.abs(delta[0]) >= Math.abs(delta[1]) ? 0 : 1);
    return { axis, sign: delta[axis] < 0 ? -1 : 1 };
  }

  /** Does this piece run across the unit it meets, rather than along with it? */
  function isTurn(module, host, candidate) {
    const turned = Math.abs(candidateRotation(module, candidate) - (host.rotationDeg || 0)) % 180;
    return turned >= 45 && turned <= 135;
  }

  /**
   * The "+" affordances: one at each free end of a run, and one above each
   * stack. Each carries every piece that legally fits there, so tapping it opens
   * a list instead of the app guessing.
   *
   * One marker per end, not one per kind of placement. Carrying on along a run
   * and turning off it are two answers to the same question -- "what happens at
   * this end of the shelf" -- and splitting them into two discs 145mm apart put
   * the only two colliding markers in the tool at every end of every design,
   * closing from 29px to 18px as the shelf grew and the camera pulled back.
   * They are not two affordances near each other; they are one drawn twice.
   */
  function buildAddButtons() {
    const ends = new Map();
    const groupedTop = new Map();
    const { rootOf, groups } = engine.stacksOf(ui.design);
    const hostById = new Map(ui.design.instances.map((instance) => [instance.id, instance]));
    const firstBase = [];

    ui.candidateCache.forEach((candidates, id) => {
      const module = ui.catalog.modules[id];
      for (const candidate of candidates) {
        if (module.role !== "base") {
          const consumed = candidate.consumedSockets || [];
          if (!consumed.length) continue;
          const roots = new Set(consumed.map((socket) => rootOf(socket.instanceId)));
          // A piece spanning two stacks has no single "above this stack" home.
          if (roots.size !== 1) continue;
          const root = rootOf(consumed[0].instanceId);
          if (!groupedTop.has(root)) groupedTop.set(root, []);
          const options = groupedTop.get(root);
          if (!options.some((entry) => entry.module.id === id)) options.push({ module, candidate });
          continue;
        }
        const host = hostById.get(candidate.placement.nextTo);
        if (!host) {
          // The first unit of an empty shelf answers to no host.
          if (!firstBase.some((entry) => entry.module.id === id)) firstBase.push({ module, candidate });
          continue;
        }
        const out = outwardFrom(host, candidate);
        const key = `${host.id}:${out.axis}:${out.sign}`;
        if (!ends.has(key)) ends.set(key, { host, out, straight: [], turns: [] });
        const end = ends.get(key);
        const list = isTurn(module, host, candidate) ? end.turns : end.straight;
        const gapMm = endGapMm(host, out, candidate);
        const existing = list.find((entry) => entry.module.id === id);
        if (!existing) list.push({ module, candidate, gapMm });
        else if (gapMm < existing.gapMm) {
          // Flexible butts units together; where the engine offers the same
          // piece at several spacings the nearest is the one it means.
          existing.candidate = candidate;
          existing.gapMm = gapMm;
        }
      }
    });

    if (firstBase.length) {
      const spot = centreOf(candidateBounds(firstBase[0].candidate));
      addOverlay(plusButton("Start your shelf", firstBase.map(placeRow), { search: false }), spot);
    }

    // Two units can share one end of a run: the unit at the end and the one
    // beside it both offer the same gap, so the host is not on its own the
    // identity of an end. Unmerged, an L drew two markers 2px apart, which is
    // the fault this whole pass exists to remove, rebuilt one level down.
    const placedEnds = [];
    ends.forEach((end) => {
      if (!end.straight.length && !end.turns.length) return;
      const stack = groups.get(rootOf(end.host.id)) || [end.host.id];
      const anchor = endAnchor(end, stack);
      const same = placedEnds.find((other) => other.end.out.axis === end.out.axis
        && other.end.out.sign === end.out.sign
        && Math.hypot(
          other.anchor[0] - anchor[0],
          other.anchor[1] - anchor[1],
          other.anchor[2] - anchor[2]
        ) < SAME_END_MM);
      if (same) {
        mergeEnd(same.end, end);
        return;
      }
      placedEnds.push({ end, anchor });
    });

    for (const placed of placedEnds) {
      addOverlay(
        // No search box, ever: an end sheet is one row per unit family plus
        // the corner, which is eight today and one family from tripping the
        // threshold in the mode whose whole promise is that you were never
        // supposed to know a part's name.
        plusButton("Add a unit here", endOptions(placed.end), { search: false }),
        placed.anchor,
        outwardPush(placed.end.out, MARKER_PUSH_PX),
        { push: true }
      );
    }

    groups.forEach((ids, root) => {
      const options = groupedTop.get(root);
      if (!options || !options.length) return;
      // Lamps excluded: a lamp stands 76cm over the shelf it lights, and a
      // marker floating up there points at nothing anyone is building on.
      const bounds = stackBounds(ids, { excludeLamps: true });
      if (!bounds) return;
      addOverlay(
        plusButton("Add on top", options.map(placeRow), { search: false }),
        [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, bounds[5]],
        [0, -MARKER_PUSH_PX],
        { push: true }
      );
    });
  }

  /** Fold one end's offers into another's, keeping the nearest of each piece. */
  function mergeEnd(into, from) {
    for (const key of ["straight", "turns"]) {
      for (const entry of from[key]) {
        const existing = into[key].find((other) => other.module.id === entry.module.id);
        if (!existing) into[key].push(entry);
        else if (entry.gapMm < existing.gapMm) {
          existing.candidate = entry.candidate;
          existing.gapMm = entry.gapMm;
        }
      }
    }
  }

  /** The gap between the end being built on and where the new unit would stand. */
  function endGapMm(host, out, candidate) {
    const board = engine.boardBounds(ui.catalog, host);
    const box = candidateBounds(candidate);
    const edge = out.sign > 0 ? board[out.axis + 3] : board[out.axis];
    return Math.max(0, Math.round(out.sign > 0 ? box[out.axis] - edge : edge - box[out.axis + 3]));
  }

  function placeRow(entry) {
    return { module: entry.module, onPick: () => placeCandidate(entry.candidate) };
  }

  /**
   * One end's sheet, in up to two sections.
   *
   * The corner unit is a row in the first section, not a button of its own: it
   * is an ordinary unit with a longer shelf, and placing one turns nothing --
   * it is what a later turn comes off. It wore "Turn a corner here" and then
   * left the shelf visibly unchanged, which is the sharpest version of the
   * complaint that the markers do not say what they do.
   */
  function endOptions(end) {
    const straight = end.straight.map((entry) => Object.assign(placeRow(entry), {
      note: entry.module.family === "corner" ? "a longer shelf, to turn off later" : null
    }));
    // The same unit can appear in both sections -- in line, and turned -- so
    // the turned one says so in its name rather than only in a note under it.
    const turns = end.turns.map((entry) => Object.assign(placeRow(entry), {
      label: `${moduleLabel(entry.module)}, turned`,
      note: "starts a second run"
    }));
    if (!turns.length) return straight;
    if (!straight.length) return turns;
    // Each turned row already says "<Unit>, turned" and "starts a second run",
    // so a heading over a single one of them is the same fact a third time,
    // for a band of type in a sheet that scrolls. It earns its place only when
    // it is gathering more than one row.
    if (turns.length < 2) return straight.concat(turns);
    return [{ heading: "Along this run" }]
      .concat(straight, [{ heading: "Turn a corner" }], turns);
  }

  /**
   * Where an end marker stands: on the end face of the last real unit, level
   * with its own stack.
   *
   * It used to stand at the centre of the unit that does not exist yet, at the
   * design's mid-height. Both were wrong. The phantom unit is outside
   * designBounds, which is what renderer.fit() frames, so on a 375px phone all
   * four side markers projected off-stage and positionOverlays hid them --
   * leaving "Add on top" as the only affordance in the mode. And the mid-height
   * put a marker for a one-level unit up beside a three-level one.
   */
  function endAnchor(end, stackIds) {
    const board = engine.boardBounds(ui.catalog, end.host);
    const other = end.out.axis === 0 ? 1 : 0;
    const stack = stackBounds(stackIds, { excludeLamps: true }) || board;
    const point = [];
    point[end.out.axis] = end.out.sign > 0 ? board[end.out.axis + 3] : board[end.out.axis];
    point[other] = (board[other] + board[other + 3]) / 2;
    point[2] = (stack[2] + stack[5]) / 2;
    return point;
  }

  /**
   * A fixed screen-space nudge off the model, along the world axis the marker
   * points down. Pixels rather than millimetres so the gap between the shelf and
   * its marker is the same at every zoom.
   */
  const MARKER_PUSH_PX = 26;
  // The disc's radius plus its invisible slop ring, which is what has to stay
  // inside the frame for the marker to be fully tappable.
  const MARKER_HALF_PX = 25;

  function outwardPush(out, distancePx) {
    if (!ui.renderer) return [0, 0];
    const direction = axisScreenDirection(out.axis, (point) => ui.renderer.project(point));
    return [direction.x * out.sign * distancePx, direction.y * out.sign * distancePx];
  }
  function stackBounds(ids, options) {
    const set = new Set(ids);
    const skipLamps = Boolean(options && options.excludeLamps);
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let any = false;
    for (const instance of ui.design.instances) {
      if (!set.has(instance.id)) continue;
      if (skipLamps && ui.catalog.modules[instance.moduleId].role === "lamp") continue;
      const box = engine.instanceBounds(ui.catalog, instance);
      any = true;
      for (let axis = 0; axis < 3; axis += 1) {
        if (box[axis] < bounds[axis]) bounds[axis] = box[axis];
        if (box[axis + 3] > bounds[axis + 3]) bounds[axis + 3] = box[axis + 3];
      }
    }
    return any ? bounds : null;
  }

  /**
   * A marker that opens a list rather than placing something.
   *
   * `options` are passed to the picker unchanged, so a caller can give a row
   * its own action, or a section its own heading, rather than every row meaning
   * "place this now". (Rebuilding them here is what silently discarded the
   * spacing sub-picker.)
   *
   * It is a bare disc and stays one. Drawing the label on it was tried: the
   * markers became pills reading "Add here" and "Add on top", which is more
   * legible and, on an L-shaped design at 375px, covered the shelf. The model
   * is the product. What a marker means comes from where it stands and from the
   * title of the sheet it opens; `label` is the accessible name and the desktop
   * tooltip, and that is where it belongs.
   *
   * The ring marks the ones that open a list, because in Advanced they sit
   * beside markers that place on the second tap, and two identical discs doing
   * two different things is the fault this whole pass set out to remove.
   */
  function plusButton(label, options, settings) {
    const button = make("button", `nd-plus${settings && settings.menu ? " is-menu" : ""}`, "+");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(label, options, settings);
    });
    return button;
  }

  function placeCandidate(candidate) {
    const module = ui.catalog.modules[candidate.moduleId];
    let next = null;
    try {
      next = engine.applyCandidate(ui.catalog, ui.design, candidate, {
        // A candidate that turned a corner brings its own quarter turn; the
        // facing rules (a top bar reaching back over the shelf, say) are
        // relative to that, not instead of it.
        rotationDeg: candidateRotation(module, candidate)
      });
    } catch (error) {
      console.error(error);
    }
    // Advanced keeps the piece in hand and frames the spots that are left, so
    // the next one of the same part is two taps rather than a sheet away. The
    // framing has to be the candidates' rather than the design's, or the
    // remaining markers land outside a camera fitted to the shelf alone and
    // positionOverlays hides them.
    const keep = ui.mode === "advanced" && Boolean(next);
    // Set before the commit, because refresh() draws the button that reads it.
    if (keep) ui.placedSinceChoose = true;
    const options = keep ? { fit: "candidates", keepModule: true } : { fit: true };
    if (commit(next, options)) track("designer_place", { module: candidate.moduleId, mode: ui.mode });
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
  // Distinct spacings for a neighbouring unit are at least 160mm apart and the
  // two depth rows at least 257mm, so this merges genuine near-duplicates
  // without hiding a real choice.
  const CANDIDATE_MERGE_MM = 120;

  /**
   * The distinct places a piece can go: the raw candidates, with near-duplicates
   * merged the way the markers merge them.
   *
   * Shared with the add sheet, because the sheet used to count raw candidates
   * and promise nine spots where the model then drew eight.
   */
  function distinctSpots(candidates) {
    const kept = [];
    for (const candidate of candidates || []) {
      const bounds = candidateBounds(candidate);
      const point = [
        (bounds[0] + bounds[3]) / 2,
        (bounds[1] + bounds[4]) / 2,
        candidate.supportPlaneZ + 40
      ];
      if (kept.some((other) => Math.hypot(other.point[0] - point[0], other.point[1] - point[1], other.point[2] - point[2]) < CANDIDATE_MERGE_MM)) {
        continue;
      }
      kept.push({ candidate, point, bounds });
    }
    return kept;
  }

  /**
   * Group the places that differ only in how much air is left beside the run.
   *
   * Advanced is the only interface that offers a gapped spacing at all, and it
   * drew each one as its own disc: eight identical markers for a Standard Base
   * on the default design, four per side, all titled "Put the Standard Base
   * here". On a 375px phone the four on one side sat inside 53px of screen with
   * gaps of 10px between 38px discs -- four different answers no thumb could
   * choose between.
   *
   * They are one decision, so they get one marker, and the spacing becomes the
   * short named list the picker was written for: a size, not a measurement,
   * because "43 cm" and "70 cm" is not a choice anybody makes by reading. The
   * centimetres are on each row, where there is room for them.
   */
  function spacingGroups(kept) {
    const groups = new Map();
    const hostById = new Map(ui.design.instances.map((instance) => [instance.id, instance]));
    for (const entry of kept) {
      // Keyed by the end being built on, exactly as the Flexible markers are.
      // Keyed by the design's envelope instead -- "is this box left of the
      // whole shelf, or right of it" -- this was the same fault that stopped a
      // corner-turned run being extended: a second run along Y has every one of
      // its spacings inside the envelope, so none of them grouped and the blob
      // of near-identical discs came back on exactly the design that needed it.
      const host = hostById.get(entry.candidate.placement && entry.candidate.placement.nextTo);
      if (!host) continue;
      const out = outwardFrom(host, entry.candidate);
      entry.gapMm = endGapMm(host, out, entry.candidate);
      const key = `${host.id}:${out.axis}:${out.sign}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    // Two units can share one end of a run -- the unit at the end and the one
    // beside it both offer the same gap -- so `host.id` is not on its own the
    // identity of an end. Ends that face the same way and whose nearest spots
    // are within a unit's width of each other are the same end, and were
    // drawing two markers 7px apart on an L.
    const merged = new Map();
    for (const [key, list] of Array.from(groups.entries())) {
      list.sort((first, second) => first.gapMm - second.gapMm);
      const facing = key.slice(key.indexOf(":"));
      const near = Array.from(merged.keys()).find((other) => other.endsWith(facing)
        && Math.hypot(
          merged.get(other)[0].point[0] - list[0].point[0],
          merged.get(other)[0].point[1] - list[0].point[1],
          merged.get(other)[0].point[2] - list[0].point[2]
        ) < SAME_END_MM);
      if (near) merged.get(near).push(...list);
      else merged.set(key, list);
    }
    // An end with one place has nothing to tell apart, so it stays an ordinary
    // marker and keeps the ghost.
    for (const key of Array.from(merged.keys())) {
      const list = merged.get(key).sort((first, second) => first.gapMm - second.gapMm);
      if (list.length < 2) merged.delete(key);
      else merged.set(key, list);
    }
    return merged;
  }

  // A unit's width, near enough: two spots closer than this, facing the same
  // way, are the same end of the same run seen from two of its units.
  const SAME_END_MM = 400;

  /** The rows behind a spacing marker: nearest first, named by size. */
  function spacingRows(module, list) {
    let rank = 1;
    return list.map((entry) => {
      const touching = isTouching(entry.gapMm);
      return {
        module,
        label: touching ? GAP_NAMES[0] : gapName(rank++),
        note: touching ? "against its neighbour" : `${mmToCm(entry.gapMm)} cm clear`,
        hidePrice: true,
        onPick: () => placeCandidate(entry.candidate)
      };
    });
  }

  /**
   * The spots that will actually carry a marker: the ungrouped ones, plus the
   * nearest of each spacing group.
   *
   * The camera reads the same list. Framing every raw candidate instead drew
   * the shelf at a quarter of the stage on a phone, because the widest gapped
   * placement reaches most of a unit's width past the run and no longer has a
   * marker of its own to justify the room.
   */
  function markerPlan(moduleId) {
    const placed = distinctSpots(ui.candidateCache.get(moduleId) || []);
    const groups = spacingGroups(placed);
    const grouped = new Set();
    groups.forEach((list) => list.forEach((entry) => grouped.add(entry)));
    const singles = placed.filter((entry) => !grouped.has(entry));
    const anchors = singles.concat(Array.from(groups.values()).map((list) => list[0]));
    return { groups, singles, anchors };
  }

  function buildCandidateMarkers() {
    const module = ui.catalog.modules[ui.activeModuleId];
    const { groups, singles, anchors } = markerPlan(ui.activeModuleId);
    const placed = anchors;

    groups.forEach((list) => {
      // Anchored on the nearest of the group, which is where the piece lands if
      // the spacing is left alone.
      const label = `Put the ${moduleLabel(module)} on this side`;
      // The ring only in Advanced, and only here: these sit beside markers
      // that place on the second tap, and that is the difference it marks. In
      // Flexible every marker opens a list, so a ring on all of them would
      // distinguish nothing and just add weight over the shelf.
      addOverlay(plusButton(label, spacingRows(module, list), { menu: true }), list[0].point);
    });

    for (const entry of singles) {
      const candidate = entry.candidate;
      const point = entry.point;
      const button = make("button", "nd-plus", "+");
      button.type = "button";
      button.title = `Put the ${moduleLabel(module)} here`;
      button.setAttribute("aria-label", button.title);

      // A "+" alone does not say which way round the piece goes -- a booster
      // over a base could sit on either column. Previewing the actual piece in
      // place answers that. With a mouse, hovering previews and the click
      // places. Touch has no hover, so the first tap previews and turns the
      // button into a confirm; a second tap commits.
      // Keyed by module AND candidate: candidate ids restart at candidate_001
      // for every module, so the bare id would let a preview of one piece
      // satisfy the confirm check of a different one and place it on first tap.
      const key = `${candidate.moduleId}#${candidate.id}`;
      const preview = () => {
        if (ui.previewCandidateId === key) return false;
        ui.previewCandidateId = key;
        showGhost(candidate);
        markConfirm(key);
        return true;
      };
      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") preview();
      });
      button.addEventListener("focus", preview);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (preview()) return; // first tap: show what will happen
        placeCandidate(candidate);
      });
      button.dataset.candidateId = key;
      addOverlay(button, point);
    }
    markConfirm(ui.previewCandidateId);
    if (!placed.length) {
      setHint(`The ${moduleLabel(module)} does not fit on this shelf yet.`);
    } else if (singles.length && !ui.taughtPlacing) {
      // The two-tap preview is not guessable, and the marker teaches it the
      // moment it turns into a tick. So it is said once and then trusted --
      // and only where there is a marker that behaves that way. Where every
      // marker on screen opens a list of spacings instead, the sentence would
      // be describing a gesture none of them answer to.
      ui.taughtPlacing = true;
      setHint(`Tap a + to try the ${moduleLabel(module)} there. Tap again to place it.`);
    }
  }

  /**
   * Frame the shelf together with every place the chosen piece could go, so all
   * the markers are on screen before the first tap. Without this, choosing a
   * piece whose spots reach past the current view left some markers clipped and
   * the reframe only happened once one of them was previewed.
   */
  function fitToCandidates(moduleId) {
    const bounds = candidateFrame(moduleId);
    if (!bounds) return;
    // Only move a camera that needs moving. With a piece kept in hand this runs
    // after every placement, and re-framing a view that already showed
    // everything reads as the shelf flinching each time you put a part down.
    if (ui.renderer.containsBounds(bounds)) return;
    ui.renderer.fit(bounds, ui.dimensionsOn ? DIMENSION_FIT_PADDING : null);
  }

  /**
   * The shelf plus the points its markers stand on.
   *
   * The points, not the boxes the pieces would occupy. A marker is a 38px disc
   * and only its anchor has to be on screen; framing whole phantom units --
   * each a unit's width beyond the run, in up to four directions -- drew the
   * shelf at a quarter of a portrait stage. Where a piece would land off-screen
   * `showGhost` widens the view at the moment it is previewed, which is when
   * that actually matters.
   */
  function candidateFrame(moduleId) {
    const plan = markerPlan(moduleId);
    if (!plan.anchors.length) return null;
    const union = engine.designBounds(ui.catalog, ui.design);
    // An empty shelf has no bounds of its own, so the first piece's own box is
    // the frame. Returning null here left the camera on the empty-scene
    // fallback while the marker sat somewhere else.
    const bounds = (union || plan.anchors[0].bounds).slice();
    const widen = (box) => {
      for (let axis = 0; axis < 3; axis += 1) {
        bounds[axis] = Math.min(bounds[axis], box[axis]);
        bounds[axis + 3] = Math.max(bounds[axis + 3], box[axis + 3]);
      }
    };
    // A marker that ghosts on its first tap needs the whole piece framed, or
    // showGhost widens the view at that tap and every marker moves out from
    // under the thumb halfway through a two-tap gesture. A marker that opens a
    // list needs only its own anchor on screen: framing the phantom units
    // behind it drew the shelf at a third of a portrait stage.
    for (const entry of plan.singles) widen(entry.bounds);
    for (const entry of plan.anchors) {
      if (plan.singles.indexOf(entry) >= 0) continue;
      widen([entry.point[0], entry.point[1], entry.point[2], entry.point[0], entry.point[1], entry.point[2]]);
    }
    return bounds;
  }

  /** Show the chosen piece translucently exactly where it would land. */
  function showGhost(candidate) {
    if (!candidate) {
      ui.renderer.setGhost(null);
      return;
    }
    const module = ui.catalog.modules[candidate.moduleId];
    const pivot = engine.localPivot(module);
    const translation = [candidate.transform.x, candidate.transform.y, candidate.transform.z];
    ui.renderer.setGhost({
      moduleId: candidate.moduleId,
      translation,
      rotationDeg: candidateRotation(module, candidate),
      pivotMm: [translation[0] + pivot[0], translation[1] + pivot[1]]
    });
    ensureGeometry([candidate.moduleId]);

    // A preview that lands off-screen answers nothing. Widen the view to take in
    // both the shelf and the ghost when it would not otherwise be visible.
    const ghostBounds = candidateBounds(candidate);
    if (!ui.renderer.containsBounds(ghostBounds)) {
      const design = engine.designBounds(ui.catalog, ui.design);
      const union = design ? design.slice() : ghostBounds.slice();
      for (let axis = 0; axis < 3; axis += 1) {
        union[axis] = Math.min(union[axis], ghostBounds[axis]);
        union[axis + 3] = Math.max(union[axis + 3], ghostBounds[axis + 3]);
      }
      ui.renderer.fit(union, ui.dimensionsOn ? DIMENSION_FIT_PADDING : null);
      positionOverlays();
    }
  }

  /** Mark the previewed marker so it reads as "tap again to place". */
  function markConfirm(candidateId) {
    Array.prototype.forEach.call(dom.overlay.querySelectorAll(".nd-plus[data-candidate-id]"), (node) => {
      const isConfirm = Boolean(candidateId) && node.dataset.candidateId === candidateId;
      node.classList.toggle("is-confirm", isConfirm);
      node.textContent = isConfirm ? "✓" : "+";
    });
  }

  function clearGhost() {
    ui.previewCandidateId = null;
    if (ui.renderer) ui.renderer.setGhost(null);
    markConfirm(null);
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
    if (rotateStep) {
      const rotate = make("button", null, "Rotate");
      rotate.type = "button";
      rotate.addEventListener("click", (event) => {
        event.stopPropagation();
        rotateInstance(instance);
      });
      menu.appendChild(rotate);
    }
    // Not four swatches inline: the menu is a floating popout anchored on a
    // piece and has to stay thumb-sized. A single entry opening the picker sheet
    // is the shape that already fits.
    const colour = make("button", null, "Colour");
    colour.type = "button";
    colour.addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(`Colour of this ${moduleLabel(ui.catalog.modules[instance.moduleId])}`, finishOptions(instance));
    });
    menu.appendChild(colour);

    // Advanced only. It answers "I already have two of these and want three
    // more", which is a question asked at the trade counter and never by
    // somebody buying a whole shelf, and Advanced is where that person is.
    if (ui.mode === "advanced") {
      const omit = make("button", instance.omitted ? "is-quiet" : null, instance.omitted ? "Include" : "Omit");
      omit.type = "button";
      const label = instance.omitted
        ? "Put this piece back in the invoice"
        : "Leave this piece out of the invoice";
      omit.title = label;
      omit.setAttribute("aria-label", label);
      omit.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleOmitted(instance);
      });
      menu.appendChild(omit);
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
      setHint("This piece is holding the shelf up. Remove what is on top of it first.");
      ui.selectedId = null;
      return;
    }
    const bounds = engine.instanceBounds(ui.catalog, instance);
    // Centred on the piece and kept inside the frame. In Advanced the menu is
    // five buttons and about 320px wide, and the stage clips: pan a shelf so a
    // piece sits left of centre and Swap was drawn off the edge of the stage
    // and could not be reached, with nothing to say it was there.
    ui.actionMenu = addOverlay(menu, centreOf(bounds), [0, 0], { wide: true });
    window.requestAnimationFrame(measureOverlays);
  }

  /*
   * Turning a piece.
   *
   * Whether rotating is worth offering is decided by how much of the piece's
   * shape actually moves (rotation180Shift, baked into the catalogue), not by
   * whether its sockets move. A top bar's two sockets swap places under a half
   * turn so they look unchanged, while its cross bar flips from pointing
   * forwards to backwards -- the single most useful thing to be able to turn.
   * Conversely an extension only shifts a couple of small brackets, and offering
   * Rotate there is noise.
   */
  const ROTATION_SHIFT_THRESHOLD = 0.09;

  function rotationStepFor(instance) {
    const module = ui.catalog.modules[instance.moduleId];
    if (!module) return 0;
    if (module.role === "lamp") return 45;
    return (module.rotation180Shift || 0) >= ROTATION_SHIFT_THRESHOLD ? 180 : 0;
  }

  /**
   * Pieces that reach out to one side of a single row of sockets -- a top bar,
   * a lamp arm -- have to face into the shelf, so their correct rotation depends
   * on whether they land on the front row or the back row.
   */
  function facesIntoShelf(module) {
    return module.bottomRowCount === 1 && (module.rotation180Shift || 0) >= ROTATION_SHIFT_THRESHOLD;
  }

  /**
   * The rotation a piece should be placed at.
   *
   * Zero for almost everything. A spacer reads better turned round, which is
   * free because its sockets are unchanged by a half turn. A front-mounted top
   * bar has to be flipped so its cross bar reaches back over the shelf instead
   * of jutting out into the room.
   */
  function defaultRotationFor(module, candidate) {
    if (!engine.rotationKeepsSockets(module, 180)) return 0;
    if (facesIntoShelf(module)) return onFrontRow(candidate) ? 180 : 0;
    if (module.role === "spacer") return 180;
    return 0;
  }

  function candidateRotation(module, candidate) {
    return ((candidate.rotationDeg || 0) + defaultRotationFor(module, candidate)) % 360;
  }

  /** Is this candidate resting on the front row of its supporting stack? */
  function onFrontRow(candidate) {
    const supports = candidate.consumedSockets || [];
    if (!supports.length) return false;
    const provider = ui.design.instances.find((instance) => instance.id === supports[0].instanceId);
    if (!provider) return false;
    const providerModule = ui.catalog.modules[provider.moduleId];
    const span = Number(providerModule && providerModule.depthSpanMm) || 0;
    if (!span) return false;
    // Depth grows towards the back, so a support below the provider's midpoint
    // is on the front row.
    return candidate.originWorldMm[1] - provider.originWorldMm[1] < span / 2;
  }

  /**
   * Turning a face-into-the-shelf piece means moving it to the opposite depth
   * row and flipping it, not spinning it where it stands: a top bar rotated in
   * place would point its cross bar out into the room. Falls back to an in-place
   * turn when the opposite row has nowhere to go.
   */
  function flippedToOppositeRow(instance) {
    const module = ui.catalog.modules[instance.moduleId];
    const vacated = engine.removeInstance(ui.catalog, ui.design, instance.id);
    if (!vacated) return null;
    const wasFront = instance.rotationDeg === 180;
    const options = engine.generateCandidates(ui.catalog, vacated, instance.moduleId, {
      adjacentBasesOnly: ui.mode !== "advanced"
    }).filter((candidate) =>
      // Same height and same position along the run, but the opposite depth row.
      Math.abs(candidate.supportPlaneZ - instance.supportPlaneZ) < 2
      && Math.abs(candidate.originWorldMm[0] - instance.originWorldMm[0]) < 2
      && onFrontRow(candidate) !== wasFront);
    if (!options.length) return null;
    const target = options[0];
    try {
      return engine.applyCandidate(ui.catalog, vacated, target, {
        rotationDeg: candidateRotation(module, target)
      });
    } catch (error) {
      return null;
    }
  }

  function rotateInstance(instance) {
    const module = ui.catalog.modules[instance.moduleId];
    if (module.family === "corner" && module.role === "base") {
      const rotated = cornerAtNextFace(instance);
      if (rotated) return commit(rotated, { keepSelection: true });
      setHint("That corner cannot use another face without colliding with the shelf.", true);
      return false;
    }
    if (facesIntoShelf(module) && module.role !== "lamp") {
      const flipped = flippedToOppositeRow(instance);
      if (flipped) return commit(flipped, {});
    }
    const step = rotationStepFor(instance);
    return commit(step ? engine.rotateInstance(ui.catalog, ui.design, instance.id, step) : null, {});
  }

  function cornerAtNextFace(instance) {
    const vacated = engine.removeInstance(ui.catalog, ui.design, instance.id);
    if (!vacated) return null;
    const candidates = engine.generateCandidates(ui.catalog, vacated, instance.moduleId, { adjacentBasesOnly: true });
    const placed = candidates.find((candidate) =>
      candidate.rotationDeg === instance.rotationDeg
      && Math.abs(candidate.originWorldMm[0] - instance.originWorldMm[0]) < 3
      && Math.abs(candidate.originWorldMm[1] - instance.originWorldMm[1]) < 3);
    const nextTo = instance.placement.nextTo || (placed && placed.placement.nextTo);
    const port = instance.placement.cornerPort || (placed && placed.placement.cornerPort);
    const face = instance.placement.cornerFace || (placed && placed.placement.cornerFace);
    if (!nextTo || !port || !face) return null;

    const faceOrder = ["normal", "long_positive", "long_negative"];
    const options = candidates.filter((candidate) =>
      candidate.placement.nextTo === nextTo && candidate.placement.cornerPort === port);
    for (let offset = 1; offset <= faceOrder.length; offset += 1) {
      const wanted = faceOrder[(faceOrder.indexOf(face) + offset) % faceOrder.length];
      const target = options.find((candidate) => candidate.placement.cornerFace === wanted);
      if (!target) continue;
      let next = engine.applyCandidate(ui.catalog, vacated, target, { id: instance.id });
      if (instance.finish) next = engine.setInstanceFinish(ui.catalog, next, instance.id, instance.finish);
      return next;
    }
    return null;
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
    let modules = tierModules(ui.mode);
    if (group === "shelf" && ui.mode === "standard") {
      const seen = new Set(modules.map((module) => module.id));
      Object.values(ui.catalog.modules)
        .filter((module) => module.role === "adapter")
        .forEach((module) => {
          if (!seen.has(module.id)) modules.push(module);
        });
    }
    const peers = modules.filter((module) =>
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
                next = engine.applyCandidate(ui.catalog, vacated, nearest, {
                  rotationDeg: candidateRotation(module, nearest)
                });
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

  /**
   * The colour rows for one piece: "Match the rest" first, then every finish.
   *
   * The design's own colour is offered explicitly as well as through "Match the
   * rest", and the two are not the same thing -- a piece pinned to Sage stays
   * Sage when the design moves to Marine, which is the whole point of an
   * override.
   */
  function finishOptions(instance) {
    const options = [{
      label: "Match the rest",
      note: currentFinish().displayName,
      hidePrice: true,
      selected: !instance.finish,
      onPick: () => setPieceFinish(instance.id, null)
    }];
    for (const finish of ui.catalog.finishes) {
      options.push({
        label: finish.displayName,
        hidePrice: true,
        swatch: finish.builder,
        selected: instance.finish === finish.id,
        onPick: () => setPieceFinish(instance.id, finish.id)
      });
    }
    return options;
  }

  function setPieceFinish(instanceId, finishId) {
    const next = engine.setInstanceFinish(ui.catalog, ui.design, instanceId, finishId);
    if (!next) return;
    // Keep the piece selected: picking a colour is the sort of thing people do
    // twice before settling, and losing the menu each time is a nuisance.
    commit(next, { keepSelection: true });
  }

  /**
   * Leave a piece out of the invoice, or put it back.
   *
   * The selection is kept, like a colour: the piece stays lit with its menu
   * open, so the same tap undoes the decision if the pale grey is not what was
   * wanted.
   */
  /**
   * Even out the gaps between the units in a run, each unit's stack moving with
   * it. The ends stay put, so the shelf keeps its overall size.
   */
  function normaliseSpacing() {
    const plan = engine.spacingNormalisation(ui.catalog, ui.design);
    if (!commit(engine.normaliseSpacing(ui.catalog, ui.design), {})) {
      setHint("The spacing here cannot be evened out.", true);
      return;
    }
    const moved = plan ? plan.moves.length : 0;
    setHint(`Spacing evened out: ${moved} unit${moved === 1 ? "" : "s"} moved.`);
  }

  function toggleOmitted(instance) {
    const omit = !instance.omitted;
    if (!commit(engine.setInstanceOmitted(ui.catalog, ui.design, instance.id, omit), { keepSelection: true })) return;
    const name = moduleLabel(ui.catalog.modules[instance.moduleId]);
    setHint(omit
      ? `${name} left out of the invoice. Still in the design, not in the total.`
      : `${name} is back in the invoice.`);
  }

  function swapGroup(role) {
    if (role === "base") return "base";
    if (["extension", "spacer", "hanger", "adapter"].indexOf(role) >= 0) return "shelf";
    if (role === "top_bar") return "top_bar";
    if (role === "booster") return "booster";
    return null;
  }

  // ------------------------------------------------------------------ modal --

  /*
   * One sheet, three uses: the piece picker, the yes/no confirm, and the
   * options sheet that stands in for the control column in Flexible and
   * Advanced. They share the element, the dismissal rules and the focus
   * handling, so a fourth costs a render function and nothing else.
   *
   * `live: true` means the sheet's contents depend on the design, so refresh()
   * redraws it in place. Without that, picking a colour inside the options
   * sheet repaints the model and leaves the pressed swatch showing the previous
   * choice -- the one control on the page that would not agree with itself.
   */
  function openSheet(spec) {
    ui.sheet = spec;
    dom.modalTitle.textContent = spec.title;
    clear(dom.modalBody);
    spec.render(dom.modalBody);
    dom.modal.hidden = false;
    if (spec.focus !== false) dom.modalClose.focus();
  }

  /** Redraw the open sheet after a change it made. No-op when none is open. */
  function refreshSheet() {
    if (!ui.sheet || !ui.sheet.live || dom.modal.hidden) return;
    dom.modalTitle.textContent = ui.sheet.title;
    clear(dom.modalBody);
    ui.sheet.render(dom.modalBody);
  }

  function openPicker(title, options, settings) {
    const config = settings || {};
    openSheet({
      title,
      render: (body) => {
        if (!options.length) {
          body.appendChild(make("p", "nd-list-empty", config.emptyLabel || "Nothing fits here yet."));
          return;
        }
        const chips = config.chips || [];
        if (chips.length) {
          const strip = make("div", "nd-chips");
          strip.setAttribute("aria-label", "Recently used");
          for (const chip of chips) {
            const button = make("button", "nd-chip", chip.label || moduleLabel(chip.module));
            button.type = "button";
            button.addEventListener("click", () => {
              closePicker();
              chip.onPick();
            });
            strip.appendChild(button);
          }
          body.appendChild(strip);
        }

        // Headings are not rows, and a section break is not a reason to put a
        // keyboard on the screen. Flexible never reaches this: its lists are
        // what fits at one place, and a search box there would be an admission
        // that the buyer was supposed to know a part's name.
        const rows = options.filter((option) => !option.heading).length;
        if (config.search !== false && rows > 8) {
          const search = make("input", "nd-search");
          search.type = "search";
          search.placeholder = config.searchLabel || "Search pieces";
          search.autocomplete = "off";
          search.addEventListener("input", () => renderPickerRows(options, search.value));
          body.appendChild(search);
        }
        const list = make("div", "nd-list");
        list.id = "nd-picker-list";
        body.appendChild(list);
        renderPickerRows(options, "");
      }
    });
    // Someone who opens a long list usually already knows what they want, so
    // the cursor waits in the search box. Not on touch screens, where focusing
    // it would put the keyboard over the list before they have seen it.
    const search = dom.modalBody.querySelector(".nd-search");
    if (search && window.matchMedia("(pointer: fine)").matches) search.focus();
  }

  function renderPickerRows(options, query) {
    const list = el("nd-picker-list");
    if (!list) return;
    clear(list);
    const needle = String(query || "").trim().toLowerCase();
    // Rows are not always modules -- the colour sheet uses the same list -- so
    // everything about the module is optional from here down.
    const matches = options.filter((option) => {
      if (option.heading) return !needle; // a filtered list is one flat list
      if (option.foot) return true; // the row that reveals more rows always shows
      if (!needle) return true;
      const module = option.module;
      const haystack = module
        ? `${module.id} ${option.label || moduleLabel(module)} ${module.family || ""} ${module.role}`
        : String(option.label || "");
      return haystack.toLowerCase().indexOf(needle) >= 0;
    });
    if (!matches.some((option) => !option.heading)) {
      list.appendChild(make("p", "nd-list-empty", "Nothing matches."));
      return;
    }
    for (const option of matches) {
      // A heading separates two kinds of answer to one question -- carrying on
      // along a run, or turning off it -- without making them two markers.
      if (option.heading) {
        list.appendChild(make("h3", "nd-list-heading", option.heading));
        continue;
      }
      const row = make("button", "nd-list-row");
      row.type = "button";
      if (option.selected) row.setAttribute("aria-pressed", "true");
      if (option.swatch) {
        const chip = make("span", "nd-swatch-chip");
        const steel = make("span");
        steel.style.background = option.swatch.steel;
        const surface = make("span");
        surface.style.background = option.swatch.surface;
        chip.appendChild(steel);
        chip.appendChild(surface);
        row.appendChild(chip);
      }
      row.appendChild(make("b", null, option.label || moduleLabel(option.module)));
      if (option.note) row.appendChild(make("small", "nd-list-note", option.note));
      // A row is usually a module, but not always: the bookend is an accessory
      // and carries its price directly.
      const price = option.module ? option.module.priceKsh : option.price;
      if (!option.hidePrice && (option.module || option.price != null)) {
        row.appendChild(make("small", null, price != null ? formatKsh(price) : "on request"));
      }
      row.addEventListener("click", () => {
        closePicker();
        option.onPick();
      });
      list.appendChild(row);
    }
  }

  /**
   * A yes/no dialog in the same sheet the piece picker uses. Deliberately not
   * window.confirm(): that blocks the WebGL loop and, on Android, renders as a
   * browser-chrome alert with the page's own name in it.
   */
  function openConfirm(options) {
    let settled = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      closePicker();
      if (handler) handler();
    };
    openSheet({
      title: options.title,
      focus: false,
      render: (body) => {
        body.appendChild(make("p", "nd-note", options.body));
        const row = make("div", "nd-button-row nd-confirm-row");
        const cancel = make("button", "nd-button", options.cancelLabel || "Cancel");
        cancel.type = "button";
        const confirm = make("button", "nd-button is-primary", options.confirmLabel || "Continue");
        confirm.type = "button";
        cancel.addEventListener("click", () => finish(options.onCancel));
        confirm.addEventListener("click", () => finish(options.onConfirm));
        row.appendChild(cancel);
        row.appendChild(confirm);
        body.appendChild(row);
        confirm.focus();
      }
    });
    // Dismissing by backdrop, close button or Escape all mean "no".
    ui.onModalDismiss = () => finish(options.onCancel);
  }

  function closePicker() {
    dom.modal.hidden = true;
    clear(dom.modalBody);
    ui.sheet = null;
    const dismiss = ui.onModalDismiss;
    ui.onModalDismiss = null;
    if (dismiss) dismiss();
  }

  // ---------------------------------------------------------------- pricing --

  /**
   * What the design costs, and what it is made of.
   *
   * `lines` is what is being charged for. Pieces marked "omit from invoice" --
   * the ones a client already owns and is adding to -- are counted separately
   * in `omitted` and never reach the total. They are still part of the design
   * and still drawn, so every reader of this (the summary, the breakdown, the
   * share image, the WhatsApp order) says so in its own words rather than
   * quietly dropping them.
   */
  function priceBreakdown() {
    const counts = new Map();
    const omittedCounts = new Map();
    for (const instance of ui.design.instances) {
      const bucket = instance.omitted ? omittedCounts : counts;
      bucket.set(instance.moduleId, (bucket.get(instance.moduleId) || 0) + 1);
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
    const omitted = Array.from(omittedCounts.keys()).sort().map((id) => ({
      label: moduleLabel(ui.catalog.modules[id]),
      quantity: omittedCounts.get(id)
    }));
    const omittedCount = omitted.reduce((sum, line) => sum + line.quantity, 0);
    return { lines, total, unpriced, omitted, omittedCount };
  }

  /** "2 pieces not charged", or null when everything on screen is being sold. */
  function omittedNote(count) {
    if (!count) return null;
    return `${count} piece${count === 1 ? "" : "s"} not charged`;
  }

  /*
   * What the faded pieces are, in one sentence, wherever they are shown.
   *
   * It names no modules and no colour. Not the modules, because a client
   * reading "2 x Compact Spacer" against a picture is being asked to find them
   * before they can read the price; the picture already says which ones. Not
   * the colour, because the shop sells a dark neutral called Charcoal, and
   * "the grey ones are free" is a sentence that can point at the wrong shelf.
   * "Faded" is a property of the drawing, which is what the reader is looking
   * at.
   */
  const REFERENCE_NOTE = "Faded modules are shown for reference only and are not included in the quote.";

  /**
   * Width x depth x height, in cm, for the shelf itself. Accessories do not
   * change the furniture envelope quoted to a customer.
   */
  function sizeLabel() {
    const footprint = shelfBounds();
    if (!footprint) return null;
    return `${mmToCm(footprint[3] - footprint[0])} × ${mmToCm(footprint[4] - footprint[1])} × ${mmToCm(heightAboveFloor(footprint))} cm`;
  }

  function heightAboveFloor(bounds) {
    return Math.max(0, bounds[5]);
  }

  /**
   * The shelf's own envelope, ignoring a lamp.
   *
   * This is the size quoted everywhere -- Simple's steppers, the summary line
   * and the dimension overlay -- so they always agree. A lamp adds 77cm of arm
   * and shade over the top, which would put "Height 149 cm" next to a button
   * that only ever adds a 30cm shelf level, and is an accessory hanging above
   * the furniture rather than part of its footprint.
   */
  function shelfBounds() {
    const shelfOnly = ui.design.instances.filter((instance) => ui.catalog.modules[instance.moduleId].role !== "lamp");
    if (!shelfOnly.length) return null;
    return engine.designBounds(ui.catalog, { instances: shelfOnly });
  }

  /**
   * "What is in it", opened from the caret beside the price it explains.
   *
   * It used to be the last field of the control column, which meant it existed
   * in Simple and Flexible, and in Advanced sat below a 47-row piece list
   * nobody scrolled past. Next to the total is where someone asks what the
   * total is made of.
   */
  function renderBreakdown() {
    const { lines, omitted } = priceBreakdown();
    const rows = lines.length + omitted.length;
    if (!rows) ui.breakdownOpen = false;
    dom.breakdownToggle.disabled = !rows;
    dom.breakdownToggle.setAttribute("aria-expanded", String(ui.breakdownOpen));
    dom.breakdown.hidden = !ui.breakdownOpen;
    clear(dom.breakdown);
    if (ui.breakdownOpen) dom.breakdown.appendChild(breakdownSection());
  }

  function updateSummary() {
    const { total, unpriced, omittedCount } = priceBreakdown();
    dom.total.textContent = formatKsh(total);
    const size = sizeLabel();
    const notes = ["VAT inclusive"];
    if (size) notes.unshift(size);
    if (unpriced) notes.push(`${unpriced} piece${unpriced === 1 ? "" : "s"} quoted separately`);
    const skipped = omittedNote(omittedCount);
    if (skipped) notes.push(skipped);
    dom.totalNote.textContent = notes.join(" · ");

    renderBreakdown();

    const empty = ui.design.instances.length === 0;
    dom.present.disabled = empty;
    dom.order.setAttribute("aria-disabled", empty ? "true" : "false");
    dom.order.href = empty ? "#" : whatsappUrl(total, { code: designCode(), sessionId: builderSessionId() });
    // The help button is never disabled: an empty shelf is one of the times
    // somebody most wants to ask.
    dom.help.href = helpUrl(total, { code: empty ? null : designCode(), sessionId: builderSessionId() });
  }

  /*
   * The first line, and the only thing that differs between the two handovers.
   * Everything under it is the same account of the shelf, because somebody
   * asking for help wants us looking at exactly what they are looking at.
   */
  const ORDER_OPENER = "Hi Framework! I designed a shelf and would like to order it.";
  const HELP_OPENER = "Hi Framework! I'm working on this design and could use some help.";

  function whatsappUrl(total, options) {
    const code = options && options.code;
    const sessionId = options && options.sessionId;
    const { lines } = priceBreakdown();
    const parts = lines.map((line) => `${line.quantity} x ${line.label}`);
    const size = sizeLabel();
    const message = [
      (options && options.opener) || ORDER_OPENER,
      "",
      `Builder: ${MODE_LABELS[ui.mode] || ui.mode}`,
      code ? `Design code: ${code}` : null,
      sessionId ? `Session: ${sessionId}` : null,
      `Pieces: ${parts.join(", ")}`,
      // The picture shows the blanked-out pieces, so the message has to account
      // for them; leaving them out of both lists would look like an order that
      // had lost half the shelf.
      omittedOrderLine(),
      `Colour: ${currentFinish().displayName}`,
      // An order that quietly dropped the pieces painted differently would be
      // built in the wrong colours, so they are spelled out piece by piece.
      exceptionColourLine(),
      size ? `Size: ${size} (width x depth x height)` : null,
      `Total: ${formatKsh(total)}`,
      "",
      `My design: ${code ? designLink(code) : shareUrl()}`
      // Only drop the size and colour-exception lines when there is nothing to
      // say; the empty strings above are deliberate blank lines in the message.
    ].filter((line) => line !== null).join("\n");
    return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
  }

  /**
   * The help link. The order message with a different opener, or, on a shelf
   * with nothing on it yet, the opener and one honest line: the button is in
   * the header from the first second and has to work there too.
   */
  function helpUrl(total, options) {
    if (!ui.design.instances.length) {
      return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(
        [HELP_OPENER, "", "I have not placed anything yet."].join("\n")
      )}`;
    }
    return whatsappUrl(total, Object.assign({ opener: HELP_OPENER }, options || {}));
  }

  /**
   * The one line about the faded pieces, or null when there are none.
   *
   * A count, not a list: the pieces being ordered are the line above, and
   * naming the others invites them onto the invoice by mistake. The image that
   * travels with this message is where they can be seen.
   */
  function omittedOrderLine() {
    const { omittedCount } = priceBreakdown();
    if (!omittedCount) return null;
    return `(${omittedCount} more piece${omittedCount === 1 ? " is" : "s are"} in the picture for reference only, not in this quote)`;
  }

  /** "Except: 2 x Standard Extension in Marine", or null when nothing differs. */
  function exceptionColourLine() {
    const counts = new Map();
    for (const instance of ui.design.instances) {
      if (!instance.finish || instance.finish === ui.design.finish) continue;
      const key = `${instance.moduleId}|${instance.finish}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (!counts.size) return null;
    const parts = Array.from(counts.keys()).sort().map((key) => {
      const [moduleId, finishId] = key.split("|");
      return `${counts.get(key)} x ${moduleLabel(ui.catalog.modules[moduleId])} in ${finishById(finishId).displayName}`;
    });
    return `Except: ${parts.join(", ")}`;
  }

  // ------------------------------------------------------------- present --

  /*
   * The share image. Composed by present.js; this side gathers what it says and
   * takes the snapshot.
   *
   * Shown on screen rather than downloaded: on a phone a long-press on an <img>
   * offers "copy image" and "save", which is what actually gets a design into a
   * WhatsApp conversation. A download would land in Files and need finding again.
   */
  const PRESENT_LOGO_SRC = "/images/global/fwk-icon.png";
  // The image is a 1080-wide canvas that gets looked at phone-sized, so the whole
  // dimension overlay is drawn larger there than in the viewport, where it sits
  // at arm's length on a stage of about the same width. One factor for all of
  // it -- offsets, arrows and numbers together -- because scaling the offsets
  // alone left the numbers sitting on top of their own tick marks. The padding
  // is what keeps the height callout, which reaches highest, inside the art box
  // rather than clipped by its top edge.
  const PRESENT_DIMENSION_SCALE = 2;
  const PRESENT_DIMENSION_PADDING = 1.5;
  let presentLogo = null;

  function loadPresentLogo() {
    if (presentLogo) return Promise.resolve(presentLogo);
    return new Promise((resolve) => {
      const image = new Image();
      // Same-origin, so this does not taint the canvas.
      image.onload = () => {
        presentLogo = image;
        resolve(image);
      };
      image.onerror = () => resolve(null); // the image is fine without the mark
      image.src = PRESENT_LOGO_SRC;
    });
  }

  /**
   * A short, stable reference for a design.
   *
   * Derived from the design itself, so the same shelf always gets the same code
   * and two shares of one design are recognisably the same. It goes on the image
   * small and grey: it is not clickable in a chat, it is there so that when we
   * look back through a conversation we can tell which designs a client saw.
   */
  /**
   * The design's code. A hash of the design itself, except for a design opened
   * from its link and left as it was, which keeps the code it was opened under.
   *
   * Reopening drops placement details the hash covers, so an untouched design
   * used to come back under a new code: Jessica Horn's chat had 24P1KB2 and her
   * invoice 48HNPRK for one shelf, and the page's own WhatsApp message said
   * 48HNPRK too. One code per shelf on screen keeps the link in the chat, the
   * message and the invoice the same.
   */
  function designCode() {
    const opened = ui.openedDesign;
    if (opened && opened.shelf === shelfOf(encodeDesign())) return opened.code;
    return engine.designCode(ui.design);
  }

  function presentContent() {
    const breakdown = priceBreakdown();
    return {
      sizeLabel: sizeLabel(),
      // Every colour on the shelf, not just the design's: with a piece painted
      // differently, naming one of them would be a half-truth about a picture
      // the client can see.
      finishName: finishLabel(),
      totalLabel: formatKsh(breakdown.total),
      totalNote: [
        "VAT inclusive",
        breakdown.unpriced
          ? `${breakdown.unpriced} piece${breakdown.unpriced === 1 ? "" : "s"} quoted separately`
          : null,
        omittedNote(breakdown.omittedCount)
      ].filter(Boolean).join(" · "),
      lines: breakdown.lines.map((line) => ({
        label: line.label,
        quantity: line.quantity,
        // The unit price: the list runs in two columns for a long design, where
        // there is no room for a line total as well, and the unit price is the
        // one a client asks about.
        amount: line.amount == null ? null : formatKsh(line.amount / line.quantity)
      })),
      // One small line under the list instead of rows of its own: the faded
      // pieces are visible in the picture directly above it.
      referenceNote: breakdown.omittedCount ? REFERENCE_NOTE : null,
      code: designCode(),
      codeHome: `${DESIGN_LINK_HOME}/`
    };
  }

  function openPresent() {
    if (!ui.design.instances.length) return;
    dom.present.disabled = true;

    // The image prints framework.co.ke/builder/<code>, so the design has to
    // exist under that code by the time anyone types it in. Saving here rather
    // than only behind Advanced's "Create link" is what keeps that address from
    // being one that 404s. It runs alongside the composition: the picture is
    // worth having even if the save does not land.
    saveDesign()
      .then((code) => { ui.savedCode = code; })
      .catch((error) => console.warn("could not save the design behind the image:", error.message));

    loadPresentLogo().then((logo) => {
      try {
        const composer = window.FrameworkDesignerPresent;
        const withDimensions = ui.dimensionsOn && !isPerspective();
        // Snapshot at the art box's own aspect, at 2x for a crisp downscale.
        // Dimensions hang outside the model, so they need the shelf pulled in
        // further -- the same trade the viewport makes while they are showing.
        const snapshot = ui.renderer.snapshot({
          width: composer.WIDTH * 2,
          height: composer.ART_HEIGHT * 2,
          boundsMm: engine.designBounds(ui.catalog, ui.design),
          padding: withDimensions ? PRESENT_DIMENSION_PADDING : 1.14
        });
        const content = presentContent();
        // The overlay follows the viewport's toggle. It is drawn, not
        // photographed: the live one is SVG over the canvas, and the snapshot is
        // the WebGL layer alone. Projecting through the snapshot's own camera and
        // then through the art box's placement gives the composer coordinates in
        // the finished image, so it never has to know about either.
        if (withDimensions) {
          const art = composer.artTransform(snapshot);
          content.dimensions = dimensionGeometry(
            (pointMm) => {
              const point = snapshot.project(pointMm);
              return { x: point.x * art.scale + art.offsetX, y: point.y * art.scale + art.offsetY };
            },
            PRESENT_DIMENSION_SCALE
          );
        }
        const canvas = composer.compose(snapshot, content, logo);
        dom.presentImage.src = canvas.toDataURL("image/png");
        // The same code the image prints, offered as text: it is what the render
        // console is opened with, and reading seven characters off a picture and
        // retyping them is the one bit of manual transcription in the chain.
        showPresentCode(content.code);
        dom.presentModal.hidden = false;
        track("designer_present", { mode: ui.mode, view: ui.renderer.getViewMode() });
      } catch (error) {
        console.error(error);
        setHint("The image could not be created. Try again.", true);
      } finally {
        dom.present.disabled = false;
      }
    });
  }

  /**
   * The design code beneath the share image, with a Copy button.
   *
   * Older Android WebViews have no async clipboard, so it falls back to
   * selecting the text and letting a long-press copy what is already
   * highlighted.
   */
  function showPresentCode(code) {
    if (!dom.presentCode || !code) return;
    dom.presentCodeValue.textContent = code;
    dom.presentCode.hidden = false;
    dom.presentCodeCopy.textContent = "Copy";
    dom.presentCodeCopy.onclick = () => {
      const done = () => {
        dom.presentCodeCopy.textContent = "Copied";
        window.setTimeout(() => { dom.presentCodeCopy.textContent = "Copy"; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, () => {
          setHint("Copying was blocked. The code is on the image too.", true);
        });
      } else {
        const range = document.createRange();
        range.selectNodeContents(dom.presentCodeValue);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        done();
      }
    };
  }

  function closePresent() {
    dom.presentModal.hidden = true;
    dom.presentImage.removeAttribute("src");
    if (dom.presentCode) dom.presentCode.hidden = true;
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
    // Colours of individual pieces, in their own table. Almost every design has
    // none, and a row only carries an index when it has one, so the common case
    // encodes to exactly what it did before per-piece colour existed.
    const tints = [];
    const tintIndex = new Map();
    ui.design.instances.forEach((instance, index) => idIndex.set(instance.id, index));

    // Which rows are left out of the invoice, by index. A list rather than a
    // field on the row, so the row format is exactly what it was.
    const omitted = [];

    const rows = ui.design.instances.map((instance, index) => {
      if (instance.omitted) omitted.push(index);
      if (!typeIndex.has(instance.moduleId)) {
        typeIndex.set(instance.moduleId, types.length);
        types.push(instance.moduleId);
      }
      const on = instance.placement && instance.placement.on;
      const supports = on ? (Array.isArray(on) ? on : [on]) : [];
      const row = [
        typeIndex.get(instance.moduleId),
        Math.round(instance.originWorldMm[0]),
        Math.round(instance.originWorldMm[1]),
        instance.rotationDeg || 0,
        instance.placement && instance.placement.method === "socket" ? 1 : 0,
        supports.map((id) => idIndex.get(id)).filter((index) => index != null)
      ];
      if (instance.finish) {
        if (!tintIndex.has(instance.finish)) {
          tintIndex.set(instance.finish, tints.length);
          tints.push(instance.finish);
        }
        // One-based, so a present-but-zero index cannot be mistaken for absent.
        row.push(tintIndex.get(instance.finish) + 1);
      }
      return row;
    });
    const payload = [1, ui.mode, ui.design.finish, ui.design.bookends || 0, types, rows];
    // Appended, like the colour table and for the same reason: a link written
    // before this existed opens here, and one written with it opens in an older
    // deployment too -- there, every piece is simply charged for. The colour
    // table goes in even when it is empty, to hold this one's place.
    if (tints.length || omitted.length) payload.push(tints);
    if (omitted.length) payload.push(omitted);
    return toBase64Url(JSON.stringify(payload));
  }

  /**
   * Still schema 1. The colour table is appended rather than versioned in: a
   * link written before it existed decodes here unchanged, and a link written
   * with it decodes in the deployed version too, just without the colours. A
   * design link that half-works beats one that refuses to open.
   */
  function decodeDesign(encoded) {
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!Array.isArray(payload) || payload[0] !== 1) throw new Error("unsupported design link");
    const [, mode, finish, bookends, types, rows] = payload;
    const tints = payload[6] || [];
    const omitted = new Set(payload[7] || []);
    const instances = rows.map((row, index) => ({
      id: `item_${String(index + 1).padStart(3, "0")}`,
      type: types[row[0]],
      originWorldMm: [row[1], row[2], 0],
      rotationDeg: row[3] || 0,
      placement: row[4]
        ? { method: "socket", on: (row[5] || []).map((support) => `item_${String(support + 1).padStart(3, "0")}`) }
        : { method: "floor" },
      finish: row[6] ? (tints[row[6] - 1] || null) : null,
      omitted: omitted.has(index)
    }));
    const design = engine.repairCornerGeometry(
      ui.catalog,
      engine.deserializeState(ui.catalog, { schemaVersion: 1, finish, bookends, instances })
    );
    const validation = engine.validateState(ui.catalog, design);
    if (validation.reasons.includes("invalid_base_connections")) {
      throw new Error("design contains an invalid corner connection");
    }
    return {
      mode: MODES.indexOf(mode) >= 0 ? mode : "simple",
      design
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

  // ---------------------------------------------------------- saved designs --

  /*
   * A design saved server-side under its own code, so that
   * framework.co.ke/builder/7J3MKXP -- the address printed on every share
   * image -- opens the shelf it names. The full URL hash still carries a design
   * on its own and needs nothing stored; this is for the short form, which is
   * the one that survives being read off a picture.
   *
   * The code comes from designCode(): a hash of the design itself, so saving the
   * same shelf twice is the same record rather than two.
   */
  const SAVED_CODE_RE = /^\/builder\/([0-9A-Za-z]{7})\/?$/;

  function savedCodeInPath() {
    const match = SAVED_CODE_RE.exec(location.pathname);
    return match ? match[1].toUpperCase() : null;
  }

  function designLink(code) {
    return `https://${DESIGN_LINK_HOME}/${code}`;
  }

  /** Where the design came from, for the record. No PII: the page has none. */
  function arrivalDetails() {
    const params = new URLSearchParams(location.search);
    const ad = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ad_id", "fbclid", "gclid"]) {
      const value = params.get(key);
      if (value) ad[key] = value;
    }
    const sessionId = builderSessionId();
    return {
      session_id: sessionId,
      referrer: document.referrer || null,
      ad,
      language: navigator.language || null,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    };
  }

  function saveDesign() {
    const breakdown = priceBreakdown();
    return fetch(DESIGN_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({
        // An unchanged design opened from its link saves under that code, which
        // the server already holds and treats as a repeat.
        code: designCode(),
        hash: encodeDesign(),
        design: engine.serializeState(ui.design),
        mode: ui.mode,
        finish: ui.design.finish,
        pieces: ui.design.instances.length,
        total_ksh: breakdown.total
      }, arrivalDetails()))
    }).then((response) => response.json().then((body) => {
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body.code;
    }));
  }

  /**
   * The shelf in an encoded design, without the mode it is being viewed in. A
   * rep who opens a client's Simple design in Advanced has not changed it.
   */
  function shelfOf(encoded) {
    try {
      const payload = JSON.parse(fromBase64Url(encoded));
      payload.splice(1, 1);
      return JSON.stringify(payload);
    } catch (error) {
      return encoded;
    }
  }

  function loadSavedDesign(code, options) {
    const settings = options || {};
    setBusyMessage(`Opening design ${code}...`);
    setBusy(true);
    fetch(`${DESIGN_API}?code=${encodeURIComponent(code)}`)
      .then((response) => response.json().then((body) => {
        if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      }))
      .catch(() => fetch(`/data/builder-designs/${encodeURIComponent(code)}.json`)
        .then((response) => response.json().then((body) => {
          if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
          return body;
        })))
      .then((body) => {
        // The hash is the form the page reads natively; the serialised design is
        // the fallback for a record written before the hash was stored.
        const restored = body.hash
          ? Object.assign(decodeDesign(body.hash), {})
          : {
            mode: body.mode || "simple",
            design: engine.repairCornerGeometry(
              ui.catalog,
              engine.deserializeState(ui.catalog, body.design)
            )
          };
        ui.mode = MODES.indexOf(restored.mode) >= 0 ? restored.mode : ui.mode;
        ui.design = restored.design;
        ui.simple = deriveSimpleSpec(ui.design);
        ui.history.length = 0;
        ui.future.length = 0;
        updateHistoryButtons();
        applyMode(ui.mode, { silent: true });
        // Before the redraw, which writes the code into the page's links.
        ui.openedDesign = { code, shelf: shelfOf(encodeDesign()) };
        refresh({ fit: true });
      })
      .catch((error) => {
        console.warn("could not open the saved design:", error.message);
        if (settings.fallbackToDefault) {
          ui.mode = "simple";
          ui.design = buildSimpleDesign(ui.simple, "sage", 0);
          applyMode(ui.mode, { silent: true });
          refresh({ fit: true });
        }
        setHint(`Design ${code} could not be opened, so we started a new shelf.`, true);
      })
      // Not plain false: refresh() may have geometry still in flight behind this.
      .then(() => {
        delete dom.app.dataset.loading;
        setBusyMessage("Loading...");
        setBusy(ui.pendingModules.size > 0);
      });
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
      swatch.setAttribute("aria-pressed", String(ui.design.finish === finish.id));
      const chip = make("span", "nd-swatch-chip");
      const steel = make("span");
      steel.style.background = finish.builder.steel;
      const mdf = make("span");
      mdf.style.background = finish.builder.surface;
      chip.appendChild(steel);
      chip.appendChild(mdf);
      swatch.appendChild(chip);
      // Named, not just coloured: two of the four read similarly at chip size,
      // and the name is what people say when they order.
      swatch.appendChild(make("span", "nd-swatch-name", finish.displayName));
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

  function bookendField(options) {
    const disabled = Boolean(options && options.disabled);
    const field = make("div", "nd-field nd-field-tight");
    field.appendChild(stepper(
      "Bookends",
      { n: ui.design.bookends || 0, text: String(ui.design.bookends || 0) },
      0,
      disabled ? 0 : 12,
      (next) => {
        if (disabled) return;
        pushHistory();
        ui.design = Object.assign({}, ui.design, { bookends: Math.max(0, next) });
        refresh({});
      }
    ));
    field.appendChild(make("small", "nd-subtext", bookendFitNote()));

    return field;
  }

  /**
   * What the stepper says under itself.
   *
   * The picture fills the shelf ends that can take a bookend, bottom up, so the
   * only thing worth saying is how the count and the ends stand. Asking for
   * more than there are ends is allowed and always was: those bookends are
   * priced and delivered like the rest, they are simply not in the picture, and
   * this is where that is said rather than by stopping the stepper.
   */
  function bookendFitNote() {
    const count = ui.design.bookends || 0;
    const ends = engine.legalBookendAnchors(ui.catalog, ui.design).length;
    if (count <= ends) return "Shown at the shelf ends that can take one";
    if (!ends) {
      return `None shown: your shelf has no ends that take a bookend. `
        + `All ${count} are priced and will be delivered.`;
    }
    return `${ends} of ${count} shown: your shelf has ${ends} end${ends === 1 ? "" : "s"} `
      + `that take${ends === 1 ? "s" : ""} a bookend. All ${count} are priced and will be delivered.`;
  }

  function breakdownSection() {
    const { lines, omitted } = priceBreakdown();
    const field = make("div", "nd-field");
    field.appendChild(make("span", "nd-label", "What is in it"));
    if (!lines.length && !omitted.length) {
      field.appendChild(make("p", "nd-note", "Nothing yet. Add a unit to get started."));
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
    // Accounted for, not itemised: the list is what is being paid for, and the
    // pieces that are not are in front of the client already.
    if (omitted.length) field.appendChild(make("small", "nd-subtext nd-omitted-note", REFERENCE_NOTE));
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
    select.addEventListener("change", () => rebuildSimple({
      family: select.value,
      trimmed: defaultSimpleTrimmed(select.value)
    }));
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
        text: bounds ? `${mmToCm(heightAboveFloor(bounds))} cm` : `${ui.simple.levels} levels`
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

    const options = make("div", "nd-option-stack");
    if (ui.catalog.modules.lamp) {
      const label = make("label", "nd-toggle");
      const input = make("input");
      input.type = "checkbox";
      input.checked = ui.simple.lamp;
      input.addEventListener("change", () => rebuildSimple({ lamp: input.checked }));
      label.appendChild(input);
      label.appendChild(make("span", null, "Add a lamp (excludes shade and bulb)"));
      options.appendChild(label);
    }
    if (hasSimpleTrimmedVariant(ui.simple.family)) {
      const row = make("div", "nd-toggle-row");
      const label = make("label", "nd-toggle");
      const input = make("input");
      input.type = "checkbox";
      input.checked = Boolean(ui.simple.trimmed);
      input.addEventListener("change", () => rebuildSimple({ trimmed: input.checked }));
      label.appendChild(input);
      label.appendChild(make("span", null, "Use trimmed units"));
      row.appendChild(label);
      if (ui.simple.trimmed) row.appendChild(make("small", "nd-inline-note", "not compatible with bookends or display bars"));
      options.appendChild(row);
    }
    if (options.children.length) body.appendChild(options);

    if (!ui.simple.trimmed) body.appendChild(bookendField());
    body.appendChild(make(
      "p",
      "nd-note",
      "Want to mix unit sizes, add hanging rails or leave gaps? Switch to Flexible or Advanced above. Your shelf comes with you."
    ));
  }

  // ------------------------------------------------------- stage actions --

  /*
   * Flexible and Advanced have no control column. Everything that column held
   * lives in one of two places instead, both of them on the model:
   *
   *   the "+" at the bottom left    what to add
   *   the sliders at bottom right   colour, bookends, starting again
   *
   * Both are rendered by the same functions Simple's column uses, so there is
   * one definition of the colour field and one of the bookend stepper, and the
   * three interfaces cannot drift apart.
   */

  /** Advanced: every piece that fits somewhere right now, as picker rows. */
  /*
   * How wide a piece is, where width is the choice being made.
   *
   * This is the part of "what does it look like" a row can answer for free, and
   * it is what separates a Standard Base from a Compact one. It is only said
   * for the pieces that span a bay: a booster is a 20mm column riser, and
   * "2 cm" beside its name reads as a mistake rather than a fact.
   */
  const SPANNING_ROLES = ["base", "extension", "adapter"];

  function widthNote(module) {
    if (SPANNING_ROLES.indexOf(module.role) < 0) return null;
    const width = module.dimensionsMm && module.dimensionsMm[0];
    return width ? `${mmToCm(width)} cm` : null;
  }

  function spotsNote(module) {
    const count = distinctSpots(ui.candidateCache.get(module.id) || []).length;
    return count ? `${count} spot${count === 1 ? "" : "s"}` : null;
  }

  function pieceRow(module) {
    return {
      module,
      note: [widthNote(module), spotsNote(module)].filter(Boolean).join(" · "),
      onPick: () => chooseModule(module.id)
    };
  }

  /**
   * The pieces that fit, with the shortened cuts kept out of the way.
   *
   * Sixteen modules in the catalogue are a shortened cut of another and carry
   * its `canonicalId` and its price; the only thing that differs is the width.
   * Listed flat they doubled half the families -- "Wide Base" immediately above
   * "Wide Base (Trimmed)" at the same price -- and took the sheet to two dozen
   * rows on the default design.
   *
   * They are hidden behind one row at the foot of the list rather than folded
   * into a length sub-choice, because folding put a second tap in front of the
   * cut almost everybody wants in order to shorten a list they were scrolling
   * once. This way the common case stays one tap, the list is a third shorter,
   * and the trade user who wants the short cut pays one tap per sheet.
   *
   * A trimmed cut whose full unit does not fit is never hidden: for some
   * families the short cut is the product the shop sells, and hiding it would
   * hide a piece with nothing standing in for it.
   */
  function addPieceOptions() {
    const offered = tierModules(ui.mode)
      .filter((module) => (ui.candidateCache.get(module.id) || []).length);
    const shown = new Set(offered.map((module) => module.id));
    const hidden = [];
    const rows = [];
    for (const module of offered) {
      const coveredByItsFullCut = module.trimmed
        && module.canonicalId
        && shown.has(module.canonicalId);
      if (coveredByItsFullCut && !ui.showTrimmed) {
        hidden.push(module);
        continue;
      }
      rows.push(pieceRow(module));
    }
    if (hidden.length) {
      rows.push({
        label: `Show ${hidden.length} shortened cut${hidden.length === 1 ? "" : "s"}`,
        hidePrice: true,
        foot: true,
        note: "same price, narrower",
        onPick: () => { ui.showTrimmed = true; openAddSheet(); }
      });
    } else if (ui.showTrimmed && offered.some((module) => module.trimmed)) {
      rows.push({
        label: "Hide the shortened cuts",
        hidePrice: true,
        foot: true,
        onPick: () => { ui.showTrimmed = false; openAddSheet(); }
      });
    }
    return rows;
  }

  /**
   * The pieces reached for most recently, as a row of chips above the list.
   *
   * Keeping a piece in hand across placements (see `placeCandidate`) removes
   * the repeat of the SAME part; this removes the repeat of alternating ones,
   * which is what building a run actually is -- base, shelf, base, shelf.
   * Filtered through the same test as the rows, because a chip offering a piece
   * that no longer fits would be the only dead control on the screen.
   */
  function recentOptions() {
    return ui.recentModuleIds
      .map((id) => ui.catalog.modules[id])
      .filter((module) => module && moduleAllowed(module, ui.mode)
        && (ui.candidateCache.get(module.id) || []).length)
      .map((module) => ({ module, onPick: () => chooseModule(module.id) }));
  }

  /**
   * The bookend's row in the add sheet: a piece you can buy, listed with the
   * pieces you can buy, rather than a number in a settings sheet.
   */
  function bookendRow() {
    const accessory = ui.catalog.accessories && ui.catalog.accessories.bookend;
    if (!accessory) return null;
    const count = ui.design.bookends || 0;
    return {
      label: accessory.label || "Bookend",
      note: count ? `${count} on the shelf` : null,
      price: accessory.priceKsh,
      onPick: openBookendSheet
    };
  }

  /**
   * The bookend stepper, reached from the sheet of things you can add.
   *
   * Bookends are not pieces -- the design carries a count and the engine fills
   * the ends that can take one, bottom up -- so they are not placed and there
   * is nothing on the model to point at. But they are something a buyer buys,
   * and having them only behind the options button meant the one accessory in
   * the catalogue was the one thing not listed with the rest. The control is
   * the same control, in a second place.
   */
  function openBookendSheet() {
    openSheet({
      title: "Bookends",
      live: true,
      render: (body) => body.appendChild(bookendField())
    });
  }

  function openAddSheet() {
    const bookend = bookendRow();
    // The bookend is a thing you can buy and belongs with them; the trimmed
    // toggle is about the list itself, so it stays at the foot of it.
    const pieces = addPieceOptions();
    const foot = pieces.filter((row) => row.foot);
    const options = pieces.filter((row) => !row.foot)
      .concat(bookend ? [bookend] : [])
      .concat(foot);
    openPicker("Add a piece", options, {
      chips: recentOptions(),
      emptyLabel: ui.design.instances.length
        ? "Nothing else will fit on this design."
        : "Nothing to add yet. One moment."
    });
  }

  /**
   * Choose a piece, then choose where it goes.
   *
   * The two halves of adding something are deliberately separate steps here.
   * Showing every legal spot for every piece at once is what the "+" markers
   * used to do, and in Advanced — 47 pieces, some of which fit in a dozen
   * places — that is a model you cannot see for the markers on it.
   */
  function chooseModule(moduleId) {
    ui.activeModuleId = moduleId;
    ui.placedSinceChoose = false;
    ui.selectedId = null;
    rememberModule(moduleId);
    ensureGeometry([moduleId]);
    fitToCandidates(moduleId);
    syncScene();
    buildOverlay();
  }

  /**
   * The pieces reached for most recently, newest first.
   *
   * Session-only and never serialised: a design is not the list of parts
   * somebody tried on the way to it. Kept short because the chips are one row
   * and a row that scrolls is a second list.
   */
  const RECENT_LIMIT = 3;

  function rememberModule(moduleId) {
    ui.recentModuleIds = [moduleId]
      .concat(ui.recentModuleIds.filter((id) => id !== moduleId))
      .slice(0, RECENT_LIMIT);
  }

  /** Back out of placing, without backing out of the design. */
  function cancelAdd() {
    if (!ui.activeModuleId) return;
    ui.activeModuleId = null;
    ui.placedSinceChoose = false;
    setHint(null);
    buildOverlay();
  }

  /**
   * The two floating buttons, kept in step with the interface and with whether
   * a piece is mid-placement.
   *
   * The "+" becomes the cancel for the decision it opened: one control, in one
   * place, for "I am adding something" and "no I am not". A separate cancel
   * elsewhere on the screen is a second thing to find while the first is still
   * lit up.
   */
  function updateStageActions() {
    const holding = ui.catalog.modules[ui.activeModuleId] || null;
    const placing = Boolean(holding);
    // Three states, not two. "Cancel" is the right offer while nothing has been
    // placed; once something has, the same button means "I have finished with
    // this part", and offering to cancel reads as offering to undo the piece
    // just put down.
    const done = placing && ui.placedSinceChoose;
    // The front view is for looking: it cannot project a placement marker, so
    // there is nothing for the "+" to open onto.
    dom.add.hidden = ui.mode !== "advanced" || isPerspective();
    dom.add.classList.toggle("is-cancel", placing && !done);
    dom.add.classList.toggle("is-done", done);
    const what = holding ? moduleLabel(holding) : "piece";
    dom.addLabel.textContent = done ? "Done" : placing ? "Cancel" : "Add a piece";
    const label = done
      ? `Finished placing the ${what}`
      : placing ? `Cancel adding the ${what}` : "Add a piece";
    dom.add.setAttribute("aria-label", label);
    dom.add.title = label;

    // Simple keeps these in its control column, because that column is Simple's
    // whole interface and a colour is the choice people most want to see.
    dom.customise.hidden = ui.mode === "simple";

    // Simple has the stepper in its column. Elsewhere the button is offered only
    // where it can do something the buyer will see: a shelf of trimmed units,
    // or an empty one, has no end that takes a bookend, and a button opening
    // onto "none shown" would be an offer the shelf cannot accept. A count
    // already set keeps it, so what was ordered can always be taken back off.
    dom.bookends.hidden = ui.mode === "simple"
      || (!(ui.design.bookends > 0) && !engine.legalBookendAnchors(ui.catalog, ui.design).length);
  }

  /**
   * Colour, bookends and starting again: what finishes a design rather than
   * what builds it.
   *
   * `live` because a colour picked here has to repaint the swatch that was
   * pressed as well as the model — refresh() rebuilds the control column, and
   * in these two interfaces there is no control column to rebuild.
   */
  function openCustomiseSheet() {
    openSheet({
      title: "Colour and options",
      live: true,
      render: (body) => {
        body.appendChild(finishField());
        body.appendChild(bookendField());

        const actions = make("div", "nd-button-row nd-button-row-small");
        const recoloured = ui.design.instances.filter((instance) => instance.finish).length;
        if (recoloured) {
          const label = `Reset ${recoloured} recoloured piece${recoloured === 1 ? "" : "s"}`;
          const resetColour = make("button", "nd-button is-small", label);
          resetColour.type = "button";
          resetColour.addEventListener("click", resetPieceColours);
          actions.appendChild(resetColour);
        }
        const omitted = ui.design.instances.filter((instance) => instance.omitted).length;
        if (omitted) {
          const label = `Charge for ${omitted} omitted piece${omitted === 1 ? "" : "s"} again`;
          const includeAll = make("button", "nd-button is-small", label);
          includeAll.type = "button";
          includeAll.addEventListener("click", resetOmittedPieces);
          actions.appendChild(includeAll);
        }
        /*
         * Even out the gaps in a run.
         *
         * A unit standing in the gap under a bridging span lands wherever the
         * socket grid allowed, which is hard against one side and reads as a
         * mistake rather than a decision. This is the design-wide answer to it
         * rather than a per-piece one: the fault is a property of the run, the
         * fix moves whichever units are free to move, and there is nothing to
         * hunt for. Offered only when there is something to even out -- the
         * engine decides that, and says how many sizes it would collapse.
         */
        const spacing = engine.spacingNormalisation(ui.catalog, ui.design);
        if (spacing) {
          const label = `Even out the ${spacing.gapsBefore} gap sizes`;
          const normalise = make("button", "nd-button is-small", "Normalise spacing");
          normalise.type = "button";
          normalise.title = label;
          normalise.setAttribute("aria-label", label);
          normalise.addEventListener("click", normaliseSpacing);
          actions.appendChild(normalise);
        }

        const reset = make("button", "nd-button is-small", "Start again");
        reset.type = "button";
        reset.disabled = !ui.design.instances.length;
        reset.addEventListener("click", startAgain);
        actions.appendChild(reset);
        body.appendChild(actions);

        if (ui.mode === "advanced") body.appendChild(staffField());
      }
    });
  }

  /** Put every individually recoloured piece back to the design's own colour. */
  function resetPieceColours() {
    const ids = ui.design.instances.filter((instance) => instance.finish).map((instance) => instance.id);
    if (!ids.length) return;
    // One commit, so one undo puts all of them back rather than one per piece.
    let next = ui.design;
    for (const id of ids) next = engine.setInstanceFinish(ui.catalog, next, id, null) || next;
    commit(next, {});
    setHint(`${ids.length} piece${ids.length === 1 ? "" : "s"} back to ${currentFinish().displayName}.`);
  }

  /** Put every piece that was left out of the invoice back into it. */
  function resetOmittedPieces() {
    const ids = ui.design.instances.filter((instance) => instance.omitted).map((instance) => instance.id);
    if (!ids.length) return;
    // One commit, so one undo takes all of them back out again.
    let next = ui.design;
    for (const id of ids) next = engine.setInstanceOmitted(ui.catalog, next, id, false) || next;
    commit(next, {});
    setHint(`${ids.length} piece${ids.length === 1 ? "" : "s"} back in the invoice.`);
  }

  /**
   * An empty shelf, keeping the colour and the bookend count.
   *
   * The sheet closes rather than redrawing: what someone wants to see after
   * clearing the design is the cleared design. It is a normal edit, so undo
   * brings it back — which is why it does not ask first.
   */
  function startAgain() {
    if (!ui.design.instances.length) return;
    closePicker();
    commit(
      engine.createState(ui.catalog, { finish: ui.design.finish, bookends: ui.design.bookends }),
      { fit: true }
    );
    setHint("Started again. Undo to bring it back.");
  }

  /**
   * Staff login: raise a draft invoice in Zoho from the design on screen.
   *
   * The last row of Advanced's options sheet, and everything past it behind a
   * password. Customers use Advanced too, so an order form anyone could read
   * would invite "what is that?" from everyone who does not need it. Nothing
   * about the order is rendered until the password is accepted, so there is
   * nothing to read over a shoulder either.
   *
   * The endpoint creates a DRAFT invoice, and can amend the client record it
   * bills. It cannot send, take payment, void or delete — that is what keeps a
   * shared typed password proportionate, and why there is no "send" button here
   * to reach for.
   */
  function staffField() {
    const field = make("div", "nd-field nd-staff");
    const open = make("button", "nd-button is-small is-quiet", "Staff login");
    open.type = "button";
    open.addEventListener("click", () => { closePicker(); openStaffModal(); });
    field.appendChild(open);
    return field;
  }

  let staffKey = null;      // held only for this page view; never stored.
  let staffClients = null;  // every client, fetched once with the password check

  function openStaffModal() {
    const modal = el("nd-staff-modal");
    const body = el("nd-staff-body");
    const title = el("nd-staff-title");
    const close = el("nd-staff-close");
    if (!modal || !body) return;
    const dismiss = () => { modal.hidden = true; clear(body); };
    modal.hidden = false;
    close.onclick = dismiss;
    modal.onclick = (event) => { if (event.target === modal) dismiss(); };
    if (staffKey) renderOrderForm(body, title);
    else renderPasswordStep(body, title);
  }

  /**
   * Step one. Nothing else exists on the page until this is accepted.
   *
   * The check IS the client fetch. Asking the endpoint for the client list
   * either returns it or 401s, so a correct password arrives at the form with
   * all 189 names already in the browser — one round trip rather than a probe
   * followed by a wait, and no spinner between a keystroke and a match.
   */
  function renderPasswordStep(body, title) {
    clear(body);
    title.textContent = "Staff login";
    const field = make("div", "nd-staff-form");
    const password = make("input", "nd-search");
    password.type = "password";
    password.placeholder = "Password";
    password.autocomplete = "current-password";
    const note = make("p", "nd-note");
    const go = make("button", "nd-button is-primary", "Continue");
    go.type = "button";

    const attempt = async () => {
      go.disabled = true;
      note.textContent = "Checking…";
      note.classList.remove("is-error");
      const response = await fetch("/api/zoho-push", {
        method: "POST",
        headers: { "content-type": "application/json", "x-framework-key": password.value },
        body: JSON.stringify({ action: "clients" })
      }).catch(() => null);
      const payload = response ? await response.json().catch(() => null) : null;
      go.disabled = false;
      if (!response || response.status === 401) {
        note.textContent = "That password was not accepted.";
        note.classList.add("is-error");
        return;
      }
      if (!payload || !payload.ok) {
        note.textContent = "The client list could not be loaded. Check your connection and try again.";
        note.classList.add("is-error");
        return;
      }
      staffKey = password.value;
      staffClients = payload.results || [];
      renderOrderForm(body, title);
    };
    go.addEventListener("click", attempt);
    password.addEventListener("keydown", (event) => { if (event.key === "Enter") attempt(); });

    field.appendChild(password);
    field.appendChild(go);
    field.appendChild(note);
    body.appendChild(field);
    password.focus();
  }

  // -------------------------------------------------------- the order form --

  /** A labelled row. `open` rows lift above the ones under them; see below. */
  function staffRow(text, control) {
    const row = make("label", "nd-staff-row");
    row.appendChild(make("span", "nd-staff-label", text));
    row.appendChild(control);
    return row;
  }

  function staffInput(type, placeholder) {
    const field = make("input", "nd-search");
    field.type = type;
    if (placeholder) field.placeholder = placeholder;
    field.autocomplete = "off";
    // Anything the rep types is theirs: a client chosen afterwards must not
    // overwrite a number they have already corrected by hand.
    field.addEventListener("input", () => { field.dataset.touched = "1"; });
    return field;
  }

  /**
   * A field, with room under it for what the other record says.
   *
   * Phone and address exist in two live places — the Zoho contact and Airtable's
   * Base - Clients — and both are written on save. Where they already disagree
   * there is no way to tell from here which is current, and no rule that could:
   * both are real numbers somebody wrote down. The person who just spoke to the
   * client can tell, so the form shows them the other one and gets out of the
   * way.
   */
  function flaggable(field) {
    const stack = make("div", "nd-staff-stack");
    const flag = make("div", "nd-staff-flag");
    flag.hidden = true;
    stack.appendChild(field);
    stack.appendChild(flag);
    stack.field = field;
    // `source` is which record the other value came from. Phone and address
    // prefill from Zoho, so the value worth showing is Airtable's; the KRA PIN
    // prefills from Airtable, so it is the other way round. Naming the record
    // is the whole point — "the other one says" is not a thing anybody can act
    // on.
    stack.disagree = (other, source) => {
      clear(flag);
      if (!other) {
        flag.hidden = true;
        return;
      }
      flag.appendChild(make("span", null, `${source || "Airtable"} has ${other} — the box wins on save.`));
      const use = make("button", "nd-button is-small", "Use it");
      use.type = "button";
      use.addEventListener("click", () => {
        field.value = other;
        field.dataset.touched = "1";
        flag.hidden = true;
      });
      flag.appendChild(use);
      flag.hidden = false;
    };
    return stack;
  }

  /**
   * Tentative / Confirmed / neither.
   *
   * Buttons rather than radios because "neither" is a real answer and the
   * common one — most delivery dates are agreed after the invoice is raised —
   * and a radio group has no way back to empty once one is chosen. Pressing the
   * selected half again clears it.
   */
  function statusToggle(state, key, isReady) {
    const row = make("div", "nd-segmented");
    const paint = () => {
      row.classList.toggle("is-idle", !isReady());
      Array.prototype.forEach.call(row.children, (button) => {
        button.setAttribute("aria-pressed", String(state[key] === button.textContent));
      });
    };
    for (const value of ["Tentative", "Confirmed"]) {
      const button = make("button", null, value);
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        state[key] = state[key] === value ? "" : value;
        paint();
      });
      row.appendChild(button);
    }
    row.paint = paint;
    paint();
    return row;
  }

  /**
   * The client picker: a text box over a list that is already in the browser.
   *
   * Three things it has to do that the old one did not. It has to answer while
   * you type, so the whole list is fetched once and filtered in an array rather
   * than asked for on every keystroke. Its results have to OVERLAY the form
   * rather than push it apart, so they are absolutely positioned — the old rows
   * were laid out between the field and the next one, which moved everything
   * below them and, far enough down the form, opened off the bottom of the
   * screen. And it has to offer "+ New client" always, not only when nothing
   * matches: a client whose name is spelled differently in Zoho is exactly the
   * case where the list is not empty and still not right.
   */
  function clientCombo(onChoose, onNewClient) {
    const wrap = make("div", "nd-combo");
    const input = make("input", "nd-search");
    input.type = "text";
    input.placeholder = "Type a client's name";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "nd-client-list");

    const list = make("div", "nd-combo-list");
    list.id = "nd-client-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;

    // Enough rows that scrolling is worth doing and few enough that building
    // them on every keystroke stays imperceptible. With an empty box this is
    // the alphabetical head of the list, which is a fine place to start.
    const MAX_ROWS = 60;
    let active = -1;
    let rows = [];

    const matching = () => {
      const needle = input.value.trim().toLowerCase();
      if (!needle) return (staffClients || []).slice(0, MAX_ROWS);
      // A match at the start of the name outranks one in the middle, so typing
      // "ann" puts Ann Mwangi above Joanne Karanja.
      const starts = [];
      const contains = [];
      for (const entry of staffClients || []) {
        const at = entry.name.toLowerCase().indexOf(needle);
        if (at === 0) starts.push(entry);
        else if (at > 0) contains.push(entry);
      }
      return starts.concat(contains).slice(0, MAX_ROWS);
    };

    /** The name with the typed run marked, so a long list explains itself. */
    const nameNode = (name) => {
      const needle = input.value.trim().toLowerCase();
      const at = needle ? name.toLowerCase().indexOf(needle) : -1;
      const node = make("b");
      if (at < 0) {
        node.textContent = name;
        return node;
      }
      node.appendChild(document.createTextNode(name.slice(0, at)));
      node.appendChild(make("mark", null, name.slice(at, at + needle.length)));
      node.appendChild(document.createTextNode(name.slice(at + needle.length)));
      return node;
    };

    const paintActive = () => {
      rows.forEach((row, index) => {
        const on = index === active;
        row.classList.toggle("is-active", on);
        row.setAttribute("aria-selected", String(on));
        if (on) row.scrollIntoView({ block: "nearest" });
      });
    };

    const render = () => {
      clear(list);
      rows = [];
      const found = matching();
      if (!found.length) {
        list.appendChild(make("p", "nd-combo-empty", (staffClients || []).length
          ? "No client of that name is linked to Zoho."
          : "No clients loaded."));
      }
      for (const entry of found) {
        const row = make("button", "nd-combo-option");
        row.type = "button";
        row.setAttribute("role", "option");
        row.appendChild(nameNode(entry.name));
        row.addEventListener("click", () => { close(); onChoose(entry); });
        list.appendChild(row);
        rows.push(row);
      }
      const fresh = make("button", "nd-combo-option nd-combo-new", "+ New client");
      fresh.type = "button";
      fresh.setAttribute("role", "option");
      fresh.addEventListener("click", () => { close(); onNewClient(input.value.trim()); });
      list.appendChild(fresh);
      rows.push(fresh);
      active = -1;
      paintActive();
    };

    const open = () => {
      render();
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      // Only the row that is open lifts above its neighbours, so the dropdown
      // is never underneath the field below it.
      if (wrap.parentElement) wrap.parentElement.classList.add("is-open");
    };
    const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      if (wrap.parentElement) wrap.parentElement.classList.remove("is-open");
    };

    input.addEventListener("focus", open);
    input.addEventListener("input", () => { if (list.hidden) open(); else render(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (list.hidden) return open();
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        return paintActive();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!list.hidden && active >= 0) rows[active].click();
        return;
      }
      // Escape closes the list, not the form. Anything else would make a
      // mistyped name cost the eleven fields already filled in.
      if (event.key === "Escape" && !list.hidden) {
        event.stopPropagation();
        close();
      }
    });
    // A blur that lands on one of the options is the option being clicked.
    input.addEventListener("blur", () => window.setTimeout(() => {
      if (!wrap.contains(document.activeElement)) close();
    }, 120));

    wrap.appendChild(input);
    wrap.appendChild(list);
    wrap.focusInput = () => input.focus();
    return wrap;
  }

  /**
   * Step two: the details that are always typed anyway.
   *
   * Delivery address, phone and the delivery window all live on the Zoho
   * invoice as custom fields, and someone fills them in by hand today. Asking
   * here means the rep types them once, next to the design they belong to,
   * rather than opening the invoice afterwards to complete it.
   */
  function renderOrderForm(body, title) {
    clear(body);
    title.textContent = "Raise a draft invoice";
    const form = make("div", "nd-staff-form");
    const note = make("p", "nd-note");
    const say = (text, bad) => {
      note.textContent = text;
      note.classList.toggle("is-error", Boolean(bad));
    };

    // What is being invoiced, said once at the top. The code is a hash of the
    // design itself, so it is known before anything is saved and it is the same
    // code the invoice will carry.
    const { total } = priceBreakdown();
    const pieces = ui.design.instances.length;
    form.appendChild(make("p", "nd-note", [
      `${pieces} piece${pieces === 1 ? "" : "s"}`,
      formatKsh(total),
      finishLabel(),
      `code ${designCode()}`
    ].join(" · ")));

    const rep = make("select", "nd-search");
    for (const name of ["", "Ben", "Elvis"]) {
      const option = make("option", null, name || "Who is raising this?");
      option.value = name;
      rep.appendChild(option);
    }

    const phone = staffInput("tel", "07…");
    const address = make("textarea", "nd-search nd-staff-address");
    address.rows = 2;
    address.placeholder = "Where it is going";
    address.addEventListener("input", () => { address.dataset.touched = "1"; });
    const phoneField = flaggable(phone);
    const addressField = flaggable(address);

    // The KRA PIN, for the clients who need their own registration on the
    // invoice. Optional, and blank for most people: an individual buying a
    // shelf is not asking to reclaim VAT on it. Typing one says "invoice this
    // client in their registered name", and it is written to both live records
    // exactly as the phone and the address are.
    const pin = staffInput("text", "e.g. P051234567X");
    pin.autocapitalize = "characters";
    pin.spellcheck = false;
    const pinField = flaggable(pin);
    // Said under the box rather than in the label: the label column is one line
    // wide, and this is the sentence that stops somebody typing our own PIN in.
    const pinStack = make("div", "nd-staff-stack");
    pinStack.appendChild(pinField);
    pinStack.appendChild(make("small", "nd-subtext", "The client's own PIN, only if they need it on the invoice"));

    // Airtable's flag decides who is exempt; the form never can. It appears only
    // for a client already ticked in Base - Clients, on by default, so the rep
    // can decline it for one invoice and cannot grant it to anybody. The server
    // re-reads the flag rather than trusting this box.
    const exemptBox = make("input", null);
    exemptBox.type = "checkbox";
    const exemptStack = make("div", "nd-staff-stack");
    exemptStack.appendChild(exemptBox);
    exemptStack.appendChild(make("small", "nd-subtext",
      "Marked exempt in Airtable. Every line, delivery included, is raised at the price less 16% VAT. Untick to charge VAT on this invoice."));
    const exempt = staffRow("VAT exempt", exemptStack);
    exempt.hidden = true;

    const firstName = staffInput("text", "First name");
    const lastName = staffInput("text", "Last name");
    // Zoho keeps a contact's name in two parts and refuses a duplicate display
    // name, so the split is not cosmetic — it is what the record is stored as.
    const newGroup = make("div", "nd-staff-group");
    newGroup.appendChild(make("span", "nd-label", "New client"));
    newGroup.appendChild(staffRow("First name", firstName));
    newGroup.appendChild(staffRow("Last name", lastName));
    const backToList = make("button", "nd-button is-small is-quiet", "Choose an existing client instead");
    backToList.type = "button";
    newGroup.appendChild(backToList);
    newGroup.hidden = true;

    let chosen = null;
    let creating = false;

    const clientRow = make("div", "nd-staff-row");
    clientRow.appendChild(make("span", "nd-staff-label", "Client"));
    const combo = clientCombo(
      (entry) => selectClient(entry),
      (typed) => startNewClient(typed)
    );
    clientRow.appendChild(combo);

    /** Prefill only what the rep has not already typed over. */
    const prefill = (field, value) => {
      if (field.dataset.touched === "1") return false;
      field.value = value || "";
      return Boolean(value);
    };

    const showChosen = () => {
      clear(clientRow);
      clientRow.appendChild(make("span", "nd-staff-label", "Client"));
      const box = make("div", "nd-combo-chosen");
      box.appendChild(make("b", null, chosen.name));
      const clear_ = make("button", "nd-combo-clear", "×");
      clear_.type = "button";
      clear_.setAttribute("aria-label", `Choose someone other than ${chosen.name}`);
      clear_.addEventListener("click", resetClient);
      box.appendChild(clear_);
      clientRow.appendChild(box);
    };

    const showCombo = () => {
      clear(clientRow);
      clientRow.appendChild(make("span", "nd-staff-label", "Client"));
      clientRow.appendChild(combo);
    };

    function resetClient() {
      chosen = null;
      creating = false;
      newGroup.hidden = true;
      // Forget that anything was typed, as well as what.
      //
      // These details belong to a person, and this is the button that says "not
      // that person". Without the reset, a number the rep typed -- or adopted
      // from the flag below the box -- would survive into the next client and
      // be invoiced against them, because prefill deliberately never overwrites
      // what somebody typed. Clearing the value alone was not enough: the
      // `touched` mark outlives it and blocks the next client's prefill too.
      delete phone.dataset.touched;
      delete address.dataset.touched;
      delete pin.dataset.touched;
      prefill(phone, "");
      prefill(address, "");
      prefill(pin, "");
      phoneField.disagree(null);
      addressField.disagree(null);
      pinField.disagree(null);
      exempt.hidden = true;
      exemptBox.checked = false;
      showCombo();
      combo.focusInput();
      say("");
    }

    async function selectClient(entry) {
      chosen = entry;
      creating = false;
      newGroup.hidden = true;
      phoneField.disagree(null);
      addressField.disagree(null);
      pinField.disagree(null);
      exempt.hidden = true;
      exemptBox.checked = false;
      showChosen();
      say(`Invoicing ${entry.name}. Fetching what we have on file…`);
      const detail = await callPush({ action: "client", contact_id: entry.contact_id });
      // A client chosen and then changed while this was in flight must not have
      // the wrong person's number written into the form.
      if (!chosen || chosen.contact_id !== entry.contact_id) return;
      if (!detail || !detail.ok) return say(`Invoicing ${entry.name}. Their details could not be loaded — type them in.`, true);
      // What the note claims is what was actually written into the boxes: a
      // field the rep had already typed into is left alone, and saying it came
      // from the file would be describing a value that is not there.
      const filled = [
        prefill(phone, detail.phone) ? "phone" : null,
        prefill(address, detail.address) ? "address" : null,
        prefill(pin, detail.pin) ? "KRA PIN" : null
      ].filter(Boolean);
      // Said where the invoice is raised, because the person who knows a client
      // is exempt is not usually the person raising it.
      exemptBox.checked = Boolean(detail.vat_exempt);
      exempt.hidden = !detail.vat_exempt;
      // Where the two records already hold different real values, say so. The
      // save reconciles them either way; this is about reconciling them to the
      // RIGHT one.
      const differs = detail.differs || {};
      if (differs.phone) phoneField.disagree(detail.airtable.phone);
      if (differs.address) addressField.disagree(detail.airtable.address);
      // The PIN prefills from Airtable, so where the two disagree it is ZOHO's
      // value the rep has not seen. The other two are the other way round.
      if (differs.pin) pinField.disagree(detail.zoho.pin, "Zoho");
      say(filled.length
        ? `Invoicing ${entry.name}. Their ${filled.join(" and ")} came from the file — edit to correct it.`
        : `Invoicing ${entry.name}. Nothing on file to fill in.`);
    }

    function startNewClient(typed) {
      chosen = null;
      creating = true;
      newGroup.hidden = false;
      // A new client has no Airtable record to be exempt in yet.
      exempt.hidden = true;
      exemptBox.checked = false;
      // The name already typed into the search box is almost always the new
      // client's, so split it rather than making them type it a second time.
      const parts = String(typed || "").split(/\s+/).filter(Boolean);
      if (parts.length) {
        firstName.value = parts[0];
        lastName.value = parts.slice(1).join(" ");
      }
      showCombo();
      firstName.focus();
      say("This creates a new client in Zoho when the invoice is raised.");
    }

    backToList.addEventListener("click", resetClient);

    // --- delivery ---------------------------------------------------------
    const state = { date: "" };
    const date = staffInput("date");
    const dateStatus = statusToggle(state, "date", () => Boolean(date.value));
    date.addEventListener("change", () => dateStatus.paint());
    const dateField = make("div", "nd-staff-dated");
    dateField.appendChild(date);
    dateField.appendChild(dateStatus);

    // No Tentative/Confirmed on the window. A time somebody typed is a time they
    // meant, and the message the delivery team receives gates the whole slot on
    // the DATE being confirmed -- so a second control asked a question that had
    // nowhere to be answered.
    const from = staffInput("time");
    const until = staffInput("time");
    const timeField = make("div", "nd-staff-window");
    timeField.appendChild(from);
    timeField.appendChild(make("span", "nd-staff-label", "to"));
    timeField.appendChild(until);

    // Deliberately NOT type="number". A browser reports an empty string for
    // "2,500" rather than the digits behind it, so a rep typing a thousands
    // separator -- which in Kenya is most of them -- silently sent no fee at
    // all and got an invoice with no delivery line on it. Text plus a decimal
    // keypad accepts what people actually type; the server strips the rest.
    const fee = staffInput("text", "e.g. 2,000");
    fee.inputMode = "decimal";
    // The note belongs under the box, not in the label column: a two-column row
    // puts a third child at the start of the next line.
    const feeField = make("div", "nd-staff-stack");
    feeField.appendChild(fee);
    feeField.appendChild(make("small", "nd-subtext", "VAT inclusive, as its own invoice line"));
    const feeRow = staffRow("Delivery fee", feeField);

    const pickup = make("input", null);
    pickup.type = "checkbox";
    pickup.addEventListener("change", () => {
      // Hidden rather than greyed: a fee that is merely disabled still reads as
      // a number somebody meant, and it is cleared so it cannot be sent either.
      feeRow.hidden = pickup.checked;
      if (pickup.checked) fee.value = "";
    });

    // --- submit -----------------------------------------------------------
    const send = make("button", "nd-button is-primary", "Create draft invoice");
    send.type = "button";
    send.addEventListener("click", async () => {
      // Bookends are a count on the design, not pieces, and are billed on their
      // own: an order of bookends alone, for a shelf the client already owns
      // (drawn and omitted, or not drawn at all), is a real order.
      const bookends = ui.design.bookends > 0;
      if (!ui.design.instances.length && !bookends) return say("There are no pieces on this design.", true);
      if (!bookends && ui.design.instances.every((instance) => instance.omitted)) {
        return say("Every piece on this design is left out of the invoice, so there is nothing to bill.", true);
      }
      if (!rep.value) return say("Say who is raising this.", true);
      const first = firstName.value.trim();
      const last = lastName.value.trim();
      if (!chosen && !(creating && (first || last))) {
        return say("Choose a client, or add a new one.", true);
      }
      send.disabled = true;
      say(chosen ? "Saving the design, then raising the draft…" : "Creating the client, then raising the draft…");
      try {
        // The invoice references the design by code, so the design has to exist
        // under that code before the invoice mentions it.
        const code = await saveDesign();
        const out = await callPush({
          action: "push",
          code,
          rep: rep.value,
          contact_id: chosen ? chosen.contact_id : null,
          new_client: chosen ? null : { first_name: first, last_name: last },
          phone: phone.value,
          address: address.value,
          kra_pin: pin.value,
          delivery_date: date.value,
          delivery_date_status: state.date,
          window_start: from.value,
          window_end: until.value,
          pickup: pickup.checked,
          delivery_fee: pickup.checked ? null : fee.value,
          vat_exempt: !exempt.hidden && exemptBox.checked
        });
        if (!out || !out.ok) return say(pushProblem(out), true);
        showResult(body, title, out);
      } catch (error) {
        say(`Could not raise it: ${error.message}`, true);
      } finally {
        send.disabled = false;
      }
    });

    form.appendChild(staffRow("Raised by", rep));
    form.appendChild(clientRow);
    form.appendChild(newGroup);
    form.appendChild(staffRow("Phone", phoneField));
    form.appendChild(staffRow("Delivery address", addressField));
    form.appendChild(staffRow("KRA PIN", pinStack));
    form.appendChild(exempt);
    form.appendChild(staffRow("Delivery date", dateField));
    form.appendChild(staffRow("Delivery time", timeField));
    form.appendChild(staffRow("Client collects", pickup));
    form.appendChild(feeRow);
    form.appendChild(send);
    form.appendChild(note);
    form.appendChild(syncNowButton());
    body.appendChild(form);
    // preventScroll, and then the top: a sheet that opens halfway down its own
    // form reads as a form somebody has already been filling in.
    rep.focus({ preventScroll: true });
    body.scrollTop = 0;
  }

  /**
   * "Sync Airtable now", for the moment somebody has just made an order and
   * wants its invoiced prices without waiting for the hour.
   *
   * The schedule is hourly and cheap on purpose — Zoho allows 2,000 API calls a
   * DAY — so this is the other half of that trade: cheap by default, immediate
   * on demand. It is a background pass, so there is nothing to wait for; saying
   * "started" and where the answer lands is the honest report.
   */
  function syncNowButton() {
    const button = make("button", "nd-button is-small is-quiet", "Sync Airtable now");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Starting…";
      const response = await fetch("/api/sync-now", {
        method: "POST",
        headers: { "content-type": "application/json", "x-framework-key": staffKey || "" },
        body: JSON.stringify({})
      }).catch(() => null);
      const body = response ? await response.json().catch(() => null) : null;
      button.textContent = body && body.ok ? "Sync started" : "Could not start it";
      window.setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 4000);
    });
    return button;
  }

  /** What went wrong, in the words of someone who can do something about it. */
  function pushProblem(out) {
    if (!out) return "Could not raise it — check your connection and try again.";
    if (out.error === "nothing_priceable") return "None of these pieces are sellable in Zoho yet.";
    if (out.error === "already_raised") {
      return `This design is already on ${out.invoice_number || "an invoice"}${
        out.customer ? " for " + out.customer : ""}. Open that one in Zoho rather than raising it twice.`;
    }
    if (out.error === "client_exists") return "Zoho already has a client with that name. Search for them in the list instead.";
    if (out.error === "client_failed") return `The client could not be created${out.detail ? ": " + out.detail : "."}`;
    if (out.error === "no_customer") return "Choose a client, or add a new one.";
    return `Could not raise it${out.detail ? ": " + out.detail : "."}`;
  }

  /** What happened, and the one link worth having afterwards. */
  function showResult(body, title, out) {
    clear(body);
    title.textContent = `Draft ${out.invoice_number}`;
    const wrap = make("div", "nd-staff-form");
    const who = (out.client && out.client.name) || "the client";
    wrap.appendChild(make("p", "nd-note",
      `Raised for ${who}: ${out.lines} line${out.lines === 1 ? "" : "s"}, ${formatKsh(out.computed_total)}${
        out.delivery_total ? ` (including ${formatKsh(out.delivery_total)} delivery)` : ""}.`));

    if (out.vat_exempt) {
      wrap.appendChild(make("p", "nd-note",
        `Raised VAT-exempt: ${formatKsh(out.vat_saving)} less than with VAT. Check every line reads Exempt in Zoho before sending — a pushed eTIMS invoice cannot be edited.`));
    } else if (out.vat_exempt_declined) {
      wrap.appendChild(make("p", "nd-note",
        `${who} is marked VAT exempt in Airtable, but this invoice was raised with VAT as asked.`));
    }

    if (out.client && out.client.created) {
      const at = out.client.airtable;
      wrap.appendChild(at && at.ok
        ? make("p", "nd-note", `${who} is a new client, in Zoho and in Airtable's Base - Clients.`)
        : make("p", "nd-note is-error",
          `${who} is a new client in Zoho, but could not be added to Airtable's Base - Clients — add them by hand.`));
    }

    // Two live records, reported separately: half a correction that says it is
    // half a correction can be finished, one that claims to be whole cannot.
    const saved = [
      ["Zoho", out.contact_saved],
      ["Airtable", out.client_saved]
    ];
    const landed = saved.filter(([, r]) => r && r.ok);
    if (landed.length) {
      const changed = [
        landed[0][1].phone ? "phone" : null,
        landed[0][1].address ? "address" : null,
        landed[0][1].pin ? "KRA PIN" : null
      ].filter(Boolean);
      const noted = landed.some(([, r]) => r.replaced && r.replaced.length);
      wrap.appendChild(make("p", "nd-note",
        `Their ${changed.join(" and ")} ${changed.length === 1 ? "was" : "were"} updated in ${
          landed.map(([name]) => name).join(" and ")}${noted ? ", and what it replaced is in their notes" : ""}.`));
      // Two things a PIN does that a phone number does not, both worth saying
      // out loud rather than leaving somebody to discover from an accountant.
      const zoho = (out.contact_saved && out.contact_saved.ok) ? out.contact_saved : null;
      if (zoho && zoho.registered) {
        wrap.appendChild(make("p", "nd-note",
          `${who} is now marked VAT-registered in Zoho, which is what lets a PIN sit on their record. It changes how they are classified, not what they are charged.`));
      }
      // The client's records are written AFTER the invoice, deliberately: a
      // failure here must never cost a rep the draft they were raising. The
      // cost of that ordering is this one case — an existing client given a PIN
      // for the first time had none when the invoice was stamped, so this draft
      // does not carry it. Their next one will.
      if (zoho && zoho.pin && !(out.client && out.client.created)) {
        wrap.appendChild(make("p", "nd-note",
          "This draft was raised before their PIN was on record, so it does not show one. Re-save the draft in Zoho if this invoice needs it."));
      }
    }
    for (const [name, result] of saved) {
      if (!result || result.ok !== false) continue;
      if (result.missing) {
        wrap.appendChild(make("p", "nd-note is-error",
          "This client is in Zoho but not in Airtable's Base - Clients, so only Zoho was corrected. Add them to Airtable."));
        continue;
      }
      if (result.scope) {
        // A standing condition, not a fault. Saying "Zoho would not take it"
        // sends someone looking for a bug that is not there.
        wrap.appendChild(make("p", "nd-note",
          "Airtable has the client's details. Zoho's copy was not updated: this app's Zoho credential can read and create contacts but not change them, which needs the token reissuing."));
        continue;
      }
      const problem = make("p", "nd-note is-error",
        `The invoice is raised, but ${name} would not take the client's new details — correct it there by hand.`);
      // The reason, verbatim. Withholding it turned one real failure into an
      // afternoon of guessing at payload shapes.
      if (result.detail) problem.appendChild(make("small", "nd-subtext", result.detail));
      wrap.appendChild(problem);
    }

    for (const warning of out.warnings || []) {
      wrap.appendChild(make("p", "nd-note is-error", warning));
    }
    if (out.drift) {
      wrap.appendChild(make("p", "nd-note is-error",
        `Priced at ${formatKsh(out.drift.now)} today; this design was quoted at ${formatKsh(out.drift.quoted)}.`));
    }
    if (out.skipped_fields && out.skipped_fields.length) {
      wrap.appendChild(make("p", "nd-note is-error",
        `Zoho has no field for ${out.skipped_fields.join(", ")}, so ${out.skipped_fields.length === 1 ? "it was" : "they were"} not saved. Add ${out.skipped_fields.length === 1 ? "it" : "them"} to the invoice by hand.`));
    }
    if (out.unknown && out.unknown.length) {
      wrap.appendChild(make("p", "nd-note is-error",
        `${out.unknown.length} item${out.unknown.length === 1 ? "" : "s"} could not be priced and need a line adding by hand: ${out.unknown.map((u) => u.expected).join(", ")}.`));
    }

    const open = make("a", "nd-button is-primary", "Open it in Zoho");
    open.href = out.url;
    open.target = "_blank";
    open.rel = "noopener";
    wrap.appendChild(open);

    const another = make("button", "nd-button is-small", "Raise another");
    another.type = "button";
    another.addEventListener("click", () => renderOrderForm(body, title));
    wrap.appendChild(another);
    wrap.appendChild(syncNowButton());
    body.appendChild(wrap);
  }

  async function callPush(body) {
    const response = await fetch("/api/zoho-push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-framework-key": staffKey || "" },
      body: JSON.stringify(body)
    });
    return response.json().catch(() => null);
  }

  /*
   * "Create link to design", Download and Upload used to live here.
   *
   * The link is not gone, only the button: Present and Order both save the
   * design and print or send its address, which is every route a design
   * actually travelled — nobody made a link for its own sake. Download and
   * Upload moved a design as a JSON file between a phone and the workshop, and
   * were replaced by that same address, which survives being read off a photo.
   */

  // ------------------------------------------------------------------ modes --

  /*
   * The one thing on this screen nothing else says.
   *
   * It used to be two sentences per interface, and the first of each told
   * people what the "+" markers do. On a phone that sentence was not merely
   * redundant, it was wrong: four of Flexible's five markers projected
   * off-stage and were hidden, so it named affordances that were not there.
   * The markers now stay on screen and open a sheet that titles itself, and
   * Advanced's button has said "Add a piece" in words all along.
   *
   * What is left is the one fact the interface cannot show: that the drawing
   * is tappable. Nothing else on the page hints at it -- there is no hover on
   * touch, no outline and no cursor, and the shelf looks like a picture of a
   * shelf. Said once, to each person, in both interfaces.
   */
  const BUILD_HINT = "Tap any piece on the shelf to change or remove it.";
  const HINT_SEEN_KEY = "fwk_builder_hinted";

  /*
   * Once per person, not once per page load.
   *
   * The commonest way into this page is a share link or a /builder/CODE path
   * in a fresh tab, so a flag in page memory meant somebody iterating on one
   * design was told the same thing every time they opened it. A throw on read
   * means "not seen", which shows it again; a throw on write means it shows
   * again next time. Both are the right way to fail. Follows js/gate.js.
   */
  function hintAlreadySeen() {
    try { return window.localStorage.getItem(HINT_SEEN_KEY) === "1"; } catch (error) { return false; }
  }

  function rememberHintSeen() {
    try { window.localStorage.setItem(HINT_SEEN_KEY, "1"); } catch (error) { /* private mode */ }
  }

  function applyMode(mode, options) {
    const next = MODES.indexOf(mode) >= 0 ? mode : "simple";
    const previous = ui.mode;
    // Never over the top of something the page is already saying. A dead share
    // link reports itself at boot and then applyMode ran in the same tick, so
    // the one arrival that most needs its error -- somebody following a stale
    // link out of WhatsApp -- was the one arrival that never saw it, because
    // they are also a first-time visitor.
    if (next !== "simple" && !hintAlreadySeen() && dom.hint.hidden) {
      rememberHintSeen();
      setHint(BUILD_HINT);
    }
    ui.mode = next;
    dom.app.dataset.mode = next;
    dom.panelTitle.textContent = "Build";
    Array.prototype.forEach.call(dom.modes.querySelectorAll("button"), (button) => {
      button.setAttribute("aria-selected", String(button.dataset.mode === next));
    });
    ui.selectedId = null;
    ui.activeModuleId = null;
    ui.placedSinceChoose = false;
    if (options && options.silent) {
      // keepDesign is the "stay put" path out of the Simple confirmation: the
      // interface has to be put back on screen, just without rebuilding.
      if (options.keepDesign) refresh({ fit: true });
      return;
    }

    if (next === "simple") {
      const derived = deriveSimpleSpec(ui.design);
      if (derived) {
        const rebuilt = buildSimpleDesign(derived, ui.design.finish, ui.design.bookends);
        // Simple can only express a plain run. If the current design is not one,
        // switching would silently throw pieces away, so ask first.
        if (rebuilt.instances.length !== ui.design.instances.length) {
          confirmSimpleRebuild(derived, rebuilt, previous);
          return;
        }
        ui.simple = derived;
      }
    }
    refresh({ fit: true });
  }

  /**
   * Ask before Simple discards pieces it cannot express.
   *
   * Staying put on cancel matters: the switch has to be genuinely abandonable,
   * not merely undoable, or the mode buttons become a thing people are afraid to
   * touch.
   */
  function confirmSimpleRebuild(spec, rebuilt, previousMode) {
    // The rebuild can be larger as well as smaller than what is on screen: a
    // run with an extension on one stack and not the other comes back as a
    // full rectangle, which ADDS a piece. Counting one way and saying
    // "removed" put "-1 pieces that Simple cannot describe" in front of
    // somebody who had done nothing stranger than build two uneven bays.
    const difference = ui.design.instances.length - rebuilt.instances.length;
    const size = `${spec.width} unit${spec.width === 1 ? "" : "s"} wide and ${spec.levels} high`;
    const count = (n) => `${n} piece${n === 1 ? "" : "s"}`;
    const consequence = difference > 0
      ? `${count(difference)} it cannot describe will be removed.`
      : `It will be filled out to match, which adds ${count(-difference)}.`;
    openConfirm({
      title: "Simple only builds plain runs",
      body: `Switching rebuilds this shelf as ${size}. ${consequence}`,
      confirmLabel: "Rebuild it",
      cancelLabel: "Stay in " + (MODE_LABELS[previousMode] || previousMode),
      onConfirm: () => {
        ui.simple = spec;
        pushHistory();
        ui.design = rebuilt;
        refresh({ fit: true });
        setHint("Rebuilt as a plain run. Undo to go back.");
      },
      onCancel: () => applyMode(previousMode, { silent: true, keepDesign: true })
    });
  }

  // ----------------------------------------------------------------- refresh --

  function refresh(options) {
    const settings = options || {};
    computeCandidateCache();

    // A piece held over from the last placement may have run out of places to
    // go. Put it down here, before the overlay is built, so the user is never
    // left holding something with no markers and a button offering to finish.
    if (ui.activeModuleId && !(ui.candidateCache.get(ui.activeModuleId) || []).length) {
      const spent = ui.catalog.modules[ui.activeModuleId];
      const placed = ui.placedSinceChoose;
      ui.activeModuleId = null;
      ui.placedSinceChoose = false;
      if (placed && spent) {
        setHint(`That was the last ${moduleLabel(spent)} that fits. Tap Add a piece for another.`);
      }
    }

    ui.renderer.setPalette(shaderPalette(currentFinish()));

    const needed = Array.from(new Set(ui.design.instances.map((instance) => instance.moduleId)));
    // The bookend bundle is only fetched once someone asks for one, which is
    // most of the time never.
    if ((ui.design.bookends || 0) > 0) needed.push("bookend");
    ensureGeometry(needed);
    syncScene();

    // Only Simple has a control column. Building it for the other two would be
    // building a hidden one, and its steppers would still be in the tab order.
    const body = dom.controls;
    if (ui.mode === "simple") {
      // The panel is rebuilt wholesale on every change, which resets its scroll.
      // Nudging the bookend stepper near the bottom of the list would jump you
      // back to the top of the form, so put the scroll position back.
      const scrollTop = body.scrollTop;
      clear(body);
      renderSimplePanel(body);
      body.scrollTop = scrollTop;
    } else if (body.firstChild) {
      clear(body);
    }

    updateSummary();
    refreshSheet();

    // Frame before laying out the overlay: the "+" anchors are projected with
    // the camera, so re-framing afterwards would place them for the old view.
    // Only explicit framing actions and additions resize the view. Rotating,
    // removing, swapping and recolouring preserve the user's camera exactly.
    //
    // "candidates" is the framing for a piece still in hand: the shelf plus
    // everywhere it could still go, which is a wider box than the shelf and is
    // the only one that keeps the remaining markers on screen.
    if (settings.fit === "candidates" && ui.activeModuleId) {
      fitToCandidates(ui.activeModuleId);
    } else if (settings.fit) {
      ui.renderer.fit(null, ui.dimensionsOn ? DIMENSION_FIT_PADDING : null);
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
    dom.redo.addEventListener("click", redo);
    dom.zoomIn.addEventListener("click", () => { if (!isPerspective()) ui.renderer.zoomBy(1.25); });
    dom.zoomOut.addEventListener("click", () => { if (!isPerspective()) ui.renderer.zoomBy(1 / 1.25); });
    dom.fit.addEventListener("click", () => ui.renderer.fit());
    dom.dimensions.addEventListener("click", () => setDimensions(!ui.dimensionsOn));
    dom.perspective.addEventListener("click", () => setPerspective(!isPerspective()));

    dom.collapse.addEventListener("click", () => {
      const collapsed = dom.app.dataset.panel === "collapsed";
      dom.app.dataset.panel = collapsed ? "open" : "collapsed";
      dom.collapse.setAttribute("aria-expanded", String(collapsed));
      dom.collapse.setAttribute("aria-label", collapsed ? "Hide options" : "Show options");
      // The viewport just changed size, so re-fit rather than leave the shelf
      // cropped or floating.
      window.requestAnimationFrame(() => ui.renderer.fit());
    });

    dom.add.addEventListener("click", () => {
      if (ui.activeModuleId) cancelAdd();
      else openAddSheet();
    });
    dom.customise.addEventListener("click", openCustomiseSheet);
    dom.bookends.addEventListener("click", openBookendSheet);

    dom.breakdownToggle.addEventListener("click", () => {
      ui.breakdownOpen = !ui.breakdownOpen;
      renderBreakdown();
      // The stage just changed height. The ResizeObserver below redraws it at
      // the new size; deliberately no re-fit, because opening a list to read it
      // is not a reason to move someone's camera.
    });

    dom.present.addEventListener("click", openPresent);
    dom.presentClose.addEventListener("click", closePresent);
    dom.presentModal.addEventListener("click", (event) => {
      if (event.target === dom.presentModal) closePresent();
    });
    dom.modalClose.addEventListener("click", closePicker);
    dom.modal.addEventListener("click", (event) => {
      if (event.target === dom.modal) closePicker();
    });
    /*
     * Open a WhatsApp link in a second tab and leave the builder standing.
     *
     * Both buttons save first, and the save is async, so the tab has to be
     * opened inside the click or Safari treats it as a popup and blocks it.
     * It is opened without the "noopener" feature on purpose: with it,
     * window.open returns null, so the new tab stays blank and the fallback
     * sends the builder itself to WhatsApp. The opener is cut by hand instead.
     *
     * If the popup is blocked outright, the same tab does the job: losing the
     * session beats losing the message.
     */
    function openWhatsAppTab() {
      const tab = window.open("", "_blank");
      if (tab) tab.opener = null;
      return {
        go(href) {
          if (tab && !tab.closed) tab.location.href = href;
          else window.location.href = href;
        },
        abandon() {
          if (tab && !tab.closed) tab.close();
        },
      };
    }

    /*
     * Help me design.
     *
     * The design is saved first so the link in the message resolves, and a
     * failed save is not a failure: the message already lists every piece,
     * the colour and the size, so it is worth sending without the link.
     */
    dom.help.addEventListener("click", (event) => {
      event.preventDefault();
      const { total } = priceBreakdown();
      const sessionId = builderSessionId();
      const empty = ui.design.instances.length === 0;
      const tab = openWhatsAppTab();
      const go = (href) => {
        dom.help.href = href;
        tab.go(href);
      };
      track("help_click", { mode: ui.mode, pieces: ui.design.instances.length, session_id: sessionId });
      if (empty) {
        go(helpUrl(total, { sessionId }));
        return;
      }
      saveDesign()
        .then((code) => go(helpUrl(total, { code, sessionId })))
        .catch((error) => {
          console.warn("could not save design before asking for help:", error.message);
          go(helpUrl(total, { code: designCode(), sessionId }));
        });
    });

    dom.order.addEventListener("click", (event) => {
      if (dom.order.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      const { total } = priceBreakdown();
      const label = dom.order.querySelector(".nd-button-text");
      const originalText = label.textContent;
      label.textContent = "Preparing order...";
      dom.order.setAttribute("aria-disabled", "true");
      const tab = openWhatsAppTab();
      saveDesign()
        .then((code) => {
          const sessionId = builderSessionId();
          const href = whatsappUrl(total, { code, sessionId });
          dom.order.href = href;
          track("order_click", { value: total, currency: "KES", mode: ui.mode, design_code: code, session_id: sessionId });
          tab.go(href);
        })
        .catch((error) => {
          tab.abandon();
          console.warn("could not save design before order:", error.message);
          setHint("Could not create the order link. Check your connection and try again.", true);
        })
        .then(() => {
          label.textContent = originalText;
          dom.order.setAttribute("aria-disabled", ui.design.instances.length === 0 ? "true" : "false");
        });
    });

    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === "Escape") {
        if (!dom.presentModal.hidden) return closePresent();
        // The order form's own controls stop this first where they need to --
        // the client dropdown closes its list rather than the sheet around it.
        const staff = el("nd-staff-modal");
        if (staff && !staff.hidden) {
          staff.hidden = true;
          clear(el("nd-staff-body"));
          return;
        }
        if (!dom.modal.hidden) return closePicker();
        if (ui.previewCandidateId) return clearGhost();
        if (ui.activeModuleId || ui.selectedId) {
          ui.activeModuleId = null;
          ui.placedSinceChoose = false;
          ui.selectedId = null;
          syncScene();
          buildOverlay();
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
    if (isPerspective()) return;
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
    if (ui.mode === "simple" || isPerspective()) return; // panel-driven, or view-only
    if (ui.activeModuleId) {
      // Tapping empty space backs out: first out of a pending preview, then out
      // of placing the piece at all.
      if (ui.previewCandidateId) {
        clearGhost();
        return;
      }
      // Tapping a piece means "that one", not "nothing". Advanced now keeps a
      // part in hand across placements, so without this the gesture the mode
      // depends on — tap a piece to swap, rotate or remove it — would cost a
      // trip to the button first.
      const onPiece = ui.renderer.pick(clientX, clientY);
      ui.activeModuleId = null;
      ui.placedSinceChoose = false;
      ui.selectedId = onPiece || null;
      setHint(null);
      syncScene();
      buildOverlay();
      return;
    }
    const hit = ui.renderer.pick(clientX, clientY);
    if (hit === ui.selectedId) return;
    ui.selectedId = hit;
    syncScene();
    buildOverlay();
  }

  function onWheel(event) {
    if (isPerspective()) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0016));
    ui.renderer.zoomBy(factor, event.clientX, event.clientY);
  }

  boot();
})();

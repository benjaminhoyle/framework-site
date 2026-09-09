/**
 * The studio: a grid of everything at each stage, and a flow for walking it.
 *
 * Three sections in the pipeline's own order: the shelves, the views planned
 * of the ones taken, and the scenes the rendered views were put into. Each
 * opens on its grid with the verdicts on the cells, and each can be walked one
 * unjudged item at a time (Flow) without leaving the section. Nothing crosses
 * a section on its own: a kept shelf has its views planned and they wait in
 * Views; a rendered view waits in Views to be put in a room; a finished scene
 * waits in Scenes. The gates are where they are looked at.
 *
 * Nothing about the shelf, the camera or the figure is decided here; that is
 * js/design-lab/preview.js and the dev server's planner, both shared with the
 * bench tools. What is here is the grid, the flow, the queue, and the record.
 */
window.FrameworkStudio = (function () {
  "use strict";

  const engine = window.FrameworkDesignerEngine;
  const geometryLoader = window.FrameworkDesignerGeometry;
  const rendererLib = window.FrameworkDesignerRenderer;
  const preview = window.FrameworkShotPreview;

  const CATALOG_URL = "/assets/shelving/catalog.json";
  const MODULE_BASE_URL = "/assets/shelving/modules";
  const DESIGN_URL = "/api/design-lab/verdicts";
  const SHOTS_URL = "/api/design-lab/shots";
  const PLAN_URL = "/api/design-lab/plan";
  const RENDER_URL = "/api/design-lab/render";
  const GENERATE_URL = "/api/design-lab/generate";
  const SCENES_URL = "/api/design-lab/scenes";
  const SCENE_IMAGE_URL = "/api/design-lab/scene-image";
  const DECODE_URL = "/api/design-lab/decode";
  const BRIEFS_URL = "/api/briefs";
  const BRIEF_URL = "/api/brief";
  const PREVIEW_PX = 720;
  /*
   * How many rooms one render may be asked for at a time. A brief says how
   * many it wants per render; this is the ceiling under a typo, and the
   * sitting's cap still bounds what is actually spent.
   */
  const MAX_ROOMS_PER_RENDER = 12;
  const QUEUE_POLL_MS = 2000;
  /*
   * How many scene images this sitting may generate before it stops and asks.
   *
   * Each one costs money, and they fire off the back of renders that fire off
   * the back of a keypress, so something has to stop, and a number you have to
   * raise deliberately is a better stop than remembering to look.
   */
  const DEFAULT_SCENE_CAP = 25;

  /** The three sections, in the pipeline's order. */
  const SECTIONS = [["shelves", "Shelves"], ["views", "Views"], ["scenes", "Scenes"]];

  const ui = {
    catalog: null,
    corpus: null,
    designs: [],        // the corpus records, superseded ones dropped
    verdicts: {},       // design fingerprint -> row
    shotVerdicts: {},   // shot id -> row
    sceneRecords: {},   // scene id -> row
    renderer: null,
    loadedModules: new Set(),
    queue: { paused: false, waiting: [], running: null, done: [], failed: [] },
    busy: false,
    // The scene leg: what has been generated and how much of the budget is left.
    scenes: {
      made: 0, cap: DEFAULT_SCENE_CAP, running: null, failed: 0,
      seen: new Set(),
      // Renders pushed into a room by hand, waiting their turn. The generator
      // runs one at a time, so a button pressed on six renders has to mean six
      // scenes rather than one scene and five presses that did nothing.
      pending: [],
      // Whatever was already finished when this page opened is not this
      // sitting's work, and must not be charged to its budget.
      firstPass: true
    },
    cycle: null,
    autoScene: true,
    // Which section is open, and whether it is showing its grid or walking
    // its unjudged items one at a time.
    section: "shelves",
    mode: "grid",
    // Where the flow is in each section's unjudged list. Kept per section so
    // switching away and back does not lose your place.
    flowAt: { shelves: 0, views: 0, scenes: 0 },
    // Rejected rows are out of a grid until asked for, per section.
    showRejected: { shelves: false, views: false, scenes: false },
    // The brief in use, if any: the files on offer, the one chosen (parsed),
    // and the memory FrameworkBrief keeps of what this sitting has drawn. A
    // fresh batch starts whenever the brief changes.
    briefs: [],
    brief: null,
    batch: {},
    // The angles planned for a shelf, drawn and ready to be sent to the queue
    // one at a time. Keyed by shot id, and held only for this sitting: a shot's
    // record carries where the camera ended up, not the geometry the planner
    // needed to put it there, so a view is re-planned rather than reloaded.
    views: {},
    // Shelves waiting to have their views planned, in order.
    planning: [],
    // The shelf whose design code is open for editing, by fingerprint.
    editing: null,
    // The one picture being looked at large, as { kind, key }.
    detail: null,
    // Shelves drawn from geometry, by fingerprint, so a redraw costs nothing.
    shelfImages: {},
    // What the queue looked like the last time the grid was drawn from it.
    queueSignature: ""
  };

  const dom = {};

  // ------------------------------------------------------------- drawing ---

  function finishById(id) {
    return ui.catalog.finishes.find((entry) => entry.id === id) || ui.catalog.finishes[0];
  }

  function ensureGeometry(moduleIds) {
    const wanted = moduleIds.filter((id) => !ui.loadedModules.has(id));
    if (!wanted.length) return Promise.resolve();
    return Promise.all(wanted.map((id) =>
      geometryLoader.load(MODULE_BASE_URL, id, "")
        .then((geometry) => {
          ui.renderer.addModule(id, geometry);
          ui.loadedModules.add(id);
        })
        .catch((error) => console.error(`geometry ${id}:`, error))));
  }

  /** The design itself, drawn the way the design bench draws it. */
  function drawDesign(state) {
    const moduleIds = [...new Set(state.instances.map((instance) => instance.moduleId))];
    return ensureGeometry(moduleIds).then(() => {
      ui.renderer.setViewMode("iso");
      ui.renderer.setPalette(preview.shaderPalette(finishById(state.finish)));
      ui.renderer.setInstances(state.instances.map((instance) =>
        preview.renderInstance(ui.catalog, instance)));
      const shot = ui.renderer.snapshot({ width: PREVIEW_PX, height: PREVIEW_PX });
      return preview.paint(shot, null);
    });
  }

  /**
   * A shelf drawn from its own geometry, kept.
   *
   * A shelf has no picture on disk, so every place that shows one draws it,
   * and the grid redraws on every queue tick. Sixty-eight shelves through the
   * WebGL renderer twice a second is the whole page stalling for no new
   * information.
   */
  function shelfImage(shelf) {
    const key = shelf.fingerprint || shelf.code;
    if (ui.shelfImages[key]) return Promise.resolve(ui.shelfImages[key]);
    return drawDesign(engine.deserializeState(ui.catalog, shelf.design)).then((drawn) => {
      ui.shelfImages[key] = drawn;
      return drawn;
    });
  }

  /** One angle, through the camera it will be rendered through. */
  function drawShot(shot) {
    if (shot.preview) return Promise.resolve(shot.preview);
    const state = engine.deserializeState(ui.catalog, shot.design);
    const moduleIds = [...new Set(state.instances.map((instance) => instance.moduleId))];
    return ensureGeometry(moduleIds).then(() => {
      const drawn = preview.draw(ui.renderer, ui.catalog, shot, state,
        finishById(shot.finish), PREVIEW_PX);
      shot.preview = drawn.image;
      shot.camera = drawn.camera;
      shot.figure = drawn.figure;
      // A drawn shot is a view: it now carries the camera the render will be
      // given, which is the whole of what the Views section needs.
      ui.views[shot.id] = shot;
      return shot.preview;
    });
  }

  // -------------------------------------------------------------- record ---

  function post(url, row) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(row)
    }).then((response) => {
      // A refusal is not a save: fetch only rejects on a network failure, so a
      // 400 would otherwise pass for success while the record stayed empty.
      if (!response.ok) return response.text().then((detail) => { throw new Error(detail); });
      return response.json().catch(() => ({}));
    });
  }

  /**
   * Write a verdict on a shelf. `shelf` is a corpus record or an earlier
   * verdict row: both carry the same fields, and a verdict carries its design
   * so it still means something once the corpus is regenerated.
   */
  function recordDesign(shelf, verdict, note) {
    const row = {
      fingerprint: shelf.fingerprint,
      code: shelf.code,
      verdict,
      // A note already on record survives a re-judging that brings none.
      note: note || shelf.note || "",
      at: new Date().toISOString(),
      corpusSeed: shelf.corpusSeed || ui.corpus.seed,
      supersedes: shelf.supersedes || undefined,
      sizeMm: shelf.sizeMm,
      shelfSizeMm: shelf.shelfSizeMm,
      pieceCount: shelf.pieceCount,
      moduleCounts: shelf.moduleCounts,
      totalKsh: shelf.totalKsh,
      url: shelf.url,
      design: shelf.design
    };
    ui.verdicts[row.fingerprint] = row;
    post(DESIGN_URL, row).catch((error) => warn(`design verdict not saved: ${error.message}`));
    return row;
  }

  /**
   * A shot's record carries everything the render needs and everything a later
   * question about the picture will want: which design, which angle, which
   * colour, which camera, where the figure stood.
   */
  function shotRow(shot, verdict) {
    return {
      id: shot.id,
      code: shot.code,
      verdict,
      at: new Date().toISOString(),
      yawDeg: shot.yawDeg,
      facingYawDeg: shot.facingYawDeg,
      finish: shot.finish,
      note: shot.note || "",
      standBack: shot.standBack || 1,
      figure: shot.figure ? { outMm: shot.figure.outMm, clear: shot.figure.clear === true } : null,
      cameraMm: shot.camera ? {
        type: shot.camera.type,
        positionMm: shot.camera.positionMm,
        targetMm: shot.camera.targetMm,
        fovDeg: shot.camera.fovDeg || null,
        nearMm: shot.camera.nearMm,
        farMm: shot.camera.farMm
      } : null,
      scaleFigureMm: shot.figure ? {
        heightMm: preview.FIGURE_HEIGHT_MM,
        positionMm: shot.figure.positionMm
      } : null,
      design: shot.design
    };
  }

  // --------------------------------------------------------------- queue ---

  function refreshQueue() {
    return fetch(RENDER_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((state) => {
        if (state) ui.queue = state;
        renderQueueBar();
        claimFinishedRenders();
        /*
         * The Views grid shows render state, so it has to follow the queue,
         * but only when the queue has actually moved. Redrawing it every two
         * seconds regardless replaced every cell in the grid, which threw away
         * the button somebody was in the middle of pressing.
         */
        const signature = queueSignature();
        if (signature !== ui.queueSignature) {
          // The header's tally counts renders too, so it follows the queue
          // wherever you are; the grid only where it shows render state.
          if (ui.section === "views" && !ui.detail) render();
          else renderHeader();
        }
        ui.queueSignature = signature;
      })
      .catch(() => { /* no dev server; the bar simply says nothing is running */ });
  }

  /** What of the queue the grid draws, as one string to compare. */
  function queueSignature() {
    const queue = ui.queue;
    return [
      queue.running || "",
      (queue.rendered || []).length,
      (queue.waiting || []).length,
      (queue.failed || []).length
    ].join("|");
  }

  function renderQueueBar() {
    const queue = ui.queue;
    const waiting = queue.waiting ? queue.waiting.length : 0;
    const done = queue.done ? queue.done.length : 0;
    const failed = queue.failed ? queue.failed.length : 0;
    const total = waiting + done + failed + (queue.running ? 1 : 0);

    dom.queueCount.textContent = total
      ? `${done} rendered · ${queue.running ? "1 rendering" : "idle"} · ${waiting} waiting${failed ? ` · ${failed} failed` : ""}`
      : "nothing queued";
    dom.queueBar.style.width = total ? `${(done / total) * 100}%` : "0%";
    dom.queueNow.textContent = queue.running || "";
    dom.pause.textContent = queue.paused ? "Resume" : "Pause";
    dom.pause.classList.toggle("is-on", Boolean(queue.paused));
    dom.queueWrap.classList.toggle("is-idle", !total);

    if (failed) {
      dom.queueFailed.hidden = false;
      dom.queueFailed.textContent = `${failed} failed, see the dev server log`;
    } else {
      dom.queueFailed.hidden = true;
    }

    const scenes = ui.scenes;
    const running = scenes.running ? ` · making one (${scenes.running.state})` : "";
    const pending = scenes.pending.length ? ` · ${scenes.pending.length} asked for` : "";
    const toLookAt = flowRows("scenes").length;
    // The brief, and how many rooms it asks of each render, next to the money.
    const brief = ui.brief ? ` · ${ui.brief.name} × ${roomsPerRender()}` : "";
    // The counter is about money, so it reports even with Auto off: a scene
    // pushed by hand from the Views grid spends the same budget.
    dom.sceneCount.textContent = ui.autoScene || scenes.made || scenes.running || pending
      ? `${scenes.made}/${scenes.cap} used · ${toLookAt} to look at${running}${pending}` +
        (scenes.failed ? ` · ${scenes.failed} failed` : "") + brief
      : `off${brief}`;
    dom.sceneBar.style.width = `${Math.min(100, (scenes.made / Math.max(1, scenes.cap)) * 100)}%`;
    dom.sceneToggle.textContent = ui.autoScene ? "Auto" : "Manual";
    dom.sceneToggle.classList.toggle("is-on", ui.autoScene);
    dom.sceneCap.value = String(scenes.cap);
  }

  function togglePause() {
    post("/api/design-lab/render/pause", { paused: !ui.queue.paused })
      .then((state) => { ui.queue = state; renderQueueBar(); })
      .catch((error) => warn(`could not pause: ${error.message}`));
  }

  // --------------------------------------------------------------- scenes ---

  /** Local dev supplies the key server-side; anywhere else, ask for it. */
  function isLocal() {
    return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  }

  function authorise() {
    return isLocal() ? Promise.resolve("dev-proxy") : window.FrameworkGate.ready();
  }

  /**
   * The finished render, as base64, which is what the image model works from.
   *
   * Sent whole wherever it fits. This image is the geometry master: the
   * prompt's VIEWPOINT LOCK tells the model to copy its silhouette, tier count,
   * board endpoints, tube positions and joints from it, so throwing away
   * resolution to be tidy throws away the only thing it is there for. An 1800px
   * render is 3.6MB once base64'd against a 5.5MB ceiling on the whole request,
   * which leaves the better part of two megabytes spare.
   *
   * The ladder below only exists for the day a render does not fit: full size
   * and lossless first, then full size at falling quality, and only as a last
   * resort fewer pixels. Nothing is re-encoded when the original will do.
   */
  // The whole request may not pass 5.5M characters; the prompt is about 7.5KB
  // and the JSON around it is small, so this leaves comfortable headroom.
  const IMAGE_BUDGET_CHARS = 4_800_000;

  function encodeAt(image, pixels, type, quality) {
    // Never upscale: there is no information above the render's own resolution.
    const scale = Math.min(1, pixels / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    // The renders are on white; without this a JPEG of a transparent PNG would
    // come out on black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, quality).split(",")[1];
  }

  function renderAsBase64(id) {
    const url = `/api/design-lab/render/image?id=${encodeURIComponent(id)}`;
    return fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`no render for ${id}`);
        return response.blob();
      })
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }))
      .then((original) => {
        if (original.length <= IMAGE_BUDGET_CHARS) {
          return { base64: original, mimeType: "image/png", how: "the render itself" };
        }
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            for (const [pixels, quality, how] of [
              [image.width, 0.97, "full size, high quality"],
              [image.width, 0.92, "full size"],
              [2048, 0.92, "2048px"],
              [1400, 0.9, "1400px"]
            ]) {
              const encoded = encodeAt(image, pixels, "image/jpeg", quality);
              if (encoded.length <= IMAGE_BUDGET_CHARS) {
                resolve({ base64: encoded, mimeType: "image/jpeg", how });
                return;
              }
            }
            reject(new Error("the render will not fit in a request at any size"));
          };
          image.onerror = () => reject(new Error(`no render for ${id}`));
          image.src = url;
        });
      });
  }

  /**
   * Which room the shelf goes in: the brief's answer, or the next preset.
   *
   * A brief is a file in ../framework-marketing/briefs and random mode is no
   * brief; there is no other switch. When one is loaded, FrameworkBrief draws
   * whatever it leaves open and remembers in `ui.batch` what this sitting has
   * already drawn, so twelve pictures do not all land on the same light. If
   * that module is missing, or refuses, the presets carry on exactly as before.
   *
   * The presets come off a cycle rather than a shuffle: thirty scenes drawn at
   * random gives you the same cafe twice before you have seen half of them.
   *
   * `settings.params` is the same request again, as it was made.
   */
  function roomFor(settings, config) {
    if (settings.params) {
      return {
        params: Object.assign({}, settings.params),
        must: [], avoid: [],
        preset: settings.preset || null,
        name: settings.name || "the same room",
        slug: settings.slug || "again",
        brief: settings.brief || null,
        aspect: settings.params.aspect || null
      };
    }
    const brief = ui.brief;
    const resolver = window.FrameworkBrief;
    if (brief && !settings.preset && resolver && typeof resolver.resolve === "function") {
      try {
        const resolved = resolver.resolve(brief, config, ui.batch);
        if (resolved && resolved.params && resolved.params.scene) {
          const formats = Array.isArray(brief.formats) ? brief.formats.filter(Boolean) : [];
          const turn = Math.max(0, (Number(ui.batch.count) || 1) - 1);
          return {
            params: resolved.params,
            must: Array.isArray(resolved.must) ? resolved.must : [],
            avoid: Array.isArray(resolved.avoid) ? resolved.avoid : [],
            preset: null,
            name: `brief · ${brief.name}`,
            slug: `brief-${String(brief.name).replace(/[^A-Za-z0-9]+/g, "-")}`,
            brief: brief.name,
            aspect: formats.length ? String(formats[turn % formats.length]) : null
          };
        }
        warn(`the brief ${brief.name} resolved to nothing usable; using a preset instead`);
      } catch (error) {
        warn(`could not resolve the brief ${brief.name}: ${error.message}; using a preset instead`);
      }
    }
    const preset = settings.preset || ui.cycle.next();
    return {
      params: window.FrameworkScenePresets.paramsFor(preset, config, window.PROMPT_CONFIG.DEFAULTS),
      must: [], avoid: [],
      preset,
      name: preset.name,
      slug: preset.id,
      brief: null,
      aspect: null
    };
  }

  /**
   * The brief's must and avoid lists, appended only where the prompt builder
   * has not already said them. The builder is another file's business and may
   * or may not read `params.must`; saying an item twice is noise, dropping it
   * is the brief not being followed, and this is the cheap way to be sure of
   * neither.
   */
  function briefBlock(prompt, must, avoid) {
    const said = (item) => prompt.toLowerCase().includes(String(item).toLowerCase());
    const wanted = must.filter((item) => item && !said(item));
    const unwanted = avoid.filter((item) => item && !said(item));
    if (!wanted.length && !unwanted.length) return "";
    return "\n\nFROM THE BRIEF:" +
      (wanted.length ? `\nMUST APPEAR, naturally: ${wanted.join("; ")}.` : "") +
      (unwanted.length ? `\nMUST NOT APPEAR: ${unwanted.join("; ")}.` : "");
  }

  /** How many rooms one render is put into: the brief's count, or one. */
  function roomsPerRender() {
    const wanted = ui.brief ? Math.round(Number(ui.brief.count)) : 0;
    return wanted > 0 ? Math.min(MAX_ROOMS_PER_RENDER, wanted) : 1;
  }

  /** Put one finished render into a room. */
  function generateScene(shotId, options) {
    const settings = options || {};
    if (ui.scenes.running) return Promise.resolve(null);
    if (!settings.force && ui.scenes.made >= ui.scenes.cap) return Promise.resolve(null);

    const shotRow = ui.shotVerdicts[shotId];
    const config = window.PROMPT_CONFIG.CONFIG;
    const room = roomFor(settings, config);
    const params = room.params;
    if (settings.note) params.customNotes = settings.note;
    const aspect = room.aspect || "4:3";
    params.aspect = aspect;

    /*
     * The shared builder writes the room; this page adds what only this page
     * knows: the shelf's shape in words (js/design-lab/design-words.js) and
     * its height. js/studio/scene-prompt.js works from an uploaded photograph
     * and has no design to read; here there is one.
     */
    const words = window.FrameworkDesignWords;
    let structure = "";
    let scale = null;
    const design = shotRow ? shotRow.design : null;
    if (design) {
      try {
        const state = engine.deserializeState(ui.catalog, design);
        // The shot's finish, not the design's: the planner rolls a colour per
        // angle, and the render was made in that one.
        structure = words
          ? words.build(engine, ui.catalog, state, { finish: shotRow.finish })
          : "";
        const bounds = engine.designBounds(ui.catalog, state);
        if (bounds) scale = { status: "set", shelfH: Math.round(bounds[5] / 10) };
      } catch (error) {
        // A scene without the structural block is the old behaviour, not a
        // failure: the reference image still carries the shelf.
        console.warn(`could not describe ${shotId}: ${error.message}`);
      }
    }
    const built = window.FrameworkScenePrompt.build(config, params, { aspect, scale })
      + (structure ? `\n\n${structure}` : "");
    const prompt = built + briefBlock(built, room.must, room.avoid);

    const id = `${shotId}--${room.slug}-${Date.now().toString(36).slice(-4)}`;
    ui.scenes.running = { id, shotId, preset: room.slug, state: "starting" };
    ui.scenes.made += 1;
    renderQueueBar();

    /*
     * The key lives in one place: framework-site/.env. The dev server proxies
     * /api/ai-* and /api/scene-airtable to the live functions and sets
     * `x-framework-key` itself, so nothing the browser sends matters locally.
     * Served from anywhere else, the gate is real and is asked properly.
     */
    return authorise()
      .then(() => renderAsBase64(shotId))
      .then((reference) => window.FrameworkSceneJobs.generate({
        prompt,
        imageBase64: reference.base64,
        mimeType: reference.mimeType,
        onState: (state) => {
          if (ui.scenes.running && ui.scenes.running.id === id) {
            ui.scenes.running.state = state;
            renderQueueBar();
          }
        }
      }))
      .then((result) => post(SCENE_IMAGE_URL, { id, dataUrl: result.dataUrl }).then(() => result))
      .then(() => {
        const row = {
          id,
          shotId,
          code: shotRow ? shotRow.code : shotId.split("-")[0],
          preset: room.preset ? room.preset.id : null,
          presetName: room.name,
          archetype: params.archetype || null,
          // Which brief asked for this, so a batch can be found again.
          brief: room.brief || null,
          params,
          note: settings.note || "",
          verdict: null,
          at: new Date().toISOString(),
          // The whole provenance, so a picture can always be traced back to the
          // shelf, the angle and the room it came from.
          shot: shotRow ? {
            yawDeg: shotRow.yawDeg,
            finish: shotRow.finish,
            cameraMm: shotRow.cameraMm,
            scaleFigureMm: shotRow.scaleFigureMm
          } : null
        };
        ui.scenes.running = null;
        ui.sceneRecords[row.id] = row;
        post(SCENES_URL, row).catch((error) => warn(`scene not recorded: ${error.message}`));
        drainScenes();
        renderQueueBar();
        render();
        return row;
      })
      .catch((error) => {
        ui.scenes.running = null;
        ui.scenes.failed += 1;
        warn(`scene failed: ${error.message}`);
        drainScenes();
        renderQueueBar();
        return null;
      });
  }

  /**
   * Put this render in a room, by hand.
   *
   * It joins a queue rather than starting immediately, because the generator
   * runs one at a time and a button that silently does nothing when it is busy
   * is worse than no button. The cap is not waived: a scene asked for by hand
   * costs exactly what one claimed automatically costs.
   */
  function pushScene(shotId, options) {
    const settings = options || {};
    const redo = Boolean(settings.preset || settings.params || settings.note);
    /*
     * A plain push is "put this render in a room", and asking for it twice is a
     * double-click rather than a wish for two rooms. A redo names a preset, or
     * the params that made a picture, or carries a note, and asking for that
     * twice is deliberate: the whole point of rolling again is that the same
     * request gives a different picture.
     */
    if (!redo) {
      if (ui.scenes.running && ui.scenes.running.shotId === shotId) {
        setStatus(`${shotId} is being put in a room now.`);
        return;
      }
      if (ui.scenes.pending.some((job) => job.shotId === shotId)) {
        setStatus(`${shotId} is already waiting for a room.`);
        return;
      }
    }
    /*
     * A brief may want several rooms of each render, and asks for them here,
     * with the number it named. Each one still spends the budget and still
     * waits its turn; a redo is one picture, whatever the brief says.
     */
    const rooms = redo ? 1 : roomsPerRender();
    for (let n = 0; n < rooms; n += 1) {
      ui.scenes.pending.push({
        shotId,
        preset: settings.preset || null,
        params: settings.params || null,
        name: settings.name || null,
        slug: settings.slug || null,
        brief: settings.brief || null,
        note: settings.note || ""
      });
    }
    // Claimed by hand, so the automatic leg must not claim it again.
    ui.scenes.seen.add(shotId);
    drainScenes();
    renderQueueBar();
    // drainScenes may have started this one outright; say which happened.
    setStatus(ui.scenes.running && ui.scenes.running.shotId === shotId
      ? `putting ${shotId} in ${rooms > 1 ? `${rooms} rooms` : "a room"}…`
      : `${shotId} queued for ${rooms > 1 ? `${rooms} rooms` : "a room"}, ${ui.scenes.pending.length} waiting.`);
  }

  /** Start the next waiting scene, if there is budget and nothing running. */
  function drainScenes() {
    if (ui.scenes.running || !ui.scenes.pending.length) return;
    if (ui.scenes.made >= ui.scenes.cap) {
      setStatus(`scene budget spent (${ui.scenes.cap}). Raise it to carry on.`);
      return;
    }
    const job = ui.scenes.pending.shift();
    generateScene(job.shotId, {
      preset: job.preset || undefined,
      params: job.params || undefined,
      name: job.name || undefined,
      slug: job.slug || undefined,
      brief: job.brief || undefined,
      note: job.note || undefined
    });
  }

  /**
   * A render that has just finished in this sitting and has not been put in a
   * room yet.
   *
   * The dev server's queue is in memory and outlives the page, so a reload
   * arrives to find yesterday's finished renders still listed as done. Without
   * the first pass below, opening the studio would spend the scene budget on a
   * backlog nobody asked for, before the page had even drawn a shelf.
   */
  function claimFinishedRenders() {
    if (ui.scenes.firstPass) {
      ui.scenes.firstPass = false;
      for (const entry of ui.queue.done || []) ui.scenes.seen.add(entry.id);
      return;
    }
    // What was asked for by hand goes before what merely finished rendering.
    drainScenes();
    if (!ui.autoScene || ui.scenes.running || ui.scenes.pending.length) return;
    const done = ui.queue.done || [];
    for (const entry of done) {
      if (ui.scenes.seen.has(entry.id)) continue;
      if (ui.scenes.made >= ui.scenes.cap) {
        setStatus(`scene budget spent (${ui.scenes.cap}). Raise it to carry on.`);
        return;
      }
      // Through the same queue a hand push uses, so a brief's count applies.
      pushScene(entry.id);
      return;
    }
  }

  /**
   * Send a kept scene down the content pipeline.
   *
   * Two staged uploads then a commit, which is the shape /api/scene-airtable
   * already has: the render goes up as the `source` and the generated picture
   * as the `output`, and the design code ties the Airtable record back to the
   * shelf. `sourceIsBlenderRender` is true here and always will be; every
   * source this flow produces is one.
   */
  function pushToAirtable(row) {
    const submissionId = row.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    const stage = (slot, blob, filename) => window.FrameworkGate.fetch(
      `/api/scene-airtable?submission=${encodeURIComponent(submissionId)}` +
      `&slot=${slot}&filename=${encodeURIComponent(filename)}`,
      { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob }
    ).then((response) => {
      if (!response.ok) return response.text().then((detail) => { throw new Error(`${slot}: ${detail.slice(0, 160)}`); });
      return response;
    });

    const asBlob = (url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`could not read ${url}`);
      return response.blob();
    });

    setStatus("sending to the content pipeline…");
    return authorise()
      .then(() => Promise.all([
        asBlob(`/api/design-lab/render/image?id=${encodeURIComponent(row.shotId)}`),
        asBlob(`${SCENE_IMAGE_URL}?id=${encodeURIComponent(row.id)}`)
      ]))
      .then(([source, output]) => stage("source", source, `${row.shotId}.png`)
        .then(() => stage("output", output, `${row.id}.jpg`)))
      .then(() => window.FrameworkGate.fetch("/api/scene-airtable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId,
          configCode: row.code,
          sourceIsBlenderRender: true,
          sourceFilename: `${row.shotId}.png`,
          outputFilename: `${row.id}.jpg`
        })
      }))
      .then((response) => {
        if (!response.ok) return response.text().then((detail) => { throw new Error(detail.slice(0, 200)); });
        setStatus(`${row.code} sent to the content pipeline.`);
        return true;
      })
      .catch((error) => {
        warn(`could not send to Airtable: ${error.message}`);
        return false;
      });
  }

  // ------------------------------------------------------------ sections ---

  /*
   * "Yes" and "maybe" are the same answer.
   *
   * The bench this replaced offered keep / maybe / reject and the record is
   * mostly maybes. Both count as taken wherever the record is read.
   */
  const TAKEN = new Set(["keep", "maybe"]);

  /**
   * The shelves worth carrying forward: taken, and not already replaced by an
   * edit. A superseded design is still in the record and still says what it
   * said, but showing both is showing the same shelf twice, once out of date.
   */
  function takenShelves() {
    const rows = Object.values(ui.verdicts).filter((row) => TAKEN.has(row.verdict) && row.design);
    const replaced = new Set(rows.map((row) => row.supersedes).filter(Boolean));
    return rows.filter((row) => !replaced.has(row.code));
  }

  function sizeLine(shelf) {
    const size = shelf.shelfSizeMm || shelf.sizeMm;
    if (!size) return "";
    return `${Math.round(size.widthMm / 10)} × ${Math.round(size.depthMm / 10)} × ` +
      `${Math.round(size.heightMm / 10)} cm · ${shelf.pieceCount} pieces` +
      (shelf.totalKsh ? ` · Ksh ${Number(shelf.totalKsh).toLocaleString("en-KE")}` : "");
  }

  function modulesLine(shelf) {
    return Object.entries(shelf.moduleCounts || {})
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${count} × ${(ui.catalog.modules[id] || {}).label || id}`)
      .join(" · ");
  }

  /**
   * Every shelf on the bench: the corpus, with its verdicts marked, and the
   * shelves taken in earlier batches, because views, renders and scenes
   * descend from those and this grid is where they are reached from.
   *
   * Shelves rejected in earlier batches are not here even when rejected ones
   * are shown: there are thirteen hundred of them, nothing descends from them,
   * and drawing them all is a minute of WebGL for nothing to do.
   */
  function shelfRows() {
    const superseded = new Set(Object.values(ui.verdicts).map((row) => row.supersedes).filter(Boolean));
    const rows = [];
    const seen = new Set();
    for (const record of ui.designs) {
      const judged = ui.verdicts[record.fingerprint] || null;
      seen.add(record.fingerprint);
      rows.push(shelfRow(judged || record, judged ? judged.verdict : null));
    }
    for (const row of Object.values(ui.verdicts)) {
      if (seen.has(row.fingerprint) || !TAKEN.has(row.verdict) || !row.design) continue;
      if (superseded.has(row.code)) continue;
      seen.add(row.fingerprint);
      rows.push(shelfRow(row, row.verdict));
    }
    return rows;
  }

  function shelfRow(shelf, verdict) {
    const size = shelf.shelfSizeMm;
    return {
      kind: "shelf",
      key: shelf.fingerprint,
      code: shelf.code,
      title: shelf.code,
      subtitle: (size ? `${Math.round(size.widthMm / 10)} × ${Math.round(size.heightMm / 10)} cm · ${shelf.pieceCount} pieces` : "")
        + (verdict ? ` · ${verdict}` : ""),
      design: shelf.design,
      shelf,
      verdict,
      note: shelf.note || "",
      rejected: verdict === "reject",
      judged: Boolean(verdict),
      href: shelf.url ? shelf.url.replace(/^https:\/\/framework\.co\.ke/, "") : null
    };
  }

  /**
   * Every angle on the bench: the ones planned this sitting, and the ones on
   * record from earlier sittings. A rendered view shows its render; a view
   * planned this sitting shows its preview; a view only on record has no
   * picture until its shelf is planned again, and the bar above the grid
   * offers to do that.
   */
  function viewRows() {
    const rendered = new Set(ui.queue.rendered || []);
    const waiting = new Set(ui.queue.waiting || []);
    const ids = new Set([...Object.keys(ui.views), ...Object.keys(ui.shotVerdicts)]);
    const rows = [];
    for (const id of ids) {
      const shot = ui.views[id] || null;
      const row = ui.shotVerdicts[id] || null;
      const source = shot || row;
      const verdict = row ? row.verdict : null;
      const state = rendered.has(id) ? "rendered"
        : ui.queue.running === id ? "rendering"
        : waiting.has(id) ? "queued"
        : verdict === "render" ? "approved, not rendered"
        : verdict === "skip" ? "turned down"
        : "planned";
      const settled = ["rendered", "rendering", "queued"].includes(state);
      rows.push({
        kind: "view",
        key: id,
        code: source.code,
        title: source.code,
        subtitle: `${source.yawDeg}° · ${finishById(source.finish).displayName} · ${state}`,
        image: state === "rendered"
          ? `/api/design-lab/render/image?thumb=1&id=${encodeURIComponent(id)}`
          : shot ? shot.preview : null,
        blank: state === "rendered" || shot ? null : "not planned",
        state,
        shot,
        row,
        verdict,
        note: row ? row.note || "" : "",
        rejected: verdict === "skip",
        judged: settled || verdict === "render" || verdict === "skip"
      });
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Every scene on record. A scene may carry `fidelity` from the audit script
   * (scripts/audit-scenes.mjs, through the scenes store): a score, a pass or
   * fail, and what it found. Passers come first, then the unscored; a failure
   * is hidden with the rejected, because the audit is cheaper than a person
   * and its no is worth the same as theirs until somebody looks.
   */
  function sceneRows() {
    const rows = Object.values(ui.sceneRecords).map((scene) => {
      const fidelity = scene.fidelity && typeof scene.fidelity === "object" ? scene.fidelity : null;
      const failed = Boolean(fidelity && fidelity.verdict === "fail");
      return {
        kind: "scene",
        key: scene.id,
        code: scene.code,
        title: scene.code,
        subtitle: `${scene.presetName || scene.preset}${scene.verdict ? ` · ${scene.verdict}` : failed ? " · failed the audit" : " · unjudged"}`,
        image: `${SCENE_IMAGE_URL}?thumb=1&id=${encodeURIComponent(scene.id)}`,
        scene,
        fidelity,
        verdict: scene.verdict,
        tone: scene.verdict || (failed ? "fail" : null),
        // A redo with nothing to say is sent with a blank note, so it is not
        // taken for a double-click; that blank is not a note to show.
        note: String(scene.note || "").trim(),
        // Again is "not this room", which is a no with a reason attached.
        rejected: scene.verdict === "reject" || scene.verdict === "again" || failed,
        judged: Boolean(scene.verdict)
      };
    });
    const rank = (row) => (!row.fidelity ? 1 : row.fidelity.verdict === "fail" ? 2 : 0);
    const score = (row) => (row.fidelity && Number.isFinite(Number(row.fidelity.score)) ? Number(row.fidelity.score) : 0);
    return rows.sort((a, b) => rank(a) - rank(b) || score(b) - score(a));
  }

  function allRows(section) {
    return section === "shelves" ? shelfRows() : section === "views" ? viewRows() : sceneRows();
  }

  /** What a section's grid shows. Rejected items are out of it unless asked for. */
  function sectionRows(section) {
    const rows = allRows(section);
    return ui.showRejected[section] ? rows : rows.filter((row) => !row.rejected);
  }

  /** What a section's flow walks: the rows that have not been answered. */
  function flowRows(section) {
    return allRows(section).filter((row) => !row.rejected && !row.judged);
  }

  // ------------------------------------------------------------- judging ---

  /**
   * The buttons for one row, and what each writes. The grid shows the verdicts
   * that are answers; the flow adds the two that are not: Skip, which only
   * moves on, and Again, which asks for another room.
   */
  const VERDICTS = {
    shelf: [
      ["keep", "Yes", "→", "keep"],
      ["maybe", "Maybe", "↑", "maybe"],
      ["later", "Skip", "↓", "later"],
      ["reject", "No", "←", "reject"]
    ],
    view: [
      ["render", "Render", "→", "keep"],
      ["later", "Skip", "↓", "later"],
      ["skip", "No", "←", "reject"]
    ],
    scene: [
      ["keep", "Keep", "→", "keep"],
      ["again", "Again", "↑", "again"],
      ["later", "Skip", "↓", "later"],
      ["reject", "No", "←", "reject"]
    ]
  };
  const FLOW_ONLY = new Set(["later", "again"]);

  function judge(row, verdict, note) {
    if (verdict === "later") {
      step(1);
      return;
    }
    if (row.kind === "shelf") judgeShelf(row, verdict, note);
    else if (row.kind === "view") judgeView(row, verdict, note);
    else judgeScene(row.scene, verdict, note);
  }

  /**
   * Yes to a shelf: write the verdict, then plan its angles into Views.
   *
   * The verdict is written first and the angles asked for second, so a design
   * is never judged twice because the planner was slow. The angles wait in
   * Views; nothing here moves you there.
   */
  function judgeShelf(row, verdict, note) {
    const written = recordDesign(row.shelf, verdict, note);
    if (TAKEN.has(verdict) && !viewsOf(written.code).length) loadViews([written], {});
    render();
  }

  /** Yes to an angle: queue the render now. No: say so, and why. */
  function judgeView(row, verdict, note) {
    const base = row.shot
      ? shotRow(row.shot, verdict)
      : Object.assign({}, row.row, { verdict, at: new Date().toISOString() });
    base.note = note || (row.row && row.row.note) || "";
    ui.shotVerdicts[base.id] = base;
    post(SHOTS_URL, base).catch((error) => warn(`shot verdict not saved: ${error.message}`));
    if (verdict === "render") {
      post(RENDER_URL, base)
        .then((result) => {
          if (result.state) ui.queue = result.state;
          renderQueueBar();
          render();
        })
        .catch((error) => warn(`render not queued: ${error.message}`));
    }
    render();
  }

  /**
   * Keep sends a scene down the content pipeline, No forgets it, Again puts
   * the same shelf into a different room: the next one on the cycle, plus
   * whatever you type. The shelf and the angle already passed, so what is
   * being sent back is the room.
   */
  function judgeScene(scene, verdict, note) {
    scene.verdict = verdict;
    scene.note = note || scene.note || "";
    scene.judgedAt = new Date().toISOString();
    ui.sceneRecords[scene.id] = scene;
    post(SCENES_URL, scene).catch((error) => warn(`scene verdict not saved: ${error.message}`));
    if (verdict === "keep") pushToAirtable(scene);
    if (verdict === "again") pushScene(scene.shotId, { note: note || " " });
    render();
  }

  // --------------------------------------------------------------- views ---

  function viewsOf(code) {
    return Object.values(ui.views).filter((shot) => shot.code === code);
  }

  /**
   * The angles for a shelf, planned and drawn.
   *
   * Planned rather than reloaded, because a shot's record carries where the
   * camera ended up and not the geometry the planner needed to put it there.
   * The planner is deterministic about all of that, so re-running it gives
   * back the same angles under the same ids; only the colour is rolled, and a
   * colour already on record is kept so a view does not change finish between
   * sittings.
   *
   * A queue, not a blocking call: a run of Yes in the grid should not wait for
   * the planner between each. Planning goes on behind the judging.
   */
  function loadViews(shelves, options) {
    const settings = options || {};
    for (const shelf of shelves) {
      if (!shelf || !shelf.design) continue;
      if (ui.planning.some((job) => job.shelf.code === shelf.code)) continue;
      // A view nobody has answered for yet is still worth writing down; it is
      // how a later sitting knows this shelf has angles at all. Except when the
      // planning was passive: opening a picture to look at what it came from
      // should not leave marks in the record.
      ui.planning.push({ shelf, record: settings.record !== false });
    }
    if (settings.jump) {
      ui.section = "views";
      ui.mode = "grid";
      ui.detail = null;
    }
    drainPlanning();
    render();
  }

  let planningNow = false;
  function drainPlanning() {
    if (planningNow || !ui.planning.length) return;
    planningNow = true;
    const job = ui.planning.shift();
    const shelf = job.shelf;
    setStatus(`planning views for ${shelf.code}${ui.planning.length ? ` (${ui.planning.length} more waiting)` : ""}…`);
    post(PLAN_URL, { code: shelf.code, design: shelf.design, note: shelf.note || "", angles: 4 })
      .then((result) => Promise.all((result.shots || []).map((shot) => {
        const known = ui.shotVerdicts[shot.id];
        if (known && known.finish) shot.finish = known.finish;
        return drawShot(shot).then(() => {
          if (known || !job.record) return null;
          const planned = shotRow(shot, "planned");
          ui.shotVerdicts[shot.id] = planned;
          return post(SHOTS_URL, planned)
            .catch((error) => warn(`view not saved: ${error.message}`));
        });
      })))
      .then(() => setStatus(ui.planning.length ? "" : `${Object.keys(ui.views).length} views ready.`))
      .catch((error) => warn(`could not plan views for ${shelf.code}: ${error.message}`))
      .then(() => {
        planningNow = false;
        render();
        drainPlanning();
      });
  }

  /** Send one view to the renderer, and say so on its record. */
  function renderView(shot) {
    judgeView({ shot, row: ui.shotVerdicts[shot.id] || null }, "render", "");
  }

  /**
   * Put a run of approved shots into the render queue.
   *
   * One request each, in order, because the queue is the server's and it runs
   * them one at a time anyway. Pause still works: it stops the next one
   * starting, it does not empty what has been asked for.
   */
  function queueShots(shots) {
    if (!shots.length || ui.busy) return;
    ui.busy = true;
    setStatus(`queueing ${shots.length} renders…`);
    let queued = 0;
    const step = () => {
      const shot = shots[queued];
      if (!shot) {
        ui.busy = false;
        setStatus(`${queued} renders queued.`);
        refreshQueue();
        render();
        return;
      }
      queued += 1;
      post(RENDER_URL, shot)
        .then((result) => {
          if (result.state) ui.queue = result.state;
          renderQueueBar();
          step();
        })
        .catch((error) => {
          ui.busy = false;
          warn(`could not queue ${shot.id}: ${error.message}`);
        });
    };
    step();
  }

  // ------------------------------------------------------------- editing ---

  /**
   * Replace a shelf with an edited one, from its /builder link.
   *
   * The edit itself happens in /builder, because that is the one place that
   * knows what a legal placement is, and a second editor on the bench would be
   * a worse one. The replacement is written as a NEW row naming the shelf it
   * supersedes: a verdict belongs to the shelf it was given to, and rewriting
   * it in place would quietly restate what was judged.
   */
  function saveEditedShelf(shelf, code) {
    if (ui.busy) return;
    ui.busy = true;
    setStatus("reading that design code…");
    post(DECODE_URL, { code })
      .then((result) => {
        const design = result.design;
        if (design.fingerprint === shelf.fingerprint) {
          throw new Error("that is the same shelf, nothing to replace");
        }
        const row = {
          fingerprint: design.fingerprint,
          code: design.code,
          verdict: shelf.verdict,
          note: shelf.note || "",
          at: new Date().toISOString(),
          corpusSeed: ui.corpus.seed,
          supersedes: shelf.code,
          sizeMm: design.sizeMm,
          shelfSizeMm: design.shelfSizeMm,
          pieceCount: design.pieceCount,
          moduleCounts: design.moduleCounts,
          totalKsh: design.totalKsh,
          url: design.url,
          design: design.design
        };
        ui.verdicts[row.fingerprint] = row;
        ui.editing = null;
        // The old shelf's views belong to the old shelf. Dropping them here
        // stops the Views grid offering angles of a shape that no longer exists.
        for (const shot of viewsOf(shelf.code)) delete ui.views[shot.id];
        return post(DESIGN_URL, row).then(() => {
          ui.busy = false;
          const warnings = (result.warnings || []).length
            ? `, but it breaks ${result.warnings.join(", ")}`
            : "";
          setStatus(`${shelf.code} replaced by ${row.code}${warnings}.`);
          render();
        });
      })
      .catch((error) => {
        ui.busy = false;
        warn(`could not read that code: ${error.message}`);
      });
  }

  /** The code of one shelf, open for editing in its own cell. */
  function editor(shelf) {
    const wrap = make("div", "dl-edit");
    wrap.appendChild(make("p", "dl-hint",
      "Open it in the builder, change it there, then paste the address back."));
    const field = make("textarea", "dl-edit-code");
    field.value = shelf.url || "";
    field.spellcheck = false;
    field.rows = 3;
    wrap.appendChild(field);

    const buttons = make("div", "dl-cell-actions");
    const save = make("button", "dl-cell-btn is-go", "Replace");
    save.type = "button";
    save.addEventListener("click", () => saveEditedShelf(shelf, field.value.trim()));
    const cancel = make("button", "dl-cell-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { ui.editing = null; render(); });
    buttons.appendChild(save);
    buttons.appendChild(cancel);
    wrap.appendChild(buttons);
    return wrap;
  }

  // -------------------------------------------------------------- detail ---

  /*
   * One picture, large, with everything it is related to underneath it.
   *
   * The grid answers "what is there"; this answers "where did this come from,
   * and what else came out of it". The four stages are laid out as strips
   * under the picture, for the whole shelf rather than for the one line
   * through it: a view usually has more than one render's worth of history and
   * a render more than one room, and those branches are exactly what you want
   * to compare. The picture you are looking at is marked, and so is the branch
   * it belongs to.
   */

  const STAGES = [
    ["shelf", "Shelf"],
    ["view", "Views"],
    ["render", "Renders"],
    ["scene", "Scenes"]
  ];

  function openDetail(kind, key) {
    ui.detail = { kind, key };
    const item = itemFor(kind, key);
    render();
    /*
     * The strips are only honest if the views are there to put in them, and
     * views are planned per sitting rather than reloaded. Planned quietly here,
     * writing nothing: looking at a picture should not judge anything.
     */
    if (item && item.code && !viewsOf(item.code).length) {
      const shelf = shelfNamed(item.code);
      if (shelf && shelf.design) loadViews([shelf], { record: false });
    }
  }

  function closeDetail() {
    ui.detail = null;
    render();
  }

  function shelfNamed(code) {
    return Object.values(ui.verdicts).find((row) => row.code === code && row.design)
      || ui.designs.find((record) => record.code === code)
      || null;
  }

  /**
   * One row of the record, whatever stage it is from, in one shape.
   *
   * `code` is the shelf it descends from and `branch` the shot id it belongs
   * to; those two are the whole of what relates anything here to anything
   * else.
   */
  function itemFor(kind, key) {
    if (kind === "shelf") {
      const shelf = ui.verdicts[key] || ui.designs.find((record) => record.fingerprint === key) || shelfNamed(key);
      return shelf ? { kind, key, code: shelf.code, branch: null, title: shelf.code, shelf } : null;
    }
    if (kind === "view" || kind === "render") {
      const view = ui.views[key];
      const row = ui.shotVerdicts[key];
      if (!view && !row) return null;
      const code = (view || row).code;
      return { kind, key, code, branch: key, title: key, view, row };
    }
    const scene = ui.sceneRecords[key];
    return scene
      ? { kind, key, code: scene.code, branch: scene.shotId, title: scene.presetName || scene.preset, scene }
      : null;
  }

  /** The picture for an item: its own if there is one, else null to be drawn. */
  function pictureOf(item, small) {
    if (item.kind === "render") {
      return `/api/design-lab/render/image?${small ? "thumb=1&" : ""}id=${encodeURIComponent(item.key)}`;
    }
    if (item.kind === "scene") {
      return `${SCENE_IMAGE_URL}?${small ? "thumb=1&" : ""}id=${encodeURIComponent(item.key)}`;
    }
    if (item.kind === "view") return item.view ? item.view.preview : null;
    return null; // a shelf has no picture on disk; it is drawn from its geometry
  }

  /** Everything descended from one shelf, stage by stage. */
  function lineage(code) {
    const shelf = shelfNamed(code);
    const ids = [...new Set([
      ...Object.values(ui.views).filter((shot) => shot.code === code).map((shot) => shot.id),
      ...Object.values(ui.shotVerdicts).filter((row) => row.code === code).map((row) => row.id)
    ])].sort();
    const rendered = new Set(ui.queue.rendered || []);
    return {
      shelf: shelf ? [shelf.fingerprint] : [],
      view: ids,
      render: ids.filter((id) => rendered.has(id)),
      scene: Object.values(ui.sceneRecords)
        .filter((row) => row.code === code)
        .sort((a, b) => String(a.at).localeCompare(String(b.at)))
        .map((row) => row.id)
    };
  }

  /** One small picture in a strip, which is also the way to move to it. */
  function tile(kind, key, current) {
    const item = itemFor(kind, key);
    const button = make("button", "dl-tile");
    button.type = "button";
    if (!item) {
      button.disabled = true;
      button.appendChild(make("div", "dl-blank", "gone"));
      button.appendChild(make("span", "dl-tile-label", key));
      return button;
    }
    const isCurrent = current.kind === kind && current.key === key;
    // The branch the picture in front of you belongs to, softly, so a shelf
    // with four angles and nine scenes still reads as which came from which.
    const onBranch = Boolean(current.branch) && item.branch === current.branch;
    button.classList.toggle("is-current", isCurrent);
    button.classList.toggle("is-branch", !isCurrent && onBranch);

    const source = pictureOf(item, true);
    if (source) {
      const image = make("img");
      image.alt = item.title;
      image.loading = "lazy";
      image.src = source;
      button.appendChild(image);
    } else if (item.kind === "shelf" && item.shelf.design) {
      const image = make("img");
      image.alt = item.title;
      button.appendChild(image);
      shelfImage(item.shelf).then((drawn) => { image.src = drawn; });
    } else {
      button.appendChild(make("div", "dl-blank", item.kind === "view" ? "not planned" : ""));
    }
    button.appendChild(make("span", "dl-tile-label", tileLabel(item)));
    button.addEventListener("click", () => openDetail(kind, key));
    return button;
  }

  function tileLabel(item) {
    if (item.kind === "shelf") return item.shelf.code;
    if (item.kind === "scene") return item.scene.presetName || item.scene.preset;
    const yaw = item.view ? item.view.yawDeg : item.row && item.row.yawDeg;
    return yaw == null ? item.key : `${yaw}°`;
  }

  function strip(label, kind, keys, current) {
    const row = make("div", "dl-strip");
    const head = make("div", "dl-strip-head");
    head.appendChild(make("h3", null, label));
    head.appendChild(make("span", "dl-strip-count", String(keys.length)));
    row.appendChild(head);
    if (!keys.length) {
      row.appendChild(make("p", "dl-hint", kind === "scene"
        ? "No rooms yet. Put a render in one."
        : kind === "render" ? "Nothing rendered from this shelf yet." : "None."));
      return row;
    }
    const tiles = make("div", "dl-tiles");
    for (const key of keys) tiles.appendChild(tile(kind, key, current));
    row.appendChild(tiles);
    return row;
  }

  /**
   * What can be done to the thing on screen.
   *
   * The same buttons the grid offers, plus, for a scene, the two ways of
   * asking again, which is the question the grid has no room for.
   */
  function detailActions(item) {
    const box = make("div", "dl-detail-actions");
    const add = (label, onClick, className) => {
      const button = make("button", `dl-cell-btn${className ? ` ${className}` : ""}`, label);
      button.type = "button";
      button.disabled = ui.busy;
      button.addEventListener("click", onClick);
      box.appendChild(button);
      return button;
    };

    if (item.kind === "shelf") {
      add("Edit code", () => { ui.editing = ui.editing === item.shelf.fingerprint ? null : item.shelf.fingerprint; render(); });
      add(viewsOf(item.code).length ? "Re-plan views" : "Create views", () => loadViews([item.shelf], {}));
      return box;
    }

    if (item.kind === "view") {
      const rendered = new Set(ui.queue.rendered || []).has(item.key);
      const queued = (ui.queue.waiting || []).includes(item.key) || ui.queue.running === item.key;
      if (!rendered && !queued && item.view) add("Render", () => renderView(item.view), "is-go");
      if (rendered) add("Put in a room", () => pushScene(item.key), "is-go");
      return box;
    }

    if (item.kind === "render") {
      add("Put in a room", () => pushScene(item.key), "is-go");
      return box;
    }

    // A scene. The note is shared by both ways of asking again.
    const scene = item.scene;
    const note = make("textarea", "dl-note");
    note.placeholder = "What to change, if you ask again…";
    note.value = scene.note || "";

    const wrap = make("div", "dl-scene-panel");
    wrap.appendChild(note);

    /*
     * Two dissatisfactions, two buttons.
     *
     * "The room is right, the picture is not" wants the same request rolled
     * again, because the model is not deterministic and the next one is a
     * genuinely different photograph of the same idea. "The room is wrong for
     * this shelf" wants the next room on the cycle.
     *
     * Neither judges this picture. It stays exactly as it was, so the answer
     * can be given once both are on the table; the one thing worth avoiding
     * is throwing away a picture that has already been paid for.
     */
    const again = make("div", "dl-detail-actions");
    const sameRoom = make("button", "dl-cell-btn", "Same room again");
    sameRoom.type = "button";
    sameRoom.title = "The same request, rolled again: a different photograph of the same idea";
    sameRoom.addEventListener("click", () => {
      // The request as it was made, whether a preset or a brief drew it.
      if (!scene.params) { warn(`${scene.id} did not record its request`); return; }
      pushScene(scene.shotId, {
        params: scene.params,
        preset: scene.preset ? window.FrameworkScenePresets.byId(scene.preset) : null,
        name: scene.presetName || scene.preset,
        slug: scene.preset || `brief-${String(scene.brief || "").replace(/[^A-Za-z0-9]+/g, "-")}`,
        brief: scene.brief || null,
        note: note.value.trim() || scene.note || " "
      });
    });
    const otherRoom = make("button", "dl-cell-btn", "Different room");
    otherRoom.type = "button";
    otherRoom.title = "The next room on the cycle";
    otherRoom.addEventListener("click", () => {
      pushScene(scene.shotId, { note: note.value.trim() || " " });
    });
    again.appendChild(sameRoom);
    again.appendChild(otherRoom);
    wrap.appendChild(again);

    const verdicts = make("div", "dl-detail-actions");
    const keep = make("button", "dl-cell-btn is-go", scene.verdict === "keep" ? "Kept" : "Keep");
    keep.type = "button";
    keep.disabled = scene.verdict === "keep";
    keep.addEventListener("click", () => judgeScene(scene, "keep", note.value.trim()));
    const no = make("button", "dl-cell-btn", "No");
    no.type = "button";
    no.addEventListener("click", () => {
      judgeScene(scene, "reject", note.value.trim());
      // A rejected scene leaves the grid, so there is nothing left to show.
      closeDetail();
    });
    verdicts.appendChild(keep);
    verdicts.appendChild(no);
    wrap.appendChild(verdicts);
    wrap.appendChild(make("p", "dl-hint",
      "Asking again queues another picture and leaves this one alone. Judge it once you have both."));
    return wrap;
  }

  /** The facts about the thing on screen, under its picture. */
  function detailFacts(item) {
    const lines = [];
    if (item.kind === "shelf") {
      const shelf = item.shelf;
      if (shelf.shelfSizeMm || shelf.sizeMm) lines.push(sizeLine(shelf));
      if (shelf.moduleCounts) lines.push(modulesLine(shelf));
      if (shelf.supersedes) lines.push(`Replaced ${shelf.supersedes}.`);
      if (shelf.verdict) lines.push(`Answered: ${shelf.verdict}.${shelf.note ? ` Note: ${shelf.note}` : ""}`);
    } else if (item.kind === "view" || item.kind === "render") {
      const row = item.view || item.row;
      lines.push(`${row.yawDeg}° · ${finishById(row.finish).displayName} · from ${item.code}`);
      const verdict = item.row ? item.row.verdict : "planned";
      lines.push(`Answered: ${verdict || "not yet"}.${item.row && item.row.note ? ` Note: ${item.row.note}` : ""}`);
    } else {
      const scene = item.scene;
      lines.push(`${scene.presetName || scene.preset} · from ${scene.shotId}`);
      if (scene.params) {
        lines.push(`${scene.params.scene} · ${scene.params.light} · ${scene.params.persona} · ${scene.params.fullness}`);
      }
      lines.push(scene.verdict ? `Answered: ${scene.verdict}.` : "Not answered yet.");
      if (scene.note) lines.push(`Note: ${scene.note}`);
    }
    return lines;
  }

  function renderDetail() {
    const item = itemFor(ui.detail.kind, ui.detail.key);
    if (!item) {
      // The record moved under it: an edited shelf, a rejected scene.
      ui.detail = null;
      render();
      return;
    }

    const wrap = make("div", "dl-detail");
    const back = make("button", "dl-skip", "‹ Back to the grid");
    back.type = "button";
    back.addEventListener("click", closeDetail);
    wrap.appendChild(back);

    const figure = make("div", "dl-detail-figure");
    const image = make("img");
    image.alt = item.title;
    const source = pictureOf(item, false);
    if (source) image.src = source;
    else if (item.kind === "shelf" && item.shelf.design) {
      shelfImage(item.shelf).then((drawn) => { image.src = drawn; });
    }
    figure.appendChild(image);
    wrap.appendChild(figure);

    const head = make("div", "dl-detail-head");
    head.appendChild(make("p", "dl-position", STAGES.find(([id]) => id === item.kind)[1]));
    head.appendChild(make("h2", "dl-code", item.title));
    for (const line of detailFacts(item)) head.appendChild(make("p", "dl-modules", line));
    if (item.kind === "shelf" && item.shelf.url) {
      const open = make("a", "dl-open", "Open in the builder");
      open.href = item.shelf.url.replace(/^https:\/\/framework\.co\.ke/, "");
      open.target = "_blank";
      open.rel = "noopener";
      head.appendChild(open);
    }
    head.appendChild(detailActions(item));
    if (item.kind === "shelf" && ui.editing === item.shelf.fingerprint) {
      head.appendChild(editor(item.shelf));
    }
    wrap.appendChild(head);

    const tree = lineage(item.code);
    const strips = make("div", "dl-strips");
    for (const [kind, label] of STAGES) strips.appendChild(strip(label, kind, tree[kind], item));
    wrap.appendChild(strips);

    dom.stage.replaceChildren(wrap);
  }

  // ---------------------------------------------------------------- grid ---

  /**
   * The verdict buttons for one row. Small in a grid cell, large with the key
   * hints in a flow card; the same verdicts either way, so what the grid
   * writes and what the flow writes cannot drift apart.
   */
  function verdictButtons(row, options) {
    const settings = options || {};
    const large = settings.large === true;
    const box = make("div", large ? `dl-actions dl-actions-${VERDICTS[row.kind].length}` : "dl-cell-verdicts");
    for (const [id, label, hint, tone] of VERDICTS[row.kind]) {
      if (!large && FLOW_ONLY.has(id)) continue;
      const button = make("button", large ? `dl-verdict dl-verdict-${tone}` : `dl-cell-btn dl-tone-${tone}`);
      button.type = "button";
      button.classList.toggle("is-on", row.verdict === id);
      button.disabled = ui.busy;
      if (large) {
        button.appendChild(make("span", null, label));
        button.appendChild(make("small", null, hint));
      } else {
        button.textContent = label;
      }
      button.addEventListener("click", () => judge(row, id, settings.note ? settings.note() : ""));
      box.appendChild(button);
    }
    return box;
  }

  /** The buttons that move a row on by hand, beside its verdicts. */
  function rowActions(row) {
    if (row.kind === "shelf") {
      if (!TAKEN.has(row.verdict)) return [];
      return [
        ["Edit code", () => { ui.editing = ui.editing === row.key ? null : row.key; render(); }],
        [viewsOf(row.code).length ? "Views ›" : "Create views", () => loadViews([row.shelf], { jump: true })]
      ];
    }
    if (row.kind === "view") {
      // Only a finished render can be put in a room: the room is painted
      // around the picture, so there has to be a picture.
      return row.state === "rendered" ? [["Put in a room", () => pushScene(row.key)]] : [];
    }
    return [];
  }

  /** The verdict that is a no, for whatever kind of row this is. */
  function rejectIdFor(row) {
    return (VERDICTS[row.kind].find((entry) => entry[3] === "reject") || [])[0] || null;
  }

  function cell(row) {
    const tone = row.tone || row.verdict;
    const box = make("div", `dl-cell${tone ? ` is-${tone}` : ""}`);
    const image = make("img");
    image.alt = row.title;
    image.loading = "lazy";
    if (row.image) image.src = row.image;
    // The picture is the way in: click it to see it large, with everything
    // it came from and everything that came out of it underneath.
    const open = make("button", "dl-cell-open");
    open.type = "button";
    open.title = `See ${row.title} large, with what it is related to`;
    if (row.image || row.design) {
      open.appendChild(image);
    } else {
      // Nothing to show: say which of the several nothings this is.
      open.appendChild(make("div", "dl-blank", row.blank || row.state || ""));
    }
    // The audit's score, where there is one, in the corner of the picture.
    if (row.fidelity && row.fidelity.score != null) {
      const badge = make("span", "dl-badge", String(row.fidelity.score));
      badge.classList.toggle("is-pass", row.fidelity.verdict === "pass");
      badge.classList.toggle("is-fail", row.fidelity.verdict === "fail");
      badge.title = [`audit: ${row.fidelity.verdict || "scored"}`]
        .concat(Array.isArray(row.fidelity.issues) ? row.fidelity.issues : []).join("\n");
      open.appendChild(badge);
    }
    open.addEventListener("click", () =>
      openDetail(row.kind === "view" && row.state === "rendered" ? "render" : row.kind, row.key));
    box.appendChild(open);
    box.appendChild(make("span", "dl-cell-code", row.title));
    if (row.subtitle) box.appendChild(make("span", "dl-cell-note", row.subtitle));
    if (row.href) {
      const link = make("a", "dl-open", "Open in the builder");
      link.href = row.href;
      link.target = "_blank";
      link.rel = "noopener";
      box.appendChild(link);
    }

    // The verdicts, unless the row has moved past them: a view in the render
    // queue is answered by the queue.
    if (!(row.kind === "view" && ["rendered", "rendering", "queued"].includes(row.state))) {
      /*
       * One line for why not, where the no is. Whichever verdict is pressed
       * reads it, so a note can go with a yes too, and Enter in it is the no:
       * type the reason, press the key, the picture leaves the grid.
       */
      const why = make("input", "dl-cell-why");
      why.type = "text";
      why.placeholder = "why not…";
      why.value = row.note || "";
      why.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const no = rejectIdFor(row);
        if (no) judge(row, no, why.value.trim());
      });
      box.appendChild(why);
      box.appendChild(verdictButtons(row, { note: () => why.value.trim() }));
    }

    if (row.kind === "shelf" && ui.editing === row.key) {
      box.appendChild(editor(row.shelf));
    } else {
      const actions = rowActions(row);
      if (actions.length) {
        const bar = make("div", "dl-cell-actions");
        for (const [label, onClick] of actions) {
          const button = make("button", "dl-cell-btn", label);
          button.type = "button";
          button.disabled = ui.busy;
          button.addEventListener("click", onClick);
          bar.appendChild(button);
        }
        box.appendChild(bar);
      }
    }
    // A shelf has no picture on disk; it is drawn from its own geometry.
    if (!row.image && row.design) {
      shelfImage(row.shelf).then((source) => { image.src = source; });
    }
    return box;
  }

  /** The offer that fills a section's grid, when there is something to offer. */
  function sectionBars(section, rows) {
    const bars = [];
    const bar = (text, label, onClick) => {
      const box = make("div", "dl-browse-action");
      box.appendChild(make("span", "dl-hint", text));
      const button = make("button", "dl-more", label);
      button.type = "button";
      button.disabled = ui.busy;
      button.addEventListener("click", onClick);
      box.appendChild(button);
      bars.push(box);
    };

    if (section === "shelves" && !flowRows("shelves").length) {
      /*
       * A corpus runs out, and a page that says so and stops is a dead end
       * with the generator one directory away. Offer the next batch here,
       * where the question comes up. New shelves only: anything judged before
       * is skipped by its own identity.
       */
      bar(ui.busy ? "Growing more shelves…" : "Every shelf in this batch has been judged.",
        "Generate 60 more", () => growCorpus(60));
    }

    if (section === "views") {
      /*
       * Views are held for the sitting, not loaded from the record: what a
       * shot writes down is where its camera ended up, not the geometry the
       * planner needed to put it there. So after a reload the record plainly
       * says these shelves have angles and the grid has no pictures of them.
       * Say what it would take to fill it, and offer.
       */
      const loaded = new Set(Object.values(ui.views).map((shot) => shot.code));
      const queued = new Set(ui.planning.map((job) => job.shelf.code));
      const missing = takenShelves().filter((shelf) => !loaded.has(shelf.code) && !queued.has(shelf.code));
      if (missing.length) {
        bar(loaded.size
          ? `${missing.length} more taken ${missing.length === 1 ? "shelf has" : "shelves have"} views to plan.`
          : `Views are planned fresh each sitting. ${missing.length} taken ${missing.length === 1 ? "shelf is" : "shelves are"} waiting.`,
        `Plan views for ${missing.length}`, () => loadViews(missing, {}));
      }
      // A backlog of approved-but-unrendered shots is the commonest thing to
      // find here, and the queue is right there; offer to fill it.
      const approved = rows.filter((row) => row.state === "approved, not rendered");
      if (approved.length) {
        bar(`${approved.length} approved ${approved.length === 1 ? "view has" : "views have"} never been rendered.`,
          `Render all ${approved.length}`, () => queueShots(approved.map((row) => row.row)));
      }
    }
    return bars;
  }

  function renderGrid() {
    const section = ui.section;
    const rows = sectionRows(section);
    const wrap = make("div", "dl-browse");
    for (const bar of sectionBars(section, rows)) wrap.appendChild(bar);

    // The rejected are out of the grid, not out of the record. One line
    // brings them back, greyed, and takes them away again.
    const hidden = allRows(section).filter((row) => row.rejected).length;
    if (hidden) {
      const head = make("div", "dl-grid-head");
      const toggle = make("button", "dl-show-rejected",
        ui.showRejected[section] ? `hide the ${hidden} rejected` : `show ${hidden} rejected`);
      toggle.type = "button";
      toggle.classList.toggle("is-on", ui.showRejected[section]);
      toggle.addEventListener("click", () => {
        ui.showRejected[section] = !ui.showRejected[section];
        render();
      });
      head.appendChild(toggle);
      wrap.appendChild(head);
    }

    if (!rows.length) {
      wrap.appendChild(make("p", "dl-empty", ui.busy ? "Working…" : "Nothing here yet."));
      dom.stage.replaceChildren(wrap);
      return;
    }
    const grid = make("div", "dl-grid");
    for (const row of rows) grid.appendChild(cell(row));
    wrap.appendChild(grid);
    dom.stage.replaceChildren(wrap);
  }

  // ---------------------------------------------------------------- flow ---

  /**
   * Move through the section's unjudged items without answering them.
   *
   * Every other control on this page writes something down, and there was no
   * way to look at the previous shelf, or the angle before this one, without
   * either deciding about it or reloading the page. So `[` and `]`, and the
   * two arrows either side of the counter: they change nothing at all.
   */
  function step(by) {
    const rows = flowRows(ui.section);
    if (rows.length < 2) return;
    const at = Math.min(ui.flowAt[ui.section], rows.length - 1);
    ui.flowAt[ui.section] = (at + by + rows.length) % rows.length;
    render();
  }

  /** The counter, with an arrow either side of it. */
  function navRow(label, canMove) {
    const row = make("div", "dl-nav-row");
    const back = make("button", "dl-nav-step", "‹");
    back.type = "button";
    back.title = "Back, decides nothing ( [ )";
    back.disabled = !canMove;
    back.addEventListener("click", () => step(-1));

    const on = make("button", "dl-nav-step", "›");
    on.type = "button";
    on.title = "Forward, decides nothing ( ] )";
    on.disabled = !canMove;
    on.addEventListener("click", () => step(1));

    row.appendChild(back);
    row.appendChild(make("p", "dl-position", label));
    row.appendChild(on);
    return row;
  }

  /** The card's own note, read when a verdict is pressed. */
  function cardNote() {
    const field = dom.stage.querySelector(".dl-note");
    return field ? field.value.trim() : "";
  }

  function flowCard(row, at, rows) {
    const card = make("div", "dl-card");
    const figure = make("div", "dl-figure");
    const image = make("img");
    image.alt = row.title;
    figure.appendChild(image);
    card.appendChild(figure);

    const panel = make("div", "dl-panel");
    panel.appendChild(navRow(`${at + 1} of ${rows.length} to judge`, rows.length > 1));
    panel.appendChild(make("h2", "dl-code", row.title));

    if (row.kind === "shelf") {
      const shelf = row.shelf;
      shelfImage(shelf).then((source) => { image.src = source; });
      // Draw the next one while this is being looked at.
      if (rows[at + 1]) shelfImage(rows[at + 1].shelf);
      panel.appendChild(make("p", "dl-size", sizeLine(shelf)));
      panel.appendChild(make("p", "dl-modules", modulesLine(shelf)));
      if (row.href) {
        const open = make("a", "dl-open", "Open in the builder");
        open.href = row.href;
        open.target = "_blank";
        open.rel = "noopener";
        panel.appendChild(open);
      }
    } else if (row.kind === "view") {
      const source = row.shot || row.row;
      if (row.shot) {
        drawShot(row.shot).then((drawn) => { image.src = drawn; });
        if (rows[at + 1] && rows[at + 1].shot) drawShot(rows[at + 1].shot);
      } else {
        // On record but not planned this sitting: plan it quietly, and the
        // card fills in when the planner is done.
        figure.replaceChildren(make("div", "dl-blank", "planning…"));
        loadViews([{ code: source.code, design: source.design }], { record: false });
      }
      panel.appendChild(make("p", "dl-size",
        `${source.yawDeg > 0 ? "from the right" : source.yawDeg < 0 ? "from the left" : "straight on"} ` +
        `(${source.yawDeg}°) · ${finishById(source.finish).displayName}`));
      if (row.shot && row.shot.figure && row.shot.figure.clear === false) {
        panel.appendChild(make("p", "dl-warn", "The figure could not be stood clear of the shelf here."));
      }
      panel.appendChild(make("p", "dl-modules",
        "The dashed outline marks where the render's 3D figure will stand. It is not the figure."));
    } else {
      const scene = row.scene;
      image.src = `${SCENE_IMAGE_URL}?id=${encodeURIComponent(scene.id)}`;
      panel.appendChild(make("p", "dl-size", scene.presetName || scene.preset));
      if (scene.params) {
        panel.appendChild(make("p", "dl-modules",
          `${scene.params.scene} · ${scene.params.light} · ${scene.params.persona} · ${scene.params.fullness}`));
      }
    }

    // One note, read by whichever verdict is pressed: why not, or what to
    // change if a scene is asked for again.
    const note = make("textarea", "dl-note");
    note.placeholder = row.kind === "scene" ? "Why not, or what to change if you press Again…" : "Why not…";
    note.value = row.note || "";
    panel.appendChild(note);

    panel.appendChild(verdictButtons(row, { large: true, note: cardNote }));
    panel.appendChild(make("p", "dl-hint", row.kind === "shelf"
      ? "Yes or Maybe plans this shelf's four angles into Views. Skip leaves it unjudged. [ and ] walk without deciding."
      : row.kind === "view"
        ? "Render starts it now, in the queue below. Skip decides nothing. [ and ] walk without deciding."
        : `${ui.scenes.made} of ${ui.scenes.cap} scene images used this sitting. Skip puts this one back.`));
    card.appendChild(panel);
    return card;
  }

  function doneCard(section) {
    const empty = make("div", "dl-done");
    if (section === "shelves") {
      empty.appendChild(make("p", "dl-empty", ui.busy
        ? "Growing more shelves…"
        : "Every shelf in this batch has been judged."));
      if (!ui.busy) {
        const more = make("button", "dl-more", "Generate 60 more");
        more.type = "button";
        more.addEventListener("click", () => growCorpus(60));
        empty.appendChild(more);
        empty.appendChild(make("p", "dl-hint",
          "New shelves only. Anything judged before is skipped by its own identity."));
      }
    } else if (section === "views") {
      empty.appendChild(make("p", "dl-empty", "Every view has been answered."));
      empty.appendChild(make("p", "dl-hint", "Yes to a shelf plans four more."));
    } else {
      empty.appendChild(make("p", "dl-empty", "Every scene has been judged."));
      empty.appendChild(make("p", "dl-hint", "Render a view and it will be put in a room."));
    }
    return empty;
  }

  function renderFlow() {
    const rows = flowRows(ui.section);
    if (!rows.length) {
      dom.stage.replaceChildren(doneCard(ui.section));
      return;
    }
    if (ui.flowAt[ui.section] >= rows.length) ui.flowAt[ui.section] = 0;
    const at = ui.flowAt[ui.section];
    dom.stage.replaceChildren(flowCard(rows[at], at, rows));
  }

  /** Ask the dev server for another batch, and pick it up without a reload. */
  function growCorpus(count) {
    if (ui.busy) return;
    ui.busy = true;
    setStatus("growing more shelves…");
    render();
    // Under a brief, the generator takes its design block as constraints.
    post(GENERATE_URL, { count, brief: ui.brief ? ui.brief.name : "" })
      .then((result) => fetch(`${result.out}?t=${Date.now()}`).then((response) => response.json()))
      .then((corpus) => {
        adoptCorpus(corpus);
        ui.flowAt.shelves = 0;
        ui.busy = false;
        setStatus(`${flowRows("shelves").length} new shelves.`);
        render();
      })
      .catch((error) => {
        ui.busy = false;
        warn(`could not generate: ${error.message}`);
        render();
      });
  }

  /** A design whose spacing was evened out is represented by the row that
   *  superseded it, not by the one it replaced. */
  function adoptCorpus(corpus) {
    ui.corpus = corpus;
    const superseded = new Set(Object.values(ui.verdicts).map((row) => row.supersedes).filter(Boolean));
    ui.designs = corpus.designs.filter((record) => !superseded.has(record.code));
  }

  // ------------------------------------------------------------------ ui ---

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setStatus(text) {
    dom.status.textContent = text;
  }

  function warn(message) {
    console.error(message);
    setStatus(message);
  }

  /** The section tabs, each with how much of it is still to judge. */
  function renderHeader() {
    const tabs = [];
    for (const [id, label] of SECTIONS) {
      const button = make("button", null, `${label} · ${flowRows(id).length}`);
      button.type = "button";
      button.classList.toggle("is-on", ui.section === id);
      button.addEventListener("click", () => {
        // A section opens on its grid; Flow is entered from inside it, and
        // where the flow had got to in each section is kept for coming back.
        ui.section = id;
        ui.mode = "grid";
        ui.detail = null;
        render();
      });
      tabs.push(button);
    }
    dom.sections.replaceChildren(...tabs);

    const taken = takenShelves().length;
    const rendered = (ui.queue.rendered || []).length;
    const kept = Object.values(ui.sceneRecords).filter((scene) => scene.verdict === "keep").length;
    dom.tally.textContent = `${taken} taken · ${rendered} rendered · ${kept} scenes kept`;
    dom.mode.textContent = ui.mode === "flow" ? "Grid" : "Flow";
    dom.mode.classList.toggle("is-on", ui.mode === "flow");
  }

  function render() {
    renderHeader();
    if (ui.detail) {
      renderDetail();
      return;
    }
    if (ui.mode === "flow") renderFlow();
    else renderGrid();
  }

  // --------------------------------------------------------------- brief ---

  /** The one control a brief adds: which file, with "none" first. */
  function renderBriefSelect() {
    const options = [make("option", null, "none")];
    options[0].value = "";
    for (const entry of ui.briefs) {
      const option = make("option", null, entry.name);
      option.value = entry.name;
      if (entry.story) option.title = entry.story;
      options.push(option);
    }
    dom.brief.replaceChildren(...options);
    dom.brief.value = ui.brief ? ui.brief.name : "";
    dom.brief.title = ui.brief && ui.brief.story ? ui.brief.story : "A brief pins some of what a scene draws; none is random";
  }

  /** Keep ?brief= in the address, so a reload opens on the same brief. */
  function syncBriefUrl(name) {
    const url = new URL(window.location.href);
    if (name) url.searchParams.set("brief", name);
    else url.searchParams.delete("brief");
    window.history.replaceState(null, "", url);
  }

  /**
   * Load a brief by name, or none. A new brief is a new batch: what the last
   * one had drawn is forgotten, so its pins let go.
   */
  function chooseBrief(name) {
    ui.batch = {};
    if (!name) {
      ui.brief = null;
      syncBriefUrl("");
      renderBriefSelect();
      renderQueueBar();
      return Promise.resolve(null);
    }
    return fetch(`${BRIEF_URL}?name=${encodeURIComponent(name)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`no brief named ${name}`);
        return response.json();
      })
      .then((result) => {
        ui.brief = result.brief;
        syncBriefUrl(name);
        renderBriefSelect();
        renderQueueBar();
        setStatus(`brief: ${name}, ${roomsPerRender()} ${roomsPerRender() === 1 ? "room" : "rooms"} per render.`);
        return ui.brief;
      })
      .catch((error) => {
        ui.brief = null;
        syncBriefUrl("");
        renderBriefSelect();
        renderQueueBar();
        warn(error.message);
        return null;
      });
  }

  /**
   * The keys answer whatever the flow is showing, so they do nothing in the
   * grid. Escape is the exception: it is the way out of a picture, and nothing
   * else on the page uses it.
   */
  function onKey(event) {
    if (ui.busy) return;
    if (event.target && ["TEXTAREA", "INPUT", "SELECT"].includes(event.target.tagName)) return;
    if (ui.detail) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetail();
      }
      return;
    }
    if (ui.mode !== "flow") return;
    // Walking back and forward is not a verdict, so it is not an arrow key:
    // every arrow on this page writes something down, and one of them that
    // sometimes did not would be the surprise.
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      step(event.key === "]" ? 1 : -1);
      return;
    }
    const byKey = { ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓" };
    const hint = byKey[event.key];
    if (!hint) return;
    const rows = flowRows(ui.section);
    const row = rows[Math.min(ui.flowAt[ui.section], rows.length - 1)];
    if (!row) return;
    const verdict = VERDICTS[row.kind].find((entry) => entry[2] === hint);
    if (!verdict) return;
    event.preventDefault();
    judge(row, verdict[0], cardNote());
  }

  // ----------------------------------------------------------------- boot ---

  function boot(corpusUrl, options) {
    const settings = options || {};
    dom.stage = document.getElementById("dl-stage");
    dom.tally = document.getElementById("dl-tally");
    dom.sections = document.getElementById("dl-sections");
    dom.status = document.getElementById("dl-status");
    dom.canvas = document.getElementById("dl-canvas");
    dom.queueWrap = document.getElementById("dl-queue");
    dom.queueCount = document.getElementById("dl-queue-count");
    dom.queueBar = document.getElementById("dl-queue-bar");
    dom.queueNow = document.getElementById("dl-queue-now");
    dom.queueFailed = document.getElementById("dl-queue-failed");
    dom.pause = document.getElementById("dl-pause");

    dom.sceneCount = document.getElementById("dl-scene-count");
    dom.sceneBar = document.getElementById("dl-scene-bar");
    dom.sceneToggle = document.getElementById("dl-scene-toggle");
    dom.sceneCap = document.getElementById("dl-scene-cap");

    dom.mode = document.getElementById("dl-mode");
    dom.mode.addEventListener("click", () => {
      ui.mode = ui.mode === "flow" ? "grid" : "flow";
      ui.detail = null;
      render();
    });
    dom.brief = document.getElementById("dl-brief");
    dom.brief.addEventListener("change", () => chooseBrief(dom.brief.value));
    dom.pause.addEventListener("click", togglePause);
    dom.sceneToggle.addEventListener("click", () => {
      ui.autoScene = !ui.autoScene;
      renderQueueBar();
    });
    dom.sceneCap.addEventListener("change", () => {
      const wanted = Math.max(0, Math.round(Number(dom.sceneCap.value) || 0));
      ui.scenes.cap = wanted;
      renderQueueBar();
    });
    document.addEventListener("keydown", onKey);

    return Promise.all([
      fetch(CATALOG_URL).then((response) => response.json()),
      fetch(corpusUrl).then((response) => {
        if (!response.ok) throw new Error(`no corpus at ${corpusUrl}. Run scripts/generate-designs.mjs`);
        return response.json();
      }),
      fetch(DESIGN_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({})),
      fetch(SHOTS_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({})),
      fetch(SCENES_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({})),
      // The briefs are files next door; without the dev server there are none.
      fetch(BRIEFS_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({}))
    ]).then(([rawCatalog, corpus, verdicts, shotVerdicts, sceneRecords, briefList]) => {
      ui.catalog = engine.normalizeCatalog(rawCatalog);
      ui.verdicts = verdicts;
      ui.shotVerdicts = shotVerdicts;
      ui.sceneRecords = sceneRecords;
      ui.briefs = Array.isArray(briefList.briefs) ? briefList.briefs : [];
      ui.renderer = rendererLib.create(dom.canvas, { antialias: true });
      if (!ui.renderer) throw new Error("WebGL is unavailable in this browser");
      adoptCorpus(corpus);

      // Where the scene cycle starts, so two sittings do not open with the
      // same room.
      ui.cycle = window.FrameworkScenePresets.cycle(Date.now() / 60000);
      ui.autoScene = true;

      renderBriefSelect();
      render();
      refreshQueue();
      window.setInterval(refreshQueue, QUEUE_POLL_MS);
      // ?brief= opens on a brief; an unknown name says so and opens on none.
      return chooseBrief(settings.brief || "");
    }).catch((error) => {
      dom.stage.replaceChildren(make("p", "dl-empty", String(error.message || error)));
      console.error(error);
    });
  }

  return { boot, ui };
})();

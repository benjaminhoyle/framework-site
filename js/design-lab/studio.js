/**
 * The studio: one continuous pass from a generated design to a render.
 *
 * The two benches it replaces asked their questions in separate sittings — judge
 * three hundred designs, then come back and judge a thousand angles of the ones
 * that survived. This asks them where they belong: say yes to a shelf and its
 * angles arrive immediately, choose the ones worth having and the renders start
 * while you move on to the next shelf.
 *
 * Nothing about the shelf, the camera or the figure is decided here — that is
 * js/design-lab/preview.js and the dev server's planner, both shared with the
 * bench tools. What is here is the flow, the queue, and the record.
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
  const PREVIEW_PX = 720;
  const QUEUE_POLL_MS = 2000;
  /*
   * How many scene images this sitting may generate before it stops and asks.
   *
   * Each one costs money, and they fire off the back of renders that fire off
   * the back of a keypress — so something has to stop, and a number you have to
   * raise deliberately is a better stop than remembering to look.
   */
  const DEFAULT_SCENE_CAP = 25;

  const ui = {
    catalog: null,
    corpus: null,
    designs: [],        // { record, state, image }
    verdicts: {},       // design fingerprint -> row
    shotVerdicts: {},   // shot id -> row
    index: 0,
    stage: "design",    // "design" | "angles"
    shots: [],          // the angles of the design being judged
    shotIndex: 0,
    renderer: null,
    loadedModules: new Set(),
    queue: { paused: false, waiting: [], running: null, done: [], failed: [] },
    busy: false,
    // The scene leg: what has been generated, what is waiting to be looked at,
    // and how much of the budget is left.
    scenes: {
      made: 0, cap: DEFAULT_SCENE_CAP, running: null, ready: [], failed: 0,
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
    sceneParams: null,
    // "flow" is the continuous pass; "browse" is everything it has produced.
    view: "flow",
    browseTab: "scenes",
    sceneRecords: {},
    // The angles planned for a shelf, drawn and ready to be sent to the queue
    // one at a time. Keyed by shot id, and held only for this sitting: a shot's
    // record carries where the camera ended up, not the geometry the planner
    // needed to put it there, so a view is re-planned rather than reloaded.
    views: {},
    // The shelf whose design code is open for editing, by fingerprint.
    editing: null,
    // The one picture being looked at large, as { kind, key }.
    detail: null,
    // Shelves drawn from geometry, by fingerprint, so a redraw costs nothing.
    shelfImages: {},
    // What the queue looked like the last time the gallery was drawn from it.
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
  function drawDesign(entry) {
    if (entry.image) return Promise.resolve(entry.image);
    const moduleIds = [...new Set(entry.state.instances.map((instance) => instance.moduleId))];
    return ensureGeometry(moduleIds).then(() => {
      ui.renderer.setViewMode("iso");
      ui.renderer.setPalette(preview.shaderPalette(finishById(entry.state.finish)));
      ui.renderer.setInstances(entry.state.instances.map((instance) =>
        preview.renderInstance(ui.catalog, instance)));
      const shot = ui.renderer.snapshot({ width: PREVIEW_PX, height: PREVIEW_PX });
      entry.image = preview.paint(shot, null);
      return entry.image;
    });
  }

  /**
   * A shelf drawn from its own geometry, kept.
   *
   * A shelf has no picture on disk, so every place that shows one draws it —
   * and the gallery redraws on every queue tick. Sixty-eight shelves through
   * the WebGL renderer twice a second is the whole page stalling for no new
   * information.
   */
  function shelfImage(shelf) {
    const key = shelf.fingerprint || shelf.code;
    if (ui.shelfImages[key]) return Promise.resolve(ui.shelfImages[key]);
    return drawDesign({
      record: { design: shelf.design },
      state: engine.deserializeState(ui.catalog, shelf.design),
      image: null
    }).then((drawn) => {
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
      // given, which is the whole of what the Views tab needs. Registered here
      // so an angle reaches that tab whether the flow planned it or the gallery
      // did — there is no second kind of view.
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

  function recordDesign(entry, verdict) {
    const record = entry.record;
    const row = {
      fingerprint: record.fingerprint,
      code: record.code,
      verdict,
      note: "",
      at: new Date().toISOString(),
      corpusSeed: ui.corpus.seed,
      sizeMm: record.sizeMm,
      shelfSizeMm: record.shelfSizeMm,
      pieceCount: record.pieceCount,
      moduleCounts: record.moduleCounts,
      totalKsh: record.totalKsh,
      url: record.url,
      design: record.design
    };
    ui.verdicts[row.fingerprint] = row;
    post(DESIGN_URL, row).catch((error) => warn(`design verdict not saved: ${error.message}`));
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
         * The gallery is showing render state, so it has to follow the queue —
         * but only when the queue has actually moved. Redrawing it every two
         * seconds regardless replaced every cell in the grid, which threw away
         * the button somebody was in the middle of pressing.
         */
        const signature = queueSignature();
        if (ui.view === "browse" && ["renders", "views"].includes(ui.browseTab)
            && signature !== ui.queueSignature) {
          renderBrowse();
        }
        ui.queueSignature = signature;
      })
      .catch(() => { /* no dev server; the bar simply says nothing is running */ });
  }

  /** What of the queue the gallery draws, as one string to compare. */
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
      dom.queueFailed.textContent = `${failed} failed — see the dev server log`;
    } else {
      dom.queueFailed.hidden = true;
    }

    const scenes = ui.scenes;
    const running = scenes.running ? ` · making one (${scenes.running.state})` : "";
    const pending = scenes.pending.length ? ` · ${scenes.pending.length} asked for` : "";
    // The counter is about money, so it reports even with Auto off: a scene
    // pushed by hand from the Renders tab spends the same budget.
    dom.sceneCount.textContent = ui.autoScene || scenes.made || scenes.running || pending
      ? `${scenes.made}/${scenes.cap} used · ${scenes.ready.length} to look at${running}${pending}` +
        (scenes.failed ? ` · ${scenes.failed} failed` : "")
      : "off";
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
   * **Sent whole wherever it fits.** This image is the geometry master — the
   * prompt's VIEWPOINT LOCK tells the model to copy its silhouette, tier count,
   * board endpoints, tube positions and joints from it — so throwing away
   * resolution to be tidy throws away the only thing it is there for. An 1800px
   * render is 3.6MB once base64'd against a 5.5MB ceiling on the whole request,
   * which leaves the better part of two megabytes spare.
   *
   * The ladder below only exists for the day a render does not fit: full size
   * and lossless first, then full size at falling quality, and only as a last
   * resort fewer pixels. Nothing is re-encoded when the original will do.
   *
   * (An earlier version shrank every render to a 1400px JPEG at 61KB. It fit
   * with room to spare and was 59 times smaller than it needed to be.)
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
   * Put one finished render into a room.
   *
   * The preset comes off a cycle rather than a shuffle: thirty scenes drawn at
   * random gives you the same cafe twice before you have seen half of them.
   */
  function generateScene(shotId, options) {
    const settings = options || {};
    if (ui.scenes.running) return Promise.resolve(null);
    if (!settings.force && ui.scenes.made >= ui.scenes.cap) return Promise.resolve(null);

    const preset = settings.preset || ui.cycle.next();
    const shotRow = ui.shotVerdicts[shotId];
    const config = window.PROMPT_CONFIG.CONFIG;
    const params = window.FrameworkScenePresets.paramsFor(preset, config, window.PROMPT_CONFIG.DEFAULTS);
    if (settings.note) params.customNotes = settings.note;

    /*
     * The shared builder writes the room; this page adds what only this page
     * knows.
     *
     * js/studio/scene-prompt.js is the scene studio's own assembly and stays
     * exactly as it is — it works from an uploaded photograph and has no design
     * to read. Here there is one, so the shelf's shape is stated in words
     * rather than left to be read off a single reference image competing with
     * seven thousand characters about a Nairobi living room. See
     * js/design-lab/design-words.js for what that costs and why.
     *
     * The height goes in too. It was always available and never sent, so every
     * scene so far was generated by a model that did not know whether the shelf
     * was waist-high or taller than the person standing next to it.
     */
    const words = window.FrameworkDesignWords;
    let structure = "";
    let scale = null;
    const design = shotRow ? shotRow.design : null;
    if (design) {
      try {
        const state = engine.deserializeState(ui.catalog, design);
        structure = words ? words.build(engine, ui.catalog, state) : "";
        const bounds = engine.designBounds(ui.catalog, state);
        if (bounds) scale = { status: "set", shelfH: Math.round(bounds[5] / 10) };
      } catch (error) {
        // A scene without the structural block is the old behaviour, not a
        // failure: the reference image still carries the shelf.
        console.warn(`could not describe ${shotId}: ${error.message}`);
      }
    }
    const prompt = window.FrameworkScenePrompt.build(config, params, { aspect: "4:3", scale })
      + (structure ? `\n\n${structure}` : "");

    const id = `${shotId}--${preset.id}-${Date.now().toString(36).slice(-4)}`;
    ui.scenes.running = { id, shotId, preset: preset.id, state: "starting" };
    ui.scenes.made += 1;
    renderQueueBar();

    /*
     * The key lives in one place: framework-site/.env.
     *
     * The dev server proxies /api/ai-* and /api/scene-airtable to the live
     * functions and sets `x-framework-key` itself from SITE_LOGIN_KEY, so
     * anything the browser sends is replaced on the way past. Asking for the
     * key here as well would be a password prompt whose answer is thrown away —
     * two places to keep one secret, one of which does nothing.
     *
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
          preset: preset.id,
          presetName: preset.name,
          archetype: preset.archetype,
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
        ui.scenes.ready.push(row);
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
   * The Renders tab's own push, for the shot that was rendered before the auto
   * leg was switched on, or the one worth a second room. It joins a queue
   * rather than starting immediately, because the generator runs one at a time
   * and a button that silently does nothing when it is busy is worse than no
   * button.
   *
   * The cap is not waived. A scene asked for by hand costs exactly what one
   * claimed automatically costs.
   */
  function pushScene(shotId, options) {
    const settings = options || {};
    /*
     * A plain push is "put this render in a room", and asking for it twice is a
     * double-click rather than a wish for two rooms. A redo names a preset or
     * carries a note, and asking for that twice is deliberate — the whole point
     * of rolling again is that the same request gives a different picture.
     */
    if (!settings.preset && !settings.note) {
      if (ui.scenes.running && ui.scenes.running.shotId === shotId) {
        setStatus(`${shotId} is being put in a room now.`);
        return;
      }
      if (ui.scenes.pending.some((job) => job.shotId === shotId)) {
        setStatus(`${shotId} is already waiting for a room.`);
        return;
      }
    }
    ui.scenes.pending.push({
      shotId,
      preset: settings.preset || null,
      note: settings.note || ""
    });
    // Claimed by hand, so the automatic leg must not claim it again.
    ui.scenes.seen.add(shotId);
    drainScenes();
    renderQueueBar();
    // drainScenes may have started this one outright; say which happened.
    setStatus(ui.scenes.running && ui.scenes.running.shotId === shotId
      ? `putting ${shotId} in a room…`
      : `${shotId} queued for a room — ${ui.scenes.pending.length} waiting.`);
  }

  /** Start the next hand-picked render, if there is budget and nothing running. */
  function drainScenes() {
    if (ui.scenes.running || !ui.scenes.pending.length) return;
    if (ui.scenes.made >= ui.scenes.cap) {
      setStatus(`scene budget spent (${ui.scenes.cap}). Raise it to carry on.`);
      return;
    }
    const job = ui.scenes.pending.shift();
    generateScene(job.shotId, {
      preset: job.preset || undefined,
      note: job.note || undefined
    });
  }

  /**
   * A render that has just finished *in this sitting* and has not been put in a
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
      ui.scenes.seen.add(entry.id);
      if (ui.scenes.made >= ui.scenes.cap) {
        setStatus(`scene budget spent (${ui.scenes.cap}). Raise it to carry on.`);
        return;
      }
      generateScene(entry.id);
      return;
    }
  }

  // ---------------------------------------------------------------- flow ---

  function unjudged() {
    return ui.designs.filter((entry) => !ui.verdicts[entry.record.fingerprint]);
  }

  function currentDesign() {
    const list = unjudged();
    if (!list.length) return null;
    if (ui.index >= list.length) ui.index = list.length - 1;
    return list[ui.index];
  }

  /**
   * Yes to a shelf: plan its angles and go straight into them.
   *
   * The verdict is written first and the angles asked for second, so a design
   * is never judged twice because the planner was slow.
   */
  function judgeDesign(verdict) {
    const entry = currentDesign();
    if (!entry || ui.busy) return;
    /*
     * Skip is not a verdict. Nothing is written, so the shelf stays unjudged
     * and comes round again — the index simply steps past it, wrapping at the
     * end so a pass of skips is a loop rather than a wall.
     */
    if (verdict === "later") {
      const list = unjudged();
      ui.index = list.length ? (ui.index + 1) % list.length : 0;
      render();
      return;
    }
    recordDesign(entry, verdict);
    if (verdict !== "keep") {
      render();
      return;
    }
    ui.busy = true;
    setStatus("planning the angles…");
    post(PLAN_URL, { code: entry.record.code, design: entry.record.design, note: "", angles: 4 })
      .then((result) => {
        ui.shots = result.shots || [];
        ui.shotIndex = 0;
        ui.stage = ui.shots.length ? "angles" : "design";
        ui.busy = false;
        setStatus("");
        render();
      })
      .catch((error) => {
        ui.busy = false;
        warn(`could not plan angles: ${error.message}`);
        render();
      });
  }

  /** Yes to an angle: queue the render now, and move to the next angle. */
  function judgeShot(verdict) {
    const shot = ui.shots[ui.shotIndex];
    if (!shot) return;
    // Skip writes nothing and moves on; the angle is simply not decided.
    if (verdict === "later") {
      ui.shotIndex += 1;
      if (ui.shotIndex >= ui.shots.length) {
        ui.stage = "design";
        ui.shots = [];
        ui.shotIndex = 0;
      }
      render();
      return;
    }
    const row = shotRow(shot, verdict === "render" ? "render" : "skip");
    ui.shotVerdicts[shot.id] = row;
    post(SHOTS_URL, row).catch((error) => warn(`shot verdict not saved: ${error.message}`));

    if (verdict === "render") {
      post(RENDER_URL, row)
        .then((result) => {
          if (result.state) ui.queue = result.state;
          renderQueueBar();
        })
        .catch((error) => warn(`render not queued: ${error.message}`));
    }

    ui.shotIndex += 1;
    if (ui.shotIndex >= ui.shots.length) {
      // Done with this shelf. The design already has its verdict, so it drops
      // out of the queue and the next one arrives in its place.
      ui.stage = "design";
      ui.shots = [];
      ui.shotIndex = 0;
    }
    render();
  }

  // ---------------------------------------------------------- navigation ---

  /**
   * Move through the flow without answering it.
   *
   * Every other control on this page writes something down — a verdict, a
   * render, a scene — and there was no way to look at the previous shelf, or
   * the angle before this one, without either deciding about it or reloading
   * the page. Skip came closest and is still a decision of a kind: it moves on
   * and only forwards.
   *
   * So: `[` and `]`, and the two arrows either side of the counter. They change
   * nothing at all. A shelf you walk back to is exactly as unjudged as it was,
   * an angle you walk back to has not been queued, and a scene you walk back to
   * is still waiting for its verdict.
   */
  function step(by) {
    if (ui.busy) return;

    if (ui.scenes.ready.length) {
      // A rotation rather than an index: the scene being looked at is always
      // the front of the queue, so moving means turning the queue under it.
      const queue = ui.scenes.ready;
      if (queue.length < 2) return;
      if (by > 0) queue.push(queue.shift());
      else queue.unshift(queue.pop());
      render();
      return;
    }

    if (ui.stage === "angles") {
      // Clamped, not wrapped: the angles are a short ordered set belonging to
      // one shelf, and falling off the end of them into the next shelf is not
      // navigation, it is losing your place.
      const next = ui.shotIndex + by;
      if (next < 0 || next >= ui.shots.length) return;
      ui.shotIndex = next;
      render();
      return;
    }

    const list = unjudged();
    if (list.length < 2) return;
    ui.index = (ui.index + by + list.length) % list.length;
    render();
  }

  /**
   * The counter, with an arrow either side of it.
   *
   * Built here rather than three times over so the three stages cannot drift
   * into having three different ideas of what going back means.
   */
  function navRow(label, canGoBack, canGoOn) {
    const row = make("div", "dl-nav-row");
    const back = make("button", "dl-nav-step", "‹");
    back.type = "button";
    back.title = "Back — decides nothing ( [ )";
    back.disabled = !canGoBack;
    back.addEventListener("click", () => step(-1));

    const on = make("button", "dl-nav-step", "›");
    on.type = "button";
    on.title = "Forward — decides nothing ( ] )";
    on.disabled = !canGoOn;
    on.addEventListener("click", () => step(1));

    row.appendChild(back);
    row.appendChild(make("p", "dl-position", label));
    row.appendChild(on);
    return row;
  }

  // -------------------------------------------------------------- browse ---

  /**
   * Everything the flow has produced, in one place.
   *
   * The flow only ever shows you the next thing; this is for going back — which
   * shelves were taken, which angles are rendered, which scenes are worth
   * keeping. It replaces the two separate bench pages rather than sitting
   * beside them: three pages was two too many, and the one that mattered was
   * the one nobody could find.
   */
  /*
   * "Yes" and "maybe" are the same answer.
   *
   * The bench this replaced offered keep / maybe / reject and the record is
   * mostly maybes; the flow offers yes / no because a third button in a
   * continuous pass is a decision nobody wants to make at speed. Counting only
   * the keeps hid sixty-three judged shelves.
   */
  const TAKEN = new Set(["keep", "maybe"]);

  /**
   * The shelves worth showing: taken, and not already replaced by an edit.
   *
   * A superseded design is still in the record and still says what it said —
   * that is the point of writing the replacement as a new row — but showing
   * both is showing the same shelf twice, once out of date.
   */
  function takenShelves() {
    const rows = Object.values(ui.verdicts).filter((row) => TAKEN.has(row.verdict) && row.design);
    const replaced = new Set(rows.map((row) => row.supersedes).filter(Boolean));
    return rows.filter((row) => !replaced.has(row.code));
  }

  function browseRows() {
    if (ui.browseTab === "shelves") {
      return takenShelves().map((row) => ({
        key: row.fingerprint,
        kind: "shelf",
        title: row.code,
        subtitle: row.shelfSizeMm
          ? `${Math.round(row.shelfSizeMm.widthMm / 10)} × ${Math.round(row.shelfSizeMm.heightMm / 10)} cm · ${row.pieceCount} pieces`
          : "",
        design: row.design,
        shelf: row,
        href: row.url ? row.url.replace(/^https:\/\/framework\.co\.ke/, "") : null,
        actions: [
          ["Edit code", () => { ui.editing = ui.editing === row.fingerprint ? null : row.fingerprint; render(); }],
          [viewsOf(row.code).length ? "Views ›" : "Create views", () => loadViews([row], { jump: true })]
        ]
      }));
    }

    /*
     * The angles planned for a shelf, before anything has been said about them.
     *
     * The flow asks about these one at a time and then forgets them; this is
     * the same set, laid out, so one angle of one shelf can be sent to the
     * renderer without walking the whole flow to reach it.
     */
    if (ui.browseTab === "views") {
      const rendered = new Set(ui.queue.rendered || []);
      const waiting = new Set(ui.queue.waiting || []);
      return Object.values(ui.views).map((shot) => {
        const row = ui.shotVerdicts[shot.id];
        const verdict = row ? row.verdict : "planned";
        const state = rendered.has(shot.id) ? "rendered"
          : ui.queue.running === shot.id ? "rendering"
          : waiting.has(shot.id) ? "queued"
          : verdict === "render" ? "approved, not rendered"
          : verdict === "skip" ? "turned down"
          : "planned";
        return {
          key: shot.id,
          kind: "view",
          title: shot.code,
          subtitle: `${shot.yawDeg}° · ${finishById(shot.finish).displayName} · ${state}`,
          image: shot.preview || null,
          view: shot,
          actions: ["rendered", "rendering", "queued"].includes(state)
            ? []
            : [["Render", () => renderView(shot)]]
        };
      }).sort((a, b) => a.key.localeCompare(b.key));
    }
    if (ui.browseTab === "renders") {
      /*
       * An approved shot is not the same thing as a rendered one.
       *
       * The gallery used to ask for a picture for every approved shot, and the
       * ninety-odd that had never been rendered came back as broken images with
       * nothing to say whether they had failed, were queued, or had simply not
       * been started. State first; the picture only when there is one.
       */
      const done = new Set(ui.queue.rendered || []);
      const waiting = new Set(ui.queue.waiting || []);
      return Object.values(ui.shotVerdicts)
        .filter((row) => row.verdict === "render")
        .map((row) => {
          const state = done.has(row.id) ? "rendered"
            : ui.queue.running === row.id ? "rendering"
            : waiting.has(row.id) ? "queued"
            : "not rendered";
          return {
            key: row.id,
            kind: "render",
            title: row.code,
            subtitle: `${row.yawDeg}° · ${row.finish} · ${state}`,
            state,
            shot: row,
            // The gallery wants a thumbnail; the scene generator, later, wants
            // the render itself.
            image: state === "rendered"
              ? `/api/design-lab/render/image?thumb=1&id=${encodeURIComponent(row.id)}`
              : null,
            // Only a finished render can be put in a room — the room is painted
            // around the picture, so there has to be a picture.
            actions: state === "rendered" ? [["Put in a room", () => pushScene(row.id)]] : []
          };
        })
        .sort((a, b) => (a.state === "rendered" ? 0 : 1) - (b.state === "rendered" ? 0 : 1));
    }
    return Object.values(ui.sceneRecords)
      .filter((row) => row.verdict !== "reject")
      .map((row) => ({
        key: row.id,
        kind: "scene",
        title: row.code,
        subtitle: `${row.presetName}${row.verdict ? ` · ${row.verdict}` : " · unjudged"}`,
        image: `${SCENE_IMAGE_URL}?thumb=1&id=${encodeURIComponent(row.id)}`
      }));
  }

  function viewsOf(code) {
    return Object.values(ui.views).filter((shot) => shot.code === code);
  }

  /**
   * The angles for a shelf, planned and drawn.
   *
   * Planned rather than reloaded, because a shot's record carries where the
   * camera ended up and not the geometry the planner needed to put it there —
   * the bounds, the eye, the figure's anchors. The planner is deterministic
   * about all of that, so re-running it gives back the same angles under the
   * same ids; only the colour is rolled, and a colour already on record is kept
   * so a view does not change finish between sittings.
   */
  function loadViews(shelves, options) {
    const settings = options || {};
    if (ui.busy || !shelves.length) return;
    ui.busy = true;
    let done = 0;
    if (settings.jump) ui.browseTab = "views";

    const step = () => {
      const shelf = shelves[done];
      if (!shelf) {
        ui.busy = false;
        setStatus(`${Object.keys(ui.views).length} views ready.`);
        render();
        return;
      }
      done += 1;
      setStatus(`planning views for ${shelf.code}${shelves.length > 1 ? ` (${done}/${shelves.length})` : ""}…`);
      post(PLAN_URL, { code: shelf.code, design: shelf.design, note: shelf.note || "", angles: 4 })
        .then((result) => Promise.all((result.shots || []).map((shot) => {
          const known = ui.shotVerdicts[shot.id];
          if (known && known.finish) shot.finish = known.finish;
          return drawShot(shot).then(() => {
            ui.views[shot.id] = shot;
            /*
             * A view nobody has answered for yet is still worth writing down —
             * it is how a later sitting knows this shelf has angles at all.
             *
             * Except when the planning was passive. Opening a picture to look
             * at what it came from should not leave marks in the record; only
             * asking for views should.
             */
            if (known || settings.record === false) return null;
            const planned = shotRow(shot, "planned");
            ui.shotVerdicts[shot.id] = planned;
            return post(SHOTS_URL, planned)
              .catch((error) => warn(`view not saved: ${error.message}`));
          });
        })))
        .then(() => { render(); step(); })
        .catch((error) => {
          ui.busy = false;
          warn(`could not plan views for ${shelf.code}: ${error.message}`);
          render();
        });
    };
    step();
  }

  /** Send one view to the renderer, and say so on its record. */
  function renderView(shot) {
    const row = shotRow(shot, "render");
    ui.shotVerdicts[shot.id] = row;
    post(SHOTS_URL, row).catch((error) => warn(`shot verdict not saved: ${error.message}`));
    queueShots([row]);
  }

  /**
   * Replace a shelf with an edited one, from its /builder link.
   *
   * The edit itself happens in /builder — open the shelf, move a piece, copy
   * the address back — because that is the one place that knows what a legal
   * placement is, and a second editor on the bench would be a worse one.
   *
   * The replacement is written as a NEW row naming the shelf it supersedes,
   * which is how a normalised design is already recorded: a verdict belongs to
   * the shelf it was given to, and rewriting it in place would quietly restate
   * what was judged.
   */
  function saveEditedShelf(shelf, code) {
    if (ui.busy) return;
    ui.busy = true;
    setStatus("reading that design code…");
    post(DECODE_URL, { code })
      .then((result) => {
        const design = result.design;
        if (design.fingerprint === shelf.fingerprint) {
          throw new Error("that is the same shelf — nothing to replace");
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
        // stops the Views tab offering angles of a shape that no longer exists.
        for (const shot of viewsOf(shelf.code)) delete ui.views[shot.id];
        return post(DESIGN_URL, row).then(() => {
          ui.busy = false;
          const warnings = (result.warnings || []).length
            ? ` — but it breaks ${result.warnings.join(", ")}`
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
   * The gallery answers "what is there"; this answers "where did this come
   * from, and what else came out of it". They are different questions and the
   * grid could only ever answer the first: a scene in it is a thumbnail with a
   * preset name, and the shelf it is a picture of, the angle it was shot from
   * and the render it was painted around are all somewhere else in a different
   * tab, findable only by reading ids.
   *
   * So the four stages are laid out as strips under the picture, for the whole
   * shelf rather than for the one line through it — a view usually has more
   * than one render's worth of history and a render more than one room, and
   * those branches are exactly what you want to compare. The picture you are
   * looking at is marked, and so is the branch it belongs to.
   */

  /** The stage a browse row belongs to, which is also its tab. */
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
    return Object.values(ui.verdicts).find((row) => row.code === code && row.design) || null;
  }

  /**
   * One row of the record, whatever stage it is from, in one shape.
   *
   * `code` is the shelf it descends from and `branch` the shot id it belongs
   * to — those two are the whole of what relates anything here to anything
   * else.
   */
  function itemFor(kind, key) {
    if (kind === "shelf") {
      const shelf = ui.verdicts[key] || shelfNamed(key);
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
        ? "No rooms yet — put a render in one."
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
   * The same buttons the grid offers, plus — for a scene — the two ways of
   * asking again, which is the question the grid had no room for.
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
     * "The room is right, the picture is not" — the shelf came out bent, the
     * light went odd, the composition is dull — wants the *same* request rolled
     * again, because the model is not deterministic and the next one is a
     * genuinely different photograph of the same idea.
     *
     * "The room is wrong for this shelf" wants the next room on the cycle.
     * That is what the flow's ↑ Again has always done, and it is still the
     * right default at speed; the finer choice belongs here, where you are
     * already looking closely.
     *
     * Neither judges this picture. It stays exactly as it was, so the answer
     * can be given once both are on the table — the one thing worth avoiding
     * is throwing away a picture that has already been paid for.
     */
    const again = make("div", "dl-detail-actions");
    const sameRoom = make("button", "dl-cell-btn", "Same room again");
    sameRoom.type = "button";
    sameRoom.title = "The same request, rolled again — a different photograph of the same idea";
    sameRoom.addEventListener("click", () => {
      const preset = window.FrameworkScenePresets.byId(scene.preset);
      if (!preset) { warn(`${scene.preset} is not a scene this build knows`); return; }
      pushScene(scene.shotId, { preset, note: note.value.trim() || scene.note || " " });
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
    keep.addEventListener("click", () => {
      scene.verdict = "keep";
      scene.note = note.value.trim() || scene.note;
      scene.judgedAt = new Date().toISOString();
      post(SCENES_URL, scene).catch((error) => warn(`scene verdict not saved: ${error.message}`));
      pushToAirtable(scene).then(() => render());
      render();
    });
    const no = make("button", "dl-cell-btn", "No");
    no.type = "button";
    no.addEventListener("click", () => {
      scene.verdict = "reject";
      scene.note = note.value.trim() || scene.note;
      scene.judgedAt = new Date().toISOString();
      post(SCENES_URL, scene).catch((error) => warn(`scene verdict not saved: ${error.message}`));
      // A rejected scene leaves the gallery, so there is nothing left to show.
      closeDetail();
    });
    verdicts.appendChild(keep);
    verdicts.appendChild(no);
    wrap.appendChild(verdicts);
    wrap.appendChild(make("p", "dl-hint",
      "Asking again queues another picture and leaves this one alone — judge it once you have both."));
    return wrap;
  }

  /** The facts about the thing on screen, under its picture. */
  function detailFacts(item) {
    const lines = [];
    if (item.kind === "shelf") {
      const shelf = item.shelf;
      const size = shelf.shelfSizeMm || shelf.sizeMm;
      if (size) {
        lines.push(`${Math.round(size.widthMm / 10)} × ${Math.round(size.depthMm / 10)} × ` +
          `${Math.round(size.heightMm / 10)} cm · ${shelf.pieceCount} pieces` +
          (shelf.totalKsh ? ` · Ksh ${Number(shelf.totalKsh).toLocaleString("en-KE")}` : ""));
      }
      if (shelf.moduleCounts) {
        lines.push(Object.entries(shelf.moduleCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([id, count]) => `${count} × ${(ui.catalog.modules[id] || {}).label || id}`)
          .join(" · "));
      }
      if (shelf.supersedes) lines.push(`Replaced ${shelf.supersedes}.`);
    } else if (item.kind === "view" || item.kind === "render") {
      const row = item.view || item.row;
      lines.push(`${row.yawDeg}° · ${finishById(row.finish).displayName} · from ${item.code}`);
      const verdict = item.row ? item.row.verdict : "planned";
      lines.push(`Answered: ${verdict || "not yet"}.`);
    } else {
      const scene = item.scene;
      lines.push(`${scene.presetName} · from ${scene.shotId}`);
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
      // The record moved under it — an edited shelf, a rejected scene.
      ui.detail = null;
      renderBrowse();
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

  function renderBrowse() {
    // One picture, large, with its whole family under it.
    if (ui.detail) {
      renderDetail();
      return;
    }

    const rows = browseRows();
    const tabs = make("div", "dl-bar dl-tabs");
    // The order is the pipeline's own: a shelf, the angles chosen of it, the
    // renders made from those, the rooms the renders were put in. Each tab has
    // the button that moves its rows on to the next one.
    for (const [id, label] of [["shelves", "Shelves"], ["views", "Views"], ["renders", "Renders"], ["scenes", "Scenes"]]) {
      const button = make("button", null, label);
      button.type = "button";
      button.classList.toggle("is-on", ui.browseTab === id);
      button.addEventListener("click", () => {
        ui.browseTab = id;
        ui.detail = null;
        render();
      });
      tabs.appendChild(button);
    }

    const wrap = make("div", "dl-browse");
    wrap.appendChild(tabs);

    // A backlog of approved-but-unrendered shots is the commonest thing to find
    // here, and the queue is right there; offer to fill it.
    if (ui.browseTab === "renders") {
      const missing = rows.filter((row) => row.state === "not rendered");
      if (missing.length) {
        const bar = make("div", "dl-browse-action");
        bar.appendChild(make("span", "dl-hint",
          `${missing.length} approved ${missing.length === 1 ? "shot has" : "shots have"} never been rendered.`));
        const queueAll = make("button", "dl-more", `Render all ${missing.length}`);
        queueAll.type = "button";
        queueAll.addEventListener("click", () => queueShots(missing.map((row) => row.shot)));
        bar.appendChild(queueAll);
        wrap.appendChild(bar);
      }
    }

    /*
     * Views are held for the sitting, not loaded from the record: what a shot
     * writes down is where its camera ended up, not the geometry the planner
     * needed to put it there. So after a reload this tab is empty while the
     * record plainly says these shelves have angles — which is the empty state
     * that looks like a fault. Say what it would take to fill it, and offer.
     */
    if (ui.browseTab === "views") {
      const loaded = new Set(Object.values(ui.views).map((shot) => shot.code));
      const missing = takenShelves().filter((shelf) => !loaded.has(shelf.code));
      if (missing.length) {
        const bar = make("div", "dl-browse-action");
        bar.appendChild(make("span", "dl-hint", loaded.size
          ? `${missing.length} more taken ${missing.length === 1 ? "shelf has" : "shelves have"} views to plan.`
          : `Views are planned fresh each sitting. ${missing.length} taken ${missing.length === 1 ? "shelf is" : "shelves are"} waiting.`));
        const planAll = make("button", "dl-more", `Plan views for ${missing.length}`);
        planAll.type = "button";
        planAll.addEventListener("click", () => loadViews(missing, {}));
        bar.appendChild(planAll);
        wrap.appendChild(bar);
      }
      const ready = rows.filter((row) => row.actions.length);
      if (ready.length > 1) {
        const bar = make("div", "dl-browse-action");
        bar.appendChild(make("span", "dl-hint", `${ready.length} views have not been sent to the renderer.`));
        const renderAll = make("button", "dl-more", `Render all ${ready.length}`);
        renderAll.type = "button";
        renderAll.addEventListener("click", () => {
          const shots = ready.map((row) => {
            const planned = shotRow(row.view, "render");
            ui.shotVerdicts[row.view.id] = planned;
            post(SHOTS_URL, planned).catch((error) => warn(`shot verdict not saved: ${error.message}`));
            return planned;
          });
          queueShots(shots);
        });
        bar.appendChild(renderAll);
        wrap.appendChild(bar);
      }
    }
    if (!rows.length) {
      wrap.appendChild(make("p", "dl-empty", ui.busy ? "Working…" : "Nothing here yet."));
      dom.stage.replaceChildren(wrap);
      return;
    }

    const grid = make("div", "dl-grid");
    for (const row of rows) {
      const cell = make("div", "dl-cell");
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
        open.appendChild(make("div", "dl-blank", row.state || ""));
      }
      open.addEventListener("click", () => openDetail(row.kind, row.key));
      cell.appendChild(open);
      cell.appendChild(make("span", "dl-cell-code", row.title));
      if (row.subtitle) cell.appendChild(make("span", "dl-cell-note", row.subtitle));
      if (row.href) {
        const open = make("a", "dl-open", "Open in the builder");
        open.href = row.href;
        open.target = "_blank";
        open.rel = "noopener";
        cell.appendChild(open);
      }
      if (row.shelf && ui.editing === row.key) {
        cell.appendChild(editor(row.shelf));
      } else if (row.actions && row.actions.length) {
        const actions = make("div", "dl-cell-actions");
        for (const [label, onClick] of row.actions) {
          const button = make("button", "dl-cell-btn", label);
          button.type = "button";
          button.disabled = ui.busy;
          button.addEventListener("click", onClick);
          actions.appendChild(button);
        }
        cell.appendChild(actions);
      }
      grid.appendChild(cell);
      // A shelf has no picture on disk; it is drawn from its own geometry.
      if (!row.image && row.design) {
        shelfImage(row.shelf || { design: row.design, fingerprint: row.key })
          .then((source) => { image.src = source; });
      }
    }
    wrap.appendChild(grid);
    dom.stage.replaceChildren(wrap);
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

  /** Ask the dev server for another batch, and pick it up without a reload. */
  function growCorpus(count) {
    if (ui.busy) return;
    ui.busy = true;
    setStatus("growing more shelves…");
    render();
    post(GENERATE_URL, { count })
      .then((result) => fetch(`${result.out}?t=${Date.now()}`).then((response) => response.json()))
      .then((corpus) => {
        ui.corpus = corpus;
        const superseded = new Set(Object.values(ui.verdicts).map((row) => row.supersedes).filter(Boolean));
        ui.designs = corpus.designs
          .filter((record) => !superseded.has(record.code))
          .map((record) => ({
            record,
            state: engine.deserializeState(ui.catalog, record.design),
            image: null
          }));
        ui.index = 0;
        ui.busy = false;
        setStatus(`${unjudged().length} new shelves.`);
        render();
      })
      .catch((error) => {
        ui.busy = false;
        warn(`could not generate: ${error.message}`);
        render();
      });
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

  function renderDesignStage() {
    const entry = currentDesign();
    if (!entry) {
      /*
       * A corpus runs out, and a page that says so and stops is a dead end with
       * the generator one directory away. Offer the next batch here, where the
       * question comes up.
       */
      const empty = make("div", "dl-done");
      empty.appendChild(make("p", "dl-empty", ui.busy
        ? "Growing more shelves…"
        : "Every shelf in this batch has been judged."));
      if (!ui.busy) {
        const more = make("button", "dl-more", "Generate 60 more");
        more.type = "button";
        more.addEventListener("click", () => growCorpus(60));
        empty.appendChild(more);
        empty.appendChild(make("p", "dl-hint",
          "New shelves only — anything judged before is skipped by its own identity."));
      }
      dom.stage.replaceChildren(empty);
      return;
    }
    const record = entry.record;
    const card = make("div", "dl-card");
    const figure = make("div", "dl-figure");
    const image = make("img");
    image.alt = record.code;
    figure.appendChild(image);
    card.appendChild(figure);
    drawDesign(entry).then((source) => { image.src = source; });
    // Draw the next one while this is being looked at.
    const list = unjudged();
    if (list[ui.index + 1]) drawDesign(list[ui.index + 1]);

    const panel = make("div", "dl-panel");
    panel.appendChild(navRow(`${ui.index + 1} of ${list.length} left`, list.length > 1, list.length > 1));
    panel.appendChild(make("h2", "dl-code", record.code));
    const size = record.shelfSizeMm || record.sizeMm;
    panel.appendChild(make("p", "dl-size",
      `${Math.round(size.widthMm / 10)} × ${Math.round(size.depthMm / 10)} × ${Math.round(size.heightMm / 10)} cm · ` +
      `${record.pieceCount} pieces · Ksh ${Number(record.totalKsh).toLocaleString("en-KE")}`));
    panel.appendChild(make("p", "dl-modules", Object.entries(record.moduleCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${count} × ${(ui.catalog.modules[id] || {}).label || id}`)
      .join(" · ")));

    const open = make("a", "dl-open", "Open in the builder");
    open.href = record.url.replace(/^https:\/\/framework\.co\.ke/, "");
    open.target = "_blank";
    open.rel = "noopener";
    panel.appendChild(open);

    const actions = make("div", "dl-actions");
    for (const [id, label, hint, className] of [
      ["keep", "Yes", "→", "dl-verdict-render"],
      ["later", "Skip", "↓", "dl-verdict-later"],
      ["reject", "No", "←", "dl-verdict-skip"]
    ]) {
      const button = make("button", `dl-verdict ${className}`);
      button.appendChild(make("span", null, label));
      button.appendChild(make("small", null, hint));
      button.addEventListener("click", () => judgeDesign(id));
      actions.appendChild(button);
    }
    panel.appendChild(actions);
    panel.appendChild(make("p", "dl-hint",
      "Yes brings up this shelf's four angles. Skip leaves it unjudged and comes back to it. " +
      "The arrows either side of the counter — or [ and ] — walk back and forward without deciding anything."));

    card.appendChild(panel);
    dom.stage.replaceChildren(card);
  }

  function renderAngleStage() {
    const shot = ui.shots[ui.shotIndex];
    if (!shot) {
      ui.stage = "design";
      renderDesignStage();
      return;
    }
    const card = make("div", "dl-card");
    const figure = make("div", "dl-figure");
    const image = make("img");
    image.alt = shot.id;
    figure.appendChild(image);
    card.appendChild(figure);
    drawShot(shot).then((source) => { image.src = source; });
    if (ui.shots[ui.shotIndex + 1]) drawShot(ui.shots[ui.shotIndex + 1]);

    const panel = make("div", "dl-panel");
    panel.appendChild(navRow(`angle ${ui.shotIndex + 1} of ${ui.shots.length}`,
      ui.shotIndex > 0, ui.shotIndex < ui.shots.length - 1));
    panel.appendChild(make("h2", "dl-code", shot.code));
    panel.appendChild(make("p", "dl-size",
      `${shot.yawDeg > 0 ? "from the right" : shot.yawDeg < 0 ? "from the left" : "straight on"} ` +
      `(${shot.yawDeg}°) · ${finishById(shot.finish).displayName}`));
    if (shot.figure && shot.figure.clear === false) {
      panel.appendChild(make("p", "dl-warn", "The figure could not be stood clear of the shelf here."));
    }
    panel.appendChild(make("p", "dl-modules",
      "The dashed outline marks where the render's 3D figure will stand — it is not the figure."));

    const actions = make("div", "dl-actions");
    for (const [id, label, hint, className] of [
      ["render", "Render", "→", "dl-verdict-render"],
      ["later", "Skip", "↓", "dl-verdict-later"],
      ["skip", "No", "←", "dl-verdict-skip"]
    ]) {
      const button = make("button", `dl-verdict ${className}`);
      button.appendChild(make("span", null, label));
      button.appendChild(make("small", null, hint));
      button.addEventListener("click", () => judgeShot(id));
      actions.appendChild(button);
    }
    panel.appendChild(actions);
    panel.appendChild(make("p", "dl-hint",
      "Render starts it now, in the queue below. Skip decides nothing. " +
      "[ and ] step between this shelf's angles without answering for them."));

    card.appendChild(panel);
    dom.stage.replaceChildren(card);
  }

  /**
   * A finished scene, waiting to be judged.
   *
   * Maybe sends it down the content pipeline, No forgets it, Again puts the
   * same shelf into a different room — the next one on the cycle, plus whatever
   * you type. Again is the useful one: the shelf and the angle were already
   * chosen, so what is being rejected is the room, and the room is the only
   * part worth another go.
   */
  function renderSceneStage() {
    const row = ui.scenes.ready[0];
    const card = make("div", "dl-card");
    const figure = make("div", "dl-figure");
    const image = make("img");
    image.alt = row.presetName;
    image.src = `${SCENE_IMAGE_URL}?id=${encodeURIComponent(row.id)}`;
    figure.appendChild(image);
    card.appendChild(figure);

    const panel = make("div", "dl-panel");
    panel.appendChild(navRow(`scene · ${ui.scenes.ready.length} waiting`,
      ui.scenes.ready.length > 1, ui.scenes.ready.length > 1));
    panel.appendChild(make("h2", "dl-code", row.code));
    panel.appendChild(make("p", "dl-size", row.presetName));
    panel.appendChild(make("p", "dl-modules",
      `${row.params.scene} · ${row.params.light} · ${row.params.persona} · ${row.params.fullness}`));
    if (row.note) panel.appendChild(make("p", "dl-modules", `Note: ${row.note}`));

    const note = make("textarea", "dl-note");
    note.placeholder = "What to change, if you press Again…";
    panel.appendChild(note);

    const actions = make("div", "dl-actions");
    for (const [id, label, hint, className] of [
      ["keep", "Maybe", "→", "dl-verdict-render"],
      ["again", "Again", "↑", "dl-verdict-again"],
      ["reject", "No", "←", "dl-verdict-skip"]
    ]) {
      const button = make("button", `dl-verdict ${className}`);
      button.appendChild(make("span", null, label));
      button.appendChild(make("small", null, hint));
      button.addEventListener("click", () => judgeScene(id, note.value.trim()));
      actions.appendChild(button);
    }
    panel.appendChild(actions);

    const later = make("button", "dl-skip", "Skip for now ↓");
    later.type = "button";
    later.addEventListener("click", () => {
      // To the back of the queue, not out of it: an undecided scene has already
      // been paid for, so losing it is the one outcome worth avoiding.
      ui.scenes.ready.push(ui.scenes.ready.shift());
      render();
    });
    panel.appendChild(later);

    panel.appendChild(make("p", "dl-hint",
      `${ui.scenes.made} of ${ui.scenes.cap} scene images used this sitting.`));

    card.appendChild(panel);
    dom.stage.replaceChildren(card);
  }

  /**
   * Send a kept scene down the content pipeline.
   *
   * Two staged uploads then a commit, which is the shape /api/scene-airtable
   * already has: the render goes up as the `source` and the generated picture
   * as the `output`, and the design code ties the Airtable record back to the
   * shelf. `sourceIsBlenderRender` is true here and always will be — every
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

  function judgeScene(verdict, note) {
    const row = ui.scenes.ready.shift();
    if (!row) return;
    row.verdict = verdict;
    row.note = note || row.note;
    row.judgedAt = new Date().toISOString();
    ui.sceneRecords[row.id] = row;
    post(SCENES_URL, row).catch((error) => warn(`scene verdict not saved: ${error.message}`));

    if (verdict === "keep") pushToAirtable(row);

    if (verdict === "again") {
      // The shelf and the angle already passed; it is the room being sent back.
      // Force it past the cap check only if there is budget, so Again cannot
      // quietly spend more than the number says.
      generateScene(row.shotId, { note });
    }
    render();
  }

  function render() {
    let taken = 0;
    for (const row of Object.values(ui.verdicts)) {
      if (TAKEN.has(row.verdict)) taken += 1;
    }
    const left = unjudged().length;
    dom.tally.textContent = `${left} designs to judge · ${taken} taken`;
    dom.viewToggle.textContent = ui.view === "browse" ? "Back to the flow" : "Browse";
    if (ui.view === "browse") {
      dom.stageName.textContent = "browsing";
      renderBrowse();
      return;
    }

    /*
     * A finished scene jumps the queue.
     *
     * It is the rarest thing on the page and the only one that cost money, so
     * it is looked at while it is fresh rather than after another twenty
     * shelves. Everything else waits; nothing is lost by waiting.
     */
    if (ui.scenes.ready.length) {
      dom.stageName.textContent = "judging scenes";
      renderSceneStage();
      return;
    }
    dom.stageName.textContent = ui.stage === "angles" ? "choosing angles" : "judging shelves";
    if (ui.stage === "angles") renderAngleStage();
    else renderDesignStage();
  }

  function onKey(event) {
    if (ui.busy) return;
    if (event.target && event.target.tagName === "TEXTAREA") return;
    // The keys answer whatever the flow is showing, and the gallery is not
    // showing it. An arrow pressed here used to judge the shelf behind the
    // gallery, which nobody could see. Escape is the exception: it is the way
    // out of a picture, and nothing else on the page uses it.
    if (ui.view === "browse") {
      if (event.key === "Escape" && ui.detail) {
        event.preventDefault();
        closeDetail();
      }
      return;
    }
    // Walking back and forward is not a verdict, so it is not an arrow key:
    // every arrow on this page writes something down, and one of them that
    // sometimes did not would be the surprise.
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      step(event.key === "]" ? 1 : -1);
      return;
    }
    const right = event.key === "ArrowRight";
    const left = event.key === "ArrowLeft";
    const up = event.key === "ArrowUp";
    const down = event.key === "ArrowDown";
    if (!right && !left && !up && !down) return;
    event.preventDefault();
    if (ui.scenes.ready.length) {
      if (down) {
        ui.scenes.ready.push(ui.scenes.ready.shift());
        render();
        return;
      }
      const note = document.querySelector(".dl-note");
      judgeScene(right ? "keep" : up ? "again" : "reject", note ? note.value.trim() : "");
      return;
    }
    if (up) return;
    if (ui.stage === "angles") judgeShot(down ? "later" : right ? "render" : "skip");
    else judgeDesign(down ? "later" : right ? "keep" : "reject");
  }

  // ----------------------------------------------------------------- boot ---

  function boot(corpusUrl) {
    dom.stage = document.getElementById("dl-stage");
    dom.tally = document.getElementById("dl-tally");
    dom.stageName = document.getElementById("dl-stage-name");
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

    dom.viewToggle = document.getElementById("dl-view-toggle");
    dom.viewToggle.addEventListener("click", () => {
      ui.view = ui.view === "browse" ? "flow" : "browse";
      ui.detail = null;
      render();
    });
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
        if (!response.ok) throw new Error(`no corpus at ${corpusUrl} — run scripts/generate-designs.mjs`);
        return response.json();
      }),
      fetch(DESIGN_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({})),
      fetch(SHOTS_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({})),
      fetch(SCENES_URL).then((response) => (response.ok ? response.json() : {})).catch(() => ({}))
    ]).then(([rawCatalog, corpus, verdicts, shotVerdicts, sceneRecords]) => {
      ui.catalog = engine.normalizeCatalog(rawCatalog);
      ui.corpus = corpus;
      ui.verdicts = verdicts;
      ui.shotVerdicts = shotVerdicts;
      ui.sceneRecords = sceneRecords;
      ui.renderer = rendererLib.create(dom.canvas, { antialias: true });
      if (!ui.renderer) throw new Error("WebGL is unavailable in this browser");

      // A design whose spacing was evened out is represented by the row that
      // superseded it, not by the one it replaced.
      const superseded = new Set(Object.values(verdicts).map((row) => row.supersedes).filter(Boolean));
      ui.designs = corpus.designs
        .filter((record) => !superseded.has(record.code))
        .map((record) => ({ record, state: engine.deserializeState(ui.catalog, record.design), image: null }));

      // Where the scene cycle starts, so two sittings do not open with the
      // same room.
      ui.cycle = window.FrameworkScenePresets.cycle(Date.now() / 60000);
      ui.autoScene = true;

      render();
      refreshQueue();
      window.setInterval(refreshQueue, QUEUE_POLL_MS);
    }).catch((error) => {
      dom.stage.replaceChildren(make("p", "dl-empty", String(error.message || error)));
      console.error(error);
    });
  }

  return { boot, ui };
})();

/**
 * A brief becomes a scene's parameters.
 *
 * A brief is the front matter of a file in framework-marketing/briefs: which
 * room, who lives there, how full the shelf is, what must appear, what must
 * not, and which of those are pinned for the whole batch. Everything the brief
 * does not say is drawn here, from the pools in js/studio/prompt-config.js.
 * An empty brief is random mode, so random and directed are one path.
 *
 * The draw is sequential, the way a person would do it: choose the place,
 * then the room in it, then who uses the room, then the light, then what they
 * left lying about. A trace or a detail only comes from the pool for that
 * room, so an office never draws a cot, and nothing is drawn twice in one
 * batch while the room's pool still has something unused in it.
 *
 *   FrameworkBrief.resolve(brief, CONFIG, batch) -> { params, must, avoid }
 *
 * `params` is exactly what FrameworkScenePrompt.build takes. `batch` is a
 * plain object the caller keeps for the length of a batch; it is mutated to
 * remember what has been used. Pass a fresh {} to start again. A `random`
 * function on it (0 <= r < 1) makes a batch reproducible.
 */
window.FrameworkBrief = (function () {
  "use strict";

  /** The keys a brief can fix outright. */
  const PLACE_KEYS = ["wall", "floor", "rug", "furniture", "windowView", "colourMood"];
  const DRAWN_KEYS = ["archetype", "scene", "persona", "fullness", "light", "livedIn", "camera", "framing"];
  const GROUP_OF = {
    scene: "scenes", persona: "persona", fullness: "fullness", light: "light", livedIn: "livedIn",
    camera: "camera", framing: "framing", wall: "walls", floor: "floors", rug: "rugs",
    furniture: "furniture", windowView: "windowView", colourMood: "colourMood"
  };

  /** `light: daylight | evening | any` in a brief is a range, not a value. */
  const LIGHT_RANGES = {
    daylight: (option) => option.daylight === true,
    evening: (option) => option.daylight === false,
    any: () => true
  };

  /** Mood words that name a register. Anything else in `mood` is passed through as words. */
  const MOOD_REGISTERS = [
    [/well[ -]kept|cared for|looked after/, "well-kept"],
    [/lived[ -]in/, "lived-in"],
    [/\btidy\b|\bclean\b/, "tidy"],
    [/\bsettled\b|\bbusy\b/, "settled"],
    [/\bmessy\b/, "messy"]
  ];

  function emptyBrief() {
    return {
      name: "", scene: null, persona: null, fullness: null, light: null, mood: null,
      must: [], avoid: [], pin: [], formats: [], count: 0, design: {}, body: "", archetype: null
    };
  }

  // ── the draw ─────────────────────────────────────────────────────────────

  function pickWeighted(random, entries) {
    const live = entries.filter((entry) => entry.weight > 0);
    const total = live.reduce((sum, entry) => sum + entry.weight, 0);
    if (!total) return null;
    let roll = random() * total;
    for (const entry of live) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return live[live.length - 1];
  }

  /** A weights map {id: weight} as entries, or an option list's own weights. */
  function entriesOf(map, options) {
    if (map) return Object.entries(map).map(([id, weight]) => ({ id, weight }));
    return (options || []).filter((option) => option.id !== "auto").map((option) => ({ id: option.id, weight: option.weight || 0 }));
  }

  function normalise(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function asList(value) {
    return (Array.isArray(value) ? value : [value]).filter(Boolean).map(String);
  }

  /** Does an option answer to a term from the brief's `avoid` list? */
  function matchesAvoid(option, avoid) {
    if (!avoid.length) return false;
    const haystack = [normalise(option.id), normalise(option.label), normalise(option.prompt)].join(" | ");
    return avoid.some((term) => term && haystack.includes(term));
  }

  function optionExists(CONFIG, key, value) {
    if (key === "archetype") return (CONFIG.archetypes || []).some((entry) => entry.id === value);
    const group = CONFIG[GROUP_OF[key]] || [];
    return group.some((option) => option.id === value);
  }

  /**
   * Resolve one image's parameters from a brief.
   *
   * A key the brief gives a value for is used as it is. A key named in `pin`
   * without a value is drawn once and held for the batch. Everything else is
   * drawn per image, with a mild push away from what this batch already drew
   * so twelve pictures do not all land on the same light.
   */
  function resolve(brief, CONFIG, batch) {
    const b = Object.assign(emptyBrief(), brief || {});
    const memory = batch || {};
    memory.used = memory.used || { humanTraces: [], details: [] };
    memory.drawn = memory.drawn || {};
    memory.pinned = memory.pinned || {};
    memory.count = (memory.count || 0) + 1;
    const random = typeof memory.random === "function" ? memory.random : Math.random;
    const pin = new Set(asList(b.pin));
    const avoidWords = asList(b.avoid).map(normalise);
    const must = asList(b.must);
    const POOLS = CONFIG.pools || (window.PROMPT_CONFIG && window.PROMPT_CONFIG.POOLS) || {};
    const commercial = (CONFIG.roomGroups && CONFIG.roomGroups.commercial)
      || (window.PROMPT_CONFIG && window.PROMPT_CONFIG.ROOM_GROUPS && window.PROMPT_CONFIG.ROOM_GROUPS.commercial) || [];

    /** Weight of an option in this batch: halved for every time it was drawn already. */
    function spread(key, entries) {
      const seen = memory.drawn[key] || {};
      return entries.map((entry) => ({ id: entry.id, weight: entry.weight / (1 + (seen[entry.id] || 0)) }));
    }
    function remember(key, id) {
      memory.drawn[key] = memory.drawn[key] || {};
      memory.drawn[key][id] = (memory.drawn[key][id] || 0) + 1;
    }
    /** Fixed by the brief, held by the pin, or drawn. */
    function settle(key, draw) {
      if (b[key] && optionExists(CONFIG, key, b[key])) return b[key];
      if (pin.has(key) && memory.pinned[key]) return memory.pinned[key];
      const picked = pickWeighted(random, spread(key, draw()));
      const id = picked ? picked.id : null;
      if (id) remember(key, id);
      if (id && pin.has(key)) memory.pinned[key] = id;
      return id;
    }

    // 1. The place. If the brief names a room, only places that host it.
    const archetypes = CONFIG.archetypes || [];
    const fixedScene = b.scene && optionExists(CONFIG, "scene", b.scene) ? b.scene : null;
    const archetypeId = settle("archetype", () => archetypes
      .filter((entry) => !fixedScene || (entry.rooms && entry.rooms[fixedScene]))
      .map((entry) => ({ id: entry.id, weight: (entry.weight || 1) * (fixedScene ? entry.rooms[fixedScene] : 1) })));
    const archetype = archetypes.find((entry) => entry.id === archetypeId) || null;
    const pools = (archetype && archetype.pools) || {};

    // 2. The room in it.
    const scene = settle("scene", () => archetype && archetype.rooms
      ? entriesOf(archetype.rooms)
      : (CONFIG.scenes || []).map((option) => ({ id: option.id, weight: 1 }))) || "living-room";
    const settingType = commercial.includes(scene) ? "commercial" : "residential";

    // 3. Who uses it, and how full they keep the shelf.
    const personaMap = (POOLS.personaByScene || {})[scene] || (POOLS.personaByScene || {}).default;
    const persona = settle("persona", () => entriesOf(personaMap, CONFIG.persona)) || "auto";
    const fullness = settle("fullness", () => entriesOf(null, CONFIG.fullness)) || "moderate";

    // 4. The light: the brief's range, over the place's own distribution.
    const range = LIGHT_RANGES[String(b.light || "").toLowerCase()] || LIGHT_RANGES.any;
    const light = settle("light", () => entriesOf(pools.light, CONFIG.light)
      .filter((entry) => range((CONFIG.light || []).find((option) => option.id === entry.id) || {}))) || "soft-cloudy";

    // 5. The register. A mood word can name it; otherwise it is drawn.
    const moodText = normalise(b.mood);
    const named = MOOD_REGISTERS.find(([pattern]) => pattern.test(moodText));
    if (named && !b.livedIn) b.livedIn = named[1];
    const livedIn = settle("livedIn", () => entriesOf(pools.livedIn, CONFIG.livedIn)) || "lived-in";

    // 6. The camera.
    const camera = settle("camera", () => entriesOf(null, CONFIG.camera)) || "entry-camera";
    const framing = settle("framing", () => entriesOf(null, CONFIG.framing)) || "considered";

    // 7. What people left about, from this room's pool, none twice a batch.
    const exclude = new Set(pools.exclude || []);
    function drawSome(key, options, howMany, extraFilter) {
      const like = new Set(pools[key] || []);
      const chosen = [];
      for (let n = 0; n < howMany; n += 1) {
        const pool = options.filter((option) => !exclude.has(option.id)
          && !chosen.includes(option.id)
          && !matchesAvoid(option, avoidWords)
          && (!option.rooms || option.rooms.includes(scene))
          && (!option.settings || option.settings.includes(settingType))
          && (!extraFilter || extraFilter(option)));
        let fresh = pool.filter((option) => !memory.used[key].includes(option.id));
        // The batch has used the whole pool for this room: start it again.
        if (!fresh.length && pool.length) {
          memory.used[key] = memory.used[key].filter((id) => !pool.some((option) => option.id === id));
          fresh = pool;
        }
        const picked = pickWeighted(random, fresh.map((option) => ({ id: option.id, weight: (option.weight || 1) * (like.has(option.id) ? 2 : 1) })));
        if (!picked) break;
        chosen.push(picked.id);
        memory.used[key].push(picked.id);
      }
      return chosen;
    }
    const countOf = (map) => Number((pickWeighted(random, entriesOf(map || { 1: 1 })) || { id: 1 }).id);
    const humanTraces = drawSome("humanTraces", CONFIG.humanTraces || [], countOf(pools.traceCount || POOLS.traceCount));
    const allowDingy = random() < (POOLS.dingyChance == null ? 0.35 : POOLS.dingyChance);
    const details = drawSome("details", CONFIG.details || [], countOf(pools.detailCount || POOLS.detailCount),
      (option) => allowDingy || !option.dingy);

    // 8. The fixed place, unless the brief says otherwise.
    const params = {
      shotType: "use",
      productBackground: "warm-wall-floor",
      settingType,
      scene,
      archetype: archetypeId,
      persona, fullness, livedIn, camera, framing, light,
      details, humanTraces,
      customNotes: "",
      must,
      avoid: asList(b.avoid),
      mood: b.mood ? String(b.mood) : "",
      story: b.body ? String(b.body).trim() : "",
      brief: b.name || ""
    };
    for (const key of PLACE_KEYS) {
      params[key] = b[key] && optionExists(CONFIG, key, b[key]) ? b[key]
        : archetype && archetype.params[key] ? archetype.params[key] : "auto";
    }

    return { params, must, avoid: params.avoid };
  }

  return { resolve, emptyBrief, DRAWN_KEYS, PLACE_KEYS };
})();

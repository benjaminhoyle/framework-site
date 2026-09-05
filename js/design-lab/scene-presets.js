/**
 * Named scenes to put a shelf in.
 *
 * The studio flow needs somewhere to send a finished render, and "randomise
 * every parameter" is how you get a mustard wall under a moody night light with
 * a cowhide rug — each choice defensible, the room impossible. So the scenes
 * are curated combinations with names, and the flow cycles through them.
 *
 * Each one is an **archetype plus a shot**. The seven archetypes in
 * js/studio/prompt-config.js already carry a written paragraph describing a
 * real Nairobi place — a Kilimani new-build, an older Westlands flat, a Karen
 * garden house — and that paragraph is what makes a scene coherent. What varies
 * on top is the photographic side: which room, what light, who lives there, how
 * full the shelf is. Varying the place itself would mean writing seven more
 * paragraphs badly.
 *
 * Two rules the list keeps:
 *
 *   - **Daylight only.** No golden hour, no evening lamps, no night. Warm low
 *     sun flatters a photograph and lies about a product: it recolours the
 *     finish, and the finish is what somebody is choosing.
 *   - **Nothing staged past "tidy" unless the scene is explicitly a showroom.**
 *     A shelf photographed in a room nobody lives in reads as a render, which
 *     is the one thing these images exist to not be.
 */
window.FrameworkScenePresets = (function () {
  "use strict";

  /**
   * `archetype` names the place; everything else overrides the shot.
   * Parameters left out keep the archetype's own.
   */
  const PRESETS = [
    // ── Kilimani new-build: bright, tiled, minimal ────────────────────────
    { id: "kilimani-living-light", name: "Kilimani living room, midday",
      archetype: "kilimani-bright", params: { scene: "living-room", light: "bright-soft", persona: "minimalist", fullness: "light", livedIn: "tidy" } },
    { id: "kilimani-study", name: "Kilimani study nook",
      archetype: "kilimani-bright", params: { scene: "study-nook", light: "bright-soft", persona: "creative", fullness: "moderate", livedIn: "lived-in" } },
    { id: "kilimani-bedroom", name: "Kilimani bedroom corner",
      archetype: "kilimani-bright", params: { scene: "bedroom-corner", light: "soft-cloudy", persona: "minimalist", fullness: "sparse", livedIn: "tidy" } },
    { id: "kilimani-wardrobe", name: "Kilimani open wardrobe",
      archetype: "kilimani-bright", params: { scene: "bedroom-wardrobe", light: "bright-soft", persona: "auto", fullness: "moderate", livedIn: "lived-in" } },
    { id: "kilimani-entry", name: "Kilimani entryway",
      archetype: "kilimani-bright", params: { scene: "entryway", light: "flat-overcast", persona: "auto", fullness: "light", livedIn: "lived-in" } },

    // ── Older Westlands flat: parquet, warmer, more history ───────────────
    { id: "westlands-library", name: "Westlands reading wall",
      archetype: "westlands-parquet", params: { scene: "library-wall", light: "soft-cloudy", persona: "reader", fullness: "full", livedIn: "lived-in" } },
    { id: "westlands-living", name: "Westlands living room",
      archetype: "westlands-parquet", params: { scene: "living-room", light: "bright-soft", persona: "collector", fullness: "moderate", livedIn: "settled" } },
    { id: "westlands-dining", name: "Westlands kitchen-dining",
      archetype: "westlands-parquet", params: { scene: "kitchen-dining", light: "bright-hard", persona: "auto", fullness: "moderate", livedIn: "lived-in" } },
    { id: "westlands-niche", name: "Westlands alcove",
      archetype: "westlands-parquet", params: { scene: "wall-niche", light: "soft-cloudy", persona: "reader", fullness: "full", livedIn: "settled" } },
    { id: "westlands-study", name: "Westlands home office",
      archetype: "westlands-parquet", params: { scene: "study-nook", light: "bright-soft", persona: "creative", fullness: "moderate", livedIn: "lived-in" } },

    // ── Karen garden house: green outside, generous rooms ─────────────────
    { id: "karen-living", name: "Karen living room, garden light",
      archetype: "karen-garden", params: { scene: "living-room", light: "bright-soft", persona: "plant-parent", fullness: "moderate", livedIn: "tidy" } },
    { id: "karen-library", name: "Karen reading corner",
      archetype: "karen-garden", params: { scene: "library-wall", light: "soft-cloudy", persona: "reader", fullness: "full", livedIn: "settled" } },
    { id: "karen-terrace", name: "Karen covered terrace",
      archetype: "karen-garden", params: { scene: "covered-terrace", light: "bright-hard", persona: "plant-parent", fullness: "light", livedIn: "lived-in" } },
    { id: "karen-dining", name: "Karen kitchen-dining",
      archetype: "karen-garden", params: { scene: "kitchen-dining", light: "bright-soft", persona: "auto", fullness: "moderate", livedIn: "lived-in" } },
    { id: "karen-bedroom", name: "Karen bedroom",
      archetype: "karen-garden", params: { scene: "bedroom-corner", light: "soft-cloudy", persona: "minimalist", fullness: "sparse", livedIn: "tidy" } },

    // ── South B family home: busier, children, real wear ──────────────────
    { id: "southb-living", name: "South B living room",
      archetype: "south-b-family", params: { scene: "living-room", light: "bright-soft", persona: "parent", fullness: "full", livedIn: "lived-in" } },
    { id: "southb-kids", name: "South B children's room",
      archetype: "south-b-family", params: { scene: "kids-room", light: "bright-soft", persona: "parent", fullness: "packed", livedIn: "settled" } },
    { id: "southb-nursery", name: "South B nursery",
      archetype: "south-b-family", params: { scene: "nursery", light: "soft-cloudy", persona: "parent", fullness: "moderate", livedIn: "tidy" } },
    { id: "southb-dining", name: "South B kitchen-dining",
      archetype: "south-b-family", params: { scene: "kitchen-dining", light: "flat-overcast", persona: "auto", fullness: "full", livedIn: "settled" } },
    { id: "southb-entry", name: "South B entryway",
      archetype: "south-b-family", params: { scene: "entryway", light: "bright-hard", persona: "auto", fullness: "moderate", livedIn: "lived-in" } },

    // ── Makers' studio: working rooms, tools, materials ───────────────────
    { id: "makers-studio", name: "Makers' studio wall",
      archetype: "makers-studio", params: { scene: "creative-studio", light: "bright-soft", persona: "creative", fullness: "packed", livedIn: "settled" } },
    { id: "makers-desk", name: "Makers' desk corner",
      archetype: "makers-studio", params: { scene: "study-nook", light: "flat-overcast", persona: "creative", fullness: "full", livedIn: "lived-in" } },
    { id: "makers-storage", name: "Makers' storage run",
      archetype: "makers-studio", params: { scene: "creative-studio", light: "bright-hard", persona: "collector", fullness: "packed", livedIn: "settled" } },

    // ── Staged & bright: the closest thing to a catalogue shot ────────────
    { id: "staged-living", name: "Staged living room",
      archetype: "staged-bright", params: { scene: "living-room", light: "bright-soft", persona: "minimalist", fullness: "light", livedIn: "showroom" } },
    { id: "staged-niche", name: "Staged alcove",
      archetype: "staged-bright", params: { scene: "wall-niche", light: "bright-soft", persona: "minimalist", fullness: "sparse", livedIn: "showroom" } },
    { id: "staged-bedroom", name: "Staged bedroom",
      archetype: "staged-bright", params: { scene: "bedroom-corner", light: "soft-cloudy", persona: "minimalist", fullness: "light", livedIn: "showroom" } },
    { id: "staged-office", name: "Staged office",
      archetype: "staged-bright", params: { scene: "office-commercial", light: "bright-soft", persona: "auto", fullness: "moderate", livedIn: "tidy" } },

    // ── Café corner: commercial, public, busier ───────────────────────────
    { id: "cafe-display", name: "Café display wall",
      archetype: "cafe-corner", params: { scene: "cafe-display", light: "bright-soft", persona: "auto", fullness: "moderate", livedIn: "lived-in" } },
    { id: "cafe-retail", name: "Boutique shelving",
      archetype: "cafe-corner", params: { scene: "retail-boutique", light: "bright-soft", persona: "collector", fullness: "moderate", livedIn: "tidy" } },
    { id: "cafe-office", name: "Small office",
      archetype: "cafe-corner", params: { scene: "office-commercial", light: "flat-overcast", persona: "auto", fullness: "full", livedIn: "lived-in" } }
  ];

  /**
   * Cycle rather than shuffle.
   *
   * Thirty scenes and a random draw each time gives you the same café twice
   * before you have seen Karen at all — the birthday problem, and it is what
   * "randomised" always feels like in practice. Walking the list in order and
   * starting again at the top spreads them by construction, and the offset
   * means two sessions do not open with the same picture.
   */
  function cycle(offset) {
    let index = Number.isFinite(offset) ? Math.abs(Math.round(offset)) % PRESETS.length : 0;
    return {
      next() {
        const preset = PRESETS[index % PRESETS.length];
        index += 1;
        return preset;
      },
      peek: () => PRESETS[index % PRESETS.length]
    };
  }

  function byId(id) {
    return PRESETS.find((preset) => preset.id === id) || null;
  }

  /** The full parameter set for a preset: the archetype's, with its own on top. */
  function paramsFor(preset, config, defaults) {
    const archetype = (config.archetypes || []).find((entry) => entry.id === preset.archetype);
    return Object.assign({}, defaults, archetype ? archetype.params : {}, preset.params, {
      shotType: "use",
      archetype: preset.archetype
    });
  }

  return { PRESETS, byId, cycle, paramsFor };
})();

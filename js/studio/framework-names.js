/**
 * Filenames that carry the design code — the browser half.
 *
 *     fw-1Y3MK7P-s-living-room-02.jpg
 *
 * A twin of `shelving-3d-pipeline/scripts/lib/names.py`, which is the
 * authoritative implementation of the grammar; keep the two in step. This side
 * exists because the studios never touch the pipeline's Python: they read the
 * code off a file someone dropped in, and write it into the name of what they
 * download.
 *
 * `parse` is deliberately more forgiving than `build` is strict. Someone
 * renaming a file is the normal case, not the error case: as long as the
 * seven-character code survives anywhere in the name, the chain still works.
 * That is what `parseLoose` is for — and why a loose hit must be confirmed
 * against /api/design?code= before it is trusted, since KITCHEN is also seven
 * uppercase base36 characters.
 *
 * Load via <script src="./framework-names.js">.
 */
(() => {
  "use strict";

  const PREFIX = "fw";
  const CODE = /^[0-9A-Z]{7}$/;
  const CODE_ANYWHERE = /(?:^|[^0-9A-Z])([0-9A-Z]{7})(?:[^0-9A-Z]|$)/;

  const STAGES = { render: "r", scene: "s", catalog: "c" };
  const STAGE_NAMES = { r: "render", s: "scene", c: "catalog" };
  const VIEWS = ["iso", "front", "hero", "detail"];
  const BACKGROUNDS = { studio: "bs", transparent: "bt", white: "" };
  const BACKGROUND_NAMES = { bs: "studio", bt: "transparent" };

  // Azimuth is always wrapped into 0-359, but elevation genuinely goes negative
  // (a camera below the shelf looking up). A minus sign cannot appear in a
  // token: the name is split on hyphens, so "e-5" would arrive as two tokens and
  // the camera would be silently lost. "n" carries the sign instead — a10en5.
  // No token may contain a hyphen; the scene slug is the one exception, and it
  // is reassembled from whatever is left over rather than parsed.
  const ORBIT = /^a(\d{1,3})e(n?)(\d{1,3})$/;
  const ZOOM = /^z(\d{1,3})$/;
  const LIGHTING = /^l(\d{1,3})$/;
  const SEQUENCE = /^(\d{2,})$/;
  // What a browser appends when you download the same file twice.
  const COLLISION_SUFFIX = /\s*\(\d+\)$/;

  const slugify = (value, limit = 40) =>
    String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, limit).replace(/^-+|-+$/g, "");

  function splitName(filename) {
    const base = String(filename || "").split(/[\\/]/).pop();
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    return { stem: stem.replace(COLLISION_SUFFIX, ""), ext };
  }

  /**
   * The filename for one finished image: which design, what kind, which one.
   */
  function build(code, stage, options) {
    const opts = options || {};
    if (!CODE.test(String(code || ""))) throw new Error(`${code} is not a design code`);
    if (!STAGES[stage]) throw new Error(`${stage} is not a stage`);

    const parts = [PREFIX, code, STAGES[stage]];
    // Camera, lighting and background are deliberately absent: identity is what
    // a filename is for, and the render's full recipe is inside the PNG. The
    // options are still accepted so callers need not change. See names.py.
    if (opts.slug) parts.push(slugify(opts.slug));

    parts.push(String(Math.max(1, Number(opts.sequence) || 1)).padStart(2, "0"));
    // Defaults to png to match names.py exactly. The studios deal in JPEGs and
    // pass ext:"jpg"; a twin with its own idea of the default is the kind of
    // drift these two implementations exist to avoid.
    return `${parts.join("-")}.${String(opts.ext || "png").replace(/^\./, "").toLowerCase()}`;
  }

  /**
   * Read a name we wrote. `null` when it is not one.
   *
   * Unknown tokens are ignored rather than rejected and every field except the
   * code falls back to its default, so a name that has lost a token still
   * parses — and the caller can say which defaults it assumed.
   */
  function parse(filename) {
    const { stem, ext } = splitName(filename);
    const tokens = stem.split("-");
    if (tokens.length < 4 || tokens[0] !== PREFIX) return null;
    if (!CODE.test(tokens[1]) || !STAGE_NAMES[tokens[2]]) return null;

    const stage = STAGE_NAMES[tokens[2]];
    const found = {
      code: tokens[1], stage, view: null, azimuth: null, elevation: null,
      zoom: null, lighting: 1, background: "white", slug: null,
      sequence: 1, ext, strict: true
    };

    const rest = tokens.slice(3);
    // The trailing sequence, taken off first so it can never be mistaken for
    // part of a slug.
    if (rest.length && SEQUENCE.test(rest[rest.length - 1])) {
      found.sequence = Number(rest.pop());
    }

    const leftovers = [];
    for (const token of rest) {
      // Camera tokens belong to renders and slugs to scenes, so the two can
      // never be confused — a room called "front" is fine.
      if (stage === "render" && VIEWS.indexOf(token) >= 0) { found.view = token; continue; }
      const orbit = stage === "render" ? ORBIT.exec(token) : null;
      if (orbit) {
        found.azimuth = Number(orbit[1]);
        found.elevation = Number(orbit[3]) * (orbit[2] ? -1 : 1);
        continue;
      }
      const zoom = ZOOM.exec(token);
      if (zoom) { found.zoom = Number(zoom[1]); continue; }
      const lighting = LIGHTING.exec(token);
      if (lighting) { found.lighting = Number(lighting[1]) / 10; continue; }
      if (BACKGROUND_NAMES[token]) { found.background = BACKGROUND_NAMES[token]; continue; }
      leftovers.push(token);
    }
    if (leftovers.length) found.slug = leftovers.join("-");
    return found;
  }

  /**
   * `parse`, falling back to hunting for a code anywhere in the name. This is
   * what makes renaming safe. A loose hit sets `strict: false`; confirm it
   * resolves before acting on it.
   */
  function parseLoose(filename) {
    const strict = parse(filename);
    if (strict) return strict;
    const { stem, ext } = splitName(filename);
    const match = CODE_ANYWHERE.exec(stem);
    if (!match) return null;
    return {
      code: match[1], stage: null, view: null, azimuth: null, elevation: null,
      zoom: null, lighting: 1, background: "white", slug: null,
      sequence: 1, ext, strict: false
    };
  }

  /** The design code in a filename, a URL, or something a person pasted. */
  function findCode(text) {
    const value = String(text || "").trim();
    if (CODE.test(value.toUpperCase())) return value.toUpperCase();
    const match = CODE_ANYWHERE.exec(value);
    return match ? match[1] : null;
  }

  /**
   * The lowest sequence not already used by `taken`, which is however many
   * names this session has produced. A browser cannot see the download folder,
   * so this counts within the session only — a collision across sessions comes
   * back as "file (1).png", which parses fine.
   */
  function nextSequence(taken, filename) {
    const target = parse(filename);
    if (!target) return 1;
    const used = new Set();
    for (const name of taken || []) {
      const found = parse(name);
      if (found && found.code === target.code && found.stage === target.stage
          && found.slug === target.slug && found.view === target.view) {
        used.add(found.sequence);
      }
    }
    let sequence = 1;
    while (used.has(sequence)) sequence += 1;
    return sequence;
  }

  window.FrameworkNames = { build, parse, parseLoose, findCode, nextSequence, slugify, CODE };
})();

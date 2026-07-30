# /new-designer

A 3D shelf designer at `/new-designer`, running in parallel with the existing
`/designer` and `/simplified-designer` pages. Neither of those is touched by it.

It is the desktop 3D builder from `shelving-3d-pipeline` rebuilt for the public
site: same placement engine and same Rhino-derived module geometry, but sized and
paced for a mid-range Android phone on a slow connection.

## Three interfaces, one tool

The interface switch in the header changes the control column only. The viewport,
the summary bar, the pricing and the placement engine are identical in all three,
so moving up a level never means relearning the page. A design carries across
switches (see "Switching down to Simple" below).

| | Controls | Placement rules |
|---|---|---|
| **Simple** | unit type, width, height, colour, lamp, bookends | Design is generated from the spec — a plain run. Mirrors `/simplified-designer`. |
| **Standard** | in-viewport `+` buttons, a limited set of pieces, tap a piece to swap/remove | Units may only butt directly against each other. Mirrors `/designer`. |
| **Advanced** | every piece, searchable, with a placement count each; rotate; save/load JSON | Also offers the gapped unit spacing that bridging spans need. |

The view is a locked isometric with pan, pinch/wheel zoom and auto-fit. There is
no orbit, by design — nobody can lose the shelf off-screen or end up under it.

### Which variant of a unit each interface offers

Some units exist as both a full and a "trimmed" (shortened) cut, and the shop
does not always list the full one — a compact unit is only sold as
`compact_base_trimmed`. Simple and Standard therefore offer, per family and role,
whichever variant has a price, preferring the untrimmed one. Advanced offers
everything and keeps the "(Trimmed)" suffix so the two can be told apart.

### Switching down to Simple

Simple can only express a plain run, so entering it rebuilds the shelf from the
nearest simple spec (most common unit family, number of bases, tallest stack) and
says so in the viewport. Undo restores what was there.

## Files

```txt
new-designer.html
css/new-designer.css
js/new-designer/engine.js      placement rules, pure logic, no DOM
js/new-designer/geometry.js    module bundle loader
js/new-designer/renderer.js    minimal WebGL renderer (no three.js)
js/new-designer/app.js         the three interfaces
assets/shelving/catalog.json   module metadata, sockets, prices, finishes
assets/shelving/modules/*.json geometry, one bundle per module
scripts/build-new-designer-assets.mjs
scripts/test-new-designer.mjs
scripts/fixtures/new-designer/ the pipeline's golden configs, as test fixtures
```

Everything — scripts, stylesheet, catalogue and geometry — is loaded on one
`?v=N`. **Bump it after changing any of them:**

```bash
node scripts/bump-new-designer-version.mjs
```

They have to move together: app code paired with a stale catalogue silently
loses whatever the catalogue gained, which is what a CDN hands you minutes after
a deploy. Use the script rather than editing by hand — a search-and-replace for
the old number also rewrote two SVG path commands that contained it.

## Rebuilding the assets

The geometry is baked from the Rhino pipeline. Re-run this whenever the pipeline's
modules, sockets, prices or finishes change:

```bash
node scripts/build-new-designer-assets.mjs
```

It reads `../shelving-3d-pipeline` by default (`--pipeline <path>` to override)
and rewrites `assets/shelving/`. Then run the tests:

```bash
node scripts/test-new-designer.mjs
```

The fixtures are the pipeline's own validation configs, so a placement rule that
drifts from what the Rhino/Blender pipeline considers buildable fails there rather
than on a customer's phone. The suite also checks that the fast incremental
placement check agrees with the authoritative full-state validation on every one
of them.

## Colours

Two palettes, deliberately separate, joined by `siteTheme` in the pipeline's
`shared/finishes.json`:

- **`builder`** — read from `js/designer-engine.js`'s `THEME_*` sets, which is
  what the existing `/designer` page draws with. This is what the viewport and
  the swatches use, so the two site designers show the same product in the same
  colours.
- **`steelHex` / `mdfHex`** — the real material colours from the pipeline. Left
  alone for Blender renders and the DAM.

The builder colours are scaled up slightly before reaching the shader, because
its light term lands a shelf top at ~0.94 of its base colour and a vertical post
at ~0.79.

The lamp shade is drawn **unlit**. It is a pleated ribbon of ~80 facets whose
normals alternate in and out; at the size a shade occupies that is about two
pixels per facet, so any normal-based shading aliases into vertical streaks, and
single-sided shading additionally painted every other pleat black.

## Why it is built this way

Every one of these is a response to a measurement, not a preference.

- **22MB of pipeline GLBs → 2.4MB of bundles (~790KB over the wire).** The GLBs
  carry lathe-quality detail no configurator can show: a base's rubber foot was
  4,776 triangles for a 50mm black pad. The build script recovers the instancing
  the exporter flattened (a base's four legs are one mesh), decimates
  over-tessellated small parts on a grid sized from each part's *shortest* axis,
  and quantises positions to uint16 and normals to int8.
- **Bundles are JSON with base64 buffers, not raw binary.** Netlify compresses by
  content type: `application/json` is brotli'd at the edge, `application/octet-stream`
  is served as-is. Base64 costs about a third more bytes before compression and
  saves about three quarters after it.
- **No three.js.** The scene is static geometry under a fixed camera, which needs
  one shader and no scene graph — about 20KB against roughly 460KB, on phones
  where script parse time is a real cost.
- **Frames are drawn on demand.** A configurator is static between interactions;
  a permanent `requestAnimationFrame` loop would drain a battery for nothing.
- **Candidate generation validates incrementally.** The desktop builder
  re-validated the whole assembly once per candidate per module, which is
  hundreds of milliseconds of main-thread jank per click on a mid-range phone.
  A full 47-module placement sweep over a 24-module design now takes ~30ms on a
  laptop.
- **No white outline on the geometry.** It was in the first version, matching the
  desktop tool. It added almost nothing over the lit shading, washed out 20mm
  steel tubes at phone sizes, and cost 29% of the geometry payload.

## Analytics

The page loads the Meta pixel and gtag *after* it is interactive, on
`requestIdleCallback`. On a mid-range phone those bundles cost more parse time
than this entire app, and the point of the page is that the shelf appears fast.
It deliberately does not load `js/site.js`: that would inject the site header and
footer over a full-screen tool, and `/new-designer` is not in its
designer-page exclusion list.

## Not done yet

- **Corner units.** `/simplified-designer` offers them; the placement engine has
  no rules for them yet (`generateCandidates` returns nothing for a corner
  module), so they are excluded from the catalogue rather than shown and broken.
- **Bookends** are priced and included in the WhatsApp order, but have no 3D
  model in the pipeline (`status: model-pending`), so they do not appear in the
  view.
- **Eight pieces have no price** and read "on request": `booster_adapter`,
  `broad_hanger`, `broad_spacer`, `broad_top_bar`, `compact_top_bar`,
  `deep_top_bar`, `slim_spacer`, `slim_top_bar`. A trimmed cut inherits its full
  unit's price and vice versa, so these are genuinely absent from
  `shared/prices.json` rather than a mapping gap. They are excluded from the
  total, which the summary says out loud.
- **`noindex`.** Remove the meta tag in `new-designer.html` when this page
  replaces `/designer` or `/simplified-designer`, and add it to `sitemap.xml`
  then — not while both are live and competing for the same queries.

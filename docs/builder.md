# /builder

A 3D shelf designer at `/builder`, running in parallel with the existing
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
builder.html
css/builder.css
js/builder/engine.js      placement rules, pure logic, no DOM
js/builder/geometry.js    module bundle loader
js/builder/renderer.js    minimal WebGL renderer (no three.js)
js/builder/present.js     composes the share image
js/builder/app.js         the three interfaces
netlify/functions/design.js    /api/design — saved designs, by short code
assets/shelving/catalog.json   module metadata, sockets, prices, finishes
assets/shelving/modules/*.json geometry, one bundle per module
scripts/build-builder-assets.mjs
scripts/dev-builder.mjs        local server, with the rewrites and the function
scripts/test-builder.mjs
scripts/fixtures/builder/ the pipeline's golden configs, as test fixtures
```

## Working on it

```bash
npm run dev            # http://127.0.0.1:8770/builder
npm test               # engine, assets, geometry and /api/design
```

`npm run dev` rather than `python3 -m http.server`: `/builder`, `/builder/<CODE>`
and `/api/design` are a rewrite, a rewrite and a function, and without them a
saved design cannot be created or opened locally. It runs the real function with
an in-memory store; `netlify dev` is the higher-fidelity option if you have the
CLI.

Two things that will otherwise waste an hour:

- **Bump the version after every change** under `js/`, `css/` or `assets/` (see
  below). Without it the browser serves a stale half of the app.
- **Cache-bust the HTML too** when testing (`builder.html?cb=<n>`): the page
  itself carries no version, so a plain reload can keep serving the old HTML
  with its old `?v=`.

Everything — scripts, stylesheet, catalogue and geometry — is loaded on one
`?v=N`. **Bump it after changing any of them:**

```bash
node scripts/bump-builder-version.mjs
```

They have to move together: app code paired with a stale catalogue silently
loses whatever the catalogue gained, which is what a CDN hands you minutes after
a deploy. Use the script rather than editing by hand — a search-and-replace for
the old number also rewrote two SVG path commands that contained it.

## Rebuilding the assets

The geometry is baked from the Rhino pipeline. Re-run this whenever the pipeline's
modules, sockets, prices or finishes change:

```bash
node scripts/build-builder-assets.mjs
```

It reads `../shelving-3d-pipeline` by default (`--pipeline <path>` to override)
and rewrites `assets/shelving/`. Then run the tests:

```bash
node scripts/test-builder.mjs
```

The fixtures are the pipeline's own validation configs, so a placement rule that
drifts from what the Rhino/Blender pipeline considers buildable fails there rather
than on a customer's phone. The suite also checks that the fast incremental
placement check agrees with the authoritative full-state validation on every one
of them.

## Present

The Present button composes a client-facing image: the shelf, its size, the
finish, the module breakdown, the total, the Framework mark, and a short design
reference. `js/builder/present.js` does the composition; `app.js` gathers the
content and takes the snapshot.

- **1080 × 1350**, WhatsApp's portrait format — shown large in a chat without the
  preview being cropped, and 1080 wide is the most WhatsApp keeps before
  re-encoding.
- The shelf always gets the same box and is **always re-fitted into it**, so an
  image never inherits wherever the live view happened to be panned or zoomed.
  It does follow whether the isometric or the front view is selected.
- The `+` affordances are absent because the snapshot draws placed instances
  only; there is nothing to hide.
- **Shown, not downloaded.** On a phone a long-press on an `<img>` offers "copy
  image", which is what actually gets a design into a conversation; a download
  lands in Files and has to be found again.
- **Dimensions follow the viewport's toggle.** They are drawn, not photographed:
  the live overlay is SVG over the canvas and the snapshot is the WebGL layer
  alone. `dimensionGeometry()` in `app.js` returns plain screen-space segments
  and numbers, and is called twice — once through the live camera, once through
  the one `renderer.snapshot()` hands back, which is the only way to reach a
  camera that no longer exists by the time the pixels do. The shelf is pulled in
  further when they are on, or the height callout clips the top of the art box.
- **The module list is sized to fit, not capped.** Rows are counted, split into
  two columns past seven, and then given whatever type size the band's height and
  the column's width both allow. A long design gets smaller type rather than a
  "+ 9 more pieces" line standing in for half of it; past 25 distinct module
  types it does truncate, which no real design reaches (it is one row per *type*,
  so a 30-unit run of three parts is three rows).
- The **design address** reads `framework.co.ke/builder/1Y3MK7P`, one size
  throughout with the code in bold against a muted path. It is a real URL: see
  "Saved designs". It replaced `framework.co.ke/new-designer · 1JALY1R`, where
  the middle dot read as neither a separator nor part of an address.

The snapshot itself comes from `renderer.snapshot()`, which resizes the canvas,
frames, draws and reads back without returning to the event loop. The context is
created without `preserveDrawingBuffer`, so the pixels only exist until the
browser next composites — which is also why it uses `readPixels` rather than
`toDataURL`.

## Saved designs

`framework.co.ke/builder/1Y3MK7P` opens the shelf it names.

The code is not minted anywhere: `designCode()` is an FNV-1a hash of the
serialised design, so the same shelf always gets the same code, and saving one
twice is the same record rather than two. That is what makes the write
idempotent, so `/api/design` takes the first write and never overwrites it — a
repeat POST must not replace the arrival details of whoever created it.

- `netlify/functions/design.js` on a `design` Blobs store, following `track.js`
  and its no-PII rule. GET resolves a code; POST stores the design, the share
  hash, the mode, and how the user arrived (session, referrer, ad parameters).
- Both representations are stored on purpose: the hash is what the page reads
  back and is immune to a catalogue rename, and the serialised design is the one
  a person can read in the store six months later.
- `netlify.toml` rewrites `/builder/*` to the page, which reads the code off its
  own path. **This is why the page's assets are referenced from the site root** —
  at that depth a relative `css/…` resolves inside `/builder/`. A `<base href>`
  would have been one line but also redirects `history.replaceState`, which would
  throw the path away on the first edit.
- A hash in the URL always wins over a code in the path: the hash is the live
  state, the code is what a share image carries.
- **Present saves the design too**, not just Advanced's "Create link" — otherwise
  the address printed on the image would be one that 404s.

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

A piece can be given **a colour of its own**, through Colour in the menu that
appears when you tap it. It is an optional `finish` on the instance, carried
through `serializeState`/`deserializeState` and through the share link, where the
colours live in their own table appended to the payload — so a link written
before per-piece colour existed still opens, and one written with it opens in an
older deployment too, just without the colours. Only steel and surface change: a
rubber foot, a paper shade and a lamp flex are the colours of the materials
themselves. Where the colour has to be named rather than shown — the share image,
the WhatsApp order — every finish in use is listed, because "Sage" alone would be
a half-truth about a picture the client can see.

## Why it is built this way

Every one of these is a response to a measurement, not a preference.

- **22MB of pipeline GLBs → 2.7MB of bundles.** The GLBs carry lathe-quality
  detail no configurator can show: a base's rubber foot was 4,776 triangles for a
  50mm black pad, and a leg is a pipe of 514 vertices per wall. The build script
  recovers the instancing the exporter flattened (a base's four legs are one
  mesh), decimates over-tessellated small parts on a grid sized from each part's
  *shortest* axis, and quantises positions to uint16 and normals to int8.
- **A square grid cannot keep a round thing round.** Every leg, post and rail was
  coming out 19% out of round — radii between 8.6mm and 10.6mm on a 10mm tube —
  because how far a cell's average falls inside the true arc depends on where the
  cell edges cut it, and because a 2.5mm cell welds a 1.5mm pipe wall to its
  outer face. That is the visibly broken faceted seam that used to run down the
  front of a unit. The fix is to put the shell into the cell key, so a pipe's two
  walls can never collapse into one point, and then push each surviving vertex
  back out to its own shell's exact radius. Regular matters more than fine: a
  twenty-sided leg reads as round at any zoom this tool offers, provided all
  twenty sides are the same. Worst part anywhere is now 1% out, for 6% more
  bytes — inner walls are decimated far harder than outer ones to pay for it, on
  the grounds that the inside of a leg is visible, if at all, down an open tube
  end a few pixels across. `scripts/test-builder.mjs` asserts the roundness.
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
footer over a full-screen tool, and `/builder` is not in its
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
- **`noindex`.** Remove the meta tag in `builder.html` when this page replaces
  `/designer` or `/simplified-designer`, and add it to `sitemap.xml` then — not
  while both are live and competing for the same queries.
- **Simple's Height stepper reads the shelf only**, while the summary and the
  dimension arrows include the lamp. Deliberate — its `+`/`−` add 30cm shelf
  levels, and showing the lamp-inclusive figure next to them read as broken — but
  flagged in case you would rather all three agreed.
- **Saved designs are never cleaned up.** Every Present and every "Create link"
  writes a blob, keyed by a hash of the design, so repeats cost nothing but
  distinct designs accumulate. There is no expiry and nothing reads the store
  back yet — the arrival details are being collected for a report that does not
  exist.
- **The old `/new-designer` address is a 301** to `/builder`, because links with
  a design in the fragment are in WhatsApp threads. It can go once those have
  aged out; the fragment rides along until then.

## History

Named `/new-designer` while it ran in parallel with `/designer` and
`/simplified-designer`; renamed to `/builder` in July 2026. Per-piece colour,
Download/Upload, "Create link to design", the resolvable share address, the
dimensioned share image and the round-part fix all landed at the same time.

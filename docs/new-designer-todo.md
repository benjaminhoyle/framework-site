# /new-designer — outstanding work

Handover spec. Everything below is **not yet built**. For how the thing works
today, read `docs/new-designer.md` first — it explains the three interfaces, the
asset pipeline, and several decisions that look arbitrary until you know why.

## Where things are

A new session opened in `framework-dam` needs to move up and across:

```bash
cd ../framework-site          # /Users/ben/code/framework/framework-site
```

Relevant paths from there:

```txt
new-designer.html                     the page
css/new-designer.css
js/new-designer/engine.js             placement rules, pure logic, no DOM
js/new-designer/geometry.js           module bundle loader
js/new-designer/renderer.js           minimal WebGL renderer (no three.js)
js/new-designer/present.js            composes the share image
js/new-designer/app.js                the three interfaces
assets/shelving/catalog.json          module metadata, sockets, prices, finishes
assets/shelving/modules/*.json        geometry, one bundle per module
scripts/build-new-designer-assets.mjs bakes the above from the Rhino pipeline
scripts/bump-new-designer-version.mjs
scripts/test-new-designer.mjs
scripts/fixtures/new-designer/        the pipeline's golden configs
docs/new-designer.md                  how it works and why
```

The geometry source is a sibling repo, `../shelving-3d-pipeline`, read by the
build script. `js/designer-engine.js` (the old `/designer` page) is the source of
the builder colour palette.

### Working on it

```bash
cd ../framework-site
python3 -m http.server 8770 --bind 127.0.0.1   # then /new-designer.html
node scripts/test-new-designer.mjs             # engine + asset integrity
node scripts/bump-new-designer-version.mjs     # after ANY change under js/, css/ or assets/
```

Two things that will waste an hour if you don't know them:

- **Bump the version after every change.** Scripts, stylesheet, catalogue and
  geometry all load on one `?v=N`. Without a bump the browser serves a stale
  half of the app and you will debug code that is not running. Use the script —
  a hand search-and-replace once rewrote two SVG path commands containing the
  old number.
- **Hard-reload with a cache-buster on the HTML too** (`?cb=<n>`): the page
  itself carries no version, so a plain reload can keep serving the old HTML
  with its old `?v=`.

`main` is production; Netlify publishes from it. Current state is deployed and
working at `https://framework.co.ke/new-designer`.

---

## A. Carried over, never started

### A1. Per-module colour override

In **Standard and Advanced**, the menu you get when tapping a module gains a
colour option, with a way to revert that piece to the global colour.

Needs:

- **Engine** — an optional per-instance `finish`. It existed once and was removed
  in favour of a single design-level finish; it has to come back through
  `serializeState` / `deserializeState`, and through the compact share-link
  encoder in `app.js` (`encodeDesign` / `decodeDesign`), which currently encodes
  no finish per row.
- **Renderer** — `setInstances` takes an optional per-instance palette;
  `drawBatches` currently reads `state.palette[batch.role]` for everything.
- **App** — a colour row in the action menu. The menu is a small floating popout
  anchored on the piece; it already holds Swap / Rotate / Remove. **Do not just
  add four swatches to it** — it has to stay thumb-sized on a phone. A "Colour"
  entry that opens the existing picker sheet (`openPicker`) is the shape that
  already fits, with "Match the rest" as the first row.

### A2. Download / Upload, and Create link

- Rename Advanced's **Save design / Load design** to **Download / Upload** and
  make those buttons smaller — they are for the team, not customers.
- Add **Create link to design**, with a copy button once generated. Use the same
  code as the Present image (`designCode()` in `app.js`).
- When a link is created, store it: the design, the code, session details, and
  some basics about how the user arrived at it. The repo already has Netlify
  Functions with Blobs (`netlify/functions/`, see `track.js`) — follow that
  pattern rather than inventing one.

This is also what makes the Present image's code **resolvable** (see B3): today
the code identifies a design but cannot be turned back into one.

---

## B. New, from the latest review

### B1. Present: handle long module lists

The breakdown currently caps at 6 rows and then says "+ N more pieces", which is
a floor, not a solution. Wanted:

- A denser format, roughly `2 × Broad Base — KSh 5,000 each`, possibly in **two
  columns**.
- Beyond that, a layout that **is guaranteed to fit** — shrink type, split
  columns, whatever it takes — with "+ X more modules" only as a last resort.
- Worth testing against a 20+ piece Advanced design, not a 3-piece Simple one.

`js/new-designer/present.js` owns the layout; `presentContent()` in `app.js`
supplies the rows.

### B2. Lamp shade colour

Correct now but drab. Make it **slightly warmer and a bit lighter**.
`PAPER_COLOR` in `js/new-designer/renderer.js` (currently `#f6f1e6`).

### B3. The design link on the Present image is unclear

It currently reads `framework.co.ke/new-designer · 1JALY1R` — the middle dot
reads as part of a URL and the whole thing is ambiguous. Expected something like
`https://framework.co.ke/new-designer/0PT1NBT`.

- Make it unambiguous as a link. **The code may be larger** than the URL, as
  long as it stays clear which part is the address.
- That path form does not resolve today. Either make it resolve (A2 plus a
  `/new-designer/*` redirect that hands the code to the app), or print a form
  that is honestly not a link. Do not print a URL that 404s.

`compose()` in `present.js` draws it; `presentContent()` in `app.js` builds the
string.

### B4. Present should follow the dimensions toggle

If dimensions are switched on in the viewport, the share image should show them;
if not, it should not. The image currently never draws them.

Note the dimension overlay is SVG drawn over the live canvas
(`drawDimensions()` in `app.js`), not part of the WebGL snapshot — so this means
either drawing the same geometry into the 2D canvas in `present.js`, or
rasterising the SVG. The projection maths is already there and is exposed
through `renderer.project()`.

### B5. Jagged round legs

Some vertical legs render with a broken, faceted seam — clearest on the
**front-left leg of a compact base**, on the face towards the viewer. Low
priority; fix only if there is a clean cause.

Likely suspects, in order:

1. The grid decimation in `scripts/build-new-designer-assets.mjs` — cell size
   comes from the part's shortest axis, and a leg tube is exactly the case where
   that is tight. `DECIMATE_CELLS_ACROSS` is currently 8.
2. `dedupeParts()` matching two legs up to an axis mirroring and reusing one for
   the other, where the mirror is not quite exact.
3. Normal recomputation after decimation seaming where the tube's start and end
   vertices are not welded.

### B6. Lamp cable does not meet the stem

There is a visible gap between the top of the black cable and the underside of
the lamp arm. Shift the cable up. `lampFlexPart()` in
`scripts/build-new-designer-assets.mjs` — `z1` is `stub[2] + 8`, where `stub` is
the lowest steel geometry the shade's axis passes through.

### B7. Lamp's vertical dimension arrow sits too low

The height callout should touch the **top of the lamp**; it currently stops
short. `drawHeightCallouts()` in `app.js` — the value already includes the lamp
(`full[5]`), so this is the arrow's anchor, not the number.

---

## Known-good behaviour worth not breaking

The test suite (`node scripts/test-new-designer.mjs`) runs the shelving
pipeline's own golden configs against the placement engine, and asserts that the
fast incremental placement check agrees with the authoritative full-state
validation on every one of them. That equivalence is what keeps candidate
generation fast enough for a phone. If you touch `engine.js`, that suite is the
thing that tells you whether you broke the product's buildability rules.

Also still open, from the original build:

- **Corner units** — `/simplified-designer` offers them; the engine has no
  placement rules for them, so they are excluded from the catalogue rather than
  shown and broken.
- **Bookends** — priced and ordered, no 3D model in the pipeline.
- **Eight pieces have no price** and read "on request". A trimmed cut inherits
  its full unit's price and vice versa, so these are genuinely absent from
  `shared/prices.json`, not a mapping gap.
- **`noindex`** — remove it from `new-designer.html`, and add the page to
  `sitemap.xml`, when this replaces `/designer` or `/simplified-designer`.
- **Simple's Height stepper reads the shelf only** while the summary and the
  dimension arrows include the lamp. Deliberate — the stepper's `+`/`−` add 30cm
  shelf levels and showing the lamp-inclusive figure next to them read as broken
  — but flagged in case you would rather all three agreed.

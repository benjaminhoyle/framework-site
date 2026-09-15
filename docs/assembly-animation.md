# The assembly animation — feasibility, and how one is built

> What this is: the feasibility case and build reference for the
> scroll-driven assembly animation at /assembly, covering the camera, layout
> rules, and how a story is built and edited.
> When to read it: before changing the camera, layout, or tier logic, or to
> check section 13 for what is still untested; the shipped verdict alone is
> in the opening lines.

A scroll-driven animation of a Framework shelf assembling itself: the Apple
product-page idea, where the scrollbar is the transport control and the product
takes itself apart as you go.

**Verdict: feasible, cheaper than the alternatives, and built.** `/assembly` is
The Curator's Shelf assembling itself, running on the builder's own renderer and
the builder's own geometry.

It is **deployed but not linked and not indexed** — reachable so it can be
opened on a real phone, and inside Instagram's browser, which is the one thing
that cannot be checked from a desktop. Where it belongs in the site's navigation
is still open; `how.html` is currently a redirect to an Instagram reel and is
the obvious slot. Add `?bench=1` to the URL for the tier badge.

```bash
npm run dev     # then http://127.0.0.1:8770/assembly-lab.html
npm test        # includes scripts/test-assembly-story.mjs
```

---

## 1. The finding that decides the approach

Everyone builds these as an **image sequence** — a few hundred frames rendered
offline, cross-faded on scroll — because the models involved are far too heavy
to run live in a browser. Ours are not. The whole thing, live, in 3D:

| | gzipped |
|---|---|
| six module bundles (this shelf's geometry) | 96 KB |
| `js/builder/renderer.js` + `geometry.js` | 15 KB |
| the story, the shelf data and the scroll engine | 12 KB |
| `css/assembly.css` | 3 KB |
| **total** | **≈ 126 KB** |

That is 26,300 triangles and up to seven draw calls a frame. For comparison,
`images/shelving/configs/asymmetric-display-populated.jpg` — one photograph of
this shelf, already on the site — is 279 KB.

The two alternatives are both worse:

- **An image sequence.** 60 frames at a size worth looking at is roughly 2 MB,
  it is fixed to one aspect ratio and one zoom path, and every change in Rhino
  means re-rendering and re-uploading all of it.
- **A scrubbed `<video>`.** Smaller on paper, unusable in practice: seeking by
  `currentTime` is unreliable on iOS and visibly janky inside Instagram's
  in-app browser, which is where most of this page's traffic will land. Video
  is the right format for the feed, not for the page.

So the live version is the *small* version here, which inverts the usual
trade-off. Measured cost per scroll frame on this machine:

| | |
|---|---|
| sample the timeline + build instances + set the camera | **0.01 ms** |
| draw (1.58 Mpx, device pixel ratio 2) | under 6 ms including a full `readPixels` the live path never does |

The CPU half is free. The page is fill-rate bound and nothing else, which is why
the only lever that matters on a slow device is the pixel ratio.

---

## 2. Page layout: the norms, and the ones that are not optional

The structure is the standard one and there is no reason to deviate:

```html
<div class="fa-track">          <!-- tall: the scroll distance, ~560vh -->
  <div class="fa-stage">        <!-- position: sticky; top: 0; height: 100svh -->
    <canvas class="fa-canvas">
    …absolutely positioned annotations…
```

`progress = (scrollY − trackTop) / (trackHeight − stageHeight)`, clamped to
0–1. The story starts exactly when the stage locks and ends exactly when it
unlocks.

Four rules hold it together, and each is a response to something that breaks
rather than to taste:

- **Nothing above `.fa-stage` may carry a `transform`, `filter`, `perspective`
  or `will-change`.** Any of them turns an ancestor into a containing block and
  `position: sticky` silently stops working. This is the single most common way
  a page like this breaks, and it usually arrives later, in a site header.
- **`100svh`, not `100vh`.** In an in-app browser `100vh` is the *large*
  viewport, so a `100vh` stage is taller than the visible area and the caption
  sits underneath the host app's toolbar.
- **A `requestAnimationFrame` loop reading `scrollY`, not a `scroll` listener.**
  Reading `scrollY` in rAF costs nothing and is always the value the frame is
  about to composite at. A scroll listener fires at its own rate, coalesces
  during a fling, and on iOS has historically gone quiet during momentum —
  which strands the animation mid-move while the page keeps travelling. The
  loop runs only while an `IntersectionObserver` says the track is on screen.
- **Never `preventDefault` a wheel or touch event.** Scrolling stays native, so
  a fling, a rubber-band, and a jump to an anchor all land on a coherent frame.

Also: measure the track **once and on resize**, never per frame.
`getBoundingClientRect()` inside a scroll loop forces layout at the exact moment
the browser is trying to composite.

---

## 3. The camera

**A key does not hold a camera position. It holds a box that must be in frame.**

```js
{ at: 0.39, focus: [993, -150, 332, 1293, 150, 632], padding: 1.0 }
```

The renderer's `fit(boundsMm, padding)` sizes the view to whatever viewport it
actually has, so one set of numbers frames correctly on a 390px phone in
portrait and on a 27" monitor. This is the single most useful property of the
whole approach — it is normally the thing that needs two sets of numbers and a
media query, and here it needs neither. (Verified: the same hero key fills the
frame at 720×560 and at 420×760.)

Two details make it read as film rather than as arithmetic:

- **Zoom interpolates geometrically, pan linearly.** Between keys the box's
  centre moves linearly but its half-extent moves in log space. A zoom that is
  linear in millimetres races at the wide end and crawls at the tight end, and
  this story dollies about 6× in one move.
- **A hold is two identical keys.** That is the entire mechanism for "pause
  while an annotation is read". There is no separate concept for it.

The view is the builder's locked isometric, which means the animation cannot
produce a frame that looks unlike the configurator. The renderer also has a free
orbit (`setViewMode('orbit')`, `setOrbit({azimuthDeg, elevationDeg})`) if a
future story wants to turn around the shelf; nothing here uses it.

---

## 4. Annotations

`renderer.project(pointMm)` returns CSS pixels relative to the canvas, so a
label can be pinned to a real point on the model. Pins are positioned inside the
renderer's `onFrame` callback — from the camera that actually drew the frame,
not the one we last asked for, because draws are coalesced and on the frame a
fling lands on those are not the same thing.

A pin can `follow` a piece, which adds that piece's current animation offset to
its anchor: that is what lets "1,420 mm, one drop" ride the descending adapter
instead of hanging where the adapter will eventually be.

Two things are enforced in code because they cannot be got right in the data:
anchors that leave the frame **fade out** over the last 40px (a leader line to
something three metres off-screen is a line across the picture to nothing), and
labels are **clamped into the frame** while their dots stay put (the label
offset is written in pixels and cannot know how wide the viewport is).

---

## 5. Instagram's in-app browser

Where most ad traffic lands, and the environment this has to survive:

| | |
|---|---|
| `100vh` | reports the large viewport; use `svh` and `env(safe-area-inset-bottom)` |
| chrome | injects its own top and bottom bars that overlap without telling the page |
| `position: sticky` | fine, provided no ancestor establishes a containing block |
| scrubbed `<video>` | unreliable — the main argument against the video approach |
| WebGL | available; contexts are dropped fairly readily on background/foreground, which `js/builder/renderer.js` already handles (`webglcontextlost`/`restored`) |
| autoplaying video | unreliable |

Nothing here needs a workaround beyond the layout rules in §2, which is the
main reason to prefer live WebGL over a scrubbed video.

**Not yet tested on a real device.** The prototype has been verified frame by
frame and arithmetically, but a pass on an actual mid-range Android phone inside
the Instagram browser is the one piece of validation still missing.

---

## 6. How a story is made

```
data/assembly/<name>.design.json     a saved /builder design, captured once
        │
        │  scripts/bake-assembly-story.mjs   (runs js/builder/engine.js)
        ▼
js/assembly/<name>-shelf.js          GENERATED: pieces, resting places, build
        │                            order, joints, pivots, palette, price
        │
        │  js/assembly/story.js      AUTHORED: camera keys, captions, pins
        ▼
js/assembly/scroll-story.js          the engine
```

**Geometry is generated; direction is authored.** The bake runs the design
through the builder's own placement engine, so the story's numbers *are* the
builder's numbers and no frame can show a joint that would not close in steel —
the only thing being animated is how far a piece still has to travel. It also
derives the **build order from the support graph**, so pieces can only arrive
after whatever holds them up.

Two cross-checks that the reconstruction is right: every translation matches
what `framework.co.ke/builder/0GI7A94` produces in the browser, and the pieces
total Ksh 36,500, which is the price on the product page.

The story file then refers to geometry by name — `around(['item_001'], 130)`,
`frontJoint('item_002')` — rather than by coordinate, so a geometry change moves
the animation without anybody retyping a millimetre.

`scripts/test-assembly-story.mjs` (in `npm test`) samples the whole timeline a
thousand times over and checks the things that fail silently: NaNs in a focus
box draw a blank screen halfway down a page rather than throwing; a piece
revealed already at rest pops into the picture instead of arriving in it; a
caption window under about 2% never reaches full opacity. Its most important
assertion is that the generated file is still what the bake would produce today
— the same guard, for the same reason, as the contract check in
`scripts/test-builder.mjs`.

**Re-run the bake after `make site` in the pipeline**, alongside the builder
assets.

---

## 7. The story as it stands

The Curator's Shelf, because it is the awkward one. A plain run of identical
units would animate more sweetly and explain nothing: stacking three of the same
box teaches you that boxes stack. Everything that makes this shelf asymmetric is
a rule of the system rather than a special part — which is the thing that is
hard to say in a photograph and easy to show in a move.

| scroll | beat |
|---|---|
| 0–18% | one wide base on the floor |
| 20–35% | the adapter drops on. It is the piece that makes the asymmetry possible: the base offers two places to stand and the adapter offers three, which is verifiable in the sockets |
| 40–64% | a 6× dolly into one leg, a **hold 90 mm open**, then the pin closes |
| 64–80% | a short unit on the left, then a bare 20 mm booster on the right |
| 80–90% | the second booster, then one shelf bridging two different supports |
| 90–100% | the full-width top, then the hero and the price |

**Nothing lands in pairs.** Two pieces arriving together read as one event, and
this shelf's whole argument is that a short unit and a bare post are two
different answers to the same problem — which nobody can see if they come down
as a chord. Each piece starts while the one before it is still falling and lands
after it: close enough to be one movement, far enough apart to be two decisions.
Within a tier the shelf unit goes first and the booster second, so the booster
arrives as the odd one out, into a gap the eye has already noticed.

The copy above is the shape of the beats, not the words on the page: those are
edited separately (§10) and change more often than the timing does. The
measurements the captions quote — a ⌀16 mm rod into a ⌀20 mm tube, with a ⌀24 mm
shoulder above it — are what the module geometry actually draws, and worth
re-checking against `assets/shelving/modules/*.json` if the copy ever changes
them.

The joint chapter is the one that needed the most work, and the reason is worth
recording: **this joint is concealed once it is closed.** A close-up of the
finished shelf shows a post with a seam in it and explains nothing. Held 90 mm
open it explains itself — a ⌀20 mm tube on the base, a ⌀16 mm rod beneath the
adapter, air in between. Which is why the descent is split either side of a
hold rather than run straight through.

(The photographer arrived at the same shot independently:
`images/shelving/configs/asymmetric-display-joint.jpg` is exactly this frame.)

---

## 8. What is on the shelves: nothing

Books were built and then taken out again, and the attempt is worth recording so
nobody spends the afternoon again.

The reasoning for trying was sound: a book is a box, and in a flat-shaded
isometric drawing an upright rectangular prism does not *approximate* a book, it
is how a book is drawn. A generator produced them in the same
`framework-module-geometry@1` format as the modules, filling shelf surfaces that
the bake script derived from the design, capped to each shelf's own headroom, in
a restrained spine palette. Technically it all worked and it cost 45KB.

It looked wrong anyway. Two things that only showed up once it was on screen:

- **The props competed with the subject.** This page is a technical explanation
  and its charm is that it is clean. A shelf of coloured boxes turns it into a
  cartoon of a shelf, and the eye goes to the boxes.
- **They wrecked the one shot that matters.** Books on the bottom shelf are
  *nearer the camera* than the joint the story dives into, so they crowded the
  30mm pin from the bottom of the frame even 300mm below it and a metre away —
  worse in portrait, where a narrow viewport makes `fit` zoom out. Keeping them
  clear of it meant authoring around the close-up, which is the tail wagging
  the dog.

If styling ever comes back, the only honest option in the system is the real
`lamp` module, which was modelled for this renderer. Note that a lamp is a
Framework product, so putting one in a picture captioned "Ksh 36,500" implies it
is included.

---

## 9. On a phone

Checked at 390×844 with the viewport emulated. It works, and two things had to
change for it to.

**The caption is not an overlay on a phone, it is the bottom of the screen.** A
360px card floating over a portrait viewport covers the lower third of the
model, and the lower third is where the feet, the lowest joint and most of the
width are. So the canvas gives up a band instead: model on top, words below,
never one over the other. The band is measured at load from the tallest caption
in the story rather than guessed, because the copy changes and a guessed height
is either wasted space or a clipped last line.

**A tight shot has to be thin, not just small.** `fit` sizes the view to
whichever of a box's two screen dimensions needs more room, so on a portrait
phone a box's *width* sets the zoom and its height gets padded out — the 300mm
cube around the joint ended up framed as though it were 470mm tall, with the
subject small and off to one side in a lot of nothing. Thinning the box along
the axis that has nothing to show (depth: the joint is on the front face, and
there is no second thing behind it) took that padding back and made the shot
about 30% larger with no other change. `cube()` therefore takes a half-extent
per axis.

**Pin labels choose their own side.** The story writes an offset, not a side. A
label placed to the right of an anchor near the right edge gets clamped back
over its own dot, and on a phone — a third the width — that is most of them. The
offset is now treated as a distance and the side is picked at paint time,
flipping to whichever has room. The dot never moves, so the leader line stays
honest either way.

**There is no progress rail.** A dot per caption sat at the model's right
edge, and on a phone in a row under it. A row of dots under a picture is what
a carousel looks like, and it read as something to swipe, so it went, on
every story.

**A scroll cue, and an eased scrub.** Some readers on phones reached the locked
stage, saw a picture and a caption, and did not think to scroll. So the stage
carries the intro's own cue, the word Scroll over a nudging chevron, at the
foot of the model (just above the caption band on a phone). It comes up when
the stage is locked and the reader has stopped: after 0.45 seconds while they
are still on the opening frame, after 1.2 seconds once they have moved the
story on (3.5 at first, which Ben found too slow; much under a second and it
flashes up between two swipes), never in the last 3%, and it goes the moment the scroll position
moves (`paintHint()` in `scroll-story.js`). Scrolling back up is the one
movement that brings it up rather than sending it away: a reader going
backwards has most likely lost the thread, so after a few pixels upwards the
cue shows at once and stays until they scroll down again.

The drawn progress also follows the scroll position rather than jumping to it,
closing the gap over about a fifth of a second (`SCRUB_MS`; the same idea as a
numeric `scrub` in GSAP's ScrollTrigger). One flick on a phone could carry a
reader through a whole camera move in a frame or two, so the change of angle
into the bookend close-up on /customize was simply not seen there; eased, it
plays. Every frame is still one progress value, so captions, pins and pieces
never disagree. A jump of more than a third of the story (an anchor, a restored
scroll position) is taken at once. For the same reason
/customize's track on a phone went from 480vh to 600vh: longer, not shorter,
where a flick covers the most ground.

**The loading mark.** Until there is a story to look at, the stage shows the
Framework mark drawing itself (`.fa-loading`). It is in each page's own markup,
so it is there before any script has arrived, which matters most on /customize,
whose scripts load only as the reader nears. It waits 0.4 seconds before it
starts, so a quick load never shows it, and readers who asked for less motion
get it fading rather than drawing. `start()` settles it once the first frame
is up, or the stills or photographs are, or loading failed. If a script never
arrives at all, /how takes the track out and /customize puts the shelf's
photograph in its place, rather than leave a tall blank stage.

**Reduced motion fades through white at a cut.** `calm`, which an iPhone with
Reduce Motion on gets, keeps the pieces moving and cuts the camera, so on
/customize the change of angle into the bookend close-up was a jump rather
than a turn, and read as the page skipping. The jump now happens out of sight:
the frame fades to white over 2% of the story before the cut and back over 2%
after it (`veil` from `sample()`, worked out by `cutVeil()`), and pins fade with
it. A fade is not motion, which is why it is the usual stand-in for a camera
move under reduced motion. `calm` is eased like the other tiers, which is what
lets a flick show the fade rather than skip straight past it.

**The tier badge is on every story page.** `?bench=1` on /how, /customize or
/assembly shows which tier the device got and why, with links that force each;
the lab also shows it on localhost. It moved into `start()` from the lab page,
because "why does my phone not turn the camera?" gets asked on the pages people
actually open, and a phone is where a console is hardest to reach.

**The pixel ratio is checked against reality, not guessed from the device.** The
tier signals are wrong on exactly the hardware they most need to protect: a
mid-range Android reports eight cores and no memory at all and lands in `full`;
iOS reports neither number, so every iPhone including old ones lands in `full`
too. So if the page spends a run of twelve frames slower than about 30fps *while
it is repainting*, the drawing buffer steps down — twice at most, and only
downwards, because a page renegotiating its own resolution mid-scroll is worse
to look at than one that is slightly soft. Fill rate is the only thing this page
spends anything on, so it is the only thing worth taking away.

Measured at 390×844: `lite` tier, a 390×844 drawing buffer (0.33 megapixels
against 1.58 on the desktop), no horizontal overflow, `touch-action: pan-y` on
the canvas so a swipe always scrolls the page. The scroll track is 4,726px —
about 4.6 screens.

Still to check on real hardware: the scroll itself. Momentum, rubber-banding and
the address bar can only be judged on a device, and the browser used for this
work could not exercise them. Everything above is layout and framing, which can.

---

## 10. Editing the words

Every string on the page — captions, pin labels, the text before and after the
animation, the image descriptions — comes out as a plain text file and goes back
in the same way:

```bash
node scripts/assembly-copy.mjs                      # write data/assembly/copy.txt
node scripts/assembly-copy.mjs --apply <file>       # read an edited one back in
```

The point is that the copy can be edited by somebody who is not editing an
animation, and edited *in place*: no retyping into a JavaScript file, no chance
of a stray quote taking the page down, and no chance of an edit landing on the
wrong caption. Each block is addressed by id, so the round trip does not depend
on order or position, and the file carries the scroll percentage each piece of
text appears at so it can be edited in context.

The strings live in two places and the script knows both: the `COPY` block at
the top of `js/assembly/story.js`, and elements carrying a `data-copy` attribute
in `assembly-lab.html`. Timing stays in the story file, where it belongs.

Two things stop this failing quietly, which for a tool like this is the whole
risk — an edit reported as applied that simply is not:

- `--apply` **exits non-zero** when nothing at all could be applied, rather than
  reporting "0 of 33 blocks changed", which reads like "your edits were already
  in".
- `npm test` exports a copy file and re-applies it, and fails unless both files
  come back byte-identical **and nothing was skipped**. A restructure of either
  file that breaks the addressing is caught there rather than by somebody
  wondering why their new headline never appeared.

---

## 11. Slow devices

Four tiers, chosen at load and overridable with `?tier=`:

| | when | what |
|---|---|---|
| `full` | default | live 3D, pixel ratio up to 2, antialiased |
| `lite` | ≤4 cores or ≤4 GB, or 3G | live 3D at 1×, no antialiasing, capped at 30fps |
| `calm` | `prefers-reduced-motion` | the whole story, with the camera **cutting** between shots instead of travelling between them |
| `still` | `?tier=still` only | the same story as a stack of stills, drawn once by the same renderer at load — so it cannot drift from the animation the way a folder of exported PNGs would |
| `photo` | Save-Data, 2G, or no WebGL | the story as words and this shelf's own product photographs |

**`prefers-reduced-motion` asks for less movement, not for no page.** The first
version sent it to the stills, and that was too blunt — it is a common setting
on iPhones, turned on for battery or for the OS's own parallax and then
forgotten, so a large share of exactly the visitors this page is for were being
handed a stack of pictures. (Caught the only way it could be: the site's owner
has it on, opened the page on his own phone, and saw the static version.)

What actually causes trouble is whole-field movement — the camera dollying and
panning under someone who did not ask it to. A cut does not; film cuts
constantly and nobody is made ill by it. And a piece sliding into place inside a
still frame is small-area motion the viewer is driving themselves, at their own
speed, which is what scrolling any page already does.

So `calm` keeps every one of the eight shots the moving camera would travel
through and simply cuts to each. It is a stricter reading of the preference than
it looks: the thing the setting is actually about is gone, and what remains is
the content. `?tier=still` is still there for anyone who wants the older, more
conservative behaviour.

The order of the remaining checks is deliberate and is not the order of severity:
connection is asked **before** capability, because the still tier renders its
pictures locally and therefore still pulls 96 KB of geometry. That is a fine
trade for someone who dislikes motion and a bad one for someone on metered 2G,
who is better served by five 5 KB thumbnails of the real shelf — which they may
already have cached from `/shelving`.

This is built and working but was scoped down mid-session; it has not been
tuned and the tier thresholds are guesses.

---

## 12. The add-ons on /customize, and the angled camera

The same engine draws a third story: **The Lantern Shelf (3WU3UN2) taking a
bookend at the right-hand end of each shelf, books on all three, a fourth
bookend capping the top row, and its lamp**, in the add-ons section of
`/customize` (and at `/addons`). The two product captions link to their products
(`caption.href`; the overlay gives the pointer back to the link only).

```
data/assembly/lantern.design.json    3WU3UN2, with "bookends": 4
        │  scripts/bake-assembly-story.mjs data/assembly/lantern.design.json
        ▼
js/assembly/lantern-shelf.js         GENERATED, with a `bookends` list
scripts/build-shelf-props.mjs ──▶    assets/assembly/props.json (one pack) + js/assembly/props.js, GENERATED
        │  js/assembly/story-colors.js   AUTHORED: camera, the row, timing, copy
        ▼
js/assembly/scroll-story.js
```

- **Bookends are baked.** A design carries a count, and the engine's
  `bookendPlacements` decides the ends /builder would draw; the bake writes
  those as `bookends`, and every end `legalBookendAnchors` allows as `ends`,
  named by unit and side (`end_item_003_right`). The story chooses from `ends`,
  because /builder fills bottom up and the story wants the right-hand end of
  every shelf. Neither list is written when the design has no bookends, so
  `curator-shelf.js` is unchanged.
- **The close-up, and the bar that looked bent.** The square rails under a
  shelf read as bent and wedge-shaped, most of all from below. Two wrong
  diagnoses came first, and both are worth knowing so nobody repeats them: it
  is not the lens, and it is not the Poggendorff illusion of a bar crossing a
  band. The positions were exact, which is what made the illusion plausible,
  but the normals were not: the rails were lit as if their corners were
  round, so every flat face was a gradient. The fix is in the geometry build
  ("Shading normals that point where the faces point" in
  `scripts/build-builder-assets.mjs`), so /builder and /how get it too. Dark
  corner lines drawn over the faces were tried before the cause was found and
  were rejected as a look. The close-up is on the bottom shelf, which has one
  rail under its board rather than three, from the side and five degrees below
  the board, and it lights harder (`view.light`, the renderer's term weights):
  under the soft builder light a lifted coral tube's bottom and sides were one
  flat orange.
- **The angled camera.** A camera key may state
  `view: { azimuthDeg, elevationDeg, fovDeg }`; if the first camera key does,
  the story is drawn with the renderer's orbit camera and the engine turns each
  focus box into a distance for whatever aspect it has (`orbitDistance`).
  Stories without `view` are drawn exactly as before. The lens is 16 degrees,
  24 for the close-up: the console's 38 converged like a wide-angle photograph,
  and near-flat read as a diagram with the far side too large.
  `renderer.setOrbit` takes the lens (`fovDeg`); `/builder` never passes one.
- **The colour is the builder's.** Two things made the first version drab. The
  bake carries the catalogue's finish pair, and `/builder` lifts both before
  painting (steel by 1.26, boards by 1.07, `shaderPalette` in `app.js`), so the
  story lifts them too. And the renderer's lights are placed for the builder's
  one view, so from under a shelf nothing in the picture was lit. The engine
  now turns the rig with the camera (`turnedLights`, through
  `renderer.setLighting`), and below the horizon mirrors it, so an underside
  seen from below is lit as a top is from above. Again `/builder` never calls
  it, and the fixed rig is `renderer.LIGHTS`.
- **Tracks.** Keys ease each segment between consecutive instants of the whole
  story, so every key stops every piece; a row of books arriving a beat apart
  would stutter. A story may give a piece its own `tracks[id]`: waypoints with
  an offset, a `turn` about its pivot (the lamp's swing), `hidden`, and a
  per-segment `ease`. The camera and untracked pieces go on as before.
- **Bookends come in sideways.** There is 123 mm under a bookend's foot, so
  none can come up from outside the frame: each slides in along the shelf's
  length below its bar, stops, and rises 80 mm. The close-up's bookend comes
  along the end from the front instead, because that camera looks along the
  shelf and a bookend waiting outside the end would already be in its picture.
  The capping one is shot from front-left, because a bookend is a plate across
  the shelf and square on it is a sliver.
- **The books.** Generated shapes in the builder's own geometry format, meant
  to read as contemporary African paperbacks: flat spines with one graphic idea
  each (a colour block, a band, triangles, dots, a chevron, a kente strip) or
  none at all, cream title bars and marks, a cream page block, two hardbacks,
  two leaning books and a stack of five lying flat. Colour is per instance
  (`piece.palette`); a book is two to four draw calls.
- **The objects and the light.** Once the last bookend is on and the camera is
  back on the whole shelf, nine simple solids (a vase, bottles, a ball on a
  plinth, stacked cubes, a pyramid, a bowl of fruit, a plant) slide into the
  lower rows' open ends or drop onto the open tops with a bounce, in the books'
  own inks, all clear of the lamp's swing. After the lamp swings back, it comes
  on, blinks off once and stays on, as a light rather than a colour: a track
  point sets `lit`, and while it is lit the shade's inside glows flat yellow,
  its outside brightens (`piece.glow`), and `story.light` switches on
  `renderer.setLamp`. That is a bulb at the centre of the shade whose light
  reaches a point only if the line to it leaves through one of the shade's open
  ends, so it falls as a soft pool on the board and on the objects inside the
  cone below, and on the arm above; nothing under the board it stands over is
  lit, and there are no shadows. `scroll-story.js` carries the bulb to wherever
  the lamp is (`lampFor`). The boards are pale, so the light is at a little over
  half strength or they turn white. Rays and a sparkle were tried first and
  were too much; so was simply painting the shade yellow.
- **Load.** All the props are one pack, `assets/assembly/props.json` (about
  25 KB gzipped), loaded through `piece.pack` in one request. The page loads the
  story's six scripts only when the track is within two screens, so a reader
  who never reaches the add-ons downloads and parses none of it. The top row is capped at both ends
  and fills its shelf; the lower two stop about halfway so the boards show.
  Books were tried once on `/assembly` and taken out (section 8); these earn
  their place because the shelf's subject here is what goes on it. The
  palette and density were tuned against a vision model's critique of renders
  (a scratch loop through `/api/ai`, not in the repo).
- **The lamp's pin.** The geometry's pin is 33 mm; the real one is 10 cm. The
  camera never goes near the lamp joint, and the lamp pauses 150 mm over its
  post before the last drop. Scroll on and it swings on its post, 28 degrees
  one way and 22 the other, and the caption says it pivots.
- **Reveals are measured.** In a perspective a part sliding along x also
  slides in depth and leaves the frame slowly, so parts are hidden until the
  instant they move, from a place `scripts/test-assembly-story-colors.mjs`
  proves is outside the frame on every aspect from a phone to 21:9. The same
  test checks nothing passes through anything, part by part.
- **It starts late.** `/customize` is a short reply page, so nothing is preloaded
  and the story is started when the track is within a screen and a half.

Re-run both bakes after `make site` in the pipeline.

## 13. Not done

- **A real device pass**, especially inside Instagram's browser (§5, §9). The
  one thing that cannot be checked from here.
- **Where this lives on the site.** `how.html` is currently a redirect to an
  Instagram reel, which is the obvious slot.
- **The caption card overlaps the shelf on wide screens.** The fix is to bias
  the focus box sideways while a card is showing, which the focus-box camera
  makes easy — it is a per-key offset, not a new mechanism.
- **Instagram video from the same story.** `renderer.snapshot()` already
  renders an arbitrary frame at an arbitrary size; a script that walks the
  timeline at 1080×1920 and pipes to ffmpeg would produce a vertical reel from
  this same file, so the page and the post cannot disagree about how the
  product works. Probably the highest-value follow-on.
- **Finish.** The shelf animates in Coral because that is the finish the
  Curator's Shelf is sold in. It is one line in `data/assembly/*.design.json`.
- **The bench frame capture** (`POST /api/assembly-frame` in
  `scripts/dev-builder.mjs`, dev only) writes PNGs of any frame to
  `data/assembly-frames/`. It exists because a WebGL canvas cannot be
  screenshotted from outside the page — the context has no `preserveDrawingBuffer`,
  so its pixels are gone by the time anything else looks.

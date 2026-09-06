# The assembly animation — feasibility, and how one is built

A scroll-driven animation of a Framework shelf assembling itself: the Apple
product-page idea, where the scrollbar is the transport control and the product
takes itself apart as you go.

**Verdict: feasible, cheaper than the alternatives, and already prototyped.**
`/assembly-lab.html` is a working end-to-end mockup of The Curator's Shelf,
running on the builder's own renderer and the builder's own geometry. It is
404'd on the public site (`netlify.toml`) until there is a decision about where
it belongs.

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
| 20–35% | the adapter drops on. *The base offers two places to stand; the adapter offers three* — this is the piece that makes the asymmetry possible, and it is verifiable in the sockets |
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
arrives as the odd one out into a gap the eye has already noticed, which is the
moment the caption is talking about.

The joint chapter is the one that needed the most work, and the reason is worth
recording: **this joint is concealed once it is closed.** A close-up of the
finished shelf shows a post with a seam in it and explains nothing. Held 90 mm
open it explains itself — a collar on the base, a narrower pin beneath the
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
honest either way. The progress rail moved off the model's right edge for the
same reason.

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
| `still` | `prefers-reduced-motion` | the same story as a stack of stills, drawn once by the same renderer at load — so it cannot drift from the animation the way a folder of exported PNGs would |
| `photo` | Save-Data, 2G, or no WebGL | the story as words and this shelf's own product photographs |

The order of those checks is deliberate and is not the order of severity:
connection is asked **before** capability, because the still tier renders its
pictures locally and therefore still pulls 96 KB of geometry. That is a fine
trade for someone who dislikes motion and a bad one for someone on metered 2G,
who is better served by five 5 KB thumbnails of the real shelf — which they may
already have cached from `/shelving`.

This is built and working but was scoped down mid-session; it has not been
tuned and the tier thresholds are guesses.

---

## 12. Not done

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

# /builder

A 3D shelf designer at `/builder`, running in parallel with the existing
`/designer` and `/simplified-designer` pages. Neither of those is touched by it.

It is the desktop 3D builder from `framework-renderer` rebuilt for the public
site: same placement engine and same Rhino-derived module geometry, but sized and
paced for a mid-range Android phone on a slow connection.

## What another page can ask of it

`window.FrameworkBuilder`, for a bar or a page around the builder. It draws
nothing, fetches nothing until called, and knows nothing about staff. The address
picks the interface: `?mode=advanced` opens Advanced on a new shelf, a link and a
saved code alike, and a saved design keeps its code, because the mode is not part
of the shelf.

```js
window.FrameworkBuilder = {
  ready,            // Promise: a design is on the page and every piece of it has landed.
                    // Rejects if the page cannot start at all. A dead code does not
                    // reject: the page starts a new shelf, as it does for anyone.
  snapshot(),       // { code|null, hash, finish, totalKsh, sizeCm: {w, d, h},
                    //   pieceCount, pieces: [{qty, name}], empty }
  save(),           // Promise<code>, through /api/design as the share button does.
                    // Rejects on an empty shelf.
  presentBlob(),    // Promise<Blob>, the PNG the Present button makes, pixel for pixel.
                    // Saves the design behind it, as the button does, because the
                    // image prints its address. Rejects on an empty shelf, or if a
                    // piece's geometry cannot load.
  on(event, fn),    // 'change', after every edit that moves the design or the mode.
                    // Returns the function that unsubscribes. Selecting a piece and
                    // opening a sheet are not changes. A listener that throws is
                    // logged and does not stop the tool.
  setBottomInset(px) // Keeps px free under the page's own bottom bar, on the model,
                    // the sheets and the modals, and re-fits the view. 0 gives it back.
};
```

- `snapshot().code` is what the design would be saved under, or the code it was
  opened from if it is unchanged; it is not a promise that it has been saved.
  `pieces` are the invoice's lines, so omitted pieces are not in them and bookends
  are. `pieceCount` is the pieces on the shelf, omitted included and bookends not,
  as `/api/design` records it. `finish` is the design's own id: per-piece colours
  stay in the hash.
- **The bar is the caller's to draw**: fixed to the foot of the window, `px` tall.
  It stands over the phone's safe area, so the page stops leaving room for that.
  With the keyboard up the sheets stand on the keyboard, which covers the bar.

### Rendering a saved design for another page

`/builder/<CODE>?render=present` in a same-origin iframe, hidden any way you like
(`display: none` works: nothing in it waits for an animation frame). It draws the
design through the ordinary pipeline and posts one message to its parent:

```js
{ type: 'fw-present', code, blob, totalKsh, quotedTotalKsh }  // blob is the PNG
{ type: 'fw-present', code, error }                           // and when it could not
```

It builds none of the interface, works out no placements, and loads no analytics:
a picture a page asked for is nobody's visit. Opened on its own, with no parent to
answer, the same address is just the builder. A cross-origin parent is told nothing.
Changing a colour is not its job; that is done on the server.

`totalKsh` is today's price. `quotedTotalKsh` is what the record was first saved
at, which never changes, so where they differ the prices have moved since (see
"Saved designs").

Measured on 6 Nov 2026, Edge with a phone profile and a 4x CPU throttle against a
local server sending Netlify's cache headers and brotli, on designs of 6 and 12
pieces. No phone has run this yet: the GPU here was a software rasteriser and,
separately, a laptop's, and they came out about the same.

| | no network throttle | Slow 4G (1.6Mbps, 150ms) |
|---|---|---|
| empty cache, to the blob | 2.1 to 2.6s | 3.2 to 3.3s |
| warm cache | 0.7 to 1.2s | 1.5 to 2.0s |

An empty cache downloads about 260KB: scripts 106KB, geometry 88KB, fonts 31KB,
stylesheet 13KB, catalogue 7KB, page 7KB, the rest 8KB. A warm load is about 3KB,
but seven round trips, because the page, the stylesheet and the five scripts are on
Netlify's default `max-age=0, must-revalidate`, which is what the difference
between the two warm figures is.

## Three interfaces, one tool

The viewport, the bottom bar, the pricing and the placement engine are identical
in all three, so moving up a level never means relearning the page. A design
carries across switches (see "Switching down to Simple" below).

| | Controls | Placement rules |
|---|---|---|
| **Simple** | a control column: unit type, width, height, colour, lamp, bookends | Design is generated from the spec — a plain run. Mirrors `/simplified-designer`. |
| **Flexible** | one in-viewport `+` per free run end and per stack. A stack's puts the likely piece down, and a bar steps through what else fits there; an end's opens a list. Tap a piece to swap/remove | Units may only butt directly against each other. Mirrors `/designer`. |
| **Advanced** | every piece, from a sheet in the order they are reached for; rotate | Also offers the gapped unit spacing that bridging spans need. |

**The difference in one sentence: Flexible starts from a place on the shelf and
asks what can go there; Advanced starts from a piece in the catalogue and asks
where it can go.** Everything below follows from which half of that question the
person already has the answer to. A capability belongs in Flexible if it can be
decided by looking at one spot on the model and is finished when the piece
lands; it belongs in Advanced if it needs the catalogue, the invoice, or a plan
that spans more than one placement.

### Where the controls live

**One screen, one job.** That is the rule the layout follows, and it is a
response to what Advanced looked like before: a control column holding a
47-row piece list, a colour picker, a bookend stepper and a price breakdown,
beside a model covered in `+` markers, on a phone where all of it fit in about
a third of the screen each.

Every interface therefore has exactly **one** place for the options that finish
a design — colour, bookends, starting again — and the same functions render it
in both places:

| | Building | Finishing |
|---|---|---|
| **Simple** | the control column (the spec generates the design) | the same control column |
| **Standard** | `+` markers on the model | the sheet behind the button at the model's bottom right |
| **Advanced** | the `+` at the model's bottom left, then a marker | the same sheet |

Consequences worth knowing:

- **Simple is the only interface with a control column**, because Simple's
  interface *is* a form. Flexible and Advanced build on the model, so the model
  gets the whole screen and the column's contents move into a sheet.
- **Advanced puts no `+` markers on the model until a piece is chosen.** Showing
  every legal spot for every piece at once is unreadable at 52 pieces, several
  of which fit in a dozen places. Choosing the piece first cuts it to the spots
  that matter. Flexible keeps its standing `+` anchors, because offering the few
  places a unit can go *is* Flexible's guidance. The deeper reason is the
  sentence above: Advanced's user has already answered the question Flexible's
  `+` asks, so a standing marker would be asking them something they know.
- **The markers are bare discs and carry no drawn label.** They were tried as
  labelled pills, and on an L-shaped design at 375px the six of them covered the
  shelf. The model is the product; anything drawn over it has to earn the pixels
  against what it hides, measured on the busiest design somebody would really
  build rather than on the two-piece default. What a marker means comes from
  where it stands — beside a run end, or over a stack — and from the title of
  the sheet it opens.
- **The `+` becomes the cancel for the decision it opened.** One control, one
  place, for "I am adding something" and "no I am not"; a separate cancel
  somewhere else is a second thing to find while the first is still lit up.
- **The bottom bar is the page's, not the panel's**: the caret that opens "what
  is in it", the total, the size, and Present and Order — deliberately small,
  because the figures are what is being read and the buttons are what is reached
  for afterwards. It stays one row down to 320px, dropping the button labels
  rather than wrapping, because a bar that changes height makes the model jump.

The view is a locked isometric with pan, pinch/wheel zoom and auto-fit. There is
no orbit, by design — nobody can lose the shelf off-screen or end up under it.

### Which variant of a unit each interface offers

Some units exist as both a full and a "trimmed" (shortened) cut, and the shop
does not always list the full one — a compact unit is only sold as
`compact_base_trimmed`. Simple and Standard therefore offer, per family and role,
whichever variant has a price, preferring the untrimmed one. Advanced offers
everything and keeps the "(Trimmed)" suffix so the two can be told apart.

### Corners

A run can turn. In Flexible the end marker's sheet has a second section,
**Turn the corner here**, holding the placements that actually rotate something;
taking one starts a second run at right angles to the first, and everything
stacked on it is turned to match, because a turned base presents a turned socket
rectangle and only a turned extension meets it. That is `/designer`'s rule — a
corner extension belongs on a corner base of the same orientation — arrived at
through the sockets rather than by matching a suffix.

The section exists because the corner used to have a `+` of its own, and that
was wrong twice over. It sat 145mm from the run-end `+` in world space, which
under the locked isometric is a few pixels: the two discs were the only pair in
the tool that ever collided, at both ends of every design, closing from 29px to
18px as a run grew from three bases to six and the camera pulled back to fit it.
And its label lied. `buildAddButtons` preferred the candidate whose
`cornerFace` is `normal`, which runs *along* the existing run — so pressing
"Turn a corner here" placed a corner unit in line and nothing turned. Both faces
are now offered and named for what they do: the in-line one is a row in
**Carry on along this run**, noted as a longer shelf a run can turn off, and the
turned one is the row in **Turn the corner here**. A corner can be turned in one
tap from a single base, which the engine always supported.

The **corner unit** is the piece meant to sit at the join. It is an ordinary
straight unit whose shelf is about a shelf board longer than a standard one, and
that extra length is exactly what covers the square where the two runs meet. So
the turn is placed against the first run's *shelf*: its back flush with that
shelf's far edge, its near end meeting that shelf's front edge. Measured on the
boards, not the bounding boxes — the boxes carry foot pads that hang 10mm past
the frame, and placing against those leaves a visible notch in the corner.

Simple has no corners: it builds one plain run, and a run of corner units is not
a thing anyone wants.

### Where a run end's marker stands, and why it is not on the new unit

Flexible's end markers are anchored on **the outward board face of the last real
unit**, level with that stack's own mid-height, and pushed 26 screen pixels
further out along the run. Pixels rather than millimetres, so the gap between
the shelf and its marker is the same at every zoom.

They used to be anchored on the centre of the unit that does not exist yet, at
the design's mid-height, and both halves of that were wrong:

- The phantom unit is outside `designBounds`, which is what `renderer.fit`
  frames. `positionOverlays` hides rather than clamps anything projecting past
  the stage, so on a 375px phone **all four side markers were
  `visibility: hidden`** and "Add on top" was the only affordance in the whole
  mode — and `refresh({ fit: true })` re-framed after every edit, so they went
  away again after every placement. Anchoring on the shelf puts them inside the
  fit by construction. Framing the union of the design and every pending marker
  was the other option and was rejected: it needs about twice the padding and
  draws the shelf at little over half its size on a phone.
- The design's mid-height is not the marker's height. On a run whose stacks are
  different heights it put the marker for a one-level unit up beside a
  three-level one.

`stackBounds` is asked to exclude lamps for the same reason: a lamp stands 76cm
over the shelf it lights and was dragging "Add on top" up into the air with it.

### Which end is which, and the bug that hid for a while

A base candidate's end is keyed by **the unit it was placed against, plus the
world axis and sign it leaves that unit on** (`outwardFrom`). It used to be
decided by comparing the candidate's X against the min and max X of the design's
bases — which works only while every run lies along X.

A second run created by a corner runs along **Y**. Every legal continuation of
it therefore had an X between the design's min and max, was classified as
neither side, and was dropped. The effect in the page: on a Standard L, the end
of the second run offered **Wide Base and Deep Base and not Standard** — the two
that survived did so by accident, because their greater depth pushed their
origin a few millimetres past the envelope. A buyer who had built an L out of
Standard units could not add another Standard unit to it, with no error and no
row to say so.

### One end can belong to two units

An end is keyed by the unit it is built on, and that is not quite the identity
of an end: the unit at the end of a run and the one beside it both offer the
same gap in the same direction. Left unmerged that drew two markers 2px apart
on an L in Flexible, and 7px apart in Advanced -- the fault this whole pass
exists to remove, rebuilt one level down. Ends that face the same way and whose
anchors are within a unit's width (`SAME_END_MM`) are folded into one, keeping
the nearest offer of each piece.

The outward push is clamped, too. The anchor is on the shelf and inside the
frame by construction, but 26 screen pixels of push can still carry the disc
past the edge: on an L at 320px it took two of three markers 5px over and most
of their touch slop with them. A pushed marker is pulled back to keep its whole
target on screen, which is not the case the "hide rather than clamp" rule was
written for -- it still points at its own end, from 11px nearer to it.

### What the camera frames while a piece is in hand

`candidateFrame` frames **the boxes of the markers that ghost, and the points of
the markers that open a list.** Both halves are load-bearing:

- Framing every candidate's whole box drew the shelf at a third of a portrait
  stage, because a gapped placement reaches most of a unit's width past the run
  and its marker is one disc.
- Framing only the points was worse in a way that does not show in a
  screenshot: `showGhost` re-fits when a preview lands outside the view, so the
  first tap of a two-tap gesture moved every marker out from under the thumb.
  A marker that ghosts needs its piece framed; a marker that opens a list needs
  only itself.

### Finding a piece in Advanced

The add sheet is opened many times a day, mostly by somebody on a phone in a chat
with a client, and typing is the slow part. So the list has to be useful before
anything is typed.

- **Every piece is on the list, always.** 57 modules and the bookend. Two rules
  used to take rows away, and the search box could not see past either of them: a
  piece with no place on the shelf right now was not offered at all, so "extension"
  on an empty shelf or "deep" on a Standard one came back empty or short, as if the
  piece did not exist; and the shortened cuts sat behind a "Show N" row, which also
  threw away what had been typed. The reason for the second was real (listed flat
  they doubled half the families), and ranking answers it without hiding anything.
  A piece that does not fit is dimmed, says "no place yet", and cannot be pressed.
- **One order**: what fits, then what this person has just reached for, then how
  often a piece appears in the designs the business has sent (`PIECE_RANK` in
  `engine.js`, from 264 designs in WhatsApp chats, August to November 2026). On a
  phone the first screen is ten rows.
- **The strip of chips is gone**, because the recent pieces now lead the list.
- **The words under the box save typing it.** Base, Extension, Spacer, Hanger, Top
  bar, Adapter, Booster: pressing one puts it in the box. That is the whole of what
  they do, so there is one thing deciding what is listed, it is on screen, and it
  can be typed onto ("base", then "d"). Typing can never be searching inside
  something left selected. A line of plain words and not chips, scrolling sideways
  rather than wrapping.
- **The search takes the words people use** (`pieceTerms` in `engine.js`), in any
  order and from the start of each word: "deep b", "base deep", "142", "142 cm",
  "trimmed", and the shop's other names, "display bar", "hanging rail", "tier",
  "desk". The piece's own name ranks above those. `scripts/test-builder.mjs` holds
  every module in the catalogue to being found by its own name. The keyboard's Go
  takes the first row.
- **The row says width and price**, and no longer how many spots a piece has. It
  was a number nobody chose by, and "no place yet" is the only thing about it that
  changes what you do.
- **A sheet with a search box keeps its height.** It used to shrink with the
  results, standing on the floor of the page, so each letter moved the box down:
  514px on a 390 x 844 phone, and past two letters neither the box nor anything
  found was above a 300px keyboard. Now it is as tall as it will ever be from the
  start.
- **Sheets stand on the keyboard.** A phone's keyboard shrinks the visual viewport
  and leaves the layout alone, so something fixed to the foot of the page is behind
  it. `followKeyboard` puts the sheets in the part of the page that can be seen
  while it is up, and the row of words gives its line back to the results.

### What a tap on a marker does

A placing marker previews the piece, then places it on the next tap; a mouse previews
on hover, a keyboard on focus. All three go through one rule in the marker's click: if
this marker's preview is not up yet, put it up and stop; if it is, place.

**That comes out as two different gestures on two kinds of phone, and it is meant to
stay that way.** iOS Safari does not focus a button when it is tapped, so the first
tap's click finds no preview, shows the ghost and turns the disc into a tick, and the
second places. Chrome on Android focuses the button on the way to its click, so the
focus previews, the click finds a preview up, and one tap places. Elvis, who does most
of the designing, is on an iPhone, where the ghost is a real check on a crowded shelf.
The one sentence that explains this ("Tap again to place it") is shown once a visit whichever the phone, so
on Android it describes a gesture that phone does not have.

In November 2026 this was changed to one tap everywhere and, at Ben's request, put
back the same week. Choosing a piece also briefly placed it outright where it had
only one spot; that went too. Choosing always shows the markers.

**A tap on the model is acted on at its click, not at pointerup.** On a touch screen
the browser sends mousedown, mouseup and click after pointerup, hit-tested against
the page as it then stands. Selecting a piece opens its menu centred on that piece,
so a tap acted on at pointerup opened the menu under the finger and the click pressed
whatever had just arrived there: 15% of taps on a piece at 390px and 21% at 360px,
over a grid on the default design, and that included Remove and Omit, with nothing to
say so.

### Flexible: put it down, then change it where it stands

`PLACE_AND_CYCLE` in `app.js`. Set it to false and the markers go back to opening
their lists; nothing else needs touching.

Flexible's person starts from a place and does not know the parts by name. A sheet of
names asks them the one thing they cannot answer, and covers the shelf while it does.
So the shelf answers instead:

- **The `+` over a stack, or on an empty shelf, places at once.** The likely piece, from
  `engine.likelyFirst`: an extension of the family already there, then what the shop
  uses most. That first guess was right 70% of the time on a stack in the 264 designs
  the business sent, which are sales designs and so only a stand-in for a customer's.
- **A bar in the bottom row steps through what else fits there**, 3 to 8 things, wrapping
  round, with the model, the total and the size changing at each step. It is at the
  thumb and has a step at each edge, so the hand does not move and is never over the
  piece being looked at. A control floating by the piece was the first idea, and it
  would have stood on what it was showing and moved at each step as heights changed.
- **Nothing asks to be confirmed.** The piece is already down, and whatever is done next
  leaves it there: a tap anywhere, a tap on a piece for its menu, another `+`. Pressing
  the `+` now above it for another level is one tap a level, where it was two.
- **The `+` at the end of a run still opens its list.** The first guess there is right
  only 59% of the time across about 8 options, and a wrong unit changes the shelf's whole
  width, so it would cost more taps than it saves. What is picked from that list gets
  the same bar, though, so trying the next width over no longer means Swap and a sheet.

The markers look alike, ring or no ring, although one places and one opens a list.
That is deliberate: both add something at that spot, there is nothing to get wrong by
pressing either, and in Flexible the ring would only add weight over the shelf.

Four things it rests on:

- **Every stop is a whole design, worked out up front** from the shelf as it stood, so a
  step only points `ui.design` at another one and cannot accumulate anything.
- **Only the first placing is in the history.** Undo takes back the whole affair in one,
  however many steps it took, and Redo restores the stop it was left on.
- **A cycle is alive only while `ui.design` is its current stop** (`liveCycle`). A colour
  change, an undo, a mode switch, anything: they make a new design, and that ends it
  without them knowing it exists. Applied blindly, a step after a colour change would
  have put the old colour back.
- **A step never waits on the network.** The design, the name and the total change at
  once; the piece appears when its geometry lands, and that redraw reads whatever
  `ui.design` is by then, so a late arrival cannot bring back a stop that has been left.
  The stops either side are fetched ahead (`ensureGeometry(ids, true)`), quietly: no
  Loading pill and no error for something nobody has asked to see. If the stop on screen
  cannot be fetched at all, it goes back to the last stop that was seen and can be drawn,
  or to the shelf as it was, because a piece that is priced and invisible is the one
  wrong state this could leave.

The camera holds still between steps, because a shelf that rescales cannot be compared
with itself a step ago. A stop that outgrows the view, as a lamp does, widens it, and the
next step brings it back. On a phone the bar takes the floating buttons' row and they
wait until it goes. On a desktop the arrow keys step and Escape leaves the piece.

`designer_place` still fires for the first placing, and each step fires
`designer_cycle`. Those two in GA4 are how to tell whether this is any use.

### Advanced keeps the piece in hand

`commit` clears `ui.activeModuleId` for every edit except a placement in
Advanced, which passes `keepModule`. A part is a thing you have a quantity of,
and dropping it after every one cost a round trip through a two-dozen-row sheet
per booster.

Three things follow and all three are load-bearing:

- **The camera has to frame the candidates, not the design.** `refresh` takes
  `fit: "candidates"` for this. Framing the shelf alone pushes the surviving
  markers outside the stage, where `positionOverlays` hides them — the same
  fault as the side markers above, imported into the other mode.
- **The button needs a third state.** "Add a piece" → "Cancel" (nothing placed
  yet) → **"Done"**. After a placement, offering to cancel reads as offering to
  undo the part just put down.
- **A tap on a piece has to still mean that piece.** Tapping the model while
  holding a part used to cancel the placement silently; now it puts the part
  down *and* selects what was tapped, because the mode is otherwise in the
  holding state indefinitely and the tap-to-swap gesture would be behind a trip
  to the button.

The piece is dropped automatically when it runs out of places to go, with a line
saying which piece and why, rather than leaving somebody holding something with
no markers and a button offering to finish.

### Naming the spacings instead of drawing them four times

Advanced is the only interface that offers gapped placements at all
(`adjacentBasesOnly` is false only there). It used to draw each one as its own
disc: a Standard Base on the default design was **eight identical markers**,
four per side, every one titled "Put the Standard Base here". On a 375px phone
the four on one side sat inside 53 pixels with 10px between 38px discs — four
different answers no thumb could choose between.

They are one decision, so they get one marker per side, and the spacing is the
short named list `GAP_NAMES` was always written for: a size, not a measurement,
because "43 cm" against "70 cm" is not a choice anybody makes by reading. The
centimetres are on the row, where there is room. That picker existed and was
unreachable — it was only ever called from `buildAddButtons`, which
`buildOverlay` does not run in Advanced.

A side with one place keeps its ordinary marker and its ghost: there is nothing
to tell it apart from, and naming it would be labelling the only door in the room.

### Normalising the spacing

A unit standing in the gap under a bridging span lands wherever the socket grid
allowed, which is hard against one side of the gap. It reads as a mistake rather
than a decision, and it is the same mistake in every design that has one — so
the fix is one action in the options sheet, **Normalise spacing**, and not
something to be hunted for piece by piece. It appears only when there is
something to even out.

The rule is simply that the gaps between the base units of a run should all be
the same size. Each unit's stack moves with it.

**What that size is depends on what is already fixed.** A shelf resting on two
units holds them rigidly apart: there is no offset that moves one and keeps both
ends of the shelf where they are. So a gap inside such a set cannot change — and
where one exists it *is* the answer, because it is the spacing the design
already has and cannot give up. Only when nothing is held is the size free, and
then it is chosen to keep the run's overall width so the shelf does not change
size.

That distinction is the whole reason the ends are not simply pinned. Two
different designs, both wrong in the same way:

| | gaps before | after | what moved |
|---|---|---|---|
| unit free in a bridged gap | 30, 119 | 75, 75 | the middle unit, ends held by the span over them |
| unit held by a shelf, free one at the end | 85, 262 | 85, 85 | the far unit, pulled in to match the held gap |

An earlier version pinned the ends and only ever moved the middle. It handled
the first case and refused the second outright, because there the middle is the
one that cannot move.

Three more things it has to get right, each of which it got wrong first:

- **Runs, not the whole design.** A leg turning a corner is its own run: bases
  are grouped by orientation and by overlapping across the line they lie on.
- **Units, not stacks.** A stack includes whatever stands on it, and the span
  bridging two towers belongs to *both* of their stacks — so measured that way
  each tower reaches past the unit in the gap, neither counts as being to one
  side of it, and the very design this exists for reported no neighbours at all.
  What is in the air above a gap is the validator's business.
- **Rigid sets move whole or not at all.** Where the arithmetic would give two
  units in one set different offsets, there is no solution that keeps the shelf
  across them, and nothing is offered. This is also what protects a bank of
  units meant to be touching: a butted run almost always carries a shelf
  spanning it.

Evening the gaps deliberately takes units off the socket grid. The whole
assembly is revalidated afterwards like every other edit, and an illegal result
is refused rather than applied.

`scripts/normalise-maybes.mjs` runs the same engine call over the designs that
survived review in the design lab; see `docs/design-lab.md`.

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
assets/shelving/builder-contract.json  the pipeline's handoff, vendored (below)
assets/shelving/catalog.json   module metadata, sockets, prices, finishes
assets/shelving/modules/*.json geometry, one bundle per module
scripts/build-builder-assets.mjs
scripts/dev-builder.mjs        local server, with the rewrites and the function
scripts/test-builder.mjs
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

## Where the geometry comes from

Rhino, through the `framework-renderer` repo beside this one. Its
`docs/pipeline-spec.md` is the account of that chain; what matters here is the
seam.

`assets/shelving/builder-contract.json` is **generated there and checked in
here**. It carries the modules, sockets, prices, finishes, vocabulary and the
pipeline's own golden validation configs, plus the SHA of the Rhino export it
was built from and the fillet/chamfer parameters applied to the geometry. Every
consequence of that is deliberate:

- this repo builds and tests with no pipeline checkout present,
- `build-builder-assets.mjs` parses JSON instead of string-scraping a generated
  JS file, which is what it used to do,
- the test fixtures arrive with the contract, so they cannot fall behind the
  pipeline's copy the way a hand-copy did,
- `catalog.json` records which contract it was baked from, and
  `test-builder.mjs` fails if that is not the contract checked in — or, when a
  pipeline checkout *is* present, if ours is older than theirs.

**Do not edit the contract, the catalog or the geometry bundles by hand.** To
move a geometry change downstream, run `make site` in the pipeline: it copies
the contract across, rebuilds these assets, bumps the version and runs the tests
here.

## Rebuilding the assets

The geometry is baked from the pipeline's per-module GLBs, which are the same
assets its Blender renders are assembled from. Rebuild after vendoring a new
contract:

```bash
node scripts/build-builder-assets.mjs
```

It reads the vendored contract and `../framework-renderer`'s GLBs
(`--pipeline <path>` to override) and rewrites `assets/shelving/`. Then run the
tests:

```bash
node scripts/test-builder.mjs
```

The fixtures are the pipeline's own validation configs, carried inside the
vendored contract, so a placement rule that drifts from what the Rhino/Blender
pipeline considers buildable fails there rather than on a customer's phone. The suite also checks that the fast incremental
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
- **Depth is drawn twice, nested, and no word says which is which.** The legs
  stand just outside the board's front and back edges, so the overall depth
  (28cm on Standard) is a leg's width either side of the board (23cm).
  `depthDimensions()` puts both on the lowest board's surface, off its
  right-hand end: the board depth nearest, its witness lines carrying the
  board's edges out, and the overall depth one step further out, its witness
  lines starting at the last pair of posts. The numbers letter along their
  lines, as isometric drawings do; level type needs clearance for its width,
  turned type only for its height, and that is what leaves room to set the board
  depth between the two lines. Tried and dropped: a line under the feet (the back
  foot is behind the bottom board, and the line starts where the width line
  ends) and one over the post tops (it lies across the top board). A run that
  turns a corner has no single depth, so it keeps the one envelope dimension.
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
- **Present saves the design**, and so does Order — otherwise the address
  printed on the image, or sent in the message, would be one that 404s. There is
  no separate "create a link" button: nobody ever wanted a link for its own
  sake, they wanted to send a picture or an order.
- **A code says what the shelf is, not what it cost.** The hash covers
  `serializeState`: finish, bookends, and each piece's id, type, origin, rotation,
  placement, colour and omitted flag. No price is in it, so a price change moves
  no code. The record's `total_ksh` is what the design came to when it was first
  saved, and first write wins, so it stays that figure for good while the live page
  works its total out from today's catalogue. To tell whether a quote has gone
  stale, compare the two: `totalKsh` against `quotedTotalKsh` in the render's
  message, or re-add the design's pieces from `catalog.json` against `total_ksh`
  from `GET /api/design`.

## Bookends

A bookend is not a piece. The design carries a **count**, and
`bookendPlacements` fills the legal ends bottom up, as many as the count. That
is load-bearing rather than incidental: `serializeState` carries the count and
nothing else about them, which is what keeps every design code that was ever
shared resolving to the same shelf, and `scripts/test-bookend-placement.mjs`
asserts that key list exactly. So the ends cannot be picked individually without
moving every code in every WhatsApp thread — no anchor key survives both a
share-link round trip (which re-mints instance ids) and `normaliseSpacing`
(which moves units off the socket grid).

Asking for more bookends than the shelf has ends is allowed. Those are priced
and delivered like the rest, they are simply not in the picture, and
`bookendFitNote` says so under the stepper rather than the stepper refusing.

The control is the same stepper everywhere: Simple's column, and the options
sheet behind the gear in Flexible and Advanced. Flexible and Advanced also carry
a **"Bookends" pill beside the gear**, which opens a sheet holding just that
stepper, and Advanced lists **Bookend** as a row in its "Add a piece" sheet too.

The pill is the answer to "bookends are hard to find", and each of its details
is a choice that was argued, not a default:

- **A word, not a glyph.** There is no convention for "bookend", and at 20px any
  drawing of one reads as books — which on a shelf designer means what goes on
  the shelf, not something you buy. On a phone there is no tooltip to rescue it.
- **The gear's treatment, not the Add button's.** White, muted, a hairline
  border. Bookends finish a design; the accent fill belongs to the one control
  that builds it.
- **No count on it.** A saturated numeral on a corner is how phones say
  "unread", and it would appear only after the buyer acts, announcing their own
  action back to them. The model draws the bookends, the sheet counts them, and
  "What is in it" prices them. A fixed label also never changes width.
- **Hidden where there is nothing to offer**: in Simple (the column has it), and
  on a shelf with no end that takes a bookend — empty, or all trimmed units —
  unless a count is already set, so what was ordered can always be taken off.
- **6px from the gear, not 8.** At 320px in Advanced the Add button ends at
  x=146; with a wide fallback face loaded before the webfont, "Add a piece"
  outgrows its 134px minimum and the gap between the two fell to 9px. At 6px,
  with 13px of side padding, it is 13px at worst and 19px once the font loads.

The corner it stands in was measured empty after a fit on a single unit, the
default, a 6-unit run and an L, at 320, 375, landscape and desktop: the model
reaches the button row only on the left, under Advanced's Add button.

**On a short stage the tool rail becomes two columns.** A landscape phone's
stage is about 250px tall, and the five 38px tools stacked from the top reached
8px into the gear at the foot of the same edge. Under 460px of viewport height
the rail is a two-column grid hugging the frame, which ends it at 136px and
puts zoom out and zoom in side by side. That collision predated the pill; it
was found measuring the corner the pill went into.

They do have a model: `assets/shelving/modules/bookend.json`, drawn by
`bookendSceneEntries` and fetched the moment the count goes above zero. The
scene entries deliberately carry `boundsMm: null`, so a bookend is neither what
the camera frames nor what a tap hit-tests.

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

## Pieces the client already has

Somebody who owns two units and wants a third is quoting for one unit, not
three — but the picture has to show all three or it is not their shelf. So a
piece can be **omitted from the invoice**, through Omit in the menu that appears
when you tap it, and everything follows from "in the design, out of the money":

- **Advanced only.** It answers a question asked at a trade counter, never by
  someone buying a whole shelf, and Advanced is where that person is. Simple
  rebuilds its design from a spec, so a piece marked there would not survive its
  next stepper press anyway.
- **Drawn as a hatched blank.** One pale neutral for every part of it, feet and
  lamp shade included; the lighting flattened to a fifth, which leaves enough
  face-to-face difference to keep the shape readable and takes away the
  material; and fine diagonal bands in screen space over the top. A pale unit
  on its own was not enough — the shop sells a dark neutral called **Charcoal**,
  and "the grey ones are not being charged for" is a sentence that can point at
  the wrong shelf. No finish is striped, so hatching cannot be misread as one,
  and it is the drawing convention for "shown for reference" besides. The bands
  are sized from the drawing buffer (about 130 across it), so they read the same
  in the viewport and in the 1080px share image. Opaque, not blended: a
  transparent piece shows its own back faces through its front ones, which reads
  as a fault rather than as a hint. Selecting one still highlights it, or there
  would be no way to see which piece a menu belongs to.
- **Whether a piece is a blank is decided in `drawBatches`**, not by its
  callers. `snapshot()` runs its own pass, deliberately without the selection
  highlight, and it composed the share image with every piece in full colour
  until this moved. A blank is a property of the design; the highlight is a
  property of the interface; only one of them belongs in a picture sent to a
  client.
- **Out of the total, and explained once.** The summary says "3 pieces not
  charged"; the breakdown and the share image carry one small line — *Faded
  modules are shown for reference only and are not included in the quote* — and
  the WhatsApp order a count in brackets. It names no modules, because the
  picture directly above it already says which ones and a client reading
  "2 x Compact Spacer" has to go and find them first; and no colour, for the
  Charcoal reason above. A shorter list beside a picture of a whole shelf, with
  nothing said about the difference, reads as an order that lost half of it.
- **Managed like per-piece colour**, because it is the same kind of exception:
  an optional field on the instance, carried through `serializeState` /
  `deserializeState`, through the rebuild every other edit goes through, and
  through the share link — where the omitted rows are a list of indices appended
  after the colour table, so a link written before this existed opens here, and
  one written with it opens in an older deployment, just charging for
  everything. The options sheet offers "Charge for N omitted pieces again"
  beside the colour reset, as one commit, so one undo puts them all back out.
- **The invoice honours it at the far end too.** `groupDesign()` in
  `netlify/functions/_push.mjs` skips them, so a draft raised from a code bills
  the figure the client was shown rather than the shelf they can see. The design
  code is a hash of the serialised design, so a shelf with a piece omitted and
  the same shelf without are two codes, never one record that means both.

## Why it is built this way

Every one of these is a response to a measurement, not a preference.

- **17MB of pipeline GLBs → 2.7MB of bundles.** The GLBs carry lathe-quality
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
- **Flat faces are lit flat.** A square rail lit with smoothed normals shades as
  if its corners were round, and where rails cross under a board the bar reads
  as bent and wedge-shaped; the close-up on /customize made it impossible to miss.
  Decimation welded each box's corners and averaged the normals across them, and
  some rails arrive from Rhino welded the same way (a Wide base's right-hand end
  rails: 85% of their surface lit by a normal more than 30 degrees off its face).
  The build now re-derives the normals of any part whose normals disagree with
  its faces over more than 5% of its area, split along edges sharper than 50
  degrees, so a rail's faces are flat and a leg is still round. The new normals
  are kept only if they then agree: some round tubes (a Broad, Compact or Corner
  base's legs) are meshed with faces that twist across the tube, and keep their
  own smoothed normals. Parts that were already right are untouched. Steel lit
  off its faces went from 8.8% of the catalogue's surface to 2.0%, for about 5%
  more geometry gzipped; `scripts/test-builder.mjs` asserts it stays under 3%.
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

- **Every piece is priced** since 2026-10-15. The eight that read "on request"
  were in Zoho and Airtable, active and registered with eTIMS, from the
  2026-08-15 catalogue pass (`../stock-analysis/CATALOGUE.md`). They were never
  added to the site because `data/module-prices.json` did not exist yet. They
  are priced there at the Zoho rate, except Broad Hanger: Zoho had it at 8,000,
  set as "its spacer plus 1,000" when Broad Spacer was 7,000. With Broad Spacer
  at 5,500 the same rule gives 6,500, which is also between Compact (6,000) and
  Deep (7,000). A module with no price still shows "on request" and is left out
  of the total, so a new module needs an entry in that file.
- **`noindex`.** Remove the meta tag in `builder.html` when this page replaces
  `/designer` or `/simplified-designer`, and add it to `sitemap.xml` then — not
  while both are live and competing for the same queries.
- **Simple's Height stepper reads the shelf only**, while the summary and the
  dimension arrows include the lamp. Deliberate — its `+`/`−` add 30cm shelf
  levels, and showing the lamp-inclusive figure next to them read as broken — but
  flagged in case you would rather all three agreed.
- **Saved designs are never cleaned up.** Every Present, every Order and every
  raised invoice writes a blob, keyed by a hash of the design, so repeats cost
  nothing but distinct designs accumulate. There is no expiry and nothing reads the store
  back yet — the arrival details are being collected for a report that does not
  exist.
- **The old `/new-designer` address is a 301** to `/builder`, because links with
  a design in the fragment are in WhatsApp threads. It can go once those have
  aged out; the fragment rides along until then.

## What the page says back

`setHint` is the one channel the tool talks on, and it carries three kinds of
message: a confirmation of something that was just done, a refusal, and a
system failure. It is a dark pill above the floating buttons, of the same family
as `.nd-busy` — opaque, because it used to be grey type on 92% white, which over
a Charcoal shelf composited to about `#eee` and put the text at 4.28:1, so the
same sentence passed or failed depending on where the shelf happened to be
framed. Its inset is derived from the buttons' own inset and height rather than
the 66px that used to encode them by hand.

**There is one onboarding sentence, shown once per person:** *"Tap any piece on
the shelf to change or remove it."* It is the one fact the interface cannot
show. There is no hover on touch, no outline and no cursor, so the shelf looks
like a picture of a shelf; every other affordance is a labelled control.

It used to be two sentences per interface, and the first of each described the
`+` markers. On a phone that sentence was not merely redundant, it was wrong —
it named four affordances that were hidden off-stage. The flag also lived in
page memory, so it fired on every load, and the commonest way into this page is
a share link or a `/builder/CODE` path in a fresh tab: somebody iterating on one
design was told the same thing every time they opened it. It is now
`fwk_builder_hinted` in `localStorage`, wrapped the way `js/gate.js` wraps its
own, where a throw on read means "not seen" and a throw on write means it shows
once more.

## History

Named `/new-designer` while it ran in parallel with `/designer` and
`/simplified-designer`; renamed to `/builder` in July 2026. Per-piece colour,
Download/Upload, "Create link to design", the resolvable share address, the
dimensioned share image and the round-part fix all landed at the same time.

Later in July 2026 the pipeline handoff became the vendored contract described
above, replacing a string-scrape of a generated JS file and a hand-copy of the
test fixtures; the desktop builder it was ported from was retired; and corner
units arrived.

Also in August 2026, a piece could be left out of the invoice — see "Pieces the
client already has" — for clients adding to a shelf they already own.

In August 2026 the control column was taken out of Flexible and Advanced and
its contents split between the bottom bar and the two floating buttons on the
model — see "Where the controls live". **Download**, **Upload** and **Create
link to design** were removed at the same time: the first two moved a design as
a JSON file between a phone and the workshop, which the resolvable share address
now does better, and the third was a link nobody made except on the way to
sending one. The order form behind Staff login was rebuilt in the same pass;
`docs/order-sync.md` covers it, including the three copies of a client's phone
number and which two of them have to agree.

In September 2026 both upper interfaces had a pass over how they are worked.
Flexible went from a `+` per placement family to **one per free run end**, which
removed the only pair of markers in the tool that ever collided, folded the
corner into that end's sheet as two named sections, and fixed a run created by a
corner not being extendable at all. The markers moved onto the shelf so they
stop being hidden on a phone. Advanced **keeps a piece in hand** across
placements, merged its four spacing discs per side into one marker over the
named picker that had been unreachable since it was written, hid the shortened
cuts behind one row, and gained a strip of the pieces most recently reached for.
The onboarding hint became one sentence shown once per person. Labelled pill
markers were tried in Flexible in the same pass and taken out again: they read
well and covered the shelf, which is the trade this page never makes.

In November 2026 Advanced had a pass on a phone, for the sales team, who use it to
design during a chat. The search stopped hiding anything, which undid the shortened
cuts' row and the strip of recent pieces from September; the sheet stopped sinking
behind the keyboard; and a tap on a piece stopped falling through to its menu. See
"Finding a piece in Advanced" and "What a tap on a marker does". Flexible's `+` over a
stack stopped opening a list in the same pass, as an experiment: see "Flexible: put it
down, then change it where it stands". `window.FrameworkBuilder` and the render arrived in the same pass, for
the staff app.

# The design lab

A machine that makes shelf designs, and a bench for judging them.

The problem it exists for: the catalogue shows the shelves we have built and
photographed, which is a small and self-selecting corner of what the system can
actually make. The lab generates hundreds of legal configurations, most of them
arrangements nobody here would have drawn, and puts them in front of a person a
few seconds at a time.

```bash
node scripts/generate-designs.mjs --count 300 --seed 11
npm run dev                        # then http://127.0.0.1:8770/design-lab.html
node scripts/normalise-maybes.mjs  # even out the spacing in what survived
node scripts/plan-shots.mjs        # four camera angles each, to choose among
node scripts/export-shots.mjs      # the approved shots, ready to render
```

## The stages

The brief this was built from has four stages, ending in a large pile of images
to be picky about. Two of them are here.

| Stage | Where it is |
|---|---|
| 1. Generate configurations | `scripts/generate-designs.mjs` — **built** |
| 2. Review them quickly | `design-lab.html` — **built** |
| 3. Render the keepers | `scripts/plan-shots.mjs` → `shot-lab.html` → `scripts/export-shots.mjs` — **built**, camera and figure chosen per shot |
| 4. Put them in scenes | `/scene-studio` — **not started** |

## What the generator will not make

Four rules, checked in the order they get cheaper to fail:

- **It has to fit.** 3m wide, 1.9m tall, 1m deep by default, in *either*
  orientation — a design too deep for one wall may be right against the next
  one along, and turning it is not a change to the design. Each design also
  rolls its own smaller target inside that, because a corpus where every shelf
  is 3m wide is a corpus of one idea.
- **Two base units at least.** A single unit, and a single unit with shelves
  stacked on it, are what the brief excludes by name.
- **Nothing the simplified designer could already have made.** Enforced by
  building every plain run with Simple's own algorithm — `buildPlainRun` is a
  port of `app.js`'s `buildSimpleDesign` — and rejecting anything whose identity
  matches one. A hand-written "looks like a plain run" predicate would drift the
  first time Simple changed; this cannot.
- **Nothing already in the corpus**, including the same shelf turned or
  mirrored. See below.

Two smaller floors sit under those: at least four pieces, and more than one kind
of piece. Two bases with a gap between them passes every rule above and is still
not worth anyone's time to look at.

## What makes a legal shelf a sensible one

The placement engine answers "will this stand up". `scripts/lib/design-rules.mjs`
answers the question after it, and it exists because the first corpus of 300
produced two designs worth a second look. All of these came from that review
except the last, which came from looking at what was still wrong afterwards.

| Rule | Why |
|---|---|
| A spacer, booster or booster-adapter must carry something | A riser with nothing on it is a raised nothing |
| An adapter's middle joint must carry something | Otherwise it is the plain extension of the same size, costing more and looking busier |
| A lamp may not sit on an adapter's middle joint | The joint is there for a shelf |
| A hanger needs a spacer below it | That is where its clearance comes from |
| A riser's load must include something that is not a lamp or a display bar | A spacer under a lamp is a lamp on a stick |
| A corner's long edge must be answered by a unit turned against it | The long edge is the piece of shelf that covers the square where two runs meet; with nothing turned into it, it is an overhang into the room |
| No corner base adjacent to another corner base | A corner is where a run *turns*; two against each other is not a turn |
| A corner extension needs a corner base under it, turned the same way | Its overhang has to land on the overhang below |
| No two opposed boosters in one stack | That is a spacer, made awkwardly out of two parts that then have to line up |
| One stack keeps to one cut, trimmed or full | Held open (`--mixed-trim`) because the exceptions are not known yet |
| Display bars, at most one | "Sparingly if at all" |
| The design has to be one connected thing | Not from the bench — see below |

### Two that could not be placement rules

"This spacer has nothing above it" is true of every spacer the moment it lands,
and "this corner's long edge is hanging" is true of every corner before the run
it turns into has been built. Checked at placement, the second would have made a
corner unplaceable and quietly deleted the whole family from the corpus. Both
are therefore completion rules, and both are **repaired rather than rejected**,
along the line the brief drew for adapters:

- a riser holding nothing — or holding only a lamp or a bar — is pruned, the
  fitting first so the riser under it goes on the next pass;
- a corner whose long edge hangs becomes the straight unit of the same role and
  cut, looped, because turning one corner straight can leave a corner extension
  above a base that is no longer a corner.

How a turn is actually shaped matters here and is easy to get wrong: the turned
unit does **not** butt end-to-end against the corner's long edge. It runs away at
right angles with its back flush with that edge and its near end meeting the
shelf's front edge — so the test is that the turned board *reaches* the long edge
and lies alongside the corner across its depth. The first version tested for a
butt join and rejected every real turn ever built.

**Connectedness is the one rule nobody asked for**, and it was worth more than
several of the others. Advanced offers base spacings Standard does not for one
reason: so a bridge or an adapter span has somewhere to land. A gap with nothing
over it is therefore not a design decision, it is two pieces of furniture
standing near each other — and it was 70 of the 300 designs in the corpus that
had every other rule applied. Bases count as joined when their boards touch or
when anything above rests on both. `engine.stacksOf` cannot answer this, because
it follows only a piece's first support and so files a shelf bridging two towers
under one of them.

### Stated once, used three ways

A rule written down three times is a rule that will disagree with itself, so
each is written once and read by:

- **`placementViolation`**, filtering candidates *while* a design is grown. A
  corner against a corner is wrong the moment it lands; finding out twenty
  pieces later throws away the twenty as well.
- **`repair`**, fixing what can only be judged at the end. A riser is not
  pointless until nothing has landed on it, so risers holding nothing are pruned
  and an adapter with an unused joint becomes the plain extension — which is
  what the brief says to do. Repairing beats rejecting: the arrangement that
  made the design worth looking at survives and only the mistake goes.
- **`violations`**, the check afterwards and the one the tests assert on. It
  re-runs the placement rules over every piece, so a design built without the
  filter is judged by the same standard as one built with it.

What `repair` will not touch is structural — a corner against a corner, a stack
of mixed cuts, two clumps with air between them. Correcting those would be a
different design rather than this one put right, so they are rejected.

`engine.removeInstance` and `replaceInstance` rebuild the whole assembly and
return **null** rather than throwing when the result would be illegal, so every
repair looks at what it got back.

## What makes two designs the same design

A run along X turned 90° is the same product pushed against a different wall.
Its mirror is the same product photographed from the other side. Generating both
and reviewing both is reviewing one design twice.

So a design's identity is the smallest of the eight keys you get by turning its
pieces through the four quarter turns, each with and without a mirror, and then
translating the result to a common origin. Each piece contributes its module id
and its world box.

**The box, not the origin socket.** A box transforms under a turn without any
reasoning about where inside a module its origin socket happens to sit, which is
the sort of reasoning that is right until it meets a corner unit. The module id
stays in the key so a trimmed cut never collapses onto a full one.

The consequence worth knowing: a design containing a chiral piece — a corner
unit — is treated as identical to its mirror image even though the mirror is a
different arrangement of parts. That is the rule the brief asked for, and the
mirror of a design is a near-duplicate for review purposes whether or not the
parts list matches.

## Designs are built out of moves, not pieces

`scripts/lib/design-motifs.mjs`. The unit of generation is a **motif** — a
small, complete, deliberate gesture — and a design is two or three of them
placed left to right. Coherence comes from the motif; the surprise comes from
which ones get combined, at what sizes, in what order.

| Motif | What it is |
|---|---|
| `run` | Units side by side, uniform height |
| `terrace` | A run whose height changes across it |
| `openBay` | A spacer where a shelf would be, so one gap is a double one |
| `bridge` | Two towers with a span across the gap between them |
| `stagger` | A booster raising one post, and a shelf across it and its neighbour |
| `corner` | A run that turns, built corner-first |

Everything still goes through the placement engine and the rules; nothing in
here knows where a socket is, and a motif that cannot place what it wanted hands
back what it had.

Three things learned by building it:

- **A plain `run` cannot be a whole design.** It is exactly what the simplified
  designer already makes, so it is only ever offered as a second or third move.
- **A refusal must not end the design.** A corner needs more depth than most
  envelopes have and a bridge needs a spacing its family can cross, so motifs
  are tried in a shuffled order until one places something. Treating the first
  refusal as final left a third of all attempts empty.
- **The bridge has to search the spacings.** Only some admit a span, and which
  ones depends on the family: a 1143mm adapter reaches across two 703mm towers
  and across nothing else. Taking the nearest gap and hoping worked for two
  families out of six and left the other four as two towers with air between
  them — rejected as disconnected much later, after a whole design had been
  built around them.

### The envelope is measured, not assumed

`3600 x 1900 x 1300`, and both of the numbers that moved were moved for a
reason found rather than guessed:

- **Depth 1300.** An L-shape occupies its second axis too, and a turn measures
  about 1.24m front to back for a standard unit. At 1m only the shortest trimmed
  cut could complete one, so corners were being excluded by arithmetic rather
  than by judgement.
- **Width 3600.** A real design from the builder — two towers, an adapter
  bridging their inner posts, boosters staggering the storeys above — measures
  3266mm. At 3000 the generator could not have produced it even in principle.

### Where a bridge goes, and why it kept going in the wrong place

Two 703mm towers standing 1143mm apart have posts at 0, 703, 1846 and 2989, and
a 1143mm adapter fits over them twice: at **0**, reaching from the left tower's
left post to the right tower's left post, sitting mostly on top of the left
tower; and at **703**, reaching between the two *inner* posts with the whole of
it over the empty gap.

Only the second is a bridge. The first is whichever candidate the engine happens
to list first, and it is what every generated bridge was, which is why they all
looked like a shelf joining left post to left post. The motif now works out the
inner posts and asks for a span by width: it has to be exactly the distance
between them.

The second half of the same bug: **stopping at the first spacing that worked**.
For a 703mm family the nearest gap leaves 440mm between the inner posts, which a
compact shelf crosses — a real bridge, but never an adapter, because adapters
only come 1143mm wide. The spacing that wants an adapter is one interval further
out, and the search stopped before it. Every spacing is tried now, adapters
first.

### Why a booster needs the shelf found with it

A booster is a 20mm column that lifts a single post half a level, and it only
pays for itself if the next shelf lands on it *and* on something else at the
same height. Nothing choosing one piece at a time will place a 20mm column and
then find the shelf that justifies it, which is why the random generator placed
essentially none.

`stagger` therefore looks for the pair together: a booster position is kept only
once a shelf has actually been found that lands across it and something else. A
first attempt that took the highest booster position and hoped never worked
once — the highest spot is on top of the span, where the booster's top is level
with nothing at all.

## The random walk it replaced

Kept behind `--random-walk`, because it is the baseline everything else is
measured against.


It rolls a *recipe* per design — a width and height target, how many families to
mix, how much it likes gaps, how tall it wants to go, weights over the piece
roles — and then grows a design through the builder's own placement engine,
picking randomly among the candidates the engine offers. Rolling the dials once
per design rather than once per piece is what stops everything converging on one
average shelf: a run of tall narrow towers and a run of long low benches come
out of the same loop.

There is no scoring function. The generator is a source of legal variety;
judgement happens at review, and the notes taken there are the only thing in the
whole chain that could not have been computed.

`scripts/analyse-verdicts.mjs` reports where the kept and rejected designs
differ. It is a report and not a model on purpose — with a couple of dozen keeps
there is nothing to fit that would not mostly be fitting noise. **Read one
generator era at a time** (it defaults to this, `--seeds` overrides): compared
across the whole record, display bars looked like the strongest reason for
rejection in the corpus, and within a single era the difference vanished
entirely. The old generator simply made a great many of them, and the old corpus
was bad for other reasons.

Two details that are load-bearing:

- **Gapped spacing is asked of the engine.** Which base positions count as
  "gapped" is the difference between the candidates Advanced offers and the ones
  Standard offers, so it is computed by asking for both sets rather than by
  re-deriving the intervals here, where they would drift from the engine's.
- **Build-up draws from the families already standing**, 85% of the time. A
  uniformly random extension almost always names a family the design does not
  contain, has nothing to sit on, and spends its turn doing nothing — which held
  the first corpus down to a couple of pieces and half a metre. The occasional
  out-of-family draw is left in deliberately: it is where a slim shelf lands on
  a broad run, which is exactly the sort of thing worth seeing.

## The bench

`design-lab.html`, served by the dev server. One design at a time with a
verdict, a note and a link that opens it in the real `/builder`; a grid view of
everything with the verdicts marked; filters for what is left to do.

- **← reject, → keep, ↑ maybe, ↓ skip.** In the "to review" filter a judged
  design leaves the list, so the next one arrives under a thumb that has not
  moved.
- **It does not re-implement the shelf.** Designs go through
  `engine.deserializeState` and are drawn by `js/builder/renderer.js`, so a
  picture here is a picture of what the page would show rather than an
  approximation of it.
- **One WebGL context draws every thumbnail**, two at a time with a frame
  between batches. Three hundred snapshots and three hundred PNG encodings in
  one task stops the tab answering scrolls, which is what the grid did before
  the queue. The design on screen jumps the queue.
- **Verdicts live in `data/design-lab/verdicts.jsonl`**, one JSON object per
  line, appended, each line carrying the design it judges. Both of those are
  scar tissue, and the reasons are worth keeping:

  - **A verdict carries its design** because a verdict keyed only to a
    fingerprint is a label with no subject the moment the corpus is
    regenerated — and regenerating the corpus is the most ordinary thing anyone
    does here. Three hundred reviewed designs survived exactly that and meant
    nothing afterwards, because nothing on disk could say what had been judged.
  - **Appended, not rewritten**, because a note is saved on every keystroke, and
    a whole-file write per keystroke rewrites an afternoon's work a thousand
    times. A later line wins, so an edit is an append too.

  `localStorage` mirrors it as a cache, and Export is the copy you can send
  somewhere. Generating also drops an untouched copy of the corpus in
  `data/design-lab/corpora/`, named for its seed and contract — belt and braces
  now that the verdicts stand on their own.

  Because the key is the design's *identity*, a verdict follows the design
  across corpora: regenerate with a new seed and anything already judged stays
  out of the queue.

The lab and `/builder` quote the same size for the same shelf: the shelf's own
envelope, ignoring a lamp. The full bounding box — lamp included — is what the
envelope test uses, because an arm over the top still needs the room to be that
tall. Both are recorded.

## Not on the public site

`design-lab.html` and `data/design-lab/*` are 404'd in `netlify.toml`, next to
`/docs/*` and `/scripts/*` and for the same reason. The corpus is unreviewed
machine output and the bench only works against a local server that can write
the verdicts file.

Unlike `/builder`, the page carries no `?v=` asset version. The bump script
exists so that the builder's code and catalogue can never be served half-stale
from a CDN; this page is served from disk with `no-store` and has no CDN to go
stale in.

## Evening out the spacing

`scripts/normalise-maybes.mjs` runs `/builder`'s **Normalise spacing** over every
design that survived review, and writes the result as a corpus of its own:

```bash
node scripts/normalise-maybes.mjs
# design-lab.html?corpus=/data/design-lab/corpora/maybes-normalised.json
```

A corpus of its own rather than over the review record, because evening the
spacing changes the design and therefore its identity — and a verdict belongs to
the shelf it was given to. Overwriting would quietly restate what was judged.

It reports faults it *caused* separately from faults a design already had.
Several of these designs were judged before the later rules existed, and a
pre-existing fault is not evidence that this script broke something.

One rule had to give way to it. A free-standing unit in a bridged gap was
counted as connected only because it happened to be butted against its
neighbour, so moving it into the middle of the gap made it — by the letter of
the connectedness rule — a second piece of furniture standing nearby. Nobody
looking at the picture would say that, so a unit standing under something that
passes over it now counts as connected: overlapping in plan is the test. Two
towers with real air between them and nothing over it still count as two.

## The studio: one page

`studio.html`, served by the dev server, and the **only** bench page. Judge a
shelf, and its four angles arrive immediately; choose the ones worth having and
the renders start while you move on to the next shelf. When a render finishes it
is put into a room, and the result jumps the queue to be looked at while it is
fresh.

```bash
npm run studio   # starts the server if it is down, then opens the page
```

It refuses to move off port 8770 rather than drifting to 8771 and leaving you on
a page whose `/api/ai-*` proxy points somewhere else, and it warns up front when
`SITE_LOGIN_KEY` or the sibling pipeline checkout is missing — a missing key
looks like an authorisation bug and a missing pipeline looks like the renders
being broken, and neither is worth debugging twice.

`npm run dev` still starts the server on its own if you would rather open the
page yourself.

**Browse** in the header is the other half of it: everything the flow has
produced, as Shelves, Views, Renders and Scenes — the pipeline's own order. The
flow only ever shows the next thing; this is for going back.

### Walking the flow without answering it

Every other control writes something down, so there was no way to look at the
previous shelf, or the angle before this one, without deciding about it or
reloading the page. Skip came closest and is still a decision of a kind: it
moves on, and only forwards.

So `[` and `]`, and the two arrows either side of the counter. They change
nothing at all — a shelf walked back to is exactly as unjudged as it was, an
angle walked back to has not been queued, a scene walked back to is still
waiting for its verdict. Not arrow keys, deliberately: every arrow on this page
writes something down, and one that sometimes did not would be the surprise.

Shelves wrap around; angles clamp inside the shelf they belong to, because
falling off the end of them into the next shelf is not navigation, it is losing
your place.

### One picture, large, with its family under it

Click any picture in the gallery. It opens large, and under it the four stages
are laid out as strips — **Shelf · Views · Renders · Scenes** — for the whole
shelf, not for the one line through it. A view usually has more than one
render's worth of history and a render more than one room, and those branches
are exactly what you want to compare. The picture in front of you is ringed;
the branch it belongs to is outlined more softly, so a shelf with four angles
and nine rooms still reads as which came from which.

Every tile is a way to move: click the shelf to go up, click another scene to
go across. `Escape` or **Back to the grid** leaves.

Views are planned quietly on the way in when they are not loaded, **writing
nothing** — looking at a picture should not judge anything. Only asking for
views records them.

Scene tiles are served through `&thumb=1`, cut once with sips, for the reason
the renders already were: a scene is a 2400px JPEG near three megabytes, and a
strip of a dozen is thirty megabytes the browser spends a minute not decoding,
which looks exactly like the pictures being broken. 2.9MB becomes 47KB.

### Not liking a scene: two dissatisfactions, two buttons

The detail view of a scene carries a note box and two ways of asking again.

- **Same room again** — the *same* request, rolled. The model is not
  deterministic, so the next one is a genuinely different photograph of the same
  idea. This is what you want when the room is right and the picture is not:
  the shelf came out bent, the light went odd, the composition is dull.
- **Different room** — the next room on the cycle. This is what the flow's
  ↑ **Again** has always done, and it stays the right default at speed; the
  finer choice belongs in the detail view, where you are already looking
  closely.

The note goes to both, as `customNotes` on the prompt.

**Neither judges the picture in front of you.** It keeps whatever verdict it
had, including none, so the answer can be given once both are on the table. The
one outcome worth avoiding is throwing away a picture that has already been paid
for, and "I did not like it" is not the same as "delete it before I have seen
the alternative".

Asking again spends the cap like anything else and joins the same one-at-a-time
queue, so pressing both buttons queues both.

### Pushing one thing through by hand

The flow is the fast path and assumes you want the next question. Each Browse
tab also carries the button that moves one of its rows on to the next tab, for
the shelf you want to fix now, or the render that deserves a second room.

| Tab | Button | What it does |
|---|---|---|
| Shelves | **Edit code** | Replaces the shelf from a pasted /builder link |
| Shelves | **Create views** | Plans its four angles and opens the Views tab |
| Views | **Render** | Sends that one angle to the render queue |
| Renders | **Put in a room** | Generates a scene from that finished render |

**Editing happens in /builder, not here.** Open the shelf, move a piece, copy
the address back, press Replace. /builder is the one place that knows what a
legal placement is, and a second editor on the bench would be a worse one. The
link is decoded server-side by `decodeShareHash` in `scripts/lib/design-lab.mjs`
— the inverse of the `shareHash` beside it — so the link format has one reader
on this side of the fence rather than a copy in a bench page that would diverge
from it quietly.

The replacement is written as a **new row naming the shelf it supersedes**,
which is how a normalised design is already recorded: a verdict belongs to the
shelf it was given to, and rewriting it in place would quietly restate what was
judged. Superseded shelves drop out of the Shelves tab; the record keeps both.

A shelf that comes back through a link is renamed. The design code is a hash of
the whole serialised state, and a share link does not carry the placement
metadata the generator wrote — so the code changes even when the shape does not.
The fingerprint is the identity, and it survives the round trip. /builder shows
the same new code for the same link, so the two agree.

**Views are planned fresh each sitting, not reloaded.** A shot's record carries
where its camera ended up, not the geometry the planner needed to put it there.
The planner is deterministic about all of it — same angles, same ids — so the
tab offers to re-plan rather than pretending the record is enough; only the
finish is rolled, and a finish already on record is kept.

**The cap is not waived for a hand-pushed scene.** It costs what an automatic
one costs, so it joins the same queue and spends the same budget. The generator
runs one at a time, so pressing the button on six renders queues six scenes —
a button that silently did nothing while it was busy would be worse than none.

**When the batch runs out, the page grows another.** A corpus is finite — that
is what working through one means — and answering "everything has been judged"
and stopping is a dead end with the generator sitting one directory away. The
button is where the question comes up. Shelves judged in an earlier batch are
skipped by their own identity, so an overlap costs nothing.

It replaced two separate bench pages — `design-lab.html` and `shot-lab.html` —
rather than sitting beside them. Three pages was two too many, and the one that
mattered was the one nobody could find.

**Yes and maybe are the same answer.** The old bench offered keep / maybe /
reject and the record is mostly maybes; the flow offers yes / no, because a
third button in a continuous pass is a decision nobody wants to make at speed.
Both count as taken wherever the record is read.

### One key, in one place

`SITE_LOGIN_KEY` in `framework-site/.env` (gitignored, read fresh per request).
The dev server proxies `/api/ai-*` and `/api/scene-airtable` to the live
functions and sets `x-framework-key` itself, so **the studio does not ask for a
key when it is served from localhost** — a prompt whose answer is thrown away is
two places to keep one secret, one of which does nothing. Served from anywhere
else the gate is real and is asked properly.

The provider key is not involved. `GEMINI_API_KEY` is a Netlify environment
variable and never reaches a browser or a laptop; that is what moving the
studios off laptops was for, and putting a copy in a local `.env` would undo
it.

→ yes · ← no · ↓ skip, and ↑ for **Again** on a scene; `[` and `]` walk back and
forward without deciding anything. The keys answer whatever the flow is showing,
so they do nothing while Browse is open — an arrow pressed there used to judge
the shelf behind the gallery, which nobody could see. Two bars at the foot of
the page: renders (with Pause) and scenes (with the budget).

**The key is asked for lazily.** Judging, angles and rendering are local and
free; only the image model is gated, so putting a password in front of the whole
page would be charging admission for the part that costs nothing.

### A reload does not spend the budget

The dev server's render queue lives in memory and outlives the page, so a reload
arrives to find the last sitting's finished renders still listed as done.
Everything already finished when the page opens is marked seen without being
generated — otherwise opening the studio would spend the budget on a backlog
nobody asked for, before it had drawn a single shelf.

### The scene budget

Scene images cost money, and they fire off the back of renders that fire off the
back of a keypress. So a cap — 25 a sitting by default, editable in the bar,
and **Auto** can be turned off entirely. A number you have to raise deliberately
is a better stop than remembering to look.

### Curated scenes, cycled

`js/design-lab/scene-presets.js` holds 30 named scenes. Each is one of the seven
Nairobi archetypes already in `js/studio/prompt-config.js` — which carry a
written paragraph describing a real place — plus a shot: which room, what light,
who lives there, how full the shelf is. Randomising every parameter gives a
mustard wall under a moody night light with a cowhide rug: each choice
defensible, the room impossible.

Two rules the list keeps:

- **Daylight only.** No golden hour, no evening lamps, no night. Warm low sun
  flatters a photograph and lies about a product — it recolours the finish, and
  the finish is what somebody is choosing.
- **Nothing staged past "tidy"** unless the scene is explicitly a showroom.

They are **cycled, not shuffled**: thirty scenes drawn at random gives you the
same café twice before you have seen half of them.

### The prompt is the scene studio's own

`js/studio/scene-prompt.js` is `buildPrompt` lifted out of `scene-studio.html`,
which now calls it. It was a closure over two pieces of React state — the
measured scale and the resolved aspect — and both are arguments now; nothing
else changed. A second, slowly diverging copy of a 7,000-character prompt is not
a thing to own.

### What a scene record carries

Design code, shot id, preset and archetype, the full parameter set, the camera
and the figure position from the shot, and the verdict. A picture can always be
traced back to the shelf, the angle and the room it came from.

**Maybe** pushes it down the content pipeline: the render as the `source` and
the generated picture as the `output`, staged then committed through
`/api/scene-airtable`, which already existed. **Again** puts the same shelf in
the next room on the cycle, plus whatever note you type — the shelf and angle
already passed, so it is the room being sent back.

### A finished scene is usually not in its own envelope

`/api/ai-result` returns the job, and `ai-background` copies an image into that
result only while its base64 is under four megabytes
(`INLINE_IMAGE_BASE64_LIMIT`). A scene at the size this asks for never is. So
the normal case — not the edge case, **every** scene — is a finished, paid-for
job that comes back carrying

```json
{ "mimeType": "image/jpeg", "url": "/api/ai-image?id=…&n=0" }
```

and no `base64` at all. The picture is in Blobs, and `/api/ai-image` serves it.

`js/design-lab/scene-jobs.js` reads the envelope for an inline image first and
fetches that URL when there is none — through the same `send()` as everything
else, so the gate supplies the key. Reading only the envelope is why the studio
reported every scene it ever asked for as "the scene job finished without an
image", with three failures in the bar and three generated images sitting in
Blobs, paid for and unreachable.

`scripts/test-design-lab.mjs` pins both shapes against envelopes copied from
live jobs. Finding this out again costs an image; a test costs nothing.

### Why the shelf kept coming back as a different shelf

The scenes were good rooms containing the wrong furniture. `scripts/audit-scenes.mjs`
puts the render and the generated scene in front of the cheap validate model
(`gemini-3.5-flash`, not the image model, so a hundred audits cost less than one
generation) and asks it to **count** rather than admire: tiers, uprights,
silhouette, viewpoint, colour, material — and, pulling the other way,
`nairobi_real` and `beige_nowhere`, so that nothing can score well by flattening
the room into a studio backdrop.

Ten scenes gave a mean fidelity of **3.37/5**, and every fault was the same
fault wearing a different hat:

    "stepped pyramid inverted to a bridge shape"
    "merged three stepped modular units into a single double-bay shelf"
    "separated left section into a bedside table"
    "central bridge became a standard three-tier shelving unit"

It is not noise, it is a **prior**. The model normalises an asymmetric,
multi-module, stepped composition into the rectangular bookcase it expects. The
decisive measurement: the *same shot*, with the *same reference image and the
same constraints*, scored

| room | fidelity |
|---|---|
| café display | 4.2 |
| Karen bedroom | 2.8 |
| Karen bedroom | 2.2 |

Only the room prompt changed. Given a bedroom, the model files a low module
under "bedside table". It is not being stupid — a shelf standing in three
separated stacks genuinely is ambiguous, and **nothing in the prompt said it was
one object**.

The prompt was not too long. It was describing the wrong things: tier count,
spacing, colour, tube thickness and joint style are all true of *any* shelf, so
none of them says what THIS shelf looks like. The only thing carrying the shape
was one reference image against seven thousand characters about a room.

### Saying the shape out loud

`js/design-lab/design-words.js` states it, from the design rather than from the
picture — which is something this tool can do and the scene studio never can,
because the scene studio works from an uploaded photograph and this works from a
design it generated. Words plus the image beat the image alone.

It appends a block naming the overall size, the **skyline** (the top edge as a
few flat runs, left to right), the **floor footprint** (how many separate places
the shelf touches the ground and how wide the gaps are), any **bridges** (spans
carried at both ends with open air beneath), and one sentence doing most of the
work: *it is ONE freestanding piece of furniture — do not turn any part of it
into a side table, bedside table, console, sideboard, cabinet or bench.*

It goes **last**, after the room, because that is where it is read last and has
to survive a vivid paragraph about a Karen garden house. It is written as a
check, not a wish.

The shelf height is passed too. It was always available and never sent, so every
scene before this was generated by a model that did not know whether the shelf
was waist-high or taller than the person beside it.

**It claims only what is exactly derivable.** Board counts and board heights are
deliberately absent: coincident boards where modules meet make both fragile, and
a confidently wrong "there must be exactly 8 shelves" would do more damage than
saying nothing. The image carries those; this carries what the image was losing.

### What it bought

Matched pairs — same shot, same room, the prompt the only change:

| case | outline steps | before | after |
|---|---|---|---|
| `1VDXVZA-ym42` · South B dining | 3 | 2.95 | **4.10** |
| `12R8MTD-ym14` · South B living | 3 | 2.70 | **4.00** |
| `3ASS7VY-yp14` · Karen bedroom | 5 | 2.50 | 2.63 |
| **overall** | | **2.72** | **3.58** |

Place scores held (3.5 before, 3.5 after on the two that moved): the rooms did
not get more generic to buy the geometry, which was the thing worth protecting.

**The honest part: it does not rescue the hardest designs.** Outline complexity
predicts the difficulty almost linearly —

| skyline steps | mean fidelity |
|---|---|
| 2 | 4.00 |
| 3 | 3.42 |
| 5 | 3.07 |

— and a five-step, 275 cm, three-footprint shelf with two bridges and a lamp
stays wrong however carefully it is described. That is not a prompt problem any
more. The generator can compose shapes no current image model will hold, and the
answer there is to know which ones they are before spending on them, not to
write a longer prompt.

### The reference image is the render, whole

That image is the geometry master — the prompt's VIEWPOINT LOCK tells the model
to copy the silhouette, tier count, board endpoints, tube positions and joints
from it — so shrinking it throws away the only thing it is there for.

An 1800px render is 3.6MB once base64'd, against a 5.5MB ceiling on the whole
request. It goes **as it is: full size, lossless PNG, no re-encode**, which
lands close to the budget with room to spare.

There is a ladder below that for the day one does not fit — full size at falling
JPEG quality, then fewer pixels — but it is a fallback, not the path. An earlier
version shrank every render to a 1400px JPEG of 61KB; it fit comfortably and was
fifty-nine times smaller than it needed to be.

## Choosing the angles, then rendering them

A Blender render is minutes of a laptop's attention, and most angles of most
shelves are not worth one. So the angle is chosen before it is spent:

```bash
node scripts/plan-shots.mjs      # four angles and a colour per kept design
npm run dev                      # then http://127.0.0.1:8770/shot-lab.html
node scripts/export-shots.mjs    # the approved shots, ready to render
```

`shot-lab.html` draws each shot with the builder's own renderer, and the same
keep/skip pass as the design bench chooses among them.

### The camera is a person in the room

Eye height 1550mm, looking at the middle of what has to be in shot, never
orbiting — the render console's "walk" mode, whose camera payload says
`frame: "walking-person"`. Its field of view is 38°, which is the renderer's
orbit camera and the console's render camera both, so a preview and its render
are the same picture.

**How far back is solved, not guessed.** Every corner of the subject is put into
the camera's own frame and the distance is the smallest that keeps all of them
inside the field, plus a margin. The console's own stand-off is a rule of thumb
over width and depth, and it is a *starting point for walking*, not a framing:
turned 40° a 3m run presents its diagonal, and a distance chosen for its width
crops both ends. It also frames the shelf alone — beside a 724mm shelf that put
the camera 1.65m away looking 355mm off the floor, and a 1.8m figure standing
next to it had its head a hundred pixels above the top of frame at every angle
and every distance. There was no placement to find, because the person did not
fit in the picture.

**A corner shelf is only photographed from inside its angle.** The engine's
rotation frames give each unit's back, so its front is the opposite; the
bisector of the *distinct* fronts is the middle of the wedge, and the arc of
shots is narrowed to ±40° so none of them swings round the back of a leg.
Weighting by how many units face each way pulls the camera towards the longer
leg — on one corner it came out 63° off, and the arc then reached past the end
of the wedge.

### Where the figure stands

At the open end of a run, never the inside of a corner — a person standing there
is standing in the shelf — and never the middle, where they would be in front of
it. The planner works out which ends are open; an end another leg runs past is
not an end, it is the corner.

It stands at the run's own depth, which is where the render pipeline puts it by
default, and the reason matters: a figure a few hundred millimetres in *front*
of the shelf is a metre and a half nearer a camera two and a half metres away,
so it projects half as tall again and crops out of every frame.

The preview draws a **dashed outline, not a figure**. Blender puts a scanned
human in the shot — `assets/render/scale-figure-woman.obj` in the pipeline — and
this page has no business drawing anything that could be mistaken for it. The
outline sits at exactly the height, width and position the real one will occupy,
which is what is being judged.

### The camera is derived once

The eye point becomes the renderer's orbit camera exactly as the console does
it; the camera that comes back out of the renderer is what travels with an
approved shot to Blender, and so is where the figure was standing. Deriving
either a second time in the export would be two answers that eventually
disagree, and the whole value of a preview is that it shows what will be
rendered.

Once, and in one file: `js/design-lab/preview.js` holds the aiming, the figure
placement and the drawing, and **both** benches call it. The shot bench had its
own copy of all of it for a while, which is the same failure wearing a different
hat — a second camera derivation sitting quietly in another file, waiting to
drift.

`scripts/export-shots.mjs` writes, per approved shot, the design (a `/builder`
export the pipeline reads unchanged), the camera, the scale figure, and a shell
script of `render-config.py` commands. It writes the commands rather than
running them.

## Tests

`node scripts/test-design-lab.mjs`, in `npm test`. It covers the three promises
that would otherwise fail silently: that a corpus link decodes back to the
design it was written from (the encoder is here, the decoder is in `app.js`, and
nothing but the test joins them), that the identity is blind to turning,
mirroring and where a design sits, and that a freshly generated corpus keeps
every rule this document claims for it.

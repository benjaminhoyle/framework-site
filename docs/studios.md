# The private tools, and the gate in front of them

> What this is: what the five gated pages (scene-studio, catalog-studio,
> catalog.html, metrics.html, marketing) do, what the login gate protects, and
> what the two image studios share.
> When to read it: before changing the gate, adding an endpoint, or touching
> shared studio code; for routing and redirects check netlify.toml directly.

Five pages on this site are not for the public:

| Page | What it does |
|---|---|
| `/scene-studio` | puts a shelf into a generated room |
| `/catalog-studio` | builds a product image set and its package JSON |
| `/catalog.html` | the catalogue manager: edit, toggle, publish |
| `/metrics.html` | the funnel monitor |
| `/marketing` | the marketing console: the framework-marketing folder, read-only, as the ops publish step last sent it |

They moved here (the first two, from a `image-generator` repo that ran on
laptops) on 9 August 2026.

## Why they are pages and not local tools

The studios call Gemini or OpenAI, which needs an API key. A local tool means
that key has to reach every laptop that runs it — pasted in by hand, stored in a
browser, and gone from our control the moment it is. As pages here the key is a
Netlify environment variable: it is **never delivered to a browser**, it cannot
leave with a laptop, and there is one place to rotate it.

That was always half-true — the studios already had server-side functions and
only fell back to a browser key when there was none. What changed is that the
fallback is gone, so there is no browser key path left to leak.

## What the gate actually protects

Not the pages. They are static files, anyone can fetch the HTML, and there is
nothing in them worth having.

**The endpoints.** `/api/ai`, `/api/ai-start`, `/api/ai-result` and
`/api/ai-image` hold the provider key and spend real money; `/api/catalog*` and
`/api/dashboard` hold the business's numbers. Those had *no authorisation at
all* while they lived on an obscure domain. On framework.co.ke that would have
been an open door to the API budget, so every one of them now refuses a request
without the key.

```txt
js/gate.js  ──►  POST /api/auth          "is this key right?"
            ──►  every /api call         X-Framework-Key: …
netlify/functions/_auth.mjs  ──►  the one place a request is accepted or refused
```

- **Two secrets, by audience.** `SITE_LOGIN_KEY` is the password a person types
  to open all five pages; `SITE_EXPORT_KEY` is the long one the ops runner
  sends, and it opens those same pages *plus* the endpoints no browser
  calls — `/api/export`, `/api/dashboard-data`, `/api/catalog-data`, and a PUT
  to `/api/marketing-data` (whose GET is a page call). Guessing
  the typed password therefore does not hand over the raw event lake or the
  ability to overwrite what the dashboard shows. Per-person accounts would still
  not be proportionate at three people.
- **One check**, `_auth.mjs`. A new endpoint cannot be added without an author
  having to decide about auth — and now to choose an audience: `refuse` for
  anything a page calls, `refuseMachine` for the runner's own. That is the point
  of it being a shared import rather than four copies of an `if`.
- **The key travels in a header.** `?key=` still works — the ops runner sends it
  that way and old bookmarks carry it — but the gate moves a `?key=` into storage
  and strips it from the address bar the first time it sees one, because secrets
  in URLs end up in history, referrer headers and logs.
- **Asked for once per browser**, then remembered. `FrameworkGate.signOut()`
  forgets it.

Both studios also `noindex`, and all five pages are disallowed in `robots.txt`.

## What is where

```txt
scene-studio.html               the scene studio
catalog-studio.html             the catalogue studio
js/gate.js  css/gate.css        the gate
js/studio/chrome.js             nav, buttons, fields, panels, activity log
js/studio/scale.js              measuring a shelf and standing a figure in it
js/studio/handoff.js            row -> scene studio -> row
js/studio/                      prompt-config, framework-names, product reference
images/studio/details/          the detail photographs the catalogue studio uses
netlify/functions/ai*.mjs       provider calls, holding the key
netlify/functions/_auth.mjs     the shared check
netlify/functions/auth.mjs      /api/auth
```

`js/studio/framework-names.js` is a twin of `framework-renderer`'s
`scripts/lib/names.py`, and that repo's `check-names.py` holds the two to the
same answers. It will drift otherwise — see the pipeline's CLAUDE.md.

## What the two studios share

They do different work and look different where they do. Everywhere they do the
*same* thing there is one implementation and both pages import it. Load order
matters: `chrome.js`, then `scale.js` (whose panel uses chrome's buttons), then
`handoff.js`.

| Module | What it owns |
|---|---|
| `chrome.js` | the nav (it marks its own current page), the button family, fields, panels, and the activity log |
| `scale.js` | the whole scale flow: measure, place the 180 cm figure, drag it, the composite, and the words on screen |
| `handoff.js` | the round trip between a catalogue row and a scene studio session |

Each page keeps only what is genuinely its own: the scene studio's node pipeline
and its recipe vocabulary, the catalogue studio's job queue and row sequence.

### The scale figure

A photograph carries no size, and a stated height in the prompt is routinely
ignored — the model cannot relate "180 cm" to the pixels in front of it. So the
height fixes pixels-per-centimetre, and a 180 cm silhouette is composited into
the reference at that scale. The number and the picture together are what works;
neither does on its own.

Both studios now do this identically, and `figureNote()` is the one prompt
sentence they must agree on: the figure is a measuring stick, not content. The
rest of each SCALE line stays with its own page, because a scene prompt and a
catalogue-set prompt are asking for different things.

### The viewpoint

A photograph of a shelf is a projection of it from one place. Everything the
scene studio used to say about product fidelity — tier count, proportions,
spacing, colour, joints — is true from *any* vantage, so none of it stopped the
model quietly re-shooting the shelf from somewhere else, and a render's
perspective was lost the moment it entered a room.

The catalogue studio never had this problem, and it does not mention a camera
anywhere. The word that does the work is **silhouette**: an outline can only be
traced from the place it was traced from, so "the product silhouette must match
the source" locks the vantage as a side effect. The scene studio now carries
those same lines as `viewpointPrompt`, plus an audit sentence scoped to the
shelf rather than the whole picture, since its output is a room and the
catalogue's is a cyclorama.

Two supports underneath it. The reference image is **named** before it is sent,
the way `buildContents` names every catalogue reference — an instruction about
"the reference" needs something to point at. And the default aspect is **Match
source**, which resolves at generation time to whichever fixed ratio the source
is nearest: asking for the source's own shape makes the job an edit rather than
a re-shoot. The other ratios are still there when a shot is wanted in a
particular format.

The one thing that had to be settled is precedence, and stating it was not
enough on its own. Three places were quietly specifying a camera position:
the Composition options ("Standing eye-height", "Level horizon", "Optimal
angle"), and the photographic floor, which called itself *non-negotiable* and
then asked for a level horizon — which a render shot from above cannot have. A
lock that has to win an argument on every sample will lose some of them, so the
conflicting words are gone rather than out-ranked. Composition now describes how
well the frame is composed and nothing about where the photographer stands, the
floor defers camera attitude to the lock, and THE PHOTOGRAPH still carries the
precedence line for anything typed into notes.

The validator (`VAL_PROMPT`) gained `viewpoint_match` and `square_board_ends`,
because drift in vantage is now the most likely failure and the hardest of them
to judge by eye.

### The handoff

**Add scene** on a catalogue row opens a picker of every image the row has — the
source photo or render, populated, emptied, and any generated child including an
earlier scene shot. Choosing one writes an IndexedDB record and opens
`/scene-studio?handoff=<id>`, carrying that image, the design code and the scale.
**Send to row** on a finished shot writes the result into the same record and
returns; the catalogue studio collects it on load and on focus and files it as a
child of that row, beside the angles and detail shots.

Which image is right is a judgement about the shot somebody wants, so it is
asked rather than inferred. The emptied image is usually it, but the original
render is the answer when the generated ones have drifted from the product.

Walking away without sending is normal, so the row says so: it shows **Resume
scene** instead of **Add scene** while a session is open, and resuming reopens
the same record rather than minting a second one.

The id travels in the URL and the payload does not — a photograph is a megabyte
or two, and no query string holds that. The id is moved into `sessionStorage` and
stripped from the address bar on arrival, exactly as the gate does with `?key=`,
so a reload keeps the banner and a bookmark cannot re-enter a finished handoff.

Two things worth knowing:

- **Pixels-per-centimetre does not travel to a generated image.** It was measured
  in the source photograph's pixels; a generated image is a different size, so
  only the shelf height crosses and the figure is placed again if it is wanted.
- **A returned shot is never binned.** If no open row matches, the record waits
  rather than being deleted. Records go stale after a week.
- **Writes resolve on `transaction.oncomplete`, not on request success.** Those
  are different moments, and both halves navigate the instant their write
  resolves. Resolving at the earlier one meant leaving with the write still in
  flight, where the navigation could abort it — the handoff, or the finished
  shot, simply never existed. Intermittent, and the cause of the first report
  that a generated scene did not come back.

## The render console is not one of these pages

The nav's last item, **Render console ↗**, points at `http://localhost:8775/console/`
— a program on the machine in front of you, not a page here. It needs Blender and
the module geometry, which is the whole reason anything still runs locally.

**A page cannot start it, and never will be able to.** No browser gives a web page
a way to run a program; that is the single most important thing browsers refuse to
do, and framework.co.ke should not be an exception to it. Registering a custom URL
scheme (`framework://render`) from the installer would technically get there, but
it means an app bundle on macOS and a registry key on Windows, a confirmation
dialog either way, and one more thing to keep working on a machine whose setup is
deliberately one double-click. Not worth it to save starting a program.

So the nav does the two things a page *can* do:

- **Links to it**, in a new tab. A navigation to `http://localhost:…` is not a
  fetch, so no mixed-content rule, CORS preflight or local-network check applies;
  it simply works when the console is running. A new tab means a console that is
  not running costs you a dead tab, not the studio you were working in.
- **Says how to start it**, behind the `?`.

There is deliberately no "is it running?" light. Checking would mean fetching
localhost from an https page: allowed in Chrome, refused in Safari and Firefox,
and increasingly gated behind a permission prompt in Chrome too. A status light
that is wrong on half the browsers is worse than no status light.

## Image generation, in outline

Long jobs cannot run inside a synchronous function, so:

1. the browser posts to `/api/ai-start`, which stores the request and queues a
   background function with only a job id;
2. it polls `/api/ai-result` until the image is ready;
3. it fetches the bytes from `/api/ai-image`.

`ai-start` forwards the caller's key to the background hop, so the internal call
is authorised exactly as the outer one was — otherwise anyone could re-run an
existing job and multiply the spend.

## Environment

| Variable | For |
|---|---|
| `SITE_LOGIN_KEY` | the typed password for all five pages |
| `SITE_EXPORT_KEY` | the ops runner's key: those pages, plus the machine-only endpoints. Accepted everywhere on its own if `SITE_LOGIN_KEY` is unset |
| `GEMINI_API_KEY` | image generation |
| `OPENAI_API_KEY` | image generation, when the provider is switched to OpenAI |
| `AIRTABLE_PAT` | Scene Studio's **Post to Airtable** button: writes the source image and generated output into the AT content pipeline |
| `GITHUB_TOKEN`, `GITHUB_REPO` | publishing the catalogue (see catalog-architecture.md) |

## Airtable scene handoff

Scene Studio can post a selected generated shot to `Marketing - Content Pipeline`
and the source/reference image to `Marketing - Source Images`. The source and
content records both get the design code; content starts as **For Review**; and
source records are flagged **Blender Render** when the uploaded source filename
strictly parses as `fw-<CODE>-r-...`.

Required extra fields:

| Table | Field |
|---|---|
| `Marketing - Source Images` | `Config Code` |
| `Marketing - Source Images` | `Blender Render` |
| `Marketing - Source Images` | `Original Filename` |
| `Marketing - Source Images` | `Scene Studio Submission ID` |
| `Marketing - Content Pipeline` | `Config Code` |
| `Marketing - Content Pipeline` | `Scene Studio Submission ID` |

## Working on them locally

`netlify dev` from the repo root, so the functions run. The pages will ask for
the access key; use whatever `SITE_LOGIN_KEY` is set to locally (or
`SITE_EXPORT_KEY` — it opens the pages too). A plain static
server will serve the pages but every request will 401, which is correct
behaviour and not a bug to work around.

# The private tools, and the gate in front of them

Four pages on this site are not for the public:

| Page | What it does |
|---|---|
| `/scene-studio` | puts a shelf into a generated room |
| `/catalog-studio` | builds a product image set and its package JSON |
| `/catalog.html` | the catalogue manager: edit, toggle, publish |
| `/metrics.html` | the funnel monitor |

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

- **One secret**, `SITE_EXPORT_KEY`, for all four pages. Proportionate at three
  people; per-person accounts would not be.
- **One check**, `_auth.mjs`. A new endpoint cannot be added without an author
  having to decide about auth, which is the point of it being a shared import
  rather than four copies of an `if`.
- **The key travels in a header.** `?key=` still works — the ops runner sends it
  that way and old bookmarks carry it — but the gate moves a `?key=` into storage
  and strips it from the address bar the first time it sees one, because secrets
  in URLs end up in history, referrer headers and logs.
- **Asked for once per browser**, then remembered. `FrameworkGate.signOut()`
  forgets it.

Both studios also `noindex`, and all four are disallowed in `robots.txt`.

## What is where

```txt
scene-studio.html               the scene studio
catalog-studio.html             the catalogue studio
js/gate.js  css/gate.css        the gate
js/studio/                      prompt-config, framework-names, product reference
images/studio/details/          the detail photographs the catalogue studio uses
netlify/functions/ai*.mjs       provider calls, holding the key
netlify/functions/_auth.mjs     the shared check
netlify/functions/auth.mjs      /api/auth
```

`js/studio/framework-names.js` is a twin of `shelving-3d-pipeline`'s
`scripts/lib/names.py`, and that repo's `check-names.py` holds the two to the
same answers. It will drift otherwise — see the pipeline's CLAUDE.md.

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
| `SITE_EXPORT_KEY` | the gate on all four pages and every private endpoint |
| `GEMINI_API_KEY` | image generation |
| `OPENAI_API_KEY` | image generation, when the provider is switched to OpenAI |
| `GITHUB_TOKEN`, `GITHUB_REPO` | publishing the catalogue (see catalog-architecture.md) |

## Working on them locally

`netlify dev` from the repo root, so the functions run. The pages will ask for
the access key; use whatever `SITE_EXPORT_KEY` is set to locally. A plain static
server will serve the pages but every request will 401, which is correct
behaviour and not a bug to work around.

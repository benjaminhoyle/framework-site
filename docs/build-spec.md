# Framework — Build Spec (handoff work order)

**Audience:** the builder session. Read `docs/strategy.md` first for *why*; this is *what
and how*, in priority order. Build top-down. Do not re-derive strategy — it's decided.

**Prime directive:** the core goal is **clear, redesign-proof monitoring** of the funnel
`ad → site → WhatsApp → quote → sale`, that (a) shows what's happening, (b) gives enough to
form hypotheses & make ad decisions, (c) lets us check whether those changes panned out.
Everything below serves that. Ship WS1 first (it starts real data accumulating).

---

## Invariants (must hold across all workstreams)
1. **Checkpoints are customer milestones, never page mechanics** — they survive site
   redesigns. Variation lives in *dimensions*, not new stages. (See strategy.md Part 2.)
2. **Events never enter Airtable.** The high-volume site event stream lives in the event
   lake (Netlify Blobs). Only a *per-conversation summary* and *per-ad aggregates* are
   written to Airtable.
3. **Single writer per field.** Machine-owned Airtable fields are written only by the sync/
   reconciliation, idempotently, and **never clobber human-curated fields** (respect the
   `Manual Match` override).
4. **One join key** (the short code) end-to-end. **One runner** (single `run.command`).
   **Dry-run by default**; writes only with `--commit`.
5. **No PII in the event lake** (no name/phone on the site; phone enters only via Airtable).
6. **Don't rebuild what Meta already shows.** Our dashboard answers only what Meta can't:
   the funnel across the WhatsApp cut + the spend denominator + experiment outcomes.
7. **Least privilege:** read-sync uses the **read** token; only ad-creation (WS4, parked)
   uses the **full** token.

## Environment / secrets (files outside the repo; read from path, never echo)
- Airtable PAT (schema+data write): `/Users/ben/code/framework/airtable-api.txt`
  - Base `appOTj9wLzFwbQUZj`. Tables: `Orders - Messages` `tblRVeTjLV1xdcDfy`,
    `Marketing - Ads` `tblHCHkv8gRjXafkC`, `Orders - Pipeline` `tblytDBTVFWFyP2qc`,
    `Base - Products` `tblyL6ldOJm94uSGa`.
- Meta read-only token: `/Users/ben/code/framework/meta-ads-read-api.txt`
- Meta full token (WS4 only): `/Users/ben/code/framework/meta-ads-full-api.txt`
  - Ad account `act_245452814746735` (currency **KES**); Page `112025595232098`; Graph `v21.0`.
- Netlify site `framework-nairobi` (framework.co.ke). Functions + Blobs available. `netlify.toml`
  already blocks `/docs` + `/scripts` and rewrites clean URLs.

## The runner
One `run.command` (lives in `/Users/ben/code/framework/mbs-scraper`, which becomes the ops
runner — rename later): **scrape → ads-sync → reconcile → brief.** Internally separate modules;
one dispatch. Dry-run default; `--commit` writes Airtable. Read-only against Meta (except WS4).

---

## WS1 — Core funnel + WhatsApp join  ⭐ build first
**Goal:** instrument the on-site funnel and deterministically join ad → session → WhatsApp
conversation. Starts real data flowing immediately (the dashboard needs weeks of it).

**1a. Client emitter** (extend `js/site.js`, all pages):
- On first load: mint `session_id` (persist in sessionStorage); read + store first-touch ad
  params from URL: `utm_source, utm_campaign, utm_content, ad_id, fbclid`, plus derived
  `device`, `in_app_browser` (fb/ig/none), `entry_type`.
- Emit checkpoint events via `navigator.sendBeacon('/api/track', …)` (non-blocking):
  - `arrive` (once) · `product_view` (lightbox open / `?config=` land; dims: product_id,
    view_source, +grid slot/scroll/hesitation) · `engage` (once, when 4+ distinct products
    OR designer entered) · `wa_handoff` (any WhatsApp CTA click; dims: handoff_source,
    handoff_depth, product_id, has_config, short_code).
- **Short code:** 6-char Crockford Base32, `crypto.getRandomValues`. On building a WhatsApp
  link, append `&r=<CODE>` to the product URL in the pre-filled message, and beacon the
  `code → {session_id, product_id, ad params, ts}` payload to `/api/track`.
- Reuse the reverted commit's good ideas (delegated capture-phase click listener; Android
  `intent://` deep link to skip the wa.me interstitial) — re-derive cleanly.
- **Guardrail:** must not regress the shipped WhatsApp pre-fill / Lead-Contact behavior
  (`scripts/test-whatsapp-links.js` must still pass; extend it).

**1b. Collector** (Netlify functions + Blobs):
- `POST /api/track` → append event to a **daily NDJSON blob** (`events/YYYY-MM-DD`); for code
  payloads, also write a blob keyed by code (`codes/<CODE>`). Validate shape; drop unknown.
- `GET /api/export?since=…&key=…` (shared-secret) → returns `wa_handoff` events + code
  payloads in range, for the reconciler. No PII present by construction.

**1c. Reconciliation** (module in the runner):
- Input: `Orders - Messages` rows needing attribution (new / unmatched) with `First Message
  Body`, `Last Contact`; + collector export.
- Match, strongest→weakest: **exact code** (`r=CODE` in First Message Body → code payload) →
  **product+time** (message names/links product X and a `wa_handoff` for X within window) →
  **template fingerprint** → suggestion-only. Safeguards: suggest only when exactly one
  candidate handoff in window; one-to-one; respect `Manual Match`.
- On match, write to the conversation: `Ref Code`, `Match Method`, `Match Confidence`, and set
  **existing** fields `Meta Ad ID` + `Ads - Meta` link + `Source Certainty = clear`. Optional
  `Site Journey` summary (products viewed, handoff_depth).
- Surface the scraper's `_AT` gap report + a reconciliation summary into the weekly brief.

**Airtable additions (WS1)** — confirm with Ben before creating (writes to production ERP):
`Orders - Messages`: `Ref Code` (text), `Match Method` (select: exact/product_time/template/
manual/none), `Match Confidence` (select: high/med/low), `Manual Match` (text override),
`Site Journey` (long text, optional).

**Acceptance tests:**
- A simulated ad click (`?config=…&utm_content=X&ad_id=Y`) → product_view → wa_handoff produces
  events in the lake and a `code → payload` entry.
- A conversation whose First Message Body contains `r=CODE` gets linked to ad `Y` deterministically,
  `Source Certainty=clear`, without touching human-curated fields.
- `test-whatsapp-links.js` passes; pre-fill + Lead/Contact unaffected.

**Not in scope:** clean `/d/CODE` routing (param `&r=` is enough); catalog shuffle events.

---

## WS2 — Ads-sync (read) + config lint + weekly brief  (high value; may run parallel to WS1)
**Goal:** mirror Meta into Airtable, compute the spend denominator, auto-catch misconfig, and
emit the AI-pasteable weekly brief. Uses the **read** token.

**2a. Sync** (module in the runner; upsert by Meta ID; idempotent; machine-owned fields only):
- Pull campaigns → ad sets → ads + creatives (`body`, `link`, `url_tags`, image/thumbnail,
  CTA) + insights (`spend`, `impressions`, `clicks`, `landing_page_view`,
  `offsite_conversion.fb_pixel_view_content`, `fb_pixel_lead`,
  `onsite_conversion.messaging_conversation_started_7d`, `messaging_first_reply`, depth_2/3/5,
  `frequency`) for 7d / 30d / lifetime + daily series.
- **New tables:** `Meta - Campaigns`, `Meta - Ad Sets` (id, name, status, objective/opt goal,
  budgets, targeting summary, hierarchy links, Last Synced).
- **Extend `Marketing - Ads`** (do NOT replace — its `Orders - Messages` link + clear/unclear
  attribution + revenue rollups are the crown jewels). Prefer writing **existing** fields
  (`Total Spend`, `Daily Spend`, `# Chats Started`, `Meta Ad ID`) before adding new ones; add
  stat/creative/flag fields only where none exists. Namespace new machine fields clearly.

**2b. Config lint** (per ad, into a `Config Flags` field + the brief):
- missing `url_tags` · destination not a catalog deep-link · **no catalog anchor** (ad promotes
  a product not in the live catalog — Ben's rule: only run ads with a catalog point) · Audience
  Network enabled · `frequency` > 3.5 (fatigue) · spend > 0 with zero conversations.

**2c. Weekly brief** (`data/brief-YYYY-MM-DD.md`, generated each run):
- Per active ad: creative summary (copy/image/destination), audience, placement mix, spend +
  funnel (Meta-side; joined with our funnel once WS1+WS3 land), conversation depth, flags.
- Plus: reconciliation summary + `_AT` gap. Designed to paste a card into an AI for "make a
  better variant."

**Airtable additions (WS2):** `Meta - Campaigns`, `Meta - Ad Sets` tables; `Marketing - Ads`
stat/creative/`Config Flags` fields (only those without an existing home). Confirm with Ben.

**Acceptance tests:** brief generates; `Marketing - Ads` shows current spend from Meta; a known
misconfig (e.g., an ad with no `url_tags`) is flagged; re-running is idempotent (no dupes).

---

## WS3 — Dashboard  (after WS1 has ≥ a few weeks of data)
**Goal:** the monitoring instrument. Static page, self-contained, reading a generated data JSON
(collector aggregates + Airtable outcomes + Meta spend). **Auth:** a Netlify-function gate with a
secret key in a bookmarkable URL (option (a)); never open on the public domain.

**Three views, nothing more:**
1. **Monthly cohort stacked funnel bar** (x = month-of-click; segments = C1 arrive → C2 product
   view → C3 engage → C4 handoff → C5 conversation → C6 quote → C7 sale + revenue). Filterable to
   a single ad/campaign. + cost-per-stage using Meta spend.
2. **Per-ad economics table** (current period): spend, funnel counts, conversations, convo-depth,
   cost per outcome, flags — the weekly reallocation view. (Also pushed into `Marketing - Ads`.)
3. **Experiment timeline** (from the ledger, if used) — dated markers over view 1.

**Hypothesis ledger (low priority, "worth a try"):** tiny Airtable table `Marketing -
Experiments` (Date, Hypothesis, Change, Metric to watch, Review date, Verdict, optional Ad/Campaign
link). Dashboard overlays markers. Build last; droppable.

**Acceptance tests:** stacked bar renders real ≥1-month funnel; filter-by-ad works; unauthenticated
request is blocked; per-ad table matches Meta spend + our funnel counts.

---

## WS4 — Ad hygiene / creation automation  🅿️ PARKED (designed; page asset now assigned so unblocked)
Uses the **full** token. **Never** in scope until WS1–3 ship and Ben green-lights.
- **Level 0 lint** already delivered in WS2.
- **Level 1 born-correct creation:** input = DAM image(s) + product id → upload image → creative
  with templated copy, canonical catalog deep-link, full `url_tags` → ad created **PAUSED** in a
  chosen ad set, named to convention. Ben reviews in Ads Manager and activates.
- **Guardrails:** PAUSED-only; never change budgets/targeting/status of anything live; dry-run
  default; every change logged. (Creatives are immutable — born-correct avoids retrofitting.)
- **Level ∞ (never):** auto-budget, auto-activation. Human stays on the money.

---

## Parked backlog 🅿️ (documented in strategy.md; not now)
Meta offline-conversions upload (sales → Meta, matched by phone+fbclid) · catalog optimisation
(per-session shuffle + impression logging + human ranking) · deep-path "customize" flow · Track D
3D engine · CAPI (pixel dedup) · catalog-feed sync via `catalog_management` · clean `/d/:code` +
`/shelf/:slug` routing.

## Build order
WS1 (start data flowing) → WS2 (parallel-capable) → WS3 (once data exists) → WS4 (parked) →
backlog. Each workstream: dry-run/verify before `--commit`; extend `scripts/test-*.js` as guards.

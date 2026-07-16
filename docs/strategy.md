# Framework Site — Growth & Measurement Strategy

**Status:** 🚧 Context/why doc. Direction locked. **The actionable work order for building
is [`docs/build-spec.md`](build-spec.md)** — read this for strategy, that for what to build.

**Last worked:** 2026-07-15 · **Owner:** Ben · **Collaborator:** Claude (this thread)

Tags: 🟢 DECIDED · 🔵 OPEN · 🟡 PROPOSED (leaning) · 🅿️ PARKED (documented, not now)

---

## Part 1 — Plain-language overview

### The problem
Meta ads report lots of "website leads," but very few real WhatsApp conversations and
~1–2 sales/week result. The funnel is **severed at the WhatsApp boundary**: we see clicks
on the site, and we see conversations/orders in Airtable, but nothing connects the two —
so we can't tell which ads/products actually produce sales, or a serious lead from a
button-masher.

### The vision
The website is a **showroom + qualifier**, not a checkout (Kenyan buyers want the human
WhatsApp close to build trust). Its job: turn an ad click into **product-specific intent**,
capture **how deep** that intent goes, hand off to WhatsApp **warm + tagged**. Around it,
**one measurement spine we own** so decisions come from data we control.

Success is not technical — it's that two habits survive six months:
- **Weekly (~15 min):** reallocate ad budget by cost-per-outcome per ad.
- **Monthly:** read the funnel, form *one* hypothesis, make *one* change, measure next month.

### THE FOCUS (agreed 2026-07-15)
**v1 = see the funnel + connect ad → site → WhatsApp → outcome, stably.** Everything else is
explicitly **parked** (see backlog) until v1 is live and read. This scope cut is deliberate.

### Decisions locked 🟢
- 🟢 **Netlify migration — DONE & LIVE** (framework.co.ke on Netlify, Let's Encrypt TLS, apex+www).
- 🟢 Measurement = **stable checkpoints (customer milestones), never scroll % / page mechanics.**
  Branches = **dimensions on events**, not extra stages.
- 🟢 **C3 "Engaged" = viewed 4+ products OR entered the designer.**
- 🟢 Keep the **WhatsApp human close**; no on-site checkout/payment.
- 🟢 **Keep Airtable as the business system-of-record — do NOT move off it.** It's effectively
  an ERP (27 tables: orders, production, inventory, deliveries, marketing attribution). See Part 3.
- 🟢 **Do not build parallel attribution — upgrade Airtable's existing one.** AT already links
  conversations→ads→orders with "clear/unclear attribution" + CAC + revenue rollups. Our ref
  code makes the ad→conversation link *deterministic* (turns "unclear" into "clear").
- 🟢 **Event lake (Netlify Blobs + CSV backup)** holds the high-volume on-site events — the ONE
  thing Airtable can't hold. Events never enter Airtable; only a per-conversation *summary* does.
- 🟢 Join the WhatsApp boundary with a **short code** carried in the product link; **time-based
  matching is in v1** as the fallback to exact-code.
- 🟢 **Reconciliation runs inside a single entry point** (one `run.command` / Claude-dispatched),
  alongside the scraper — Ben never uses the terminal, so one command matters more than code split.
- 🟢 Keep Meta pixel + GA4 as-is; our layer is the **join hub**, not a replacement.
- 🟢 **Ads-sync via Meta Marketing API (read-only)** is a **fast-follow workstream** — provides
  spend (powers the weekly reallocation), auto-maintains the Ads table, gives real ad IDs. Token
  being obtained now (docs/meta-api-setup.md).

### Still open 🔵
- 🔵 Exact Airtable field additions (after schema review — see Part 3) + which existing fields to write.
- 🔵 Where per-ad funnel aggregates land: pushed into `Marketing - Ads` (native) + a small dashboard page. (Leaning both.)
- 🔵 Short-code link form for v1: `?...&r=CODE` now vs `/d/CODE` clean path later.
- 🔵 Ads-table hierarchy: mirror Meta campaign→adset→ad (extend `Marketing - Campaigns` + add Ad Sets) vs ad-level with attributes.
- 🔵 Reconciliation home: folded into mbs-scraper run vs a sibling job (both local, single dispatch).

### Parked backlog 🅿️ (good ideas, not now — do not lose)
- 🅿️ **Meta offline-conversions upload** (Airtable sale outcomes → Meta "Manual WhatsApp
  Conversions" offline set `26166769913015126`, matched by phone + fbclid). The rail already
  exists in the ad's tracking. Interim = manual CSV upload; later = automated. This is the
  eventual "Meta optimizes toward real sales" mechanism.
- 🅿️ **Catalog optimisation** — per-session shuffle + impression logging + human ranking (Part 5).
- 🅿️ **Deep-path "customize this product" flow** — waits for Track D.
- 🅿️ **Track D — new 3D designer engine** (`/Users/ben/code/framework/image-generator`).
- 🅿️ **CAPI (browser pixel dedup)**, catalog slug routing `/shelf/:slug`, clean `/d/:code` resolver.

---

## Part 2 — The measurement model

### Checkpoints — two views, lean & stable
Branches are **dimensions on events, not new stages.**

**View A — depth funnel (redesign-stable; the "how far do they get" stacked bar):**

| ID | Milestone (monotonic) |
|---|---|
| C1 | Arrived (ad-attributed) |
| C2 | Saw a product (lightbox open or `?config=` deep-link landing) |
| C3 | Engaged (**4+ products** OR entered the designer) |

**View B — handoff & outcome, sliced by depth:**

| ID | Milestone | Source |
|---|---|---|
| C4 | Handed off to WhatsApp (also captures "clicked but didn't send") | site event |
| C5 | Conversation (message arrived) | **Airtable** (scraper-fed), joined by code/time |
| C6 | Quoted | Airtable |
| C7 | Sale (+ value) | Airtable |

Key attribute **`handoff_depth`** on C4 = highest engagement reached before leaving.
**Payoff metric:** conversion rate (C5/C6/C7) *by* `handoff_depth` — proves whether depth
is worth pushing. Diagnostics (scroll depth, INP, dead clicks) explain *why* a checkpoint
moved; never KPIs. Dashboard unit = monthly **cohort by click date**.

**Stability rule:** to change a checkpoint definition, **version it (`C3v2`) + date it here.**

### Event schema 🟢 (finalized names)
Six events, snake_case, chosen to avoid GA4 reserved-name collisions. Every event carries
`session_id` + `ts`; server enriches `received_at`, country, UA.

| Event | Checkpoint | Key dimensions |
|---|---|---|
| `arrive` | C1 | `entry_type` (home/catalog/product_deeplink), `ad_source` (utm_source), `utm_campaign`, `utm_content`, `ad_id` ({{ad.id}}), `fbclid`, `device`, `in_app_browser` (fb/ig/none) |
| `product_view` | C2 (+ catalog "open") | `product_id`, `view_source` (grid/featured/deeplink/next_nav); if grid/featured also `slot`, `scroll_depth`, `impressions_before`, `ms_since_impression` |
| `engage` | C3 | `engaged_via` (multi_product/designer), `products_viewed_count` — fired once on threshold |
| `wa_handoff` | C4 | `handoff_source` (fab/lightbox_order/lightbox_customize/guidance/header/footer), **`handoff_depth`** (arrived/product_viewed/engaged), `product_id`, `has_config`, `short_code` |
| `product_impression` | catalog (🅿️) | `product_id`, `slot`, `scroll_depth` |
| `catalog_render` | catalog (🅿️) | `catalog_version`, `ordered_product_ids` (slot=index) |

Session-level ad attributes captured once on `arrive`, joined by `session_id` (kept off other
events). C5–C7 come from Airtable, joined by `short_code` (or time fallback).

### The three codes 🟢
1. **Ad code** — in landing URL: `utm_content` (ad name) + **`ad_id`** ({{ad.id}} → deterministic
   link to the AT Ads table) + **`fbclid`** (click id; parked offline-upload key).
2. **Session ID** — minted on landing, persists, stamped on every event.
3. **Handoff short code** — **6-char Crockford Base32, uppercase** (no I/L/O/U; ~1B combos;
   generated client-side via `crypto.getRandomValues`; payload sent fire-and-forget via
   `sendBeacon` so the WhatsApp click never blocks). Resolves to `{session, product, ad, click_date, design_payload}`.
   - **v1 link form:** `…/shelving.html?config=lantern-shelf&r=AB12CD` (works immediately, no resolver).
   - **later 🅿️:** clean `…/d/AB12CD` + `/shelf/:slug` once the resolver exists.

### Meta ad URL conventions 🟢
Website-objective ads → destination = product deep-link `…/shelving.html?config=<id>` (brand
ads → base `…/shelving.html`). **URL parameters field:**
```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&ad_id={{ad.id}}
```
`{{…}}` are Meta dynamic tokens; `fbclid` auto-appends. Only dependency: consistent ad naming.

---

## Part 3 — Data architecture (the important reframe)

**Airtable is an ERP, not a message log** — 27 tables across Orders → Production → Inventory →
Deliveries → Marketing, with a **mature attribution model already built**:
- `Orders - Messages` (conversations, scraper-fed) links to `Ads - Meta` → `Marketing - Ads`,
  has `Meta Ad ID`, `Lead Source`, `Source Certainty`, `Segments`, `Orders` → `Orders - Pipeline`,
  `First Message Body`, `Last Contact`, `First Conversion Date`, `Blended CAC`.
- `Marketing - Ads` (30 fields): spend, dates, `# Chats Started`, and rollups
  **Converted/Qualified – Clear vs Unclear Attribution**, **Total Client Revenue – Clear/Unclear**.
- `Orders - Pipeline`: Line Items, Deliveries, Production QC, `Total Revenue`, Client.

**The reframe:** we are NOT building parallel attribution — we **upgrade the existing one**.

| Data | Home | Why |
|---|---|---|
| On-site events C1–C4 (high volume) | **Event lake (Blobs)** | The only thing AT can't hold (thousands/wk; AT record caps + 5 writes/sec) |
| Ad → conversation link | **AT existing fields** (`Meta Ad ID`, `Ads - Meta`), set deterministically by us | Upgrade "unclear"→"clear", don't duplicate |
| Conversation → order → revenue | **AT (unchanged)** | Already fully modeled |
| Per-ad funnel + outcomes | **AT `Marketing - Ads`** (+ we push funnel-middle aggregates) + dashboard page | One native per-ad funnel view |

**The dance is minimal & one-directional:** event lake distills a verdict → writes a small
summary onto the conversation record (likely new fields: `Ref Code`, `Match Confidence`,
`Manual Match`; existing: set `Meta Ad ID`/`Ads - Meta`, `Source Certainty=clear`). Events never
enter AT. Optionally push per-ad aggregates (sessions/views/handoffs) into `Marketing - Ads` (one
write per ad).

**Guardrails against mess:**
1. Events never enter Airtable.
2. Every fact has one home — no dual truth. Attribution fields written by a **single writer**
   (reconciliation), idempotent, **never clobbering human curation** (respects `Manual Match`).
3. One join key (short code) end to end.
4. One run entry point.

**Move off Airtable? No** — it's the business brain; moving = rebuild the ERP. Bar not met.

---

## Part 4 — The WhatsApp join (with the scraper)

**mbs-scraper** (`/Users/ben/code/framework/mbs-scraper`) scrapes the Meta Business Suite inbox
(incl. WhatsApp) from Ben's logged-in Chrome and writes CRM fields into the **same Airtable base**.
Per thread: `messages[]` (text, direction, per-message timestamp, attachments), participant name,
customer **phone/email**. Maintains `First Message Body`, `Last Contact`, `Chat Link`, `Status`.

**This automates the inbound side of the join:**
- Our ref code rides in the product URL in the pre-filled message → lands in `First Message Body`
  → reconciliation extracts `r=CODE` → **exact, automatic join** (no manual paste).
- **"Message can't be displayed" only happens for CTWA/ad-direct messages, NOT wa.me links** —
  so website handoffs arrive as real text with the code intact. (Confirmed by Ben.)
- **Time-based matching (v1 fallback):** scraped first-inbound `timestamp` (+ product/template)
  vs our `wa_handoff` timestamps.

**Matching, strongest → weakest:**
1. **Exact code** in `First Message Body` → deterministic.
2. **Product + time** — message names/links product X and a `wa_handoff` for X within window.
3. **Template fingerprint** — matches our pre-fill shape ⇒ site-originated; free-form ⇒ likely
   organic, **don't force a match** (false-positive guard).
4. **Time-only** → suggestion Ben confirms; never silent auto-join.

Safeguards: suggest only when **exactly one** candidate handoff in the window (low concurrency
helps); one-to-one; a **`Manual Match`** Airtable field for human override. Constraints from the
scraper: timestamps approximate (minute, TZ — Ben can fix TZ), unread convos skipped, manual/
irregular runs → **join is eventually-consistent, not real-time (fine)**; v1 must not hard-depend
on the scraper — the ref-code-in-URL is the robust primary.

**Reconciliation** = a module in the single run: *scrape → fetch site events (collector API) →
match → write attribution onto AT conversations*. One `run.command`.

---

## Part 5 — Parked designs (keep, don't build yet)

### Catalog optimisation 🅿️
Full **per-session shuffle** to de-bias position; **collect raw, never auto-weight**; human
monthly ranking on a long window. Events: `catalog_render` (once/session, ordered ids),
`product_impression` (viewport), `product_open` (=`product_view` from grid, with slot/scroll/
hesitation). Later → position-controlled opens & sales per product. Log `catalog_render` once per
session (not per-product-per-view; else ~64k rows/wk).

### Deepening on-site experience 🅿️ (waits for Track D)
Two paths: **fast** (catalog → product → WhatsApp) and **deep** (→ "customize" → designer + live
price → WhatsApp with full config). Push more into deep (qualifies the lead, richer message).
**Guardrail:** maximise *qualified handoffs*, not customization — watch C4 rate while growing C3.

### Track D — 3D engine migration 🅿️
Replace designer with the engine at `/Users/ben/code/framework/image-generator` (one engine,
simplified + advanced UIs). **Mobile-viability bar** (low Kenya-realistic device: ~2GB RAM, entry
SoC Unisoc T606 / Helio G36, Android 13, weak GPU, ~390px; primary env = FB in-app WebView):
1. Interactive ≤6–8s on throttled 4G, cold cache. 2. ~24–30fps during orbit/drag. 3. Reliable
WebView touch. 4. No crash/reload over 3–5 min (2GB OOM). 5. Full path config→code→WhatsApp.
Claude does emulated first-pass; **real budget phone is the true gate.** Must emit a payload
compatible with the engine-agnostic short-code store.

### Meta offline-conversions upload 🅿️
Push closed sales (Airtable) → Meta offline set "Manual WhatsApp Conversions"
(`26166769913015126`), matched by **phone (+ fbclid)**. Interim manual CSV; later automated.
The "Meta optimizes toward real sales" endgame (needs ~50 conv/wk to actually optimize).

---

## Part 6 — Roadmap & workstreams

### Core funnel (v1) — the focus
- **Phase 0 — Netlify migration 🟢 DONE.** Live on framework.co.ke, TLS issued.
- **Phase 1 — Measurement 🔵.** Collector (`/api/track` → Blobs + CSV); client checkpoint emitter
  (`arrive`/`product_view`/`engage`/`wa_handoff` + dimensions); short-code mint + embed in
  WhatsApp links; reconciliation (exact code → time/product) writing attribution into Airtable;
  Airtable field additions (after schema review). Built behind a Netlify **deploy preview**.
- **Phase 2 — Dashboard 🔵.** `metrics.html` monthly cohort stacked bars (event lake + Airtable);
  per-ad aggregates pushed into `Marketing - Ads`.

### Ads-sync (fast-follow, parallel)
Meta Marketing API (read-only, `ads_read`) → maintain `Marketing - Ads` (campaign/adset/ad,
status, **spend**) → powers cost-per-outcome for the weekly reallocation; supplies real ad IDs for
the deterministic join. Token setup: docs/meta-api-setup.md. Reusable for the parked offline-upload.

### Parked 🅿️
Catalog optimisation · deep-path flow · Track D · offline-upload · CAPI · clean short-code routing.

---

## Part 7 — Technical appendix (handoff)

### Current architecture (as-is, 2026-07-15)
- Static HTML + vanilla JS; `js/site.js` injects header/footer + tracking helpers.
- Designer/sandbox use **in-browser Babel** (no build): `js/designer.jsx`, `sandbox.html`.
- **Hosting: Netlify** (site `framework-nairobi`), repo `benjaminhoyle/framework-site`, DNS at
  Cloudflare (**grey-cloud / DNS-only** CNAMEs → `framework-nairobi.netlify.app`; MX=Zoho intact).
  `netlify.toml`: publish root, clean-URL rewrites, `/docs` + `/scripts` blocked, `404.html`.
  GitHub Pages still up as fallback — decommission after a clean day or two.
- Analytics: Meta Pixel `1492649948884685`, GA4/gtag, Google Ads conversions, Clarity.
- WhatsApp taxonomy (live, `4ebc132`): `Lead` = product order/customise (with value); `Contact`
  = generic chat (centralised in `trackContactConversion`); no `InitiateCheckout`. Links pre-filled;
  guarded by `scripts/test-whatsapp-links.js`.

### Airtable base (`appOTj9wLzFwbQUZj`) — key tables for the join
- **`Orders - Messages`** `tblRVeTjLV1xdcDfy` — conversations. Has: `Ads - Meta`→`Marketing - Ads`,
  `Meta Ad ID`, `Lead Source`, `Source Certainty`, `Segments`, `Orders`→Pipeline, `First Message
  Body`, `Last Contact`, `Status`, `First Conversion Date`, `Blended CAC`.
- **`Marketing - Ads`** `tblHCHkv8gRjXafkC` — `Meta Ad ID`, spend, dates, `# Chats Started`,
  clear/unclear attribution + revenue rollups.
- **`Orders - Pipeline`** `tblytDBTVFWFyP2qc` — orders; Line Items, Deliveries, Total Revenue, Client.
- Others: Line Items `tbldzNLAqG6d98eir`, Deliveries `tbl1nrxFKumpCm7Qa`, Products `tblyL6ldOJm94uSGa`,
  Clients `tblXu0CYFzDsJSOAt`, + Production/Inventory/Marketing clusters (27 total).
- Token: `/Users/ben/code/framework/airtable-api.txt` (outside repo; read via file, never echoed).

### Meta Ads (for Ads-sync)
- Account `act_245452814746735` — "Main Framework Ad Account", currency **KES**, active.
  Page `112025595232098` ("Framework Designs", assigned to the system user). Graph `v21.0`.
- Tokens (files outside repo, read-never-echo): read-only `meta-ads-read-api.txt` (use for
  sync — least privilege); full `meta-ads-full-api.txt` (`ads_management`+`catalog_management`
  +`pages_manage_ads`; WS4 ad-creation only). Both **verified working 2026-07-15**.
- Active campaigns: `Website Leads | 2026-07`, `WA Messages | 2026-04` (CTWA benchmark already
  running). `Website Sales [no sell event from site]` paused — offline-upload (🅿️) fixes that.
- **API capabilities probed & confirmed:** full hierarchy + configs + targeting; full creatives
  (copy/image/link/`url_tags`); rich per-ad action inventory incl. our pixel events + **CTWA
  conversation depth** (`messaging_first_reply`, `..._depth_2/3/5_message_send`) = a per-ad
  seriousness metric; breakdowns (placement/age/region) + daily series. Creatives are immutable
  (edits = new creative + swap). ~4 calls/run; rate limits a non-issue.

### 🚨 KEY FINDING (2026-07-15) — the "leads but no messages" cause, quantified
Placement breakdown (30d): **Audience Network = 42% of spend (KES ~12.2k), 82 pixel "Leads",
ZERO conversations.** AN is off-platform junk inventory; optimizing on the pixel `Lead` event let
Meta shovel budget to the cheapest (junk) Lead fires. **All 35 real conversations came from
FB/IG feed/stories/reels.** → Ben excluded Audience Network (2026-07-15). Also found: active
website ads had **no `url_tags`** (our utm/ad_id convention not wired Meta-side yet), and some ads
link to bare `shelving.html` not a product deep-link. **Ad convention adopted: only run ads that
point to a product in the live catalog.** These become the WS2 config-lint checks.

### Dashboard (WS3) — the monitoring instrument
Rule: Meta's UI answers "how do ads perform in Meta's world" (never rebuild that); ours answers
what Meta can't — the funnel across the WhatsApp cut + spend denominator. Two views: (1)
**monthly cohort stacked funnel bar** (spend→C1→…→C7+revenue, filterable to an ad/campaign) —
the goal-monitoring chart, redesign-proof by construction; (2) per-ad economics table
(reallocation view; also pushed into `Marketing - Ads`). Auth = Netlify-function gate + secret
key in a bookmarkable URL. **Hypothesis ledger — considered, dropped (2026-07-16):** not worth
the added surface right now.

### Event lake / stores 🔵
`/api/track` Netlify Function → **Netlify Blobs** (events + `code → payload`); scheduled CSV export.
Reconciliation reads the lake via a collector export endpoint (keyed) + Airtable API.

### Testing conventions
Node CommonJS tests run directly (`node scripts/test-*.js`); assert + success line. Extend
`test-whatsapp-links.js` as the link/handoff guardrail.

### Repo & external pointers
- `js/site.js`, `shelving.html` (catalog + lightbox + `?config=` auto-open), `js/designer.jsx`,
  `simplified-designer.html`, `sandbox.html`, `AGENTS.md`, `netlify.toml`, `404.html`.
- `docs/netlify-migration.md`, `docs/meta-api-setup.md`.
- `/Users/ben/code/framework/image-generator` (Track D engine),
  `/Users/ben/code/framework/mbs-scraper` (inbox scraper → Airtable).

---

## Part 8 — Decision log & open questions

### Decision log
- 2026-07-06 — Pre-filled WhatsApp messages + Lead/Contact taxonomy shipped (`4ebc132`, live).
- 2026-07-12 — Checkpoints-not-scroll% (View A/B + `handoff_depth`); C3=4+/designer; short-code
  join + layered matching; Blobs+CSV; catalog shuffle design; Track D bar. Reverted funnel commit.
- 2026-07-15 — **Netlify migration completed & live.** Scope cut to **v1 = funnel + join**, rest
  parked. Finalized event schema names + 6-char Crockford short code + URL params (with `ad_id`).
  **Airtable found to be a full ERP with existing attribution → keep it, upgrade its attribution,
  event lake alongside; write into existing AT fields.** Reconciliation in single run.command with
  the scraper; time-based matching in v1; manual-match override. Offline-upload rail discovered
  (parked). Ads-sync via Meta Marketing API adopted as fast-follow; **read-only token obtained &
  verified** (act_245452814746735, KES).
- 2026-07-15 (later) — **Meta API deep-dive.** Found & fixed the **Audience Network junk-lead
  drain** (42% of spend, 0 convos → AN excluded). Probed full read + write capability (write token
  + Page assigned). Adopted: config-lint (WS2), "catalog-anchored ads only" convention, the
  weekly AI-pasteable brief, dashboard 3-view design + signed-URL auth, ad-creation automation as
  parked-but-designed WS4 (born-correct/PAUSED-only). **Split docs: strategy.md (why) +
  build-spec.md (work order).**
- 2026-07-16 — **Approved & sealed for handoff:** WS1 + WS2 Airtable field additions approved
  (build directly, no further confirmation needed); hypothesis ledger dropped from WS3 (two
  views only). Ben hands off to a fresh builder session from here.

### Remaining open questions
1. Exact Airtable field additions + which existing fields reconciliation writes (post schema-review).
2. Per-ad aggregates: push into `Marketing - Ads` + dashboard page? (leaning both.)
3. v1 short-code link form: `?r=CODE` now vs `/d/CODE` later.
4. Ads-table hierarchy: mirror campaign→adset→ad vs ad-level attributes.
5. Reconciliation home: inside mbs-scraper vs sibling local job.
6. Track D real-device test once integration-ready; deep-path flow design (with Track D).

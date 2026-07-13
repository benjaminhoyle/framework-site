# Framework Site — Growth & Measurement Strategy

**Status:** 🚧 Working doc, actively being shaped. Most direction is now locked; a
handful of implementation specifics remain open (see 🔵). Safe to pick up cold.

**Last worked:** 2026-07-12 · **Owner:** Ben · **Collaborator:** Claude (this thread)

Tags: 🟢 DECIDED · 🔵 OPEN · 🟡 PROPOSED (leaning, not locked)

---

## Part 1 — The plain-language version

### The problem
Meta ads report lots of "website leads," but very few real WhatsApp conversations
and ~1–2 sales/week actually result. The funnel is **severed at the WhatsApp
boundary**: we can see clicks on the site, and we see conversations in Airtable,
but nothing connects the two — so we can't tell which ads/products actually produce
sales, and we can't tell a serious lead from a button-masher.

### The vision
The website is a **showroom + qualifier**, not a checkout. Full ecommerce is wrong
for this market — Kenyan buyers want the human WhatsApp close to build trust. So the
site's job is narrow: turn an ad click into **product-specific intent**, capture
**how deep** that intent goes, then hand off to WhatsApp **warm** and **tagged**.
Around it we build **one measurement spine we own**, so decisions come from data we
control rather than Meta's black box.

Success is not technical. It's that two lightweight habits survive six months:
- **Weekly (~15 min):** reallocate ad budget by quote-rate-per-ad (from Airtable).
  Viability boosted by the in-progress [mbs-scraper](/Users/ben/code/framework/mbs-scraper),
  which could make this semi-automatic.
- **Monthly:** read the funnel, form *one* hypothesis, make *one* change, measure next month.

### The plan at a glance
0. **Migrate to Netlify** (foundation & hard prerequisite for the owned collector).
1. **Measurement** — stable checkpoints + join codes into WhatsApp + Airtable outcomes.
2. **Own the record** — first-party collector (Netlify Blobs + CSV backup) + dashboard + catalog experiments.
3. **Close the loop** — CAPI + push Airtable outcomes back to Meta.
- **Track D. Designer/3D-engine migration** — parallel, its own testing, must not block 0–3.

### Decisions locked 🟢
- 🟢 **Full Netlify migration**, done **first** — it's a prerequisite because measurement
  is built directly on the Netlify collector (not GA4-first). Also fixes the stuck TLS cert.
- 🟢 Measurement = **stable checkpoints (customer milestones), never scroll % / page mechanics.**
  Branches live as **dimensions on events**, not as extra stages (see Part 2).
- 🟢 **C3 "Engaged" = viewed 4+ products OR entered the designer.**
- 🟢 Keep the **WhatsApp human close**; no on-site checkout/payment.
- 🟢 Join the WhatsApp boundary with a **short code embedded in the product link** in the
  pre-filled message; code resolves server-side to a Netlify Blob holding the full payload.
- 🟢 **Codeless fallback = layered matching** (product+time, template fingerprint), surfaced
  as a confidence-scored *suggestion* Ben confirms — never a silent auto-join (Part 2).
- 🟢 Airtable is bottom-funnel truth; copy first message **verbatim** + capture its **timestamp**.
- 🟢 Event store = **Netlify Blobs + robust CSV export backup.**
- 🟢 Keep Meta pixel + GA4 as-is; our layer is the **join hub**, not a replacement.
- 🟢 **Catalog: full per-session shuffle** to de-bias position; log rich raw events; **never
  auto-weight** — human-in-the-loop ranking, long accumulation window (Part 3).
- 🟢 **Deep-path "customize" flow waits for the new 3D engine** (Track D); don't build it twice.
- 🟢 Weekly reallocation cadence is the planning assumption (enabled by the mbs-scraper).
- 🟢 The parked "funnel measurement" commit was **reverted** (2026-07-12); rebuild clean.

### Still open 🔵 (implementation specifics)
- 🔵 Literal event/dimension **names** in the schema (Part 6 draft).
- 🔵 Exact short-code alphabet/length + slug routing rules.
- 🔵 Which catalog surface(s) shuffle (grid + featured grid; entry product fixed) — nail in Phase 2.
- 🔵 The concrete "customize this product" flow — with Track D.
- 🔵 Netlify step-by-step (DNS, redirects, functions) — I write it, Ben executes.
- 🔵 Catalog volume-management (how long to accumulate before first ranking pass).

---

## Part 2 — The measurement model

### Division of labour (how we avoid duplicate infra)
| System | Owner | Purpose | We touch? |
|---|---|---|---|
| Meta Pixel | Meta | Ad optimisation & Meta's attribution | Keep as-is; don't mirror it |
| GA4 | Google | Standard web analytics, free | Keep |
| **First-party layer** | **Us** | **The join** (ad → checkpoints → WhatsApp → Airtable) + owned raw rows + product-level data we define | Build (Phase 2) |

**Rule to prevent a second Google Analytics:** log something in our own store only if
we need to *join* it or *own* it. Log the checkpoints + dimensions + product events +
the join id — not a full clickstream we'll never read.

### Checkpoints — two views, lean & stable

Branches are **dimensions on events, not new stages.** Keeps the funnel clean while
capturing all the richness.

**View A — depth funnel (redesign-stable; the "how far do they get" stacked bar):**

| ID | Milestone (monotonic) |
|---|---|
| C1 | Arrived (ad-attributed) |
| C2 | Saw a product (lightbox open or `?config=` deep-link landing) |
| C3 | Engaged (**4+ products** OR entered the designer) |

**View B — handoff & outcome, sliced by depth:**

| ID | Milestone | Source |
|---|---|---|
| C4 | Handed off to WhatsApp (also captures "clicked but didn't send") | site event + Meta Lead/Contact |
| C5 | Conversation (message actually arrived) | **Airtable**, joined by code/match |
| C6 | Quoted | Airtable |
| C7 | Sale (+ value) | Airtable |

The key attribute is **`handoff_depth`** on C4 = highest engagement reached before
leaving. It answers Ben's branch question directly: a floating-button tap with no
browsing is `handoff_depth=arrived` (shallow); a post-designer handoff is
`handoff_depth=engaged` (qualified). **The payoff metric:** conversion rate
(C5/C6/C7) *by* `handoff_depth` — proves whether depth is worth pushing, or kills the
deep-path thesis. Don't guess; measure it.

**Dimensions to capture (not stages):**
- On **C1:** source (ad/organic), ad id (`utm_content`), **`fbclid`**, entry_type (home / catalog grid / product deep-link).
- On **C2:** product_id, where-seen (grid / featured / deep-link / next-nav).
- On **C4:** handoff_source (fab / lightbox_order / lightbox_customize / guidance / header / footer), handoff_depth, product_id, has_config.

**Diagnostics (NOT KPIs):** scroll depth, tap maps, INP, dead clicks — explain *why* a
checkpoint moved; never tracked as goals.

**Dashboard unit:** monthly **cohort by click date** (a sale on Aug 12 from a Jul 28
click belongs to July). The code carries click date → automatic cohorting.

**Stability rule:** if a checkpoint definition must change, **version it (`C3v2`) and
date it here** — never silently redefine.

### The codes (three of them)
1. **Ad code** — arrives in the landing URL: `utm_content` (which ad) + **`fbclid`**
   (which click; Meta appends it; also the CAPI-loop key). Captured at C1.
2. **Session ID** — minted on landing, persists across navigation, stamped on every
   checkpoint event.
3. **Handoff short code** — minted when we build a WhatsApp link; embedded in the product
   URL (`framework.co.ke/d/AB12CD`). Resolves via Netlify Blob to
   `{ session, product, ad, click_date, design_payload }`. "Embed the code" = "embed the
   session join." Opaque + engine-agnostic, so Track D can change design format freely.

### The WhatsApp join — layered matching (strongest → weakest)
The code is embedded in the URL — the most-likely-retained part of the message. But
clients sometimes delete it, so:

1. **Exact code** in the message → deterministic join. Primary.
2. **Product + time** — message names/links product X **and** a C4 handoff for product X
   occurred within N minutes. Product hugely narrows the field.
3. **Template fingerprint** — our pre-fill has a distinctive shape; a match ⇒ almost
   certainly site-originated (high confidence even codeless). A free-form message
   ("hi, do you make shelves?") ⇒ probably organic, **do not force a site match** (main
   false-positive guard).
4. **Time-only** — last resort; only ever a *suggestion Ben confirms*, never auto-join.

Safeguards: (a) auto-suggest only when **exactly one** candidate handoff sits in the
window — Ben's low concurrency usually makes this true (the thin volume that hurts
catalog stats *helps* matching); (b) one-to-one — a claimed session leaves the pool.
Output: a **confidence-scored suggestion** in the Airtable logging flow. Requires
logging the **message timestamp** in Airtable.

### Links & codes design
- **Catalog products → human slugs** (`/shelf/lantern-shelf`): static, SEO/trust, no storage.
- **User-generated designs → minted short codes** (`/d/AB12CD`): Blob maps
  `code → { payload, sessionId, createdAt, adSource }`. The code is the join key.
- Replaces today's brittle `?config=<long-hash>` URLs.

---

## Part 3 — Catalog optimisation (data-driven content ranking)

Goal: Ben has a strong content pipeline and wants data to up/downgrade products.

**Method 🟢:** full **per-session shuffle** of catalog order to de-bias position (per
*session*, not per load). **Collect raw only; never auto-weight** — rank
human-in-the-loop, monthly, on a long accumulation window. Big winners/losers surface
in weeks; fine distinctions never will at this volume, and that's fine. Because ads
increasingly deep-link to a specific product, shuffling the grid costs little
conversion while buying clean data.

**Raw events (compute scores later):**
- **`catalog_render`** — once per catalog view: `{session, catalog_version, ordered_product_ids}`
  (slot = index). Gives *how many visits each product was live for, and where it sat* →
  fair weighting of new products.
- **`product_impression`** — IntersectionObserver: `{session, product_id, slot, scroll_depth_at_impression}`.
- **`product_open`** — `{session, product_id, slot, scroll_depth_at_click, time_since_impression, impressions_before_open}`.

From these, later, any score: view→click rate, position-adjusted CTR, depth-adjusted,
hesitation, "scrolled past N times." And since `product_id` flows onto C4/C7, the real
prize: **opens and sales per product per impression, position-controlled.**

**Efficiency:** log `catalog_render` once per session as a compact ordered list, not one
row per product per view (else ~64k rows/week just for slots).

---

## Part 4 — Deepening the on-site experience

Capture more **quality signal in the measurable zone** before the brittle handoff. Two
paths, both kept:
- **Fast path** (decisive buyer): catalog → open product → order on WhatsApp. Frictionless.
- **Deep path** (needs to shape it): catalog → open product → "customize this" → designer
  (size/colour/modules + live price) → order on WhatsApp **with full config**.

Push *more* people down the deep path: qualifies the lead (C3), richer WhatsApp message,
closes better. **Guardrail:** goal is max *qualified handoffs*, not max customization —
adding steps can shrink total handoffs, so watch C4 handoff-rate while growing C3.

🟢 The concrete flow **waits for Track D** (new 3D engine); design it once, around the new engine.

---

## Part 5 — Phased roadmap

### Phase 0 — Netlify migration 🟢 decided · **do first** · not started
- **Goal:** foundation & prerequisite for the owned collector; fixes stuck TLS; deploy previews.
- **Work:** connect repo; publish from root (static, no build; in-browser Babel stays);
  `netlify.toml` (redirects, functions dir); domain + DNS at Cloudflare; verify TLS;
  sanity-check all pages + designer.
- **Ownership:** Claude writes exact step list; Ben runs it in the dashboards (~45 min).
- **Risk:** low.

### Phase 1 — Measurement 🔵 schema names to finalize
- **Goal:** first honest funnel + per-product engagement + WhatsApp join started.
- **Work:** checkpoint events C1–C4 with dimensions (Part 2); mint/attach handoff short
  code; Airtable code + message-timestamp fields for C5–C7. This is the clean rebuild of
  the reverted commit — built on the Netlify collector, not GA4.
- **Depends on:** Phase 0 + final schema names.

### Phase 2 — Own the record 🔵
- **Goal:** owned spine + dashboard + catalog experiments.
- **Work:** `/api/track` function → **Netlify Blobs** (+ scheduled **CSV export**); short-code
  mint/resolve; `metrics.html` dashboard (monthly cohort stacked bars from Blobs + Airtable);
  catalog shuffle + `catalog_render`/`product_impression`/`product_open` events; matching-suggestion helper.
- **Depends on:** Phase 0, Phase 1 schema.

### Phase 3 — Close the loop 🔵
- **Goal:** Meta optimises against a proxy anchored to real outcomes.
- **Work:** CAPI forwarding (with `fbclid`); weekly/automated Airtable→Meta offline conversions.
- **Reality check:** at 1–2 sales/week Meta can't optimise on sales directly (needs ~50/wk);
  the loop improves the *proxy*; human weekly reallocation stays the steering wheel.
- **Depends on:** Phase 2 + fbclid capture.

### Track D — Designer / 3D engine migration 🔵 parallel · must not block 0–3
- **Goal:** replace the designer with the new 3D engine; one engine powering a simplified
  and an advanced interface.
- **Engine location:** `/Users/ben/code/framework/image-generator` (currently in the local
  image-generation pipeline; live site will embed the same engine in a user design UI).
- **Mobile-viability bar (device profile = deliberately low, Kenya-realistic: ~2GB RAM,
  entry SoC Unisoc T606 / Helio G36 class, Android 13, weak GPU, ~390px; primary env =
  Facebook in-app WebView):**
  1. Interactive within ~6–8s on throttled 4G, cold cache.
  2. Sustains ~24–30fps during orbit/drag/add-module — no lock-ups.
  3. Touch gestures reliable in WebView — no ghost taps.
  4. No crash/reload over a 3–5 min session (WebView OOM on 2GB is the classic killer).
  5. Full path works: config → short code → WhatsApp message.
  - **Testing:** Claude runs an emulated first-pass (CPU throttle + viewport); **real budget
    phone is the true gate** (WebGL/GPU/WebView can't be faithfully emulated). Err toward a
    *worse* phone; relax only if unreasonably hard to pass.
- **Sequencing:** integrate once mobile-verified; don't gate measurement on it. Must emit a
  design payload compatible with the engine-agnostic short-code store.

---

## Part 6 — Technical appendix (grows toward handoff)

### Current architecture (as-is, 2026-07-12)
- Static HTML + vanilla JS; shared `js/site.js` injects header/footer + tracking helpers.
- Designer/sandbox use **in-browser Babel** (no build): `js/designer.jsx`, `sandbox.html`.
- Hosting: **GitHub Pages** (`benjaminhoyle/framework-site`), Cloudflare DNS (proxied).
  GH Pages TLS cert stuck (`bad_authz`) — Netlify fixes it.
- Catalog data: `const configurations = [...]` in `shelving.html`; Meta feed
  `feeds/meta-shelving-catalog.csv` (AGENTS.md sync rules).
- Analytics: Meta Pixel (`1492649948884685`), GA4/gtag, Google Ads conversions, Clarity.
- WhatsApp taxonomy (live, commit `4ebc132`): `Lead` = product order/customise intent
  (with value); `Contact` = generic chat (centralised in `trackContactConversion`); no
  `InitiateCheckout`. All links pre-filled; guarded by `scripts/test-whatsapp-links.js`.

### Event schema 🔵 DRAFT (Phase-1 rebuild target)
Checkpoints C1–C4 + dimensions (Part 2). Session id + ad code (`utm_content`, `fbclid`)
+ handoff short code. Catalog events `catalog_render` / `product_impression` /
`product_open` (Part 3). _Names still to finalize._ Prior reverted attempt used a
delegated capture-phase click listener + an Android `intent://` deep link to skip the
wa.me interstitial — reusable ideas; re-derive against the agreed checkpoints + `/d/<code>`.

### Netlify / stores 🔵
- `netlify.toml`; `/api/track` function; **Netlify Blobs** (events + `code → payload`);
  scheduled CSV export; redirects for slugs/short-codes. Airtable = bottom funnel.

### Testing conventions
- Node CommonJS test scripts run directly (`node scripts/test-*.js`); assert + success line.
  Extend `test-whatsapp-links.js` as the link/handoff guardrail.

### Repo pointers
- `js/site.js` — shared helpers, tracking, WhatsApp link rules.
- `shelving.html` — catalog + lightbox + `?config=` deep-link auto-open.
- `js/designer.jsx`, `simplified-designer.html`, `sandbox.html` — design tools (Track D supersedes).
- `AGENTS.md` — catalog/feed sync + WhatsApp CTA rules.
- `/Users/ben/code/framework/image-generator` — new 3D engine (Track D).
- `/Users/ben/code/framework/mbs-scraper` — Meta Business Suite scraper (weekly-cadence enabler).

---

## Part 7 — Decision log & remaining open questions

### Decision log
- 2026-07-06 — Shipped pre-filled WhatsApp messages + Lead/Contact taxonomy (`4ebc132`, live).
- 2026-07-12 — Locked: Netlify full migration (first); checkpoints-not-scroll% with the
  View A/View B dimension model; C3 = 4+ products or designer; keep WhatsApp close;
  short-code-in-link join + layered codeless matching; Blobs+CSV store; full per-session
  catalog shuffle with raw `catalog_render`/`impression`/`open` events, no auto-weighting;
  deep-path flow waits for Track D; Track D mobile-viability bar defined. Reverted the
  funnel-measurement commit to rebuild clean.

### Remaining open questions
1. Literal event/dimension names in the schema (Part 6).
2. Short-code alphabet/length + slug routing rules.
3. Exact catalog surface(s) to shuffle; accumulation window before first ranking pass.
4. The "customize this product" deep-path flow (with Track D).
5. Netlify step-by-step (Claude drafts, Ben runs).
6. Track D real-device test once the engine is integration-ready.

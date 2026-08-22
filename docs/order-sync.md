# Order sync — Zoho Books ↔ Airtable

Raising a Zoho invoice from a design code, and keeping the Airtable order
pipeline true to the books without anyone retyping a line item. Replaces the
CSV-and-paste applet at
`Dropbox/…/order-reconciliation/airtable_zoho_import.html`.

Full design rationale: **https://claude.ai/code/artifact/8b944f4e-b591-44a1-81b5-19f816463d5a**

---

## The rule everything else follows

**One writer, one direction.** The push endpoint writes a Zoho draft and stops.
The reconciler is the only thing that writes to Airtable. Nothing carries money
or line items from Airtable back to Zoho.

The reason is partial failure. If the push wrote both sides, a timeout halfway
would leave a real, fiscalised invoice with no order. Instead the push does one
small thing, and the reconciler — which compares *state*, not events — picks up
whatever exists on its next pass.

| System | Owns |
|---|---|
| **Zoho Books** | invoice, line items, prices, discounts, payment, eTIMS, customer billing identity |
| **Airtable** | production status, delivery scheduling and coordination, QC, post-sale check-in, marketing links |

Delivery **date** is the sharp case: Zoho seeds it once at order creation and
Airtable owns it forever after, because deliveries get rescheduled and Zoho never
hears. Do not "fix" this by syncing it back.

---

## Pieces

| File | What it is |
|---|---|
| `netlify/functions/_zoho.mjs` | Zoho Books from a refresh token. Auth, paging, and the one place VAT-inclusive vs ex-VAT is decided. |
| `netlify/functions/_airtable.mjs` | The slice of Airtable the sync needs. Table ids live here. |
| `netlify/functions/_sync.mjs` | The reconciler: all checks, and the report writer. |
| `netlify/functions/sync-orders-background.mjs` | Entry point. Background function — a full pass takes minutes. |
| `netlify/functions/sync-health.mjs` | `/api/sync-health` — is the environment wired up? Synchronous, so it can report what the background function cannot. |
| `scripts/test-sync.mjs` | Unit tests over the pure helpers. No network. |
| `netlify/functions/_push.mjs` | Design → invoice lines. Pure, so it is tested without spending Zoho calls. |
| `netlify/functions/zoho-push.mjs` | `/api/zoho-push` — customer search and draft creation, behind `ZOHO_PUSH_KEY`. |
| `netlify/functions/sync-cron.mjs` | The clock. Inert until `SYNC_SCHEDULE_ENABLED=1`. |
| `scripts/test-reconcile.mjs` | Every check, against fixtures. No network — the Zoho budget makes live testing of the checks impractical, and they are the part most worth testing. |
| `scripts/test-push.mjs` | Design → lines, including the cases that would invoice the wrong thing quietly. |

### Airtable tables it writes

- **`Sync - Runs`** (`tbluXBJ67iGn6JPHa`) — one row per pass. Answers "is it
  running, and did it find anything?"
- **`Sync - Log`** (`tblWXSMuTUny856S3`) — findings only. **A clean pass writes
  zero rows here.** Recurring drift updates `Last Seen` rather than adding a row.
- **`Sync Status`** on Orders - Pipeline — `OK` / `Warning` / `Error` /
  `Held - in production`. The log answers "what is wrong across the board"; this
  answers "can I trust this order", on the order itself, where the workshop and
  the office already look. Nobody opens a log table to check one record.

  Written in write mode only, and only when it changes: read-only leaves the
  pipeline untouched by definition, and re-stamping 230 unchanged orders every
  five minutes would be a lot of writes to say nothing. A recovered order is
  cleared back to `OK` — a flag nobody clears is a flag nobody trusts.

---

## Running it

```
/.netlify/functions/sync-orders-background?key=<SITE_EXPORT_KEY>
```

| Parameter | Effect |
|---|---|
| `mode=incremental` | default. Only invoices modified in the last 2 hours. Cheap; usually finds nothing. |
| `mode=full` | every invoice. The **only** thing that can notice a deleted invoice. |
| `since=<iso>` | override the incremental window, e.g. `2026-08-01T00:00:00+0300` |
| `write=1` | apply the fields the sync owns. Also requires `SYNC_ALLOW_WRITES=1` in the environment. |

Two independent switches guard writing on purpose: a stray query parameter can
never start writing on its own.

### Environment

`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`,
`ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST` — all in `.env.zoho` (gitignored), ready to
paste into Netlify. Plus **`AIRTABLE_TOKEN`** — `data.records:read` and `data.records:write` on the
Framework Designs base, nothing else.

And **`ZOHO_PUSH_KEY`** — the password reps type into the builder. Two switches
stay off until the write pass has been checked by hand: `SYNC_ALLOW_WRITES` and
`SYNC_SCHEDULE_ENABLED`.

Do **not** set `AIRTABLE_BASE` in Netlify. The base id is hardcoded in
`_airtable.mjs` because it is an identifier rather than a credential, and it
already appears in `scene-airtable.mjs` and two docs — setting it as a variable
makes Netlify's secrets scanner find it in our own source and refuse the deploy.

---

## Three keys, and why

| Key | Opens | Held by |
|---|---|---|
| `SITE_LOGIN_KEY` | the gated pages | anyone who needs to *see* something |
| `SITE_EXPORT_KEY` | everything, plus the machine endpoints | the ops runner |
| `ZOHO_PUSH_KEY` | raising a draft invoice | reps, typed into the builder |

`SITE_LOGIN_KEY` deliberately does **not** open the push. It is chosen to be
typed and remembered — short, and therefore guessable — on the understanding
that it only opens what a person needs to see. Raising an invoice is doing.

`ZOHO_PUSH_KEY` fails **closed**: unset, only the machine key gets in. The login
key's unset-fallback exists so a lost variable never locks anyone out of a page;
the opposite instinct applies to something that writes.

What makes a shared typed password proportionate is the endpoint's own limit: it
creates a **draft** and can do nothing else — no send, no payment, no void, no
delete. The worst a leaked password buys is junk drafts. Adding a `send` action
would change that calculation, and the key with it.

---

## Raising an invoice from a design

The builder's Advanced panel, next to Download and Upload — already the staff
corner. Customers use Advanced, so the section is visible to everyone and simply
does nothing without the password. Password first; the rep's name only means
something once staff has been established.

```
POST /api/zoho-push  { action: "search", query }  -> [{ contact_id, name }]
POST /api/zoho-push  { action: "push", code, contact_id, rep }
```

Search runs against Airtable's 189 clients rather than Zoho's 374 contacts
(which include vendors and duplicates), and returns **names and ids only** — a
leaked password should not also hand over a customer database. The Airtable
record already carries its `Zoho Contact ID`, so the push resolves rather than
guesses and cannot mint a second contact for someone who has one.

Three rules in `_push.mjs`, each of which would otherwise fail silently:

1. **Group by `(moduleId, finish)`.** Both systems carry colour per line, and the
   builder's `priceBreakdown()` discards it — it exists to show a customer a
   total, not to describe an order.
2. **Join on `moduleId`, never the label.** `moduleLabel()` strips "(Trimmed)" in
   Simple mode, so a trimmed unit would be invoiced — and built — as the
   untrimmed one. Same price, so never visible as a money error; very visible
   when it arrives.
3. **Price from Zoho, never the contract.** The catalogue is what someone was
   quoted; the invoice is what they are charged.

A price difference from the quote is **surfaced, not blocked**. Reps zero-rate
deliberately, and a quote from before a price change is a normal thing to
invoice at today's rate.

---

## Checks

| Check | Severity | Asserts |
|---|---|---|
| `invoice-claimed-once` | Error | No invoice number is on two orders |
| `order-needs-invoice` | Error | An order without an invoice is Free/Heavy or Internal |
| `line-changed-in-production` | Error | A line changed after `Production Launched` — flagged and **not** applied |
| `line-totals-match-invoice` | Error | Line totals sum to the invoice goods total, once they carry invoiced prices |
| `catalogue-prices-agree` | Error | Live Zoho item and live Airtable product prices match |
| `line-has-order` | Warning | Every line item belongs to an order |
| `metadata-drift` | Warning | Payment date, delivery charge |
| `paid-invoice-no-order` | Info | A paid invoice with nowhere to land |

A price divergence blocks pushes **containing that item** and nothing else — one
stale price must not stop unrelated sales.

---

## The budget that shapes everything

**Zoho allows 2,000 API calls per organization per DAY** — not per minute. This
was discovered by exhausting it during testing, and it is the constraint the
schedule has to be designed around.

| Pass | Cost |
|---|---|
| Incremental, nothing changed | ~2 calls |
| Incremental, a few invoices changed | ~2 + 1 per changed invoice |
| Full | ~350 calls |

Three deliberate economies keep it there: an incremental pass skips the
catalogue check (prices do not move every five minutes), payments are only
fetched when Airtable's stored date disagrees with the invoice's own
`last_payment_date`, and a daily-quota 429 fails immediately rather than
retrying — retrying a daily limit only burns tomorrow's allowance too.

Every run records its own call count in `Sync - Runs.Notes`, so the budget is
visible rather than guessed at.

At `*/5` that is roughly 600 calls a day for polling plus one nightly full pass,
leaving comfortable headroom. **A 1-minute schedule would not fit.**

## Why polling, not webhooks

`last_modified_time` makes an incremental read cheap: one call, ~1.2s, empty most
of the time. Webhooks would be lossy, would not fire for deletions, and you would
still need the poll as a safety net.

An incremental pass **cannot see a deleted invoice** — a deleted record has no
modification time to report. `INV640313` was deleted and nothing noticed for
months. That is why the nightly full pass is not optional.

Edits and payments run on different clocks:

- **Status change with no order yet** (sent or paid) → act immediately. A status
  change is atomic; there is no half-finished state to catch.
- **Edit to an already-synced order** → let it settle ~10 minutes, so a rep
  working through an invoice does not push half-done states at the workshop.
- **Past `Production Launched`** → never apply silently. Flag and hold.

---

## Traps

Each of these cost a wrong answer while building this.

- **Line-item names are snapshots; the customer name is live.** All 327 invoices
  show their contact's *current* name, so renaming a Zoho contact rewrites how
  history reads. Old lines still say `Coat Hanger Module`, `Shelf - Standard Base`
  — hence `stripLegacy()`.
- **The invoice list omits custom fields the detail returns.** Delivery Address
  and Design Details are absent from list responses. List, then fetch detail.
- **`last_payment_date` is the *last* one.** Wrong for the 17 split-payment
  invoices. Use `/invoices/{id}/payments` and take the earliest; it works under
  `invoices.READ`, so no extra scope.
- **The org is tax-inclusive.** A line's `rate` is VAT-inclusive; `item_total` is
  ex-VAT. Goods use `rate`; the delivery field deliberately holds ex-VAT and uses
  `item_total`. Swapping them is a silent 16% error, so `money()` is the only
  place it is decided.
- **Airtable `= BLANK()` is true for numeric 0.** A zero-rated line would fall
  back to catalogue price. `Subtotal` uses `{Zoho Line Total} & "" = ""`.
- **Renaming an Airtable client rewrites Order IDs** —
  `Order ID = Order Code & "_" & Client Name`, and those ids are in the
  production doc.
- **A helper defaulting to GET while carrying a body** turned a create into a
  list query and wrote three line items to the wrong order. `_airtable.mjs`
  refuses that combination outright.

---

## To do

### Done
- [x] Reconciliation: 230 orders, 203 linked, 0 double claims, 0 unexplained
- [x] `Zoho Contact ID` on Base - Clients (172 populated)
- [x] Catalogue 1:1, 58/58, prices agree
- [x] `Zoho Unit Rate` + `Zoho Line Total` on Line Items; `Subtotal` falls back correctly
- [x] `Sync - Log`, `Sync - Runs`, `Sync Status`
- [x] Reconciler, read-only, verified against live data
- [x] Deployed. Cloud full pass matches local exactly: **310 scanned, 0 errors,
      25 warnings, 49 log rows** in 49s (2026-08-22)
- [x] Log dedupe proven: a second pass left 49 rows, not 98, and advanced
      `Last Seen` on all of them
- [x] `/api/sync-health` — synchronous, read-only, answers in the HTTP response,
      because a background function cannot report a broken Airtable
- [x] 32 tests, none touching the network. `reconcile()` takes an injectable
      `io`, so every check is exercised against fixtures. Mutation-checked: both
      the `Delivered`-is-protected bug and the delivery VAT bug are caught.

### Next
- [x] `AIRTABLE_TOKEN` in Netlify env. Not `AIRTABLE_BASE` — see above.
- [x] The six `ZOHO_*` vars in Netlify env
- [x] Full read-only pass confirmed in `Sync - Runs`
- [ ] Only then set `SYNC_ALLOW_WRITES=1` and run `write=1` once by hand
- [ ] Re-measure the revenue baseline in `framework-ops/INTEGRITY-SPEC.md`
      (5,786,000 across 230 orders before invoiced prices land) and record why it moved
- [ ] Schedule: `*/5 * * * *` incremental, nightly full
- [ ] Build `/api/zoho-push` + the Advanced-panel menu entry
- [ ] `cf_created_by_rep` custom field in Zoho, for rep attribution

### Tomorrow's runbook

Zoho allows 2,000 calls a day and a full pass costs ~350, so this fits several
times over — but do it in this order.

1. `curl -s "https://framework.co.ke/api/sync-health?key=$SITE_EXPORT_KEY"` —
   every check `ok`, `push_configured: true`.
2. Run the preview (`reconcile` read-only) and read **the acceptance test**: for
   each order, would the written figures reconcile to its invoice? Expect two
   known shortfalls — `71_Kerstin-Karlstrom` is missing 2 × Steel Decoration and
   `19_Bernard-Clouteau` a Bookend and an Extension. Anything else is new and
   worth understanding before writing.
3. `SYNC_ALLOW_WRITES=1`, then one `&write=1&mode=full` pass **by hand**.
4. Check `Sync - Runs`: `Lines Updated` ≈ 521, `Errors` 0.
5. Re-measure the revenue baseline (5,786,000 across 230 orders beforehand) and
   record the move in `framework-ops/INTEGRITY-SPEC.md`.
6. One real push through the builder. The single thing untestable offline is
   whether Zoho accepts `item_custom_fields` on create — if it rejects the
   colour, that is a one-line fix in `_push.mjs`.
7. Last: `SYNC_SCHEDULE_ENABLED=1`.

### Open decisions
- [ ] eTIMS field in Airtable — Zoho-owned, one-way, nothing blocks on it
- [ ] Quotes vs draft-as-quote (would need the PDF template redone)
- [ ] `sku = module_id` — needs `is_sku_enabled` switched on in Zoho
- [ ] Margin: apply a hand-set percent to actual revenue, or recompute from
      `Zoho Line Total` minus materials cost (needs one more lookup)
- [ ] A separate Server-based Zoho client for the web credential, so the two stop
      sharing a `client_secret`
- [ ] Delete the leftover `zzz - delete me (blank-test probe)` field in Line Items

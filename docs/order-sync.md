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
| **Both, and they must agree** | a client's phone and address. Base - Clients is what the workshop and the driver read; the Zoho contact is what the books bill. See "Three copies of a phone number" below. |

Delivery **date** is the sharp case: Zoho seeds it once at order creation and
Airtable owns it forever after, because deliveries get rescheduled and Zoho never
hears. Do not "fix" this by syncing it back.

**What the rule covers, and what it does not.** It is about the ORDER PIPELINE —
orders, line items, money. The push does not write there, and must not. It does
write **Base - Clients**, which is a different kind of thing: who a client is,
not what was sold. A client record cannot leave an order without an invoice, so
the rule's reason is untouched.

That carve-out is necessary rather than convenient, because **Base - Clients is
the only writable home a client's phone and address have.** On the order,
`Delivery Address` and `Primary Phone Number` are *lookups* from it,
`Delivery Address Baked` is `IF({Client Pickup}, "Client to Collect",
{Delivery Address})`, and `Delivery Details Summary` — the text a driver is
actually sent — is a formula over those. A correction that landed only in Zoho
would not go quietly stale in a table nobody reads. It would send the van to the
old house.

---

## Pieces

| File | What it is |
|---|---|
| `netlify/functions/_zoho.mjs` | Zoho Books from a refresh token. Auth, paging, and the one place VAT-inclusive vs ex-VAT is decided. |
| `netlify/functions/_airtable.mjs` | The slice of Airtable the sync needs. Table ids live here. |
| `netlify/functions/_sync.mjs` | The reconciler: all checks, the delivery seeding, and the report writer. |
| `netlify/functions/sync-orders-background.mjs` | Entry point. Background function — a full pass takes minutes. |
| `netlify/functions/sync-health.mjs` | `/api/sync-health` — is the environment wired up? Synchronous, so it can report what the background function cannot. |
| `scripts/test-sync.mjs` | Unit tests over the pure helpers. No network. |
| `netlify/functions/_push.mjs` | Design → invoice lines, plus the delivery line and everything that decides how a client record is corrected. Pure, so it is tested without spending Zoho calls. |
| `netlify/functions/zoho-push.mjs` | `/api/zoho-push` — the client list, one client's details, draft creation and the client write, behind `ZOHO_PUSH_KEY`. |
| `scripts/dev-builder.mjs` | The local server. Fakes `/api/zoho-push` over invented people, so the order form can be worked on without credentials or a live draft per attempt. |
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
creates a **draft** invoice, and it can create or amend the **client** that draft
bills. No send, no payment, no void, no delete. The worst a leaked password buys
is junk drafts and junk contacts, both visible and free to delete, plus a
customer list it can walk **one name at a time** — the list action returns names
and ids only, and details come from a per-contact call under a 2,000-a-day
budget. Adding a `send` action would change that calculation, and the key with
it.

---

## Raising an invoice from a design

A quiet **Staff login** row at the foot of Advanced's options sheet opens the
form. Nothing about the order is rendered until the password is accepted —
customers use Advanced too, and an order form anyone can read invites "what is
that?" from everyone who does not need it. It then takes the **whole screen**:
eleven fields, a searchable client list and a submit that creates a real record
in the books is a job to work through, not something to share a screen with a
shelf.

It asks for the details someone types by hand today anyway: client, phone,
delivery address, delivery date and window and whether each is agreed, whether
the client collects, and the delivery fee. They live on the invoice as custom
fields, so asking here means typing them once, beside the design they belong to,
rather than reopening the invoice to finish it. The design code is not asked for
— it is a hash of the design on screen, so the form shows it before anything is
saved and the invoice carries the same one.

```
POST /api/zoho-push  { action: "clients" }             -> every client, [{ contact_id, name }]
POST /api/zoho-push  { action: "client", contact_id }  -> that one client's phone + address
POST /api/zoho-push  { action: "search", query }       -> the old filter, kept for cached pages
POST /api/zoho-push  { action: "push", code, rep, ... }
```

**The client list is fetched once, and the password check is what fetches it.**
Asking the server on every keystroke meant paging the whole of Base - Clients out
of Airtable to answer each letter — a quarter of a second of nothing per
keystroke, which is why the old dropdown felt broken. 189 names is about 11KB;
the right shape is to send it once and filter an array. Asking for the list
either returns it or 401s, so it doubles as the password check and the form
opens with every name already in the browser.

The list runs against Airtable's clients rather than Zoho's 374 contacts (which
include vendors and duplicates), and returns **names and ids only** — a leaked
password should not also hand over a customer database. The Airtable record
already carries its `Zoho Contact ID`, so the push resolves rather than guesses
and cannot mint a second contact for someone who has one.

**A client created here is remembered locally**, in a `client` Blobs store, and
unioned into the list. Nothing here writes to Airtable, so without it a new
customer would be unfindable the moment the rep closed the form — and their
second order would mint them a second contact, which is the exact failure
searching Airtable rather than Zoho was chosen to avoid. It dedupes by
`contact_id`, so it disappears on its own once Base - Clients catches up.

**Delivery is a real Zoho item, not an ad-hoc line.** The typed fee becomes one
line on the "Delivery Fees" item, found by what it is (`/^delivery/i`) rather
than by one exact string — the same predicate `money()` uses, because the line
has been called "Delivery and Installation" as well. The rate is VAT-inclusive
like every other line. A client who collects is not charged for it, and that is
enforced **in the endpoint**, not merely by the form hiding the box: hidden and
not sent are not the same thing.

**Delivery is excluded from quote drift.** The builder quotes furniture and has
never known what delivery costs, so comparing the whole invoice would report a
2,000 discrepancy on every delivered order and train reps to ignore the one
warning that means something.

**`cf_work_type` is mandatory in Zoho** — an invoice without it is refused
outright — so the push always sends `Shelving`. Custom fields are checked against
the live form first, so one that does not exist yet is skipped rather than
failing the push, and starts working the moment it is created. What *is* skipped
comes back as `skipped_fields` and the result screen names it, so a rep who typed
a delivery window is told it did not reach the invoice rather than assuming it
did.

### Three copies of a phone number, and which of them must agree

| Copy | What it is | Reconciled? |
|---|---|---|
| **Base - Clients** | the live record of who the client is; every operational field on the order is a lookup from it | **yes** — written on every correction |
| **Zoho contact** | accounting's copy of the same live fact | **yes** — written on every correction |
| **`cf_primary_contact_number` / `cf_delivery_address` on the invoice** | a snapshot of where *this order* went | **no, deliberately** |

The first two are one fact in two places and must never disagree. The third is a
different fact — a client who moves house must not rewrite where last year's
shelf was delivered — so it is written once, at order time, and never touched
again.

### Correcting a client

> **The Zoho half does not work yet.** The Self Client credential can read and
> create contacts but not update them, so every contact correction comes back
> `401 code 57: You are not authorized to perform this operation`. It needs the
> refresh token reissuing at api-console.zoho.com with **`ZohoBooks.contacts.UPDATE`**
> added to its scopes; nothing in the code changes when it is. Until then the
> Airtable half — which is the half the driver's message reads — still lands, and
> the result screen says plainly that Zoho's copy was not updated rather than
> reporting a fault. Found on INV640437, the first live push.

Choosing a client reads **both** live records. Prefill prefers Zoho and falls
back to Airtable, which is what makes it useful today: most Zoho contacts were
created quickly and carry no address at all, while Base - Clients has one for 125
of 185 people. Editing either field writes the correction to **both**, after the
invoice is raised, prepending what it replaced to that record's Notes, dated:

```
2026-08-23 (shelf designer): previous phone 0722123456
```

**Where the two already disagree, the form says so and the rep settles it.** It
shows the other record's value under the box with a "Use it" button. There is no
rule that could decide this from the outside — both are real numbers somebody
wrote down — but the person who has just spoken to the client can. Only a genuine
disagreement is flagged: a blank on one side is a gap the save fills, and
`+254722123456` against `0722123456` is one number written twice.

Six things about it, each of which would otherwise be a quiet error:

- **The invoice first, the client records after, and never the other way round.**
  The invoice carries the phone and the address as custom fields of its own, so
  the order is complete whether or not either client write succeeds — which is
  exactly what lets them be best-effort rather than gates. A failure to update a
  phone number must never cost a rep the invoice they were raising.
- **The two writes are independent, and reported separately.** One failing still
  corrects the other. Half a correction that says it is half a correction can be
  finished; one that claims to be whole cannot.
- **Both sides answer "has this changed?" with the same comparison.**
  `contactUpdate` and `airtableClientPatch` share `samePhone`/`sameAddress`. If
  they diverged, one record would be written and the other skipped, and a
  correction would converge on two different answers.
- **A phone is not changed when it has only been retyped.** `0722123456`,
  `722123456`, `+254722123456` and `254 722 123 456` are one number; treating a
  rep's retype as a correction would write a pointless update and leave a
  "previous phone" note recording no change at all.
- **A phone lives on the primary contact person, not on the contact.** The
  contact-level `phone`/`mobile` in a Zoho response are read-through copies, and
  sending them at the top level silently does nothing. The update must carry the
  existing `contact_person_id` too, or Zoho **adds** a second contact person
  rather than editing the one that is there.
- **Blank never erases.** A field the rep left empty is not a correction to
  nothing.

**A new client** is created in Zoho before the invoice, because an invoice needs
a `customer_id` — so there is no ordering in which a failure leaves an invoice
pointing nowhere, and the worst case is a contact with no invoice. Zoho refuses a
duplicate `contact_name`, and that refusal is the useful one: it means the person
is already in the books, and the form says "search for them in the list instead"
rather than minting a second record.

It is then created in **Base - Clients** too, carrying its `Zoho Contact ID` from
birth, so the two records start life agreeing rather than starting apart and
waiting for somebody to remember. Airtable has no uniqueness constraint of its
own, so the create refuses a name already in the list: `Order ID` is
`Order Code & "_" & Client Name`, and two of the same person means orders that
look interchangeable and are not.

### Delivery details reach Airtable through the reconciler

The rep types the delivery date, the window, whether each is agreed and whether
the client collects into the builder. Those go onto the invoice as custom fields,
and the reconciler seeds them onto the order — otherwise they get typed a second
time into Airtable, which is the duplication the form exists to remove.

| Invoice | Order |
|---|---|
| `cf_delivery_date` | `Delivery - Scheduled Date` |
| `cf_delivery_window_start` / `_end` | `Delivery Window Start` / `End` |
| `cf_delivery_date_status` | `Delivery - Date Set` (ticked only when Confirmed) |
| `cf_delivery_time_status` | `Delivery - Time Status` |
| `cf_client_pickup` | `Client Pickup` |

**Seed once, never overwrite.** This is the delivery-date rule applied to
everything that travels with a delivery date: Zoho seeds it at order creation,
Airtable owns it forever after. Deliveries get rescheduled and re-confirmed by
people looking at Airtable and Zoho never hears, so a July invoice must not be
able to drag September's delivery back — or un-confirm it. `seedDelivery()`
therefore fills blanks only, which also makes it idempotent: a repeated full pass
writes nothing twice.

**The date status lands on `Delivery - Date Set`, the checkbox that was already
there.** That checkbox is not decor — `Delivery Details Summary`, the text the
delivery team is sent, reads:

```
IF({Delivery - Date Set},
   <the delivery window>,
   <the date> & " (⚠️ Delivery date not confirmed)")
```

which is precisely the tentative/confirmed distinction the form asks about,
already wired to the people who act on it. A second field saying the same thing
would be two answers to one question. (A `Delivery - Date Status` select was
created here first and then abandoned; it is renamed `zzz - delete me` because
Airtable's API can create and rename fields but cannot delete them.)

`Delivery - Date Set` and `Client Pickup` are both one-directional, because a
checkbox cannot tell "no" from "nobody said". An invoice can tick one; an
invoice merely silent about it can never untick a box somebody ticked.

`Delivery - Time Status` has no existing equivalent, and the summary formula
above collapses the window into the date flag — so it is recorded on the order
and visible to ops, but the driver's message does not yet mention a tentative
*time*. Extending that formula is a one-line change to what the delivery team
reads, so it is left as a decision rather than made here.

Two traps in that table:

- **Airtable's window fields are `duration`, which is a count of SECONDS.**
  Writing Zoho's `"14:30"` straight across stores nothing at all —
  `hhmmToSeconds()` is the only place that conversion happens.
- **`0:00` is a real time, not a blank.** The blank test is `undefined | null |
  ''`, not falsiness, or a midnight window would be overwritten on every pass.

Two things about when this actually happens:

- **The reconciler never creates orders.** It matches invoices to orders that
  already exist and reconciles those; a draft invoice with no order is skipped
  entirely. So the seeding fills in a hand-made order's blanks on the next pass
  after somebody creates it — which is what "seeded at order creation" has
  always meant here.
- It needs `SYNC_ALLOW_WRITES=1`, which **is** on (a Write-mode pass ran
  2026-08-23). The seeds are computed on every pass and appear in the pending
  writes either way, so a read-only pass still shows exactly what it would do.

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

- **`<input type="number">` reports an empty string for "2,500".** Not the
  digits behind it — nothing. A rep typing a thousands separator, which in Kenya
  is most of them, sent no delivery fee at all and got an invoice with no
  delivery line and no warning. INV640437 went out that way. The field is now
  plain text with a decimal keypad, both ends strip anything that is not a digit
  or a point, and a fee that fails to become a line is reported.
- **A Zoho contact's `phone`/`mobile` are read-through copies** of its primary
  contact person's. Sending them at the top level of an update silently does
  nothing, and an update to `contact_persons` without the existing
  `contact_person_id` **adds** a second person rather than editing the first.

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
- [x] Build `/api/zoho-push` + the entry point in Advanced (now the last row of
      its options sheet)
- [x] `cf_created_by_rep` custom field in Zoho, for rep attribution
- [x] `cf_delivery_date_status` / `cf_delivery_time_status` dropdowns
      (Tentative / Confirmed), created 2026-08-23
- [x] The form rebuilt: preloaded client list, per-client prefill, new clients,
      the delivery fee, and both delivery statuses
- [x] `Delivery - Date Status` / `Delivery - Time Status` on Orders - Pipeline
      (single select, Tentative / Confirmed), created 2026-08-23
- [x] Client phone and address written to BOTH live records, with disagreements
      surfaced in the form
- [ ] Turn on `SYNC_ALLOW_WRITES=1` — until then the delivery seeding is
      computed and previewed but never lands

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

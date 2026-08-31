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

The reconciler **creates** orders as well as reconciling them — see "An invoice
becoming an order". That is not an exception to the rule: it is still the one
writer, still going one way.

The reason is partial failure. If the push wrote both sides, a timeout halfway
would leave a real, fiscalised invoice with no order. Instead the push does one
small thing, and the reconciler — which compares *state*, not events — picks up
whatever exists on its next pass.

| System | Owns |
|---|---|
| **Zoho Books** | invoice, line items, prices, discounts, payment **date and balance**, eTIMS, customer billing identity |
| **Airtable** | production status, delivery scheduling and coordination, QC, post-sale check-in, marketing links, **whether a client can be invoiced VAT-exempt** |
| **Both, and they must agree** | a client's phone, address **and KRA PIN**. Base - Clients is what the workshop and the driver read; the Zoho contact is what the books bill. See "Three copies of a phone number" below. |

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
| `netlify/functions/sync-cron.mjs` | The clock, hourly. Inert until `SYNC_SCHEDULE_ENABLED=1`. |
| `netlify/functions/sync-now.mjs` | `/api/sync-now` — a pass on demand from the staff menu, behind `ZOHO_PUSH_KEY`. |
| `scripts/test-reconcile.mjs` | Every check, against fixtures. No network — the Zoho budget makes live testing of the checks impractical, and they are the part most worth testing. |
| `scripts/test-push.mjs` | Design → lines, including the cases that would invoice the wrong thing quietly. |
| `scripts/add-sync-fields.mjs` | The three Airtable fields the sync writes, created by hand. Dry run by default, idempotent, and it says the one thing it cannot do. |

### Airtable tables it writes

- **`Sync - Runs`** (`tbluXBJ67iGn6JPHa`) — one row per pass. Answers "is it
  running, and did it find anything?"
- **`Sync - Log`** (`tblWXSMuTUny856S3`) — findings only. **A clean pass writes
  zero rows here.** Recurring drift updates `Last Seen` rather than adding a row.
- **`Balance to Pay`** on Orders - Pipeline — the invoice's own `balance`.
  Written silently, like the eTIMS number: it is Zoho's arithmetic, and a
  difference is never something a person has to act on — it is a payment
  landing. Reporting it would put a fresh log row against every invoice every
  time somebody paid.
- **`Payment Received`** on Orders - Pipeline — the FIRST payment on the
  invoice. See "The date the month is counted in" below; this one is not
  cosmetic.
- **`KRA PIN`** on Base - Clients — blanks only, from the PIN Zoho stamped on
  the client's most recent invoice.
- **Orders - Pipeline, Orders - Line Items and Base - Clients records**, created
  from an invoice that has none. See "An invoice becoming an order".
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

### The Zoho credential's scopes

Six, one per thing the code calls, and nothing spare:

```
ZohoBooks.invoices.CREATE   raising the draft
ZohoBooks.invoices.READ     listing, fetching one in full, and its payments
ZohoBooks.contacts.CREATE   "+ New client"
ZohoBooks.contacts.READ     the client list, and one client's details
ZohoBooks.contacts.UPDATE   writing a correction back
ZohoBooks.settings.READ     /items and /settings/fields
```

Two are not where you would guess. **Items come under `settings`** — there is no
`ZohoBooks.items.*`. And **`/invoices/{id}/payments` works under `invoices.READ`**,
so the reconciler can take the first payment date on a split-payment invoice
without a `customerpayments` scope.

Banking and expenses are deliberately absent: that is the line between this
cloud credential and the wider one in `framework-ops/.env`.

The balance, the first payment date and the KRA PIN all landed **without
widening this**. The balance rides on the invoice detail already being fetched,
the PIN on the same detail and on `contacts.UPDATE` already being held for phone
and address, and payments were always readable under `invoices.READ`. If a
change here ever seems to need a seventh scope, that is worth a second look
before it is granted.

The first live push, INV640437, failed its contact write with `401 code 57`
because the original token had no `contacts.UPDATE` — and `invoices.UPDATE`,
which nothing calls, instead. Reissued 2026-08-24 with the set above; the
payload was never the problem, and no code changed. `zoho-push.mjs` still
recognises that specific refusal and reports it as a scope problem rather than a
fault, in case a future token is issued short again.

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

**The KRA PIN has exactly the same three copies**, and they divide the same way:
`Base - Clients.KRA PIN` and the Zoho contact's `tax_reg_no` are one live fact
written together, and the invoice's own `tax_reg_no` is a snapshot Zoho stamps
at invoice time. That third copy is not ours to write — this credential has no
`invoices.UPDATE`, deliberately — and it should not be, for the reason the
address is not: an invoice records the registration a sale was made under, and
a PIN corrected in 2027 must not rewrite what a 2025 invoice was filed as.

It is, however, worth *reading*. The invoice detail is already fetched for every
non-draft invoice, so the PIN Zoho stamped on it is free — and it is the only
cheap source there is. The contact LIST response omits `tax_reg_no` entirely, so
reading PINs live would cost a detail call for each of 374 contacts against a
2,000-a-day budget. The reconciler therefore **seeds `Base - Clients.KRA PIN`
from the client's most recent invoice, into blanks only**, which brought a
hundred-odd PINs across without anybody typing one and cost nothing.

Prefill in the form runs the other way round from phone and address. Those come
from Zoho and fall back to Airtable; the PIN comes from **Airtable** and falls
back to Zoho, because Airtable's copy is the one the reconciler has been keeping
current. Where the two disagree the form says which record holds the other value
— "Zoho has P051755191T", not "the other one says".

**A PIN and a tax treatment travel together, always.** Ben's rule, verbatim:
*if no KRA number, not registered; if there is one, then they are.* The PIN is
the fact and the treatment follows from it, so the two are never set apart.

Zoho enforces the same thing from its side — it will not hold `tax_reg_no`
against a contact it believes is not VAT-registered, and 258 of 374 contacts are
`vat_not_registered`, the default for anyone created quickly. So typing a PIN
into the form sets `tax_treatment: vat_registered` as well, and that is what
typing one *means* here: this client is invoiced in their own
registered name. It changes how the customer is classified, not what they are
charged — the rate is the organisation's and `is_taxable` is untouched — and the
result screen says so out loud rather than letting it happen quietly.

**One consequence of writing the client records last.** The invoice is raised
before them, deliberately, so a failed contact write can never cost a rep the
draft they were raising. The price of that ordering is a single case: an
*existing* client given a PIN for the first time had none on their contact when
the invoice was stamped, so that draft does not carry it. Their next one will,
and the result screen says to re-save the draft in Zoho if this one needs it. A
*new* client is unaffected — their contact is created before the invoice, PIN
and all.

### VAT exempt

`Base - Clients.VAT Exempt` is a checkbox, and it is **Airtable's outright** —
nothing syncs it, in either direction.

That is not a gap left for later; it is what the data says. Zoho models a real
exemption as `is_taxable: false` on the contact, and **no contact in the books
has it** — all 374 are taxable, split only between `vat_registered` (116) and
`vat_not_registered` (258), which is a statement about the *customer's* own
registration and not about whether we charge them VAT. There is nothing to
reconcile to, so a field pretending to mirror one would be a field that is
always false for the wrong reason.

What it is instead is the standing fact somebody knows and Zoho does not: a
mission, an NGO, an exemption certificate in a drawer. The order form reads it
and says so when the client is chosen, because the moment an invoice is raised
is the moment it matters and the person raising it is not usually the person who
knows. Nothing acts on it automatically — deciding what an exempt invoice looks
like is an accounting decision, not a sync one.

If it should ever *drive* invoicing, the next step is `is_taxable: false` on the
Zoho contact and a tax exemption reason beside it, and at that point the same
question the phone number answered has to be answered again: who owns it, and
what happens when the two disagree.

### Correcting a client

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

**There is no status for the TIME.** A window somebody typed is a window they
meant, and the formula above already gates the whole slot on
`Delivery - Date Set`, so a second flag was a question the driver never gets
asked. The form asks once, about the date. (`cf_delivery_time_status` in Zoho and
`Delivery - Time Status` in Airtable were created for it and are now renamed
`zzz - delete me`; neither API can delete a field.)

Two traps in that table:

- **Airtable's window fields are `duration`, which is a count of SECONDS.**
  Writing Zoho's `"14:30"` straight across stores nothing at all —
  `hhmmToSeconds()` is the only place that conversion happens.
- **`0:00` is a real time, not a blank.** The blank test is `undefined | null |
  ''`, not falsiness, or a midnight window would be overwritten on every pass.

### What the driver is told, and the money on it

`Delivery Details Summary` is the message the delivery team is sent. It gains one
block, and the block **says nothing at all when the invoice is settled** — which
is nearly always: 306 of 308 paid invoices carry a zero balance, because payment
comes before delivery. A line that appeared on every job saying "0 to pay" would
be a line people stop reading, and the one time it matters is the one time they
would miss it.

That is what `Balance to Pay` being **zero rather than blank** is for. Blank
means no issued invoice has been read yet; zero means nothing is owed. The
formula tests `> 0`, so both stay quiet and only a real debt speaks.

**Applied 2026-08-27.** It sits in Orders - Pipeline → Delivery Details Summary,
immediately above the `Delivery Notes` clause at the end:

```
IF(
  {Balance to Pay} > 0,
  "*⚠️ Balance to pay:*" & "\n" & "Ksh " &
  IF(
    LEN(ROUND({Balance to Pay}, 0) & "") > 6,
    LEFT(ROUND({Balance to Pay}, 0) & "", LEN(ROUND({Balance to Pay}, 0) & "") - 6) & "," &
      MID(ROUND({Balance to Pay}, 0) & "", LEN(ROUND({Balance to Pay}, 0) & "") - 5, 3) & "," &
      RIGHT(ROUND({Balance to Pay}, 0) & "", 3),
    IF(
      LEN(ROUND({Balance to Pay}, 0) & "") > 3,
      LEFT(ROUND({Balance to Pay}, 0) & "", LEN(ROUND({Balance to Pay}, 0) & "") - 3) & "," &
        RIGHT(ROUND({Balance to Pay}, 0) & "", 3),
      ROUND({Balance to Pay}, 0) & ""
    )
  ) & "\n\n",
  ""
) &
```

The nesting is all thousands separators. Airtable has no number formatting in
formulas, and "Ksh 195000" is a figure somebody has to count the digits of
before they can read it aloud to a customer — which is exactly what the person
holding this message is about to do. The two branches cover four to nine digits;
below a thousand it prints as it stands. Verified live: 17500 renders
`Ksh 17,500` and 4052 renders `Ksh 4,052`.

**A correction to what this file used to say.** The API *can* update a formula —
`PATCH …/fields/{id}` with `{"options": {"formula": …}}` was accepted and came
back `isValid: true`. The 2026-07-29 note that the field-update endpoint takes
"only name and description" was about **single-select options**, which genuinely
cannot be changed, and it had been over-generalised to every field type. Formulas
are written with field **ids**, not names, so read the current one back from the
schema endpoint and edit that string rather than retyping it with names.

Nothing else reads `Balance to Pay`, so until the formula is edited the field is
simply written and not shown. `Delivery Details with Order` and `Docs Summary`
are both formulas over this one, so they pick it up for free.

### The date the month is counted in

`Payment Received` is now **written** from the first payment on the invoice,
where it used to be compared and complained about. That is a bigger change than
it looks, and it is worth knowing why before the first write pass runs.

The old reasoning was sound as far as it went: Airtable recorded the day a
deposit confirmed the order, Zoho the day it cleared, and warning about a
three-day gap produced 19 standing warnings of which 15 meant nothing. But two
dates for one event is two answers to one question, and this particular field is
not decoration:

```
Order Month  =  IF({Payment Received}, YEAR(...) & "-" & MONTH(...), "")
Production Start for Calculation  =  IF({Manual Production Start}, …,
                                        IF({Payment Received}, {Payment Received},
                                           {Order Received}))
```

So the month a sale is counted in follows this field, and so does the production
timing baseline. **Expect some orders to change months on the first write pass**
— any whose hand-entered date sat within a few days of a month boundary on the
other side of the invoice's. Zoho owns money, so Zoho settles it, but that is a
number moving in reports somebody may have quoted.

Two things it is careful about:

- **The FIRST payment, never `last_payment_date`.** That field is the last one
  and is wrong for all 17 split-payment invoices, and the deposit is the event
  Airtable has always meant.
- **A big move is mentioned once.** More than seven days and the correction gets
  an Info row, because the usual cause is an order pointed at the wrong invoice.
  The next pass finds the two agreeing, so the finding closes itself.

And one thing it will not do: when Airtable holds a payment date and Zoho has no
payment at all against the invoice, that is a **Warning**, not a write. Carrying
Airtable's date into the books is the direction the whole design forbids; a
receipt missing from the books is a real thing to go and find.

**What it costs.** `last_payment_date` is free on the invoice, and for an invoice
paid in one go it *is* the first payment — so a stored date already equal to it
needs no lookup, which is nearly every invoice once this has run once. A
split-payment invoice keeps costing one call a pass, because it settles on a
first date that by definition is not the last. That is the right way round: the
cheap case goes quiet, and the seventeen worth re-checking are re-checked. A full
pass moves from ~350 calls to ~370 in the steady state, and to ~600 on the first
pass that corrects everything.

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
4. **Skip the pieces marked `omitted`.** Advanced can leave a piece out of the
   invoice — the units a client already owns and is adding to. They are in the
   design, and drawn, so the shelf on the image is the shelf in the room; they
   are not in the builder's total and must not be in the invoice's, or the
   client is billed for furniture they already have. Everything that reports a
   figure — the summary line, the share image, the WhatsApp order, this push —
   leaves them out of the money and says in one line that some pieces in the
   picture are there for reference, so nobody reads the shorter list as an order
   that lost half a shelf.

A price difference from the quote is **surfaced, not blocked**. Reps zero-rate
deliberately, and a quote from before a price change is a normal thing to
invoice at today's rate.

---

## An invoice becoming an order

Until 2026-08-31 the reconciler never created anything, and the code said so
flatly without ever saying why. It was not a decision — it was unfinished. The
proof is `Sync - Runs.Orders Created`, a column that had existed from the
beginning and that no code had ever written. Somebody built the reporting for
this and stopped.

The job was being done by hand, by
`Dropbox/…/order-reconciliation/airtable_zoho_import.html`, in seven steps:
export both CSVs, find the Zoho invoices with no `CF.Airtable Order Number`,
tick which to add, paste a Base - Clients block, paste an Orders - Pipeline
block, **paste the generated Order IDs back into the applet**, paste the line
items, then check the production document.

**Step 5 is why the applet has seven steps and this has none.** `Order ID` is a
formula over an autoNumber, so it does not exist until the row does — the applet
cannot know it, so a person carries it back across. Creating through the API
returns the record id, so the client, the order and its lines are written in one
movement and the round trip disappears.

### What has to be true before one is created

Four conditions, each somebody's decision rather than a technicality:

| | |
|---|---|
| `cf_work_type` is `Shelving` | Orders - Pipeline **is** the shelving pipeline. A window job or a picture frame has no order to be, which is why `paid-invoice-no-order` has always filtered the same way. The applet had no such filter — its filter was a human ticking boxes. |
| Paid, part-paid, or sent | Ben's rule, 2026-08-31: paid or part-paid starts as **To Launch Production**, merely sent as **Invoice Sent**. Never a draft — that is a quote somebody is still editing — and never a void. |
| Dated on or after `CREATE_ORDERS_FROM` | A fixed date in the code, not "today" computed at runtime: a floor that moves with the clock is not a floor. New invoices only, so a year of finished history does not materialise as live orders overnight. |
| Nothing already claims the invoice number | The whole duplicate defence. |

### The duplicate defence, and the marker we cannot write

The applet's "already imported" marker is `cf_airtable_order_number` **on the
Zoho invoice**. This credential has no `invoices.UPDATE`, deliberately, so the
sync cannot stamp it — and should not want to. The Airtable side is the better
key anyway: an order already carrying that invoice number, which is exactly what
`invoice-claimed-once` guards. A person cannot clear it by accident, and it is
read fresh on every pass rather than trusted from a field.

The consequence is that **the applet's marker stops being maintained**. Anything
still relying on `cf_airtable_order_number` is reading a field that stopped
growing on 2026-08-31.

Two more places a duplicate could get in, both closed:

- **A client created twice in one pass.** Two invoices for one new customer would
  otherwise make two Base - Clients rows. A client created during a pass is added
  to the in-memory list immediately, so the second invoice finds the first.
- **`client-listed-once`**, a new check: two client rows sharing a `Zoho Contact
  ID`, or sharing a name. Base - Clients has no uniqueness constraint of its own,
  and `Order ID` is `Order Code & "_" & Client Name` — so two rows for one person
  means orders that look interchangeable and are not.

### Matching or creating the customer

By `Zoho Contact ID` first, which is exact. Then by name, collapsed and
lower-cased — that catches the clients typed in before the ids existed, and a
name match **backfills the id** so the next invoice resolves exactly and the base
stops drifting. Only when neither matches is a row created, from what the invoice
itself carries: name, `cf_primary_contact_number`, `cf_delivery_address`, and the
KRA PIN from `tax_reg_no`.

### The lines

Joined on `item_id`, never on the name. The applet had to match by name —
`convertItemName()` is forty lines of substring tests, still mapping to
`Lamp Mount - Left`, a product the catalogue stopped calling that — because a CSV
export has no ids in it. We have them, they survive every rename, and 58 of 59
active products carry theirs. The one that does not is `Custom Item`, which has
no Zoho twin by design.

A line matching nothing keeps its Zoho name in `Other Item Name` rather than
being dropped or guessed at — the applet's own fallback column. Delivery never
appears: it is a field on the order, not a line on it. An invoice-level discount
is apportioned across the lines on the way in, or a discounted order would be
created reporting itself short on the very next pass, forever.

### Creations run last, and one order at a time

Serial and after every patch, deliberately. Each order needs its client's record
id, and each line needs its order's — three dependent writes, not a batch. One at
a time also means a failure costs exactly one order: nothing is left half
written, the invoice stays unclaimed, and the next pass simply tries again. Every
creation writes an `order-created` row saying what was made, and every failure
writes one saying what was not.

### Two bugs this turned up

`seedDelivery` had been reading custom fields off the wrong key. Zoho returns
each one three times — `cf_delivery_date` is `"04 Sep 2026"`,
`cf_delivery_date_formatted` is the same, and `cf_delivery_date_unformatted` is
`"2026-09-04"`. Only the last is a date Airtable will take. The same split makes
`cf_client_pickup` the **string** `"false"` while `cf_client_pickup_unformatted`
is the boolean, so `=== true` against the plain key could never be true whichever
way the box was ticked.

So the seeding had been writing a display-format date into a date field, and had
never once been able to tick Client Pickup. Everything now reads through `cfv()`.

---

## Checks

A finding has to be worth reading. Every one of these earns its place by being
something a person can act on — which took removing four things that were not:

- **`paid-invoice-no-order` is Shelving only.** Orders - Pipeline is the shelving
  pipeline; a window job has no order to be missing. 17 of the 25 it reported
  were Custom Projects.
- **Catch-all products are not findings.** `Custom Item` is an Airtable product
  with no Zoho twin and never will have one — that is what it is for.
- **A payment date within a week is the normal working gap.** Airtable records
  the day a deposit confirmed the order, Zoho the day it cleared. Warning about
  ±3 days produced 19 standing warnings of which 15 meant nothing.
- **An order short only by its catch-all cannot reconcile, by construction.** It
  is short by exactly the `Custom Item`'s value on every pass, forever. Reported
  as Info, not an Error nobody can clear.

Together: **58 findings to 25, errors 13 to 7, warnings 20 to 4** — and the
`line-totals-match-invoice` errors now name the products, so "revenue 41600 vs
55600" reads "4 x Small Steel Decoration on the order but not the invoice".

**Findings close themselves.** A FULL pass **that actually ran** marks Open rows
it no longer sees as Resolved. Two conditions, both load-bearing. Only a full
pass: an incremental one looks at two hours of invoices, so a finding it does not
report is one it never looked at. And only a pass that did not die: a failed one
reports zero findings, which is indistinguishable from "everything is fixed", so
a nightly full pass hitting the daily quota would otherwise empty the log
silently. Without this the log only
grew — 58 rows all reading Open, five of them fixed the day before by the write
pass with nothing saying so. `Sync Status` on the order has always cleared itself
back to `OK` for the same reason, and the log's Status field has had a `Resolved`
option waiting for it since the beginning.

| Check | Severity | Asserts |
|---|---|---|
| `invoice-claimed-once` | Error | No invoice number is on two orders |
| `order-needs-invoice` | Error | An order without an invoice is Free/Heavy or Internal |
| `line-changed-in-production` | Error | A line changed after `Production Launched` — flagged and **not** applied |
| `line-totals-match-invoice` | Error | Line totals sum to the invoice goods total, once they carry invoiced prices |
| `catalogue-prices-agree` | Error | Live Zoho item and live Airtable product prices match |
| `client-listed-once` | Error | No two Base - Clients rows share a contact id or a name |
| `order-created` | Info / Error | An invoice became an order, or could not |
| `line-has-order` | Warning | Every line item belongs to an order |
| `metadata-drift` | Warning | Airtable records a payment the books have never seen |
| `metadata-drift` | Info | A payment date corrected by more than a week — applied, and worth a glance |
| `paid-invoice-no-order` | Info | A paid invoice with nowhere to land |

Three fields the sync writes appear in none of these, on purpose. The **delivery
charge**, the **balance** and a client's **KRA PIN** are Zoho's own facts arriving
where they belong; a difference is not a discrepancy, it is a payment landing or
a blank being filled. The balance is the sharp case — it moves every time
somebody pays, so reporting it would mean a fresh log row per invoice per
payment, and the log's entire worth is that a clean pass writes nothing to it.

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
| Full | ~370 calls (~600 on the first pass that corrects payment dates) |

Three deliberate economies keep it there: an incremental pass skips the
catalogue check (prices do not move every five minutes), payments are only
fetched when Airtable's stored date disagrees with the invoice's own
`last_payment_date` — see "The date the month is counted in" for why that stays
true now the date is written rather than reported — and a daily-quota 429 fails
immediately rather than retrying, because retrying a daily limit only burns
tomorrow's allowance too.

The balance and the KRA PIN cost nothing at all: both come off an invoice detail
that was already being fetched. Base - Clients is one extra *Airtable* read a
pass, which has no daily quota to spend.

Every run records its own call count in `Sync - Runs.Notes`, so the budget is
visible rather than guessed at.

**The schedule is hourly, not `*/5`.**

|  | calls/day |
|---|---|
| 24 incremental passes, ~2 each when nothing changed | ~50 |
| 1 nightly full pass | ~350 |
| **total** | **~400** |

`*/5` cost ~950 a day to notice things sooner than anybody acts on them: an
order's invoiced prices are backfilled onto a record a person made by hand, and
nothing downstream waits on the difference between a two-minute and a
fifty-minute lag. What the budget is actually needed for is raising invoices and
re-running a full pass when something looks wrong.

That was not theoretical. On the day the schedule went live, four full passes
plus `*/5` polling exhausted the whole 2,000, and every pass afterwards failed —
106 run rows, all of them errors.

When somebody does need it now, **`POST /api/sync-now`** triggers a pass from the
builder's staff menu. Cheap by default, immediate on demand, rather than
expensive always in case somebody is watching. It is opened by `ZOHO_PUSH_KEY`
and reaches for `SITE_EXPORT_KEY` server-side, so the machine key never goes near
a browser — and it cannot ask for more than the clock gets, because write mode is
still gated on `SYNC_ALLOW_WRITES` inside the background function.

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

### Balance, payment date and KRA PIN — done 2026-08-27

All three shipped and were applied to the live base in one sitting.

1. `add-sync-fields.mjs --commit` created `Balance to Pay` on Orders - Pipeline
   (`fld1xg1yAzG0wF67t`) and `KRA PIN` (`fldIAutQEOZBo147G`) and `VAT Exempt`
   (`fldE8jgjBZINbJel5`) on Base - Clients.
2. The balance block went into `Delivery Details Summary` through the API.
3. A read-only full pass, then a write pass, both run locally against the live
   data: **313 invoices scanned, 348 Zoho calls, 205 orders written, 20 clients
   written, 0 lines** (the line backfill was already done), 5 errors, 0 warnings.
   The run row is `recGIaKxk2vHY4ygw`.

Order the steps that way if the base is ever rebuilt: Airtable refuses a PATCH
naming a field that does not exist, and `patch()` sends ten records at a time, so
a write pass run before step 1 dies on its first batch. It dies loudly —
`Sync - Runs` records `Failed` with `UNKNOWN_FIELD_NAME` — which is why there is
no guard in the code for it.

**What it actually moved.**

| | |
|---|---|
| Balances written (202 of them zero) | **205** |
| Orders with anything still owed | **3** — `303_Mary-Mukuria` 17,500, `298_Lucas-Destrijcker` 28,050, `306_Chiara-Magrelli` 4,052, all `To Launch Production` |
| Payment dates corrected | **20** |
| …of those, ones that move an order's `Order Month` | **3** |
| …of those, more than 7 days out, so an Info row each | **2** |
| Clients given a KRA PIN | **20** of 189 |
| New errors introduced | **0** — all 5 are the pre-existing `line-totals-match-invoice` cases |

The three month movers are `278_Logan-Christi` (Jun → Jul), `272_Namikoye-Lusweti`
(May → Jun) and `145_Ahmed-Ayman` (Nov 2025 → Sep 2025). The earlier estimate of
seven was made against `last_payment_date`; fetching the real first payment
resolved four of them back into their original month, which is the whole reason
the first payment is what gets written.

`145_Ahmed-Ayman` is the one worth knowing about: Airtable had 2025-11-03 against
an invoice whose only payment was 2025-09-06 — a date recorded two months after
the money arrived, where every other case was a few days before. Ben's call,
2026-08-27: **Zoho's first payment is the source of truth**, so it was written.

**Three PINs to look at.** The seeding mirrors what Zoho holds and fills blanks
only; it does not judge. Two clients came out sharing one PIN — `Knead Bakery`
and `Siafu Homes` are both `P050000003G` — and `Cheche Books` has `P000000003G`.
A PIN is unique to a taxpayer, so at least two of those three are wrong in Zoho,
and the fix belongs on the Zoho contact rather than in Airtable. Nothing here
overwrites them once corrected: the seeding only ever fills a blank.

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

### Order creation — live 2026-08-31

Built, tested and run. `INV640441` became **`308_Bastien-Renouil`**: a new
Base - Clients row, an order at `To Launch Production` carrying the delivery
date, the ex-VAT delivery charge and the eTIMS number, and three line items in
Coral joined by `item_id`, totalling 17,000 against a goods total of 17,000. The
driver's message renders. `Sync - Runs.Orders Created` has a 1 in it for the
first time.

**Two mislabelled products, found on the way.** Zoho sells `Wide Base`
(…602030) and `Wide Base (Trimmed)` (…540004) as separate items. Airtable has
**two active products both named `Wide Base (Trimmed)`**, one pointed at each —
and the same for `Wide Extension`. The id join is right and the Airtable *name*
is wrong, so a created line for a plain Wide Base reads "(Trimmed)" to the
workshop. Both are already Open in `Sync - Log` as `catalogue-prices-agree`
warnings from the 30 August nightly pass. Renaming the two rows pointed at
…602030 and …602017 back to `Wide Base` and `Wide Extension` fixes it. Duplicates
created 2026-08-15.

**One thing not understood.** The full read-only pass on 31 August reported
`warnings: 0` while those two rows were open and unchanged, and did not advance
their `Last Seen`. The check itself is sound — run in isolation against the same
live catalogues it produces exactly those two warnings — so this is unexplained
rather than diagnosed. The next nightly full pass settles it for free; do not
spend a 350-call pass on it by hand.

### Open decisions
- [ ] Should `VAT Exempt` drive anything? Today it is a flag the order form
      reports and nothing acts on, because Zoho records no exemption against any
      contact. Making it real means `is_taxable: false` and an exemption reason
      on the Zoho contact, and answering who owns it — see "VAT exempt".
- [ ] eTIMS field in Airtable — Zoho-owned, one-way, nothing blocks on it
- [ ] Quotes vs draft-as-quote (would need the PDF template redone)
- [ ] `sku = module_id` — needs `is_sku_enabled` switched on in Zoho
- [ ] Margin: apply a hand-set percent to actual revenue, or recompute from
      `Zoho Line Total` minus materials cost (needs one more lookup)
- [ ] A separate Server-based Zoho client for the web credential, so the two stop
      sharing a `client_secret`
- [ ] Delete the leftover `zzz - delete me (blank-test probe)` field in Line Items

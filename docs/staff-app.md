# /app, the staff app

> What this is: one place for staff, reached with one Google sign-in: clients, their designs, invoices, deliveries, and links
> to the other private pages.
> When to read it: before touching anything under `app/`, `js/app/`, `css/app.css`, `app-api.mjs` or `_app*.mjs`, or
> adding a module. Why it is shaped this way, with the evidence: https://claude.ai/artifact/TvELrMeKrrJzPXJSHV4tiA

**The test for every decision: delete the app and lose only the interface.** Airtable and Zoho hold every fact.

## Pieces

| File | What it is |
|---|---|
| `netlify/functions/_session.mjs` | The signed cookie: who someone is, what they may open. |
| `netlify/functions/_staff.mjs` | The Staff table, and the rule that the owner can't be locked out. |
| `netlify/functions/auth-google.mjs` | `/api/auth/google`, `/api/auth/logout`, `/api/me`. |
| `netlify/functions/_auth.mjs` | Unchanged for keys. `refuse(req, { module })` also opens to a session with that module. |
| `netlify/functions/_appcore.mjs` | Every rule: who may do what, what each request does. No I/O. |
| `netlify/functions/_appstore.mjs` | That over Airtable. |
| `scripts/lib/app-memory-store.mjs` | The same over memory, for the dev server, the tests and the demo. |
| `netlify/functions/_designinfo.mjs` | What a design is, and the same shelf in another colour, through the builder's engine. |
| `netlify/functions/app-api.mjs` | `/api/app/*`, `/api/design-image/<CODE>`, the routes for the PC job, and the Places calls on `GOOGLE_MAPS_KEY`. |
| `netlify/functions/_log.mjs` | The one log: each change in the app and each sync pass. `/api/log` on the runner's key. |
| `js/app/rules.js` | The small rules browser and server share: search, delivery days, the line under a name. |
| `js/app/app.js`, `css/app.css`, `app/` | The app itself: one page, no build step. |
| `js/app/staff-bar.js` | The strip under `/builder`. Only loads for someone signed in. |
| `js/app/staff-nav.js` | A way back to the app from the older private pages. |
| `scripts/add-app-tables.mjs` | The Airtable tables and fields. Additive, dry run by default. |
| `scripts/test-app.mjs` | Every behaviour, run over both stores. |
| `../framework-ops/reconciliation/client_pages.py` | Keeps pages true to the chats and the books. Its first run is the backfill. |

## Rules that are easy to break

- **One writer.** The order sync stays the only writer of orders, lines and money (`docs/order-sync.md`). The app writes only
  the delivery fields on an order, and reaches Zoho only through `zoho-push.mjs`'s `push`.
- **`Delivery - Date Set` stays off until a time is agreed**, so the driver's message keeps saying the date isn't firm.
- **Never delete.** A design is archived. A person's edit always beats the PC job, which only fills blanks.
- **A name never joins two people.** Linking a chat takes a link or a number. A name only suggests.
- **What is in Blobs can be lost:** the search list, pictures, the most-used list, a copy of the staff list. Anything else
  goes in Airtable. The exception that predates this is the design store, so a design on a page also keeps its hash in
  `Clients - Designs`.
- **A page is made by a person, never by a job.** Not everyone sent a design becomes a client. A design sent in a chat with no
  page waits on a `Clients - Designs` row with `Chat ID` and no client, and comes along when someone makes the page from
  that chat. A page's row is a Base - Clients row from then on, with no Zoho Contact ID until its first invoice, so anything
  that reads Base - Clients as "people who ordered" has to look at orders or the contact id.
- **Neither approval nor payment holds back a delivery.** A draft's day goes on the Zoho draft (`cf_delivery_date`, which
  the sync carries to the order) and on its design rows, so the page and the planner can show it meanwhile.
- **Chat links go through `rules.chatHref`.** Tried on a phone on 7 Nov: Business Suite opens a WhatsApp chat from its "all"
  inbox address and not the stored one. An Instagram chat shows "Facebook user" and goes nowhere from either, so on a phone
  it opens the inbox. `wa.me` and `ig.me` open other apps, not the business inbox.
- **Who did it comes from the sign-in.** Peter and Patrick can edit the delivery page. Everything anyone does there goes to the
  log through `POST log`, and the page can't say it was someone else. Giving an order its day stays with the client page.
- **`app/planner.html` is public, as any static file is.** It's built by `assemble_planner.py` with none of the real orders,
  runs or pay in it. Real orders reach it through the bridge. Runs don't save yet: only days, windows and client answers do.
- **One log (`_log.mjs`).** What happened goes there, app and sync alike: never a new Airtable table, which would eat a base
  capped at 50,000 rows. `Sync - Log` is the other half, what a person has to act on.
- **Formula fields can't be made through Airtable's API**, so nothing depends on one: `Client ID` is plain text beside each link.

## Running it

```bash
npm run dev                     # http://127.0.0.1:8770/app, empty and invented
node scripts/test-app.mjs       # also part of npm test
node scripts/test-session.mjs   # sign-in
```

With real data, from `out/app-mock/` on the PC, which is in no repo because it holds client data: `node serve.mjs 8772`.

The login page lists the staff on a dev server; there is no Google there.

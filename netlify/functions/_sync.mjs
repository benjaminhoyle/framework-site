// The reconciler: compare Zoho to Airtable, and say where they disagree.
//
// It compares STATE, not events. That is the whole design: a missed webhook, a
// crashed pass, an invoice edited by hand in Zoho, or an invoice deleted
// outright all show up on the next run, because nothing depends on having
// observed the moment it happened.
//
// Direction is one-way and absolute: Zoho is the source of truth on money and on
// what was sold; Airtable owns everything operational — production status,
// delivery scheduling, QC, post-sale check-in — and none of that ever travels
// back. Delivery *date* is the sharp case: Zoho seeds it once at order creation
// and Airtable owns it forever after, because deliveries get rescheduled and
// Zoho never hears about it. Do not "fix" that by syncing it back.
//
// It reports; a human fixes the source. The one exception is the field set the
// sync owns outright (delivery charge, invoiced line prices), which it may write
// once `mode` is 'write'.

import * as zoho from './_zoho.mjs';
import { TABLES, all, patch, create } from './_airtable.mjs';

const ERROR = 'Error', WARN = 'Warning', INFO = 'Info';

/**
 * How far a payment date may MOVE before the correction is worth mentioning.
 *
 * Airtable recorded the day a deposit confirmed the order; Zoho records the day
 * it cleared, and Zoho now wins — the date is written, not argued with. A day or
 * three between those is the normal working gap and nobody needs telling that it
 * has been tidied up. A move of more than a week is a different animal: usually
 * an order pointed at the wrong invoice, occasionally a deposit recorded months
 * before the books saw it. That is worth one line somebody can glance at, once,
 * because the next pass finds the two already agreeing and says nothing.
 */
const PAYMENT_DRIFT_DAYS = 7;
const now = () => new Date().toISOString();

/**
 * The day the sync started creating orders. Invoices dated before it are left
 * exactly as they are.
 *
 * A fixed date, not "today" computed at runtime — a floor that moves with the
 * clock is not a floor. Ben's call, 2026-08-31: new invoices only, so the first
 * runs work on orders he recognises rather than materialising a year of history
 * for jobs finished long ago. The six older paid invoices with no order stay as
 * Info rows in the log, which is where they have always been.
 */
export const CREATE_ORDERS_FROM = '2026-08-31';

/**
 * The order status a newly created order starts in. Ben's rule, 2026-08-31:
 * partly or fully paid means the workshop can start, merely sent does not.
 *
 * Returns null for anything else — draft and void have no order to be, and a
 * status Zoho invents later must not quietly become "start building this".
 */
export function orderStatusFor(invoiceStatus) {
  if (invoiceStatus === 'paid' || invoiceStatus === 'partially_paid') return 'To Launch Production';
  // `viewed` is `sent` plus a read receipt, and `overdue` is `sent` plus time.
  if (['sent', 'viewed', 'overdue', 'unpaid'].includes(invoiceStatus)) return 'Invoice Sent';
  return null;
}

/**
 * A custom field's real value, not the one Zoho formatted for display.
 *
 * Every custom field comes back three times: `cf_delivery_date` is
 * "04 Sep 2026", `cf_delivery_date_formatted` is the same, and
 * `cf_delivery_date_unformatted` is "2026-09-04". Only the last is a date
 * Airtable will take. The same split makes `cf_client_pickup` the STRING
 * "false" while `cf_client_pickup_unformatted` is the boolean false — so
 * `=== true` against the plain key can never be true, whichever way the box is
 * ticked.
 *
 * Both of those were live bugs in `seedDelivery` until 2026-08-31: it wrote a
 * display-format date into a date field, and it could not tick Client Pickup at
 * all. Read every custom field through here.
 */
export function cfv(cf, name) {
  const raw = cf || {};
  return raw[`${name}_unformatted`] !== undefined ? raw[`${name}_unformatted`] : raw[name];
}

/** A lookup field arrives as an array even when it holds one value. */
const num1 = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * Zoho renamed items over the years; old invoice lines keep the old name.
 *
 * Line-item names are a SNAPSHOT taken when the invoice was raised — unlike the
 * customer name, which is read live from the contact. So a 2025 invoice still
 * says `Shelf - Standard Base` for what the catalogue now calls `Standard Base`,
 * and matching those lines to today's products by name fails without this.
 */
export const stripLegacy = (n) => String(n || '').replace(/^Shelf - /, '');

/**
 * Historical renames, for the lines that cannot be resolved any other way.
 *
 * Almost nothing needs this. An invoice line carries `item_id`, which survives
 * every rename, so 95% of lines resolve to today's product without a single
 * alias — Zoho maintains the mapping for us. This exists only for the ~5% of
 * lines typed without picking a catalogue item, and those are usually custom
 * work with no Airtable product either.
 *
 * Resist growing it. A hand-kept rename table is a second source of truth about
 * the catalogue, and it goes stale silently.
 */
const RENAMED = new Map([
  ['lamp mount', 'lamp'],
  ['lamp mount - left', 'lamp'],
  ['lamp mount - right', 'lamp'],
  // Confirmed by Ben, 2026-08-24, against the orders they were blocking:
  // Zoho invoices these under the older names, Airtable carries the current ones.
  ['adapter unit', 'wide adapter'],
  ['coat hanger module', 'deep hanger']
]);

/**
 * Names that mean "bespoke", whichever system they are typed into.
 *
 * `Custom Deep Base` on an invoice and `Medium Base` on an order are both
 * one-off work rather than catalogue products, and both belong in the same
 * bucket as `Custom Item` — which is the bucket that cannot be reconciled line
 * by line, because there is no catalogue entry on either side to reconcile
 * against.
 *
 * A prefix rather than a list of exact names, deliberately: these are open
 * families that grow every time somebody types a new one-off, and a list of
 * exact names would go stale silently. Neither prefix collides with a real
 * family — the catalogue's are standard, compact, wide, deep, slim, broad and
 * corner.
 */
const BESPOKE_PREFIXES = ['custom ', 'medium '];
const CATCH_ALL = 'custom item';

/** Is this product one of the catch-alls, under any of its names? */
export const isCatchAll = (name) => canonicalItem(name) === CATCH_ALL;

/**
 * A product name reduced to what it identifies.
 *
 * Invoice line names are snapshots, so a 2025 line carries whatever the
 * catalogue was called then: `Shelf - Standard Base`, `Compact Base` for what is
 * now `Compact Base (Trimmed)`, `Lamp Mount` for `Lamp`.
 *
 * "(Trimmed)" is dropped on BOTH sides rather than mapped in one direction,
 * because the drift runs both ways — Zoho says `Compact Base` where Airtable
 * says trimmed, and `Standard Extension (Trimmed)` where Airtable says plain.
 */
export function canonicalItem(name) {
  const base = stripLegacy(name).replace(/\s*\(Trimmed\)\s*$/i, '').trim().toLowerCase();
  const renamed = RENAMED.get(base);
  if (renamed) return renamed;
  if (BESPOKE_PREFIXES.some((prefix) => base.startsWith(prefix))) return CATCH_ALL;
  return base;
}

/**
 * Which Airtable line is which invoice line.
 *
 * Exact names first. Only then the canonical fallback, and only where exactly
 * one unclaimed name on each side canonicalises the same way — because Zoho
 * still sells a genuine `Compact Base` alongside the trimmed one, and a blanket
 * rename would quietly misfile every future sale of it. Ambiguity is left
 * unmatched on purpose: a shortfall someone investigates beats a number that is
 * confidently wrong.
 */
export function matchProducts(airtableNames, zohoNames) {
  const out = new Map();
  const freeA = new Set(airtableNames);
  const freeZ = new Set(zohoNames);
  for (const a of airtableNames) {
    if (freeZ.has(a)) { out.set(a, a); freeA.delete(a); freeZ.delete(a); }
  }
  const bucket = (names) => {
    const m = new Map();
    for (const n of names) {
      const k = canonicalItem(n);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(n);
    }
    return m;
  };
  const bz = bucket(freeZ);
  for (const [k, as] of bucket(freeA)) {
    const zs = bz.get(k);
    if (as.length === 1 && zs && zs.length === 1) out.set(as[0], zs[0]);
  }
  return out;
}

/**
 * How much of each line survives an invoice-level discount.
 *
 * Zoho can discount the whole invoice rather than each line. Airtable stores
 * money per line, so the discount is spread across lines in proportion — that
 * way each product's realised revenue reflects what the customer actually paid
 * for it, and per-product margin stays honest.
 */
export function apportionFactor(gross, discount) {
  if (!(gross > 0) || !(discount > 0)) return 1;
  return (gross - discount) / gross;
}

/**
 * "14:30" as an Airtable duration, which is a count of SECONDS.
 *
 * Zoho stores the delivery window as text against a 24h regex; Airtable's
 * `Delivery Window Start` / `End` are duration fields formatted h:mm. Writing
 * the string straight across silently stores nothing.
 */
export function hhmmToSeconds(hhmm) {
  const m = /^([0-9]|0[0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
}

/**
 * The delivery details an invoice can seed onto a brand-new order.
 *
 * **Seed once, never overwrite.** This is the delivery-date rule applied to
 * everything that travels with a delivery date: Zoho seeds it at order creation
 * and Airtable owns it forever after, because deliveries get rescheduled and
 * re-confirmed by people looking at Airtable, and Zoho never hears about it. An
 * invoice raised in July must not be able to un-confirm a delivery that ops
 * moved to September.
 *
 * So every field here is written only where the order has nothing at all. That
 * makes the whole thing idempotent, and makes a re-run of a full pass harmless.
 *
 * The date status lands on **`Delivery - Date Set`**, the checkbox that was
 * already there, rather than on a field of its own. That checkbox is not decor:
 * `Delivery Details Summary` — the text the delivery team is sent — reads
 *
 *     IF({Delivery - Date Set}, <the window>, <the date> & " (⚠️ Delivery date
 *     not confirmed)")
 *
 * so it is exactly the tentative/confirmed distinction the form is asking about,
 * already wired to the people who act on it. A second field saying the same
 * thing would be two answers to one question, which is the divergence this whole
 * pass exists to remove.
 *
 * `Delivery - Date Set` and `Client Pickup` are both one-directional, because a
 * checkbox cannot distinguish "no" from "nobody said". An invoice can tick one;
 * an invoice merely silent about it can never untick a box somebody ticked.
 *
 * There is no separate status for the TIME. A window somebody typed is a window
 * they meant, and `Delivery Details Summary` already gates the whole slot on
 * `Delivery - Date Set` — so a second flag would have been a question the driver
 * never gets asked.
 */
export function seedDelivery(order, cf) {
  const has = (name) => {
    const v = order[name];
    return v !== undefined && v !== null && v !== '';
  };
  const out = {};
  const date = cfv(cf, 'cf_delivery_date');
  if (!has('Delivery - Scheduled Date') && date) out['Delivery - Scheduled Date'] = String(date);
  const start = hhmmToSeconds(cfv(cf, 'cf_delivery_window_start'));
  const end = hhmmToSeconds(cfv(cf, 'cf_delivery_window_end'));
  if (!has('Delivery Window Start') && start != null) out['Delivery Window Start'] = start;
  if (!has('Delivery Window End') && end != null) out['Delivery Window End'] = end;
  if (order['Delivery - Date Set'] !== true && cfv(cf, 'cf_delivery_date_status') === 'Confirmed') {
    out['Delivery - Date Set'] = true;
  }
  if (order['Client Pickup'] !== true && cfv(cf, 'cf_client_pickup') === true) out['Client Pickup'] = true;
  return out;
}

/**
 * A whole order, from an invoice that has none.
 *
 * This is the applet's Step 4 without its Step 5. `airtable_zoho_import.html`
 * could not know an order's `Order ID` — it is a formula over an autoNumber, so
 * it does not exist until the row does — which is why the applet emits a paste
 * block, waits for a person to paste the generated names back in, and only then
 * can key the line items. Creating through the API returns the record id, so
 * the order and its lines are written in one movement and that round trip
 * disappears.
 *
 * Everything the invoice can answer is set here, because the blocks that
 * normally fill an order in later all run off an order this pass has already
 * read. A record created during the pass is not in that list, so what is not set
 * now waits a whole cycle.
 */
export function orderFieldsFromInvoice(full, m, clientRecId, firstPayment) {
  const cf = full.custom_field_hash || {};
  const fields = {
    'Order Status': orderStatusFor(full.status),
    'Client Name': [clientRecId],
    // The invoice date, which is what the applet used for "Order Received" too.
    'Order Received': String(full.date),
    'Zoho Invoice': full.invoice_number,
    'Balance to Pay': zoho.round2(Number(full.balance) || 0)
  };
  if (firstPayment) fields['Payment Received'] = firstPayment;
  const design = cfv(cf, 'cf_design_details') || cfv(cf, 'cf_design_code');
  if (design) fields['Design Link / Details'] = String(design);
  const date = cfv(cf, 'cf_delivery_date');
  if (date) fields['Delivery - Scheduled Date'] = String(date);
  const start = hhmmToSeconds(cfv(cf, 'cf_delivery_window_start'));
  const end = hhmmToSeconds(cfv(cf, 'cf_delivery_window_end'));
  if (start != null) fields['Delivery Window Start'] = start;
  if (end != null) fields['Delivery Window End'] = end;
  if (cfv(cf, 'cf_delivery_date_status') === 'Confirmed') fields['Delivery - Date Set'] = true;
  if (cfv(cf, 'cf_client_pickup') === true) fields['Client Pickup'] = true;
  // Ex-VAT, like the field it lands in and unlike every other money figure here.
  if (m.hasDeliveryLine) fields['Delivery - Charged Client (ex VAT)'] = m.deliveryExVat;
  const etims = cfv(cf, 'cf_etims_invoice_number');
  if (etims) fields['eTIMS Invoice Number'] = String(etims);
  return fields;
}

/**
 * An invoice's goods, as Orders - Line Items rows.
 *
 * Joined on `item_id`, never on the name. The applet had to match by name —
 * `convertItemName()` is forty lines of substring tests that still map to
 * "Lamp Mount - Left", a product the catalogue stopped calling that — because a
 * CSV export has no ids in it. We have them, they survive every rename, and 58
 * of 59 active products carry theirs. The one that does not is `Custom Item`,
 * which has no Zoho twin by design.
 *
 * A line that matches nothing keeps its Zoho name in `Other Item Name` rather
 * than being dropped or guessed at. That is the applet's own fallback column,
 * and a line nobody can price is still a line somebody has to build.
 *
 * Delivery never appears: it is a FIELD on the order, not a line on it, so
 * `money()` has already filtered it out of `m.lines`. The applet excluded it
 * too, and said how many it had excluded.
 */
export function lineFieldsFromInvoice(m, products, orderRecId, factor = 1) {
  const byZohoId = new Map();
  for (const p of products) {
    const id = String(p.fields['Zoho Item ID'] || '').trim();
    if (id) byZohoId.set(id, p);
  }
  return (m.lines || []).map((li) => {
    const product = byZohoId.get(String(li.item_id || '').trim());
    const colour = (li.item_custom_fields || []).find((c) => c.api_name === 'cf_color')?.value;
    const fields = {
      Order: [orderRecId],
      Quantity: Number(li.quantity) || 1,
      // Priced from the invoice on the way in, so the order reconciles on the
      // very first pass rather than reporting itself short until the next one.
      'Zoho Unit Rate': zoho.round2(li.rate * factor),
      'Zoho Line Total': zoho.round2(li.rate * li.quantity * factor)
    };
    if (product) fields.Item = [product.id];
    else fields['Other Item Name'] = stripLegacy(li.name) || 'Custom Item';
    if (colour) fields.Color = colour;
    if (li.description) fields.Notes = String(li.description).slice(0, 500);
    return fields;
  });
}

/**
 * The Base - Clients row for a Zoho customer, or the fields to create one.
 *
 * Resolved by `Zoho Contact ID` first, then by name — the id is exact, and the
 * name is what catches a client somebody typed in before the ids existed. A
 * name match backfills the id, so the next invoice resolves exactly and the
 * base stops drifting.
 *
 * Names are matched case-insensitively and whitespace-collapsed, because
 * "Base - Clients has no uniqueness constraint of its own" and a second row for
 * one person is worse than none: `Order ID` is `Order Code & "_" & Client Name`,
 * so two of the same person means orders that look interchangeable and are not.
 */
export function resolveClient(full, clients) {
  const wantId = String(full.customer_id || '').trim();
  const tidy = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const wantName = tidy(full.customer_name);
  const byId = clients.find((c) => String(c.fields['Zoho Contact ID'] || '').trim() === wantId);
  if (byId) return { row: byId };
  const byName = wantName && clients.find((c) => tidy(c.fields.Name) === wantName);
  // Matched by name only. Hand back the id it is missing so the caller can give
  // it one — otherwise every future invoice for this person matches by name
  // again, and a rename would lose them entirely.
  if (byName) {
    const held = String(byName.fields['Zoho Contact ID'] || '').trim();
    return { row: byName, backfillId: held || !wantId ? null : wantId };
  }

  const cf = full.custom_field_hash || {};
  const fields = { Name: String(full.customer_name || '').trim(), 'Zoho Contact ID': wantId };
  const phone = cfv(cf, 'cf_primary_contact_number');
  const address = cfv(cf, 'cf_delivery_address');
  const pin = String(full.tax_reg_no || '').trim();
  if (phone) fields['Primary Phone Number'] = String(phone).trim();
  if (address) fields.Address = String(address).trim();
  if (pin) fields['KRA PIN'] = pin;
  return { create: fields };
}

/** Whole days between two ISO dates, whichever way round they are. */
export function daysApart(a, b) {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : 0;
}

/**
 * Which products an order has that its invoice does not, and the reverse.
 *
 * The money gap alone says a line is missing; this says which, so the finding
 * is something to act on rather than something to open two systems to explain.
 * Both sides are matched through `matchProducts`, so three years of renames do
 * not read as absences.
 *
 * Takes `{ name, quantity }` on both sides. Quantities are reported but not
 * compared: a product on both sides in the wrong number is a different fault
 * with a different fix, and folding the two together yields a sentence that is
 * true of neither.
 */
export function unmatchedLines(airtable, zoho_) {
  const aNames = (airtable || []).map((l) => l.name).filter(Boolean);
  const zNames = (zoho_ || []).map((l) => l.name).filter(Boolean);
  const matched = matchProducts([...new Set(aNames)], [...new Set(zNames)]);
  const claimed = new Set(matched.values());
  const say = (rows, keep) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.name || !keep(r.name)) continue;
      m.set(r.name, (m.get(r.name) || 0) + (Number(r.quantity) || 1));
    }
    return [...m.entries()].map(([n, q]) => (q > 1 ? `${q} x ${n}` : n));
  };
  return {
    onInvoice: say(zoho_ || [], (n) => !claimed.has(n)),
    inAirtable: say(airtable || [], (n) => !matched.has(n))
  };
}

/** Run `fn` over `list` a few at a time — serial is too slow for a full pass. */
async function pool(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  }
  return out;
}

/**
 * Everything the reconciler reads, in one place so a test can supply it.
 *
 * Zoho allows 2,000 calls a day, so exercising the checks against the live API
 * is not something you can do freely — and the checks are the part most worth
 * testing. Injecting the reads makes every one of them testable at zero cost,
 * offline, against data shaped like the awkward cases we actually hit.
 */
export const liveIO = {
  orders: () => all(TABLES.orders),
  lines: () => all(TABLES.lines),
  products: () => all(TABLES.products),
  // Read for one reason: the KRA PIN seeding below. It is an Airtable read, so
  // it costs nothing against the Zoho budget that shapes everything else here.
  clients: () => all(TABLES.clients),
  items: () => zoho.items(),
  invoices: (since) => zoho.invoices(since ? { since } : {}),
  detail: (id) => zoho.invoice(id),
  payments: (id) => zoho.payments(id)
};

export async function reconcile({ mode = 'read-only', trigger = 'Manual', since = null, io = liveIO } = {}) {
  const started = now();
  const callsAtStart = zoho.calls.n;
  const findings = [];
  const add = (severity, check, event, extra = {}) =>
    findings.push({ severity, check, event, ...extra });

  // ---- read both sides -------------------------------------------------
  // The catalogue check costs a paged Zoho read and prices do not move every
  // five minutes, so an incremental pass skips it. Zoho allows 2,000 calls a
  // DAY; anything on the fast path has to justify its cost.
  const isFull = !since;
  const [orders, lines, products, clients, zItems, zInvoices] = await Promise.all([
    io.orders(), io.lines(), io.products(),
    // Optional so an older caller — or a fixture written before the PIN seeding
    // existed — still runs rather than dying on a missing reader.
    io.clients ? io.clients() : Promise.resolve([]),
    isFull ? io.items() : Promise.resolve(null),
    io.invoices(since)
  ]);

  // The day the pipeline starts caring. Derived from the data rather than
  // configured, so it cannot drift out of date: the oldest order Airtable holds
  // is the earliest point an invoice could possibly have had one.
  const epoch = orders
    .map((o) => o.fields['Order Received'])
    .filter(Boolean)
    .sort()[0] || '1970-01-01';

  const orderByInvoice = new Map();
  const linesByOrder = new Map();
  for (const l of lines) {
    for (const o of (l.fields.Order || [])) {
      if (!linesByOrder.has(o)) linesByOrder.set(o, []);
      linesByOrder.get(o).push(l);
    }
  }

  // ---- check: every invoice number is claimed by exactly one order ------
  for (const o of orders) {
    const num = String(o.fields['Zoho Invoice'] || '').trim();
    if (!num) continue;
    if (!orderByInvoice.has(num)) orderByInvoice.set(num, []);
    orderByInvoice.get(num).push(o);
  }
  for (const [num, os] of orderByInvoice) {
    if (os.length > 1) {
      add(ERROR, 'invoice-claimed-once', `${num} claimed by ${os.length} orders`, {
        invoice: num,
        orderRecIds: os.map((o) => o.id),
        detail: `Claimed by ${os.map((o) => o.fields['Order ID']).join(', ')}. An invoice belongs to exactly one order; split the order or correct the pointer.`
      });
    }
  }

  // ---- check: an order without an invoice must be Free/Heavy or Internal
  for (const o of orders) {
    if (String(o.fields['Zoho Invoice'] || '').trim()) continue;
    if (o.fields['Free / Heavy Discount']) continue;
    if (String(o.fields['Order ID'] || '').includes('Internal')) continue;
    add(ERROR, 'order-needs-invoice', `${o.fields['Order ID']} has no invoice`, {
      orderRecIds: [o.id],
      detail: 'An order with no Zoho invoice must be Free / Heavy Discount or Internal. This is neither, so either it was never invoiced or the pointer is missing.'
    });
  }

  // ---- check: live catalogue prices agree (full passes only) -----------
  if (zItems) {
    const liveZ = new Map(zItems.filter((i) => i.status === 'active').map((i) => [i.name, i]));
    const zById = new Map(zItems.map((i) => [String(i.item_id), i]));
    const liveA = products.filter((p) => p.fields.Status === 'Active');

    // -- an active product must be called what Zoho calls the item it points at
    //
    // `Zoho Item ID` is the join everything else trusts: prices, the line-total
    // reconciliation, and now the lines on a created order. The NAME is what a
    // person reads — on the order, in `Line ID`, and in the message the workshop
    // builds from. When the two disagree the join stays right and the label
    // lies, which is the worst shape a fault can take: nothing reconciles wrong,
    // and the wrong thing gets built.
    //
    // That is exactly what happened. Airtable had two active products both
    // called `Wide Base (Trimmed)` — one pointed at Zoho's `Wide Base`, one at
    // Zoho's `Wide Base (Trimmed)` — and the same for `Wide Extension`, from
    // 2026-08-15 until 2026-08-31. Ninety-two orders' worth of plain Wide Bases
    // read as trimmed ones. The old check below noticed only the symptom, that
    // `Wide Base` had no Airtable product, which sends somebody looking for a
    // missing row rather than a misnamed one.
    //
    // Active only. `Lamp Mount - Left` and `- Right` are Retired and both point
    // at today's `Lamp`, which is Zoho having consolidated two items into one —
    // renaming them would make three products called Lamp and lose which was
    // which.
    const claimed = new Set();
    for (const p of liveA) {
      const zid = String(p.fields['Zoho Item ID'] || '').trim();
      if (!zid) continue;
      const zi = zById.get(zid);
      if (!zi) continue;
      claimed.add(zi.name);
      if (zi.name !== p.fields.Name) {
        add(WARN, 'catalogue-prices-agree', `${p.fields.Name} is Zoho's ${zi.name}`, {
          detail: `Airtable calls item ${zid} "${p.fields.Name}"; Zoho calls it "${zi.name}". The id is what everything joins on, so prices stay right and the label is what is wrong — rename the Airtable product to match.`
        });
      }
    }
    for (const p of liveA) {
      // Id first, name only as a fallback — the same order everything else
      // joins in. Resolving by name alone made a misnamed product look like a
      // product with no Zoho item at all, which is the mirror of the symptom
      // the check above exists to replace: two rows, one fault, neither naming
      // it.
      const zid = String(p.fields['Zoho Item ID'] || '').trim();
      const z = (zid && zById.get(zid)) || liveZ.get(p.fields.Name);
      if (!z) {
        // Its own detail line already said "expected only for catch-alls like
        // Custom Item", and Custom Item is the only one it has ever fired on.
        // A warning that is always expected is one people learn to scroll past,
        // and it teaches them to scroll past the ones beside it.
        if (!isCatchAll(p.fields.Name)) {
          add(WARN, 'catalogue-prices-agree', `${p.fields.Name} has no active Zoho item`, {
            detail: 'Active in Airtable with no matching active Zoho item.'
          });
        }
        continue;
      }
      const ap = p.fields.Price;
      if (ap != null && Math.abs(ap - z.rate) > 0.01) {
        add(ERROR, 'catalogue-prices-agree', `${p.fields.Name}: ${ap} vs Zoho ${z.rate}`, {
          detail: `Airtable ${ap}, Zoho ${z.rate}. Pushes containing this item are blocked until they agree — one stale price must not stop unrelated sales.`
        });
      }
    }
    for (const [name] of liveZ) {
      if (isCatchAll(name)) continue;
      // Already reported, and better, by the name check above: an item held by
      // a product under the wrong name is not a MISSING product. One fault, one
      // row — two rows for one thing is how a log stops being read.
      if (claimed.has(name)) continue;
      if (!liveA.some((p) => p.fields.Name === name)) {
        add(WARN, 'catalogue-prices-agree', `${name} has no active Airtable product`, {
          detail: 'Sellable in Zoho with nowhere to land in Airtable. A sale of it would have no product to attach to.'
        });
      }
    }

  }

  // ---- check: one client, one row --------------------------------------
  // Base - Clients has no uniqueness constraint of its own, and the sync is
  // about to start creating rows in it. `Order ID` is `Order Code & "_" &
  // Client Name`, so two rows for one person means orders that look
  // interchangeable and are not — and a second row can silently take the next
  // invoice, splitting somebody's history in half.
  const seenClientId = new Map();
  const seenClientName = new Map();
  const tidyName = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  for (const c of clients) {
    const id = String(c.fields['Zoho Contact ID'] || '').trim();
    if (id) seenClientId.set(id, (seenClientId.get(id) || []).concat(c));
    const n = tidyName(c.fields.Name);
    if (n) seenClientName.set(n, (seenClientName.get(n) || []).concat(c));
  }
  for (const [id, rows] of seenClientId) {
    if (rows.length > 1) {
      add(ERROR, 'client-listed-once', `Zoho contact ${id} is on ${rows.length} client rows`, {
        detail: `${rows.map((r) => r.fields.Name).join(', ')} all carry the same Zoho Contact ID. One of them will take the next invoice and the others will look like clients who stopped ordering.`
      });
    }
  }
  for (const [, rows] of seenClientName) {
    // Only when they are not already reported above, so one fault is one row.
    const ids = new Set(rows.map((r) => String(r.fields['Zoho Contact ID'] || '').trim()));
    if (rows.length > 1 && !(ids.size === 1 && !ids.has(''))) {
      add(ERROR, 'client-listed-once', `${rows[0].fields.Name} is on ${rows.length} client rows`, {
        detail: 'Two Base - Clients rows share a name. Order ID is built from the client name, so their orders are indistinguishable — merge them and keep the one carrying the Zoho Contact ID.'
      });
    }
  }

  // ---- check: every line item belongs to an order ----------------------
  for (const l of lines) {
    if (!(l.fields.Order || []).length) {
      add(WARN, 'line-has-order', `orphan line ${l.fields['Line ID'] || l.id}`, {
        detail: 'A line item with no order contributes to nothing and is invisible in every rollup.'
      });
    }
  }

  // ---- per-invoice work ------------------------------------------------
  // Detail is required, not optional: the list response omits custom fields the
  // detail response returns.
  const interesting = zInvoices.filter((i) => i.status !== 'draft');
  const details = await pool(interesting, 5, async (i) => {
    try { return { list: i, full: await io.detail(i.invoice_id) }; }
    catch (e) { return { list: i, error: String(e.message).slice(0, 160) }; }
  });

  // Which Base - Clients row is which Zoho customer. `Zoho Contact ID` is
  // carried on the client record from birth, so this resolves rather than
  // guesses — the same join the push endpoint uses to avoid minting a second
  // contact for somebody who already has one.
  const clientByContact = new Map();
  for (const c of clients) {
    const id = String(c.fields['Zoho Contact ID'] || '').trim();
    if (id) clientByContact.set(id, c);
  }
  /** Best PIN found for a client this pass: record id -> { pin, date }. */
  const pinSeeds = new Map();

  let scanned = 0;
  // Creations are kept apart from patches on purpose. A patch is idempotent and
  // a create is not: replaying one makes a second record. They are applied last,
  // in their own step, so the ordinary work of a pass cannot be held up by them
  // and a failure here cannot half-apply a patch.
  const writes = { orders: [], lines: [], clients: [], creates: [] };
  const projection = [];

  for (const { list, full, error } of details) {
    if (error) {
      add(WARN, 'run-failure', `could not read ${list.invoice_number}`, { invoice: list.invoice_number, detail: error });
      continue;
    }
    scanned += 1;
    const num = full.invoice_number;

    // -- the client's KRA PIN, taken from where Zoho already stamped it
    //
    // Base - Clients has nowhere cheaper to get this from. The contact LIST
    // response omits `tax_reg_no` entirely, so reading it live would mean a
    // detail call per client — 374 of them, against 2,000 a day. The invoice
    // detail is already in hand for every non-draft invoice and carries the PIN
    // Zoho stamped on it, so this costs nothing at all.
    //
    // **Blanks only, and the newest invoice wins.** The invoice copy is a
    // snapshot, like `cf_primary_contact_number` beside it: a PIN corrected on
    // the contact afterwards must never be dragged back to whatever a 2024
    // invoice happened to carry. Filling a blank cannot do that. Overwriting
    // could, and would do it silently, on the field an accountant reads.
    const pin = String(full.tax_reg_no || '').trim();
    const clientRow = clientByContact.get(String(full.customer_id || ''));
    if (pin && clientRow && !String(clientRow.fields['KRA PIN'] || '').trim()) {
      const held = pinSeeds.get(clientRow.id);
      if (!held || String(full.date || '') > held.date) {
        pinSeeds.set(clientRow.id, {
          id: clientRow.id, name: clientRow.fields.Name, pin, date: String(full.date || '')
        });
      }
    }

    const order = (orderByInvoice.get(num) || [])[0];

    if (!order) {
      // Only from the epoch onward. Zoho goes back to 2023 and Airtable does
      // not; 108 invoices predate the pipeline entirely and are not gaps. A
      // report that opens with 108 rows nobody can act on is a report nobody
      // reads, which is how the markdown one failed.
      //
      // And only SHELVING. Orders - Pipeline is the shelving pipeline; a window
      // job or a picture frame has no order to be missing, and 17 of the 25 this
      // check was reporting were Custom Projects. Two thirds of a list being
      // things that are fine is how a list stops being read.
      const workType = cfv(full.custom_field_hash, 'cf_work_type');
      const wantStatus = orderStatusFor(full.status);

      // -- create it, when everything about it is unambiguous
      //
      // This is what `airtable_zoho_import.html` did by hand: find the invoices
      // with no order, build the client, the order and its lines, and paste
      // them in. Four conditions, each of which is somebody's decision rather
      // than a technicality:
      //
      //   Shelving only, because Orders - Pipeline IS the shelving pipeline. A
      //   window job or a picture frame has no order to be, which is why the
      //   Info check below has always filtered the same way.
      //
      //   Paid, part-paid or sent — never a draft, never a void. A draft is a
      //   quote somebody is still editing.
      //
      //   Dated on or after CREATE_ORDERS_FROM, so a year of finished history
      //   does not materialise as live orders overnight.
      //
      //   And nothing already claiming this invoice number. That is the same
      //   key `invoice-claimed-once` guards, and it is the whole duplicate
      //   defence: the applet's marker lives on the Zoho invoice
      //   (`cf_airtable_order_number`) and this credential has no
      //   invoices.UPDATE to stamp it, deliberately. The Airtable side is the
      //   better key anyway — a person cannot clear it by accident.
      if (workType === 'Shelving' && wantStatus && String(full.date) >= CREATE_ORDERS_FROM) {
        const resolved = resolveClient(full, clients);
        // The first payment, fetched now rather than left for the next pass:
        // an order created without it has a blank `Order Received` month.
        let firstPayment = null;
        if (full.last_payment_date) {
          try { firstPayment = (await io.payments(full.invoice_id))[0]?.date || null; }
          catch { firstPayment = full.last_payment_date; }
        }
        const m = zoho.money(full);
        // An invoice-level discount is spread across the lines, exactly as it is
        // for an order that already exists — otherwise a discounted order would
        // be created reconciling to the wrong total on the very next pass.
        const gross = (m.lines || []).reduce((n, li) => n + li.rate * li.quantity, 0);
        const factor = apportionFactor(gross, m.discount);
        writes.creates.push({
          invoice: num,
          customer: full.customer_name,
          status: wantStatus,
          client: resolved,
          order: (clientRecId) => orderFieldsFromInvoice(full, m, clientRecId, firstPayment),
          lines: (orderRecId) => lineFieldsFromInvoice(m, products, orderRecId, factor),
          // Plain data, so a read-only pass can show what it would write. The
          // closures above cannot be previewed: they are waiting on record ids
          // that do not exist until the write happens.
          preview: {
            order: orderFieldsFromInvoice(full, m, '(new client)', firstPayment),
            lines: lineFieldsFromInvoice(m, products, '(new order)', factor),
            newClient: resolved.create || null
          }
        });
        continue;
      }

      if (full.status === 'paid' && full.date >= epoch && workType === 'Shelving') {
        add(INFO, 'paid-invoice-no-order', `${num} is paid with no order`, {
          invoice: num,
          detail: `${full.customer_name}, ${full.date}, ${full.total}. Predates ${CREATE_ORDERS_FROM}, so the sync leaves it alone — it needs an order by hand, or is a delivery-only invoice.`
        });
      }
      continue;
    }

    const m = zoho.money(full);
    // Only an order the workshop is actively building is protected. `Delivered`
    // is finished — 225 of 230 orders sit there, and treating it as protected
    // would silently exclude almost the entire pipeline from the backfill.
    const inProduction = ['Production Launched', 'Pending Delivery', 'Pending Client Collect']
      .includes(order.fields['Order Status']);

    // -- delivery charge: the sync owns this field outright
    if (m.hasDeliveryLine) {
      const cur = order.fields['Delivery - Charged Client (ex VAT)'];
      if (cur == null || Math.abs(cur - m.deliveryExVat) > 0.02) {
        // Always computed, applied only in write mode. That way a read-only pass
        // can show exactly what it *would* do — a write you cannot preview is a
        // write you have to trust.
        writes.orders.push({
          id: order.id, orderId: order.fields['Order ID'], was: cur, now: m.deliveryExVat,
          fields: { 'Delivery - Charged Client (ex VAT)': m.deliveryExVat }
        });
        if (mode !== 'write') {
          add(INFO, 'metadata-drift', `${order.fields['Order ID']} delivery ${cur} -> ${m.deliveryExVat}`, {
            invoice: num, orderRecIds: [order.id],
            detail: 'Delivery charge differs from the invoice. This field is ex-VAT deliberately, so it can be compared against the driver rate.'
          });
        }
      }
    }

    // -- delivery scheduling: seeded from the invoice, once, onto a blank order
    //
    //    The rep typed the date, the window and whether each is agreed into the
    //    builder beside the design. Without this they type them a second time
    //    into Airtable, which is the duplication the order form exists to
    //    remove. `seedDelivery` fills blanks only; see the note on it.
    const seeds = seedDelivery(order.fields, full.custom_field_hash || {});
    if (Object.keys(seeds).length) {
      writes.orders.push({
        id: order.id, orderId: order.fields['Order ID'],
        was: null, now: Object.keys(seeds).join(', '),
        fields: seeds
      });
    }

    // -- balance: what is still to collect, straight off the invoice
    //
    // Written silently, like the eTIMS number below it, and for the same reason:
    // it is Zoho's own arithmetic and a difference is never something a person
    // has to act on — it is a payment landing. Reporting it would put a fresh
    // log row against every invoice every time somebody paid, and the log's
    // whole worth is that a clean pass writes nothing to it.
    //
    // Zero is written, not left blank. Blank is "nobody has looked"; zero is
    // "nothing is owed", which is the fact the delivery team needs — and it is
    // what stops the driver's message asking for money on a settled order.
    // Drafts never reach here, so an invoice nobody has issued yet stays blank
    // rather than claiming its total is due.
    const balance = zoho.round2(Number(full.balance) || 0);
    const heldBalance = order.fields['Balance to Pay'];
    if (heldBalance == null || Math.abs(heldBalance - balance) > 0.02) {
      writes.orders.push({
        id: order.id, orderId: order.fields['Order ID'],
        was: heldBalance ?? null, now: balance,
        fields: { 'Balance to Pay': balance }
      });
    }

    // -- eTIMS: added to the invoice after the sale, so it arrives late and
    //    always from Zoho. Nothing downstream waits on it.
    const etims = full.custom_field_hash?.cf_etims_invoice_number
      ?? full.cf_etims_invoice_number ?? null;
    if (etims && String(order.fields['eTIMS Invoice Number'] || '') !== String(etims)) {
      writes.orders.push({
        id: order.id, orderId: order.fields['Order ID'],
        was: order.fields['eTIMS Invoice Number'] ?? null, now: String(etims),
        fields: { 'eTIMS Invoice Number': String(etims) }
      });
    }

    // -- invoiced line prices: match Zoho lines to Airtable lines by product
    // Group the invoice's goods by Zoho item id where there is one, and by name
    // only where there is not. The id is what makes three years of renames a
    // non-problem: `Coat Hanger Module` and `Deep Hanger` are the same id, so no
    // alias table has to know they are the same thing.
    const zByKey = new Map();
    for (const li of m.lines) {
      const k = li.item_id || `name:${stripLegacy(li.name)}`;
      const prev = zByKey.get(k) || { qty: 0, total: 0, rate: li.rate, name: stripLegacy(li.name) };
      zByKey.set(k, {
        qty: prev.qty + li.quantity,
        total: prev.total + li.rate * li.quantity,
        rate: li.rate, name: prev.name
      });
    }
    const zByName = new Map();
    for (const [k, v] of zByKey) if (k.startsWith('name:')) zByName.set(v.name, v);
    const aLines = linesByOrder.get(order.id) || [];
    // Resolve Airtable product names to invoice line names before pricing:
    // three years of renames mean the two rarely agree letter for letter.
    const aNames = [...new Set(aLines
      .map((l) => products.find((p) => p.id === (l.fields.Item || [])[0])?.fields?.Name)
      .filter(Boolean))];
    const nameMap = matchProducts(aNames, [...zByName.keys()]);  // id-less lines only
    // An invoice-level discount is apportioned across lines, so each line's
    // stored total is what that line actually earned.
    // Every goods line, not just the id-less ones: zByName holds only the
    // fallback remainder now, and apportioning against it would divide the
    // discount by almost nothing and leave it unapplied.
    const gross = [...zByKey.values()].reduce((n, v) => n + v.total, 0);
    const factor = apportionFactor(gross, m.discount);

    for (const al of aLines) {
      const pid = (al.fields.Item || [])[0];
      const pname = products.find((p) => p.id === pid)?.fields?.Name;
      // Id first — it is immune to renaming. Name only as a fallback, for the
      // lines someone typed by hand without picking a catalogue item.
      const prod = products.find((p) => p.id === pid);
      const zid = prod?.fields?.['Zoho Item ID'];
      const z = (zid && zByKey.get(zid))
        || (pname ? zByName.get(nameMap.get(pname) ?? pname) : null);
      if (!z) continue;
      const want = zoho.round2(z.total * factor * ((al.fields.Quantity || 0) / (z.qty || 1)));
      const have = al.fields['Zoho Line Total'];
      const pending = {
        id: al.id, orderId: order.fields['Order ID'], product: pname,
        was: have, now: want,
        // What Subtotal reads TODAY — the formula's own output, not
        // quantity x catalogue price. Lines already carry a Discount percent
        // (that is how zero-rated freebies were recorded before this existed),
        // so deriving the "before" from the catalogue overstates the change.
        wasSubtotal: zoho.round2(num1(al.fields.Subtotal) || 0),
        fields: { 'Zoho Line Total': want, 'Zoho Unit Rate': zoho.round2(z.rate * factor) }
      };
      if (have == null) {
        // Backfill. Filling a field that has never held a value changes nothing
        // that existed, so it is safe whatever state the order is in.
        writes.lines.push(pending);
      } else if (Math.abs(have - want) > 0.02) {
        // A real change: the invoice moved after we had already recorded it.
        if (inProduction) {
          add(ERROR, 'line-changed-in-production', `${order.fields['Order ID']} line changed mid-build`, {
            invoice: num, orderRecIds: [order.id],
            detail: `${pname}: stored ${have}, invoice now ${want}. NOT applied — the workshop is building from this record.`
          });
        } else {
          writes.lines.push(pending);
          add(WARN, 'metadata-drift', `${order.fields['Order ID']} ${pname} ${have} -> ${want}`, {
            invoice: num, orderRecIds: [order.id],
            detail: 'The invoice line changed after it was last recorded. Zoho is the source of truth on money, so the new figure is applied.'
          });
        }
      }
    }

    // -- revenue must reconcile once the lines carry invoiced totals
    // What this order's revenue WOULD be once the pending writes land, against
    // what the invoice says it should be. This is the acceptance test for a
    // write pass: agreement means the line set is complete on both sides.
    const pendingHere = writes.lines.filter((w) => w.orderId === order.fields['Order ID']);
    const projected = zoho.round2(aLines.reduce((n, l) => {
      const w = pendingHere.find((x) => x.id === l.id);
      return n + (w ? w.now : (l.fields['Zoho Line Total'] || 0));
    }, 0));
    projection.push({
      orderId: order.fields['Order ID'], invoice: num,
      target: zoho.round2(m.goods - m.discount), projected
    });

    // Judge the state this pass LEAVES BEHIND, not the one it found. Summing the
    // values read before the write meant a write pass flagged its own work in
    // progress: three orders were reported as short by the very pass that was
    // filling them in.
    const anyStored = aLines.some((l) => l.fields['Zoho Line Total'] != null);
    const target = zoho.round2(m.goods - m.discount);
    if ((anyStored || pendingHere.length) && Math.abs(projected - target) > 1) {
      // Say WHICH. "Revenue 41600 vs 55600" is a number somebody then has to
      // open two systems to explain; "no Airtable line for 2 x Standard
      // Extension" is a thing they can go and fix. The matching is already done
      // above for pricing, so naming what it could not match costs nothing.
      const missing = unmatchedLines(
        aLines.map((l) => ({
          name: products.find((p) => p.id === (l.fields.Item || [])[0])?.fields?.Name,
          quantity: l.fields.Quantity
        })),
        (m.lines || []).map((l) => ({ name: stripLegacy(l.name), quantity: l.quantity }))
      );

      // Lines somebody typed an amount into without picking a catalogue item.
      // They have no name, so nothing on either side can ever be matched to
      // them and no amount of editing the ORDER will close the gap. INV640214
      // carries five, worth 14,000, which is exactly the shortfall that made
      // 88_Michael-Lotem_Yahel look like four missing decorations.
      const nameless = (m.lines || []).filter((l) => !String(l.name || '').trim());
      const namelessValue = zoho.round2(nameless.reduce((n, l) => n + l.rate * l.quantity, 0));

      // Bespoke work cannot reconcile, by construction, on either side.
      //
      // `Custom Item` has no Zoho twin — that is what it is for — so it
      // contributes nothing to the projected total and the order is short by
      // exactly its value on every pass, forever. The same is true in reverse:
      // an invoice line called `Custom Deep Base` against an order line called
      // `Medium Base` is two people describing one piece of one-off work, and
      // there is no catalogue entry behind either to reconcile them through.
      // `matchProducts` leaves them unmatched on purpose rather than guessing
      // which of three bespoke lines is which.
      //
      // So: if everything unmatched on BOTH sides is bespoke, this is a
      // difference nobody can close, and an error that can never be cleared is
      // one people learn to leave sitting there. Say it as Info.
      const bespoke = (n) => isCatchAll(n.replace(/^\d+ x /, ''));
      const unmatched = missing.onInvoice.concat(missing.inAirtable);
      const onlyCatchAll = unmatched.length > 0 && unmatched.every(bespoke);

      add(onlyCatchAll ? INFO : ERROR, 'line-totals-match-invoice',
        `${order.fields['Order ID']} revenue ${projected} vs ${target}`, {
          invoice: num, orderRecIds: [order.id],
          detail: onlyCatchAll
            ? `Line totals come to ${projected}; the invoice goods total after discount is ${target}. The difference is bespoke work — ${unmatched.join(', ')} — which has no catalogue entry to be priced from, so it cannot be reconciled line by line.`
            : `Line totals come to ${projected}; the invoice goods total after discount is ${target}.`
              + (missing.onInvoice.length ? ` No Airtable line for: ${missing.onInvoice.join(', ')}.` : '')
              + (missing.inAirtable.length ? ` On the order but not the invoice: ${missing.inAirtable.join(', ')}.` : '')
              + (nameless.length
                ? ` The invoice has ${nameless.length} line${nameless.length === 1 ? '' : 's'} with no product name, worth ${namelessValue} — typed as an amount rather than picked from the catalogue, so nothing can be matched to ${nameless.length === 1 ? 'it' : 'them'}.`
                : '')
              + (!missing.onInvoice.length && !missing.inAirtable.length && !nameless.length
                ? ' Every product matches, so the difference is quantities or prices rather than a missing line.' : '')
        });
    }

    // -- first payment date, which is not last_payment_date
    //
    // Written now, not merely reported. It used to be a warning, on the
    // reasoning that Airtable recorded the day a deposit confirmed the order and
    // Zoho the day it cleared — two honest answers to one question. But this
    // field is load-bearing in a way that reasoning missed: `Order Month` on the
    // order is derived from it, and so is `Production Start for Calculation`, so
    // the month a sale is counted in follows whatever sits here. Zoho owns
    // money, so Zoho settles it.
    //
    // The FIRST payment, never `last_payment_date`. That field is the last one,
    // which is wrong for every split-payment invoice — and the deposit is the
    // event Airtable has always meant by "Payment Received".
    //
    // What makes this affordable is that `last_payment_date` is free on the
    // invoice, and for an invoice paid in one go it IS the first payment. So a
    // stored date already equal to it needs no lookup at all, which is nearly
    // every invoice once this has run once. A split-payment invoice keeps
    // costing one call a pass — it settles on a first date that by definition
    // is not the last — and there are seventeen of those. That is the right way
    // round: the cheap case goes quiet, and the case worth re-checking is
    // re-checked.
    const stamped = order.fields['Payment Received'] || null;
    if (full.last_payment_date && stamped !== full.last_payment_date) {
      try {
        const ps = await io.payments(full.invoice_id);
        const first = ps[0]?.date || null;
        if (first && first !== stamped) {
          writes.orders.push({
            id: order.id, orderId: order.fields['Order ID'],
            was: stamped, now: first,
            fields: { 'Payment Received': first }
          });
          // Said once, and only when the move is big enough to mean something
          // other than a deposit clearing a day late. The next pass finds the
          // two agreeing and says nothing, so this closes itself.
          if (stamped && daysApart(stamped, first) > PAYMENT_DRIFT_DAYS) {
            add(INFO, 'metadata-drift', `${order.fields['Order ID']} payment ${stamped} -> ${first}`, {
              invoice: num, orderRecIds: [order.id],
              detail: `Airtable recorded ${stamped}; the first payment on the invoice is ${first}${ps.length > 1 ? ` (of ${ps.length} payments)` : ''}. More than ${PAYMENT_DRIFT_DAYS} days apart, so the invoice date has been written and the order's month moves with it — worth a glance in case the order is pointed at the wrong invoice.`
            });
          }
        }
      } catch (e) {
        // Never silent. Swallowing this made the warning count vary between
        // identical runs, which is worse than the check not existing: you
        // cannot tell a clean pass from one that quietly skipped work.
        add(WARN, 'run-failure', `payments unreadable for ${num}`, {
          invoice: num, orderRecIds: [order.id],
          detail: `${String(e.message).slice(0, 160)} — the first-payment-date check did not run for this invoice.`
        });
      }
    } else if (!full.last_payment_date && stamped) {
      // Airtable says somebody paid and the books have nothing against the
      // invoice. Reported rather than written back the other way: this is one
      // of the two directions the whole design forbids, and a receipt missing
      // from the books is a real thing to go and find.
      add(WARN, 'metadata-drift', `${order.fields['Order ID']} paid ${stamped}, no payment in Zoho`, {
        invoice: num, orderRecIds: [order.id],
        detail: `Airtable records a payment on ${stamped}; ${num} has none against it. Either the receipt was never entered, or it landed on a different invoice.`
      });
    }
  }

  // ---- the PINs this pass found, as writes ------------------------------
  // Collected across every invoice rather than written as each is read, because
  // one client can have five invoices and only the newest of them should speak.
  for (const seed of pinSeeds.values()) {
    writes.clients.push({
      id: seed.id, orderId: seed.name, was: null, now: seed.pin,
      fields: { 'KRA PIN': seed.pin }
    });
  }

  // ---- apply the writes the sync owns ----------------------------------
  // ---- Sync Status: the flag where the work actually happens -------------
  // The log answers "what is wrong across the board". This answers "can I trust
  // this order", on the order itself, where the workshop and the office are
  // already looking. Nobody opens a log table to find out whether one record is
  // sound.
  //
  // Only written in write mode, and only when it changes: read-only leaves the
  // pipeline untouched by definition, and re-stamping 230 unchanged orders every
  // five minutes would be a lot of writes to say nothing.
  const worst = new Map();
  const rank = { Error: 3, Warning: 2, Info: 1 };
  for (const f of findings) {
    for (const rid of (f.orderRecIds || [])) {
      const held = f.check === 'line-changed-in-production';
      const label = held ? 'Held - in production' : (f.severity === ERROR ? 'Error' : f.severity === WARN ? 'Warning' : null);
      if (!label) continue;
      const score = held ? 4 : rank[f.severity];
      const prev = worst.get(rid);
      if (!prev || score > prev.score) worst.set(rid, { score, label });
    }
  }
  for (const o of orders) {
    const want = worst.get(o.id)?.label || 'OK';
    if ((o.fields['Sync Status'] || 'OK') === want) continue;
    writes.orders.push({
      id: o.id, orderId: o.fields['Order ID'],
      was: o.fields['Sync Status'] ?? null, now: want,
      fields: { 'Sync Status': want }
    });
  }

  // The write records carry preview metadata (what it was, what it becomes) that
  // Airtable must never see; only id and fields go over the wire.
  const bare = (w) => ({ id: w.id, fields: w.fields });
  // One order can need two things at once — a delivery charge and an eTIMS
  // number — and Airtable will not take the same record id twice in a batch.
  // Merge by id so the second change cannot displace the first.
  const merged = (ws) => {
    const byId = new Map();
    for (const w of ws) {
      const prev = byId.get(w.id);
      byId.set(w.id, prev ? { ...prev, fields: { ...prev.fields, ...w.fields } } : w);
    }
    return [...byId.values()];
  };
  let orderWrites = 0, lineWrites = 0, clientWrites = 0, ordersCreated = 0;
  if (mode === 'write') {
    const orderPatches = merged(writes.orders);
    if (orderPatches.length) { await patch(TABLES.orders, orderPatches.map(bare)); orderWrites = orderPatches.length; }
    if (writes.lines.length) { await patch(TABLES.lines, writes.lines.map(bare)); lineWrites = writes.lines.length; }
    // Base - Clients, not the order pipeline. The one-writer rule is about
    // orders, lines and money; who a client is has always been the carve-out,
    // and this is the same reconciler doing the writing either way.
    const clientPatches = merged(writes.clients);
    if (clientPatches.length) { await patch(TABLES.clients, clientPatches.map(bare)); clientWrites = clientPatches.length; }

    // ---- creations, last and one order at a time -----------------------
    //
    // Serial, deliberately. Each order needs its client's record id before it
    // can be written, and each line needs its order's — so this is three
    // dependent writes, not a batch. Doing them one order at a time also means
    // a failure costs exactly one order rather than ten, and the next pass
    // simply finds that invoice still unclaimed and tries again.
    //
    // A client created here is added to the in-memory list straight away, so
    // two invoices for the same new customer in one pass produce one client
    // row, not two. That is the duplicate this whole path is most likely to
    // create, and the cheapest place to stop it.
    for (const c of writes.creates) {
      try {
        let clientRecId = c.client.row?.id;
        if (c.client.create) {
          const [made] = await create(TABLES.clients, [{ fields: c.client.create }]);
          clientRecId = made.id;
          clients.push({ id: made.id, fields: { ...c.client.create } });
        } else if (c.client.backfillId) {
          // Matched by name, so give it the id it was missing and stop it being
          // a name match forever. Best-effort: the order is the point, and an
          // id that fails to land is found again by name next time.
          await patch(TABLES.clients, [{ id: clientRecId, fields: { 'Zoho Contact ID': c.client.backfillId } }])
            .catch(() => {});
        }
        const [order] = await create(TABLES.orders, [{ fields: c.order(clientRecId) }]);
        const lines = c.lines(order.id);
        if (lines.length) await create(TABLES.lines, lines.map((fields) => ({ fields })));
        ordersCreated += 1;
        add(INFO, 'order-created', `${c.invoice} became an order for ${c.customer}`, {
          invoice: c.invoice, orderRecIds: [order.id],
          detail: `Created as ${c.status} with ${lines.length} line${lines.length === 1 ? '' : 's'}`
            + `${c.client.create ? ', and a new Base - Clients row' : ''}. Check the production document shows it.`
        });
      } catch (err) {
        // Never silent, and never fatal to the rest: the invoice stays
        // unclaimed, so the next pass tries again rather than leaving a half
        // order nobody knows about.
        add(ERROR, 'order-created', `${c.invoice} could not become an order`, {
          invoice: c.invoice,
          detail: `${String(err.message).slice(0, 200)} — nothing was left half-written; the next pass will try again.`
        });
      }
    }
  }

  const errors = findings.filter((f) => f.severity === ERROR).length;
  const warnings = findings.filter((f) => f.severity === WARN).length;
  return {
    started, finished: now(), mode, trigger, scanned,
    // Whether this pass looked at everything. Only a full pass may close a log
    // row: an incremental one has not seen the invoices it is not reporting on.
    full: isFull,
    orderWrites, lineWrites, clientWrites, ordersCreated, errors, warnings, findings,
    zohoCalls: zoho.calls.n - callsAtStart,
    // What a write pass would do, whether or not this one did it.
    pending: writes, projection
  };
}

/**
 * Write the report where a person will actually see it.
 *
 * A clean pass writes ONE Runs row and no NEW Log rows, though a full one may
 * close rows that are no longer true. Recurring drift updates
 * `Last Seen` on the open row rather than adding another — 24 hourly passes over
 * one unresolved problem must not produce 24 rows, or the table becomes noise
 * and stops being read, which is exactly how the markdown report failed.
 */
export async function record(report) {
  /*
   * Read the log BEFORE writing the run row, so the run can say how many
   * findings it closed. Closing 48 of them is the most consequential thing a
   * pass does to this table, and a Runs row that does not mention it leaves
   * somebody wondering why the log suddenly emptied.
   *
   * Open, Acknowledged and Ignored are all "still on the books". Only Open was
   * being matched, so marking a finding Ignored did not stop it coming back —
   * it made the next pass create a SECOND row for the same thing, which is the
   * opposite of what the person clicking Ignore meant. Resolved is deliberately
   * excluded: a finding that was fixed and has recurred is news, and deserves a
   * fresh row with a fresh First Seen.
   */
  const rows = await all(TABLES.syncLog);
  const standing = rows.filter((r) => ['Open', 'Acknowledged', 'Ignored'].includes(r.fields.Status || 'Open'));
  const open = standing.filter((r) => (r.fields.Status || 'Open') === 'Open');
  const keyOf = (f) => `${f.Check}|${f.Event}`;
  const seen = new Map(standing.map((r) => [keyOf(r.fields), r]));
  const current = new Set(report.findings.map((f) => `${f.check}|${f.event}`));

  const fresh = [], touch = [];
  for (const f of report.findings) {
    const key = `${f.check}|${f.event}`;
    const hit = seen.get(key);
    if (hit) {
      touch.push({ id: hit.id, fields: { 'Last Seen': report.finished, Run: [] } });
    } else {
      fresh.push({ fields: {
        Event: f.event, Severity: f.severity, Check: f.check,
        'Zoho Invoice': f.invoice || '', Order: f.orderRecIds || [],
        Detail: f.detail || '', Status: 'Open',
        'First Seen': report.started, 'Last Seen': report.finished
      } });
    }
  }

  /*
   * Close what a FULL pass no longer sees.
   *
   * Without this the log only ever grows: 58 rows all reading Open, five of them
   * fixed the day before by the write pass and nothing saying so. A list where
   * everything is open forever is a list nobody can act on, which is the same
   * way the markdown report died. `Sync Status` on the order already clears
   * itself back to OK for exactly this reason — "a flag nobody clears is a flag
   * nobody trusts" — and the Status field has had a `Resolved` option waiting
   * for it all along.
   *
   * **Full passes only.** An incremental pass looks at invoices modified in the
   * last two hours, so a finding it does not report is overwhelmingly one it
   * never looked at. Letting it close rows would clear the whole log every five
   * minutes and reopen it on the nightly pass.
   *
   * **And only a pass that actually RAN.** A pass that died — Zoho's daily quota
   * is how it happens — reports zero findings, which is indistinguishable from
   * "everything is fixed" unless the failure is checked for. A nightly full pass
   * hitting the quota would otherwise mark every open finding Resolved and
   * quietly empty the log. It survived only because the failure path happened to
   * omit `full`, which is luck rather than design.
   */
  const resolved = report.full && !report.failed
    ? open.filter((r) => !current.has(keyOf(r.fields)))
      .map((r) => ({ id: r.id, fields: { Status: 'Resolved', 'Last Seen': report.finished } }))
    : [];

  const runs = await create(TABLES.syncRuns, [{
    fields: {
      Run: report.started,
      Started: report.started,
      Finished: report.finished,
      Trigger: report.trigger,
      Mode: report.mode === 'write' ? 'Write' : 'Read-only',
      'Invoices Scanned': report.scanned,
      // The column has existed since the beginning and nothing has ever written
      // it: order creation was designed for and then not built. It is built now.
      'Orders Created': report.ordersCreated || 0,
      'Orders Updated': report.orderWrites,
      'Lines Updated': report.lineWrites,
      Errors: report.errors,
      Warnings: report.warnings,
      // A pass that died is Failed, not Findings. Recording a quota exhaustion
      // as "Findings" put 106 identical rows in this table wearing the same
      // badge as a real discrepancy.
      Outcome: report.failed ? 'Failed' : (report.errors || report.warnings ? 'Findings' : 'Clean'),
      // Zoho allows 2,000 calls per org per DAY. Recording the cost of each pass
      // is what stops a schedule quietly eating the whole budget unnoticed.
      Notes: `${report.zohoCalls ?? 0} Zoho API calls (2,000/day org limit)`
        + (resolved.length ? `\n${resolved.length} finding${resolved.length === 1 ? '' : 's'} closed` : '')
        // Base - Clients has no column of its own in this table, and adding one
        // for a number that is zero on almost every pass would be a column of
        // zeroes. It goes here, and only when there is something to say.
        + (report.clientWrites ? `\n${report.clientWrites} client${report.clientWrites === 1 ? '' : 's'} given a KRA PIN` : '')
    }
  }]);
  const runId = runs[0].id;

  if (fresh.length) await create(TABLES.syncLog, fresh.map((r) => ({ fields: { ...r.fields, Run: [runId] } })));
  if (resolved.length) await patch(TABLES.syncLog, resolved);
  if (touch.length) await patch(TABLES.syncLog, touch.map((r) => ({ id: r.id, fields: { ...r.fields, Run: [runId] } })));
  return { runId, created: fresh.length, touched: touch.length, resolved: resolved.length };
}

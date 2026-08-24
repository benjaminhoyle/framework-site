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
 * How far a payment date may differ before it is worth saying so.
 *
 * Airtable records the day a deposit confirmed the order; Zoho records the day
 * it cleared. A day or three between those is the normal working gap, not
 * drift, and warning about it produced 19 standing warnings of which 15 meant
 * nothing. Past a week the two are describing different events and somebody
 * should look.
 */
const PAYMENT_DRIFT_DAYS = 7;
const now = () => new Date().toISOString();

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
  if (!has('Delivery - Scheduled Date') && cf.cf_delivery_date) {
    out['Delivery - Scheduled Date'] = String(cf.cf_delivery_date);
  }
  const start = hhmmToSeconds(cf.cf_delivery_window_start);
  const end = hhmmToSeconds(cf.cf_delivery_window_end);
  if (!has('Delivery Window Start') && start != null) out['Delivery Window Start'] = start;
  if (!has('Delivery Window End') && end != null) out['Delivery Window End'] = end;
  if (order['Delivery - Date Set'] !== true && cf.cf_delivery_date_status === 'Confirmed') {
    out['Delivery - Date Set'] = true;
  }
  if (order['Client Pickup'] !== true && cf.cf_client_pickup === true) out['Client Pickup'] = true;
  return out;
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
  const [orders, lines, products, zItems, zInvoices] = await Promise.all([
    io.orders(), io.lines(), io.products(),
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
    const liveA = products.filter((p) => p.fields.Status === 'Active');
    for (const p of liveA) {
      const z = liveZ.get(p.fields.Name);
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
      if (!liveA.some((p) => p.fields.Name === name)) {
        add(WARN, 'catalogue-prices-agree', `${name} has no active Airtable product`, {
          detail: 'Sellable in Zoho with nowhere to land in Airtable. A sale of it would have no product to attach to.'
        });
      }
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

  let scanned = 0;
  const writes = { orders: [], lines: [] };
  const projection = [];

  for (const { list, full, error } of details) {
    if (error) {
      add(WARN, 'run-failure', `could not read ${list.invoice_number}`, { invoice: list.invoice_number, detail: error });
      continue;
    }
    scanned += 1;
    const num = full.invoice_number;
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
      const workType = full.custom_field_hash?.cf_work_type;
      if (full.status === 'paid' && full.date >= epoch && workType === 'Shelving') {
        add(INFO, 'paid-invoice-no-order', `${num} is paid with no order`, {
          invoice: num,
          detail: `${full.customer_name}, ${full.date}, ${full.total}. Needs an order, or is a delivery-only invoice.`
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
    // Only when there is something to explain. If Airtable already holds the
    // invoice's last_payment_date there is nothing a payments lookup can add,
    // and asking anyway costs ~250 calls a pass out of a 2,000/day budget.
    const stamped = order.fields['Payment Received'];
    if (full.status === 'paid' && stamped && stamped !== full.last_payment_date) {
      try {
        const ps = await io.payments(full.invoice_id);
        const first = ps[0]?.date;
        const have = order.fields['Payment Received'];
        if (first && have && have !== first && daysApart(have, first) > PAYMENT_DRIFT_DAYS) {
          add(WARN, 'metadata-drift', `${order.fields['Order ID']} payment ${have} vs first ${first}`, {
            invoice: num, orderRecIds: [order.id],
            detail: `Airtable records ${have}; the first payment on the invoice is ${first}${ps.length > 1 ? ` (of ${ps.length} payments)` : ''}. More than ${PAYMENT_DRIFT_DAYS} days apart, so the two are probably describing different events.`
          });
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
    }
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
  let orderWrites = 0, lineWrites = 0;
  if (mode === 'write') {
    const orderPatches = merged(writes.orders);
    if (orderPatches.length) { await patch(TABLES.orders, orderPatches.map(bare)); orderWrites = orderPatches.length; }
    if (writes.lines.length) { await patch(TABLES.lines, writes.lines.map(bare)); lineWrites = writes.lines.length; }
  }

  const errors = findings.filter((f) => f.severity === ERROR).length;
  const warnings = findings.filter((f) => f.severity === WARN).length;
  return {
    started, finished: now(), mode, trigger, scanned,
    // Whether this pass looked at everything. Only a full pass may close a log
    // row: an incremental one has not seen the invoices it is not reporting on.
    full: isFull,
    orderWrites, lineWrites, errors, warnings, findings,
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
    }
  }]);
  const runId = runs[0].id;

  if (fresh.length) await create(TABLES.syncLog, fresh.map((r) => ({ fields: { ...r.fields, Run: [runId] } })));
  if (resolved.length) await patch(TABLES.syncLog, resolved);
  if (touch.length) await patch(TABLES.syncLog, touch.map((r) => ({ id: r.id, fields: { ...r.fields, Run: [runId] } })));
  return { runId, created: fresh.length, touched: touch.length, resolved: resolved.length };
}

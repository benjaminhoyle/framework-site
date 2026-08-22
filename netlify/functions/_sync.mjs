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
const now = () => new Date().toISOString();

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

/** Run `fn` over `list` a few at a time — serial is too slow for a full pass. */
async function pool(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  }
  return out;
}

export async function reconcile({ mode = 'read-only', trigger = 'Manual', since = null } = {}) {
  const started = now();
  const findings = [];
  const add = (severity, check, event, extra = {}) =>
    findings.push({ severity, check, event, ...extra });

  // ---- read both sides -------------------------------------------------
  const [orders, lines, products, zItems, zInvoices] = await Promise.all([
    all(TABLES.orders), all(TABLES.lines), all(TABLES.products),
    zoho.items(), zoho.invoices(since ? { since } : {})
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

  // ---- check: live catalogue prices agree ------------------------------
  const liveZ = new Map(zItems.filter((i) => i.status === 'active').map((i) => [i.name, i]));
  const liveA = products.filter((p) => p.fields.Status === 'Active');
  for (const p of liveA) {
    const z = liveZ.get(p.fields.Name);
    if (!z) {
      add(WARN, 'catalogue-prices-agree', `${p.fields.Name} has no active Zoho item`, {
        detail: 'Active in Airtable with no matching active Zoho item. Expected only for catch-alls like Custom Item.'
      });
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
    if (!liveA.some((p) => p.fields.Name === name)) {
      add(WARN, 'catalogue-prices-agree', `${name} has no active Airtable product`, {
        detail: 'Sellable in Zoho with nowhere to land in Airtable. A sale of it would have no product to attach to.'
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
    try { return { list: i, full: await zoho.invoice(i.invoice_id) }; }
    catch (e) { return { list: i, error: String(e.message).slice(0, 160) }; }
  });

  let scanned = 0;
  const writes = { orders: [], lines: [] };

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
      if (full.status === 'paid' && full.date >= epoch) {
        add(INFO, 'paid-invoice-no-order', `${num} is paid with no order`, {
          invoice: num,
          detail: `${full.customer_name}, ${full.date}, ${full.total}. Needs an order, or is a delivery-only invoice.`
        });
      }
      continue;
    }

    const m = zoho.money(full);
    const held = ['Production Launched', 'Pending Delivery', 'Pending Client Collect', 'Delivered']
      .includes(order.fields['Order Status']);

    // -- delivery charge: the sync owns this field outright
    if (m.hasDeliveryLine) {
      const cur = order.fields['Delivery - Charged Client (ex VAT)'];
      if (cur == null || Math.abs(cur - m.deliveryExVat) > 0.02) {
        if (mode === 'write') {
          writes.orders.push({ id: order.id, fields: { 'Delivery - Charged Client (ex VAT)': m.deliveryExVat } });
        } else {
          add(INFO, 'metadata-drift', `${order.fields['Order ID']} delivery ${cur} -> ${m.deliveryExVat}`, {
            invoice: num, orderRecIds: [order.id],
            detail: 'Delivery charge differs from the invoice. This field is ex-VAT deliberately, so it can be compared against the driver rate.'
          });
        }
      }
    }

    // -- invoiced line prices: match Zoho lines to Airtable lines by product
    const zByName = new Map();
    for (const li of m.lines) {
      const k = stripLegacy(li.name);
      const prev = zByName.get(k) || { qty: 0, total: 0, rate: li.rate };
      zByName.set(k, { qty: prev.qty + li.quantity, total: prev.total + li.rate * li.quantity, rate: li.rate });
    }
    const aLines = linesByOrder.get(order.id) || [];
    // An invoice-level discount is apportioned across lines, so each line's
    // stored total is what that line actually earned.
    const gross = [...zByName.values()].reduce((n, v) => n + v.total, 0);
    const factor = apportionFactor(gross, m.discount);

    for (const al of aLines) {
      const pid = (al.fields.Item || [])[0];
      const pname = products.find((p) => p.id === pid)?.fields?.Name;
      const z = pname ? zByName.get(pname) : null;
      if (!z) continue;
      const want = zoho.round2(z.total * factor * ((al.fields.Quantity || 0) / (z.qty || 1)));
      const have = al.fields['Zoho Line Total'];
      if (have == null || Math.abs(have - want) > 0.02) {
        if (mode === 'write' && !held) {
          writes.lines.push({ id: al.id, fields: { 'Zoho Line Total': want, 'Zoho Unit Rate': zoho.round2(z.rate * factor) } });
        } else if (held && have != null) {
          add(ERROR, 'line-changed-in-production', `${order.fields['Order ID']} line changed after production`, {
            invoice: num, orderRecIds: [order.id],
            detail: `${pname}: stored ${have}, invoice now ${want}. NOT applied — the workshop is building from this record.`
          });
        }
      }
    }

    // -- revenue must reconcile once the lines carry invoiced totals
    const stored = aLines.reduce((n, l) => n + (l.fields['Zoho Line Total'] || 0), 0);
    const anyStored = aLines.some((l) => l.fields['Zoho Line Total'] != null);
    if (anyStored) {
      const target = zoho.round2(m.goods - m.discount);
      if (Math.abs(stored - target) > 1) {
        add(ERROR, 'line-totals-match-invoice', `${order.fields['Order ID']} revenue ${stored} vs ${target}`, {
          invoice: num, orderRecIds: [order.id],
          detail: `Line totals sum to ${stored}; the invoice goods total after discount is ${target}. Airtable is missing a line, or has one the invoice does not.`
        });
      }
    }

    // -- first payment date, which is not last_payment_date
    if (full.status === 'paid') {
      try {
        const ps = await zoho.payments(full.invoice_id);
        const first = ps[0]?.date;
        const have = order.fields['Payment Received'];
        if (first && have && have !== first) {
          add(WARN, 'metadata-drift', `${order.fields['Order ID']} payment ${have} vs first ${first}`, {
            invoice: num, orderRecIds: [order.id],
            detail: `Airtable records ${have}; the first payment on the invoice is ${first}${ps.length > 1 ? ` (of ${ps.length} payments)` : ''}.`
          });
        }
      } catch { /* payments are a nicety; a failure here must not fail the pass */ }
    }
  }

  // ---- apply the writes the sync owns ----------------------------------
  let orderWrites = 0, lineWrites = 0;
  if (mode === 'write') {
    if (writes.orders.length) { await patch(TABLES.orders, writes.orders); orderWrites = writes.orders.length; }
    if (writes.lines.length) { await patch(TABLES.lines, writes.lines); lineWrites = writes.lines.length; }
  }

  const errors = findings.filter((f) => f.severity === ERROR).length;
  const warnings = findings.filter((f) => f.severity === WARN).length;
  return {
    started, finished: now(), mode, trigger, scanned,
    orderWrites, lineWrites, errors, warnings, findings
  };
}

/**
 * Write the report where a person will actually see it.
 *
 * A clean pass writes ONE Runs row and ZERO Log rows. Recurring drift updates
 * `Last Seen` on the open row rather than adding another — 24 hourly passes over
 * one unresolved problem must not produce 24 rows, or the table becomes noise
 * and stops being read, which is exactly how the markdown report failed.
 */
export async function record(report) {
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
      Outcome: report.errors ? 'Findings' : (report.warnings ? 'Findings' : 'Clean')
    }
  }]);
  const runId = runs[0].id;
  if (!report.findings.length) return { runId, created: 0, touched: 0 };

  const open = (await all(TABLES.syncLog)).filter((r) => (r.fields.Status || 'Open') === 'Open');
  const keyOf = (f) => `${f.Check}|${f.Event}`;
  const seen = new Map(open.map((r) => [keyOf(r.fields), r]));

  const fresh = [], touch = [];
  for (const f of report.findings) {
    const key = `${f.check}|${f.event}`;
    const hit = seen.get(key);
    if (hit) {
      touch.push({ id: hit.id, fields: { 'Last Seen': report.finished, Run: [runId] } });
    } else {
      fresh.push({ fields: {
        Event: f.event, Severity: f.severity, Check: f.check,
        'Zoho Invoice': f.invoice || '', Order: f.orderRecIds || [],
        Detail: f.detail || '', Status: 'Open',
        'First Seen': report.started, 'Last Seen': report.finished, Run: [runId]
      } });
    }
  }
  if (fresh.length) await create(TABLES.syncLog, fresh);
  if (touch.length) await patch(TABLES.syncLog, touch);
  return { runId, created: fresh.length, touched: touch.length };
}

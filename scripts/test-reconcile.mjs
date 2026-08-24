// The checks themselves, against fixtures. No network, no credentials.
//
// Zoho allows 2,000 API calls a day, so the checks cannot be exercised freely
// against the live API — and they are the part most worth testing, because each
// one either writes to the order pipeline or tells someone their books are
// wrong. Every case below is one we actually hit while reconciling three years
// of invoices.

import assert from 'node:assert/strict';
import { reconcile, canonicalItem, matchProducts, hhmmToSeconds, seedDelivery, daysApart, unmatchedLines } from '../netlify/functions/_sync.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; }
  catch (err) { console.error(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; }
};

// ---- fixture builders --------------------------------------------------
const order = (id, fields = {}) => ({
  id, fields: { 'Order ID': id, 'Order Status': 'Delivered', 'Order Received': '2026-01-01', ...fields }
});
const line = (id, orderRec, productRec, fields = {}) => ({
  id, fields: { Order: [orderRec], Item: [productRec], Quantity: 1, ...fields }
});
const product = (id, name, price) => ({ id, fields: { Name: name, Price: price, Status: 'Active' } });
const zline = (name, quantity, rate, item_id) => ({
  name, quantity, rate, item_id, item_total: rate * quantity / 1.16, item_custom_fields: []
});
const invoice = (number, lines, extra = {}) => ({
  invoice_id: `id_${number}`, invoice_number: number, status: 'paid',
  date: '2026-02-01', customer_name: 'Someone', total: 0,
  // Shelving unless a test says otherwise: Orders - Pipeline is the shelving
  // pipeline, and that is what an invoice needing an order looks like.
  custom_field_hash: { cf_work_type: 'Shelving' },
  discount_total: 0, line_items: lines, ...extra
});

/** Run the reconciler over a fixture world. */
function io({ orders = [], lines = [], products = [], items = [], invoices = [], payments = {} }) {
  return {
    orders: async () => orders,
    lines: async () => lines,
    products: async () => products,
    items: async () => items,
    invoices: async () => invoices,
    detail: async (id) => invoices.find((i) => i.invoice_id === id),
    payments: async (id) => payments[id] || []
  };
}
const run = (world, opts = {}) => reconcile({ io: io(world), ...opts });
const of = (r, check) => r.findings.filter((f) => f.check === check);

// ---- invoice-claimed-once ---------------------------------------------
await test('two orders claiming one invoice is an error', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' }), order('2_B', { 'Zoho Invoice': 'INV1' })]
  });
  const f = of(r, 'invoice-claimed-once');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'Error');
  assert.match(f[0].detail, /1_A, 2_B/);
});

await test('one order per invoice is silent', async () => {
  const r = await run({ orders: [order('1_A', { 'Zoho Invoice': 'INV1' }), order('2_B', { 'Zoho Invoice': 'INV2' })] });
  assert.equal(of(r, 'invoice-claimed-once').length, 0);
});

// ---- order-needs-invoice ----------------------------------------------
await test('an uninvoiced order is an error unless it is free or internal', async () => {
  const r = await run({
    orders: [
      order('1_Paying'),                                       // no invoice — a gap
      order('2_Gift', { 'Free / Heavy Discount': true }),      // legitimate
      order('3_Internal')                                      // legitimate
    ]
  });
  const f = of(r, 'order-needs-invoice');
  assert.equal(f.length, 1, 'only the paying order should be flagged');
  assert.equal(f[0].event, '1_Paying has no invoice');
});

// ---- catalogue-prices-agree -------------------------------------------
await test('a price divergence between live catalogues is an error', async () => {
  const r = await run({
    products: [product('p1', 'Standard Base', 6500)],
    items: [{ name: 'Standard Base', rate: 7000, status: 'active' }]
  });
  const f = of(r, 'catalogue-prices-agree');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'Error');
});

await test('the catalogue check is skipped on an incremental pass', async () => {
  // It costs a paged Zoho read, and prices do not move every five minutes.
  const r = await run({
    products: [product('p1', 'Standard Base', 6500)],
    items: [{ name: 'Standard Base', rate: 7000, status: 'active' }]
  }, { since: '2026-02-01T00:00:00+0300' });
  assert.equal(of(r, 'catalogue-prices-agree').length, 0);
});

// ---- line-has-order ----------------------------------------------------
await test('a line item with no order is flagged', async () => {
  const r = await run({ lines: [{ id: 'l1', fields: { Quantity: 1, 'Line ID': '1 x Ghost' } }] });
  assert.equal(of(r, 'line-has-order').length, 1);
});

// ---- the backfill ------------------------------------------------------
const backfillWorld = {
  orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
  products: [product('p1', 'Standard Base', 6500)],
  lines: [line('l1', '1_A', 'p1', { Quantity: 2, Subtotal: 13000 })],
  invoices: [invoice('INV1', [zline('Standard Base', 2, 6500)])]
};

await test('a blank invoiced price is filled, whatever state the order is in', async () => {
  // 225 of 230 orders are Delivered. Treating that as protected would have
  // silently excluded almost the whole pipeline from the backfill.
  const r = await run(backfillWorld);
  assert.equal(r.pending.lines.length, 1);
  assert.equal(r.pending.lines[0].now, 13000);
  assert.equal(r.pending.lines[0].was, undefined);
});

await test('read-only computes the writes but does not apply them', async () => {
  const r = await run(backfillWorld);
  assert.ok(r.pending.lines.length > 0, 'a preview needs the pending writes');
  assert.equal(r.lineWrites, 0, 'nothing may be applied in read-only mode');
});

await test('a legacy Shelf- name still matches the current product', async () => {
  const r = await run({
    ...backfillWorld,
    invoices: [invoice('INV1', [zline('Shelf - Standard Base', 2, 6500)])]
  });
  assert.equal(r.pending.lines.length, 1);
  assert.equal(r.pending.lines[0].now, 13000);
});

// ---- zero-rated lines --------------------------------------------------
await test('a zero-rated line is written as 0, not as catalogue price', async () => {
  // Reps zero-rate deliberately. Treating it as missing data would quietly
  // re-charge the customer for something given away.
  const r = await run({
    ...backfillWorld,
    invoices: [invoice('INV1', [zline('Standard Base', 2, 0)])]
  });
  assert.equal(r.pending.lines[0].now, 0);
});

// ---- invoice-level discounts ------------------------------------------
await test('an invoice-level discount is apportioned onto the line', async () => {
  const r = await run({
    ...backfillWorld,
    invoices: [invoice('INV1', [zline('Standard Base', 2, 6500)], { discount_total: 1300 })]
  });
  assert.equal(r.pending.lines[0].now, 11700); // 13000 - 1300
});

await test('a discount is apportioned even when lines carry item ids', async () => {
  // The discount is divided across ALL goods, not just the lines that happen to
  // lack an id — dividing by the remainder leaves it silently unapplied.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
    products: [{ id: 'p1', fields: { Name: 'Standard Base', Price: 6500, Status: 'Active', 'Zoho Item ID': 'z1' } }],
    lines: [line('l1', '1_A', 'p1', { Quantity: 2, Subtotal: 13000 })],
    invoices: [invoice('INV1', [zline('Standard Base', 2, 6500, 'z1')], { discount_total: 1300 })]
  });
  assert.equal(r.pending.lines[0].now, 11700);
  assert.equal(r.projection[0].projected, r.projection[0].target, 'and it still reconciles');
});

// ---- protecting work in progress ---------------------------------------
await test('a changed line is held, not applied, while the workshop is building', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Order Status': 'Production Launched' })],
    products: [product('p1', 'Standard Base', 6500)],
    lines: [line('l1', '1_A', 'p1', { Quantity: 2, 'Zoho Line Total': 13000 })],
    invoices: [invoice('INV1', [zline('Standard Base', 2, 5000)])]
  });
  assert.equal(of(r, 'line-changed-in-production').length, 1);
  assert.equal(r.pending.lines.length, 0, 'must not queue a write for a record being built from');
});

await test('the same change is applied once the order is delivered', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Order Status': 'Delivered' })],
    products: [product('p1', 'Standard Base', 6500)],
    lines: [line('l1', '1_A', 'p1', { Quantity: 2, 'Zoho Line Total': 13000 })],
    invoices: [invoice('INV1', [zline('Standard Base', 2, 5000)])]
  });
  assert.equal(of(r, 'line-changed-in-production').length, 0);
  assert.equal(r.pending.lines.length, 1);
  assert.equal(r.pending.lines[0].now, 10000);
});

await test('a write pass does not flag the work it is doing', async () => {
  // The line is blank and about to be filled. Judging the pre-write state
  // reported three orders as short by the very pass that was fixing them.
  const r = await run(backfillWorld, { mode: 'read-only' });
  assert.equal(of(r, 'line-totals-match-invoice').length, 0);
});

await test('a genuine shortfall is still an error', async () => {
  const r = await run({
    ...backfillWorld,
    invoices: [invoice('INV1', [zline('Standard Base', 2, 6500), zline('Steel Decoration', 2, 3000)])]
  });
  assert.equal(of(r, 'line-totals-match-invoice').length, 1);
});

// ---- the epoch ---------------------------------------------------------
await test('a paid invoice predating the pipeline is not reported as a gap', async () => {
  // Zoho goes back to 2023 and Airtable does not. Reporting those opened the
  // log with 108 rows nobody could act on.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Order Received': '2024-12-01' })],
    invoices: [invoice('INV1', []), invoice('OLD', [], { date: '2023-06-01' })]
  });
  assert.equal(of(r, 'paid-invoice-no-order').length, 0);
});

await test('a paid invoice after the epoch with no order IS reported', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Order Received': '2024-12-01' })],
    invoices: [invoice('INV1', []), invoice('NEW', [], { date: '2026-03-01' })]
  });
  const f = of(r, 'paid-invoice-no-order');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'Info');
});

await test('a paid invoice for work that is not shelving needs no shelving order', async () => {
  // Orders - Pipeline is the shelving pipeline. A window job has no order to be
  // missing, and 17 of the 25 this check reported were Custom Projects --
  // two thirds of a list being things that are fine is how a list stops being
  // read.
  const r = await run({
    orders: [],
    invoices: [
      invoice('WIN', [], { date: '2026-03-01', custom_field_hash: { cf_work_type: 'Custom Projects' } }),
      invoice('FRAME', [], { date: '2026-03-01', custom_field_hash: {} })
    ]
  });
  assert.equal(of(r, 'paid-invoice-no-order').length, 0);
});

// ---- delivery ----------------------------------------------------------
await test('delivery is taken ex-VAT from item_total, not from rate', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
    invoices: [invoice('INV1', [{ name: 'Delivery Fees', quantity: 1, rate: 2000, item_total: 1724.14, item_custom_fields: [] }])]
  });
  assert.equal(r.pending.orders.length, 1);
  assert.equal(r.pending.orders[0].now, 1724.14);
});

// ---- the projection ----------------------------------------------------
await test('the projection says whether an order would reconcile afterwards', async () => {
  const r = await run(backfillWorld);
  assert.deepEqual(r.projection, [{ orderId: '1_A', invoice: 'INV1', target: 13000, projected: 13000 }]);
});

await test('a line Airtable is missing shows up as a projection shortfall', async () => {
  // 71_Kerstin-Karlstrom is missing 2 x Steel Decoration in real life.
  const r = await run({
    ...backfillWorld,
    invoices: [invoice('INV1', [zline('Standard Base', 2, 6500), zline('Steel Decoration', 2, 3000)])]
  });
  const p = r.projection[0];
  assert.equal(p.target, 19000);
  assert.equal(p.projected, 13000, 'the missing line must not be silently absorbed');
});

// ---- payment dates -----------------------------------------------------
await test('payments are only fetched when the stored date disagrees', async () => {
  // ~250 calls a pass out of a 2,000/day budget hangs on this.
  let asked = 0;
  const world = {
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Payment Received': '2026-02-05' })],
    invoices: [invoice('INV1', [], { last_payment_date: '2026-02-05' })]
  };
  const base = io(world);
  await reconcile({ io: { ...base, payments: async (id) => { asked += 1; return []; } } });
  assert.equal(asked, 0, 'nothing to explain, so nothing to ask');
});

await test('a disagreeing payment date is reported as the first payment', async () => {
  const world = {
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Payment Received': '2026-02-05' })],
    invoices: [invoice('INV1', [], { last_payment_date: '2026-03-20' })],
    payments: { id_INV1: [{ date: '2026-02-25' }, { date: '2026-03-20' }] }
  };
  const r = await run(world);
  const f = of(r, 'metadata-drift');
  assert.equal(f.length, 1);
  assert.match(f[0].event, /2026-02-05 vs first 2026-02-25/);
});

await test('a payment date a few days out is the normal working gap, not drift', async () => {
  // Airtable records the day a deposit confirmed the order; Zoho the day it
  // cleared. Warning about that produced 19 standing warnings of which 15 meant
  // nothing, which teaches people to scroll past the four that did.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Payment Received': '2026-02-05' })],
    invoices: [invoice('INV1', [], { last_payment_date: '2026-03-20' })],
    payments: { id_INV1: [{ date: '2026-02-09' }, { date: '2026-03-20' }] }
  });
  assert.equal(of(r, 'metadata-drift').length, 0);
});

await test('an unreadable payments lookup is reported, never swallowed', async () => {
  // Swallowing it made the warning count differ between identical runs.
  const world = {
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Payment Received': '2026-02-05' })],
    invoices: [invoice('INV1', [], { last_payment_date: '2026-03-20' })]
  };
  const base = io(world);
  const r = await reconcile({ io: { ...base, payments: async () => { throw new Error('429 slow down'); } } });
  const f = of(r, 'run-failure');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /did not run/);
});

await test('one order needing two changes is patched once, not twice', async () => {
  // Airtable refuses the same record id twice in a batch, and the second entry
  // would otherwise displace the first rather than merging with it.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
    invoices: [invoice('INV1', [
      { name: 'Delivery Fees', quantity: 1, rate: 2000, item_total: 1724.14, item_custom_fields: [] }
    ], { custom_field_hash: { cf_etims_invoice_number: '12345' } })]
  });
  assert.equal(r.pending.orders.length, 2, 'two separate reasons to write');
  const ids = new Set(r.pending.orders.map((w) => w.id));
  assert.equal(ids.size, 1, 'both target the same order');
});

// ---- Sync Status -------------------------------------------------------
await test('an order with an error is flagged on the order itself', async () => {
  // The log says what is wrong across the board; this says whether THIS order
  // can be trusted, where people are already looking.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' }), order('2_B', { 'Zoho Invoice': 'INV1' })]
  });
  const flags = r.pending.orders.filter((w) => w.fields['Sync Status']);
  assert.equal(flags.length, 2);
  assert.ok(flags.every((f) => f.now === 'Error'));
});

await test('a held order says so, rather than just Error', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Order Status': 'Production Launched' })],
    products: [product('p1', 'Standard Base', 6500)],
    lines: [line('l1', '1_A', 'p1', { Quantity: 2, 'Zoho Line Total': 13000 })],
    invoices: [invoice('INV1', [zline('Standard Base', 2, 5000)])]
  });
  const flag = r.pending.orders.find((w) => w.fields['Sync Status']);
  assert.equal(flag.now, 'Held - in production');
});

await test('a clean order already marked OK is not rewritten', async () => {
  // Re-stamping 230 unchanged orders every five minutes would be a lot of
  // writes to say nothing.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Sync Status': 'OK' })],
    invoices: [invoice('INV1', [])]
  });
  assert.equal(r.pending.orders.filter((w) => w.fields['Sync Status']).length, 0);
});

await test('an order that has recovered is cleared back to OK', async () => {
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1', 'Sync Status': 'Error' })],
    invoices: [invoice('INV1', [])]
  });
  const flag = r.pending.orders.find((w) => w.fields['Sync Status']);
  assert.equal(flag.now, 'OK', 'a flag nobody clears is a flag nobody trusts');
});

// ---- matching across three years of renames ----------------------------
await test('canonical form ignores the Shelf- prefix and the Trimmed suffix', () => {
  assert.equal(canonicalItem('Shelf - Standard Base'), 'standard base');
  assert.equal(canonicalItem('Compact Base (Trimmed)'), 'compact base');
  assert.equal(canonicalItem('Compact Base'), 'compact base');
});

await test('a confirmed total rename resolves to today name', () => {
  // Ben confirmed: every Lamp Mount ever invoiced is what is now called Lamp.
  assert.equal(canonicalItem('Lamp Mount'), 'lamp');
  assert.equal(canonicalItem('Lamp Mount - Right'), 'lamp');
});

await test('exact names match before anything clever happens', () => {
  const m = matchProducts(['Standard Base', 'Bookend'], ['Standard Base', 'Bookend']);
  assert.equal(m.get('Standard Base'), 'Standard Base');
  assert.equal(m.get('Bookend'), 'Bookend');
});

await test('a renamed product matches its old invoice name', () => {
  // 282_Estelle-Maussion: Airtable says trimmed, INV640413 says plain.
  const m = matchProducts(['Compact Base (Trimmed)'], ['Compact Base']);
  assert.equal(m.get('Compact Base (Trimmed)'), 'Compact Base');
  const n = matchProducts(['Lamp'], ['Lamp Mount']);
  assert.equal(n.get('Lamp'), 'Lamp Mount');
});

await test('the drift is matched in both directions', () => {
  const m = matchProducts(['Standard Extension'], ['Standard Extension (Trimmed)']);
  assert.equal(m.get('Standard Extension'), 'Standard Extension (Trimmed)');
});

await test('AMBIGUITY IS REFUSED, never guessed', () => {
  // Zoho still sells a genuine Compact Base alongside the trimmed one. An order
  // holding both must not have either silently reassigned to the other.
  const m = matchProducts(
    ['Compact Base', 'Compact Base (Trimmed)'],
    ['Compact Base', 'Compact Base (Trimmed)']
  );
  assert.equal(m.get('Compact Base'), 'Compact Base', 'exact matches still hold');
  assert.equal(m.get('Compact Base (Trimmed)'), 'Compact Base (Trimmed)');

  // And where only one side has both, neither is claimed by the fallback.
  const n = matchProducts(['Compact Base', 'Compact Base (Trimmed)'], ['Compact Base']);
  assert.equal(n.get('Compact Base'), 'Compact Base');
  assert.equal(n.get('Compact Base (Trimmed)'), undefined, 'must not steal an already-claimed line');
});

await test('an unconfirmed rename stays unmatched, loudly', () => {
  // Adapter Unit, Base Unit, Short Extension and Top Shelf Bar have no known
  // counterpart. Guessing would misfile money; a shortfall gets investigated.
  const m = matchProducts(['Wide Adapter'], ['Adapter Unit']);
  assert.equal(m.get('Wide Adapter'), undefined);
});

// ---- item_id: what makes renames a non-problem -------------------------
await test('a renamed line matches by id even when the names disagree', async () => {
  // INV640389 says "Coat Hanger Module"; the catalogue calls it "Deep Hanger".
  // Same item_id, so no alias table has to know they are the same thing.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
    products: [{ id: 'p1', fields: { Name: 'Deep Hanger', Price: 7000, Status: 'Active', 'Zoho Item ID': 'z9' } }],
    lines: [line('l1', '1_A', 'p1', { Quantity: 2, Subtotal: 14000 })],
    invoices: [invoice('INV1', [zline('Coat Hanger Module', 2, 7000, 'z9')])]
  });
  assert.equal(r.pending.lines.length, 1);
  assert.equal(r.pending.lines[0].now, 14000);
  assert.equal(r.projection[0].projected, r.projection[0].target);
});

await test('the id wins over a name that would match something else', async () => {
  // Two products share a canonical name; only the id says which was sold.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
    products: [
      { id: 'p1', fields: { Name: 'Compact Base', Price: 9500, Status: 'Active', 'Zoho Item ID': 'plain' } },
      { id: 'p2', fields: { Name: 'Compact Base (Trimmed)', Price: 9500, Status: 'Active', 'Zoho Item ID': 'trim' } }
    ],
    lines: [line('l1', '1_A', 'p2', { Quantity: 1, Subtotal: 9500 })],
    invoices: [invoice('INV1', [zline('Compact Base', 1, 9500, 'trim')])]
  });
  assert.equal(r.pending.lines.length, 1, 'the trimmed product is matched by id despite the plain name');
  assert.equal(r.pending.lines[0].now, 9500);
});

await test('a line typed without a catalogue item still falls back to the name', async () => {
  const r = await run({
    ...backfillWorld,
    invoices: [invoice('INV1', [zline('Standard Base', 2, 6500, undefined)])]
  });
  assert.equal(r.pending.lines.length, 1);
  assert.equal(r.pending.lines[0].now, 13000);
});

// ---- seeding delivery details from the invoice ---------------------------
await test('a delivery window crosses as seconds, which is what a duration field is', () => {
  // Writing "14:30" straight into an Airtable duration silently stores nothing.
  assert.equal(hhmmToSeconds('14:30'), 52200);
  assert.equal(hhmmToSeconds('7:00'), 25200);
  assert.equal(hhmmToSeconds('0:05'), 300);
  assert.equal(hhmmToSeconds('25:00'), null);
  assert.equal(hhmmToSeconds(''), null);
  assert.equal(hhmmToSeconds(null), null);
});

await test('a blank order takes everything the invoice offers', () => {
  const out = seedDelivery({}, {
    cf_delivery_date: '2026-09-04',
    cf_delivery_window_start: '9:00',
    cf_delivery_window_end: '12:00',
    cf_delivery_date_status: 'Confirmed',
    cf_client_pickup: false
  });
  assert.deepEqual(out, {
    'Delivery - Scheduled Date': '2026-09-04',
    'Delivery Window Start': 32400,
    'Delivery Window End': 43200,
    // The existing checkbox, not a field of its own: it is what
    // Delivery Details Summary reads to decide whether the driver is told
    // "⚠️ Delivery date not confirmed". There is no separate flag for the
    // window -- a time somebody typed is a time they meant.
    'Delivery - Date Set': true
  });
});

await test('a tentative date leaves the confirmed box alone', () => {
  // A checkbox cannot say "no" and "nobody said" differently, so it is only
  // ever ticked, never cleared -- same rule as Client Pickup.
  assert.deepEqual(seedDelivery({}, { cf_delivery_date_status: 'Tentative' }), {});
  assert.deepEqual(seedDelivery({ 'Delivery - Date Set': true }, { cf_delivery_date_status: 'Tentative' }), {});
});

await test('an order that already has a date keeps it', () => {
  // Airtable owns delivery scheduling after it is seeded: deliveries get moved
  // and re-confirmed by people looking at Airtable, and Zoho never hears. A
  // July invoice must not be able to drag September's delivery back.
  const out = seedDelivery(
    { 'Delivery - Scheduled Date': '2026-09-20', 'Delivery - Date Set': true },
    { cf_delivery_date: '2026-07-04', cf_delivery_date_status: 'Tentative' }
  );
  assert.deepEqual(out, {});
});

await test('a 00:00 window is a real time, not an empty one', () => {
  const out = seedDelivery({}, { cf_delivery_window_start: '0:00' });
  assert.equal(out['Delivery Window Start'], 0);
});

await test('an existing 00:00 window is not treated as blank and overwritten', () => {
  const out = seedDelivery({ 'Delivery Window Start': 0 }, { cf_delivery_window_start: '9:00' });
  assert.equal(out['Delivery Window Start'], undefined);
});

await test('pickup can only ever be set by an invoice, never cleared', () => {
  assert.deepEqual(seedDelivery({}, { cf_client_pickup: true }), { 'Client Pickup': true });
  // An invoice silent about pickup must not untick a box somebody ticked.
  assert.deepEqual(seedDelivery({ 'Client Pickup': true }, {}), {});
  assert.deepEqual(seedDelivery({ 'Client Pickup': true }, { cf_client_pickup: false }), {});
});

await test('a status Zoho does not recognise is not written', () => {
  assert.deepEqual(seedDelivery({}, { cf_delivery_date_status: 'Maybe' }), {});
});

await test('seeding is idempotent, so a repeated full pass writes nothing twice', () => {
  const cf = {
    cf_delivery_date: '2026-09-04', cf_delivery_window_start: '9:00',
    cf_delivery_date_status: 'Confirmed', cf_client_pickup: true
  };
  const first = seedDelivery({}, cf);
  assert.deepEqual(seedDelivery(first, cf), {});
});

// ---- naming what is missing, not just the money ------------------------
await test('days apart is symmetric and whole', () => {
  assert.equal(daysApart('2026-02-05', '2026-02-09'), 4);
  assert.equal(daysApart('2026-02-09', '2026-02-05'), 4);
  assert.equal(daysApart('2026-02-05', '2026-02-05'), 0);
});

await test('a line the invoice has and the order does not is named', () => {
  const out = unmatchedLines(
    [{ name: 'Standard Base', quantity: 1 }],
    [{ name: 'Standard Base', quantity: 1 }, { name: 'Standard Extension', quantity: 2 }]
  );
  assert.deepEqual(out.onInvoice, ['2 x Standard Extension']);
  assert.deepEqual(out.inAirtable, []);
});

await test('a line the order has and the invoice does not is named too', () => {
  const out = unmatchedLines(
    [{ name: 'Standard Base', quantity: 1 }, { name: 'Bookend', quantity: 1 }],
    [{ name: 'Standard Base', quantity: 1 }]
  );
  assert.deepEqual(out.inAirtable, ['Bookend']);
  assert.deepEqual(out.onInvoice, []);
});

await test('a rename is not an absence', () => {
  // Invoice line names are snapshots: a 2025 line still says "Shelf - Standard
  // Base". Reporting that as a missing product would send someone hunting for
  // a line that is right there.
  const out = unmatchedLines(
    [{ name: 'Standard Base', quantity: 1 }],
    [{ name: 'Shelf - Standard Base', quantity: 1 }]
  );
  assert.deepEqual(out.onInvoice, []);
  assert.deepEqual(out.inAirtable, []);
});

await test('matching products in different numbers are not called missing', () => {
  // That is a quantity fault with a different fix; folding the two together
  // produces a sentence true of neither.
  const out = unmatchedLines(
    [{ name: 'Standard Base', quantity: 1 }],
    [{ name: 'Standard Base', quantity: 3 }]
  );
  assert.deepEqual(out.onInvoice, []);
  assert.deepEqual(out.inAirtable, []);
});

await test('an order short only by its catch-all is not an error forever', async () => {
  // Custom Item is bespoke work with no Zoho twin, so it can never be priced
  // from the invoice and the order is short by exactly its value on every pass.
  const r = await run({
    orders: [order('1_A', { 'Zoho Invoice': 'INV1' })],
    products: [product('pB', 'Standard Base', 6500), product('pC', 'Custom Item', 4000)],
    lines: [
      line('l1', 'rec1', 'pB', { 'Zoho Line Total': 6500 }),
      line('l2', 'rec1', 'pC', { 'Zoho Line Total': null })
    ],
    invoices: [invoice('INV1', [zline('Standard Base', 1, 6500, 'itB'), zline('Custom Item', 1, 4000, 'itC')])]
  });
  const f = of(r, 'line-totals-match-invoice');
  if (f.length) assert.notEqual(f[0].severity, 'Error', 'a difference nobody can close must not be an Error');
});

console.log(`test-reconcile: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);

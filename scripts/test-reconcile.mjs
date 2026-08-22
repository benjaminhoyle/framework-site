// The checks themselves, against fixtures. No network, no credentials.
//
// Zoho allows 2,000 API calls a day, so the checks cannot be exercised freely
// against the live API — and they are the part most worth testing, because each
// one either writes to the order pipeline or tells someone their books are
// wrong. Every case below is one we actually hit while reconciling three years
// of invoices.

import assert from 'node:assert/strict';
import { reconcile } from '../netlify/functions/_sync.mjs';

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
const zline = (name, quantity, rate) => ({
  name, quantity, rate, item_total: rate * quantity / 1.16, item_custom_fields: []
});
const invoice = (number, lines, extra = {}) => ({
  invoice_id: `id_${number}`, invoice_number: number, status: 'paid',
  date: '2026-02-01', customer_name: 'Someone', total: 0,
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
    payments: { id_INV1: [{ date: '2026-02-09' }, { date: '2026-03-20' }] }
  };
  const r = await run(world);
  const f = of(r, 'metadata-drift');
  assert.equal(f.length, 1);
  assert.match(f[0].event, /2026-02-05 vs first 2026-02-09/);
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

console.log(`test-reconcile: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);

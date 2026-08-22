// Tests for the order sync's pure helpers. No network, no credentials.
//
// These cover the three things that were actually got wrong while building it:
// which Zoho field is VAT-inclusive, how an invoice-level discount lands on a
// line, and that legacy item names still match today's products.

import assert from 'node:assert/strict';
import { money, round2 } from '../netlify/functions/_zoho.mjs';
import { stripLegacy, apportionFactor } from '../netlify/functions/_sync.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; }
  catch (err) { console.error(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; }
};

// --- money(): the tax-inclusive trap -----------------------------------
// The org is tax-inclusive, so `rate` is what the customer sees and
// `item_total` is ex-VAT. Goods must use rate; delivery must use item_total.
// Swapping them is a silent 16% error in opposite directions.
const invoice = {
  discount_total: 0,
  line_items: [
    { name: 'Standard Base', quantity: 1, rate: 6500, item_total: 5603.45 },
    { name: 'Standard Extension', quantity: 2, rate: 5500, item_total: 9482.76 },
    { name: 'Delivery Fees', quantity: 1, rate: 2000, item_total: 1724.14 }
  ]
};

test('goods total uses the VAT-inclusive rate', () => {
  assert.equal(money(invoice).goods, 17500); // 6500 + 2*5500
});

test('delivery uses the ex-VAT item_total, not the rate', () => {
  const m = money(invoice);
  assert.equal(m.deliveryExVat, 1724.14);
  assert.notEqual(m.deliveryExVat, 2000, 'delivery must not pick up the incl-VAT figure');
  assert.equal(round2(m.deliveryExVat * 1.16), 2000);
});

test('delivery is excluded from goods', () => {
  assert.equal(money(invoice).lines.length, 2);
  assert.equal(money(invoice).hasDeliveryLine, true);
});

test('an invoice with no delivery line reports zero, not a missing line', () => {
  const m = money({ discount_total: 0, line_items: [{ name: 'Bookend', quantity: 4, rate: 1000, item_total: 3448.28 }] });
  assert.equal(m.hasDeliveryLine, false);
  assert.equal(m.deliveryExVat, 0);
  assert.equal(m.goods, 4000);
});

test('a zero-rated line contributes zero, and is still a line', () => {
  // Reps zero-rate deliberately — four times this year. It must not be treated
  // as missing data and quietly repriced from the catalogue.
  const m = money({ discount_total: 0, line_items: [{ name: 'Bookend', quantity: 4, rate: 0, item_total: 0 }] });
  assert.equal(m.goods, 0);
  assert.equal(m.lines.length, 1);
});

// --- invoice-level discounts -------------------------------------------
test('no discount leaves lines untouched', () => {
  assert.equal(apportionFactor(64000, 0), 1);
});

test('an invoice-level discount is spread in proportion', () => {
  // 246_Fadhuma: 64,000 of goods with an 11,207 discount applied to the invoice.
  const f = apportionFactor(64000, 11207);
  assert.equal(round2(64000 * f), 52793);
});

test('apportioning is safe on an empty invoice', () => {
  assert.equal(apportionFactor(0, 500), 1);
  assert.equal(apportionFactor(0, 0), 1);
});

// --- legacy item names --------------------------------------------------
test('legacy Shelf- prefixes match today catalogue names', () => {
  assert.equal(stripLegacy('Shelf - Standard Base'), 'Standard Base');
  assert.equal(stripLegacy('Shelf - Wide Adapter'), 'Wide Adapter');
});

test('current names pass through unchanged', () => {
  assert.equal(stripLegacy('Standard Base'), 'Standard Base');
  assert.equal(stripLegacy('Delivery Fees'), 'Delivery Fees');
  assert.equal(stripLegacy(''), '');
  assert.equal(stripLegacy(null), '');
});

test('round2 keeps two places without float noise', () => {
  assert.equal(round2(1724.135), 1724.14);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

console.log(`test-sync: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);

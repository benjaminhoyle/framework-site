// Turning a design into invoice lines. No network, no credentials.
//
// The cases here are the ones that would produce a wrong invoice quietly rather
// than loudly: colour dropped from a mixed-finish shelf, a trimmed unit invoiced
// as the untrimmed one, an unrecognised module vanishing from the total.

import assert from 'node:assert/strict';
import {
  zohoItemName, finishLabel, groupDesign, buildLineItems, linesTotal, quoteDrift
} from '../netlify/functions/_push.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; }
  catch (err) { console.error(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; }
};

const item = (name, rate, item_id = `it_${name}`) => ({ name, rate, item_id, status: 'active' });
const CATALOGUE = [
  item('Standard Base', 6500), item('Standard Extension', 5500),
  item('Standard Base (Trimmed)', 6500), item('Bookend', 1000),
  item('Lamp', 4500), item('Retired Thing', 100)
];
CATALOGUE.push({ name: 'Inactive Thing', rate: 999, item_id: 'it_x', status: 'inactive' });

const inst = (type, extra = {}) => ({ id: type, type, originWorldMm: [0, 0, 0], ...extra });

// ---- module id -> Zoho item name ---------------------------------------
test('a plain module maps to its catalogue name', () => {
  assert.equal(zohoItemName('standard_base'), 'Standard Base');
  assert.equal(zohoItemName('wide_top_bar'), 'Wide Top Bar');
});

test('a trimmed module keeps its parenthesised suffix', () => {
  // The builder shows "Standard Base" for this in Simple mode. Invoicing the
  // label rather than the id would build the wrong unit at the same price —
  // invisible as a money error, visible when it arrives.
  assert.equal(zohoItemName('standard_base_trimmed'), 'Standard Base (Trimmed)');
  assert.equal(zohoItemName('compact_extension_trimmed'), 'Compact Extension (Trimmed)');
});

test('finish ids become the Colour values Zoho stores', () => {
  assert.equal(finishLabel('marine'), 'Marine');
  assert.equal(finishLabel('coral'), 'Coral');
  assert.equal(finishLabel(null), '');
});

// ---- grouping ----------------------------------------------------------
test('identical pieces in one colour become a single line', () => {
  const g = groupDesign({ finish: 'sage', instances: [inst('standard_base'), inst('standard_base')] });
  assert.equal(g.length, 1);
  assert.deepEqual(g[0], { moduleId: 'standard_base', finish: 'sage', quantity: 2 });
});

test('the same piece in two colours becomes two lines', () => {
  // priceBreakdown() in the builder groups by module alone and would report
  // "2 x Standard Base". Both systems carry colour per line; the workshop
  // cannot paint an average.
  const g = groupDesign({
    finish: 'sage',
    instances: [inst('standard_base'), inst('standard_base', { finish: 'marine' })]
  });
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => [x.finish, x.quantity]).sort(), [['marine', 1], ['sage', 1]]);
});

test('bookends are counted even though they are not instances', () => {
  const g = groupDesign({ finish: 'charcoal', bookends: 4, instances: [inst('standard_base')] });
  const b = g.find((x) => x.moduleId === 'bookend');
  assert.deepEqual(b, { moduleId: 'bookend', finish: 'charcoal', quantity: 4 });
});

test('zero bookends add no line', () => {
  const g = groupDesign({ finish: 'sage', bookends: 0, instances: [inst('standard_base')] });
  assert.equal(g.length, 1);
});

test('grouping is stable, so one design always invoices identically', () => {
  const a = groupDesign({ finish: 'sage', instances: [inst('standard_extension'), inst('standard_base')] });
  const b = groupDesign({ finish: 'sage', instances: [inst('standard_base'), inst('standard_extension')] });
  assert.deepEqual(a, b);
});

test('a design with no instances is refused, not silently empty', () => {
  assert.throws(() => groupDesign({ finish: 'sage' }), /no instances/);
  assert.throws(() => groupDesign(null), /no instances/);
});

// ---- line items --------------------------------------------------------
test('lines are priced from Zoho and carry their colour', () => {
  const { line_items, unknown } = buildLineItems(
    groupDesign({ finish: 'coral', instances: [inst('standard_base'), inst('standard_extension')] }),
    CATALOGUE
  );
  assert.equal(unknown.length, 0);
  assert.equal(line_items.length, 2);
  const base = line_items.find((l) => l.name === 'Standard Base');
  assert.equal(base.rate, 6500);
  assert.equal(base.item_id, 'it_Standard Base');
  assert.deepEqual(base.item_custom_fields, [{ api_name: 'cf_color', value: 'Coral' }]);
});

test('an unrecognised module is reported, not dropped', () => {
  const { line_items, unknown } = buildLineItems(
    groupDesign({ finish: 'sage', instances: [inst('standard_base'), inst('flux_capacitor')] }),
    CATALOGUE
  );
  assert.equal(line_items.length, 1);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].expected, 'Flux Capacitor');
  assert.equal(unknown[0].quantity, 1);
});

test('an inactive Zoho item does not count as a match', () => {
  const { unknown } = buildLineItems([{ moduleId: 'inactive_thing', finish: 'sage', quantity: 1 }], CATALOGUE);
  assert.equal(unknown.length, 1, 'retired products must not be sellable through the builder');
});

test('the total is what the lines add up to', () => {
  const { line_items } = buildLineItems(
    groupDesign({ finish: 'sage', bookends: 2, instances: [inst('standard_base'), inst('standard_extension')] }),
    CATALOGUE
  );
  assert.equal(linesTotal(line_items), 6500 + 5500 + 2000);
});

// ---- quote drift -------------------------------------------------------
test('a matching quote reports no drift', () => {
  assert.equal(quoteDrift([{ rate: 6500, quantity: 1 }], 6500), null);
});

test('a quote raised before a price change reports the difference', () => {
  const d = quoteDrift([{ rate: 7000, quantity: 1 }], 6500);
  assert.deepEqual(d, { quoted: 6500, now: 7000, delta: 500 });
});

test('an unsaved quote total is not treated as a zero quote', () => {
  assert.equal(quoteDrift([{ rate: 6500, quantity: 1 }], null), null);
});

console.log(`test-push: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);

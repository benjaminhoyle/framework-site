// Turning a design into invoice lines. No network, no credentials.
//
// The cases here are the ones that would produce a wrong invoice quietly rather
// than loudly: colour dropped from a mixed-finish shelf, a trimmed unit invoiced
// as the untrimmed one, an unrecognised module vanishing from the total.

import assert from 'node:assert/strict';
import {
  zohoItemName, finishLabel, groupDesign, buildLineItems, linesTotal, quoteDrift,
  deliveryLine, goodsLines, samePhone, sameAddress, contactDetails, contactName,
  contactUpdate, newContactPayload, airtableClientPatch, clientDisagreement
} from '../netlify/functions/_push.mjs';
import { draftInvoicePayload } from '../netlify/functions/_zoho.mjs';

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
CATALOGUE.push(item('Delivery Fees', 2000, 'it_delivery'));

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

// ---- the 16% that nearly went out --------------------------------------
test('a raised invoice is always tax-INCLUSIVE', () => {
  // The org is tax-inclusive and catalogue rates already contain VAT, but a
  // created invoice defaults to exclusive. INV640435 came back at 20,300 for a
  // 17,500 shelf and nothing in the response said why.
  assert.equal(draftInvoicePayload({ line_items: [] }).is_inclusive_tax, true);
});

test('the caller cannot accidentally drop the tax flag', () => {
  const p = draftInvoicePayload({ customer_id: 'c1', line_items: [{ rate: 6500, quantity: 1 }] });
  assert.equal(p.is_inclusive_tax, true);
  assert.equal(p.customer_id, 'c1');
});

// ---- delivery -----------------------------------------------------------
test('a typed delivery fee becomes one line on the delivery item', () => {
  const line = deliveryLine(CATALOGUE, 2500);
  assert.equal(line.item_id, 'it_delivery');
  assert.equal(line.rate, 2500, 'the typed figure is the rate, not the item default');
  assert.equal(line.quantity, 1);
});

test('no fee, or a zero fee, adds no delivery line at all', () => {
  // A "KSh 0" delivery line reads as a promise that delivery is free.
  assert.equal(deliveryLine(CATALOGUE, 0), null);
  assert.equal(deliveryLine(CATALOGUE, ''), null);
  assert.equal(deliveryLine(CATALOGUE, null), null);
  assert.equal(deliveryLine(CATALOGUE, 'abc'), null);
});

test('the delivery item is found by what it is, not by one exact name', () => {
  const renamed = [item('Delivery and Installation', 0, 'it_d2')];
  assert.equal(deliveryLine(renamed, 3000).item_id, 'it_d2');
});

test('a missing delivery item is reported, not silently dropped', () => {
  const out = deliveryLine([item('Standard Base', 6500)], 2000);
  assert.equal(out.unknown, true);
  assert.equal(out.amount, 2000);
});

test('delivery is excluded from the goods total', () => {
  const lines = [
    { name: 'Standard Base', rate: 6500, quantity: 2 },
    { name: 'Delivery Fees', rate: 2000, quantity: 1 }
  ];
  assert.equal(linesTotal(lines), 15000);
  assert.equal(linesTotal(goodsLines(lines)), 13000);
});

test('a delivery charge is not reported as quote drift', () => {
  // The builder quotes furniture and has never known what delivery costs.
  // Comparing the whole invoice would warn on every delivered order.
  const lines = [
    { name: 'Standard Base', rate: 6500, quantity: 2 },
    { name: 'Delivery Fees', rate: 2000, quantity: 1 }
  ];
  assert.equal(quoteDrift(goodsLines(lines), 13000), null);
  assert.deepEqual(quoteDrift(lines, 13000), { quoted: 13000, now: 15000, delta: 2000 });
});

// ---- client details -----------------------------------------------------
const CONTACT = {
  contact_id: '900', contact_name: 'Jane Doe', first_name: 'Jane', last_name: 'Doe',
  notes: 'interior designer',
  billing_address: { address_id: 'b1', address: '12 Riverside Drive', city: 'Nairobi' },
  shipping_address: { address_id: 's1', address: '12 Riverside Drive' },
  contact_persons: [{ contact_person_id: 'p1', first_name: 'Jane', last_name: 'Doe', mobile: '0722123456', is_primary_contact: true }]
};

test('a phone is read off the primary contact person, not the contact', () => {
  // The contact-level phone/mobile in a Zoho response are read-through copies
  // of the primary person's; a contact with persons has them blank on create.
  const d = contactDetails(CONTACT);
  assert.equal(d.phone, '0722123456');
  assert.equal(d.address, '12 Riverside Drive');
  assert.equal(d.name, 'Jane Doe');
});

test('one number written four ways is still one number', () => {
  for (const written of ['0722123456', '722123456', '+254722123456', '254 722 123 456']) {
    assert.ok(samePhone(written, '0722123456'), `${written} should match`);
  }
  assert.equal(samePhone('0722123456', '0733999888'), false);
});

test('an address is compared without its trailing newline', () => {
  assert.ok(sameAddress('12 Riverside Drive', '12  riverside drive\n'));
  assert.equal(sameAddress('12 Riverside Drive', '14 Riverside Drive'), false);
});

// ---- correcting a client -------------------------------------------------
test('retyping the same number differently is not a correction', () => {
  // Otherwise every push writes a contact update and leaves a "previous phone"
  // note recording no change at all.
  assert.equal(contactUpdate(CONTACT, { phone: '+254722123456', address: '12 Riverside Drive', today: '2026-08-23' }), null);
});

test('leaving a field blank never erases what is on file', () => {
  assert.equal(contactUpdate(CONTACT, { phone: '', address: '', today: '2026-08-23' }), null);
});

test('a new phone updates the existing person rather than adding a second', () => {
  const out = contactUpdate(CONTACT, { phone: '0733999888', today: '2026-08-23' });
  assert.equal(out.payload.contact_persons.length, 1);
  assert.equal(out.payload.contact_persons[0].contact_person_id, 'p1',
    'without the id Zoho adds a second contact person');
  assert.equal(out.payload.contact_persons[0].mobile, '0733999888');
  assert.equal(out.changed.phone, true);
  assert.equal(out.changed.address, false);
});

test('the number it replaced is kept in the notes, dated, above what was there', () => {
  const out = contactUpdate(CONTACT, { phone: '0733999888', today: '2026-08-23' });
  assert.match(out.payload.notes, /^2026-08-23 \(shelf designer\): previous phone 0722123456\ninterior designer$/);
});

test('a new address moves both billing and shipping, keeping the rest of each', () => {
  const out = contactUpdate(CONTACT, { address: '3 Karen Road', today: '2026-08-23' });
  assert.equal(out.payload.billing_address.address, '3 Karen Road');
  assert.equal(out.payload.billing_address.city, 'Nairobi', 'the rest of the address is preserved');
  assert.equal(out.payload.billing_address.address_id, 'b1');
  assert.equal(out.payload.shipping_address.address, '3 Karen Road');
  assert.equal(out.payload.contact_persons, undefined, 'an address change must not touch the phone');
});

test('filling in a blank leaves no "previous" note to read', () => {
  const blank = { contact_persons: [{ contact_person_id: 'p1', is_primary_contact: true }], notes: '' };
  const out = contactUpdate(blank, { phone: '0700111222', today: '2026-08-23' });
  assert.deepEqual(out.replaced, []);
  assert.equal(out.payload.notes, undefined, '"previous phone: (blank)" is noise');
});

// ---- a new client --------------------------------------------------------
test('a new client carries its phone on the contact person, where Zoho keeps it', () => {
  const p = newContactPayload({ first_name: 'Amina', last_name: 'Wanjiru', phone: '0711222333', address: '9 Ngong Road' });
  assert.equal(p.contact_name, 'Amina Wanjiru');
  assert.equal(p.customer_sub_type, 'individual');
  assert.equal(p.contact_persons[0].mobile, '0711222333');
  assert.equal(p.contact_persons[0].is_primary_contact, true);
  assert.equal(p.billing_address.address, '9 Ngong Road');
  assert.equal(p.shipping_address.address, '9 Ngong Road');
});

test('a one-name client does not get a contact name with a dangling space', () => {
  assert.equal(contactName('Kioko', ''), 'Kioko');
  assert.equal(contactName('', 'Kioko'), 'Kioko');
  assert.equal(newContactPayload({ first_name: 'Kioko', last_name: '' }).contact_name, 'Kioko');
});

test('a new client with no address sends no address at all', () => {
  // An empty billing_address on create is not the same as omitting it.
  const p = newContactPayload({ first_name: 'Amina', last_name: 'Wanjiru' });
  assert.equal(p.billing_address, undefined);
  assert.equal(p.contact_persons[0].mobile, undefined);
});

// ---- the Airtable half of a correction -----------------------------------
const ROW = {
  id: 'recABC',
  fields: {
    Name: 'Jane Doe',
    'Primary Phone Number': '0722123456',
    Address: '12 Riverside Drive',
    Notes: 'interior designer',
    'Zoho Contact ID': '900'
  }
};

test('the two records answer "has this changed?" the same way', () => {
  // If they disagreed, one side would be written and the other left alone, and
  // a correction would converge on two different answers.
  const args = { phone: '+254722123456', address: '12  riverside drive\n', today: '2026-08-23' };
  assert.equal(contactUpdate(CONTACT, args), null);
  assert.equal(airtableClientPatch(ROW, args), null);
});

test('a corrected phone patches Base - Clients and keeps the old one in Notes', () => {
  const out = airtableClientPatch(ROW, { phone: '0733999888', today: '2026-08-23' });
  assert.equal(out.fields['Primary Phone Number'], '0733999888');
  assert.equal(out.fields.Address, undefined, 'a phone change must not touch the address');
  assert.match(out.fields.Notes, /^2026-08-23 \(shelf designer\): previous phone 0722123456\ninterior designer$/);
  assert.deepEqual(out.changed, { phone: true, address: false });
});

test('a blank never erases what Base - Clients holds', () => {
  assert.equal(airtableClientPatch(ROW, { phone: '', address: '', today: '2026-08-23' }), null);
});

test('filling a blank client leaves no "previous" note', () => {
  const bare = { id: 'r', fields: { Name: 'New Person' } };
  const out = airtableClientPatch(bare, { phone: '0700111222', address: '9 Ngong Rd', today: '2026-08-23' });
  assert.deepEqual(out.replaced, []);
  assert.equal(out.fields.Notes, undefined);
});

// ---- where the two live records disagree ---------------------------------
test('two real, different numbers are a disagreement for a person to settle', () => {
  const d = clientDisagreement({ phone: '0722123456', address: '12 Riverside Drive' },
    { 'Primary Phone Number': '0733999888', Address: '12 Riverside Drive' });
  assert.deepEqual(d, { phone: true, address: false });
});

test('a blank on one side is a gap, not a disagreement', () => {
  // Most Zoho contacts carry no address at all; flagging every one of those
  // would make the warning mean nothing.
  const d = clientDisagreement({ phone: '0722123456', address: '' },
    { 'Primary Phone Number': '', Address: '12 Riverside Drive' });
  assert.deepEqual(d, { phone: false, address: false });
});

test('the same number written two ways is not a disagreement', () => {
  const d = clientDisagreement({ phone: '+254722123456', address: '12 Riverside Drive' },
    { 'Primary Phone Number': '0722123456', Address: '12  riverside drive\n' });
  assert.deepEqual(d, { phone: false, address: false });
});

console.log(`test-push: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);

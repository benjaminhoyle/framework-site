// Guards the staff app's rules. Every behaviour below runs twice: over the memory store the
// demo uses, and over the Airtable store with a fake Airtable underneath, so the two cannot
// quietly mean different things and the live path is exercised without touching the base.

import { writeLog, readDay, latest, dropBefore } from '../netlify/functions/_log.mjs';
import { newContactPayload } from '../netlify/functions/_push.mjs';
import assert from 'node:assert';
import { handle, designCodeFrom, cleanClientPatch, dedupeDesigns, moduleFor } from '../netlify/functions/_appcore.mjs';
import { airtableStore, T } from '../netlify/functions/_appstore.mjs';
import { memoryStore } from './lib/app-memory-store.mjs';
import rules from '../js/app/rules.js';

const TODAY = '2026-11-06'; // a Friday
const ELVIS = { email: 'e@x', name: 'Elvis', modules: ['clients', 'invoice', 'deliveries'] };
const CHECKER = { email: 'c@x', name: 'Cee', modules: ['clients'] };
const DESIGN = { w: 52, d: 45, h: 163, finish: 'Coral', total: 34000, pieces: [{ qty: 1, name: 'Deep Base' }] };

// ---------------------------------------------------------------- the pure rules

// Wed and Sat, with one full workday (Mon to Sat) between today and the delivery.
const firstDay = (today) => rules.deliveryDaysFrom(today, { count: 1 })[0];
assert.equal(firstDay('2026-11-06'), '2026-11-11', 'Friday, Saturday is the workday: Wednesday');
assert.equal(firstDay('2026-11-07'), '2026-11-11', 'Saturday, Sunday does not count: Monday is, so Wednesday');
assert.equal(firstDay('2026-11-08'), '2026-11-11', 'Sunday, Monday is the workday: Wednesday');
assert.equal(firstDay('2026-11-09'), '2026-11-11', 'Monday, Tuesday is the workday: Wednesday');
assert.equal(firstDay('2026-11-10'), '2026-11-14', 'Tuesday, Wednesday is the workday: Saturday');
assert.equal(firstDay('2026-11-11'), '2026-11-14', 'Wednesday: Saturday');
assert.equal(firstDay('2026-11-12'), '2026-11-14', 'Thursday, Friday is the workday: Saturday');
assert.equal(firstDay('2026-11-13'), '2026-11-18', 'Friday the 13th, Saturday is the workday: not the next day, so Wednesday');
assert.deepEqual(rules.deliveryDaysFrom('2026-11-09', { count: 3 }), ['2026-11-11', '2026-11-14', '2026-11-18'], 'then each one after');

// The links that open on a phone.
const SUITE = 'https://business.facebook.com/latest/inbox';
const WA = `${SUITE}/wec?asset_id=1&business_id=2&ir_qe_exposed=1&mailbox_id=1&selected_item_id=99&thread_type=WEC_MESSAGE`;
const IG = `${SUITE}/instagram_direct?asset_id=1&business_id=2&ir_qe_exposed=1&mailbox_id=1&selected_item_id=88&thread_type=IG_MESSAGE`;
assert.equal(rules.chatHref(WA), `${SUITE}/all?asset_id=1&business_id=2&mailbox_id=1&selected_item_id=99&thread_type=WEC_MESSAGE`, 'WhatsApp, the form that opened');
assert.equal(rules.chatHref(WA, { phone: true }), rules.chatHref(WA), 'the same anywhere');
assert.equal(rules.chatHref(IG), IG, 'Instagram at a desk, as stored');
assert.equal(rules.chatHref(IG, { phone: true }), `${SUITE}/all?asset_id=1&business_id=2&mailbox_id=1`, 'on a phone the inbox, not a dead thread');
assert.equal(rules.chatHref('https://wa.me/254700000000'), 'https://wa.me/254700000000', 'anything else is left alone');
assert.equal(rules.chatHref('not a link'), 'not a link');

// Names: loose enough for how people write theirs, and only ever a suggestion.
const FANCY = '\u{1D517}\u{1D532}\u{1D52A}\u{1D526}.\u{1D512}\u{1D532}\u{1D52A}\u{1D51E}\u{1F380}';
assert(rules.nameResembles(FANCY, 'tumi'), 'odd lettering and emoji wear off');
assert(rules.nameResembles(FANCY, 'ouma'), 'any word of it');
assert(rules.nameResembles('Neema Wanjiku', 'nee'), 'the start of a word');
assert(!rules.nameResembles('Michelle', 'elle'), 'not the inside of one');
assert(rules.nameResembles('\u{1F380}\u{1F380}', '\u{1F380}'), 'a name of nothing but emoji still matches itself');

assert.equal(rules.phoneKey('+254 722 123 456'), '722123456');
assert.equal(rules.phoneKey('0722123456'), '722123456');
assert.equal(rules.phoneKey('123'), '');
const text = rules.searchTextFor({
  client: { name: 'Amina Odhiambo', address: 'Kilimani', phone: '0722123456', notes: '', pin: '' },
  chats: [{ name: 'Wairimu_n', phone: '', key: 991 }],
  designs: [{ code: '1AUCNMH' }],
  orders: [{ invoice: 'INV640482', code: 335, phone: '' }]
});
for (const q of ['amina', 'wairimu', 'ODHIAMBO kilimani', '0722 123', '+254722123456', '1aucnmh', 'inv640482', '#335']) {
  assert(rules.matches(text, q), `search finds it by ${q}`);
}
assert(!rules.matches(text, 'mary'), 'and not by something else');

assert.deepEqual(rules.parseIdentity('https://business.facebook.com/latest/inbox/all?selected_item_id=123&x=1'), { kind: 'thread', thread: '123', text: 'https://business.facebook.com/latest/inbox/all?selected_item_id=123&x=1' });
assert.equal(rules.parseIdentity('+254 722 123 456').kind, 'phone');
assert.equal(rules.parseIdentity('@wairimu_n').text, 'wairimu_n');
assert.equal(rules.parseIdentity('  ').kind, 'empty');

assert.equal(designCodeFrom('https://framework.co.ke/d/1AUCNMH'), '1AUCNMH');
assert.equal(designCodeFrom('framework.co.ke/builder/1AUCNMH?x=1'), '1AUCNMH');
assert.equal(designCodeFrom('1aucnmh'), '1AUCNMH');
assert.equal(designCodeFrom('nope'), null);
assert.deepEqual(rules.designCodesIn('Hi Framework! thanks'), [], 'Framework is not a code');
assert.equal(designCodeFrom('Hi Framework! I designed a shelf and would like to order it. Builder: Advanced. Design code: 25M6S3J. Session: abc'), '25M6S3J', 'the whole builder message');
assert.deepEqual(rules.designCodesIn('framework.co.ke/d/1AUCNMH and framework.co.ke/d/4ZW4GCA'), ['1AUCNMH', '4ZW4GCA'], 'several links');
assert.equal(rules.matches(rules.searchTextFor({ client: { name: 'x' }, chats: [{ threadId: '111' }] }), 'https://b?selected_item_id=111&a=1'), true, 'a pasted chat link searches');
assert.deepEqual((({ name, phone, pickup }) => ({ name, phone, pickup }))(rules.parseReply('Asha Patel\n\nAcacia Court\nUnit 201\nGarden Road\n\n0740842369\nDelivery please')), { name: 'Asha Patel', phone: '0740842369', pickup: false });
assert.equal(rules.parseReply('Asha Patel\nAcacia Court\nUnit 201').address, 'Acacia Court, Unit 201');
assert.equal(rules.parseReply('Zawadi Okoth\nI prefer pick up').pickup, true);
assert.equal(rules.parseReply('Great.\n\nZawadi Okoth\nI prefer pick up').name, 'Zawadi Okoth');
// A design left over from an order long delivered doesn't read as a sale in progress.
const leftovers = { client: { name: 'x', address: 'Kilimani, Nairobi' }, orders: [{ delivered: true, received: '2026-09-01', items: [] }], designs: [{ code: 'A', addedAt: '2026-08-20' }, { code: 'B', addedAt: '2026-08-21', orderId: 'o' }] };
assert.equal(rules.openDesigns(leftovers).length, 0);
assert.equal(rules.indexRow(leftovers, TODAY).line, 'Kilimani', 'where they are tells two of one name apart');
leftovers.designs.push({ code: 'C', addedAt: '2026-10-20' });
assert.equal(rules.stateLine(leftovers, TODAY), '1 design', 'a new design after that does');
assert.deepEqual(cleanClientPatch({ name: '   ', pin: 'p05-1 x', other: 'x' }), { pin: 'P051X' }, 'a page always has a name; unknown fields are dropped');
assert.equal(dedupeDesigns([{ code: 'A', addedAt: '2', invoice: 'INV1' }, { code: 'A', addedAt: '1' }]).length, 1);
assert.equal(dedupeDesigns([{ code: 'A', addedAt: '2', invoice: 'INV1' }, { code: 'A', addedAt: '1' }])[0].invoice, 'INV1', 'keeps what either copy knows');

assert.equal(moduleFor('staff'), 'admin');
assert.equal(moduleFor('clients/x/invoice'), 'invoice');
assert.equal(moduleFor('orders/x/submit'), 'invoice');
assert(moduleFor('orders/x/delivery').includes('clients'));
assert.equal(moduleFor('clients/x'), 'clients');

// ---------------------------------------------------------------- a fake Airtable

function fakeAirtable(seed = {}) {
  const tables = new Map(Object.entries(seed));
  let n = 1;
  const rows = (t) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t); };
  const matchers = [
    [/^RECORD_ID\(\)='([^']*)'$/, (m, r) => r.id === m[1]],
    [/^\{([^}]+)\}='([^']*)'$/, (m, r) => String(r.fields[m[1]] ?? '') === m[2]],
    [/^NOT\(\{([^}]+)\}='([^']*)'\)$/, (m, r) => String(r.fields[m[1]] ?? '') !== m[2]],
    [/^\{([^}]+)\}!=''$/, (m, r) => { const v = r.fields[m[1]]; return Array.isArray(v) ? v.length > 0 : !!v; }]
  ];
  const test = (formula, r) => {
    if (!formula) return true;
    const or = /^OR\((.*)\)$/.exec(formula);
    if (or) return or[1].split(',').some((p) => test(p, r));
    for (const [re, fn] of matchers) {
      const m = re.exec(formula);
      if (m) return fn(m, r);
    }
    throw new Error(`fake Airtable does not know: ${formula}`);
  };
  /** Airtable keeps a link's other side up to date. So does this, for the one that is read. */
  const sync = (t, r) => {
    if (t !== T.clients || !r.fields.Chats) return;
    for (const m of rows(T.messages)) {
      if (r.fields.Chats.includes(m.id)) m.fields['Base - Clients'] = [r.id];
    }
  };
  return {
    tables,
    async all(t) { return rows(t).map((r) => ({ ...r })); },
    async query(t, { filterByFormula } = {}) { return rows(t).filter((r) => test(filterByFormula, r)).map((r) => ({ ...r })); },
    async create(t, recs) {
      return recs.map(({ fields }) => {
        const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined));
        const r = { id: `rec${n++}`, createdTime: '2026-11-06T00:00:00.000Z', fields: clean };
        rows(t).push(r);
        sync(t, r);
        return { ...r };
      });
    },
    async patch(t, recs) {
      return recs.map(({ id, fields }) => {
        const r = rows(t).find((x) => x.id === id);
        assert(r, `patch of a row that does not exist: ${id}`);
        Object.assign(r.fields, fields);
        sync(t, r);
        return { ...r };
      });
    }
  };
}

// ---------------------------------------------------------------- both stores, one script

function memory() {
  const db = {
    clients: [{ id: 'c1', name: 'Asha', phone: '', address: '', pin: '', notes: '', chatIds: ['m1'], zohoContactId: 'z9', orderIds: ['o1'], createdAt: '2026-11-01', lastActivity: '2026-11-01' }],
    chats: [
      { id: 'm1', threadId: '111', name: 'Asha', phone: '0722000111', phones: ['0722000111'], platform: 'WhatsApp' },
      { id: 'm2', threadId: '222', name: 'Neema', phone: '0733000222', phones: ['0733000222'] },
      { id: 'm3', threadId: '333', name: 'Neema', phone: '', phones: [] },
      { id: 'm4', threadId: '444', name: FANCY, phone: '', phones: [], lastContact: '2026-11-07' },
      { id: 'm5', threadId: '555', name: 'Supplier', phone: '', phones: [], status: 'Not Lead', lastContact: '2026-11-07' }
    ],
    orders: [{ id: 'o1', clientId: 'c1', invoice: 'INV1', zohoStatus: 'paid', paid: '2026-11-05', balance: 0, total: 30000, delivered: false, items: [] }],
    designs: [{ id: 'dl', clientId: null, chatId: 'm4', code: 'LOOSE11', w: 52, d: 45, h: 163, finish: 'Coral', total: 34000, pieces: [], addedAt: '2026-11-06', archived: false }],
    places: [{ id: 'pl1', text: 'Acacia Court, Garden Rd', pin: '-1.2670,36.8040' }],
    promotions: [{ id: 'p1', name: 'Free delivery on additions', ends: '2026-11-15' }], staff: [], logs: []
  };
  const store = memoryStore(db, {
    lookupDesign: async (code) => (code === 'UNKNOWN' ? null : DESIGN),
    recolorDesign: async (code, finish) => ({ code: 'RECOLOR', ...DESIGN, finish })
  });
  return { store, name: 'memory', orderId: 'o1' };
}

function airtable() {
  const at = fakeAirtable({
    [T.clients]: [{ id: 'c1', createdTime: '2026-11-01T00:00:00.000Z', fields: { Name: 'Asha', Chats: ['m1'], Orders: ['o1'], 'Zoho Contact ID': 'z9' } }],
    [T.messages]: [
      { id: 'm1', createdTime: 't', fields: { 'Chat Link': 'https://x?selected_item_id=111&thread_type=WEC_MESSAGE', 'Reference Name (can be messy)': 'Asha', 'Chat Phones': '0722000111', 'Base - Clients': ['c1'] } },
      { id: 'm2', createdTime: 't', fields: { 'Chat Link': 'https://x?selected_item_id=222', 'Reference Name (can be messy)': 'Neema', 'Chat Phones': '0733000222' } },
      { id: 'm3', createdTime: 't', fields: { 'Chat Link': 'https://x?selected_item_id=333', 'Reference Name (can be messy)': 'Neema' } },
      { id: 'm4', createdTime: 't', fields: { 'Chat Link': 'https://x?selected_item_id=444', 'Reference Name (can be messy)': FANCY, 'Last Contact': '2026-11-07' } },
      { id: 'm5', createdTime: 't', fields: { 'Chat Link': 'https://x?selected_item_id=555', 'Reference Name (can be messy)': 'Supplier', Status: 'Not Lead', 'Last Contact': '2026-11-07' } }
    ],
    [T.orders]: [{ id: 'o1', createdTime: 't', fields: { 'Client Name': ['c1'], 'Zoho Invoice': 'INV1', 'Payment Received': '2026-11-05', 'Balance to Pay': 0, 'Total Revenue': 30000, 'Order Status': 'To Launch Production' } }],
    [T.lines]: [], [T.designs]: [{ id: 'dl', createdTime: 't', fields: { Code: 'LOOSE11', 'Chat ID': 'm4', Chat: ['m4'], W: 52, D: 45, H: 163, Finish: 'Coral', Total: 34000, 'Added At': '2026-11-06' } }],
    [T.promotions]: [{ id: 'p1', createdTime: 't', fields: { Name: 'Free delivery on additions', Ends: '2026-11-15' } }],
    [T.staff]: [], [T.chatPairs]: []
  });
  let inv = 640500;
  const store = airtableStore({
    at,
    blob: null,
    designLookup: async (code) => (code === 'UNKNOWN' ? null : DESIGN),
    recolor: async (code, finish) => ({ code: 'RECOLOR', ...DESIGN, finish }),
    push: async (args) => { inv += args.revise ? 0 : 1; return { ok: true, invoice_number: args.revise || `INV${inv}`, total: 34000 }; },
    submit: async () => {},
    rename: async () => ({ ok: true }),
    draftOf: async () => ({ fee: 2000, pickup: false, total: 36000, lines: [{ name: 'Deep Base', qty: 1, amount: 34000, color: 'Coral' }] }),
    setDraftDay: async () => {},
    places: {
      search: async () => [{ id: 'pl1', text: 'Acacia Court, Garden Rd' }],
      detail: async () => ({ text: 'Acacia Court, Garden Rd', pin: '-1.2670,36.8040' })
    },
    now: () => Date.parse('2026-11-06T09:00:00Z')
  });
  return { store, name: 'airtable', orderId: 'o1', at };
}

for (const make of [memory, airtable]) {
  const { store, name } = make();
  const call = (method, path, body, person = ELVIS) => handle({ store, person, today: TODAY, method, path, body });
  const says = (msg) => `${name}: ${msg}`;

  // Who may do what.
  assert.equal((await call('GET', 'clients', {}, null)).status, 403, says('nobody signed in'));
  assert.equal((await call('GET', 'staff')).status, 403, says('staff list needs admin'));
  assert.equal((await call('POST', 'clients/c1/invoice', { codes: ['AAAAAAA'] }, CHECKER)).status, 403, says('raising needs invoice'));

  // One form of a path: no spelling reaches a route under a looser module than it needs.
  for (const path of ['/staff', 'staff/', '//staff', 'staff//x']) {
    assert.equal((await call('GET', path, {}, CHECKER)).status, 403, says(`${path} needs admin`));
  }
  for (const path of ['clients/c1/invoice/', 'clients//c1/invoice', '/clients/c1/invoice']) {
    assert.equal((await call('POST', path, { codes: ['AAAAAAA'] }, CHECKER)).status, 403, says(`${path} needs invoice`));
  }
  assert.equal((await call('POST', 'orders//o1/submit', {}, CHECKER)).status, 403, says('sending for approval needs invoice'));

  // A page opens on the facts it has.
  let out = await call('GET', 'clients/c1');
  assert.equal(out.json.doc.client.name, 'Asha', says('page'));
  assert.equal(out.json.doc.chats[0].threadId, '111', says('its chat'));
  assert.equal((await call('GET', 'clients/nope')).status, 404, says('no such client'));

  // New client: a link or number is exact and goes to the page that exists.
  out = await call('POST', 'clients', { q: 'https://business.facebook.com/x?selected_item_id=111' });
  assert.deepEqual([out.json.id, out.json.existed], ['c1', true], says('pasted link finds the page'));
  out = await call('POST', 'clients', { q: '+254 722 000 111' });
  assert.equal(out.json.id, 'c1', says('number finds the page'));
  // A name only ever suggests.
  out = await call('POST', 'clients', { q: 'Neema' });
  assert.equal(out.json.choose.length, 2, says('two Neemas, so it asks'));
  out = await call('POST', 'clients', { q: 'Neema', chatId: 'm3' });
  assert.equal(out.json.existed, false, says('the chosen chat gets a page'));
  assert.equal(out.json.doc.client.name, 'Neema', says('and comes back whole, so it lands in the list at once'));
  const neema = out.json.id;
  assert.equal((await call('GET', `clients/${neema}`)).json.doc.chats[0].id, 'm3', says('linked to that chat'));
  out = await call('POST', 'clients', { q: 'Neema', chatId: 'm3' });
  assert.deepEqual([out.json.id, out.json.existed], [neema, true], says('never a second page for a chat'));
  out = await call('POST', 'clients', { q: 'Somebody New' });
  assert.equal(out.json.existed, false, says('no chat yet is fine'));
  assert.equal((await call('POST', 'clients', { q: '' })).status, 422, says('empty'));

  // Details as they arrive, and the name can change while the chat name stays.
  out = await call('PATCH', 'clients/c1', { phone: '0700', address: 'Garden Rd\nUnit 201', pin: 'p05 1x' });
  assert.equal(out.json.client.phone, '0700', says('phone saved'));
  assert.equal(out.json.client.pin, 'P051X', says('pin tidied'));
  assert.equal((await call('GET', 'clients/c1')).json.doc.client.address, 'Garden Rd\nUnit 201', says('an address keeps its lines'));
  assert.equal((await call('PATCH', 'clients/c1', { name: '' })).status, 422, says('no blank name'));
  // A name on orders is in every Order ID, so it stays. A lead's is free until there is an order.
  assert.equal((await call('PATCH', 'clients/c1', { name: 'Someone Else' })).status, 409, says('a client with orders keeps their name'));
  assert.equal((await call('PATCH', 'clients/c1', { name: 'Asha' })).status, 200, says('saving the same name is not a change'));
  out = await call('PATCH', `clients/${neema}`, { name: 'Neema Wambui' });
  assert.equal(out.json.client.name, 'Neema Wambui', says('a lead can be renamed'));

  // Designs.
  out = await call('POST', 'clients/c1/designs', { code: 'https://framework.co.ke/d/1AUCNMH' });
  assert.equal(out.json.doc.designs.length, 1, says('added by link'));
  const row = out.json.doc.designs[0];
  assert.deepEqual([row.w, row.total], [52, 34000], says('with its size and price'));
  out = await call('POST', 'clients/c1/designs', { code: '1AUCNMH' });
  assert.equal(out.json.doc.designs.length, 1, says('the same code twice is one design'));
  assert.equal((await call('POST', 'clients/c1/designs', { code: 'junk' })).status, 422, says('not a code'));
  assert.equal((await call('POST', 'clients/c1/designs', { code: 'UNKNOWN' })).status, 404, says('no such design'));
  out = await call('POST', 'clients/c1/recolor', { code: '1AUCNMH', finish: 'Sage' });
  assert.equal(out.json.code, 'RECOLOR', says('recolour gives the new code'));
  assert.equal(out.json.doc.designs.length, 2, says('and both stay on the page'));

  // Removing is archiving, and it comes back.
  out = await call('PATCH', `designs/${row.id}`, { archived: true });
  assert.equal(out.json.doc.designs.find((d) => d.code === '1AUCNMH').archived, true, says('archived'));
  out = await call('POST', 'clients/c1/designs', { code: '1AUCNMH' });
  assert.equal(out.json.doc.designs.find((d) => d.code === '1AUCNMH').archived, false, says('adding it again brings it back'));

  // Invoice: two shelves, one draft, listed once and revisable.
  assert.equal((await call('POST', 'clients/c1/invoice', { codes: [] })).status, 422, says('needs a design'));
  out = await call('POST', 'clients/c1/invoice', { codes: ['1AUCNMH', 'RECOLOR'], delivery_fee: '2000' });
  const invoice = out.json.raised.invoice_number;
  assert(invoice, says('draft raised'));
  const draft = out.json.doc.orders.find((o) => o.invoice === invoice);
  assert.equal(draft.zohoStatus, 'draft', says('it shows as a draft'));
  assert.equal(out.json.doc.designs.filter((d) => d.invoice === invoice).length, 2, says('both designs carry it'));
  assert.equal(rules.stateLine(out.json.doc, TODAY).startsWith('No delivery yet'), true, says('the earlier paid order comes first in the line'));
  // A design is on one invoice: not billed twice from two devices or a stale page.
  out = await call('POST', 'clients/c1/invoice', { codes: ['1AUCNMH'] });
  assert.deepEqual([out.status, out.json.error, out.json.invoice_number], [409, 'already_on_invoice', invoice], says('already on the draft'));
  // Only their own draft can be changed.
  out = await call('POST', 'clients/c1/invoice', { codes: ['1AUCNMH'], revise: 'INV999' });
  assert.equal(out.status, 409, says('not their draft'));
  // A revision keeps the number and lets go of what came off.
  out = await call('POST', 'clients/c1/invoice', { codes: ['1AUCNMH'], revise: invoice });
  assert.equal(out.json.raised.invoice_number, invoice, says('a revision keeps the number'));
  assert.equal(out.json.doc.designs.find((d) => d.code === 'RECOLOR').invoice, null, says('the shelf that came off can be invoiced again'));
  assert.equal(out.json.doc.designs.find((d) => d.code === '1AUCNMH').invoice, invoice, says('the one that stayed keeps it'));

  // A draft can have a day. Neither approval nor payment holds that back.
  const draftRow = out.json.doc.orders.find((o) => o.invoice === invoice);
  out = await call('POST', `orders/${draftRow.id}/delivery`, { date: '2026-11-21' });
  assert.equal(out.status, 200, says('a day on a draft'));
  assert.equal(out.json.doc.orders.find((o) => o.invoice === invoice).deliveryDate, '2026-11-21', says('the page shows it'));
  const planned = (await call('GET', 'deliveries')).json.orders;
  assert(planned.some((o) => o.invoice === invoice && o.deliveryDate === '2026-11-21'), says('and the planner has it'));

  // The lines come from Zoho, to check before it goes for approval. Payment is optional.
  const drafted = (await call('GET', `orders/${draftRow.id}/draft`)).json.draft;
  assert(drafted.lines.length >= 1, says('the sheet has the lines'));
  assert.equal((await call('POST', 'orders/o1/submit', {})).status, 409, says('an order is not a draft'));
  out = await call('POST', `orders/${draftRow.id}/submit`, {});
  assert.equal(out.json.doc.orders.find((o) => o.invoice === invoice).zohoStatus, 'pending_approval', says('sent with no payment'));

  // Delivery.
  assert.equal((await call('POST', 'orders/o1/delivery', {})).status, 422, says('needs a day or collect'));
  assert.equal((await call('POST', 'orders/o1/delivery', { date: 'soon' })).status, 422, says('needs a real day'));
  out = await call('POST', 'orders/o1/delivery', { date: '2026-11-14' });
  let o1 = out.json.doc.orders.find((o) => o.id === 'o1');
  assert.equal(o1.deliveryDate, '2026-11-14', says('day set'));
  assert.equal(o1.winS, null, says('and no time yet'));
  assert.equal(rules.stateLine(out.json.doc, TODAY), 'Delivery Sat 14', says('the list says so'));
  out = await call('PATCH', 'orders/o1/delivery', { winS: 660, winE: 840, clientState: 'yes' });
  o1 = out.json.doc.orders.find((o) => o.id === 'o1');
  assert.deepEqual([o1.winS, o1.winE], [660, 840], says('the planner\'s time comes back'));
  out = await call('POST', 'orders/o1/delivery', { collect: true });
  o1 = out.json.doc.orders.find((o) => o.id === 'o1');
  assert.equal(o1.pickup, true, says('pickup and delivery swap after payment'));
  assert.equal(o1.deliveryDate, null, says('with no day yet'));

  // A named offer goes on the promotion, by chat, and shows on the page.
  out = await call('POST', 'clients/c1/offers', { promotionId: 'p1' });
  assert.deepEqual(out.json.doc.offers.map((p) => p.name), ['Free delivery on additions'], says('offer recorded'));
  out = await call('POST', 'clients/c1/offers', { promotionId: 'p1' });
  assert.equal(out.json.doc.offers.length, 1, says('once'));
  const sentTo = (await call('GET', 'promotions')).json.rows[0].sentTo;
  assert.equal(sentTo.length, 1, says('the promotion knows who got it'));

  // The address box.
  out = await call('POST', 'places', { q: 'acacia' });
  assert.equal(out.json.rows[0].id, 'pl1', says('suggestions'));
  assert.equal((await call('POST', 'places', { q: 'ma' })).json.rows.length, 0, says('too short to ask Google'));
  const place = (await call('POST', 'places/detail', { id: 'pl1' })).json.place;
  out = await call('PATCH', 'clients/c1', { address: place.text, place: place.pin, company: 'Acme Ltd' });
  assert.equal(out.json.client.place, '-1.2670,36.8040', says('a picked address has a pin'));
  assert.equal(out.json.client.company, 'Acme Ltd', says('company kept'));
  out = await call('PATCH', 'clients/c1', { address: 'typed by hand', place: 'not a pin' });
  assert.equal(out.json.client.place, '', says('a typed one has none'));
  assert((await call('GET', 'clients')).json.rows.some((r) => r.id === 'c1' && r.find.includes('acme')), says('company is searchable'));

  // Chats with no page: designs already sent come along, and nobody gets two pages.
  let recent = (await call('GET', 'chats/recent')).json.rows;
  const loose = recent.find((x) => x.id === 'm4');
  assert.equal(loose.designs, 1, says('a recent chat shows what was sent'));
  assert(!recent.some((x) => x.id === 'c1' || x.id === 'm5'), says('not those with a page, nor a marked supplier'));
  const asked = await call('POST', 'clients', { q: 'tumi' });
  assert.equal(asked.json.choose[0].id, 'm4', says('a plain name finds an odd one, and asks'));
  const fresh = await call('POST', 'clients', { chatId: 'm4' });
  assert.deepEqual(fresh.json.doc.designs.map((d) => d.code), ['LOOSE11'], says('the page has what was sent'));
  assert.equal((await call('POST', 'clients', { chatId: 'm4' })).json.existed, true, says('tapped twice, one page'));
  assert.equal((await call('POST', `clients/${fresh.json.id}/offers`, {})).status, 200, says('a page with a chat can have an offer'));
  assert.equal((await call('POST', 'clients', { q: 'https://business.facebook.com/x?selected_item_id=999999' })).json.error, 'chat_not_in', says('a link to a chat not in yet makes no page'));
  const noChat = await call('POST', 'clients', { q: 'Someone New', chatId: null });
  assert.equal((await call('POST', `clients/${noChat.json.id}/offers`, { promotionId: 'p1' })).status, 409, says('one with no chat has nowhere to record it'));

  // The delivery page: Patrick can edit what Peter can, and the log says it was him.
  const PATRICK = { email: 'p@x', name: 'Patrick', modules: ['workshop', 'driver'] };
  assert.equal((await call('GET', 'deliveries', {}, PATRICK)).status, 200, says('Patrick reads the run'));
  assert.equal((await call('PATCH', 'orders/o1/delivery', { winS: 600, winE: 660 }, PATRICK)).status, 200, says('and edits it'));
  assert.equal((await call('POST', 'orders/o1/delivery', { date: '2026-11-21' }, PATRICK)).status, 403, says('giving an order its day is still from the client page'));
  assert.equal((await call('POST', 'log', { table: 'Delivery Stops', rec: 'Sat 14', text: 'Status = done' }, PATRICK)).status, 200, says('what he does is logged'));
  assert.equal((await call('POST', 'log', { text: 'x' }, CHECKER)).status, 403, says('not by someone off the delivery page'));

  // Linking another chat: a link or number only, and never someone else's.
  assert.equal((await call('POST', 'clients/c1/chats', { q: 'Neema' })).status, 422, says('a name is not enough to join two people'));
  assert.equal((await call('POST', 'clients/c1/chats', { q: 'x?selected_item_id=333' })).status, 409, says('that chat is on another page'));
  out = await call('POST', 'clients/c1/chats', { q: '0733000222' });
  assert.equal(out.json.doc.chats.length, 2, says('linked by number'));

  // The list has them all, with something to search on.
  const { rows } = (await call('GET', 'clients')).json;
  assert(rows.some((r) => r.id === 'c1' && r.find.includes('asha')), says('in the list'));
}

// Orders with no Zoho link can't make a second contact, and a raise that already happened is taken up.
{
  const at = fakeAirtable({
    [T.clients]: [
      { id: 'c1', createdTime: 't', fields: { Name: 'V', 'Zoho Contact ID': 'z1' } },
      { id: 'c2', createdTime: 't', fields: { Name: 'W', Orders: ['o2'] } }
    ],
    [T.messages]: [], [T.orders]: [{ id: 'o2', createdTime: 't', fields: { 'Client Name': ['c2'] } }], [T.lines]: [], [T.designs]: [], [T.promotions]: [], [T.staff]: []
  });
  const store = airtableStore({
    at, blob: null, designLookup: async () => DESIGN, recolor: async () => null,
    push: async () => ({ ok: false, error: 'already_raised', invoice_number: 'INV777', httpStatus: 409, status: 'draft' }), submit: async () => {},
    now: () => 0
  });
  const call = (method, path, body) => handle({ store, person: ELVIS, today: TODAY, method, path, body });
  await call('POST', 'clients/c1/designs', { code: '1AUCNMH' });
  const out = await call('POST', 'clients/c1/invoice', { codes: ['1AUCNMH'] });
  assert.equal(out.status, 200, 'Zoho has it and the page did not know: taken up, not raised again');
  assert.equal(out.json.doc.designs[0].invoice, 'INV777');
  await call('POST', 'clients/c2/designs', { code: '1AUCNMH' });
  assert.equal((await call('POST', 'clients/c2/invoice', { codes: ['1AUCNMH'] })).json.error, 'no_zoho_link', 'orders but no contact: a person sorts it out');
}

// A live-only guard: only the delivery fields of an order are ever written.
{
  const { store, at } = airtable();
  await handle({ store, person: ELVIS, today: TODAY, method: 'POST', path: 'orders/o1/delivery', body: { date: '2026-11-14' } });
  const f = at.tables.get(T.orders)[0].fields;
  assert.deepEqual(Object.keys(f).sort(), ['Balance to Pay', 'Client Name', 'Client Pickup', 'Delivery - Date Set', 'Delivery - Scheduled Date', 'Delivery Window End', 'Delivery Window Start', 'Order Status', 'Payment Received', 'Total Revenue', 'Zoho Invoice'].sort(), 'the order sync still owns everything else');
  assert.equal(f['Delivery - Date Set'], false, 'not firm until a time is agreed');
}

// Who did it comes from the sign-in, whatever the page sends.
{
  const seen = [];
  const { store } = airtable();
  const logging = { ...store, log: async (e) => { seen.push(e); } };
  const PATRICK = { email: 'p@x', name: 'Patrick', modules: ['workshop', 'driver'] };
  await handle({ store: logging, person: PATRICK, today: TODAY, method: 'POST', path: 'log', body: { who: 'Peter', table: 'Delivery Stops', rec: 'Sat 14', text: 'Status = done' } });
  assert.equal(seen[0].who, 'Patrick');
  assert.equal(seen[0].action, 'planner');
  assert.equal(seen[0].detail.text, 'Status = done');
}

// A chat linked by hand is what the pipeline's own list of pairs holds too.
{
  const { store, at } = airtable();
  await handle({ store, person: ELVIS, today: TODAY, method: 'POST', path: 'clients/c1/chats', body: { q: '0733000222' } });
  assert.deepEqual(at.tables.get(T.chatPairs)[0].fields['Duplicate Threads'], ['m1', 'm2']);
}

// Invoicing to a company.
{
  const payload = newContactPayload({ first_name: 'Asha', last_name: 'P', phone: '', address: '', pin: '', company: 'Acme Ltd' });
  assert.equal(payload.contact_name, 'Acme Ltd');
  assert.equal(payload.company_name, 'Acme Ltd');
  assert.equal(payload.customer_sub_type, 'business');
  const person = newContactPayload({ first_name: 'Asha', last_name: 'P', phone: '', address: '', pin: '' });
  assert.equal(person.customer_sub_type, 'individual');
}

// The log: one event per blob, nothing overwrites anything, and a failure costs nobody their save.
{
  const blobs = new Map();
  const getStore = () => ({
    async setJSON(key, value) { blobs.set(key, value); },
    async get(key) { return blobs.get(key) ?? null; },
    async delete(key) { blobs.delete(key); },
    async list({ prefix = '', directories = false } = {}) {
      const keys = [...blobs.keys()].filter((k) => k.startsWith(prefix));
      if (!directories) return { blobs: keys.map((key) => ({ key })) };
      return { blobs: [], directories: [...new Set(keys.map((k) => `${k.split('/')[0]}/`))] };
    }
  });
  const at = (iso) => ({ now: () => new Date(iso) });
  await writeLog(getStore, 'sync', { fields: { Outcome: 'Clean' } }, at('2026-11-06T10:00:00Z'));
  await writeLog(getStore, 'sync', { fields: { Outcome: 'Failed' } }, at('2026-11-06T10:00:00Z'));
  await writeLog(getStore, 'app', { action: 'client.create' }, at('2026-11-06T11:00:00Z'));
  await writeLog(getStore, 'sync', { fields: { Outcome: 'Clean' } }, at('2026-11-07T01:00:00Z'));
  assert.equal(blobs.size, 4, 'the same moment twice is two events');
  assert.equal((await readDay(getStore, '2026-11-06')).length, 3, 'a whole day');
  assert.equal((await readDay(getStore, '2026-11-06', 'app')).length, 1, 'or one source of it');
  const newest = await latest(getStore, 'sync', 2, at('2026-11-07T02:00:00Z'));
  assert.equal(newest[0].at, '2026-11-07T01:00:00.000Z', 'newest first, across days');
  assert.equal(newest.length, 2);
  assert.equal((await dropBefore(getStore, '2026-11-07')).dropped, 3, 'old days go');
  assert.equal(blobs.size, 1, 'and only those');
  const broken = () => ({ async setJSON() { throw new Error('down'); } });
  assert.equal(await writeLog(broken, 'app', {}), false, 'a log that is down throws nothing');
}

console.log('app tests pass (rules, memory store, Airtable store over a fake, log)');

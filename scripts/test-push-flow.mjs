// The whole of zoho-push's push, over fakes of Zoho, Airtable and Blobs. test-push covers its pure helpers. This covers
// what happens between them: the paths where a wrong turn raises a second invoice, loses a delivery charge or a typed line,
// or reaches another client's draft.
//
// The handler is loaded from source with its imports swapped, the way test-builder does it for design.js.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pushHelpers = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/_push.mjs')).href);
const { zohoItemName, isDeliveryName } = pushHelpers;

const source = fs.readFileSync(path.join(ROOT, 'netlify/functions/zoho-push.mjs'), 'utf8')
  .replace(/^import \{ getStore \} from '@netlify\/blobs';\s*$/m, 'const { getStore } = globalThis.__fw;')
  .replace(/^import \{ refusePush \} from '.\/_auth.mjs';\s*$/m, 'const refusePush = () => null;')
  .replace(/^import \{ TABLES, all, patch, create \} from '.\/_airtable.mjs';\s*$/m, 'const { TABLES, all, patch, create } = globalThis.__fw.airtable;')
  .replace(/^import \* as zoho from '.\/_zoho.mjs';\s*$/m, 'const zoho = globalThis.__fw.zoho;')
  .replace(/from '.\/_push.mjs'/, `from '${pathToFileURL(path.join(ROOT, 'netlify/functions/_push.mjs')).href}'`);

function world({ designs = {}, drafts = [], createdSince = [] } = {}) {
  const made = [];
  const updated = [];
  const patched = [];
  const created = [];
  let contactFails = false;
  const items = [
    ...['deep_base', 'deep_extension', 'standard_base'].map((m, i) => ({ item_id: `i${i}`, name: zohoItemName(m), rate: 10000 + i, status: 'active' })),
    { item_id: 'dv', name: 'Delivery Fees', rate: 1, status: 'active' }
  ];
  globalThis.__fw = {
    getStore: (name) => ({
      get: async (key) => (name === 'design' ? designs[key] || null : null),
      setJSON: async () => {},
      list: async () => ({ blobs: [] })
    }),
    airtable: {
      TABLES: { clients: 'tblClients' },
      all: async () => [],
      patch: async (t, recs) => { if (contactFails) throw new Error('airtable down'); patched.push(...recs); return recs; },
      create: async (t, recs) => { created.push(...recs); return recs.map((r) => ({ id: 'recNew', ...r })); }
    },
    zoho: {
      invoicesCreatedSince: async () => createdSince,
      items: async () => items,
      invoiceFields: async () => new Set(['cf_work_type', 'cf_design_code', 'cf_created_by_rep', 'cf_primary_contact_number', 'cf_delivery_address', 'cf_client_pickup']),
      invoiceByNumber: async (n) => drafts.find((d) => d.invoice_number === n) || null,
      invoice: async (id) => drafts.find((d) => d.invoice_id === id),
      createContact: async (p) => ({ contact_id: 'zNew', contact_name: p.contact_name || 'New Person' }),
      contact: async () => ({ contact_name: 'Existing' }),
      updateContact: async () => {},
      createDraftInvoice: async (p) => { made.push(p); return { invoice_number: 'INV1', invoice_id: 'x1', status: 'draft', total: 1, line_items: p.line_items }; },
      updateDraftInvoice: async (id, p) => { updated.push({ id, ...p }); return { invoice_number: 'INV9', invoice_id: id, status: 'draft', total: 1, line_items: p.line_items }; }
    },
    fail: () => { contactFails = true; }
  };
  return { made, updated, patched, created };
}

const load = async () => {
  const url = `data:text/javascript;base64,${Buffer.from(`${source}\n// ${Math.random()}`).toString('base64')}`;
  return import(url);
};
const call = async (args) => {
  const { push } = await load();
  const res = await push({ rep: 'Elvis', ...args });
  return { http: res.status, ...(await res.json()) };
};

const shelf = (type, finish = 'sage', n = 1) => ({
  design: { finish, bookends: 0, instances: Array.from({ length: n }, () => ({ type })) }, total_ksh: 10000 * n
});

// Two shelves become one invoice, with a shared part counted together, and the codes recorded together.
{
  const w = world({ designs: { AAAAAAA: shelf('deep_base'), BBBBBBB: shelf('deep_base', 'sage', 2) } });
  const out = await call({ codes: ['BBBBBBB', 'AAAAAAA'], contact_id: 'z1', delivery_fee: '2000' });
  assert.equal(out.ok, true);
  const lines = w.made[0].line_items;
  assert.equal(lines.find((l) => l.item_id === 'i0').quantity, 3, 'parts add up across shelves');
  assert.equal(lines.find((l) => isDeliveryName(l.name)).rate, 2000, 'delivery is its own line');
  assert.equal(w.made[0].custom_fields.find((f) => f.api_name === 'cf_design_code').value, 'AAAAAAA, BBBBBBB');
}

// Two colours of one part stay two lines: the workshop paints by line.
{
  const w = world({ designs: { AAAAAAA: shelf('deep_base', 'sage'), BBBBBBB: shelf('deep_base', 'coral') } });
  await call({ codes: ['AAAAAAA', 'BBBBBBB'], contact_id: 'z1' });
  assert.equal(w.made[0].line_items.filter((l) => l.item_id === 'i0').length, 2);
}

// One code still works, as the builder's old form sends it.
{
  const w = world({ designs: { AAAAAAA: shelf('deep_base') } });
  assert.equal((await call({ code: 'AAAAAAA', contact_id: 'z1' })).ok, true);
  assert.equal(w.made[0].custom_fields.find((f) => f.api_name === 'cf_design_code').value, 'AAAAAAA');
}

// A code nobody has: nothing raised.
{
  const w = world({ designs: {} });
  assert.equal((await call({ codes: ['AAAAAAA'], contact_id: 'z1' })).error, 'code_not_found');
  assert.equal(w.made.length, 0);
}

// Raising A, then A with B, would bill A twice.
{
  const w = world({
    designs: { AAAAAAA: shelf('deep_base'), BBBBBBB: shelf('standard_base') },
    createdSince: [{ invoice_number: 'INV5', status: 'draft', cf_design_code: 'AAAAAAA', customer_id: 'z1' }]
  });
  const out = await call({ codes: ['AAAAAAA', 'BBBBBBB'], contact_id: 'z1' });
  assert.deepEqual([out.http, out.error, out.invoice_number], [409, 'already_raised', 'INV5']);
  assert.equal(w.made.length, 0);
}

// A revision replaces the lines of that draft, keeps a typed line, and with no fee given keeps the delivery charge.
{
  const draft = {
    invoice_number: 'INV9', invoice_id: 'd9', status: 'draft', customer_id: 'z1', total: 5,
    line_items: [
      { line_item_id: 'a', item_id: 'i0', name: zohoItemName('deep_base'), rate: 10000, quantity: 1 },
      { line_item_id: 'b', item_id: 'dv', name: 'Delivery Fees', rate: 1500, quantity: 1 },
      { line_item_id: 'c', name: 'Anchoring drawing', rate: 700, quantity: 1, description: 'typed in Zoho' }
    ]
  };
  const w = world({ designs: { BBBBBBB: shelf('standard_base') }, drafts: [draft] });
  const out = await call({ codes: ['BBBBBBB'], contact_id: 'z1', revise: 'INV9' });
  assert.equal(out.invoice_number, 'INV9', 'the number the client has seen');
  assert.equal(w.made.length, 0, 'not a second invoice');
  const lines = w.updated[0].line_items;
  assert.deepEqual(lines.map((l) => l.name).sort(), ['Anchoring drawing', 'Delivery Fees', zohoItemName('standard_base')].sort());
  assert.equal(lines.find((l) => isDeliveryName(l.name)).rate, 1500, 'the charge stays');
  assert.equal(lines.find((l) => l.name === 'Anchoring drawing').rate, 700, 'the typed line stays');
  assert(!lines.some((l) => l.line_item_id), 'sent as a whole new list, so nothing is doubled');
  assert.equal(out.was.total, 5, 'and what it said before is handed back to be logged');
}

// A revision with a new fee uses it.
{
  const draft = { invoice_number: 'INV9', invoice_id: 'd9', status: 'draft', customer_id: 'z1', total: 5, line_items: [{ item_id: 'dv', name: 'Delivery Fees', rate: 1500, quantity: 1 }] };
  const w = world({ designs: { BBBBBBB: shelf('standard_base') }, drafts: [draft] });
  await call({ codes: ['BBBBBBB'], contact_id: 'z1', revise: 'INV9', delivery_fee: '2000' });
  assert.equal(w.updated[0].line_items.find((l) => isDeliveryName(l.name)).rate, 2000);
}

// Never past draft, and never someone else's.
{
  const w = world({ designs: { BBBBBBB: shelf('standard_base') }, drafts: [
    { invoice_number: 'INV8', invoice_id: 'd8', status: 'sent', customer_id: 'z1', line_items: [] },
    { invoice_number: 'INV7', invoice_id: 'd7', status: 'draft', customer_id: 'zOther', line_items: [] }
  ] });
  assert.equal((await call({ codes: ['BBBBBBB'], contact_id: 'z1', revise: 'INV8' })).error, 'not_a_draft');
  assert.equal((await call({ codes: ['BBBBBBB'], contact_id: 'z1', revise: 'INV7' })).error, 'not_their_draft');
  assert.equal((await call({ codes: ['BBBBBBB'], contact_id: 'z1', revise: 'INV6' })).error, 'no_such_invoice');
  assert.equal(w.updated.length + w.made.length, 0);
}

// A client page's row takes the new contact, and no second row is made.
{
  const w = world({ designs: { AAAAAAA: shelf('deep_base') } });
  const out = await call({ codes: ['AAAAAAA'], new_client: { first_name: 'Daniel', last_name: 'Mutisya' }, airtable_client_id: 'recPage' });
  assert.equal(out.ok, true);
  assert.equal(w.created.length, 0, 'no second row');
  assert.equal(w.patched[0].id, 'recPage');
  assert.equal(w.patched[0].fields['Zoho Contact ID'], 'zNew');
}

// That write failing doesn't cost the invoice, or read as "this name is in Zoho".
{
  const w = world({ designs: { AAAAAAA: shelf('deep_base') } });
  globalThis.__fw.fail();
  const out = await call({ codes: ['AAAAAAA'], new_client: { first_name: 'Daniel', last_name: 'Mutisya' }, airtable_client_id: 'recPage' });
  assert.equal(out.ok, true, 'the invoice is raised');
  assert.equal(out.client.airtable.ok, false, 'and it says the row was not updated');
  assert.equal(w.made.length, 1);
}

console.log('push flow tests pass');

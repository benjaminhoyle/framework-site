#!/usr/bin/env node
/**
 * The Airtable tables and fields the staff app needs, made by hand.
 *
 *   AIRTABLE_TOKEN=... node scripts/add-app-tables.mjs            # dry run: says what it would do
 *   AIRTABLE_TOKEN=... node scripts/add-app-tables.mjs --commit
 *
 * Additive only: it creates what is missing and changes nothing that exists. Safe to run twice.
 * Airtable's API cannot make formula fields, so nothing here depends on one: a row that needs
 * filtering by its client holds the client's record id as plain text as well as the link.
 *
 * Then put the printed table ids into `T` in netlify/functions/_appstore.mjs. Names work too,
 * but a rename would break them.
 */

const BASE_ID = 'appOTj9wLzFwbQUZj';
const COMMIT = process.argv.includes('--commit');
const CLIENTS = 'tblXu0CYFzDsJSOAt';
const ORDERS = 'tblytDBTVFWFyP2qc';
const MESSAGES = 'tblRVeTjLV1xdcDfy';
const NEWSLETTERS = 'tblp4OVP8F4PUrMyb';

const select = (...names) => ({ choices: names.map((name) => ({ name })) });
const text = (name, description) => ({ name, type: 'singleLineText', ...(description ? { description } : {}) });
const long = (name, description) => ({ name, type: 'multilineText', ...(description ? { description } : {}) });
const when = (name) => ({ name, type: 'dateTime', options: { timeZone: 'Africa/Nairobi', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } });
const day = (name) => ({ name, type: 'date', options: { dateFormat: { name: 'iso' } } });
const num = (name) => ({ name, type: 'number', options: { precision: 0 } });
const check = (name) => ({ name, type: 'checkbox', options: { color: 'greenBright', icon: 'check' } });
const link = (name, tableId) => ({ name, type: 'multipleRecordLinks', options: { linkedTableId: tableId } });

/** New fields on tables that exist. */
const FIELDS = [
  [CLIENTS, link('Chats', MESSAGES)],
  [CLIENTS, when('Last Activity')],
  [CLIENTS, text('Company', 'Optional. A person can be invoiced as their company.')],
  [CLIENTS, text('Address Pin', 'lat,lng from Google Maps when the address was picked from its suggestions. Empty means the client has to confirm where it is.')],
  [NEWSLETTERS, day('Ends')],
  [NEWSLETTERS, text('Chat Words', 'A pattern. When a message we send matches it, the chat job adds that chat to Sent in Messages.')],
  [MESSAGES, text('Chat Phones', 'Numbers for this chat, comma separated: the contact panel and any the client typed. Written by the chat sync, used only to find the right chat.')]
];

const FINISHES = select('Sage', 'Marine', 'Charcoal', 'Coral', 'Mixed');

/** New tables, each with what it needs to stand alone. Links to one another are added after. */
const TABLES = [
  {
    name: 'Clients - Designs',
    description: 'Which designs are on which client page. Written by the staff app and the chat sync. Never delete a row: set Archived.',
    fields: [
      text('Code'), text('Client ID', 'The client\'s record id as text, because a link cannot be filtered by id.'),
      link('Client', CLIENTS), num('W'), num('D'), num('H'), { name: 'Finish', type: 'singleSelect', options: FINISHES },
      { name: 'Total', type: 'currency', options: { precision: 0, symbol: 'KSh' } }, long('Pieces'),
      long('Design Hash', 'The design itself. A copy, so a shelf on a client page survives anything that happens to the design store.'),
      { name: 'Source', type: 'singleSelect', options: select('app', 'quick', 'recolor', 'builder', 'chat', 'invoice') },
      when('Added At'), text('Added By'), when('Sent At'), link('Chat', MESSAGES),
      text('Chat ID', 'The chat\'s record id as text. A design sent in a chat with no page has this and no client until someone makes the page.'),
      text('Invoice'), day('Delivery Day'), check('Draft Pickup'),
      link('Order', ORDERS), { name: 'Invoice Status', type: 'singleSelect', options: select('Awaiting approval') },
      num('Client Said Paid'), check('Archived')
    ]
  },
  {
    name: 'Staff',
    description: 'Who can sign in to framework.co.ke/app and what they can open. Edited on the Admin page.',
    fields: [
      { name: 'Email', type: 'email' }, text('Name'),
      { name: 'Modules', type: 'multipleSelects', options: select('clients', 'invoice', 'deliveries', 'driver', 'workshop', 'tracker', 'monitor', 'marketing', 'catalog', 'studio', 'queue', 'admin') },
      check('Active')
    ]
  }
];

/** Who starts with what. After this it's the Admin page's. */
const STAFF = [
  ['behoyle@gmail.com', 'Ben', ['clients', 'invoice', 'deliveries', 'tracker', 'monitor', 'marketing', 'catalog', 'studio', 'queue', 'admin']],
  ['owitelvis@gmail.com', 'Elvis', ['clients', 'invoice', 'deliveries', 'tracker']],
  ['patrickemali55@gmail.com', 'Patrick', ['workshop', 'driver']],
  ['moveystarlogistics@gmail.com', 'Peter', ['driver']]
];

async function seedStaff(tableId) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ typecast: true, records: STAFF.map(([Email, Name, Modules]) => ({ fields: { Email, Name, Modules, Active: true } })) })
  });
  if (!res.ok) throw new Error(`Airtable ${res.status} seeding Staff: ${(await res.text()).slice(0, 300)}`);
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (!res.ok) throw new Error(`Airtable ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  if (!process.env.AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN is not set');
  console.log(`\n=== add-app-tables === ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);
  const { tables } = await api('/tables');
  const byId = new Map(tables.map((t) => [t.id, t]));
  const byName = new Map(tables.map((t) => [t.name, t]));

  for (const want of TABLES) {
    const have = byName.get(want.name);
    if (have) { console.log(`  = table ${want.name} exists (${have.id})`); continue; }
    if (!COMMIT) { console.log(`  + table ${want.name} would be created, ${want.fields.length} fields`); continue; }
    const made = await api('/tables', { method: 'POST', body: JSON.stringify(want) });
    if (want.name === 'Staff') await seedStaff(made.id);
    console.log(`  + table ${want.name} made: ${made.id}`);
  }

  for (const [tableId, field] of FIELDS) {
    const table = byId.get(tableId);
    if (table.fields.some((f) => f.name === field.name)) { console.log(`  = ${table.name}.${field.name} exists`); continue; }
    if (!COMMIT) { console.log(`  + ${table.name}.${field.name} would be created`); continue; }
    await api(`/tables/${tableId}/fields`, { method: 'POST', body: JSON.stringify(field) });
    console.log(`  + ${table.name}.${field.name} made`);
  }
  if (!COMMIT) console.log('\nNothing changed. Run again with --commit.\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

// The fields the sync writes, created in Airtable.
//
//   node scripts/add-sync-fields.mjs             # say what is missing
//   node scripts/add-sync-fields.mjs --commit    # create it
//
// Airtable's schema API can CREATE a field and RENAME one, and can do nothing
// else: there is no delete, and an existing field's type and options cannot be
// changed (the update endpoint takes name and description, and nothing more).
// So a field created here is permanent, an abandoned one can only be renamed
// `zzz - delete me`, and there are two of those already. Hence the dry run
// first, and hence this being a script somebody reads rather than a line in a
// deploy.
//
// It is idempotent by name: a field that already exists is left exactly as it
// is, so re-running this is safe and says so.
//
// AIRTABLE_TOKEN needs the `schema.bases:write` scope as well as the data
// scopes the functions use. The cloud token deliberately does NOT have it —
// nothing running in Netlify should be able to alter the shape of the base —
// so this is run by hand with a token that does.

const BASE_ID = 'appOTj9wLzFwbQUZj';
const COMMIT = process.argv.includes('--commit');

const TABLES = {
  orders: 'tblytDBTVFWFyP2qc',
  clients: 'tblXu0CYFzDsJSOAt'
};

/**
 * What is being added, and why each one is a field rather than a formula.
 *
 * `Balance to Pay` cannot be derived: Airtable has no idea what has been paid,
 * only what was sold. `KRA PIN` and `VAT Exempt` are facts about a person and
 * belong on the person, not on each of their orders.
 */
const WANTED = [
  {
    table: 'orders',
    name: 'Balance to Pay',
    type: 'currency',
    options: { precision: 0, symbol: 'Ksh ' },
    description:
      'What is still owed on the Zoho invoice, written by the order sync. '
      + 'Zero means nothing is owed; blank means no issued invoice has been read yet '
      + '(a draft is not owed). Feeds Delivery Details Summary, which mentions it only '
      + 'when it is above zero. Do not edit by hand — the next pass overwrites it.'
  },
  {
    table: 'clients',
    name: 'KRA PIN',
    type: 'singleLineText',
    description:
      "The client's own KRA PIN, for invoices that must carry their registration. "
      + 'Kept in step with the Zoho contact: typing one into the shelf designer writes '
      + 'both, and the order sync fills a blank one from the PIN Zoho stamped on their '
      + 'most recent invoice. It never overwrites a PIN that is already here.'
  },
  {
    table: 'clients',
    name: 'VAT Exempt',
    type: 'checkbox',
    options: { icon: 'check', color: 'greenBright' },
    description:
      'This client can be invoiced VAT-exempt — a mission, an NGO, an exemption '
      + 'certificate. Airtable owns this outright: nothing in Zoho records it, and '
      + 'nothing syncs it. The shelf designer shows it when the client is chosen, so '
      + 'whoever raises the invoice knows before they press the button.'
  }
];

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
  console.log(`\n=== add-sync-fields === ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

  const { tables } = await api('/tables');
  const byId = new Map(tables.map((t) => [t.id, t]));

  for (const want of WANTED) {
    const table = byId.get(TABLES[want.table]);
    const existing = table.fields.find((f) => f.name === want.name);
    if (existing) {
      // Type is reported because a field of the right name and the wrong type
      // is the one failure this script cannot fix and must not hide.
      const same = existing.type === want.type;
      console.log(`  = ${table.name}.${want.name} exists (${existing.type})${same ? '' : `  ⚠️  expected ${want.type}`}`);
      continue;
    }
    if (!COMMIT) {
      console.log(`  + ${table.name}.${want.name} (${want.type}) would be created`);
      continue;
    }
    const made = await api(`/tables/${table.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: want.name,
        type: want.type,
        description: want.description,
        ...(want.options ? { options: want.options } : {})
      })
    });
    console.log(`  + ${table.name}.${want.name} created (${made.id})`);
  }

  // `Delivery Details Summary` is not created here, because it already exists
  // and only its formula changed. That was done once, on 2026-08-27, through
  // the same endpoint — see "What the driver is told" in docs/order-sync.md for
  // the block and for the correction it carries about what this API can do.
  console.log(`
  Delivery Details Summary already carries the Balance to Pay block
  (applied 2026-08-27). If this base is ever rebuilt, the formula is in
  docs/order-sync.md under "What the driver is told".
`);
  if (!COMMIT) console.log('(dry run — rerun with --commit to create)\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

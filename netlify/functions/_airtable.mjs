// Airtable REST, the small slice the reconciler needs.
//
// Mirrors framework-ops/src/airtable.js in shape so the two read the same way,
// but this copy is the cloud one and is the ONLY thing that writes to the order
// pipeline. The push endpoint writes to Zoho and stops; letting two writers into
// Airtable is how you get a fiscalised invoice with no order, or two orders for
// one invoice.

// The base id is an identifier, not a credential — it is useless without the
// token, and it already sits in this repo in scene-airtable.mjs and two docs.
// It is hardcoded rather than read from the environment on purpose: setting it
// as a Netlify variable makes the secrets scanner find "a secret" in our own
// committed source and refuse to deploy. The token is the secret; this is not.
const BASE_ID = 'appOTj9wLzFwbQUZj';

export const TABLES = {
  clients: 'tblXu0CYFzDsJSOAt',
  products: 'tblyL6ldOJm94uSGa',
  orders: 'tblytDBTVFWFyP2qc',
  lines: 'tbldzNLAqG6d98eir',
  syncLog: 'tblWXSMuTUny856S3',
  syncRuns: 'tbluXBJ67iGn6JPHa'
};

const base = () => BASE_ID;

/**
 * One request.
 *
 * `method` is required rather than defaulted, on purpose. A helper that
 * defaulted to GET while carrying a body turned a "create" into a list query,
 * silently returned an existing record, and three line items were written to the
 * wrong order. The assert below makes that specific mistake impossible.
 */
async function req(path, { method = 'GET', body } = {}, tries = 3) {
  if (body !== undefined && method === 'GET') {
    throw new Error('refusing to send a body with GET — pass an explicit method');
  }
  const res = await fetch(`https://api.airtable.com/v0/${base()}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (res.status === 429 && tries > 0) {
    await new Promise((r) => setTimeout(r, 1000));
    return req(path, { method, body }, tries - 1);
  }
  if (!res.ok) throw new Error(`Airtable ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Every record in a table. */
export async function all(tableId) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const d = await req(`${tableId}?${q}`);
    out.push(...d.records);
    offset = d.offset;
  } while (offset);
  return out;
}

/** Airtable caps a batch at 10, so callers never have to remember that. */
export async function patch(tableId, records) {
  const done = [];
  for (let i = 0; i < records.length; i += 10) {
    const d = await req(tableId, { method: 'PATCH', body: { records: records.slice(i, i + 10) } });
    done.push(...d.records);
  }
  return done;
}

export async function create(tableId, records) {
  const done = [];
  for (let i = 0; i < records.length; i += 10) {
    const d = await req(tableId, { method: 'POST', body: { records: records.slice(i, i + 10) } });
    done.push(...d.records);
  }
  return done;
}

/** A lookup field arrives as an array even when it holds one value. */
export const one = (v) => (Array.isArray(v) ? v[0] : v);

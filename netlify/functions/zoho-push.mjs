// POST /api/zoho-push — turn a saved design into a DRAFT Zoho invoice.
//
// Reached from the builder's Advanced menu, behind ZOHO_PUSH_KEY. Two actions
// share the endpoint and the key:
//
//   { action: "search", password, query }  -> [{ contact_id, name }]
//   { action: "push",   password, rep, contact_id, code, notes }
//                                          -> { invoice_number, url, ... }
//
// **Draft only.** It cannot send, take payment, void or delete. That constraint
// is what makes a shared typed password proportionate: the worst a leaked one
// buys is junk drafts, which are visible and free to delete. Do not add a "send"
// action here without revisiting the key.
//
// It never writes to Airtable. The reconciler is the only writer there, so a
// push that half-succeeds cannot leave an order without an invoice or an
// invoice without an order — whatever exists gets picked up on the next pass.
//
// Customer search runs against Airtable's Base - Clients rather than Zoho's
// contact list: 189 people who have actually ordered, versus 374 Zoho contacts
// including vendors and duplicates. The Airtable record already carries its
// Zoho Contact ID, so the push resolves rather than guesses, and cannot mint a
// second contact for someone who already has one.

import { getStore } from '@netlify/blobs';
import { refusePush } from './_auth.mjs';
import { TABLES, all } from './_airtable.mjs';
import { groupDesign, buildLineItems, linesTotal, quoteDrift } from './_push.mjs';
import * as zoho from './_zoho.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const CODE_RE = /^[0-9A-Z]{7}$/;

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refusePush(req);
  if (denied) return denied;

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  try {
    if (body.action === 'search') return await search(String(body.query || ''));
    if (body.action === 'push') return await push(body);
    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ ok: false, error: 'failed', detail: String(err.message).slice(0, 300) }, 500);
  }
};

/**
 * Matching clients by name.
 *
 * Returns id and display name only — never phone or address. A leaked password
 * should not also hand over a customer database.
 */
async function search(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return json({ ok: true, results: [] });
  const clients = await all(TABLES.clients);
  const results = clients
    .filter((c) => String(c.fields.Name || '').toLowerCase().includes(q))
    .filter((c) => c.fields['Zoho Contact ID'])
    .slice(0, 12)
    .map((c) => ({ contact_id: c.fields['Zoho Contact ID'], name: c.fields.Name }));
  return json({ ok: true, results });
}

async function push({ code, contact_id, rep, notes }) {
  const upper = String(code || '').toUpperCase();
  if (!CODE_RE.test(upper)) return json({ ok: false, error: 'bad_code' }, 422);
  if (!contact_id) return json({ ok: false, error: 'no_customer' }, 422);
  if (!rep) return json({ ok: false, error: 'no_rep' }, 422);

  const stored = await getStore('design').get(upper, { type: 'json' });
  if (!stored || !stored.design) return json({ ok: false, error: 'code_not_found' }, 404);

  const groups = groupDesign(stored.design);
  const { line_items, unknown } = buildLineItems(groups, await zoho.items());

  // One unrecognised module must not silently vanish from the invoice, and must
  // not fail the rest of it either. The rep is told and adds a manual line.
  if (!line_items.length) {
    return json({ ok: false, error: 'nothing_priceable', unknown }, 422);
  }

  const invoice = await zoho.createDraftInvoice({
    customer_id: contact_id,
    line_items,
    custom_fields: [
      { api_name: 'cf_design_code', value: upper },
      { api_name: 'cf_created_by_rep', value: String(rep).slice(0, 60) }
    ],
    ...(notes ? { notes: String(notes).slice(0, 500) } : {})
  });

  return json({
    ok: true,
    invoice_number: invoice.invoice_number,
    invoice_id: invoice.invoice_id,
    status: invoice.status,
    total: invoice.total,
    url: `https://books.zoho.com/app/${process.env.ZOHO_ORG_ID}#/invoices/${invoice.invoice_id}`,
    lines: line_items.length,
    computed_total: linesTotal(line_items),
    // Surfaced, never blocking: a quote raised before a price change is a
    // normal thing to invoice at today's rate, and reps zero-rate on purpose.
    drift: quoteDrift(line_items, stored.total_ksh),
    unknown
  });
}

export const config = { path: '/api/zoho-push' };

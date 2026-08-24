// POST /api/zoho-push — turn a saved design into a DRAFT Zoho invoice.
//
// Reached from the builder's staff menu, behind ZOHO_PUSH_KEY. Four actions
// share the endpoint and the key:
//
//   { action: "clients" }                  -> every client, [{ contact_id, name }]
//   { action: "client", contact_id }       -> that one client's phone + address
//   { action: "search", query }            -> the old server-side filter, kept
//                                             so a cached page keeps working
//   { action: "push", code, rep, ... }     -> { invoice_number, url, ... }
//
// **Draft only, plus the client record.** It cannot send, take payment, void or
// delete an invoice. It can create a customer and correct a customer's phone and
// address, because a rep raising an order is exactly when those are known — but
// that is the whole of its reach into Zoho, and every one of those writes is
// reversible by hand. Do not add a "send" action here without revisiting the key.
//
// **It never writes to the Airtable ORDER PIPELINE.** The reconciler is the only
// writer there, so a push that half-succeeds cannot leave an order without an
// invoice or an invoice without an order — whatever exists gets picked up on the
// next pass. That is the rule and its reason, and neither is weakened here.
//
// It does write **Base - Clients**, which is a different thing: who a client is,
// not what was sold. A client record cannot leave an order without an invoice.
// The carve-out is necessary rather than convenient, because Base - Clients is
// the only writable home a client's phone and address have — `Orders -
// Pipeline.Delivery Address` is a *lookup* from it, `Delivery Address Baked` is
// a formula over that lookup, and `Delivery Details Summary`, the text a driver
// is sent, is a formula over those. A correction that landed only in Zoho would
// send the van to the old house.
//
// So a correction is written to BOTH live records, and where they already
// disagree the form says so and the rep settles it. The invoice's own
// `cf_delivery_address` / `cf_primary_contact_number` are a third copy and are
// deliberately NOT reconciled: they are a snapshot of where this order went, and
// a client who moves house must not rewrite last year's delivery.
//
// Customer search runs against Airtable's Base - Clients rather than Zoho's
// contact list: 189 people who have actually ordered, versus 374 Zoho contacts
// including vendors and duplicates. The Airtable record already carries its
// Zoho Contact ID, so the push resolves rather than guesses, and cannot mint a
// second contact for someone who already has one.

import { getStore } from '@netlify/blobs';
import { refusePush } from './_auth.mjs';
import { TABLES, all, patch, create } from './_airtable.mjs';
import {
  groupDesign, buildLineItems, linesTotal, quoteDrift,
  deliveryLine, goodsLines, moneyValue, contactDetails, contactName, contactUpdate,
  newContactPayload, airtableClientPatch, clientDisagreement
} from './_push.mjs';
import * as zoho from './_zoho.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const CODE_RE = /^[0-9A-Z]{7}$/;

const clean = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

/**
 * Zoho's delivery window fields are text with a 24h regex, so a browser's
 * "14:30" passes but its empty string would be rejected as malformed.
 */
const time = (v) => {
  const s = clean(v, 5);
  return s && /^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(s) ? s : null;
};

/** Both status dropdowns hold the same two values, and nothing else. */
const STATUSES = ['Tentative', 'Confirmed'];
const status = (v) => (STATUSES.includes(String(v || '')) ? String(v) : null);

const today = () => new Date().toISOString().slice(0, 10);

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refusePush(req);
  if (denied) return denied;

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  try {
    if (body.action === 'clients') return json({ ok: true, results: await clientList() });
    if (body.action === 'client') return await client(String(body.contact_id || ''));
    if (body.action === 'search') return await search(String(body.query || ''));
    if (body.action === 'push') return await push(body);
    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ ok: false, error: 'failed', detail: String(err.message).slice(0, 300) }, 500);
  }
};

// ------------------------------------------------------------------ clients --

/**
 * Every client, once, so the browser can filter locally.
 *
 * The old form asked the server on every keystroke, and every ask paged the
 * whole of Base - Clients out of Airtable to answer it — a quarter of a second
 * of nothing happening after each letter, which is why the dropdown felt broken.
 * The list is small enough (189 names, about 11KB) that the right shape is to
 * send it once and let the input filter an array.
 *
 * Names and ids only — never phone or address. A leaked password should not also
 * hand over a customer database. Details come one at a time, from `client()`.
 *
 * Cached on the module for as long as the container lives, which on Netlify is
 * a few minutes of warm invocations. A client added in Airtable shows up on the
 * next cold start, which is the right trade for a list this static.
 */
const CLIENT_TTL_MS = 5 * 60 * 1000;
let clientCache = { at: 0, list: null };

async function clientList() {
  if (clientCache.list && Date.now() - clientCache.at < CLIENT_TTL_MS) return clientCache.list;

  const rows = await all(TABLES.clients);
  const byId = new Map();
  for (const c of rows) {
    const id = c.fields['Zoho Contact ID'];
    const name = String(c.fields.Name || '').trim();
    if (id && name) byId.set(String(id), { contact_id: String(id), name });
  }

  // A safety net, now that new clients are written to Base - Clients directly:
  // it covers the two cases where a client this endpoint created is not in the
  // list above -- the Airtable create failed, or it succeeded on another warm
  // container whose cache has not expired yet. Without it that client is
  // unfindable, and their second order mints them a second contact, which is the
  // exact failure searching Airtable rather than Zoho was chosen to avoid.
  for (const entry of await mintedClients()) {
    if (!byId.has(entry.contact_id)) byId.set(entry.contact_id, entry);
  }

  const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  clientCache = { at: Date.now(), list };
  return list;
}

/** The contacts this endpoint has created, in case Base - Clients lacks them. */
async function mintedClients() {
  try {
    const store = getStore('client');
    const { blobs } = await store.list();
    const rows = await Promise.all(
      (blobs || []).map((b) => store.get(b.key, { type: 'json' }).catch(() => null))
    );
    return rows.filter((r) => r && r.contact_id && r.name);
  } catch {
    // A missing store is not a reason to fail the whole list: the Airtable half
    // is the useful half, and this one only matters for clients added today.
    return [];
  }
}

/**
 * A new client in Base - Clients, carrying its Zoho Contact ID from birth.
 *
 * Without this a client created here exists in Zoho and nowhere the workshop
 * looks, and somebody has to remember to type them in — which is precisely the
 * divergence this endpoint is otherwise at pains to prevent.
 *
 * It refuses to create a second record for a name already in the list. Airtable
 * has no uniqueness constraint of its own, and a duplicate client is worse than
 * a missing one: `Order ID` is `Order Code & "_" & Client Name`, so two of the
 * same person means orders that look interchangeable and are not.
 */
async function createAirtableClient(contactId, name, phone, address) {
  try {
    const existing = (await all(TABLES.clients)).find((c) => {
      if (String(c.fields['Zoho Contact ID'] || '') === String(contactId)) return true;
      return String(c.fields.Name || '').trim().toLowerCase() === String(name).trim().toLowerCase();
    });
    if (existing) return { ok: true, created: false, record_id: existing.id };
    const fields = { Name: name, 'Zoho Contact ID': String(contactId) };
    if (phone) fields['Primary Phone Number'] = phone;
    if (address) fields.Address = address;
    const [row] = await create(TABLES.clients, [{ fields }]);
    clientCache = { at: 0, list: null };
    return { ok: true, created: true, record_id: row && row.id };
  } catch (err) {
    return { ok: false, detail: String(err.message).slice(0, 200) };
  }
}

async function rememberClient(contact_id, name) {
  try {
    await getStore('client').setJSON(String(contact_id), {
      contact_id: String(contact_id), name, created: new Date().toISOString()
    });
    clientCache = { at: 0, list: null };
  } catch { /* findability is a convenience; the invoice is what matters */ }
}

/** The Base - Clients row for a Zoho contact, or null. */
async function clientRow(contactId) {
  return (await all(TABLES.clients))
    .find((c) => String(c.fields['Zoho Contact ID'] || '') === String(contactId)) || null;
}

/**
 * One client's phone and address, from both records, for prefilling the form.
 *
 * It reads Zoho AND Base - Clients rather than one or the other, because the
 * form is where the two get reconciled. Prefill prefers Zoho and falls back to
 * Airtable — which matters today, because most Zoho contacts were created
 * quickly and carry no address at all while Base - Clients has one for 125 of
 * 185 people, so the fallback is what makes the first push useful.
 *
 * Where both hold a value and the values differ, that is reported rather than
 * silently resolved: there is no way to tell from out here which of two real
 * phone numbers is current, and the person who just spoke to the client can.
 */
async function client(contactId) {
  if (!/^\d{4,}$/.test(contactId)) return json({ ok: false, error: 'bad_contact_id' }, 422);

  let zohoSide = { name: '', first_name: '', last_name: '', phone: '', address: '' };
  let reachedZoho = true;
  try {
    zohoSide = contactDetails(await zoho.contact(contactId));
  } catch {
    // A contact Zoho cannot return is not a reason to refuse the order -- the
    // rep can type the details, and the invoice carries its own copies anyway.
    reachedZoho = false;
  }

  const row = await clientRow(contactId);
  const airtableSide = {
    phone: row ? String(row.fields['Primary Phone Number'] || '').trim() : '',
    address: row ? String(row.fields.Address || '').trim() : ''
  };

  return json({
    ok: true,
    contact_id: contactId,
    name: zohoSide.name || (row ? String(row.fields.Name || '').trim() : ''),
    first_name: zohoSide.first_name,
    last_name: zohoSide.last_name,
    phone: zohoSide.phone || airtableSide.phone,
    address: zohoSide.address || airtableSide.address,
    zoho: reachedZoho ? { phone: zohoSide.phone, address: zohoSide.address } : null,
    airtable: row ? airtableSide : null,
    differs: row && reachedZoho ? clientDisagreement(zohoSide, row.fields) : { phone: false, address: false }
  });
}

/**
 * The old server-side filter.
 *
 * Nothing in the current builder calls it. It stays because `builder.html`
 * carries no version of its own, so for a while after a deploy some browsers are
 * still running the previous app.js against this function, and a form that
 * cannot find a client is worse than a duplicated four lines.
 */
async function search(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return json({ ok: true, results: [] });
  const results = (await clientList())
    .filter((c) => c.name.toLowerCase().includes(q))
    .slice(0, 12);
  return json({ ok: true, results });
}

// --------------------------------------------------------------------- push --

async function push({ code, contact_id, new_client, rep, phone, address, delivery_date,
                      delivery_date_status, window_start, window_end, delivery_time_status,
                      pickup, delivery_fee, notes }) {
  const upper = String(code || '').toUpperCase();
  if (!CODE_RE.test(upper)) return json({ ok: false, error: 'bad_code' }, 422);
  if (!rep) return json({ ok: false, error: 'no_rep' }, 422);

  const collects = pickup === true;
  const wantPhone = clean(phone, 40);
  const wantAddress = clean(address, 500);

  const stored = await getStore('design').get(upper, { type: 'json' });
  if (!stored || !stored.design) return json({ ok: false, error: 'code_not_found' }, 404);

  const groups = groupDesign(stored.design);
  const items = await zoho.items();
  const { line_items, unknown } = buildLineItems(groups, items);

  // One unrecognised module must not silently vanish from the invoice, and must
  // not fail the rest of it either. The rep is told and adds a manual line.
  if (!line_items.length) {
    return json({ ok: false, error: 'nothing_priceable', unknown }, 422);
  }

  // A client who collects is not charged for delivery, whatever is in the box
  // the form just hid. Enforced here rather than trusted to the form, because
  // "hidden" and "not sent" are not the same thing.
  const warnings = [];
  const delivery = collects ? null : deliveryLine(items, delivery_fee);
  if (delivery && delivery.unknown) {
    unknown.push({ moduleId: 'delivery', expected: delivery.expected, quantity: 1, finish: null });
  } else if (delivery) {
    line_items.push(delivery);
  } else if (!collects && String(delivery_fee || '').trim()) {
    // A fee was typed and did not become a line. That must never be silent: it
    // is money the customer would not be charged, on an invoice that looks
    // complete. INV640437 went out without its delivery line and nothing said
    // so.
    warnings.push(`The delivery fee "${String(delivery_fee).slice(0, 20)}" was not a usable amount, so no delivery line was added.`);
  }

  // Either an existing client, or one created here and now. Creating the contact
  // BEFORE the invoice is deliberate: an invoice needs a customer_id, so there is
  // no ordering in which a failure leaves an invoice pointing nowhere. The worst
  // case is a contact with no invoice, which is visible and free to delete.
  let customerId = contact_id ? String(contact_id) : null;
  let clientName = null;
  let created = false;
  let airtableClient = null;
  if (!customerId) {
    const first = clean(new_client && new_client.first_name, 60);
    const last = clean(new_client && new_client.last_name, 60);
    if (!first && !last) return json({ ok: false, error: 'no_customer' }, 422);
    try {
      const contact = await zoho.createContact(newContactPayload({
        first_name: first, last_name: last, phone: wantPhone, address: wantAddress
      }));
      customerId = contact.contact_id;
      clientName = contact.contact_name || contactName(first, last);
      created = true;
      await rememberClient(customerId, clientName);
      // And in Base - Clients, so the two records start life agreeing rather
      // than starting apart and waiting for somebody to remember. Best-effort:
      // the invoice is raised either way, and `rememberClient` above already
      // keeps them findable if this fails.
      airtableClient = await createAirtableClient(customerId, clientName, wantPhone, wantAddress);
    } catch (err) {
      // Zoho refuses a duplicate contact_name, and that refusal is the useful
      // one: it means this person is already in the books under that name.
      const duplicate = /already exists|duplicate/i.test(String(err.message));
      return json({
        ok: false,
        error: duplicate ? 'client_exists' : 'client_failed',
        detail: String(err.message).slice(0, 300)
      }, 422);
    }
  }

  // Only fields the form actually has. cf_work_type is MANDATORY — an invoice
  // without it is refused outright — and a field that has not been created in
  // Zoho yet is skipped rather than failing the push, which is how the two
  // delivery-status dropdowns and cf_created_by_rep shipped ahead of the field.
  const available = await zoho.invoiceFields();
  const wanted = [
    ['cf_work_type', 'Shelving'],
    ['cf_design_code', upper],
    ['cf_created_by_rep', String(rep).slice(0, 60)],
    ['cf_primary_contact_number', wantPhone],
    ['cf_delivery_address', wantAddress],
    ['cf_delivery_date', clean(delivery_date, 10)],
    ['cf_delivery_date_status', delivery_date ? status(delivery_date_status) : null],
    ['cf_delivery_window_start', time(window_start)],
    ['cf_delivery_window_end', time(window_end)],
    // Gated on the times that survived validation, not on what was sent: a
    // window Zoho would reject is a window the invoice does not have, and
    // "Confirmed" against no window at all is worse than saying nothing.
    ['cf_delivery_time_status', (time(window_start) || time(window_end)) ? status(delivery_time_status) : null],
    ['cf_client_pickup', collects ? true : null]
  ];
  const usable = wanted.filter(([, value]) => value !== null && value !== '');
  const custom_fields = usable
    .filter(([name]) => available.has(name))
    .map(([api_name, value]) => ({ api_name, value }));
  // Said out loud rather than dropped: a rep who typed a delivery window is
  // entitled to know it did not reach the invoice.
  const skipped = usable.filter(([name]) => !available.has(name)).map(([name]) => name);

  const invoice = await zoho.createDraftInvoice({
    customer_id: customerId,
    line_items,
    custom_fields,
    ...(notes ? { notes: String(notes).slice(0, 500) } : {})
  });

  // The client's own records, last and best-effort — BOTH of them.
  //
  // The invoice already carries the phone and the address as custom fields of
  // its own, so the order is complete whatever happens down here. That is
  // exactly why these are allowed to be best-effort rather than gates, and why
  // the invoice is raised first: a failure to update a phone number must never
  // cost a rep the invoice they were raising.
  //
  // The two are written independently, so one failing still corrects the other,
  // and each is reported separately — half a correction that says it is half a
  // correction is fixable; one that claims to be whole is not.
  const stamp = today();
  let contactSaved = null;
  let clientSaved = null;
  if (!created && (wantPhone || wantAddress)) {
    try {
      const existing = await zoho.contact(customerId);
      clientName = existing.contact_name || clientName;
      const change = contactUpdate(existing, { phone: wantPhone, address: wantAddress, today: stamp });
      if (change) {
        await zoho.updateContact(customerId, change.payload);
        contactSaved = { ok: true, ...change.changed, replaced: change.replaced };
      }
    } catch (err) {
      // A token issued without ZohoBooks.contacts.UPDATE fails 401 code 57 on
      // every correction. That was the state until 2026-08-24, and it looked
      // exactly like a malformed payload -- so the refusal is recognised by
      // name, and reported as a scope problem rather than a fault, in case a
      // future token is ever issued short again.
      const detail = String(err.message);
      contactSaved = {
        ok: false,
        scope: /\bcode":\s*57\b|not authorized to perform/i.test(detail),
        detail: detail.slice(0, 200)
      };
    }

    try {
      const row = await clientRow(customerId);
      if (!row) {
        // In Zoho but not in Base - Clients: an older contact that never made
        // it across. Say so rather than silently correcting only one side.
        clientSaved = { ok: false, missing: true };
      } else {
        if (!clientName) clientName = String(row.fields.Name || '').trim() || clientName;
        const change = airtableClientPatch(row, { phone: wantPhone, address: wantAddress, today: stamp });
        if (change) {
          await patch(TABLES.clients, [{ id: row.id, fields: change.fields }]);
          clientCache = { at: 0, list: null };
          clientSaved = { ok: true, ...change.changed, replaced: change.replaced };
        }
      }
    } catch (err) {
      clientSaved = { ok: false, detail: String(err.message).slice(0, 200) };
    }
  }

  // The list is already in this container's cache in the warm case, so naming
  // the client costs nothing. Without it the result screen says "the client"
  // for every push where there was no phone or address to write back, because
  // that is the path that never fetches the contact.
  if (!clientName) {
    const known = (await clientList()).find((c) => c.contact_id === String(customerId));
    if (known) clientName = known.name;
  }

  const goods = goodsLines(line_items);
  return json({
    ok: true,
    invoice_number: invoice.invoice_number,
    invoice_id: invoice.invoice_id,
    status: invoice.status,
    total: invoice.total,
    url: `https://books.zoho.com/app/${process.env.ZOHO_ORG_ID}#/invoices/${invoice.invoice_id}`,
    lines: line_items.length,
    computed_total: linesTotal(line_items),
    goods_total: linesTotal(goods),
    delivery_total: delivery && !delivery.unknown ? linesTotal([delivery]) : 0,
    client: { contact_id: customerId, name: clientName, created, airtable: airtableClient },
    contact_saved: contactSaved,
    client_saved: clientSaved,
    warnings,
    skipped_fields: skipped,
    // Surfaced, never blocking: a quote raised before a price change is a
    // normal thing to invoice at today's rate, and reps zero-rate on purpose.
    // Goods only — the builder never quoted delivery, so including it would
    // report a discrepancy on every delivered order.
    drift: quoteDrift(goods, stored.total_ksh),
    unknown
  });
}

export const config = { path: '/api/zoho-push' };

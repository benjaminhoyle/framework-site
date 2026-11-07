// /api/app/*  The staff app's one endpoint. See _appcore.mjs for what it does and
// _appstore.mjs for where the data lives. Every route needs a signed-in staff member.
//
// /api/design-image/<CODE> is here too: the image of a design for the page and for the
// clipboard. It is derived, so it can always be made again in the browser from the
// design itself, and the store for it can be lost without losing anything.

import { getStore } from '@netlify/blobs';
import { all, patch, create, query } from './_airtable.mjs';
import { sessionFrom, sessionAllows } from './_session.mjs';
import { refuseMachine } from './_auth.mjs';
import { handle } from './_appcore.mjs';
import { airtableStore } from './_appstore.mjs';
import { push } from './zoho-push.mjs';
import { submitInvoice, invoiceByNumber, invoice as zohoInvoice, updateContact, updateDraftInvoice } from './_zoho.mjs';
import { writeLog, readDay, latest, dropBefore } from './_log.mjs';
import { readDesign, loadCatalog, assetOrigin, contractTag } from './_designs.mjs';
import { describeRecord, recolorRecord, shapeKey } from './_designinfo.mjs';
import rules from '../../js/app/rules.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const nairobiToday = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);

/**
 * The address box, through Google's Places API, biased to Nairobi. GOOGLE_MAPS_KEY stays on the server.
 * With no key it finds nothing, and the page just treats every address as having no pin yet.
 */
const mapsPlaces = {
  async search(q) {
    if (!process.env.GOOGLE_MAPS_KEY) return [];
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_KEY },
      body: JSON.stringify({
        input: q, includedRegionCodes: ['ke'],
        locationBias: { circle: { center: { latitude: -1.2864, longitude: 36.8172 }, radius: 40000 } }
      })
    });
    if (!res.ok) return [];
    const { suggestions = [] } = await res.json();
    return suggestions.slice(0, 5).map((x) => x.placePrediction).filter(Boolean)
      .map((x) => ({ id: x.placeId, text: x.text ? x.text.text : '' }));
  },
  async detail(id) {
    if (!process.env.GOOGLE_MAPS_KEY) return null;
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
      headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': 'location,formattedAddress' }
    });
    if (!res.ok) return null;
    const p = await res.json();
    return p.location ? { text: p.formattedAddress || '', pin: `${p.location.latitude},${p.location.longitude}` } : null;
  }
};

/** A design's size, finish, price and parts, from the builder's own engine. */
const designLookup = (origin) => async (code) => {
  try {
    const record = await readDesign(origin, code);
    const { catalog } = await loadCatalog(origin);
    return { ...describeRecord(catalog, record), hash: record.hash || '' };
  } catch { return null; }
};

/** The same shelf in another colour, saved like any other design: first write wins. */
const recolor = (origin) => async (code, finish) => {
  try {
    const record = await readDesign(origin, code);
    const { catalog } = await loadCatalog(origin);
    const made = recolorRecord(catalog, record, String(finish).toLowerCase());
    const designs = getStore('design');
    if (!(await designs.get(made.code, { type: 'text' }))) {
      const full = { ...made, created_at: new Date().toISOString() };
      await designs.setJSON(made.code, full);
      await getStore('design-backup').setJSON(made.code, full);
    }
    return { code: made.code, ...describeRecord(catalog, made), hash: made.hash };
  } catch { return null; }
};

const store = (origin) => airtableStore({
  at: { all, patch, create, query },
  blob: getStore('app-cache'),
  designLookup: designLookup(origin),
  recolor: recolor(origin),
  push: async (args) => {
    const res = await push(args);
    return { httpStatus: res.status, ...(await res.json()) };
  },
  rename: async (contactId, name) => {
    try { await updateContact(contactId, { contact_name: name }); return { ok: true }; } catch { return { ok: false }; }
  },
  draftOf: async (invoiceNumber) => {
    const found = await invoiceByNumber(invoiceNumber);
    if (!found) return null;
    const full = await zohoInvoice(found.invoice_id);
    const isFee = (li) => /^delivery/i.test(String(li.name || '').trim());
    const line = (full.line_items || []).find(isFee);
    return {
      fee: line ? Math.round(Number(line.rate) * Number(line.quantity || 1)) : null,
      pickup: String(found.cf_client_pickup_unformatted) === 'true',
      total: full.total,
      lines: (full.line_items || []).filter((li) => !isFee(li)).map((li) => ({
        name: li.name, qty: li.quantity, amount: Number(li.rate) * Number(li.quantity || 1),
        color: (li.item_custom_fields || []).find((f) => f.api_name === 'cf_color')?.value || null
      }))
    };
  },
  setDraftDay: async (invoiceNumber, date, pickup) => {
    const found = await invoiceByNumber(invoiceNumber);
    if (!found) throw new Error('no_such_invoice');
    await updateDraftInvoice(found.invoice_id, {
      customer_id: found.customer_id,
      custom_fields: [
        { api_name: 'cf_delivery_date', value: date || '' },
        { api_name: 'cf_client_pickup', value: pickup === true }
      ]
    });
  },
  places: mapsPlaces,
  log: (event) => writeLog(getStore, 'app', event),
  submit: async (invoiceNumber) => {
    const inv = await invoiceByNumber(invoiceNumber);
    if (!inv) throw new Error('no_such_invoice');
    if (inv.status === 'draft') await submitInvoice(inv.invoice_id);
  }
});

/**
 * A picture quotes a price, so one drawn before the catalogue changed must not be copied into a
 * chat. Each is kept with the catalogue's tag: an old one answers 404, and the page draws it again.
 */
async function designImage(req, code) {
  const images = getStore('design-image');
  if (!sessionAllows(req, 'clients')) return new Response('', { status: 401 });
  const origin = assetOrigin(req);
  const tag = contractTag((await loadCatalog(origin)).raw);
  if (req.method === 'GET') {
    const kept = await images.getWithMetadata(code, { type: 'arrayBuffer' });
    if (!kept || !kept.data || !kept.metadata || kept.metadata.tag !== tag) return new Response('', { status: 404 });
    return new Response(kept.data, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' } });
  }
  if (req.method === 'PUT') {
    const body = await req.arrayBuffer();
    if (body.byteLength > 2e6) return new Response('', { status: 413 });
    await images.set(code, body, { metadata: { tag } });
    return json({ ok: true });
  }
  return new Response('', { status: 405 });
}

/**
 * The log, on the runner's key: GET ?day= for the PC's nightly copy, GET ?source=&limit= for the
 * newest events, DELETE ?before= once the PC has its copy.
 */
async function logRoute(req, url) {
  const denied = refuseMachine(req);
  if (denied) return denied;
  const day = url.searchParams.get('day');
  const source = url.searchParams.get('source');
  if (req.method === 'DELETE') return json({ ok: true, ...(await dropBefore(getStore, String(url.searchParams.get('before') || '').slice(0, 10))) });
  if (day) return json({ ok: true, rows: await readDay(getStore, day, source) });
  return json({ ok: true, rows: await latest(getStore, source || 'sync', Math.min(Number(url.searchParams.get('limit')) || 60, 500)) });
}

/** To the invoice in Zoho. The org id stays a Netlify variable, so the link is made here. */
async function zohoDoor(req, url) {
  if (!sessionAllows(req, 'invoice')) return new Response('', { status: 401 });
  const number = decodeURIComponent(url.pathname.split('/').pop()).replace(/[^A-Za-z0-9-]/g, '');
  const found = await invoiceByNumber(number);
  if (!found) return new Response('No such invoice', { status: 404 });
  return Response.redirect(`https://books.zoho.com/app/${process.env.ZOHO_ORG_ID}#/invoices/${found.invoice_id}`, 302);
}

/**
 * For the PC's chat job, on the runner's key only: what a design is, as the builder's own
 * engine says, so the job's rows quote what /builder would quote.
 */
async function designInfo(req, url) {
  const denied = refuseMachine(req);
  if (denied) return denied;
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const origin = assetOrigin(req);
  try {
    const record = await readDesign(origin, code);
    const { catalog } = await loadCatalog(origin);
    return json({ ok: true, code, ...describeRecord(catalog, record), hash: record.hash || '', shape: shapeKey(record) });
  } catch {
    return json({ ok: false, error: 'not_found' }, 404);
  }
}

/**
 * The most used designs for quick add, ranked by the chat job. Each is saved in every colour
 * here, once, so a tap on any of them opens a real design: first write wins, as ever.
 */
async function publishCommon(req) {
  const denied = refuseMachine(req);
  if (denied) return denied;
  const { codes } = await req.json();
  const origin = assetOrigin(req);
  const { catalog } = await loadCatalog(origin);
  const designs = getStore('design');
  const backup = getStore('design-backup');
  const rows = [];
  for (const code of (codes || []).slice(0, 24)) {
    let record;
    try { record = await readDesign(origin, code); } catch { continue; }
    const variants = {};
    for (const finish of ['sage', 'marine', 'charcoal', 'coral']) {
      const made = recolorRecord(catalog, record, finish);
      const name = finish.charAt(0).toUpperCase() + finish.slice(1);
      variants[name] = made.code;
      if (!(await designs.get(made.code, { type: 'text' }))) {
        const full = { ...made, created_at: new Date().toISOString() };
        await designs.setJSON(made.code, full);
        await backup.setJSON(made.code, full);
      }
    }
    rows.push({ code, ...describeRecord(catalog, record), variants });
  }
  await getStore('app-cache').setJSON('common', rows);
  return json({ ok: true, rows: rows.length });
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.pathname === '/api/log') return logRoute(req, url);
  if (url.pathname.startsWith('/api/zoho-door/')) return zohoDoor(req, url);
  if (url.pathname === '/api/design-info') return designInfo(req, url);
  if (url.pathname === '/api/app-common') return publishCommon(req);
  const image = /^\/api\/design-image\/([0-9A-Z]{7})$/.exec(url.pathname);
  if (image) return designImage(req, image[1]);

  const session = sessionFrom(req);
  if (!session) return json({ ok: false, error: 'signed_out' }, 401);
  // Modules older than the hour have to be re-read before they count: the app calls /api/me and retries.
  if (!session.fresh) return json({ ok: false, error: 'stale' }, 401);
  // A form on another site cannot send JSON, and the cookie is SameSite=Lax besides.
  if (req.method !== 'GET' && !/application\/json/.test(req.headers.get('content-type') || '')) {
    return json({ ok: false, error: 'bad_type' }, 415);
  }

  let body = {};
  if (req.method !== 'GET') {
    try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  }

  const s = store(assetOrigin(req));
  const today = nairobiToday();
  try {
    const out = await handle({
      store: s,
      person: { email: session.email, name: session.name, modules: session.modules },
      today,
      method: req.method,
      path: url.pathname.slice('/api/app/'.length),
      body
    });
    if (req.method !== 'GET' && out.json && out.json.doc) {
      await s.patchIndex(rules.indexRow(out.json.doc, today)).catch(() => {});
    } else if (req.method !== 'GET' && out.json && out.json.client) {
      await s.touchIndex(out.json.client.id, { name: out.json.client.name, at: new Date().toISOString() }).catch(() => {});
    }
    return json(out.json, out.status);
  } catch (err) {
    return json({ ok: false, error: 'failed', detail: String(err.message).slice(0, 300) }, 500);
  }
};

export const config = { path: ['/api/app/*', '/api/design-image/*', '/api/design-info', '/api/app-common', '/api/zoho-door/*', '/api/log'] };

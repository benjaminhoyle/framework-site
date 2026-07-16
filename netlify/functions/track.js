// POST /api/track — the event-lake collector.
//
// Receives fire-and-forget beacons from js/site.js (funnel checkpoints + short-
// code payloads) and writes them to Netlify Blobs. NO PII is present by
// construction — the site never has name/phone; those live only in Airtable.
//
// Storage layout (chosen over a single daily NDJSON blob because Blobs has no
// atomic append — concurrent beacons would read-modify-write and lose events):
//   store "events": key `<YYYY-MM-DD>/<event>/<ts>-<uuid>`  (one blob per event)
//   store "codes" : key `<CODE>`                            (one blob per code)
// The event type is in the key path so /api/export can list `<day>/wa_handoff/`
// without reading every blob.

import { getStore } from '@netlify/blobs';

const EVENTS = new Set(['arrive', 'product_view', 'engage', 'wa_handoff']);
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/; // Crockford Base32, uppercase, no I/L/O/U
const MAX_BODY = 8 * 1024; // drop anything oversized

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default async (req, context) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await req.text();
  if (!raw || raw.length > MAX_BODY) return json({ ok: false, error: 'bad_size' }, 400);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const received_at = new Date().toISOString();
  const country = (context && context.geo && context.geo.country && context.geo.country.code) || null;

  try {
    if (body.type === 'code') {
      if (!CODE_RE.test(String(body.code || ''))) return json({ ok: false, error: 'bad_code' }, 422);
      const store = getStore('codes');
      // First write wins: a code is minted once; never clobber an existing payload.
      const existing = await store.get(body.code, { type: 'text' });
      if (existing) return json({ ok: true, deduped: true });
      await store.setJSON(body.code, {
        code: body.code,
        session_id: str(body.session_id),
        product_id: str(body.product_id),
        handoff_source: str(body.handoff_source),
        ad: cleanAd(body.ad),
        ts: num(body.ts),
        received_at
      });
      return json({ ok: true });
    }

    // Otherwise an event. Validate shape; drop unknown event names.
    const event = String(body.event || '');
    if (!EVENTS.has(event)) return json({ ok: false, error: 'unknown_event' }, 422);
    if (!body.session_id) return json({ ok: false, error: 'no_session' }, 422);

    const day = received_at.slice(0, 10);
    const id = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2);
    const key = `${day}/${event}/${Date.now()}-${id}`;

    const store = getStore('events');
    await store.setJSON(key, {
      event,
      session_id: str(body.session_id),
      ts: num(body.ts),
      ad: cleanAd(body.ad),
      device: str(body.device),
      in_app_browser: str(body.in_app_browser),
      dims: (body.dims && typeof body.dims === 'object') ? body.dims : {},
      received_at,
      country
    });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'store_error', detail: String(err && err.message) }, 500);
  }
};

function str(v) { return (v == null) ? null : String(v).slice(0, 300); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function cleanAd(ad) {
  if (!ad || typeof ad !== 'object') return {};
  const keep = ['utm_source', 'utm_campaign', 'utm_content', 'ad_id', 'fbclid'];
  const out = {};
  for (const k of keep) if (ad[k] != null) out[k] = String(ad[k]).slice(0, 300);
  return out;
}

export const config = { path: '/api/track' };

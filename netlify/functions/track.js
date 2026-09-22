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

// `catalog_impression` and `designer_open` were emitted by shelving.html for
// months and rejected here with a 422, because this allowlist was written before
// either existed and never widened. That silently zeroed the whole seen→opened
// denominator in the Catalog Manager: `seen`, `seenAboveFold`, `impressionsBySlot`
// and `designerOpens` were structurally incapable of being anything but 0.
//
// `ar_open` and `ar_placed` are /d/<CODE>'s two checkpoints and they are a pair:
// the first is somebody tapping "see it on your wall", the second is
// <model-viewer> reporting the shelf standing on a surface. Both carry
// `dims.design_code`. Apart is the interesting reading -- a large gap is AR
// failing to launch on the phones our customers actually hold, which is the one
// thing that cannot be found out from a desktop.
// `design_page_open` is the catalogue lightbox's link to /d/<CODE>: a product
// view that wanted the size and the room, which is a different intent from
// opening the builder and worth telling apart from it.
const EVENTS = new Set([
  'arrive', 'product_view', 'engage', 'wa_handoff', 'catalog_impression', 'designer_open',
  'ar_open', 'ar_placed', 'design_page_open',
]);
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/; // Crockford Base32, uppercase, no I/L/O/U
const MAX_BODY = 8 * 1024; // drop anything oversized

// Impressions arrive BATCHED — one event carrying `dims.items[]` rather than one
// event per card. The storage layout here is one blob per event, and /api/export
// fetches every blob in the range individually; at roughly ten cards seen per
// session, per-card events would have multiplied the export's blob count by ~8
// and pushed it past the function's 10s budget. The cap is a backstop: the
// client flushes well below it and MAX_BODY already bounds the payload.
const MAX_ITEMS = 60;

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
      dims: cleanDims(body.dims),
      received_at,
      country
    });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'store_error', detail: String(err && err.message) }, 500);
  }
};

// dims is otherwise passed through as the client sent it — deliberately open, so
// a new checkpoint dimension needs no server change. The one thing bounded is
// `items`, the batched-impression array, because the reader iterates it.
function cleanDims(dims) {
  if (!dims || typeof dims !== 'object') return {};
  if (!Array.isArray(dims.items)) return dims;
  return { ...dims, items: dims.items.filter((i) => i && typeof i === 'object').slice(0, MAX_ITEMS) };
}

function str(v) { return (v == null) ? null : String(v).slice(0, 300); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
// The paid-traffic identity of a session. This allowlist is the second half of
// adParams() in js/site.js: a field the client sends and this list omits is
// dropped silently, which is exactly how `utm_term` was captured into
// first-touch for months and never reached the lake. Add to both, together.
//
// `utm_term` carries Google's ValueTrack {keyword} — the keyword we BID, never
// the query the person typed; Google reveals that only in aggregate. It is the
// key the ops-side term ledger joins on.
function cleanAd(ad) {
  if (!ad || typeof ad !== 'object') return {};
  const keep = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'ad_id', 'fbclid',
    // Google click ids. gbraid/wbraid arrive INSTEAD of gclid on iOS, not with it.
    'gclid', 'gbraid', 'wbraid',
  ];
  const out = {};
  for (const k of keep) if (ad[k] != null) out[k] = String(ad[k]).slice(0, 300);
  return out;
}

export const config = { path: '/api/track' };

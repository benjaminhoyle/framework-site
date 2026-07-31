// /api/design — saved shelf designs, so a short code can be turned back into one.
//
// POST stores a design under its code and returns the link; GET resolves a code
// back to the design. The code is not minted here: it is an FNV-1a hash of the
// serialised design, computed in the browser by designCode() in
// js/builder/app.js, so the same shelf always gets the same code and two
// people who build the same thing land on one record rather than two.
//
// That also makes the write naturally idempotent, so first write wins: a repeat
// POST of an identical design must not overwrite the arrival details of whoever
// created it first. It follows track.js's shape and its no-PII rule -- the site
// has no name or phone number to leak, and none is accepted here.
//
// Storage: store "design", key `<CODE>` (one blob per design).

import { getStore } from '@netlify/blobs';

// Seven characters of uppercase base36 -- what designCode() produces.
const CODE_RE = /^[0-9A-Z]{7}$/;
// A design is a list of pieces with an origin each; 47 modules over a very large
// run is still only a few tens of KB, and anything past this is not a shelf.
const MAX_BODY = 256 * 1024;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });

export default async (req, context) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ ok: false, error: 'bad_code' }, 400);
    try {
      const stored = await getStore('design').get(code, { type: 'json' });
      if (!stored) return json({ ok: false, error: 'not_found' }, 404);
      // Only the parts that rebuild the shelf. The arrival details are for us.
      return json({
        ok: true,
        code,
        hash: stored.hash || null,
        design: stored.design || null,
        mode: stored.mode || null,
        created_at: stored.created_at || null
      });
    } catch (err) {
      return json({ ok: false, error: 'store_error', detail: String(err && err.message) }, 500);
    }
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await req.text();
  if (!raw || raw.length > MAX_BODY) return json({ ok: false, error: 'bad_size' }, 400);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const code = String(body.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return json({ ok: false, error: 'bad_code' }, 422);
  if (!body.design || typeof body.design !== 'object') return json({ ok: false, error: 'no_design' }, 422);
  if (!body.hash) return json({ ok: false, error: 'no_hash' }, 422);

  try {
    const store = getStore('design');
    const existing = await store.get(code, { type: 'text' });
    if (existing) return json({ ok: true, code, deduped: true });

    await store.setJSON(code, {
      code,
      created_at: new Date().toISOString(),
      // Both representations on purpose. The hash is what the page itself reads
      // and is immune to a catalogue rename; the serialised design is the one a
      // person can read in the store six months from now.
      hash: str(body.hash, 8192),
      design: body.design,
      mode: str(body.mode),
      finish: str(body.finish),
      pieces: num(body.pieces),
      total_ksh: num(body.total_ksh),
      // How they got here. No PII by construction -- the page has none to send.
      session_id: str(body.session_id),
      referrer: str(body.referrer, 500),
      ad: cleanAd(body.ad),
      language: str(body.language, 40),
      viewport: str(body.viewport, 40),
      country: (context && context.geo && context.geo.country && context.geo.country.code) || null
    });
    return json({ ok: true, code });
  } catch (err) {
    return json({ ok: false, error: 'store_error', detail: String(err && err.message) }, 500);
  }
};

function str(v, max = 300) { return (v == null) ? null : String(v).slice(0, max); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function cleanAd(ad) {
  if (!ad || typeof ad !== 'object') return {};
  const keep = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ad_id', 'fbclid', 'gclid'];
  const out = {};
  for (const k of keep) if (ad[k] != null) out[k] = String(ad[k]).slice(0, 300);
  return out;
}

export const config = { path: '/api/design' };

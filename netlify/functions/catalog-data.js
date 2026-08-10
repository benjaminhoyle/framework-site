// POST /api/catalog-data?key=<secret> — the ops runner publishes per-product
// performance stats here for the gated manager page. Auth reuses SITE_EXPORT_KEY.
// Tokens stay local; Netlify only stores + serves.
//
// This used to receive the whole catalogue with stats attached, and that
// snapshot became the manager's idea of what was live — a second write path for
// the catalogue, on a different schedule, from the runner's own local checkout.
// The catalogue now comes from the deployed catalog.json (see catalog.js), and
// the runner keeps the one opinion it is qualified to have: the numbers.
//
// Both shapes are accepted so an older runner keeps working; either way what is
// stored is stats keyed by product id.

import { getStore } from '@netlify/blobs';
import { refuse } from './_auth.mjs';

const MAX = 3 * 1024 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json' },
});

/** Stats keyed by id, from either the new shape or the old snapshot. */
function statsFrom(body) {
  if (body && body.stats && typeof body.stats === 'object' && !Array.isArray(body.stats)) {
    return body.stats;
  }
  const out = {};
  for (const product of (body && body.products) || []) {
    if (product && product.id && product.stats) out[product.id] = product.stats;
  }
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refuse(req);
  if (denied) return denied;
  const raw = await req.text();
  if (!raw || raw.length > MAX) return json({ ok: false, error: 'bad_size' }, 400);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const stats = statsFrom(body);
  await getStore('catalog').setJSON('stats', {
    generatedAt: (body && body.generatedAt) || new Date().toISOString(),
    stats,
  });
  // The old snapshot is no longer read by anything. Clear it so it cannot be
  // mistaken later for a record of what was live.
  await getStore('catalog').delete('published').catch(() => {});
  return json({ ok: true, products: Object.keys(stats).length });
};

export const config = { path: '/api/catalog-data' };

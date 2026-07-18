// POST /api/catalog-data?key=<secret> — the runner publishes the catalog snapshot
// (products + per-product performance stats) here for the gated manager page.
// Auth reuses SITE_EXPORT_KEY. Tokens stay local; Netlify only stores + serves.

import { getStore } from '@netlify/blobs';

const MAX = 3 * 1024 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) return new Response('unauthorized', { status: 401 });
  const raw = await req.text();
  if (!raw || raw.length > MAX) return new Response(JSON.stringify({ ok: false, error: 'bad_size' }), { status: 400 });
  try { JSON.parse(raw); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad_json' }), { status: 400 }); }
  await getStore('catalog').set('published', raw, { metadata: { updated_at: new Date().toISOString() } });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/catalog-data' };

// POST /api/catalog-draft?key=<secret> — the manager saves staged catalog changes
// (active/inactive toggles, metadata edits, newly uploaded products) as a draft.
// The draft is an overlay reviewed before Publish; the runner reads and applies it,
// then clears it. Body {clear:true} deletes the draft (used after a publish).
// Auth reuses SITE_EXPORT_KEY.

import { getStore } from '@netlify/blobs';

const MAX = 2 * 1024 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) return new Response('unauthorized', { status: 401 });

  const raw = await req.text();
  if (!raw || raw.length > MAX) return new Response(JSON.stringify({ ok: false, error: 'bad_size' }), { status: 400 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad_json' }), { status: 400 }); }

  const store = getStore('catalog');
  if (body && body.clear === true) {
    await store.delete('draft').catch(() => {});
    return new Response(JSON.stringify({ ok: true, cleared: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (!body || !Array.isArray(body.products)) return new Response(JSON.stringify({ ok: false, error: 'bad_shape' }), { status: 422 });
  await store.setJSON('draft', { products: body.products, updatedAt: new Date().toISOString() });
  return new Response(JSON.stringify({ ok: true, products: body.products.length }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/catalog-draft' };

// POST /api/dashboard-data?key=<secret> — the local runner pushes the generated
// WS3 dashboard JSON here (per-ad economics + monthly cohort funnel), and it's
// stored in a Blob for the gated dashboard page to read. Keeps the Airtable/Meta
// tokens local (the runner assembles the data); Netlify only stores + serves it.
// Auth reuses SITE_EXPORT_KEY (same trust level as the reconciler export).

import { getStore } from '@netlify/blobs';

const MAX = 4 * 1024 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) {
    return new Response('unauthorized', { status: 401 });
  }
  const raw = await req.text();
  if (!raw || raw.length > MAX) return new Response(JSON.stringify({ ok: false, error: 'bad_size' }), { status: 400 });
  try { JSON.parse(raw); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad_json' }), { status: 400 }); }

  await getStore('dashboard').set('latest', raw, { metadata: { updated_at: new Date().toISOString() } });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/dashboard-data' };

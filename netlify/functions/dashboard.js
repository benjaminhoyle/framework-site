// GET /api/dashboard?key=<secret> — serves the stored WS3 dashboard JSON to the
// gated metrics page. 401 without the key (never open on the public domain);
// 404 until the runner has pushed data at least once. Auth reuses SITE_EXPORT_KEY.

import { getStore } from '@netlify/blobs';

export default async (req) => {
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) {
    return new Response('unauthorized', { status: 401 });
  }
  const data = await getStore('dashboard').get('latest', { type: 'text' });
  if (!data) return new Response(JSON.stringify({ ok: false, error: 'no_data_yet' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(data, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/dashboard' };

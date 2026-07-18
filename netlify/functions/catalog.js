// GET /api/catalog?key=<secret> — serves the catalog snapshot (published, from the
// runner) plus any staged draft (edited in the manager). The page overlays the
// draft on the published set. 401 without the key. Auth reuses SITE_EXPORT_KEY.

import { getStore } from '@netlify/blobs';

export default async (req) => {
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) return new Response('unauthorized', { status: 401 });
  const store = getStore('catalog');
  const [published, draft] = await Promise.all([
    store.get('published', { type: 'json' }).catch(() => null),
    store.get('draft', { type: 'json' }).catch(() => null),
  ]);
  return new Response(JSON.stringify({ ok: true, published, draft }), {
    status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/catalog' };

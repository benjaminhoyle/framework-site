// GET /api/catalog?key=<secret> — everything the manager page needs:
// what is live, what is staged, and how each product is performing.
// 401 without the key. Auth reuses SITE_EXPORT_KEY.
//
// `published` is catalog.json **imported directly**, so it is bundled with the
// deploy and is therefore exactly the catalogue the live site is serving. It
// used to come from a blob that the ops runner pushed from its own local
// checkout during a stats sync — a second write path, on a different schedule,
// from a machine that might not have pulled. The manager diffs your draft
// against this, so a stale baseline meant "2 staged changes" could be measured
// against a catalogue nobody was actually running.
//
// The editorial record is used here rather than the public artifact because the
// manager has to see inactive products in order to turn them back on.
//
// See docs/catalog-architecture.md.

import { getStore } from '@netlify/blobs';
import published from '../../catalog.json' with { type: 'json' };

export default async (req) => {
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) {
    return new Response('unauthorized', { status: 401 });
  }
  const store = getStore('catalog');
  const [draft, stats] = await Promise.all([
    store.get('draft', { type: 'json' }).catch(() => null),
    store.get('stats', { type: 'json' }).catch(() => null),
  ]);
  return new Response(JSON.stringify({ ok: true, published, draft, stats }), {
    status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/catalog' };

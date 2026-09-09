// /api/marketing-data: the marketing console's one snapshot.
//
//   PUT or POST ?key=<export key>   the ops publish step sends the JSON that
//                                   framework-ops/src/marketing-state.js built
//                                   from the framework-marketing folder; it is
//                                   stored whole in a Blob under one fixed key.
//   GET          (login key)        marketing.html reads it back.
//
// Same split as the dashboard pair (dashboard-data.js writes, dashboard.js
// reads), in one file because the two halves share a store and a key. Only the
// runner may write, so writes take SITE_EXPORT_KEY only: the typed login key
// can read the console but not overwrite what the others are reading. Netlify
// holds nothing but the snapshot; the folder, the git log and the steward all
// stay on the machine that built it.
//
// 404 with a plain JSON body until the first publish, which the page turns
// into "nothing published yet".

import { getStore } from '@netlify/blobs';
import { refuse, refuseMachine } from './_auth.mjs';

const MAX = 4 * 1024 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default async (req) => {
  if (req.method === 'GET') {
    const denied = refuse(req);
    if (denied) return denied;
    const data = await getStore('marketing').get('latest', { type: 'text' });
    if (!data) return json({ ok: false, error: 'no_data_yet' }, 404);
    return new Response(data, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  if (req.method !== 'PUT' && req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refuseMachine(req);
  if (denied) return denied;
  const raw = await req.text();
  if (!raw || raw.length > MAX) return json({ ok: false, error: 'bad_size' }, 400);
  try { JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  await getStore('marketing').set('latest', raw, { metadata: { updated_at: new Date().toISOString() } });
  return json({ ok: true, bytes: raw.length });
};

export const config = { path: '/api/marketing-data' };

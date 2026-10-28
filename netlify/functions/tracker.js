// /api/tracker: Elvis's sales tracker, read by elvis.html.
//
//   PUT or POST ?key=<export key>   the ops runner sends the JSON that
//                                   framework-ops/src/tracker.js built after
//                                   each refresh; stored whole in a Blob.
//   GET  X-Tracker-Pass: <password> the page reads it back.
//
// Who may read is decided in _auth.mjs (trackerAllowed): the tracker's own
// password, or the runner's key.

import { getStore } from '@netlify/blobs';
import { refuseMachine, trackerAllowed } from './_auth.mjs';

const MAX = 256 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default async (req) => {
  if (req.method === 'GET') {
    if (!trackerAllowed(req)) return json({ ok: false, error: 'unauthorized' }, 401);
    const data = await getStore('tracker').get('latest', { type: 'text' });
    if (!data) return json({ ok: false, error: 'no_data_yet' }, 404);
    return new Response(data, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  if (req.method !== 'PUT' && req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refuseMachine(req);
  if (denied) return denied;
  const raw = await req.text();
  if (!raw || raw.length > MAX) return json({ ok: false, error: 'bad_size' }, 400);
  try { JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  await getStore('tracker').set('latest', raw, { metadata: { updated_at: new Date().toISOString() } });
  return json({ ok: true, bytes: raw.length });
};

export const config = { path: '/api/tracker' };

// GET /api/export?since=YYYY-MM-DD&until=YYYY-MM-DD&key=<secret>[&events=all]
//
// Shared-secret export for the local reconciler (framework-ops). Returns the
// `wa_handoff` events and the short-code payloads in the range; with events=all,
// every checkpoint event (for the dashboard's cohort funnel + catalog stats).
// No PII by construction. Auth is SITE_EXPORT_KEY; without it → 401.
//
// Blob fetches run through a bounded concurrency pool — sequential awaits would
// blow the function's 10s limit once real traffic accumulates (each get is an
// HTTP roundtrip; thousands of events × ~100ms would take minutes).

import { getStore } from '@netlify/blobs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const POOL = 24; // concurrent blob fetches

function dayRange(since, until) {
  const days = [];
  const start = new Date(since + 'T00:00:00Z');
  const end = new Date(until + 'T00:00:00Z');
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Map over items with at most POOL tasks in flight; preserves order, skips nulls.
async function pooled(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(POOL, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => null);
    }
  });
  await Promise.all(workers);
  return out.filter((x) => x != null);
}

export default async (req) => {
  const secret = process.env.SITE_EXPORT_KEY;
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!secret || key !== secret) return new Response('unauthorized', { status: 401 });

  const until = url.searchParams.get('until') || new Date().toISOString().slice(0, 10);
  const since = url.searchParams.get('since') || until;
  if (!DAY_RE.test(since) || !DAY_RE.test(until)) {
    return new Response(JSON.stringify({ ok: false, error: 'bad_date' }), { status: 400 });
  }

  const events = getStore('events');
  const codes = getStore('codes');
  const wantAll = url.searchParams.get('events') === 'all';
  const days = dayRange(since, until);

  // List the needed keys per day (in parallel), then fetch the blobs pooled.
  // With events=all one listing per day covers everything (handoffs are a
  // subset, split out by key path: <day>/<event>/<id>).
  const dayLists = await pooled(days, async (day) => {
    const prefix = wantAll ? `${day}/` : `${day}/wa_handoff/`;
    const { blobs } = await events.list({ prefix });
    return { day, keys: blobs.map((b) => b.key) };
  });
  const eventKeys = dayLists.flatMap((d) => d.keys);
  const fetched = await pooled(eventKeys, async (k) => {
    const rec = await events.get(k, { type: 'json' });
    return rec ? { key: k, rec } : null;
  });
  const allEvents = fetched.map((f) => f.rec);
  const handoffs = wantAll
    ? fetched.filter((f) => f.key.includes('/wa_handoff/')).map((f) => f.rec)
    : allEvents;

  // Code payloads, filtered to the range by received_at (keys are opaque codes).
  const { blobs: codeBlobs } = await codes.list();
  const codeAll = await pooled(codeBlobs.map((b) => b.key), (k) => codes.get(k, { type: 'json' }));
  const codePayloads = codeAll.filter((rec) => {
    const d = (rec.received_at || '').slice(0, 10);
    return d >= since && d <= until;
  });

  const payload = { ok: true, since, until, handoffs, codes: codePayloads };
  if (wantAll) payload.events = allEvents;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

export const config = { path: '/api/export' };

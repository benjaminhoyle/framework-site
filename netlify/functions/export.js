// GET /api/export?since=YYYY-MM-DD&until=YYYY-MM-DD&key=<secret>
//
// Shared-secret export for the local reconciler (mbs-scraper). Returns the
// `wa_handoff` events and the short-code payloads in the date range — the two
// things reconciliation needs to join ad -> site -> WhatsApp. No PII by
// construction. Auth is a shared secret in SITE_EXPORT_KEY (Netlify env var);
// requests without the exact key get 401.

import { getStore } from '@netlify/blobs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayRange(since, until) {
  const days = [];
  const start = new Date(since + 'T00:00:00Z');
  const end = new Date(until + 'T00:00:00Z');
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
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
  const wantAll = url.searchParams.get('events') === 'all'; // for the WS3 dashboard aggregation

  // wa_handoff events, day by day (event type is in the key path). With
  // events=all, also collect every checkpoint event (arrive/product_view/engage)
  // so the dashboard can build the C1–C4 cohort funnel.
  const handoffs = [];
  const allEvents = [];
  for (const day of dayRange(since, until)) {
    const { blobs } = await events.list({ prefix: `${day}/wa_handoff/` });
    for (const b of blobs) {
      const rec = await events.get(b.key, { type: 'json' });
      if (rec) handoffs.push(rec);
    }
    if (wantAll) {
      const { blobs: dayBlobs } = await events.list({ prefix: `${day}/` });
      for (const b of dayBlobs) {
        const rec = await events.get(b.key, { type: 'json' });
        if (rec) allEvents.push(rec);
      }
    }
  }

  // Code payloads, filtered to the range by received_at (keys are opaque codes).
  const codePayloads = [];
  const { blobs: codeBlobs } = await codes.list();
  for (const b of codeBlobs) {
    const rec = await codes.get(b.key, { type: 'json' });
    if (!rec) continue;
    const d = (rec.received_at || '').slice(0, 10);
    if (d >= since && d <= until) codePayloads.push(rec);
  }

  const payload = { ok: true, since, until, handoffs, codes: codePayloads };
  if (wantAll) payload.events = allEvents;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

export const config = { path: '/api/export' };

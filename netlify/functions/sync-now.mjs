// POST /api/sync-now — run a reconcile pass, on demand, from the staff menu.
//
// The schedule is hourly and deliberately cheap; this is the other half of that
// trade. Somebody who has just created an order in Airtable and wants its
// invoiced prices now should not have to wait up to an hour, or ask a person
// with a terminal, or have the schedule poll every five minutes all week on the
// chance that today is the day.
//
// **It holds the machine key so the browser does not have to.** Triggering the
// background function needs `SITE_EXPORT_KEY`, which opens every machine
// endpoint including the event export. Putting that in a page would hand it to
// anyone who opened dev tools. So this endpoint is opened by `ZOHO_PUSH_KEY` —
// the password reps already type into the builder — and reaches for the machine
// key server-side, where it stays.
//
// It never widens what a pass may do. Write mode still requires
// `SYNC_ALLOW_WRITES=1` in the environment, checked by the background function
// exactly as it is for the schedule; this endpoint cannot ask for more than the
// clock already gets.

import { refusePush } from './_auth.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refusePush(req);
  if (denied) return denied;

  const site = process.env.URL;
  const key = process.env.SITE_EXPORT_KEY;
  if (!site || !key) return json({ ok: false, error: 'not_configured' }, 500);

  let body = {};
  try { body = await req.json(); } catch { /* an empty body means an incremental pass */ }

  // A full pass costs ~350 Zoho calls against 2,000 a day, so it is asked for
  // explicitly rather than being what a button does by default. Incremental is
  // ~2 calls and is what "I just made an order, catch up" actually needs.
  const full = body.mode === 'full';
  const params = new URLSearchParams({
    key,
    mode: full ? 'full' : 'incremental',
    trigger: 'Manual',
    // Deliberately always requested. The background function ignores it unless
    // SYNC_ALLOW_WRITES is set, so this cannot turn on writing — it only stops
    // the button being a no-op on a site where writing is already allowed.
    write: '1',
    // Wide enough that an order made this morning is caught by an afternoon
    // press, without reaching for the cost of a full pass.
    ...(full ? {} : { since: nairobi(new Date(Date.now() - 12 * 3600 * 1000)) })
  });

  // A background function answers 202 and keeps going; there is nothing to wait
  // for and nothing useful in its body. The run row is where the outcome lands,
  // so that is what the caller is told to go and read.
  const res = await fetch(`${site}/.netlify/functions/sync-orders-background?${params}`);
  return json({
    ok: res.status === 202 || res.ok,
    status: res.status,
    mode: full ? 'full' : 'incremental',
    note: 'Started. A pass takes about a minute; the outcome lands in Sync - Runs.'
  });
};

/** Zoho wants its timestamps in the org's own zone. Same shape as the one in
 *  sync-orders-background.mjs, which is where this string ends up. */
function nairobi(date) {
  const t = new Date(date.getTime() + 3 * 3600 * 1000).toISOString();
  return `${t.slice(0, 19)}+0300`;
}

export const config = { path: '/api/sync-now' };

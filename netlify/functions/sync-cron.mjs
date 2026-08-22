// The clock. Every five minutes, ask the reconciler to catch up.
//
// It does no work itself — it triggers `sync-orders-background`. Scheduled
// functions are synchronous and capped at 30s; a full pass takes about a minute
// against live data, so the pass has to live in a background function and the
// schedule has to be the thing that pokes it.
//
// **Inert until SYNC_SCHEDULE_ENABLED=1.** It deploys in the off position on
// purpose: a scheduled function starts firing the moment it ships, and this one
// should not begin spending the Zoho budget until a write pass has been run by
// hand and checked. Turning it on is a variable, not a deploy.
//
// Cost, against Zoho's 2,000 calls per organization per DAY:
//
//   288 incremental passes  ~2 calls each when nothing changed   ~600
//   1 full pass                                                  ~350
//                                                          total ~950
//
// which leaves room for the pushes and for a day with a lot of invoice edits.
// A 1-minute schedule would not fit, and neither would two full passes a day.

const FULL_AT_UTC_HOUR = 22; // 01:00 in Nairobi — after the workshop has stopped.

export default async () => {
  if (process.env.SYNC_SCHEDULE_ENABLED !== '1') return;

  const site = process.env.URL;
  const key = process.env.SITE_EXPORT_KEY;
  if (!site || !key) {
    console.error('[sync-cron] URL or SITE_EXPORT_KEY missing; not triggering');
    return;
  }

  // One schedule, two jobs. The full pass is the only thing that can notice a
  // deleted invoice, so it has to happen — but only once, and not during the day.
  const d = new Date();
  const full = d.getUTCHours() === FULL_AT_UTC_HOUR && d.getUTCMinutes() < 5;
  const params = new URLSearchParams({
    key,
    mode: full ? 'full' : 'incremental',
    trigger: full ? 'Nightly full' : 'Schedule',
    ...(process.env.SYNC_ALLOW_WRITES === '1' ? { write: '1' } : {})
  });

  // Fire and forget: a background function answers 202 immediately and the run
  // row is where the outcome actually lands.
  const res = await fetch(`${site}/.netlify/functions/sync-orders-background?${params}`);
  console.log(`[sync-cron] ${full ? 'full' : 'incremental'} -> ${res.status}`);
};

export const config = { schedule: '*/5 * * * *' };

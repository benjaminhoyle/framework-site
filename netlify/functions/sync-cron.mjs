// The clock. Once an hour, ask the reconciler to catch up.
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
//   24 incremental passes  ~2 calls each when nothing changed     ~50
//   1 full pass                                                  ~350
//                                                          total ~400
//
// Hourly rather than every five minutes. At */5 this cost ~950 a day to notice
// things sooner than anybody acts on them: an order's invoiced prices are
// backfilled onto a record a person made by hand, and nothing downstream is
// waiting on the difference between a two-minute and a fifty-minute lag. What
// the budget IS needed for is raising invoices and re-running a full pass when
// something looks wrong -- and on the day the schedule went live, four full
// passes plus */5 polling exhausted the whole 2,000 and left every pass failing.
//
// When somebody does need it now, `/api/sync-now` triggers a pass from the
// builder's staff menu. That is the right shape: cheap by default, immediate on
// demand, rather than expensive always in case somebody is watching.

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
  // The schedule fires on the hour, so the minute window only has to be wide
  // enough to survive a late trigger.
  const full = d.getUTCHours() === FULL_AT_UTC_HOUR && d.getUTCMinutes() < 30;
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

export const config = { schedule: '0 * * * *' };

// The reconciler's entry point. Zoho -> Airtable, one direction, one writer.
//
// A **background** function on purpose: a full pass reads every invoice, and each
// one needs a detail call the list response cannot substitute for. That runs well
// past the 10s a synchronous function gets. Background functions return 202
// immediately and may run for minutes, which is the right shape here — nobody is
// waiting on the response. The answer lands in `Sync - Runs` and `Sync - Log`.
//
//   ?mode=incremental   (default) only invoices touched since `since`, or the
//                       last 2 hours. Cheap; usually finds nothing.
//   ?mode=full          every invoice. Slower, and the ONLY thing that can
//                       notice a deleted invoice, because a deleted record has no
//                       modification time for an incremental pass to see.
//   ?since=<iso>        override the incremental window.
//   ?write=1            apply the fields the sync owns. Requires
//                       SYNC_ALLOW_WRITES=1 in the environment as well, so a
//                       stray query parameter can never start writing.
//
// Gated with the machine key: this reads the whole order book, so the typed
// login key is not enough.

import { refuseMachine } from './_auth.mjs';
import { reconcile, record } from './_sync.mjs';

/** Zoho wants 2026-08-21T09:05:00+0300, not a bare Z timestamp. */
function nairobi(date) {
  const t = new Date(date.getTime() + 3 * 3600 * 1000).toISOString();
  return `${t.slice(0, 19)}+0300`;
}

export default async (req) => {
  const denied = refuseMachine(req);
  if (denied) return denied;

  const q = new URL(req.url).searchParams;
  const full = q.get('mode') === 'full';
  const wantWrite = q.get('write') === '1';
  const allowed = process.env.SYNC_ALLOW_WRITES === '1';

  const opts = {
    mode: wantWrite && allowed ? 'write' : 'read-only',
    // An explicit trigger wins, so a full pass run by hand is not filed as the
    // nightly one — otherwise the runs table cannot tell you who started it.
    trigger: q.get('trigger') || (full ? 'Nightly full' : 'Schedule'),
    since: full ? null : (q.get('since') || nairobi(new Date(Date.now() - 2 * 3600 * 1000)))
  };

  try {
    const report = await reconcile(opts);
    const written = await record(report);
    console.log('[sync-orders]', JSON.stringify({
      ...opts,
      scanned: report.scanned,
      errors: report.errors,
      warnings: report.warnings,
      orderWrites: report.orderWrites,
      lineWrites: report.lineWrites,
      logged: written
    }));
    // A background function's return value goes nowhere — the caller already
    // has its 202. The run row and the console line above are the record of
    // what happened, which is why a pass that finds nothing still writes one.
  } catch (err) {
    // A pass that dies must still say so somewhere a person looks, otherwise a
    // broken sync is indistinguishable from a quiet one.
    console.error('[sync-orders] failed', err);
    try {
      await record({
        started: new Date().toISOString(), finished: new Date().toISOString(),
        mode: opts.mode, trigger: opts.trigger, scanned: 0,
        orderWrites: 0, lineWrites: 0, errors: 1, warnings: 0,
        findings: [{
          severity: 'Error', check: 'run-failure',
          event: `pass failed: ${String(err.message).slice(0, 80)}`,
          detail: String(err.stack || err).slice(0, 1000)
        }]
      });
    } catch { /* the log itself is unreachable; the console line is all that is left */ }
  }
};

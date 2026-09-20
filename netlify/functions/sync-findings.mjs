// GET /api/sync-findings?key=… — what the Zoho/Airtable reconciler is currently
// complaining about, small enough to put one line of it on the metrics page.
//
// The reconciler already writes every finding to `Sync - Log` and already has
// the check that matters: `invoice-claimed-once` is the duplicate defence. On
// 2026-09-20 three invoices were reissued in Zoho, the sync built a second
// order for each, and all three delivered orders went back into the production
// queue. The check fired. Nobody saw it, because nothing outside Airtable ever
// read that table: not metrics.html, not marketing.html, not framework-ops.
//
// So this is deliberately a summary, not a feed. Counts per check, worst
// severity, and the newest example line per check. Anyone who wants the rows
// opens the table; the page only has to say "something is open" loudly enough
// to be noticed. Read-only. `Detail` can name a customer, which is why this
// sits behind `refuse()`, the same gate as /api/dashboard, and why the sample
// is truncated rather than passed through whole.

import { refuse } from './_auth.mjs';
import { TABLES, all } from './_airtable.mjs';

// Worst first. The reconciler writes Error, Warning or Info.
const RANK = { Error: 0, Warning: 1, Info: 2 };
const rank = (s) => (s in RANK ? RANK[s] : RANK.Info);

export default async (req) => {
  const denied = refuse(req);
  if (denied) return denied;

  let rows;
  try {
    rows = await all(TABLES.syncLog);
  } catch (err) {
    // The page treats a failure here as "no line to draw" rather than an error
    // banner: a broken summary must not bury the dashboard it sits on.
    return new Response(JSON.stringify({ ok: false, error: String(err.message).slice(0, 200) }), {
      status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const checks = new Map();
  let openTotal = 0;
  let lastChecked = '';

  for (const row of rows) {
    const f = row.fields || {};
    const seen = String(f['Last Seen'] || '');
    if (seen > lastChecked) lastChecked = seen;
    if (f.Status !== 'Open') continue;

    openTotal++;
    const name = f.Check || 'unnamed';
    const cur = checks.get(name) || { check: name, severity: 'Info', count: 0, latest: '', sample: '' };
    cur.count++;
    if (rank(f.Severity) < rank(cur.severity)) cur.severity = f.Severity;
    if (seen >= cur.latest) {
      cur.latest = seen;
      cur.sample = String(f.Detail || '').slice(0, 160);
    }
    checks.set(name, cur);
  }

  const list = [...checks.values()].sort((a, b) => rank(a.severity) - rank(b.severity) || b.count - a.count);

  return new Response(JSON.stringify({
    ok: true,
    openTotal,
    worst: list.length ? list[0].severity : null,
    lastChecked,
    checks: list.slice(0, 8)
  }), {
    status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
};

export const config = { path: '/api/sync-findings' };

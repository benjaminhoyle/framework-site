// GET /api/sync-health?key=… — can the reconciler reach what it needs?
//
// The reconciler is a background function, so its only channel is the Airtable
// log it writes. When Airtable itself is the thing that is broken, it fails
// completely silently: no run row, no findings, nothing to read. That happened
// on the first deploy and there was no way to tell a missing token from a bad
// Zoho credential without Netlify's own logs.
//
// So this endpoint is deliberately the opposite shape: synchronous, read-only,
// and it answers in the HTTP response. It never writes anything.
//
// Values are never echoed back — only whether a variable is present, and whether
// the credential it holds actually works. A key that is set but wrong looks
// exactly like one that is right until you use it, which is why each check makes
// a real call rather than testing for presence alone.

import { refuseMachine } from './_auth.mjs';
import { accessToken, invoices } from './_zoho.mjs';
import { TABLES, all } from './_airtable.mjs';

const REQUIRED = [
  'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN',
  'ZOHO_ORG_ID', 'ZOHO_ACCOUNTS_HOST', 'ZOHO_API_HOST',
  'AIRTABLE_TOKEN',
  // Not needed by the reconciler, but this is the page anyone checks when
  // something is not working, and "the rep password does nothing" is exactly
  // the sort of thing that turns out to be an unset variable.
  'ZOHO_PUSH_KEY'
];

const shape = (v) => (v ? `set (${v.length} chars)` : 'MISSING');

export default async (req) => {
  const denied = refuseMachine(req);
  if (denied) return denied;

  const env = Object.fromEntries(REQUIRED.map((k) => [k, shape(process.env[k])]));
  const checks = {};
  let ok = true;

  const run = async (name, fn) => {
    const t0 = Date.now();
    try {
      checks[name] = { ok: true, ...(await fn()), ms: Date.now() - t0 };
    } catch (err) {
      ok = false;
      checks[name] = { ok: false, error: String(err.message).slice(0, 300), ms: Date.now() - t0 };
    }
  };

  await run('zoho_auth', async () => {
    const t = await accessToken();
    return { note: `token acquired (${t.length} chars)` };
  });

  // Only worth trying if auth worked; a second failure here would just restate
  // the first one and cost 20 seconds.
  if (checks.zoho_auth.ok) {
    await run('zoho_read', async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19) + '+0300';
      return { note: `${(await invoices({ since })).length} invoices modified in the last 24h` };
    });
  }

  await run('airtable_read', async () => {
    const rows = await all(TABLES.orders);
    return { note: `${rows.length} orders readable` };
  });

  await run('airtable_log_tables', async () => {
    const runs = await all(TABLES.syncRuns);
    const log = await all(TABLES.syncLog);
    return { note: `Sync - Runs ${runs.length} rows, Sync - Log ${log.length} rows` };
  });

  return new Response(JSON.stringify({
    ok,
    env,
    checks,
    writes_enabled: process.env.SYNC_ALLOW_WRITES === '1',
    schedule_enabled: process.env.SYNC_SCHEDULE_ENABLED === '1',
    push_configured: Boolean(process.env.ZOHO_PUSH_KEY)
  }, null, 2), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
};

export const config = { path: '/api/sync-health' };

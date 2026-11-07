// The one log. What happened goes here, whoever did it: the order sync's passes, and each change
// made in the staff app. Airtable keeps only what a person has to act on (Sync - Log), because a
// base holds 50,000 rows and a log would eat them: Sync - Runs alone adds about 8,700 a year.
//
// One blob per event, so two writers can't overwrite each other, under `<day>/<source>/<time>-<random>`,
// so a day or a source can be listed without reading the rest. The PC copies each finished day to
// data/logs/, which backup.command takes to Dropbox, and blobs older than 90 days are dropped after that.
//
// A failure here never costs anyone their save or a sync pass: this records what happened, it
// isn't what happened.

const STORE = 'log';

export function logKey(source, at, random = Math.random().toString(36).slice(2, 8)) {
  return `${at.slice(0, 10)}/${source}/${at}-${random}`;
}

export async function writeLog(getStore, source, event, { now = () => new Date() } = {}) {
  const at = now().toISOString();
  try {
    await getStore(STORE).setJSON(logKey(source, at), { at, source, ...event });
    return true;
  } catch {
    return false;
  }
}

/** Every event of a day, oldest first, optionally of one source. */
export async function readDay(getStore, day, source = null) {
  const store = getStore(STORE);
  const { blobs } = await store.list({ prefix: source ? `${day}/${source}/` : `${day}/` });
  const rows = await Promise.all((blobs || []).map((b) => store.get(b.key, { type: 'json' }).catch(() => null)));
  return rows.filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The newest events of a source, looking back day by day. What "is the sync running?" needs. */
export async function latest(getStore, source, limit = 60, { now = () => new Date(), days = 30 } = {}) {
  const out = [];
  for (let i = 0; i < days && out.length < limit; i += 1) {
    const day = new Date(now().getTime() - i * 864e5).toISOString().slice(0, 10);
    out.push(...(await readDay(getStore, day, source)).reverse());
  }
  return out.slice(0, limit);
}

/** Drops whole days before `day`. Only ever called after the PC has copied them. */
export async function dropBefore(getStore, day) {
  const store = getStore(STORE);
  const { blobs, directories } = await store.list({ directories: true });
  const days = (directories || []).map((d) => d.replace(/\/$/, '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < day);
  let dropped = 0;
  for (const d of days) {
    const { blobs: rows } = await store.list({ prefix: `${d}/` });
    for (const b of rows || []) { await store.delete(b.key); dropped += 1; }
  }
  return { dropped, days: days.length, stray: (blobs || []).length };
}

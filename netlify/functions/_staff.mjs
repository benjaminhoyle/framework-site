// Who the staff are. The Staff table in Airtable is the record; the admin page
// edits it.
//
// A copy is kept in Blobs purely so that staff can still sign in during an Airtable
// outage. Delete the blob and nothing is lost: it is rebuilt on the next read.
//
// STAFF_OWNER_EMAIL always has every module, whatever the table says, so a mistake
// on the admin page cannot lock the owner out of the admin page.

import { MODULES } from './_session.mjs';

const CACHE_MS = 60 * 1000;
export const STAFF_TABLE = 'Staff';

let memo = { at: 0, list: null };

const tidy = (email) => String(email || '').trim().toLowerCase();

export function fromRow(row) {
  const f = row.fields || {};
  return {
    id: row.id,
    email: tidy(f.Email),
    name: String(f.Name || '').trim(),
    modules: Array.isArray(f.Modules) ? f.Modules : [],
    active: f.Active === true
  };
}

/** The rule on one list, free of I/O, so it can be tested. */
export function resolve(list, email, { owner = process.env.STAFF_OWNER_EMAIL } = {}) {
  const want = tidy(email);
  if (!want) return null;
  const row = (list || []).find((s) => s.email === want);
  if (owner && tidy(owner) === want) {
    return {
      id: row ? row.id : null, email: want,
      name: (row && row.name) || 'Owner',
      modules: Object.keys(MODULES), active: true, owner: true
    };
  }
  return row && row.active ? row : null;
}

export async function loadStaff({ all, getStore, now = Date.now() } = {}) {
  if (memo.list && now - memo.at < CACHE_MS) return memo.list;
  const store = (() => { try { return getStore && getStore('app-cache'); } catch { return null; } })();
  try {
    const rows = await all(STAFF_TABLE);
    const list = rows.map(fromRow);
    memo = { at: now, list };
    if (store) store.setJSON('staff', list).catch(() => {});
    return list;
  } catch (err) {
    if (store) {
      const kept = await store.get('staff', { type: 'json' }).catch(() => null);
      if (kept) return kept;
    }
    if (memo.list) return memo.list;
    throw err;
  }
}

export const forgetStaff = () => { memo = { at: 0, list: null }; };

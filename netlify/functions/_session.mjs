// Staff sessions: who is signed in, and what they may open.
//
// A person signs in with Google once (auth-google.mjs); from then on a signed
// cookie says who they are. The cookie is HttpOnly, so no script on the site can
// read it, and it lasts six months, so they stay signed in on their own phone.
//
// It carries the person's modules so that an ordinary request needs no database
// call: checking the signature costs microseconds and Airtable costs a quarter of
// a second. The trade is that the modules can go stale, so they are only trusted
// for FRESH_MS after they were last read from the Staff table. /api/me re-reads
// them and re-issues the cookie, and the app calls it whenever a request comes
// back `stale`. Taking someone off the Staff table therefore shuts them out within
// the hour at the very worst, even if they never open the app again.
//
// SESSION_SECRET is a Netlify variable, never in the repo. With it unset no
// session is ever valid, so the site falls back to the shared keys in _auth.mjs
// exactly as it did before this file existed.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'fw_session';
// Readable by scripts on purpose. It holds nothing but "1": it lets a public page
// such as /builder decide whether to load the staff bar without a network call,
// so the public never pays for staff features. It grants nothing.
export const HINT_COOKIE = 'fw_staff';

const DAY = 864e5;
export const LIFE_MS = 180 * DAY;
export const FRESH_MS = 60 * 60 * 1000;

/** Every module a person can be given. The admin page lists these. */
export const MODULES = {
  clients: 'Clients',
  invoice: 'Raise invoices',
  deliveries: 'Deliveries',
  driver: 'Driver run',
  workshop: 'Workshop',
  tracker: 'Sales tracker',
  monitor: 'Monitor',
  marketing: 'Marketing',
  catalog: 'Catalogue',
  studio: 'Studios',
  queue: 'Queue',
  admin: 'Admin'
};

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

export function issue({ email, name, modules }, { secret = process.env.SESSION_SECRET, now = Date.now(), exp } = {}) {
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const body = b64(JSON.stringify({
    e: email, n: name || '', m: modules || [], c: now, x: exp || now + LIFE_MS
  }));
  return `v1.${body}.${sign(body, secret)}`;
}

/** The session in a token, or null. `fresh` says whether its modules may be trusted. */
export function read(token, { secret = process.env.SESSION_SECRET, now = Date.now() } = {}) {
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const want = Buffer.from(sign(parts[1], secret));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return null; }
  if (!p || !p.e || !p.x || now >= p.x) return null;
  return {
    email: p.e, name: p.n, modules: p.m || [], checkedAt: p.c, expires: p.x,
    fresh: now - (p.c || 0) < FRESH_MS
  };
}

function cookieValue(req, name) {
  const raw = (req.headers.get && req.headers.get('cookie')) || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionFrom(req, opts) {
  return read(cookieValue(req, COOKIE), opts);
}

/** True when this request's session may use `module`. What a person can open is what they were given. */
export function sessionAllows(req, module, opts) {
  const s = sessionFrom(req, opts);
  return !!(s && s.fresh && (!module || s.modules.includes(module)));
}

/**
 * Set-Cookie headers for a session. Secure except on a local dev server, which is
 * plain http. No Domain is set, so a cookie made on www.framework.co.ke stays there,
 * and a branch deploy cannot read a production session.
 */
export function cookies(token, { maxAgeMs = LIFE_MS, secure = true } = {}) {
  const age = Math.floor(maxAgeMs / 1000);
  const tail = `Path=/; Max-Age=${age}; SameSite=Lax${secure ? '; Secure' : ''}`;
  return [
    `${COOKIE}=${token}; HttpOnly; ${tail}`,
    `${HINT_COOKIE}=${token ? '1' : ''}; ${tail}`
  ];
}

export const clearCookies = (opts) => cookies('', { ...opts, maxAgeMs: 0 });

export const isSecure = (req) => {
  try { return new URL(req.url).protocol === 'https:'; } catch { return true; }
};

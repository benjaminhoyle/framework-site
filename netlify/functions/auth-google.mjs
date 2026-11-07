// POST /api/auth/google  { credential }   Sign in with Google, then our own session.
// POST /api/auth/logout
// GET  /api/me                            Who is signed in, re-read from the Staff table.
//
// Google's button hands the browser an ID token, a JWT Google signed saying "this
// is that person's address". We check it here against Google's published keys and
// then forget it: the session is our own cookie (_session.mjs), so being signed in
// does not depend on Google being reachable, and nobody's Google access is ever held
// by this site. No password exists, so there is none to lose or share.
//
// Being a real Google account is not enough: the address has to be on the Staff
// table (_staff.mjs). Anyone else is told so and gets no session.

import { createPublicKey, createVerify } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { all } from './_airtable.mjs';
import { loadStaff, resolve } from './_staff.mjs';
import { issue, sessionFrom, cookies, clearCookies, isSecure } from './_session.mjs';

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

let keys = { at: 0, ttl: 0, jwks: null };

async function googleKeys(now = Date.now(), { fresh = false } = {}) {
  if (!fresh && keys.jwks && now - keys.at < keys.ttl) return keys.jwks;
  const res = await fetch(CERTS);
  if (!res.ok) throw new Error(`Google certs ${res.status}`);
  const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  const body = await res.json();
  keys = { at: now, ttl: age ? Number(age[1]) * 1000 : 3600e3, jwks: body.keys || [] };
  return keys.jwks;
}

const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());

/**
 * The checks Google's own guide lists: signed by Google, for this app, from
 * Google, not expired, and an address Google has verified. Exported for the tests,
 * with `jwks` passed in so they need no network.
 */
export function verifyIdToken(token, { jwks, audience, now = Date.now() }) {
  const pieces = String(token || '').split('.');
  if (pieces.length !== 3) return { ok: false, why: 'malformed' };
  let head, claims;
  try { head = part(pieces[0]); claims = part(pieces[1]); } catch { return { ok: false, why: 'malformed' }; }
  if (head.alg !== 'RS256') return { ok: false, why: 'alg' };
  const jwk = (jwks || []).find((k) => k.kid === head.kid);
  if (!jwk) return { ok: false, why: 'unknown_key' };
  const verify = createVerify('RSA-SHA256');
  verify.update(`${pieces[0]}.${pieces[1]}`);
  const good = verify.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(pieces[2], 'base64url'));
  if (!good) return { ok: false, why: 'signature' };
  if (!audience || claims.aud !== audience) return { ok: false, why: 'audience' };
  if (!ISSUERS.has(claims.iss)) return { ok: false, why: 'issuer' };
  if (!claims.exp || now >= claims.exp * 1000) return { ok: false, why: 'expired' };
  if (claims.email_verified !== true || !claims.email) return { ok: false, why: 'unverified' };
  return { ok: true, email: String(claims.email).toLowerCase(), name: claims.name || '' };
}

const json = (obj, status = 200, setCookies = []) => {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(obj), { status, headers });
};

const staffList = () => loadStaff({ all, getStore });

const publicPerson = (p) => ({ email: p.email, name: p.name, modules: p.modules, owner: !!p.owner });

export default async (req) => {
  const { pathname } = new URL(req.url);
  const secure = isSecure(req);

  if (pathname === '/api/me') {
    if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    const session = sessionFrom(req);
    if (!session) return json({ ok: false, error: 'signed_out' }, 401);
    const person = resolve(await staffList(), session.email);
    if (!person) return json({ ok: false, error: 'not_staff' }, 403, clearCookies({ secure }));
    // Every visit to the app moves the six months along, so someone who uses it is
    // never asked to sign in again.
    const token = issue({ ...person, name: person.name || session.name });
    return json({ ok: true, ...publicPerson(person) }, 200, cookies(token, { secure }));
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  // A form on another site cannot send this content type, and SameSite=Lax keeps the
  // cookie off its POSTs anyway: two independent fences.
  if (!/application\/json/.test(req.headers.get('content-type') || '')) return json({ ok: false, error: 'bad_type' }, 415);

  if (pathname === '/api/auth/logout') return json({ ok: true }, 200, clearCookies({ secure }));

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience || !process.env.SESSION_SECRET) return json({ ok: false, error: 'not_configured' }, 503);

  let checked = verifyIdToken(body.credential, { jwks: await googleKeys(), audience });
  // Google rotates its keys, so a key we have not seen is worth one fresh look before refusing.
  if (checked.why === 'unknown_key') checked = verifyIdToken(body.credential, { jwks: await googleKeys(Date.now(), { fresh: true }), audience });
  if (!checked.ok) return json({ ok: false, error: 'bad_token' }, 401);

  const person = resolve(await staffList(), checked.email);
  // Says whose address it was, so someone signed into the wrong Google account can
  // tell. Their own address is the only thing it reveals.
  if (!person) return json({ ok: false, error: 'not_staff', email: checked.email }, 403);

  const token = issue({ ...person, name: person.name || checked.name });
  return json({ ok: true, ...publicPerson(person) }, 200, cookies(token, { secure }));
};

export const config = { path: ['/api/auth/google', '/api/auth/logout', '/api/me'] };

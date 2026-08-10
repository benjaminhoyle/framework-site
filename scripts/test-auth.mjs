// Guards netlify/functions/_auth.mjs: which key opens which door.
//
// The site holds two shared secrets — SITE_LOGIN_KEY, which people type into
// the gate, and SITE_EXPORT_KEY, which the ops runner sends — and the whole
// point of the split is the one case that is easy to undo by accident: the
// typed password must NOT open the machine-only endpoints (/api/export,
// /api/dashboard-data, /api/catalog-data). An `authorised` that forgets
// `machineOnly` still passes every other check here, so that case is asserted
// from both directions.

import assert from 'node:assert';
import { authorised, refuse, refuseMachine } from '../netlify/functions/_auth.mjs';

const MACHINE = 'machine-key-long-and-random';
const LOGIN = 'typed-password';

/** A stand-in Request carrying `key` in the header, or in `?key=` instead. */
function req(key, { via = 'header' } = {}) {
  const url = via === 'query'
    ? `https://framework.co.ke/api/x?key=${encodeURIComponent(key)}`
    : 'https://framework.co.ke/api/x';
  return {
    url,
    headers: { get: (h) => (via === 'header' && h === 'x-framework-key' ? key : null) },
  };
}

const page = (r) => authorised(r);
const machine = (r) => authorised(r, { machineOnly: true });

// --- both secrets configured (the deployed state) -------------------------
process.env.SITE_EXPORT_KEY = MACHINE;
process.env.SITE_LOGIN_KEY = LOGIN;

assert(page(req(MACHINE)), 'runner key opens a page endpoint');
assert(machine(req(MACHINE)), 'runner key opens a machine endpoint');
assert(page(req(LOGIN)), 'typed password opens a page endpoint');
assert(!machine(req(LOGIN)), 'typed password must NOT open a machine endpoint');

assert(!page(req('wrong')), 'a wrong key opens nothing');
assert(!page(req('')), 'an empty key opens nothing');
assert(!machine(req('')), 'an empty key opens no machine endpoint');

// Both transports, because the runner sends ?key= and bookmarks still carry it.
assert(machine(req(MACHINE, { via: 'query' })), 'runner key works in the query string');
assert(page(req(LOGIN, { via: 'query' })), 'typed password works in the query string');
assert(!machine(req(LOGIN, { via: 'query' })), 'query string is no way around machineOnly');

// The wrappers must agree with the predicate, and say nothing about which key
// was wrong: same status, same body, either way.
assert.strictEqual(refuse(req(LOGIN)), null, 'refuse admits the typed password');
assert.strictEqual(refuseMachine(req(MACHINE)), null, 'refuseMachine admits the runner');
const deniedLogin = refuseMachine(req(LOGIN));
const deniedJunk = refuseMachine(req('wrong'));
assert(deniedLogin && deniedJunk, 'refuseMachine turns both away');
assert.strictEqual(deniedLogin.status, 401, 'refusal is a 401');
assert.strictEqual(deniedLogin.status, deniedJunk.status, 'refusal does not distinguish a real key from junk');

// --- login key unset: the pre-split fallback ------------------------------
delete process.env.SITE_LOGIN_KEY;
assert(page(req(MACHINE)), 'without a login key the runner key still opens pages');
assert(machine(req(MACHINE)), 'without a login key the runner key still opens machine endpoints');
assert(!page(req(LOGIN)), 'the old password stops working once it is no longer configured');

// --- neither configured: a deploy that lost its variables -----------------
delete process.env.SITE_EXPORT_KEY;
assert(!page(req(MACHINE)) && !page(req(LOGIN)) && !page(req('')),
  'with no secret set, nothing is authorised — an unset secret must not match an empty key');

console.log('auth tests passed (two keys, machine-only endpoints, both transports, unset fallbacks)');

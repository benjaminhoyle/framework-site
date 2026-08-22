// Guards netlify/functions/_auth.mjs: which key opens which door.
//
// The site holds three shared secrets — SITE_LOGIN_KEY, which people type into
// the gate; SITE_EXPORT_KEY, which the ops runner sends; and ZOHO_PUSH_KEY,
// which reps type to raise a draft invoice — and the whole
// point of the split is the one case that is easy to undo by accident: the
// typed password must NOT open the machine-only endpoints (/api/export,
// /api/dashboard-data, /api/catalog-data). An `authorised` that forgets
// `machineOnly` still passes every other check here, so that case is asserted
// from both directions.

import assert from 'node:assert';
import { authorised, refuse, refuseMachine, refusePush } from '../netlify/functions/_auth.mjs';

const MACHINE = 'machine-key-long-and-random';
const LOGIN = 'typed-password';
const PUSH = 'rep-password';

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

// --- the push key: the one that reaches the books -------------------------
// SITE_LOGIN_KEY must NOT open this. That key is short and guessable by design
// because it only opens what a person needs to SEE; raising an invoice is doing.
process.env.ZOHO_PUSH_KEY = PUSH;
assert.strictEqual(refusePush(req(PUSH)), null, 'the rep password raises invoices');
assert.strictEqual(refusePush(req(MACHINE)), null, 'the runner key opens everything, as ever');
assert(refusePush(req(LOGIN)), 'THE TYPED PAGE PASSWORD MUST NOT REACH THE BOOKS');
assert(refusePush(req('wrong')), 'junk is refused');
assert(refusePush(req('')), 'an empty key opens nothing');
assert.strictEqual(refusePush(req(LOGIN)).status, 401, 'refusal is a 401');

// And it must not work the other way either: a rep password is not a runner key.
assert(!machine(req(PUSH)), 'the rep password does not open machine endpoints');
assert(!page(req(PUSH)), 'the rep password does not open gated pages');

// Fails CLOSED when unset, unlike the login key. The login key's fallback exists
// so a lost variable never locks anyone out of a page; something that writes
// should do the opposite.
delete process.env.ZOHO_PUSH_KEY;
assert(refusePush(req(PUSH)), 'with no push key configured, the rep password stops working');
assert.strictEqual(refusePush(req(MACHINE)), null, 'the runner key still gets in');
process.env.ZOHO_PUSH_KEY = PUSH;

// --- login key unset: the pre-split fallback ------------------------------
delete process.env.SITE_LOGIN_KEY;
assert(page(req(MACHINE)), 'without a login key the runner key still opens pages');
assert(machine(req(MACHINE)), 'without a login key the runner key still opens machine endpoints');
assert(!page(req(LOGIN)), 'the old password stops working once it is no longer configured');

// --- neither configured: a deploy that lost its variables -----------------
delete process.env.SITE_EXPORT_KEY;
delete process.env.ZOHO_PUSH_KEY;
assert(!page(req(MACHINE)) && !page(req(LOGIN)) && !page(req('')),
  'with no secret set, nothing is authorised — an unset secret must not match an empty key');
assert(refusePush(req(MACHINE)) && refusePush(req(PUSH)) && refusePush(req('')),
  'with nothing configured the books are reachable by nobody');

console.log('auth tests passed (three keys, machine-only endpoints, the books, both transports, unset fallbacks)');

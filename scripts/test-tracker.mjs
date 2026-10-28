// Guards trackerAllowed in netlify/functions/_auth.mjs: who may read Elvis's sales tracker.
//
// The tracker has its own password (TRACKER_PASSWORD on Netlify), so whoever
// holds it sees that page and nothing else. The cases that matter: the password
// opens it, a wrong one and the site's typed login key do not, the runner's key
// still can, and with the variable unset nobody gets in by password.

import assert from 'node:assert';
import { trackerAllowed } from '../netlify/functions/_auth.mjs';

const MACHINE = 'machine-key-long-and-random';
const LOGIN = 'typed-password';
const PASS = 'tracker-test-pass';

function req(headers = {}) {
  return { url: 'https://framework.co.ke/api/tracker', headers: { get: (h) => headers[h] ?? null } };
}

const env = { SITE_EXPORT_KEY: MACHINE, SITE_LOGIN_KEY: LOGIN, TRACKER_PASSWORD: PASS };

assert.ok(trackerAllowed(req({ 'x-tracker-pass': PASS }), env), 'the password opens it');
assert.ok(trackerAllowed(req({ 'x-tracker-pass': '  Tracker-Test-Pass ' }), env), 'case and stray spaces from a phone keyboard are forgiven');
assert.ok(!trackerAllowed(req({ 'x-tracker-pass': 'tracker-test' }), env), 'a wrong password does not');
assert.ok(!trackerAllowed(req({}), env), 'no password does not');
assert.ok(!trackerAllowed(req({ 'x-framework-key': LOGIN }), env), 'the site login key does not');
assert.ok(trackerAllowed(req({ 'x-framework-key': MACHINE }), env), 'the runner may read what it published');
const unset = { SITE_EXPORT_KEY: MACHINE, SITE_LOGIN_KEY: LOGIN };
assert.ok(!trackerAllowed(req({ 'x-tracker-pass': '' }), unset), 'unset: an empty password does not match an empty variable');
assert.ok(!trackerAllowed(req({ 'x-tracker-pass': PASS }), unset), 'unset: closed to every password');

console.log('tracker auth tests passed');

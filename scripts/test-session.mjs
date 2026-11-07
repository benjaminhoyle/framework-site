// Guards _session.mjs, _staff.mjs and the Google token check.
import assert from 'node:assert';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { issue, read, sessionAllows, cookies, clearCookies, COOKIE, FRESH_MS, LIFE_MS } from '../netlify/functions/_session.mjs';
import { resolve, fromRow } from '../netlify/functions/_staff.mjs';
import { refuse, trackerAllowed, refusePush } from '../netlify/functions/_auth.mjs';

const secret = 'test-secret';
const req = (cookie) => ({
  url: 'https://www.framework.co.ke/api/x',
  headers: { get: (h) => (h === 'cookie' ? cookie : null) }
});

// --- tokens ---
const now = 1_800_000_000_000;
const token = issue({ email: 'a@x.com', name: 'A', modules: ['clients'] }, { secret, now });
const good = read(token, { secret, now });
assert.equal(good.email, 'a@x.com');
assert.deepEqual(good.modules, ['clients']);
assert.equal(good.fresh, true);
assert.equal(read(token, { secret: 'other', now }), null, 'another secret must not read it');
assert.equal(read(token + 'x', { secret, now }), null, 'a changed signature must fail');
const [v, , sig] = token.split('.');
const forged = Buffer.from(JSON.stringify({ e: 'a@x.com', m: ['admin'], c: now, x: now + 1e9 })).toString('base64url');
assert.equal(read(`${v}.${forged}.${sig}`, { secret, now }), null, 'a changed body must fail');
assert.equal(read(token, { secret, now: now + LIFE_MS }), null, 'expired');
assert.equal(read(token, { secret: '', now }), null, 'no secret, no sessions');
assert.equal(read(token, { secret, now: now + FRESH_MS }).fresh, false, 'modules go stale');

// --- what a session opens ---
const cookie = `other=1; ${COOKIE}=${token}`;
assert.equal(sessionAllows(req(cookie), 'clients', { secret, now }), true);
assert.equal(sessionAllows(req(cookie), 'admin', { secret, now }), false, 'only what they were given');
assert.equal(sessionAllows(req(cookie), 'clients', { secret, now: now + FRESH_MS }), false, 'stale modules open nothing');
assert.equal(sessionAllows(req(''), 'clients', { secret, now }), false);

// --- the old gates, now also open to a session with the right module ---
process.env.SESSION_SECRET = secret;
const live = issue({ email: 'e@x.com', modules: ['monitor', 'tracker'] });
const liveCookie = `${COOKIE}=${live}`;
assert.equal(refuse(req(liveCookie), { module: 'monitor' }), null, 'monitor module opens a monitor endpoint');
assert.equal(refuse(req(liveCookie), { module: 'catalog' }).status, 401, 'but not the catalogue');
assert.equal(refuse(req(liveCookie)).status, 401, 'an endpoint naming no module stays key-only');
assert.equal(trackerAllowed(req(liveCookie), {}), true, 'tracker module opens the tracker');
assert.equal(refusePush(req(liveCookie)).status, 401, 'tracker does not reach the books');
const pusher = `${COOKIE}=${issue({ email: 'r@x.com', modules: ['invoice'] })}`;
assert.equal(refusePush(req(pusher)), null, 'invoice module raises drafts');

// --- cookies ---
const [c1, c2] = cookies('T', {});
assert(/HttpOnly/.test(c1) && /Secure/.test(c1) && /SameSite=Lax/.test(c1), 'session cookie flags');
assert(!/HttpOnly/.test(c2) && /^fw_staff=1;/.test(c2), 'the hint is readable and says only 1');
assert(!/Domain=/.test(c1), 'host-only, so a branch deploy cannot read production');
assert(/Max-Age=0/.test(clearCookies({})[0]));
assert(!/Secure/.test(cookies('T', { secure: false })[0]), 'plain http on the dev server');

// --- who is staff ---
const list = [
  fromRow({ id: 'r1', fields: { Email: ' Elvis@Example.com ', Name: 'Elvis', Modules: ['clients'], Active: true } }),
  fromRow({ id: 'r2', fields: { Email: 'gone@example.com', Modules: ['clients'], Active: false } })
];
assert.equal(resolve(list, 'elvis@example.com', { owner: '' }).name, 'Elvis', 'case and spaces forgiven');
assert.equal(resolve(list, 'gone@example.com', { owner: '' }), null, 'inactive is out');
assert.equal(resolve(list, 'nobody@example.com', { owner: '' }), null);
const boss = resolve([], 'Owner@Example.com', { owner: 'owner@example.com' });
assert(boss.modules.includes('admin') && boss.owner, 'the owner cannot be locked out');
assert.equal(resolve(list, '', { owner: '' }), null);

// --- Google's token ---
const { verifyIdToken } = await import('../netlify/functions/auth-google.mjs');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const mint = (claims, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, kid, typ: 'JWT' });
  const pay = enc(claims);
  const s = createSign('RSA-SHA256'); s.update(`${head}.${pay}`);
  return `${head}.${pay}.${s.sign(key).toString('base64url')}`;
};
const base = {
  aud: 'app', iss: 'https://accounts.google.com', exp: Math.floor(now / 1000) + 600,
  email: 'Elvis@Example.com', email_verified: true, name: 'Elvis'
};
const check = (t) => verifyIdToken(t, { jwks: [jwk], audience: 'app', now });
assert.equal(check(mint(base)).email, 'elvis@example.com');
assert.equal(check(mint({ ...base, aud: 'someone-else' })).why, 'audience');
assert.equal(check(mint({ ...base, iss: 'https://evil.example' })).why, 'issuer');
assert.equal(check(mint({ ...base, exp: Math.floor(now / 1000) - 1 })).why, 'expired');
assert.equal(check(mint({ ...base, email_verified: false })).why, 'unverified');
assert.equal(check(mint(base, { kid: 'nope' })).why, 'unknown_key');
const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
assert.equal(check(mint(base, { key: other })).why, 'signature');
assert.equal(check('rubbish').why, 'malformed');

console.log('session tests pass');

// The one place a private endpoint decides whether to answer.
//
// Every gated surface on this site is behind a shared secret, and there are two
// of them, because they are held by different callers and protect different
// things:
//
//   SITE_LOGIN_KEY   the password a person types into js/gate.js to open the
//                    funnel monitor, the catalogue manager and the two studios.
//                    It is chosen to be typed and remembered, so it is short,
//                    so it is guessable — and it therefore opens only what a
//                    person needs to see.
//   SITE_EXPORT_KEY  the key the ops runner sends. Nobody types it, so it is
//                    long and random. It opens everything the login key opens,
//                    plus the endpoints no browser calls: the raw event-lake
//                    export, and the two push endpoints that overwrite what the
//                    gated pages display.
//
// Per-person accounts would not be proportionate for three people. What matters
// is that the decision is enforced in exactly one place, so a new endpoint
// cannot be added without an author having to choose an audience for it:
// `refuse` for anything a page calls, `refuseMachine` for the runner's own.
//
// With SITE_LOGIN_KEY unset, SITE_EXPORT_KEY is accepted everywhere and the site
// behaves exactly as it did before the split — which is also what happens if a
// deploy ever loses the variable, so a missing login key locks nobody out who
// holds the runner's.
//
// The key travels in the `X-Framework-Key` header. The query string is still
// accepted because the ops runner sends it that way and old bookmarks carry it,
// but secrets in URLs end up in browser history, referrer headers and logs, so
// js/gate.js moves a `?key=` into storage and strips it from the address bar the
// first time it sees one.

const HEADER = 'x-framework-key';

/** The key on a request, from the header first and the query string second. */
export function keyFrom(req) {
  const header = req.headers.get(HEADER);
  if (header) return header;
  try { return new URL(req.url).searchParams.get('key') || ''; } catch { return ''; }
}

/**
 * True when this request may proceed.
 *
 * `machineOnly` turns the login key away, for endpoints no browser calls:
 * guessing the typed password should not also hand over the raw event lake or
 * the ability to overwrite the dashboard the others are reading.
 *
 * Length-independent comparison is not worth it here: the secrets are shared,
 * sent over TLS, and an attacker who can time a Netlify cold start to the byte
 * has easier routes. What is worth it is refusing when a secret is unset, and
 * when none was supplied, rather than accidentally matching an empty string.
 */
export function authorised(req, { machineOnly = false } = {}) {
  const supplied = keyFrom(req);
  if (!supplied) return false;
  const machine = process.env.SITE_EXPORT_KEY;
  const login = process.env.SITE_LOGIN_KEY;
  if (machine && supplied === machine) return true;
  if (!machineOnly && login && supplied === login) return true;
  return false;
}

/** The refusal itself — identical whichever key was wrong, so it tells nothing. */
function unauthorised() {
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** `null` when the request may proceed, otherwise the response to return. */
export function refuse(req) {
  return authorised(req) ? null : unauthorised();
}

/** As `refuse`, for the endpoints only the ops runner is meant to reach. */
export function refuseMachine(req) {
  return authorised(req, { machineOnly: true }) ? null : unauthorised();
}

/**
 * A third key, for the one endpoint that creates something in the accounting
 * system rather than showing something.
 *
 * SITE_LOGIN_KEY deliberately does not open this. That key is chosen to be typed
 * and remembered — short, and therefore guessable — on the understanding that it
 * only opens what a person needs to *see*. Raising a draft invoice is doing, and
 * a key that opens the dashboards should not also reach the books.
 *
 * It fails CLOSED: with ZOHO_PUSH_KEY unset, only the machine key gets in. The
 * login key's unset-fallback exists so a lost variable never locks anyone out of
 * a page; the opposite instinct applies to something that writes.
 */
export function refusePush(req) {
  const supplied = keyFrom(req);
  if (!supplied) return unauthorised();
  const machine = process.env.SITE_EXPORT_KEY;
  const push = process.env.ZOHO_PUSH_KEY;
  if (machine && supplied === machine) return null;
  if (push && supplied === push) return null;
  return unauthorised();
}

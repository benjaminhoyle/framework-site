// The one place a private endpoint decides whether to answer.
//
// Every gated surface on this site — the funnel monitor, the catalogue manager,
// the scene and catalogue studios — is behind one shared secret, SITE_EXPORT_KEY.
// That is proportionate for three people; per-person accounts would not be. What
// matters is that it is enforced in exactly one place, so a new endpoint cannot
// be added without an author having to think about it.
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
 * Length-independent comparison is not worth it here: the secret is shared, sent
 * over TLS, and an attacker who can time a Netlify cold start to the byte has
 * easier routes. What is worth it is refusing when the secret is unset, rather
 * than accidentally matching an empty string.
 */
export function authorised(req) {
  const expected = process.env.SITE_EXPORT_KEY;
  if (!expected) return false;
  return keyFrom(req) === expected;
}

/** `null` when the request may proceed, otherwise the response to return. */
export function refuse(req) {
  if (authorised(req)) return null;
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

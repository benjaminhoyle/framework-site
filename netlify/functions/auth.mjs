// POST /api/auth — "is this key right?"
//
// The gated pages are plain static files: anyone can fetch the HTML. That is
// fine, because they hold no secret and can do nothing without an answer from
// here. This endpoint exists so js/gate.js can tell a good key from a bad one
// before showing the page, rather than letting someone stare at a broken
// dashboard wondering whether they typed it wrong.
//
// It deliberately returns nothing but ok/not-ok. No hint, no echo of the key.

import { refuse } from './_auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const denied = refuse(req);
  if (denied) return denied;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/auth' };

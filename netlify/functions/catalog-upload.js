// POST /api/catalog-upload?key=<secret>&id=<productId>&file=<name> — the manager
// uploads one package image at a time (raw bytes in the body), staged in Blobs for
// the runner's publish to resize into the repo. One image per request keeps each
// well under the function payload limit. Auth reuses SITE_EXPORT_KEY.

import { getStore } from '@netlify/blobs';

const MAX = 12 * 1024 * 1024; // generous per-image ceiling (source photos)
const SAFE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export default async (req) => {
  const u = new URL(req.url);
  const key = u.searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) return new Response('unauthorized', { status: 401 });
  const store = getStore('catalog-uploads');
  const id = u.searchParams.get('id') || '';
  const file = u.searchParams.get('file') || '';

  // GET → the runner lists staged files for an id, or downloads one (raw bytes).
  if (req.method === 'GET') {
    if (!SAFE.test(id)) return new Response(JSON.stringify({ ok: false, error: 'bad_name' }), { status: 422 });
    if (file) {
      if (!SAFE.test(file)) return new Response(JSON.stringify({ ok: false, error: 'bad_name' }), { status: 422 });
      const blob = await store.get(`${id}/${file}`, { type: 'arrayBuffer' });
      if (!blob) return new Response('not found', { status: 404 });
      return new Response(blob, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }
    const { blobs } = await store.list({ prefix: `${id}/` });
    return new Response(JSON.stringify({ ok: true, files: blobs.map((b) => b.key.slice(id.length + 1)) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // DELETE → clear an id's staged uploads (after a successful publish).
  if (req.method === 'DELETE') {
    if (!SAFE.test(id)) return new Response(JSON.stringify({ ok: false, error: 'bad_name' }), { status: 422 });
    const { blobs } = await store.list({ prefix: `${id}/` });
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return new Response(JSON.stringify({ ok: true, deleted: blobs.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!SAFE.test(id) || !SAFE.test(file)) return new Response(JSON.stringify({ ok: false, error: 'bad_name' }), { status: 422 });

  // Require a binary content-type. Without one the runtime decodes the body as
  // UTF-8 text, which silently corrupts (inflates) the image — and a corrupted
  // photo would sail through to the live site. Fail loudly instead.
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (!/^(image\/(jpeg|jpg|png|webp)|application\/octet-stream)/.test(ct)) {
    return new Response(JSON.stringify({ ok: false, error: 'bad_content_type', got: ct || '(none)', need: 'image/* or application/octet-stream' }), { status: 415 });
  }

  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX) return new Response(JSON.stringify({ ok: false, error: 'bad_size' }), { status: 400 });

  await getStore('catalog-uploads').set(`${id}/${file}`, buf, {
    metadata: { uploaded_at: new Date().toISOString(), bytes: buf.byteLength },
  });
  return new Response(JSON.stringify({ ok: true, key: `${id}/${file}`, bytes: buf.byteLength }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

export const config = { path: '/api/catalog-upload' };

// /app on the local dev server: the staff app over the memory store.
//
// It runs the shipped rules (netlify/functions/_appcore.mjs) and the shipped session
// code. Only the data underneath differs. APP_FIXTURES names a JSON file of data,
// which for the demo is out/app-mock/fixtures.json: real client data, in no repo. With
// none, it starts empty and invented, so this works in a fresh checkout.
//
// Sign-in has no Google here: the login page lists the staff and a click signs in as
// them. Dev only: scripts/ is 404'd on the site and this server never runs there.

import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../../netlify/functions/_appcore.mjs';
import { issue, sessionFrom, cookies, clearCookies } from '../../netlify/functions/_session.mjs';
import { engine } from '../../netlify/functions/_glb.mjs';
import { describeRecord, recolorRecord } from '../../netlify/functions/_designinfo.mjs';
import { memoryStore } from './app-memory-store.mjs';

const EMPTY = {
  staff: [
    { id: 'stf1', email: 'ben@example.com', name: 'Ben', active: true, modules: ['clients', 'invoice', 'deliveries', 'tracker', 'monitor', 'marketing', 'catalog', 'studio', 'queue', 'admin'] },
    { id: 'stf2', email: 'elvis@example.com', name: 'Elvis', active: true, modules: ['clients', 'invoice', 'deliveries', 'tracker'] }
  ]
};

export function appDev({ root, localDesign, rememberDesign }) {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret';
  const fixtures = process.env.APP_FIXTURES;
  const db = fixtures && fs.existsSync(fixtures) ? JSON.parse(fs.readFileSync(fixtures, 'utf8')) : EMPTY;
  const dir = fixtures ? path.dirname(fixtures) : null;
  const catalog = engine.normalizeCatalog(JSON.parse(fs.readFileSync(path.join(root, 'assets/shelving/catalog.json'), 'utf8')));
  const images = new Map();
  // Designs to know without asking the live site, such as every colour of the demo's quick add.
  if (process.env.APP_DESIGN_RECORDS && fs.existsSync(process.env.APP_DESIGN_RECORDS)) {
    for (const [code, record] of Object.entries(JSON.parse(fs.readFileSync(process.env.APP_DESIGN_RECORDS, 'utf8')))) {
      rememberDesign(code, { ok: true, ...record });
    }
  }

  const prod = async (code) => {
    const r = await fetch(`https://www.framework.co.ke/api/design?code=${code}`).catch(() => null);
    return r && r.ok ? r.json() : null;
  };
  const recordOf = async (code) => localDesign(code) || prod(code);

  async function lookupDesign(code) {
    const record = await recordOf(code);
    return record ? { ...describeRecord(catalog, record), hash: record.hash } : null;
  }

  async function recolorDesign(code, finish) {
    const record = await recordOf(code);
    if (!record) return null;
    const made = recolorRecord(catalog, record, finish.toLowerCase());
    rememberDesign(made.code, { ok: true, created_at: new Date().toISOString(), ...made });
    return { code: made.code, ...describeRecord(catalog, made) };
  }

  const store = memoryStore(db, { lookupDesign, recolorDesign });
  const nairobiToday = () => db.today || new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);

  const send = (res, status, body, headers = {}) => {
    const isText = typeof body === 'string' || Buffer.isBuffer(body);
    res.writeHead(status, { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(isText ? body : JSON.stringify(body));
  };

  async function raw(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }
  async function readJson(req) {
    try { return JSON.parse((await raw(req)).toString() || '{}'); } catch { return {}; }
  }

  const personOf = (req) => {
    const proxy = { headers: { get: (h) => req.headers[h] } };
    const session = sessionFrom(proxy);
    if (!session) return null;
    const row = (db.staff || []).find((s) => s.email === session.email && s.active);
    return row ? { ...row } : null;
  };

  return async function handleApp(req, res, url) {
    const p = url.pathname;

    if (p === '/app/config.js') {
      const base = fs.readFileSync(path.join(root, 'app/config.js'), 'utf8');
      const devList = (db.staff || []).filter((s) => s.active).map((s) => ({ email: s.email, name: s.name }));
      send(res, 200, `${base}\nObject.assign(window.FW_APP, ${JSON.stringify({ dev: devList, today: db.today || null })});`, { 'content-type': 'text/javascript; charset=utf-8' });
      return true;
    }
    if (p === '/app/planner.html') {
      const file = dir && path.join(dir, 'planner.html');
      if (file && fs.existsSync(file)) send(res, 200, fs.readFileSync(file), { 'content-type': 'text/html; charset=utf-8' });
      else send(res, 200, '<!doctype html><title>Deliveries</title><p style="font-family:sans-serif;padding:24px">No planner in this checkout.</p>', { 'content-type': 'text/html; charset=utf-8' });
      return true;
    }
    if (/^\/app(\/(clients(\/[^/]+)?|deliveries|admin|login))?\/?$/.test(p)) {
      send(res, 200, fs.readFileSync(path.join(root, 'app/index.html')), { 'content-type': 'text/html; charset=utf-8' });
      return true;
    }
    if (p === '/staff' || p === '/staff/') {
      res.writeHead(301, { location: '/app' });
      res.end();
      return true;
    }

    if (p === '/api/auth/dev' && req.method === 'POST') {
      const { email } = await readJson(req);
      const row = (db.staff || []).find((s) => s.email === email);
      if (!row) { send(res, 403, { ok: false }); return true; }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': cookies(issue(row), { secure: false }) });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': clearCookies({ secure: false }) });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }
    if (p === '/api/me') {
      const person = personOf(req);
      if (!person) { send(res, 401, { ok: false, error: 'signed_out' }); return true; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': cookies(issue(person), { secure: false }) });
      res.end(JSON.stringify({ ok: true, email: person.email, name: person.name, modules: person.modules }));
      return true;
    }

    if (p.startsWith('/api/app/')) {
      const person = personOf(req);
      if (!person) { send(res, 401, { ok: false, error: 'signed_out' }); return true; }
      const body = req.method === 'GET' ? {} : await readJson(req);
      const out = await handle({ store, person, today: nairobiToday(), method: req.method, path: p.slice('/api/app/'.length), body });
      console.log(`${req.method} ${p} -> ${out.status}`);
      send(res, out.status, out.json);
      return true;
    }

    const image = /^\/api\/design-image\/([0-9A-Z]{7})$/.exec(p);
    if (image) {
      if (req.method === 'PUT') {
        images.set(image[1], await raw(req));
        send(res, 200, { ok: true });
        return true;
      }
      const code = image[1];
      if (images.has(code)) { send(res, 200, images.get(code), { 'content-type': 'image/png' }); return true; }
      const file = dir && path.join(dir, 'designs', `${code}.jpg`);
      if (file && fs.existsSync(file)) send(res, 200, fs.readFileSync(file), { 'content-type': 'image/jpeg' });
      else send(res, 404, 'no image');
      return true;
    }

    // Designs the site knows but this process does not, so /builder/<CODE> opens real ones.
    if (p === '/api/design' && req.method === 'GET') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      if (code && !localDesign(code)) {
        const stored = await prod(code);
        if (stored) { send(res, 200, stored); return true; }
      }
    }
    return false;
  };
}

#!/usr/bin/env node
/**
 * Local dev server for /builder.
 *
 *   node scripts/dev-builder.mjs [port]        # then open http://127.0.0.1:8770/builder
 *
 * A plain `python3 -m http.server` is no longer enough for this page: it serves
 * files, but /builder and /builder/<CODE> are rewrites declared in netlify.toml,
 * and /api/design is a function. Without them a saved design cannot be created
 * or opened locally, which is most of what there is to test.
 *
 * So this stands in for the two things Netlify does:
 *
 *   - rewrites /builder and /builder/<CODE> to builder.html
 *   - runs netlify/functions/design.js for real, with an in-memory Map where
 *     Netlify Blobs would be
 *   - fakes /api/zoho-push over invented clients, so the staff order form can be
 *     worked on without Zoho credentials or a live draft invoice per attempt
 *
 * The function is loaded from source with its Blobs import stripped, the same
 * way scripts/test-builder.mjs does it, so this exercises the shipped handler
 * rather than a second copy of its rules. Designs live only as long as the
 * process: it is a scratch store, not a database.
 *
 * `netlify dev` remains the higher-fidelity option if the CLI is installed --
 * this exists so that it does not have to be.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 8770);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

// --- the design function, with Blobs swapped for a Map ---------------------

const designs = new Map();
const getStore = () => ({
  get: async (key, options) => {
    if (!designs.has(key)) return null;
    return options && options.type === "json" ? JSON.parse(designs.get(key)) : designs.get(key);
  },
  setJSON: async (key, value) => { designs.set(key, JSON.stringify(value)); }
});

const source = fs.readFileSync(path.join(ROOT, "netlify/functions/design.js"), "utf8")
  .replace(/^import \{ getStore \} from '@netlify\/blobs';$/m, "")
  .replace(/^export const config = .*$/m, "")
  .replace("export default async (req, context) =>", "const handler = async (req, context) =>");
const built = await import(
  `data:text/javascript;base64,${Buffer.from(`export const make = (getStore) => {${source}\nreturn handler;};`).toString("base64")}`
);
const designHandler = built.make(getStore);

// --- the push endpoint, faked ----------------------------------------------

/*
 * `/api/zoho-push` cannot run here: it needs Zoho and Airtable credentials, and
 * exercising it for real would raise draft invoices in the live books and spend
 * a daily API budget of 2,000 calls to do it.
 *
 * So this answers with the same shapes over invented people. It is enough to
 * work on the form itself -- the client dropdown, the prefill, the delivery
 * fields, every branch of the result screen -- which is the part that is hard to
 * get right and the part that changes. Anything about Zoho's actual behaviour
 * has to be checked against `netlify dev` with real credentials.
 *
 * Dev only. It lives in scripts/, which the site 404s, and is never bundled.
 */
// [id, name, [zoho phone, zoho address], [airtable phone, airtable address]]
// The interesting rows are the ones where the two sides differ, and the ones
// where one side is blank -- a gap the first push fills, not a disagreement.
const FAKE_CLIENTS = [
  ['4099765000000860001', 'Rose Ouma', ['0722123456', '34 Garden Estate Rd.'], ['0722123456', '34 Garden Estate Rd.']],
  ['4099765000000860002', 'Zeinab Aidid', ['', ''], ['', 'Heri Paradise Apartments, Dennis Pritt Rd, Kilimani']],
  ['4099765000000860003', 'Émilie Bichon', ['0114277446', ''], ['0114277446', 'Kitisuru Ridge Villas House 12']],
  ['4099765000000860004', 'Anne Wanjiru', ['0733999888', ''], ['0711555444', '3 Karen Road']],
  ['4099765000000860005', 'Joanne Karanja', ['0700111222', '9 Ngong Road'], ['0700111222', '11 Ngong Road']],
  ['4099765000000860006', 'Bernard Clouteau', ['', ''], ['', '']],
  ['4099765000000860007', 'Kerstin Karlstrom', ['+254721000111', 'Lavington Green'], ['0721000111', 'lavington green']],
  ['4099765000000860008', 'Ando Foods Ltd', ['0722743449', 'Westlands'], null],
  ['4099765000000860009', 'Tom Crisp', ['', 'Karen'], ['', 'Karen']],
  ['4099765000000860010', 'Suzanne Steyn', ['0733540066', '34 Garden Estate Rd.'], ['0733540066', '34 Garden Estate Rd.']]
].map(([contact_id, name, zoho, airtable]) => ({ contact_id, name, zoho, airtable }));

/** Mirrors samePhone/sameAddress in _push.mjs closely enough to demo the flag. */
const sameish = (a, b) => String(a || '').replace(/\D/g, '').replace(/^(?:254|0)/, '').slice(-9)
  === String(b || '').replace(/\D/g, '').replace(/^(?:254|0)/, '').slice(-9);
const sameText = (a, b) => String(a || '').trim().replace(/\s+/g, ' ').toLowerCase()
  === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();

let fakeInvoice = 640500;

function fakePush(body) {
  if (body.action === 'clients') {
    return { ok: true, results: FAKE_CLIENTS.map(({ contact_id, name }) => ({ contact_id, name })) };
  }
  if (body.action === 'client') {
    const found = FAKE_CLIENTS.find((c) => c.contact_id === String(body.contact_id));
    if (!found) return { ok: false, error: 'bad_contact_id' };
    const [zp, za] = found.zoho;
    const [ap, aa] = found.airtable || ['', ''];
    return {
      ok: true,
      contact_id: found.contact_id,
      name: found.name,
      phone: zp || ap,
      address: za || aa,
      zoho: { phone: zp, address: za },
      airtable: found.airtable ? { phone: ap, address: aa } : null,
      differs: {
        phone: Boolean(zp && ap) && !sameish(zp, ap),
        address: Boolean(za && aa) && !sameText(za, aa)
      }
    };
  }
  if (body.action === 'search') {
    const q = String(body.query || '').toLowerCase();
    return {
      ok: true,
      results: FAKE_CLIENTS.filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 12).map(({ contact_id, name }) => ({ contact_id, name }))
    };
  }
  if (body.action === 'push') {
    const created = !body.contact_id;
    const name = created
      ? [body.new_client?.first_name, body.new_client?.last_name].filter(Boolean).join(' ')
      : (FAKE_CLIENTS.find((c) => c.contact_id === String(body.contact_id)) || {}).name;
    const fee = body.pickup ? 0 : Number(body.delivery_fee) || 0;
    fakeInvoice += 1;
    return {
      ok: true,
      invoice_number: `INV${fakeInvoice}`,
      invoice_id: String(fakeInvoice),
      status: 'draft',
      url: 'https://books.zoho.com/app/000#/invoices/0',
      lines: 3 + (fee ? 1 : 0),
      computed_total: 47500 + fee,
      goods_total: 47500,
      delivery_total: fee,
      client: {
        contact_id: body.contact_id || 'new', name, created,
        airtable: created ? { ok: true, created: true, record_id: 'recFAKE' } : null
      },
      contact_saved: created || !body.phone ? null : { ok: true, phone: true, address: false, replaced: ['previous phone 0722123456'] },
      client_saved: created || !body.phone ? null : { ok: true, phone: true, address: false, replaced: ['previous phone 0711555444'] },
      skipped_fields: [],
      drift: null,
      unknown: []
    };
  }
  return { ok: false, error: 'unknown_action' };
}

// --- routing ---------------------------------------------------------------

// Matches the rewrites in netlify.toml. Kept in step with them by hand; there is
// no toml parser here and this is the only pair that matters for the builder.
const REWRITES = [
  [/^\/builder(\/[0-9A-Za-z]{0,7})?\/?$/, "/builder.html"],
  [/^\/new-designer(\/[0-9A-Za-z]{0,7})?\/?$/, "/builder.html"] // the old address
];

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/api/zoho-push") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let payload = {};
    try { payload = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { /* below */ }
    // Any non-empty password opens the fake. The real one is a shared secret in
    // the environment, and there is nothing here worth guarding.
    const key = request.headers["x-framework-key"] || "";
    const result = key ? fakePush(payload) : { ok: false, error: "unauthorized" };
    const status = key ? 200 : 401;
    console.log(`POST /api/zoho-push [${payload.action}] -> ${status} (dev stub)`);
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === "/api/design") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const proxied = new Request(`http://127.0.0.1${request.url}`, {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: chunks.length ? Buffer.concat(chunks) : undefined
    });
    const result = await designHandler(proxied, { geo: { country: { code: "KE" } } });
    const body = await result.text();
    console.log(`${request.method} /api/design -> ${result.status} ${body.slice(0, 100)}`);
    response.writeHead(result.status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(body);
    return;
  }

  let file = url.pathname;
  for (const [pattern, target] of REWRITES) {
    if (pattern.test(file)) { file = target; break; }
  }
  if (file.endsWith("/")) file += "index.html";

  // Normalise first, then join, so "../" in a request cannot escape the root.
  const full = path.join(ROOT, path.normalize(file).replace(/^(\.\.[\\/])+/, ""));
  fs.readFile(full, (error, data) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
      // Never cache in dev: the version query string is there to defeat caching
      // in production, and it only gets in the way here.
      "cache-control": "no-store"
    });
    response.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`framework-site + /api/design on http://127.0.0.1:${PORT}`);
  console.log(`the builder: http://127.0.0.1:${PORT}/builder`);
});

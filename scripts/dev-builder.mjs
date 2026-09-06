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
import { spawn } from "node:child_process";
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
// [id, name, [zoho phone, address, PIN], [airtable phone, address, PIN], VAT exempt]
// The interesting rows are the ones where the two sides differ, and the ones
// where one side is blank -- a gap the first push fills, not a disagreement.
// Most people have no PIN at all, which is the ordinary case and the one the
// form has to look unremarkable in.
const FAKE_CLIENTS = [
  ['4099765000000860001', 'Rose Ouma', ['0722123456', '34 Garden Estate Rd.', ''], ['0722123456', '34 Garden Estate Rd.', '']],
  ['4099765000000860002', 'Zeinab Aidid', ['', '', ''], ['', 'Heri Paradise Apartments, Dennis Pritt Rd, Kilimani', '']],
  ['4099765000000860003', 'Émilie Bichon', ['0114277446', '', ''], ['0114277446', 'Kitisuru Ridge Villas House 12', '']],
  ['4099765000000860004', 'Anne Wanjiru', ['0733999888', '', ''], ['0711555444', '3 Karen Road', '']],
  ['4099765000000860005', 'Joanne Karanja', ['0700111222', '9 Ngong Road', ''], ['0700111222', '11 Ngong Road', '']],
  ['4099765000000860006', 'Bernard Clouteau', ['', '', ''], ['', '', '']],
  ['4099765000000860007', 'Kerstin Karlstrom', ['+254721000111', 'Lavington Green', ''], ['0721000111', 'lavington green', '']],
  // A PIN Zoho has and Airtable does not: the gap the reconciler's seeding
  // closes on its own, and the push fills the moment somebody raises an order.
  ['4099765000000860008', 'Ando Foods Ltd', ['0722743449', 'Westlands', 'P051946109M'], null],
  ['4099765000000860009', 'Tom Crisp', ['', 'Karen', ''], ['', 'Karen', '']],
  // Two PINs for one company, which is a person having retyped one of them
  // wrong -- the case the flag under the box exists for.
  ['4099765000000860011', 'Baraza Media Lab', ['0202000111', 'Riverside Drive', 'P051755191T'], ['0202000111', 'Riverside Drive', 'P051755191Y']],
  // Exempt, and nothing in Zoho says so. Airtable is the only record of it,
  // which is exactly why the form has to say it out loud.
  ['4099765000000860012', 'Kileleshwa Mission', ['0700888999', 'Kileleshwa'], ['0700888999', 'Kileleshwa', 'P051000123Z'], true],
  ['4099765000000860010', 'Suzanne Steyn', ['0733540066', '34 Garden Estate Rd.', ''], ['0733540066', '34 Garden Estate Rd.', '']]
].map(([contact_id, name, zoho, airtable, vat_exempt]) => ({ contact_id, name, zoho, airtable, vat_exempt }));

/** Mirrors samePhone/sameAddress in _push.mjs closely enough to demo the flag. */
const sameish = (a, b) => String(a || '').replace(/\D/g, '').replace(/^(?:254|0)/, '').slice(-9)
  === String(b || '').replace(/\D/g, '').replace(/^(?:254|0)/, '').slice(-9);
const sameText = (a, b) => String(a || '').trim().replace(/\s+/g, ' ').toLowerCase()
  === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();
/** Mirrors samePin. */
const samePinish = (a, b) => String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  === String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

let fakeInvoice = 640500;

function fakePush(body) {
  if (body.action === 'clients') {
    return { ok: true, results: FAKE_CLIENTS.map(({ contact_id, name }) => ({ contact_id, name })) };
  }
  if (body.action === 'client') {
    const found = FAKE_CLIENTS.find((c) => c.contact_id === String(body.contact_id));
    if (!found) return { ok: false, error: 'bad_contact_id' };
    const [zp, za, zpin = ''] = found.zoho;
    const [ap, aa, apin = ''] = found.airtable || ['', '', ''];
    return {
      ok: true,
      contact_id: found.contact_id,
      name: found.name,
      phone: zp || ap,
      address: za || aa,
      // Airtable first for the PIN, Zoho first for the other two -- see the
      // note on the real endpoint. Getting this backwards here would make the
      // "Zoho has ..." flag appear on the wrong side of every disagreement.
      pin: apin || zpin,
      vat_exempt: Boolean(found.vat_exempt),
      zoho: { phone: zp, address: za, pin: zpin },
      airtable: found.airtable ? { phone: ap, address: aa, pin: apin } : null,
      differs: {
        phone: Boolean(zp && ap) && !sameish(zp, ap),
        address: Boolean(za && aa) && !sameText(za, aa),
        pin: Boolean(zpin && apin) && !samePinish(zpin, apin)
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
    // Same lenient parse as _push.mjs moneyValue, so "2,500" behaves here the
    // way it behaves in production rather than quietly becoming zero.
    const fee = body.pickup ? 0 : (Number(String(body.delivery_fee ?? '').replace(/[^0-9.]/g, '')) || 0);
    const feeTyped = !body.pickup && String(body.delivery_fee || '').trim();
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
      contact_saved: created || !body.phone ? null : {
        ok: true, phone: true, address: false, pin: Boolean(body.kra_pin),
        // The branch worth being able to see: setting a PIN also moves the
        // contact to vat_registered, and the result screen has to say so.
        registered: Boolean(body.kra_pin),
        replaced: ['previous phone 0722123456']
      },
      client_saved: created || !body.phone ? null : {
        ok: true, phone: true, address: false, pin: Boolean(body.kra_pin),
        replaced: ['previous phone 0711555444']
      },
      skipped_fields: [],
      warnings: feeTyped && !fee
        ? [`The delivery fee "${body.delivery_fee}" was not a usable amount, so no delivery line was added.`]
        : [],
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

// --- the gated endpoints, proxied ------------------------------------------

/*
 * The image model, the scene record and the auth check all live in Netlify
 * functions, so none of them exist on this server. Left to itself the studio's
 * scene leg would 404 locally — and it did, behind a password prompt that made
 * it look like an authorisation problem.
 *
 * So these are forwarded to the deployed site with the site key attached here,
 * where it can be read from the environment. Two things follow, both wanted:
 * the browser never handles the key, and there is no password to type into a
 * bench tool that already only listens on localhost.
 *
 * The key is not in this repo. Put it in framework-site/.env (already ignored)
 * or export it before `npm run dev`:
 *
 *     SITE_LOGIN_KEY=…
 *
 * **These calls cost money.** They run against the live functions and the live
 * provider budget; there is no local stand-in for an image model.
 */
const PROXY_ORIGIN = process.env.FRAMEWORK_SITE_ORIGIN || "https://framework.co.ke";
const PROXIED = new Set(["/api/ai-start", "/api/ai-result", "/api/ai", "/api/ai-image",
  "/api/scene-airtable", "/api/auth"]);

function siteKey() {
  if (process.env.SITE_LOGIN_KEY) return process.env.SITE_LOGIN_KEY;
  if (process.env.SITE_EXPORT_KEY) return process.env.SITE_EXPORT_KEY;
  // A local .env, read at the moment it is needed rather than cached, so
  // adding the key does not mean restarting the server.
  for (const name of [".env", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*(SITE_LOGIN_KEY|SITE_EXPORT_KEY)\s*=\s*(.+?)\s*$/.exec(line);
      if (match) return match[2].replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

async function proxyToSite(request, response, url) {
  const key = siteKey();
  if (!key) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: false,
      error: "no site key. Put SITE_LOGIN_KEY=… in framework-site/.env, or export it before npm run dev."
    }));
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const target = `${PROXY_ORIGIN}${url.pathname}${url.search}`;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        "content-type": request.headers["content-type"] || "application/json",
        accept: request.headers.accept || "application/json",
        "x-framework-key": key
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : body
    });
    const payload = Buffer.from(await upstream.arrayBuffer());
    console.log(`${request.method} ${url.pathname} -> ${PROXY_ORIGIN} ${upstream.status} (${payload.length} bytes)`);
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store"
    });
    response.end(payload);
  } catch (error) {
    console.error(`proxy to ${target} failed: ${error.message}`);
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: `could not reach ${PROXY_ORIGIN}: ${error.message}` }));
  }
}

// --- the render queue -------------------------------------------------------

const PIPELINE = path.resolve(ROOT, "..", "framework-renderer");
const RENDER_DIR = path.join(ROOT, "data/design-lab/render-queue");
const MM_TO_M = 0.001;

const renders = { paused: false, waiting: [], running: null, done: [], failed: [] };

/**
 * Which renders actually exist on disk, as opposed to which this session
 * happened to make.
 *
 * The gallery needs the first and only ever knew the second, so a shot approved
 * last week showed a broken image: the page was asking for a picture nobody had
 * rendered yet, and had no way to tell that from one that had failed.
 */
/**
 * A small JPEG of one render, cut once and kept beside it.
 *
 * Asynchronous on purpose: sips takes a moment, and doing it with spawnSync
 * blocked the whole server for the duration — a gallery asking for seventeen
 * thumbnails got them strictly one at a time behind a stalled event loop, which
 * looked exactly like the images being broken.
 */
const thumbnailsInFlight = new Map();

/**
 * A small JPEG of `source`, cut once with sips and kept at `thumb`.
 *
 * Keyed by the destination path so renders and scenes share the machinery
 * without sharing a namespace. Without sips the caller serves the original and
 * the page is merely slow rather than broken.
 */
function cutThumbnail(source, thumb) {
  if (fs.existsSync(thumb)) return Promise.resolve(thumb);
  if (!fs.existsSync(source)) return Promise.resolve(null);
  if (thumbnailsInFlight.has(thumb)) return thumbnailsInFlight.get(thumb);

  const cutting = new Promise((resolve) => {
    const child = spawn("sips", ["-s", "format", "jpeg", "-Z", "480", source, "--out", thumb],
      { stdio: "ignore" });
    child.on("close", (code) => {
      thumbnailsInFlight.delete(thumb);
      if (code === 0 && fs.existsSync(thumb)) resolve(thumb);
      else {
        console.warn(`no thumbnail for ${path.basename(source)} (sips exit ${code})`);
        resolve(null);
      }
    });
    child.on("error", () => {
      thumbnailsInFlight.delete(thumb);
      resolve(null);
    });
  });
  thumbnailsInFlight.set(thumb, cutting);
  return cutting;
}

function thumbnailFor(id) {
  const dir = path.join(PIPELINE, "generated/scenes/design-lab");
  return cutThumbnail(path.join(dir, `${id}.blender-render.png`), path.join(dir, `${id}.thumb.jpg`));
}

function renderedIds() {
  const dir = path.join(PIPELINE, "generated/scenes/design-lab");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".blender-render.png"))
    .map((name) => name.replace(".blender-render.png", ""));
}

function renderQueueState() {
  return {
    paused: renders.paused,
    running: renders.running ? renders.running.id : null,
    waiting: renders.waiting.map((job) => job.id),
    done: renders.done,
    failed: renders.failed,
    rendered: renderedIds(),
    pipeline: fs.existsSync(PIPELINE)
  };
}

/**
 * Write what the pipeline reads, and queue the job.
 *
 * The three files are exactly what scripts/export-shots.mjs writes, and for the
 * same reason: the design is a /builder export the renderer takes unchanged,
 * and the camera and the figure are the ones the shot was previewed through
 * rather than anything derived a second time here.
 */
function enqueueRender(shot) {
  if (!shot || !shot.id || !shot.design || !shot.cameraMm) throw new Error("a render needs an id, a design and a camera");
  if (renders.waiting.some((job) => job.id === shot.id) || (renders.running && renders.running.id === shot.id)) {
    return { ok: true, already: true, state: renderQueueState() };
  }
  fs.mkdirSync(RENDER_DIR, { recursive: true });

  // The shot's colour, not the design's: the preview showed one finish and a
  // render in another is a different picture.
  const design = Object.assign({}, shot.design, { finish: shot.finish || shot.design.finish });
  fs.writeFileSync(path.join(RENDER_DIR, `${shot.id}.builder.json`), JSON.stringify(design, null, 1));

  const camera = shot.cameraMm;
  fs.writeFileSync(path.join(RENDER_DIR, `${shot.id}.camera.json`), JSON.stringify({
    coordinateSystem: "rhino-mm",
    frame: "walking-person",
    type: camera.type,
    position: camera.positionMm.map((value) => value * MM_TO_M),
    target: camera.targetMm.map((value) => value * MM_TO_M),
    near: Math.max(0.01, (camera.nearMm || 50) * MM_TO_M),
    far: (camera.farMm || 20000) * MM_TO_M,
    fovDeg: camera.fovDeg || 38
  }, null, 1) + "\n");

  fs.writeFileSync(path.join(RENDER_DIR, `${shot.id}.scale-figure.json`), JSON.stringify({
    mode: "manual",
    placement: "manual",
    heightMm: shot.scaleFigureMm ? shot.scaleFigureMm.heightMm : 1800,
    positionMm: shot.scaleFigureMm ? shot.scaleFigureMm.positionMm : [0, 0, 0],
    opacity: 1.0
  }, null, 1) + "\n");

  renders.waiting.push({ id: shot.id, code: shot.code, queuedAt: Date.now() });
  pumpRenders();
  return { ok: true, state: renderQueueState() };
}

function pumpRenders() {
  if (renders.running || renders.paused || !renders.waiting.length) return;
  if (!fs.existsSync(PIPELINE)) return;
  const job = renders.waiting.shift();
  renders.running = job;
  job.startedAt = Date.now();

  const relative = path.relative(PIPELINE, RENDER_DIR);
  const child = spawn("python3", [
    "scripts/render/render-config.py",
    path.join(relative, `${job.id}.builder.json`),
    "--out-dir", "generated/scenes/design-lab",
    "--output-name", job.id,
    "--camera-json", path.join(relative, `${job.id}.camera.json`),
    "--scale-figure-json", path.join(relative, `${job.id}.scale-figure.json`),
    // Only "viewport" honours a camera JSON. Every other view is a preset that
    // frames from the design's bounding box and ignores the camera entirely.
    "--view", "viewport",
    "--width", "1800", "--height", "1800", "--samples", "96"
  ], { cwd: PIPELINE, stdio: ["ignore", "ignore", "pipe"] });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 2000); });
  child.on("close", (code) => {
    const seconds = Math.round((Date.now() - job.startedAt) / 1000);
    if (code === 0) {
      renders.done.push({ id: job.id, code: job.code, seconds });
      console.log(`rendered ${job.id} in ${seconds}s`);
      // Cut the gallery thumbnail now, so browsing never waits on sips.
      thumbnailFor(job.id);
    } else {
      renders.failed.push({ id: job.id, code: job.code, error: stderr.slice(-400) || `exit ${code}` });
      console.error(`render failed ${job.id}: exit ${code}`);
    }
    renders.running = null;
    pumpRenders();
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);

  if (PROXIED.has(url.pathname)) {
    await proxyToSite(request, response, url);
    return;
  }

  /*
   * Frame capture for the assembly story bench.
   *
   * POST a data: URL, get a file under data/assembly-frames/. It exists because
   * a WebGL canvas cannot be screenshotted from outside the page -- the context
   * is created without preserveDrawingBuffer, so its pixels are gone by the time
   * anything else looks. The page reads them back itself with renderer.snapshot()
   * and posts them here, which is also exactly what the still tier does, so
   * capturing a frame exercises the fallback path rather than a copy of it.
   *
   * Dev only: scripts/ is 404'd on the site and this server never runs there.
   */
  if (url.pathname === "/api/assembly-frame" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const match = /^data:image\/(png|webp|jpeg);base64,(.+)$/s.exec(body.trim());
    if (!match) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "expected a data: URL body" }));
      return;
    }
    const name = (url.searchParams.get("name") || "frame").replace(/[^a-zA-Z0-9_.-]/g, "");
    const dir = path.join(ROOT, "data", "assembly-frames");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.${match[1]}`);
    fs.writeFileSync(file, Buffer.from(match[2], "base64"));
    console.log(`wrote ${path.relative(ROOT, file)} (${Math.round(match[2].length * 0.75 / 1024)}KB)`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, file: path.relative(ROOT, file) }));
    return;
  }

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

  /*
   * The design lab's verdicts. Local only, and deliberately so: the lab is a
   * bench tool, the corpus it reviews is a generated file rather than anything
   * a customer can reach, and the verdicts are the one part of it worth not
   * losing. Netlify has no counterpart — nothing here is deployed.
   *
   * Append-only, one JSON object per line, and each line carries the design it
   * judges. Both of those are scar tissue. A verdict keyed only by a
   * fingerprint is a label with no subject the moment its corpus is
   * regenerated, and regenerating the corpus is the most ordinary thing anyone
   * does here; a whole-file rewrite per keystroke means the file that holds an
   * afternoon's work is rewritten a thousand times. A later line wins over an
   * earlier one for the same design, so an edit is an append too.
   */
  /*
   * The render queue.
   *
   * Blender is a heavyweight local process, so the browser cannot start one:
   * the dev server runs them, one at a time, and the page asks it what is
   * happening. One at a time because a render already saturates the machine —
   * two in parallel is the same throughput with twice the memory and no
   * progress to show for either.
   *
   * Local only, like everything else in the lab. Nothing here is deployed, and
   * an endpoint that shells out to a renderer has no business anywhere else.
   */
  if (url.pathname === "/api/design-lab/render") {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(renderQueueState()));
      return;
    }
    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      try {
        const shot = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        const queued = enqueueRender(shot);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(queued));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: String(error.message) }));
      }
      return;
    }
  }

  if (url.pathname === "/api/design-lab/render/pause" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let wanted = {};
    try { wanted = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { /* below */ }
    renders.paused = wanted.paused === true;
    if (!renders.paused) pumpRenders();
    console.log(`renders ${renders.paused ? "paused" : "resumed"}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(renderQueueState()));
    return;
  }

  /*
   * The finished pictures live in the pipeline's tree, not this one.
   *
   * `&thumb=1` gets a small JPEG instead of the render. A gallery of a hundred
   * shots asking for the real thing is 300MB of 1800px PNG, which the browser
   * spends a minute not decoding — the pictures were there all along, just
   * still on their way. Thumbnails are cut once with sips and kept beside the
   * render; without sips the full image is served and the page is merely slow
   * rather than broken.
   */
  if (url.pathname === "/api/design-lab/render/image") {
    const id = (url.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
    const dir = path.join(PIPELINE, "generated/scenes/design-lab");
    const png = path.join(dir, `${id}.blender-render.png`);
    if (!id || !fs.existsSync(png)) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("no render");
      return;
    }
    if (url.searchParams.get("thumb")) {
      const thumb = await thumbnailFor(id);
      if (thumb) {
        response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
        response.end(fs.readFileSync(thumb));
        return;
      }
    }
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    response.end(fs.readFileSync(png));
    return;
  }

  /*
   * Grow more shelves, on demand.
   *
   * A corpus runs out — that is what working through one means — and a page
   * that answers "everything has been judged" and stops is a dead end with a
   * generator sitting one directory away. The seed is the clock so a fresh run
   * is genuinely fresh, and designs already judged are skipped by identity
   * anyway, so an overlap costs nothing but a moment.
   */
  if (url.pathname === "/api/design-lab/generate" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let wanted = {};
    try { wanted = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { /* defaults */ }
    const count = Math.max(1, Math.min(400, Math.round(Number(wanted.count) || 60)));
    const seed = Math.round(Number(wanted.seed) || (Date.now() % 100000));
    const out = "data/design-lab/corpus.json";

    console.log(`generating ${count} designs at seed ${seed}…`);
    const child = spawn(process.execPath, [
      path.join(ROOT, "scripts/generate-designs.mjs"),
      "--count", String(count), "--seed", String(seed), "--out", out
    ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

    let noise = "";
    child.stdout.on("data", (chunk) => { noise += chunk.toString(); });
    child.stderr.on("data", (chunk) => { noise += chunk.toString(); });
    const code = await new Promise((resolve) => child.on("close", resolve));
    if (code !== 0) {
      console.error(`generate failed: ${noise.slice(-400)}`);
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: noise.slice(-400) || `exit ${code}` }));
      return;
    }
    console.log(noise.trim().split("\n").slice(-1)[0]);
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true, seed, count, out: `/${out}` }));
    return;
  }

  /*
   * Plan the angles for one design, on demand.
   *
   * The studio flow reaches a design, you say yes, and its four angles have to
   * exist a moment later. Planned here rather than in the page so there is one
   * implementation of where a camera goes — the same one scripts/plan-shots.mjs
   * uses for a whole corpus.
   */
  if (url.pathname === "/api/design-lab/plan" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const { loadCatalog } = await import("./lib/design-lab.mjs");
      const { planShotsFor } = await import("./lib/shot-plan.mjs");
      const shots = planShotsFor(loadCatalog(), body, { angles: body.angles || 4 });
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, shots }));
    } catch (error) {
      console.error("plan failed:", error.message);
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: String(error.message) }));
    }
    return;
  }

  /*
   * A pasted design code, back into a shelf.
   *
   * The studio's "edit this shelf" is a round trip through /builder — open the
   * shelf, move a piece, copy the address back — and what comes back is a
   * builder link. Decoded here rather than in the page for the same reason the
   * angles are planned here: /builder's own link format has one reader on this
   * side of the fence (scripts/lib/design-lab.mjs) and a second one written out
   * in a bench page would diverge from it quietly.
   *
   * What is returned is a corpus record, not a design: the studio writes it
   * straight into the review record, so it has to carry everything a generated
   * shelf carries or the row it replaces would be richer than its replacement.
   */
  if (url.pathname === "/api/design-lab/decode" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const lab = await import("./lib/design-lab.mjs");
      const crypto = await import("node:crypto");
      const catalog = lab.loadCatalog();
      const state = lab.decodeShareHash(catalog, body.code);

      /*
       * A shelf pasted in by hand has not been through the generator's rules,
       * so it is checked here — and reported rather than refused. The bench is
       * where somebody deliberately tries the thing the rules forbid; being
       * told which rule it breaks is the useful answer, being stopped is not.
       */
      const validation = lab.engine.validateState(catalog, state);
      const price = lab.priceOf(catalog, state);
      const key = lab.canonicalKey(catalog, state);
      const record = {
        code: lab.engine.designCode(state),
        motifs: null,
        fingerprint: crypto.createHash("sha1").update(key).digest("hex").slice(0, 16),
        shareHash: lab.shareHash(state),
        url: lab.builderUrl(state),
        sizeMm: lab.dimensions(catalog, state),
        shelfSizeMm: lab.shelfDimensions(catalog, state),
        pieceCount: state.instances.length,
        moduleCounts: lab.moduleCounts(state),
        totalKsh: price.totalKsh,
        unpricedPieces: price.unpricedPieces,
        design: lab.engine.serializeState(state)
      };
      console.log(`decoded ${record.code} (${record.pieceCount} pieces)`);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({
        ok: true,
        design: record,
        warnings: validation && validation.reasons ? validation.reasons : []
      }));
    } catch (error) {
      console.error("decode failed:", error.message);
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: String(error.message) }));
    }
    return;
  }

  /*
   * The generated scene images.
   *
   * Kept as files with the record naming them, not as data URLs inside it. A
   * scene is a megabyte of JPEG and the record is appended to on every verdict;
   * inlining them would have the whole gallery rewritten each time somebody
   * pressed a key.
   */
  if (url.pathname === "/api/design-lab/scene-image") {
    const dir = path.join(ROOT, "data/design-lab/scenes");
    if (request.method === "GET") {
      const id = (url.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
      const file = path.join(dir, `${id}.jpg`);
      if (!id || !fs.existsSync(file)) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("no scene");
        return;
      }
      /*
       * `&thumb=1`, for the same reason the renders have one: a scene is a
       * 2400px JPEG near three megabytes, and a strip of a dozen of them under
       * one picture is thirty megabytes the browser spends a minute not
       * decoding — which looks exactly like the pictures being broken.
       */
      if (url.searchParams.get("thumb")) {
        const thumb = await cutThumbnail(file, path.join(dir, `${id}.thumb.jpg`));
        if (thumb) {
          response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
          response.end(fs.readFileSync(thumb));
          return;
        }
      }
      response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
      response.end(fs.readFileSync(file));
      return;
    }
    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        const id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "");
        const match = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(body.dataUrl || "");
        if (!id || !match) throw new Error("a scene image needs an id and a data URL");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}.jpg`), Buffer.from(match[2], "base64"));
        console.log(`saved scene ${id}`);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, id }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: String(error.message) }));
      }
      return;
    }
  }

  // Three records, the same shape: what was judged of the designs, of the
  // camera angles planned for them, and of the scenes they were put into.
  const labStore = /^\/api\/design-lab\/(verdicts|shots|scenes)$/.exec(url.pathname);
  if (labStore) {
    const file = path.join(ROOT, `data/design-lab/${labStore[1]}.jsonl`);

    if (request.method === "GET") {
      const verdicts = {};
      if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            const key = row.fingerprint || row.id;
          if (key) verdicts[key] = row;
          } catch { /* a half-written last line; the rest still counts */ }
        }
      }
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(verdicts));
      return;
    }

    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      try {
        const row = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        // A design is keyed by its identity, a shot by its own id. Demanding a
        // fingerprint of both rejected every shot verdict with a 400 that the
        // page did not look at, so an afternoon of choosing angles went nowhere.
        if (!row.fingerprint && !row.id) throw new Error("a verdict needs a fingerprint or an id");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(row) + "\n");
        console.log(`POST ${url.pathname} -> ${row.code} ${row.verdict || "(note)"}`);
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: String(error.message) }));
      }
      return;
    }
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

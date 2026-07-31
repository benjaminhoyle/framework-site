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

// --- routing ---------------------------------------------------------------

// Matches the rewrites in netlify.toml. Kept in step with them by hand; there is
// no toml parser here and this is the only pair that matters for the builder.
const REWRITES = [
  [/^\/builder(\/[0-9A-Za-z]{0,7})?\/?$/, "/builder.html"],
  [/^\/new-designer(\/[0-9A-Za-z]{0,7})?\/?$/, "/builder.html"] // the old address
];

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);

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

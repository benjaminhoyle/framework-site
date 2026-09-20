#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_PATHS = new Set([
  "/designer", "/designer.html",
  "/simplified-designer", "/simplified-designer.html",
  "/diy", "/diy.html",
  "/sandbox", "/sandbox.html"
]);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function htmlFiles(directory = ROOT) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "data"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...htmlFiles(target));
    else if (entry.name.endsWith(".html")) files.push(target);
  }
  return files;
}

for (const file of htmlFiles()) {
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    if (!match[1] || match[1].startsWith("#")) continue;
    let url;
    try {
      url = new URL(match[1], `https://framework.co.ke/${path.relative(ROOT, file)}`);
    } catch {
      continue;
    }
    if (url.hostname === "framework.co.ke" || url.hostname === "www.framework.co.ke") {
      assert.equal(
        LEGACY_PATHS.has(url.pathname),
        false,
        `${path.relative(ROOT, file)} still links to retired ${url.pathname}`
      );
    }
  }
}

const redirects = read("netlify.toml").split("[[redirects]]").slice(1);

/*
 * Retired on 2026-09-20. These were rewrites to a compatibility page that read
 * its own hash, because a URL fragment never reaches Netlify and the old
 * designer kept the whole design in one. The four links that existed in the
 * order history were converted to /builder codes and written back, so there is
 * nothing left for a page to read -- and a page that no longer exists cannot be
 * rewritten to. The assertion is inverted rather than deleted: a rewrite
 * quietly reinstated against a missing file serves a 404 to an address people
 * still have.
 */
const retiredEntries = ["designer", "simplified-designer", "sandbox"];
for (const entry of retiredEntries) {
  assert.equal(
    fs.existsSync(path.join(ROOT, `${entry}.html`)),
    false,
    `${entry}.html: retired, and a rewrite target that exists again would shadow the redirect`
  );
  /*
   * Both spellings. While the page existed, /entry.html resolved to the file on
   * its own and only the extensionless form needed a rule -- so deleting the
   * file leaves the .html address 404ing with nothing to say it should not.
   * That spelling is the one older catalogue data carries, because
   * import-shelving-product and catalog-package both rewrite "/designer#" to
   * "designer.html#", and it is what Google has had years to index.
   */
  for (const from of [`/${entry}`, `/${entry}.html`]) {
    const block = redirects.find((part) => part.includes(`from = "${from}"`));
    assert.ok(block, `${from}: retired, but it still needs a redirect for links already out there`);
    assert.ok(block.includes('to = "/builder"'), `${from}: should send people to /builder`);
    assert.match(block, /status\s*=\s*301/, `${from}: should be a redirect, not a rewrite -- the address must correct itself`);
  }
}

// /diy is not retired: it is a live entry point that opens Simple.
const diy = redirects.find((part) => part.includes('from = "/diy"'));
assert.ok(diy, "/diy: extensionless rewrite missing");
assert.ok(diy.includes('to = "/diy.html"'), "/diy: should serve its page");
assert.match(diy, /status\s*=\s*200/, "/diy: should stay a rewrite");
const diyHtml = read("diy.html");
assert.match(diyHtml, /if\s*\(\s*!location\.hash\s*\)/, "diy.html: redirect must only run without a code");
assert.ok(
  diyHtml.includes("location.replace('/builder.html?mode=simple')"),
  "diy.html: code-free entry should open simple mode"
);

const catalog = JSON.parse(read("catalog.json"));
for (const product of catalog.products.filter((entry) => entry.active !== false && entry.designerUrl)) {
  const url = new URL(product.designerUrl, "https://framework.co.ke/");
  assert.ok(
    url.pathname === "/builder.html" || url.pathname.startsWith("/builder/"),
    `${product.id}: designerUrl should use the consolidated builder`
  );
}

const sitemap = read("sitemap.xml");
assert.match(sitemap, /https:\/\/www\.framework\.co\.ke\/builder\.html/);
for (const legacy of LEGACY_PATHS) assert.equal(sitemap.includes(`framework.co.ke${legacy}`), false);

console.log("builder entry link tests passed (modes, compatibility redirects, public links, sitemap)");

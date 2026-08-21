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
const legacyEntries = new Map([
  ["designer", "flexible"],
  ["simplified-designer", "simple"],
  ["diy", "simple"],
  ["sandbox", "advanced"]
]);
for (const [entry, mode] of legacyEntries) {
  const block = redirects.find((part) => part.includes(`from = "/${entry}"`));
  assert.ok(block, `/${entry}: extensionless rewrite missing`);
  assert.ok(block.includes(`to = "/${entry}.html"`), `/${entry}: should serve its compatibility page`);
  assert.match(block, /status\s*=\s*200/, `/${entry}: should preserve the hash for the page to inspect`);

  const html = read(`${entry}.html`);
  assert.match(html, /if\s*\(\s*!location\.hash\s*\)/, `${entry}.html: redirect must only run without a code`);
  assert.ok(
    html.includes(`location.replace('/builder.html?mode=${mode}')`),
    `${entry}.html: code-free entry should open ${mode} mode`
  );
}

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

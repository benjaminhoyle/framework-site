#!/usr/bin/env node
/**
 * Bump the /builder asset version.
 *
 *   node scripts/bump-builder-version.mjs
 *
 * The page loads its scripts, stylesheet, catalogue and geometry all on one
 * `?v=N`, because app code paired with a stale catalogue silently loses whatever
 * the catalogue gained -- exactly what a CDN or browser cache hands you a few
 * minutes after a deploy. Run this after changing any of them.
 *
 * It exists because doing it by hand is a footgun: a blind search-and-replace
 * for the old number also rewrote two SVG path commands that happened to
 * contain it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "builder.html");
const source = fs.readFileSync(PAGE, "utf8");

const declaration = /(window\.frameworkDesignerVersion = ')(\d+)(')/;
const found = source.match(declaration);
if (!found) throw new Error("could not find window.frameworkDesignerVersion in builder.html");
const next = String(Number(found[2]) + 1);

// Only ever touch the declaration and the ?v= query strings -- never bare
// numbers elsewhere in the document.
const updated = source
  .replace(declaration, `$1${next}$3`)
  .replace(/(\?v=)\d+/g, `$1${next}`);

fs.writeFileSync(PAGE, updated);

/*
 * The same number wherever else module geometry is asked for. The scroll
 * stories (/how, /customize, /assembly) load bundles through
 * js/assembly/scroll-story.js, and /how and /assembly preload them. The bundles
 * are cached for a week, so an unversioned request can be answered with last
 * week's geometry, and a preload only helps if its URL is the one the story
 * then fetches.
 */
const ROOT = path.dirname(PAGE);
const STORY = path.join(ROOT, "js", "assembly", "scroll-story.js");
const storySource = fs.readFileSync(STORY, "utf8");
const storyVersion = /(var GEOMETRY_VERSION = ')(\d+)(')/;
if (!storyVersion.test(storySource)) throw new Error("could not find GEOMETRY_VERSION in js/assembly/scroll-story.js");
fs.writeFileSync(STORY, storySource.replace(storyVersion, `$1${next}$3`));
for (const file of ["how.html", "assembly-lab.html"]) {
  const target = path.join(ROOT, file);
  const html = fs.readFileSync(target, "utf8");
  fs.writeFileSync(target, html.replace(/(\/assets\/shelving\/modules\/[a-z0-9_]+\.json)(\?v=\d+)?/g, `$1?v=${next}`));
}

console.log(`/builder assets are now v${next}`);

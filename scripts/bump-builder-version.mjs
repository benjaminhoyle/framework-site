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
console.log(`/builder assets are now v${next}`);

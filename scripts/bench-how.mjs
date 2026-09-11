#!/usr/bin/env node
/**
 * Look at /how: frames across the whole story at a given width and tier.
 *
 *   node scripts/bench-how.mjs --width 1280 --height 800 --tier full --out <dir>
 *   node scripts/bench-how.mjs --width 390 --height 844 --reduced-motion
 *
 * Dev only. Drives the page in Chrome through playwright-core from the
 * sibling framework-ops checkout, seeks the story to each point with the
 * bench handle the page exposes, and screenshots the viewport. Also reports
 * horizontal overflow, which tier ran, and the caption band on a phone.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/Users/ben/code/framework/framework-ops/node_modules/playwright-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const width = Number(opt("width", 1280));
const height = Number(opt("height", 800));
const tier = opt("tier", "");
const reduced = args.includes("--reduced-motion");
const out = opt("out", `/private/tmp/claude-501/-Users-ben-code-framework/2f7f03bb-0df8-4fb5-9ba2-f7b9cc40151c/scratchpad/frames-${width}${reduced ? "-rm" : ""}${tier ? "-" + tier : ""}`);
const url = `http://127.0.0.1:8770/how.html${tier ? `?tier=${tier}` : ""}`;
const points = (opt("points", "0,0.06,0.12,0.16,0.20,0.25,0.30,0.35,0.40,0.45,0.50,0.525,0.55,0.60,0.65,0.70,0.75,0.80,0.83,0.86,0.90,0.95,1"))
  .split(",").map(Number);

fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700, reducedMotion: reduced ? "reduce" : "no-preference" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.FrameworkAssembly && window.FrameworkAssembly.debug, null, { timeout: 15000 });
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const d = window.FrameworkAssembly.debug;
  const stage = document.getElementById("assembly-stage");
  return {
    tier: d.tier, why: d.why, keys: d.keys, modules: d.modules,
    band: stage ? getComputedStyle(stage).getPropertyValue("--fa-caption-band").trim() : null,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    trackHeight: document.getElementById("assembly-track")?.offsetHeight, viewport: window.innerHeight
  };
});
console.log(JSON.stringify(info));

// The first screen, before any scroll.
await page.screenshot({ path: path.join(out, "first-screen.png") });

const live = info.tier === "full" || info.tier === "lite" || info.tier === "calm";
if (live) {
  for (const p of points) {
    await page.evaluate((p) => window.FrameworkAssembly.debug.seek(p), p);
    await page.waitForTimeout(160);
    const at = await page.evaluate(() => window.FrameworkAssembly.debug.at().toFixed(3));
    await page.screenshot({ path: path.join(out, `p-${String(p).padEnd(5, "0").replace(".", "_")}.png`) });
    process.stdout.write(`${p}->${at} `);
  }
  console.log();
}

// The close: scroll to the shelf, then to the foot of the page.
await page.evaluate(() => document.getElementById("how-close").scrollIntoView());
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, "close.png") });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, "foot.png") });
if (!live) await page.screenshot({ path: path.join(out, "full-page.png"), fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const wa = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="wa.me"]')).map((a) => a.getAttribute("href")));
console.log(JSON.stringify({ overflow, errors, whatsappLinks: wa.length, allTyped: wa.every((h) => /[?&]text=/.test(h)), out }));
await browser.close();

#!/usr/bin/env node
/**
 * Frames of landing A across the whole story, at a desktop and a phone width.
 *
 *   node scripts/bench-landing-a.mjs <out-dir> [--tier full|calm] [--url ...]
 *
 * Drives the dev server's /how-a.html with Playwright (playwright-core from the
 * sibling framework-ops checkout, Chrome from /Applications), seeks the story
 * to a list of progress points through the page's own bench handle, and
 * writes a screenshot of each. A WebGL canvas without preserveDrawingBuffer
 * cannot be screenshotted from outside the page, so each frame is read back
 * with renderer.snapshot(), the same path the still tier uses, and laid over
 * the canvas for the screenshot; captions and pins are DOM and come for free.
 *
 * Also writes <out-dir>/<width>-<tier>-sheet.png, every frame on one contact
 * sheet, and prints the layout facts worth checking: horizontal overflow, the
 * caption band, the canvas size, the track length in screens.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/Users/ben/code/framework/framework-ops/node_modules/playwright-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = process.argv.slice(2);
const out = path.resolve(args[0] || "data/assembly-frames/landing-a");
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const tier = flag("--tier", "full");
const base = flag("--url", "http://127.0.0.1:8770/how-a.html");
const reduced = args.includes("--reduced-motion");
const POINTS = [0, 0.05, 0.12, 0.19, 0.26, 0.33, 0.4, 0.46, 0.5, 0.54, 0.58, 0.62, 0.66, 0.7, 0.76, 0.81, 0.86, 0.92, 1];
const SIZES = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];

fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--enable-unsafe-swiftshader"] });
const facts = [];
const sheets = [];
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const url = `${base}${base.includes("?") ? "&" : "?"}${reduced ? "" : `tier=${tier}`}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.FrameworkAssembly && window.FrameworkAssembly.debug, null, { timeout: 20000 });
  await page.waitForTimeout(400);

  const label = `${size.width}-${reduced ? "reduced" : tier}`;
  const first = path.join(out, `${label}-first-screen.png`);
  await page.screenshot({ path: first });
  const frames = [first];

  const info = await page.evaluate(() => {
    const d = window.FrameworkAssembly.debug;
    const stage = document.getElementById("assembly-stage");
    const canvas = document.getElementById("assembly-canvas");
    const track = document.getElementById("assembly-track");
    return {
      tier: d.tier, why: d.why,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      band: stage && getComputedStyle(stage).getPropertyValue("--fa-caption-band").trim(),
      canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      trackScreens: track ? (track.offsetHeight / window.innerHeight).toFixed(2) : null,
      stageTop: stage ? Math.round(stage.getBoundingClientRect().top) : null,
      live: typeof d.seek === "function"
    };
  });
  facts.push({ label, ...info });

  if (info.live) {
    for (const p of POINTS) {
      await page.evaluate((p) => window.FrameworkAssembly.debug.seek(p), p);
      await page.waitForTimeout(120);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => {
        const d = window.FrameworkAssembly.debug;
        const canvas = document.getElementById("assembly-canvas");
        const moment = d.moment();
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const shot = d.renderer.snapshot({ width: w, height: h, boundsMm: moment.focus, padding: moment.padding });
        const paper = document.createElement("canvas");
        paper.width = shot.width;
        paper.height = shot.height;
        const ctx = paper.getContext("2d");
        const image = ctx.createImageData(shot.width, shot.height);
        const rowBytes = shot.width * 4;
        for (let row = 0; row < shot.height; row += 1) {
          const from = (shot.height - 1 - row) * rowBytes;
          image.data.set(shot.pixels.subarray(from, from + rowBytes), row * rowBytes);
        }
        ctx.putImageData(image, 0, 0);
        let img = document.getElementById("bench-frame");
        if (!img) {
          img = document.createElement("img");
          img.id = "bench-frame";
          img.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
          canvas.parentNode.insertBefore(img, canvas.nextSibling);
        }
        img.width = w;
        img.height = h;
        img.src = paper.toDataURL("image/png");
      });
      await page.waitForTimeout(60);
      const file = path.join(out, `${label}-${String(Math.round(p * 100)).padStart(3, "0")}.png`);
      await page.screenshot({ path: file });
      frames.push(file);
      await page.evaluate(() => { const img = document.getElementById("bench-frame"); if (img) img.remove(); });
    }
    // The close, scrolled into view.
    await page.evaluate(() => document.getElementById("ask").scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);
    const close = path.join(out, `${label}-close.png`);
    await page.screenshot({ path: close });
    frames.push(close);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    const foot = path.join(out, `${label}-foot.png`);
    await page.screenshot({ path: foot });
    frames.push(foot);
  } else {
    const full = path.join(out, `${label}-full-page.png`);
    await page.screenshot({ path: full, fullPage: true });
    frames.push(full);
  }
  facts[facts.length - 1].errors = errors;

  // A contact sheet of the frames, built in a page of its own.
  const sheetPage = await context.newPage();
  const cols = size.width > 600 ? 3 : 6;
  const cell = Math.floor(1800 / cols);
  const html = `<body style="margin:0;background:#ddd;font:12px system-ui">${frames.map((f) => {
    const data = fs.readFileSync(f).toString("base64");
    return `<div style="display:inline-block;width:${cell}px;vertical-align:top;margin:4px;background:#fff"><div style="padding:2px 4px">${path.basename(f)}</div><img src="data:image/png;base64,${data}" style="width:100%;display:block"></div>`;
  }).join("")}</body>`;
  await sheetPage.setViewportSize({ width: 1840, height: 1000 });
  await sheetPage.setContent(html);
  const sheet = path.join(out, `${label}-sheet.png`);
  await sheetPage.screenshot({ path: sheet, fullPage: true });
  sheets.push(sheet);
  await context.close();
}
await browser.close();

for (const f of facts) console.log(JSON.stringify(f));
console.log(`sheets: ${sheets.join(" ")}`);

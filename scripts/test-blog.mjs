#!/usr/bin/env node
/**
 * Guards on scripts/publish-blog.mjs.
 *
 *   node scripts/test-blog.mjs
 *
 * Publishes a fixture draft into a temporary copy of the site's blog files and
 * checks what came out: the page, the index order, the sitemap, the second
 * publish of the same slug. Then drives every refusal, because the refusals
 * are the point: they are what stands between a draft and a live post that
 * reads as if nobody here wrote it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publish, parseDraft, checkDraft, markdownToHtml, DO_NOT_WRITE, MODULAR_SENTENCE } from "./publish-blog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "publish-blog.mjs");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

// A bare site root: the template, an index with markers, a sitemap, site.js
// for the phone number, and one image on disk.
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fwk-blog-"));
  fs.mkdirSync(path.join(root, "blog"));
  fs.mkdirSync(path.join(root, "js"));
  fs.mkdirSync(path.join(root, "images", "test"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "blog", "template.html"), path.join(root, "blog", "template.html"));
  fs.copyFileSync(path.join(ROOT, "blog.html"), path.join(root, "blog.html"));
  fs.copyFileSync(path.join(ROOT, "js", "site.js"), path.join(root, "js", "site.js"));
  fs.writeFileSync(path.join(root, "images", "test", "hero.jpg"), "");
  fs.writeFileSync(path.join(root, "images", "test", "body.jpg"), "");
  fs.writeFileSync(path.join(root, "sitemap.xml"), [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `  <url>`,
    `    <loc>https://www.framework.co.ke/blog.html</loc>`,
    `    <lastmod>2025-04-02</lastmod>`,
    `    <changefreq>weekly</changefreq>`,
    `    <priority>0.7</priority>`,
    `  </url>`,
    `</urlset>`,
    ``,
  ].join("\n"));
  return root;
}

const para = (n) => Array.from({ length: n }, (_, i) => `Sentence ${i + 1} of the paragraph about a shelf in Kilimani.`).join(" ");

function goodDraft(overrides = {}) {
  const head = {
    first: "query: setting up an apartment in Nairobi | segment: expat settling in",
    date: "2026-09-09",
    description: "A draft that passes every check, for the test.",
    image: "/images/test/hero.jpg",
    "image-alt": "A test hero.",
    "image-caption": "The Starter in Sage. As shown, Ksh 6,500/-.",
    whatsapp: "I'd like shelving for a rented apartment.",
    ...overrides,
  };
  const { first, body, ...keys } = head;
  return [
    first,
    ...Object.entries(keys).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`),
    "<!-- Ben: the neighbourhood in paragraph two is yours to add -->",
    "",
    "# A shelf for a rented flat & a move",
    "",
    body ?? [
      `${para(4)} ${MODULAR_SENTENCE}`,
      "",
      "## What does a unit cost?",
      "",
      `Units from Ksh 6,500/-. See [how it works](/how) and the **four colours**, or *a mix*.`,
      "",
      "- The Starter, Ksh 6,500/-",
      "- The Low Console, Ksh 12,000/-",
      "",
      "1. Measure the wall.",
      "2. Kindly share the width.",
      "",
      "> One customer asked whether she could start with one and add later.",
      "",
      `![A body image](/images/test/body.jpg "A caption, plainly.")`,
      "",
      "### A smaller heading",
      "",
      ...Array.from({ length: 9 }, () => `${para(5)}\n`),
    ].join("\n"),
    "",
  ].join("\n");
}

function writeDraft(root, name, text) {
  const p = path.join(root, name);
  fs.writeFileSync(p, text);
  return p;
}

const quiet = () => {};

// --- A good draft, published --------------------------------------------------

{
  const root = makeRoot();
  const draft = writeDraft(root, "2026-09-09-a-shelf-for-a-rented-flat.md", goodDraft());
  const { warnings, postPath } = publish({ draftPath: draft, root, today: "2026-09-10", log: quiet });
  const html = fs.readFileSync(postPath, "utf8");
  const flat = html.replace(/^\s+/gm, "");

  ok(postPath.endsWith(path.join("blog", "a-shelf-for-a-rented-flat.html")), "slug comes from the filename minus its date");
  ok(html.includes("<title>A shelf for a rented flat &amp; a move | Framework Designs</title>"), "title is escaped and carries the site name");
  ok(html.includes('<meta name="description" content="A draft that passes every check, for the test.">'), "description meta");
  ok(html.includes('<link rel="canonical" href="https://www.framework.co.ke/blog/a-shelf-for-a-rented-flat.html">'), "canonical");
  ok(html.includes('<meta property="og:title" content="A shelf for a rented flat &amp; a move">'), "og:title");
  ok(html.includes('<meta property="og:image" content="https://www.framework.co.ke/images/test/hero.jpg">'), "og:image is the hero, absolute");
  ok(html.includes('<meta property="og:type" content="article">'), "og:type");
  ok(html.includes('<base href="/">'), "the base element that makes site.js's relative header links resolve under /blog/");
  ok(html.includes('<script src="/js/site.js" defer></script>'), "site.js is loaded, root-absolute, so the header and footer arrive");
  ok(html.includes('<link rel="stylesheet" href="/css/styles.css">'), "styles.css carries the header and footer styles");
  ok(html.includes('<time class="blog-post-date" datetime="2026-09-09">9 September 2026</time>'), "date, day month year");
  ok(html.includes('<figure class="blog-post-hero">') && html.includes('alt="A test hero."'), "hero figure with alt");
  ok(html.includes("<figcaption>The Starter in Sage. As shown, Ksh 6,500/-.</figcaption>"), "hero caption");
  ok(html.includes("<h2>What does a unit cost?</h2>") && html.includes("<h3>A smaller heading</h3>"), "headings");
  ok(html.includes('<a href="/how">how it works</a>') && html.includes("<strong>four colours</strong>") && html.includes("<em>a mix</em>"), "links, bold, italic");
  ok(flat.includes("<ul>\n<li>The Starter, Ksh 6,500/-</li>") && flat.includes("<ol>\n<li>Measure the wall.</li>"), "lists");
  ok(html.includes("<blockquote><p>One customer asked"), "quote");
  ok(html.includes('<figure class="blog-figure">') && html.includes('src="/images/test/body.jpg"') && html.includes("<figcaption>A caption, plainly.</figcaption>"), "body image with caption");
  ok(!html.includes("Ben: the neighbourhood"), "comments never reach the page");
  ok(!html.includes("{{"), "no token left unfilled");

  const wa = /href="(https:\/\/wa\.me\/254783891005\?text=[^"]+)"/.exec(html);
  ok(wa, "the ask is a wa.me link on the site's phone number with ?text=");
  ok(decodeURIComponent(wa[1].split("text=")[1]) === "I'd like shelving for a rented apartment.", "the prefilled message is the draft's whatsapp line");
  ok(html.includes('data-fwk-handoff="blog"') && html.includes("trackContactConversion('', {link_target:'blog_whatsapp'"), "the handoff is tracked like the header's");
  ok(html.includes("Kindly share what the shelf is for, and we&#39;ll") || html.includes("Kindly share what the shelf is for, and we'll"), "the house ask line");
  ok(html.includes('"@type":"BlogPosting"') && html.includes('"datePublished":"2026-09-09"'), "BlogPosting JSON-LD");
  ok(!html.includes("—"), "no em dash in the page");

  const index = fs.readFileSync(path.join(root, "blog.html"), "utf8");
  ok(index.includes('<h2 class="blog-card-title"><a href="/blog/a-shelf-for-a-rented-flat.html">A shelf for a rented flat &amp; a move</a></h2>'), "the card is in the index");
  ok(index.includes("<!-- blog-index:start -->") && index.includes("<!-- blog-index:end -->"), "markers survive");
  ok(!/<script[^>]*blog-loader/.test(index), "the index no longer depends on a script to list posts");

  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  ok(sitemap.includes("<loc>https://www.framework.co.ke/blog/a-shelf-for-a-rented-flat.html</loc>\n    <lastmod>2026-09-09</lastmod>"), "sitemap entry");
  ok(sitemap.includes("<loc>https://www.framework.co.ke/blog.html</loc>\n    <lastmod>2026-09-10</lastmod>"), "the index's lastmod moved to today");
  ok(warnings.length === 0, `a clean draft has no warnings, got: ${warnings.join("; ")}`);

  // A second, older post lands below the newer one; republishing the first
  // neither duplicates its card nor its sitemap entry.
  const older = writeDraft(root, "2026-08-01-an-older-post.md", goodDraft({ date: "2026-08-01", description: "Older." }));
  publish({ draftPath: older, root, log: quiet });
  publish({ draftPath: draft, root, log: quiet });
  const index2 = fs.readFileSync(path.join(root, "blog.html"), "utf8");
  const newerAt = index2.indexOf("a-shelf-for-a-rented-flat.html");
  const olderAt = index2.indexOf("an-older-post.html");
  ok(newerAt >= 0 && olderAt >= 0 && newerAt < olderAt, "newest first");
  ok(index2.split("a-shelf-for-a-rented-flat.html").length === 4, "one card per post after a republish (three hrefs in a card)");
  const sitemap2 = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  ok(sitemap2.split("/blog/a-shelf-for-a-rented-flat.html</loc>").length === 2, "one sitemap entry per post after a republish");
  ok(sitemap2.includes("/blog/an-older-post.html</loc>"), "the second post is in the sitemap too");

  // Without a hero: no figure, og:image falls back, nothing dangling.
  const bare = writeDraft(root, "2026-09-02-no-hero.md", goodDraft({ image: undefined, "image-alt": undefined, "image-caption": undefined, whatsapp: undefined }));
  const { postPath: barePath } = publish({ draftPath: bare, root, log: quiet });
  const bareHtml = fs.readFileSync(barePath, "utf8");
  ok(!bareHtml.includes("blog-post-hero"), "no hero figure without an image");
  ok(bareHtml.includes('<meta property="og:image" content="https://www.framework.co.ke/images/'), "og:image falls back to a site image");
  ok(bareHtml.includes("text=Hello%2C%20I'd%20like%20shelving"), "default prefilled message when the draft gives none");

  // Dry run writes nothing and prints the page.
  const dry = writeDraft(root, "2026-09-03-dry.md", goodDraft());
  const lines = [];
  publish({ draftPath: dry, root, dryRun: true, log: (l) => lines.push(l) });
  ok(!fs.existsSync(path.join(root, "blog", "dry.html")), "dry run does not write the post");
  ok(!fs.readFileSync(path.join(root, "blog.html"), "utf8").includes("dry.html"), "dry run does not touch the index");
  ok(!fs.readFileSync(path.join(root, "sitemap.xml"), "utf8").includes("dry.html"), "dry run does not touch the sitemap");
  ok(lines.some((l) => l.startsWith("would write blog/dry.html")) && lines.some((l) => l.includes('<h1 class="blog-post-title">')), "dry run prints what it would write");

  fs.rmSync(root, { recursive: true, force: true });
}

// --- The refusals --------------------------------------------------------------

function refusalsFor(text, name = "2026-09-09-refused.md") {
  const root = makeRoot();
  const draft = writeDraft(root, name, text);
  let refusals = null;
  try {
    publish({ draftPath: draft, root, log: quiet });
  } catch (error) {
    refusals = error.refusals || [error.message];
  }
  const written = fs.existsSync(path.join(root, "blog", "refused.html"));
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(refusals, `expected a refusal for:\n${text.slice(0, 200)}`);
  assert.ok(!written, "a refused draft must write nothing");
  return refusals.join("\n");
}

const body = goodDraft();
const withLine = (line) => body.replace("## What does a unit cost?", `${line}\n\n## What does a unit cost?`);

ok(/em dash \(line \d+\)/.test(refusalsFor(withLine("Steel frame — Nairobi-made."))), "refuses an em dash in the copy, naming the line");
ok(/em dash \(line \d+\)/.test(refusalsFor(body.replace("<!-- Ben:", "<!-- Ben —"))), "refuses an em dash even inside a comment");
ok(/en dash used as a dash/.test(refusalsFor(withLine("Steel frame – Nairobi-made."))), "refuses a spaced en dash");
ok(/"TCC"/.test(refusalsFor(withLine("ETR invoice and TCC provided."))), "refuses TCC");
ok(/"built to your measurements"/.test(refusalsFor(withLine("Built to your measurements."))), "refuses the measurements line");
ok(/"transform"/.test(refusalsFor(withLine("Watch it transform your living room."))), "refuses transform");
ok(/"seamless"/.test(refusalsFor(withLine("A seamlessly modular shelf."))), "refuses seamless and its inflections");
ok(/"game-changing"/.test(refusalsFor(withLine("A game changing shelf."))), "refuses game changing with or without the hyphen");
ok(/"curated collection"/.test(refusalsFor(withLine("Our curated collection of shelves."))), "refuses curated collection");
ok(/exclamation mark/.test(refusalsFor(withLine("Made in Nairobi!"))), "refuses an exclamation mark");
ok(/editing marker/.test(refusalsFor(withLine("The customer in [Ben: neighbourhood] said so."))), "refuses a [Ben ...] marker left in the copy");
ok(/editing marker/.test(refusalsFor(withLine("TODO add the delivery story."))), "refuses a TODO");
// Built in pieces so scripts/test-whatsapp-links.js, which scans every file
// for a bare wa.me link, does not read this fixture as one.
const bareLink = ["https://wa.me", "254783891005"].join("/");
ok(/bare WhatsApp link/.test(refusalsFor(withLine(`[Message us](${bareLink})`))), "refuses a wa.me link with no ?text=");
ok(/image not on disk: \/images\/test\/missing\.jpg/.test(refusalsFor(withLine("![Missing](/images/test/missing.jpg)"))), "refuses a body image that is not on disk");
ok(/hero image not on disk/.test(refusalsFor(body.replace("image: /images/test/hero.jpg", "image: /images/test/none.jpg"))), "refuses a hero that is not on disk");
ok(/image without image-alt/.test(refusalsFor(body.replace("image-alt: A test hero.\n", ""))), "refuses a hero with no alt text");
ok(/line 1 must read/.test(refusalsFor(body.replace(/^query:.*$/m, "A post about shelves"))), "refuses a draft whose first line is not the query and segment");
ok(/no title/.test(refusalsFor(body.replace("# A shelf for a rented flat & a move", "A shelf for a rented flat"))), "refuses a draft with no title");
ok(/a second single-# heading/.test(refusalsFor(withLine("# Another title"))), "refuses a second # heading");

// Several problems are all named at once, so one run is enough to fix them.
const many = refusalsFor(withLine("Effortless — and seamless!"));
ok(/em dash/.test(many) && /"seamless"/.test(many) && /"effortless"/.test(many) && /exclamation/.test(many), "every refusal is listed, not just the first");

// --- Warnings, not refusals ----------------------------------------------------

{
  const d = parseDraft(withLine(`${MODULAR_SENTENCE} Units from Ksh 6,500 today.`), "2026-09-09-warn.md");
  const { refusals, warnings } = checkDraft(d);
  ok(refusals.length === 0, "warnings alone do not refuse");
  ok(warnings.some((w) => /modular sentence appears 2 times/.test(w)), "warns when the modular sentence appears twice");
  ok(warnings.some((w) => /price without the \/- suffix/.test(w)), "warns on a price without /-");
  const short = parseDraft(goodDraft({ body: `${MODULAR_SENTENCE} Short.` }), "2026-09-09-short.md");
  ok(checkDraft(short).warnings.some((w) => /words; the addendum asks for 500 to 800/.test(w)), "warns on the word count");
}

// --- The phrase list matches VOICE.md, when the file is beside this repo -------

{
  const voice = path.resolve(ROOT, "..", "framework-marketing", "VOICE.md");
  if (fs.existsSync(voice)) {
    const text = fs.readFileSync(voice, "utf8").replace(/\n>\s?/g, " ").replace(/[ \t]+/g, " ");
    const section = /## Do not write([\s\S]*?)\n## /.exec(text);
    ok(section, "VOICE.md still has a Do not write section");
    for (const { phrase } of DO_NOT_WRITE) {
      const needle = phrase === "your measurements" ? "your measurements" : phrase;
      ok(section[1].toLowerCase().includes(needle.toLowerCase()), `"${phrase}" is still on VOICE.md's Do not write list`);
    }
    ok(text.includes(MODULAR_SENTENCE.replace(/\.$/, "")), "the canonical modular sentence still reads as VOICE.md has it");
  } else {
    console.log("  framework-marketing/VOICE.md not beside this repo; phrase-list drift check skipped");
  }
}

// --- The shipped posts and the template -------------------------------------------

{
  const dir = path.join(ROOT, "blog");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(dir, f), "utf8");
    ok(!html.includes("—"), `${f} carries no em dash`);
    ok(html.includes('<base href="/">'), `${f} carries the base element site.js's header links need under /blog/`);
    ok(html.includes("/js/site.js"), `${f} loads site.js`);
    if (f !== "template.html") {
      ok(/<h1 class="blog-post-title">/.test(html) && /<time class="blog-post-date" datetime="\d{4}-\d{2}-\d{2}"/.test(html), `${f} has the title and date the index reads`);
      ok(/<link rel="canonical" href="https:\/\/www\.framework\.co\.ke\/blog\/[a-z0-9-]+\.html">/.test(html), `${f} has a canonical`);
    }
  }
  const index = fs.readFileSync(path.join(ROOT, "blog.html"), "utf8");
  ok(index.includes("<!-- blog-index:start -->"), "blog.html carries the index markers");
  ok(!fs.existsSync(path.join(ROOT, "js", "blog-loader.js")), "js/blog-loader.js is retired; the index is static");
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  for (const loc of sitemap.match(/<loc>https:\/\/www\.framework\.co\.ke\/blog\/[^<]+<\/loc>/g) || []) {
    const file = loc.replace(/<\/?loc>/g, "").replace("https://www.framework.co.ke/", "");
    ok(fs.existsSync(path.join(ROOT, file)), `sitemap entry ${file} exists on disk`);
  }
}

// --- The CLI -----------------------------------------------------------------------

{
  const root = makeRoot();
  const draft = writeDraft(root, "2026-09-09-cli.md", goodDraft());
  const out = execFileSync("node", [SCRIPT, draft, "--dry-run", "--root", root], { encoding: "utf8" });
  ok(out.includes("would write blog/cli.html"), "CLI dry run says what it would write");
  ok(!fs.existsSync(path.join(root, "blog", "cli.html")), "CLI dry run writes nothing");
  const bad = writeDraft(root, "2026-09-09-bad.md", withLine("Seamless — really!"));
  let status = 0; let stderr = "";
  try { execFileSync("node", [SCRIPT, bad, "--root", root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { status = e.status; stderr = String(e.stderr); }
  ok(status === 1 && /em dash/.test(stderr) && /"seamless"/.test(stderr), "CLI exits 1 and names the refusals");
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`blog tests passed (${checks} checks: a fixture published, the index and sitemap, every refusal, the CLI)`);

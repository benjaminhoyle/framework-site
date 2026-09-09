#!/usr/bin/env node
/**
 * Publish a blog draft.
 *
 *   node scripts/publish-blog.mjs <draft.md> [--dry-run] [--root <site dir>]
 *
 * The draft is Markdown in ../framework-marketing/log/blog-drafts/. Its first
 * line names the query and the segment the post serves; the first `# ` heading
 * is the title. Everything else is copy.
 *
 *   query: setting up an apartment in Nairobi | segment: expat settling in
 *   date: 2026-09-09                              (optional; else the filename's date; else today)
 *   description: One or two sentences for search. (optional; else the first paragraph, trimmed)
 *   image: /images/shelving/configs/high-low-populated.jpg   (optional hero)
 *   image-alt: A low sage shelf with a tall unit on one end.  (required with image)
 *   image-caption: The High-Low in Sage. As shown, Ksh 51,000/-.
 *   whatsapp: I'd like shelving for a rented apartment.       (the prefilled first message)
 *   slug: settling-into-a-rented-nairobi-home                 (optional; else the filename minus its date)
 *   <!-- notes for Ben go in comments; they are stripped before anything is checked or rendered -->
 *
 *   # The title
 *
 *   Copy in Markdown: paragraphs, ## and ### headings, - lists, 1. lists,
 *   > quotes, [links](/how), ![alt](/images/x.jpg "caption"), **bold**, *italic*.
 *
 * What it writes: blog/<slug>.html from blog/template.html; the card list in
 * blog.html between the blog-index markers, newest first, rebuilt from every
 * post on disk; and the post's <url> in sitemap.xml. --dry-run prints all
 * three and writes nothing.
 *
 * What it refuses, and says which: an em dash anywhere in the file; "TCC";
 * any phrase from the "Do not write" list in ../framework-marketing/VOICE.md;
 * an exclamation mark; a leftover editing marker (TODO, TBD, [Ben ...],
 * [[...]]); a bare wa.me link; an image that is not on disk; a draft with no
 * first line or no title. It warns, without refusing, on the word count, the
 * canonical modular sentence appearing other than once, a price without the
 * /- suffix, and a paragraph over sixty words.
 *
 * No dependencies: the Markdown a post needs is small, and a converter that
 * handles exactly that is easier to trust than one that handles everything.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE_ORIGIN = "https://www.framework.co.ke";
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OG_IMAGE = "/images/shelving/configs/asymmetric-display-populated.jpg";
const FALLBACK_PHONE = "254783891005";

// From VOICE.md, "Do not write" (2026-08-15) and the two-minute check. The
// test asserts each of these still appears in that section, so the list cannot
// drift from the file silently. Whole-word, case-insensitive; a stem matches
// its inflections (transform, transforms, transformation).
export const DO_NOT_WRITE = [
  { phrase: "built to your measurements", pattern: /built to your measurements/i },
  { phrase: "your measurements", pattern: /\byour measurements\b/i },
  { phrase: "elevate your lifestyle", pattern: /elevate your lifestyle/i },
  { phrase: "transform", pattern: /\btransform\w*/i },
  { phrase: "unlock", pattern: /\bunlock\w*/i },
  { phrase: "curated collection", pattern: /curated collections?\b/i },
  { phrase: "seamless", pattern: /\bseamless\w*/i },
  { phrase: "effortless", pattern: /\beffortless\w*/i },
  { phrase: "game-changing", pattern: /\bgame[- ]chang\w*/i },
];

export const MODULAR_SENTENCE =
  "Our shelves are modular, which means they are made of separate parts that stack together.";

// --- The draft ------------------------------------------------------------

export function parseDraft(raw, draftPath = "draft.md") {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const problems = [];

  const first = /^query:\s*(.+?)\s*\|\s*segment:\s*(.+?)\s*$/.exec(lines[0] || "");
  if (!first) {
    problems.push(`line 1 must read "query: <what they typed> | segment: <who they are>", got: ${JSON.stringify(lines[0] || "")}`);
  }
  const meta = { query: first ? first[1] : "", segment: first ? first[2] : "" };

  // Optional key: value lines follow, until a blank line, a comment or the title.
  let i = 1;
  for (; i < lines.length; i += 1) {
    const m = /^([a-z][a-z-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) break;
    meta[m[1]] = m[2].trim();
  }

  // Comments carry Ben's notes and never reach the page or the checks.
  const stripped = lines.slice(i).join("\n").replace(/<!--[\s\S]*?-->/g, "");
  const bodyLines = stripped.split("\n");
  const titleAt = bodyLines.findIndex((l) => /^#\s+\S/.test(l));
  if (titleAt < 0) problems.push("no title: the first heading must be a single-# line");
  const title = titleAt >= 0 ? bodyLines[titleAt].replace(/^#\s+/, "").trim() : "";
  const body = titleAt >= 0 ? bodyLines.slice(titleAt + 1).join("\n").trim() : stripped.trim();
  if (body.split("\n").some((l) => /^#\s+\S/.test(l))) {
    problems.push("a second single-# heading: sections take ## and ###, the title alone takes #");
  }

  const base = path.basename(draftPath, path.extname(draftPath));
  const fromName = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(base);
  const slug = (meta.slug || (fromName ? fromName[2] : base)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const date = meta.date || (fromName ? fromName[1] : new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);

  return { meta, title, body, slug, date, raw: text, problems };
}

// --- The checks -----------------------------------------------------------

function excerpt(line) {
  const s = line.trim();
  return s.length > 90 ? `${s.slice(0, 87)}...` : s;
}

// Returns { refusals, warnings }. Refusals stop the publish; warnings print.
export function checkDraft(draft) {
  const refusals = [...draft.problems];
  const warnings = [];

  // Em dashes anywhere, comments included: the file is the unit the rule is
  // about, and a dash in a note is a dash waiting to be pasted into copy.
  draft.raw.split("\n").forEach((line, n) => {
    if (line.includes("\u2014")) refusals.push(`em dash (line ${n + 1}): "${excerpt(line)}"`);
    if (/\s\u2013\s/.test(line)) refusals.push(`en dash used as a dash (line ${n + 1}): "${excerpt(line)}"`);
  });

  const copy = `${draft.title}\n${draft.body}`;
  copy.split("\n").forEach((line, n) => {
    const where = `(line ${n + 1} of the copy): "${excerpt(line)}"`;
    if (/\bTCC\b/.test(line)) refusals.push(`"TCC" ${where}. Say "We provide an ETR invoice."`);
    for (const { phrase, pattern } of DO_NOT_WRITE) {
      if (pattern.test(line)) refusals.push(`"${phrase}" is on the Do not write list ${where}`);
    }
    if (/!/.test(line.replace(/!\[/g, ""))) refusals.push(`exclamation mark ${where}`);
    if (/\bTODO\b|\bTBD\b|\[\[|\[Ben\b|\[BEN\b/.test(line)) refusals.push(`editing marker left in ${where}`);
    const wa = /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s)"']*/.exec(line);
    if (wa && !/[?&]text=/.test(wa[0])) refusals.push(`bare WhatsApp link, no ?text= ${where}`);
    if (/\bK[Ss]h\.?\s?\d[\d,]*(?![\d,]*\/-)/.test(line)) warnings.push(`a price without the /- suffix ${where}`);
  });

  const words = countWords(draft.body);
  if (words < 500 || words > 800) warnings.push(`${words} words; the addendum asks for 500 to 800`);
  const modular = draft.body.split(MODULAR_SENTENCE).length - 1;
  if (modular !== 1) warnings.push(`the canonical modular sentence appears ${modular} times; once is the rule`);
  draft.body.split(/\n\s*\n/).forEach((para) => {
    if (/^\s*([-*]|\d+\.)\s/.test(para) || /^\s*#/.test(para)) return;
    const n = countWords(para);
    if (n > 60) warnings.push(`a paragraph of ${n} words: "${excerpt(para)}"`);
  });
  if (!draft.meta.description) warnings.push("no description: the first paragraph will be used, trimmed to 155 characters");
  if (draft.meta.image && !draft.meta["image-alt"]) refusals.push("image without image-alt");

  return { refusals, warnings };
}

export function countWords(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*>_`-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

// --- Markdown, the small subset a post needs -------------------------------

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function unescapeHtml(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?!\w)/g, "$1<em>$2</em>");
  return s;
}

function sitePath(src) {
  return src.startsWith("/") || /^https?:\/\//.test(src) ? src : `/${src}`;
}

export function markdownToHtml(markdown, { root, images = [] } = {}) {
  const out = [];
  let para = [];
  let list = null; // { tag, items }

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>\n${list.items.map((it) => `    <li>${inline(it)}</li>`).join("\n")}\n</${list.tag}>`);
    list = null;
  };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line);
    if (image) {
      flushPara(); flushList();
      const src = sitePath(image[2]);
      images.push(src);
      const caption = image[3] ? `\n    <figcaption>${inline(image[3])}</figcaption>` : "";
      out.push(`<figure class="blog-figure">\n    <img src="${escapeHtml(src)}" alt="${escapeHtml(image[1])}" loading="lazy">${caption}\n</figure>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet || numbered)[1].trim());
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara(); flushList();
      const last = out[out.length - 1];
      if (last && last.startsWith("<blockquote>") && !last.endsWith("</blockquote>\n")) {
        out[out.length - 1] = last.replace(/<\/p><\/blockquote>$/, ` ${inline(quote[1])}</p></blockquote>`);
      } else {
        out.push(`<blockquote><p>${inline(quote[1])}</p></blockquote>`);
      }
      continue;
    }

    if (list && /^\s{2,}\S/.test(rawLine)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();

  if (root) {
    for (const src of images) {
      if (/^https?:\/\//.test(src)) continue;
      if (!fs.existsSync(path.join(root, src))) throw new Error(`image not on disk: ${src} (looked under ${root})`);
    }
  }
  return out.join("\n\n");
}

// --- The page --------------------------------------------------------------

export function readPhone(root) {
  try {
    const m = /WHATSAPP_PHONE\s*=\s*'(\d+)'/.exec(fs.readFileSync(path.join(root, "js", "site.js"), "utf8"));
    if (m) return m[1];
  } catch { /* no site.js in a bare test root */ }
  return FALLBACK_PHONE;
}

export function dateText(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

function firstParagraph(markdown) {
  const para = markdown.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^([#>!-]|\d+\.)/.test(p));
  const text = (para || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ");
  if (text.length <= 155) return text;
  const cut = text.slice(0, 152);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 100))}...`;
}

export function renderPost(draft, { root, template, phone } = {}) {
  root = root || DEFAULT_ROOT;
  template = template || fs.readFileSync(path.join(root, "blog", "template.html"), "utf8");
  phone = phone || readPhone(root);

  const images = [];
  const content = markdownToHtml(draft.body, { root, images });
  const description = draft.meta.description || firstParagraph(draft.body);
  const canonical = `${SITE_ORIGIN}/blog/${draft.slug}.html`;
  const hero = draft.meta.image ? sitePath(draft.meta.image) : "";
  if (hero && !/^https?:\/\//.test(hero) && !fs.existsSync(path.join(root, hero))) {
    throw new Error(`hero image not on disk: ${hero} (looked under ${root})`);
  }
  const ogImage = hero ? (hero.startsWith("/") ? SITE_ORIGIN + hero : hero) : SITE_ORIGIN + DEFAULT_OG_IMAGE;
  const message = draft.meta.whatsapp || `Hello, I'd like shelving for my home. I read "${draft.title}" on your site.`;
  const whatsappHref = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: draft.title,
    description,
    image: ogImage,
    datePublished: draft.date,
    author: { "@type": "Organization", name: "Framework Designs", url: SITE_ORIGIN },
    publisher: { "@type": "Organization", name: "Framework Designs", url: SITE_ORIGIN },
    mainEntityOfPage: canonical,
  });

  const tokens = {
    title: escapeHtml(draft.title),
    description: escapeHtml(description),
    canonical,
    og_image: escapeHtml(ogImage),
    date_iso: draft.date,
    date_text: dateText(draft.date),
    slug: draft.slug,
    content: content.split("\n").map((l) => (l ? `                ${l}` : l)).join("\n"),
    whatsapp_href: escapeHtml(whatsappHref),
    hero_src: escapeHtml(hero),
    hero_alt: escapeHtml(draft.meta["image-alt"] || ""),
    hero_caption: inline(draft.meta["image-caption"] || ""),
    jsonld: jsonld.replace(/</g, "\\u003c"),
  };

  let html = template.replace(/\{\{#hero\}\}\n([\s\S]*?)\{\{\/hero\}\}\n/, hero ? "$1" : "");
  html = html.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in tokens)) throw new Error(`template token {{${key}}} has no value`);
    return tokens[key];
  });
  if (!hero) html = html.replace(/\n\s*<figcaption><\/figcaption>/g, "");

  return {
    html,
    record: { slug: draft.slug, title: draft.title, description, date: draft.date, image: ogImage.replace(SITE_ORIGIN, "") },
    message,
    whatsappHref,
    canonical,
    images: hero ? [hero, ...images] : images,
  };
}

// --- The index and the sitemap ----------------------------------------------

// Every published post on disk, read back from the markup the template writes.
export function readPosts(root) {
  const dir = path.join(root, "blog");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".html") && f !== "template.html")
    .map((f) => {
      const html = fs.readFileSync(path.join(dir, f), "utf8");
      const title = /<h1 class="blog-post-title">([\s\S]*?)<\/h1>/.exec(html);
      const time = /<time class="blog-post-date" datetime="([^"]+)"/.exec(html);
      const desc = /<meta name="description" content="([^"]*)"/.exec(html);
      const img = /<meta property="og:image" content="([^"]*)"/.exec(html);
      if (!title || !time) return null;
      return {
        slug: f.replace(/\.html$/, ""),
        title: unescapeHtml(title[1].replace(/<[^>]+>/g, "").trim()),
        description: desc ? unescapeHtml(desc[1]) : "",
        date: time[1],
        image: img ? img[1].replace(SITE_ORIGIN, "") : DEFAULT_OG_IMAGE,
      };
    })
    .filter(Boolean);
}

export function renderCard(post) {
  const href = `/blog/${post.slug}.html`;
  return [
    `<article class="blog-card">`,
    `    <a class="blog-card-image-link" href="${href}"><img src="${escapeHtml(post.image)}" alt="" class="blog-card-image" loading="lazy"></a>`,
    `    <div class="blog-card-content">`,
    `        <div class="blog-card-date"><time datetime="${post.date}">${dateText(post.date)}</time></div>`,
    `        <h2 class="blog-card-title"><a href="${href}">${escapeHtml(post.title)}</a></h2>`,
    `        <p class="blog-card-excerpt">${escapeHtml(post.description)}</p>`,
    `        <a href="${href}" class="blog-card-link">Read more</a>`,
    `    </div>`,
    `</article>`,
  ].join("\n");
}

export function renderIndex(indexHtml, posts) {
  const start = "<!-- blog-index:start -->";
  const end = "<!-- blog-index:end -->";
  const a = indexHtml.indexOf(start);
  const b = indexHtml.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error("blog.html has no blog-index:start / blog-index:end markers");
  const sorted = [...posts].sort((x, y) => (y.date.localeCompare(x.date)) || x.title.localeCompare(y.title));
  const cards = sorted.map(renderCard).join("\n");
  return `${indexHtml.slice(0, a + start.length)}\n${cards}\n${indexHtml.slice(b)}`;
}

export function updateSitemap(xml, { loc, lastmod, priority = "0.6" }, today) {
  const entry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
  const existing = new RegExp(`  <url>\\s*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[\\s\\S]*?</url>\\n`);
  let out = existing.test(xml) ? xml.replace(existing, entry) : xml.replace(/<\/urlset>/, `${entry}</urlset>`);
  // The index changed too.
  out = out.replace(
    new RegExp(`(<loc>${SITE_ORIGIN}/blog\\.html</loc>\\s*<lastmod>)[^<]+`),
    `$1${today || new Date().toISOString().slice(0, 10)}`,
  );
  return out;
}

// --- Publish ----------------------------------------------------------------

export function publish({ draftPath, root = DEFAULT_ROOT, dryRun = false, today, log = console.log }) {
  const raw = fs.readFileSync(draftPath, "utf8");
  const draft = parseDraft(raw, draftPath);
  const { refusals, warnings } = checkDraft(draft);
  if (refusals.length) {
    const err = new Error(`refused ${path.basename(draftPath)}:\n  - ${refusals.join("\n  - ")}`);
    err.refusals = refusals;
    throw err;
  }
  const post = renderPost(draft, { root });
  const others = readPosts(root).filter((p) => p.slug !== draft.slug);
  const indexPath = path.join(root, "blog.html");
  const sitemapPath = path.join(root, "sitemap.xml");
  const index = renderIndex(fs.readFileSync(indexPath, "utf8"), [...others, post.record]);
  const sitemap = updateSitemap(fs.readFileSync(sitemapPath, "utf8"), { loc: post.canonical, lastmod: draft.date }, today);
  const postPath = path.join(root, "blog", `${draft.slug}.html`);

  for (const w of warnings) log(`warning: ${w}`);
  log(`${dryRun ? "would write" : "wrote"} ${path.relative(root, postPath)}`);
  log(`  title:       ${draft.title}`);
  log(`  serves:      ${draft.meta.query}  |  ${draft.meta.segment}`);
  log(`  date:        ${draft.date}`);
  log(`  description: ${post.record.description}`);
  log(`  canonical:   ${post.canonical}`);
  log(`  whatsapp:    ${post.message}`);
  log(`  images:      ${post.images.length ? post.images.join(", ") : "none"}`);
  log(`  words:       ${countWords(draft.body)}`);
  log(`${dryRun ? "would write" : "wrote"} blog.html (${others.length + 1} posts, newest first)`);
  log(`${dryRun ? "would write" : "wrote"} sitemap.xml (${post.canonical}, lastmod ${draft.date})`);

  if (dryRun) {
    log(`\n----- ${path.relative(root, postPath)} -----\n${post.html}`);
    log(`----- blog.html, the card -----\n${renderCard(post.record)}\n`);
    log(`----- sitemap.xml, the entry -----\n  <url>\n    <loc>${post.canonical}</loc>\n    <lastmod>${draft.date}</lastmod>\n  </url>`);
  } else {
    fs.writeFileSync(postPath, post.html);
    fs.writeFileSync(indexPath, index);
    fs.writeFileSync(sitemapPath, sitemap);
  }
  return { draft, post, warnings, postPath, index, sitemap };
}

// --- CLI ----------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rootAt = args.indexOf("--root");
  const root = rootAt >= 0 ? path.resolve(args[rootAt + 1]) : DEFAULT_ROOT;
  const draftPath = args.find((a, i) => !a.startsWith("--") && (rootAt < 0 || i !== rootAt + 1));
  if (!draftPath) {
    console.error("usage: node scripts/publish-blog.mjs <draft.md> [--dry-run] [--root <site dir>]");
    process.exit(2);
  }
  try {
    publish({ draftPath: path.resolve(draftPath), root, dryRun });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Guards against a whole class of lead leakage: a WhatsApp CTA that opens a
// BLANK chat. When a wa.me link has no ?text=, the visitor lands in an empty
// thread, sees nothing to send, and usually leaves — but the pixel already
// counted the click as a "Lead". Every WhatsApp link we ship must therefore open
// a chat with a message already typed in. See js/site.js buildWhatsAppUrl().

const ROOT = path.join(__dirname, "..");
const SELF = path.basename(__filename);
const SKIP_DIRS = new Set([".git", "node_modules", "images", "pdf", "feeds", "configs", "docs", "css"]);
const EXTENSIONS = new Set([".html", ".js", ".mjs"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name)) && entry.name !== SELF) {
      files.push(full);
    }
  }
  return files;
}

// Match a real (scheme-prefixed) WhatsApp link that hard-codes a phone number,
// then capture the tail (up to the closing quote / backtick / paren / space). A
// legit link carries ?text= right after the number. Requiring the https:// scheme
// keeps us from flagging CSS selector fragments (a[href*="wa.me/"]) or dynamic
// builds ('https://wa.me/' + phone + '?text='), which have no literal digits
// after the slash and are the sanctioned single source of truth.
const WA_ME = /https?:\/\/wa\.me\/\d+([^\s"'`)]*)/g;
const API_WA = /https?:\/\/api\.whatsapp\.com\/send([^\s"'`)]*)/g;

const failures = [];

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    let m;
    WA_ME.lastIndex = 0;
    while ((m = WA_ME.exec(line))) {
      if (!/^[?&]text=/.test(m[1])) {
        failures.push(`${rel}:${i + 1}  bare wa.me link (blank chat, no ?text=): ${line.trim().slice(0, 140)}`);
      }
    }
    API_WA.lastIndex = 0;
    while ((m = API_WA.exec(line))) {
      if (!/[?&]text=/.test(m[1])) {
        failures.push(`${rel}:${i + 1}  api.whatsapp.com link with no text=: ${line.trim().slice(0, 140)}`);
      }
    }
  });
}

assert.strictEqual(
  failures.length,
  0,
  "WhatsApp CTAs must open a pre-filled chat (?text=). Offenders:\n" + failures.join("\n")
);

// The shared safety net in site.js must stay in place.
const siteJs = fs.readFileSync(path.join(ROOT, "js", "site.js"), "utf8");
assert(siteJs.includes("buildWhatsAppUrl"), "site.js must define buildWhatsAppUrl (single source of truth for WhatsApp links)");
assert(siteJs.includes("ensureWhatsAppMessages"), "site.js must define ensureWhatsAppMessages (load-time blank-chat safety net)");

console.log("whatsapp link tests passed (all WhatsApp CTAs open a pre-filled chat)");

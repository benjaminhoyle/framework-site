// Guards the WS1 client emitter in js/site.js: the funnel tracker must keep its
// contract (session/short-code mint, first-touch capture, checkpoint beacons,
// and the &r=CODE ref injection into WhatsApp pre-fills). Runs the relevant
// slices of site.js in a tiny DOM/crypto stub — no browser needed.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const siteJs = fs.readFileSync(path.join(ROOT, "js", "site.js"), "utf8");

// The emitter is the trailing IIFE (the WS1 funnel emitter block). Pull it out
// and run it under a controlled sandbox so we can call the click handler.
const start = siteJs.indexOf("// === WS1 funnel emitter");
assert(start > -1, "site.js must contain the WS1 funnel emitter block");
const emitter = siteJs.slice(start);

// --- minimal DOM / storage / crypto stubs ---------------------------------
const store = {};
const beacons = [];
let clickHandler = null;

const sandbox = {
  window: {
    WHATSAPP_PHONE: "254783891005",
    WHATSAPP_DEFAULT_MESSAGE: "Hi Framework!",
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 5) % 256; return a; } },
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: { pathname: "/shelving.html", search: "?config=lantern-shelf&utm_content=AdX&ad_id=12345&fbclid=fb99" },
  },
  navigator: {
    userAgent: "Mozilla/5.0 (iPhone)",
    sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; },
  },
  document: {
    readyState: "complete",
    addEventListener: (type, fn, capture) => { if (type === "click" && capture) clickHandler = fn; },
  },
  Blob: class { constructor(parts) { this.text = parts.join(""); } },
  URLSearchParams, // web API — not a default global inside a fresh vm context
  console,
};
sandbox.window.sessionStorage = sandbox.window.sessionStorage;
sandbox.self = sandbox.window;

vm.createContext(sandbox);
vm.runInContext(emitter, sandbox);

const fwk = sandbox.window.fwk;
assert(fwk, "emitter must expose window.fwk");

// 1. session id + short code shape.
const sid = fwk.sessionId();
assert(sid && sid.length === 12, "session id should be two 6-char codes");
const code = fwk.mintCode();
assert(/^[0-9A-HJKMNP-TV-Z]{6}$/.test(code), "short code must be 6-char Crockford Base32: " + code);

// 2. arrive fired once on init (from the IIFE's init()).
const arriveBeacon = beacons.map((b) => JSON.parse(b.blob.text)).find((p) => p.event === "arrive");
assert(arriveBeacon, "arrive event must beacon on init");
assert.strictEqual(arriveBeacon.session_id, sid);
assert.strictEqual(arriveBeacon.ad.utm_content, "AdX", "first-touch ad params captured from URL");
assert.strictEqual(arriveBeacon.ad.ad_id, "12345");

// 3. deep-link landing (?config=lantern-shelf) emits a C2 product_view on init,
//    independent of shelving.html's parse-time auto-open (regression guard).
const deeplinkPv = beacons.map((b) => JSON.parse(b.blob.text))
  .find((p) => p.event === "product_view" && p.dims.product_id === "lantern-shelf");
assert(deeplinkPv, "deep-link landing must emit product_view for the config id");
assert.strictEqual(deeplinkPv.dims.view_source, "deeplink");

// 4. product_view + engage threshold (4 distinct products). lantern-shelf is
//    already counted from the deep-link above, so a+b+c reaches the 4th.
for (const id of ["a", "b"]) fwk.productView(id, "grid");
assert(!beacons.map((b) => JSON.parse(b.blob.text)).some((p) => p.event === "engage"), "engage must not fire before 4 distinct products");
fwk.productView("c", "grid");
const engageBeacon = beacons.map((b) => JSON.parse(b.blob.text)).find((p) => p.event === "engage");
assert(engageBeacon, "engage must fire on the 4th distinct product");
assert.strictEqual(engageBeacon.dims.engaged_via, "multi_product");

// 4. WhatsApp click: mints code, injects &r=CODE into the config URL, beacons
//    both a wa_handoff event and a code payload.
const preText = "Hello, I'd like to place an order.\n\nhttps://www.framework.co.ke/shelving.html?config=lantern-shelf";
const anchor = {
  id: "lb-order",
  // Reflects rewrites, like a real DOM node — a second click reads the new href.
  getAttribute: (k) => (k === "href"
    ? (anchor._href || "https://wa.me/254783891005?text=" + encodeURIComponent(preText))
    : (k === "data-clarity-config-id" ? "lantern-shelf" : null)),
  setAttribute: (k, v) => { anchor._href = v; },
  closest: () => anchor,
};
const before = beacons.length;
clickHandler({ target: anchor });
const newBeacons = beacons.slice(before).map((b) => JSON.parse(b.blob.text));
const handoff = newBeacons.find((p) => p.event === "wa_handoff");
const codePayload = newBeacons.find((p) => p.type === "code");
assert(handoff, "wa_handoff must beacon on WhatsApp click");
assert.strictEqual(handoff.dims.handoff_source, "lightbox_order");
assert.strictEqual(handoff.dims.product_id, "lantern-shelf");
assert.strictEqual(handoff.dims.has_config, true);
assert(/^[0-9A-HJKMNP-TV-Z]{6}$/.test(handoff.dims.short_code), "handoff carries a short code");
assert(codePayload, "code payload must beacon on WhatsApp click");
assert.strictEqual(codePayload.code, handoff.dims.short_code, "code payload matches handoff short code");
assert(anchor._href, "click must rewrite the href");
const outText = decodeURIComponent(/text=([^&]*)/.exec(anchor._href)[1].replace(/\+/g, " "));
assert(outText.includes("config=lantern-shelf&r=" + codePayload.code), "ref code injected into the config URL: " + outText);

// 5. Second click on the same CTA reuses the code already in the message —
//    the beaconed code must always match what the WhatsApp message carries.
const before2 = beacons.length;
clickHandler({ target: anchor });
const second = beacons.slice(before2).map((b) => JSON.parse(b.blob.text));
const handoff2 = second.find((p) => p.event === "wa_handoff");
const codePayload2 = second.find((p) => p.type === "code");
assert(handoff2 && codePayload2, "re-click still beacons handoff + code payload");
assert.strictEqual(handoff2.dims.short_code, codePayload.code, "re-click reuses the code already in the message");
assert.strictEqual(codePayload2.code, codePayload.code, "no orphan code minted on re-click");
const outText2 = decodeURIComponent(/text=([^&]*)/.exec(anchor._href)[1].replace(/\+/g, " "));
assert(!/r=[0-9A-HJKMNP-TV-Z]{6}.*r=[0-9A-HJKMNP-TV-Z]{6}/.test(outText2), "code not injected twice");

console.log("track emitter tests passed (session, short code, checkpoints, ref injection)");

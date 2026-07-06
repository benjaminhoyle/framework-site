# Repository Notes For Agents

## Shelving Catalog

The shelving catalog data lives in `shelving.html` in the `const configurations = [...]` array.

When adding, editing, or removing shelving catalog products, keep these in sync:

- Website catalog UI in `shelving.html`
- Product images in `images/shelving/configs/`
- Product thumbnails in `images/shelving/configs/thumbs/`
- Public Meta catalog feed at `feeds/meta-shelving-catalog.csv`

Preferred workflow:

```sh
node scripts/import-shelving-product.mjs /path/to/product-folder
```

That importer updates `shelving.html`, resizes images, validates assets, and regenerates the Meta feed automatically.

If you manually edit catalog data in `shelving.html`, regenerate the Meta feed before committing:

```sh
node scripts/generate-meta-catalog-feed.mjs
```

The Meta feed is used by Commerce Manager and WhatsApp catalog sync. Its product `id` values must match the Meta pixel `content_ids` used on the shelving page.

## WhatsApp CTAs (ad-lead pipeline)

Every WhatsApp link MUST open a chat with a message already typed in (`wa.me/<phone>?text=...`).
A bare `wa.me/<phone>` link opens a blank thread: the visitor sees nothing to send and
usually leaves, but the Meta pixel already fired `Lead` on click — so "Website leads" runs
far ahead of real inbound messages. That gap is a UX bug, not (necessarily) people bailing.

- Single source of truth: `window.buildWhatsAppUrl(message)` in `js/site.js`.
- `window.ensureWhatsAppMessages()` runs on load as a safety net and back-fills any
  `wa.me` / `api.whatsapp.com` anchor missing `?text=` (use `data-wa-message="..."` for a
  custom message, otherwise it gets `WHATSAPP_DEFAULT_MESSAGE`).
- Static links may hard-code `?text=<url-encoded message>` directly.
- Let the anchor navigate natively (`target="_blank"` + `?text=` href). Do NOT `preventDefault()`
  and re-`window.open()` from a gtag `event_callback` — that gets popup-blocked in Meta's
  in-app browser, where most ad traffic lands.

Run the guard before committing (also validates the `site.js` helpers exist):

```sh
node scripts/test-whatsapp-links.js
```


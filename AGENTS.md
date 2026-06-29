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


# Shelving Catalog Workflow

This is the simplest way to add or edit shelving products without manually touching the page code.

## Add A New Product

1. Create a folder in:
   `/Users/ben/Library/CloudStorage/Dropbox/01_Current-Projects/Framework/05_Marketing/Website/260628_catalog-products`
2. Name the folder with the product slug, for example:
   `stepped-duo`
3. Put the product JSON in that folder. The JSON should use the same slug, for example:
   `stepped-duo.json`
4. Put the product images in the same folder.
5. Ask Codex:
   `Please add the stepped-duo catalog folder to shelving.html, resize images, verify locally, commit, and push.`

Codex will run the importer script, which copies/resizes the images, creates thumbnails, inserts or updates the catalog item, and checks that all assets exist.
It also regenerates the public Meta catalog feed at `feeds/meta-shelving-catalog.csv`.

## Product Folder Format

Each folder should look like this:

```text
stepped-duo/
  stepped-duo.json
  stepped-duo-populated.jpg
  stepped-duo-emptied.jpg
  stepped-duo-angle.jpg
```

The JSON should look like this:

```json
{
  "id": "stepped-duo",
  "title": "The Stepped Duo",
  "image": "images/shelving/configs/stepped-duo-populated.jpg",
  "images": [
    "images/shelving/configs/stepped-duo-populated.jpg",
    "images/shelving/configs/stepped-duo-emptied.jpg",
    "images/shelving/configs/stepped-duo-angle.jpg"
  ],
  "price": "Ksh 53,000",
  "priceValue": 53000,
  "description": "Short product description.",
  "designerUrl": "designer.html#..."
}
```

## Image Rules

- Use square product images whenever possible.
- Put the best default image first and use it as `image`.
- Keep original source images in Dropbox.
- The site should use optimized copies in `images/shelving/configs/`.
- The modal thumbnail rail uses matching files in `images/shelving/configs/thumbs/`.
- The importer creates `1400px` product images and `180px` thumbnails.

## Edit An Existing Product

Update the JSON or replace images in the Dropbox folder, then ask Codex:

`Please re-import the [product-slug] shelving catalog folder, verify locally, commit, and push.`

The importer updates the existing catalog item when the `id` already exists.

## Remove A Product

Ask Codex:

`Please remove the [product-slug] shelving catalog item from the website, regenerate the Meta catalog feed, verify locally, commit, and push.`

Codex should remove the item from the `shelving.html` catalog data and regenerate `feeds/meta-shelving-catalog.csv`. Source images can stay in Dropbox unless you specifically want them cleaned up.

## Meta And WhatsApp Catalog Sync

The website catalog is the source of truth. Meta should use this hosted feed:

```text
https://www.framework.co.ke/feeds/meta-shelving-catalog.csv
```

In Meta Commerce Manager, use a scheduled data feed for the main Framework Designs catalog. Connect the `Framework Website` pixel to that same catalog for event matching, and connect WhatsApp to that catalog instead of maintaining a separate manual WhatsApp catalog. Configure the feed so items missing from the latest feed are removed or archived in Meta, otherwise removed website products may remain in the catalog.

The feed item `id` values match the Meta pixel `content_ids` values used on the shelving page, such as `starter`, `low-console`, and `grand-corner`.

## Edit A Page Image

For non-catalog page images, such as the hero or product-detail cards:

1. Put the source image in the Dropbox catalog-products folder.
2. Ask Codex to replace the specific image on the page.
3. Codex should resize it into the site image folder, update the `img src`, check `width`, `height`, and `alt`, then verify in the browser.

## Behind The Scenes

The helper script is:

```text
scripts/import-shelving-product.mjs
```

It is intended for Codex or a developer to run. You should not need to use it directly.

To regenerate only the Meta CSV feed from the current `shelving.html` catalog data, run:

```text
node scripts/generate-meta-catalog-feed.mjs
```

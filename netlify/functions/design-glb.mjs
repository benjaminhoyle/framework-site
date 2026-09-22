// /api/design-glb/<CODE>.glb — a saved design as a glTF binary, for AR.
//
// The path carries the code and ends in .glb on purpose. Android's Scene Viewer
// and iOS Quick Look fetch this URL from outside the page, with no
// <model-viewer> in the middle to tell them what it is, and both are happier
// with an extension than with a query string. It sits under /api/ rather than
// taking a second top-level prefix, and so cannot collide with /d/:code, which
// is the page.
//
// Resolution follows js/builder/app.js's loadSavedDesign exactly, and in its
// order: /api/design first (Netlify Blobs, every design anyone has ever saved),
// then the static file in data/builder-designs (the 77 catalogue designs, which
// are on disk and therefore answer even when Blobs does not). Within a record
// the share hash wins over the serialised design, for the reason app.js gives:
// the hash is the form the page itself reads and survives a catalogue rename.
// Anything else would mean /builder/CODE and /d/CODE could show different
// shelves, which is the one failure this endpoint cannot have.
//
// The geometry comes over HTTP from the site's own CDN rather than out of the
// function bundle. That is deliberate: assets/shelving/modules/*.json is 3.4MB
// across 53 files, it is already served with a week's cache-control, and
// bundling it would put the whole set into every deploy of this function to
// serve the three or four bundles a design actually needs. Warm invocations
// keep what they have parsed.
//
// Caching is by content, which is free here: a design code is an FNV-1a hash of
// the design, so a code names one shelf forever. The ETag adds the catalogue's
// own content hash and the file variant, so a geometry rebuild in the pipeline
// invalidates every model without anyone having to remember to.
//
// NOTE ON USDZ. There is no USDZ here and there does not need to be for v1.
// <model-viewer> builds one in the browser, on demand, when the AR button is
// tapped in Safari on an iPhone and no `ios-src` is given (modelviewer.dev FAQ).
// The one case that needs a real file is Chrome on iOS, which cannot run
// model-viewer's exporter; see the note at the foot of this file.

import { getStore } from '@netlify/blobs';
import { gzipSync } from 'node:zlib';

import { buildGlb, stateFromRecord, modulesNeeded } from './_glb.mjs';
import {
  CODE_RE, assetOrigin, loadCatalog, loadBundle, readDesign, contractTag, isMissing
} from './_designs.mjs';

/*
 * The built file, kept so a cold start does not rebuild what another instance
 * already built. Best-effort on both sides: without Blobs (locally, or on a
 * deploy where the store is not configured) this endpoint is merely slower, and
 * an endpoint that 500s because its cache is missing would be worse than no
 * cache at all.
 */
async function cached(key) {
  try {
    const bytes = await getStore('design-glb').get(key, { type: 'arrayBuffer' });
    return bytes ? Buffer.from(bytes) : null;
  } catch (error) {
    return null;
  }
}

async function remember(key, buffer) {
  try {
    await getStore('design-glb').set(key, buffer);
  } catch (error) {
    /* a cache that cannot be written is still a working endpoint */
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const code = String(
    (url.searchParams.get('code') || url.pathname.replace(/^.*\/([^/]*)\.glb$/, '$1') || '')
  ).toUpperCase();
  if (!CODE_RE.test(code)) return text('bad_code', 400);

  // The two knobs, both off by default. `quantise` writes the smaller file
  // behind KHR_mesh_quantization; `palette=builder` writes the screen colours
  // instead of the real material ones, for a side-by-side.
  const quantise = url.searchParams.get('quantise') === '1';
  const palette = url.searchParams.get('palette') === 'builder' ? 'builder' : 'material';
  const origin = assetOrigin(req);

  let etag;
  let glb;
  try {
    const { catalog, raw } = await loadCatalog(origin);
    const variant = `${contractTag(raw)}-${quantise ? 'q' : 'f'}-${palette[0]}`;
    etag = `"${code}-${variant}"`;
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: headers(etag) });

    const key = `${code}/${variant}.glb`;
    glb = await cached(key);
    if (!glb) {
      const record = await readDesign(origin, code);
      if (!record || (!record.hash && !record.design)) return text('not_found', 404);
      const state = stateFromRecord(catalog, record);
      const modules = new Map();
      await Promise.all(modulesNeeded(catalog, state).map(async (id) => {
        modules.set(id, await loadBundle(origin, id));
      }));
      glb = buildGlb(catalog, state, modules, { quantise, palette }).glb;
      await remember(key, glb);
    }
  } catch (error) {
    const missing = isMissing(error);
    return text(missing ? 'not_found' : `build_failed: ${error && error.message}`, missing ? 404 : 500);
  }

  // Netlify serves model/gltf-binary uncompressed at the edge -- the same trap
  // the geometry bundles avoid by being JSON (see netlify.toml) -- so the
  // gzipping is done here. It is about a third of the bytes on the wire.
  const wantsGzip = /\bgzip\b/.test(req.headers.get('accept-encoding') || '');
  const body = wantsGzip ? gzipSync(glb, { level: 9 }) : glb;
  return new Response(body, {
    status: 200,
    headers: {
      ...headers(etag),
      'content-type': 'model/gltf-binary',
      'content-length': String(body.length),
      ...(wantsGzip ? { 'content-encoding': 'gzip' } : {})
    }
  });
};

function headers(etag) {
  return {
    etag,
    // A code names one shelf forever, and the ETag carries the catalogue's
    // content hash, so the edge can hold this for a long time and a pipeline
    // rebuild still invalidates it.
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    'netlify-cdn-cache-control': 'public, s-maxage=2592000, stale-while-revalidate=604800',
    // Quick Look and Scene Viewer fetch this URL from outside the page.
    'access-control-allow-origin': '*'
  };
}

function text(message, status) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/*
 * What a USDZ would take, when it is wanted.
 *
 * It is wanted for exactly one browser: Chrome on iOS, which cannot run
 * <model-viewer>'s own exporter and needs a real `ios-src` (model-viewer
 * discussion #2898). Safari on iOS, which is the majority of iPhone traffic,
 * gets a USDZ built in the page at the moment the AR button is tapped. Android
 * never wants one.
 *
 * There is no pure-JavaScript USDZ writer worth running in a Netlify function:
 * three.js's USDZExporter needs a three.js scene (so it needs a headless
 * WebGL-less parse of the GLB, which it half supports), and Apple's own
 * usdzconvert is a Python tool against the USD libraries, which is a container,
 * not a function. The three honest routes, cheapest first:
 *
 *   1. Leave it. Chrome on iOS is a small slice of a small slice; the button
 *      already says "open this in Safari" where AR cannot launch.
 *   2. Bake the 77 catalogue designs to USDZ once, on a Mac (Reality Converter,
 *      or `usdzconvert` from Apple's USD tools, both free), commit them beside
 *      the GLBs and serve `ios-src` when one exists. Saved designs still get
 *      the in-browser route.
 *   3. Run three.js plus USDZExporter in the function over the GLB this file
 *      already produces. A day's work and a large dependency in a place the
 *      site currently has none.
 *
 * Whichever is chosen, the geometry is settled: it is the same buffers.
 */

export const config = { path: ['/api/design-glb', '/api/design-glb/:code.glb'] };

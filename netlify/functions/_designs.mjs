/**
 * Resolving a design code, inside a function.
 *
 * Shared by `design-glb` (the model) and `design-page` (the page), so that the
 * two cannot disagree about which shelf a code names. The order is
 * js/builder/app.js's loadSavedDesign, verbatim in intent: `/api/design` first,
 * because that is where every design anyone has ever saved lives, then the
 * static file in `data/builder-designs`, which is the 77 catalogue designs and
 * answers even when the blob store does not.
 *
 * Everything is read over HTTP from the site's own origin rather than out of the
 * function bundle. `assets/shelving/modules/*.json` is 3.4MB across 53 files,
 * already served with a week of cache-control, and a design needs three or four
 * of them; bundling the set into every deploy to serve four files would be the
 * wrong trade. Warm invocations keep what they have parsed, and expanding a
 * bundle -- a few million multiply-adds for a base unit -- is the part worth not
 * repeating.
 */

import { engine, geometryLoader } from './_glb.mjs';

export const CODE_RE = /^[0-9A-Z]{7}$/;

let catalogPromise = null;
const bundlePromises = new Map();

/**
 * The site's own origin. A function on a branch deploy reads that branch's
 * assets, which is what makes a geometry change previewable before it is live.
 */
export function assetOrigin(req) {
  return process.env.FRAMEWORK_ASSET_ORIGIN || new URL(req.url).origin;
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export function isMissing(error) {
  return /HTTP 404/.test(String(error && error.message));
}

/** The normalised catalogue, plus the raw one for its contract hash. */
export function loadCatalog(origin) {
  if (!catalogPromise) {
    catalogPromise = fetchJson(`${origin}/assets/shelving/catalog.json`)
      .then((raw) => ({ catalog: engine.normalizeCatalog(raw), raw }))
      .catch((error) => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

export function loadBundle(origin, moduleId) {
  if (!bundlePromises.has(moduleId)) {
    const promise = fetchJson(`${origin}/assets/shelving/modules/${encodeURIComponent(moduleId)}.json`)
      .then(geometryLoader.expand)
      .catch((error) => { bundlePromises.delete(moduleId); throw error; });
    bundlePromises.set(moduleId, promise);
  }
  return bundlePromises.get(moduleId);
}

export async function readDesign(origin, code) {
  try {
    const stored = await fetchJson(`${origin}/api/design?code=${encodeURIComponent(code)}`);
    if (stored && stored.ok) return stored;
  } catch (error) {
    // Not found in the blob store is the ordinary case for a catalogue design,
    // not a fault. Fall through to the file.
  }
  return fetchJson(`${origin}/data/builder-designs/${encodeURIComponent(code)}.json`);
}

/**
 * The catalogue's own content hash, short. It goes into every ETag and cache
 * key, so a geometry rebuild in the pipeline invalidates every model and every
 * page without anybody having to remember to.
 */
export function contractTag(raw) {
  return String((raw.contract && raw.contract.contentHash) || raw.generatedAt || '0').slice(0, 12);
}

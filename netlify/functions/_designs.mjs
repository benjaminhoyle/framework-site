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

/*
 * A design that was made a second ago.
 *
 * /builder shows the code as soon as it has composed the picture, while the
 * POST that stores the design may still be in flight, and the store itself
 * takes a moment to settle after the write returns. Somebody who taps straight
 * through from the share window can therefore arrive here before the record
 * does, and be told their shelf does not exist.
 *
 * The builder now holds its own link back until the save has answered, which
 * removes the race at the only place that can know about it. This is the other
 * half: a code that looks well formed but is not in the store yet is worth one
 * short second look before the page gives up, because the alternative is a page
 * that is wrong for a moment rather than late for one. Two retries, 400ms
 * apart, and only on the miss path, so nothing that resolves normally waits.
 */
const RETRY_MS = [400, 800];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readDesign(origin, code) {
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt += 1) {
    try {
      const stored = await fetchJson(`${origin}/api/design?code=${encodeURIComponent(code)}`);
      if (stored && stored.ok) return stored;
    } catch (error) {
      // Not found in the blob store is the ordinary case for a catalogue
      // design, not a fault. Fall through to the file.
    }
    try {
      return await fetchJson(`${origin}/data/builder-designs/${encodeURIComponent(code)}.json`);
    } catch (error) {
      // A catalogue design would have been found by now, so this is either a
      // code that does not exist or one that is a moment away from existing.
      if (attempt === RETRY_MS.length) throw error;
      await sleep(RETRY_MS[attempt]);
    }
  }
  return null;
}

/**
 * The catalogue's own content hash, short. It goes into every ETag and cache
 * key, so a geometry rebuild in the pipeline invalidates every model and every
 * page without anybody having to remember to.
 */
export function contractTag(raw) {
  return String((raw.contract && raw.contract.contentHash) || raw.generatedAt || '0').slice(0, 12);
}

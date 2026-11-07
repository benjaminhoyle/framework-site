// What a stored design is, in the words a person needs: its size, its finish, its price
// today and what is in it. And the same shelf in another colour. Both go through the
// builder's own engine, so a client's page cannot quote a size /builder would not.

import { engine, stateFromRecord, shelfSizeMm, priceOf } from './_glb.mjs';

const moduleLabel = (module) => module.label || module.id.replace(/_/g, ' ');

/** The finish's display name for an id such as "sage". */
const finishName = (catalog, id) => {
  const list = catalog.finishes || [];
  const found = (Array.isArray(list) ? list : Object.values(list)).find((f) => f.id === id);
  return found ? found.displayName : (id ? id.charAt(0).toUpperCase() + id.slice(1) : null);
};

export function describeRecord(catalog, record) {
  const state = stateFromRecord(catalog, record);
  const size = shelfSizeMm(catalog, state);
  const { totalKsh } = priceOf(catalog, state);
  const counts = new Map();
  for (const i of state.instances) {
    if (!i.omitted) counts.set(i.moduleId, (counts.get(i.moduleId) || 0) + 1);
  }
  const pieces = [...counts.keys()].sort().map((id) => ({
    qty: counts.get(id),
    name: moduleLabel(catalog.modules[id] || { id })
  }));
  if (state.bookends > 0) pieces.push({ qty: state.bookends, name: 'Bookend' });
  return {
    w: Math.round(size.widthMm / 10),
    d: Math.round(size.depthMm / 10),
    h: Math.round(size.heightMm / 10),
    finish: finishName(catalog, state.finish),
    total: totalKsh,
    pieces
  };
}

/** The same arrangement whatever its colour, so colours of one shelf count as one in the rankings. */
export function shapeKey(record) {
  const rows = (record.design && record.design.instances) || [];
  return JSON.stringify(rows.map((i) => [i.type, i.originWorldMm, i.rotationDeg || 0]));
}

const decodeHash = (hash) => {
  const raw = String(hash).trim().replace(/^.*#/, '').replace(/^\/+/, '');
  return JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
};
const encodeHash = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');

/**
 * This shelf with one overall colour, as a record ready for the design store. Any
 * per-piece colour is cleared: "in charcoal" means all of it. The price does not
 * depend on the finish, so the total carries across.
 */
export function recolorRecord(catalog, record, finishId) {
  const payload = decodeHash(record.hash);
  payload[2] = finishId;
  if (Array.isArray(payload[5])) payload[5] = payload[5].map((row) => row.slice(0, 6));
  if (payload.length > 6) payload[6] = [];
  const hash = encodeHash(payload);
  const state = stateFromRecord(catalog, { hash });
  const design = engine.serializeState(state);
  return {
    code: engine.designCode(state),
    hash,
    design,
    mode: record.mode || 'advanced',
    finish: finishId,
    pieces: record.pieces ?? state.instances.length,
    total_ksh: record.total_ksh ?? priceOf(catalog, state).totalKsh
  };
}

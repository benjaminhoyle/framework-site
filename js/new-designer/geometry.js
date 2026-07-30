/**
 * Loader for module geometry bundles (see scripts/build-new-designer-assets.mjs).
 *
 * A bundle stores each distinct sub-mesh once plus a list of placements, which
 * is how the Rhino models were authored (four legs = one mesh, four
 * transforms). This expands those placements into one interleaved buffer per
 * colour role, ready to hand straight to WebGL: after this runs, drawing a
 * whole shelving unit is two or three draw calls.
 *
 * Everything stays quantised -- positions as uint16, normals as int8 -- so the
 * expansion allocates a third of what float32 would, which matters on a phone
 * with 2-4GB of RAM shared with the browser.
 */
window.FrameworkDesignerGeometry = (function () {
  "use strict";

  const FORMAT = "framework-module-geometry@1";
  // uint16 indices address at most 65536 vertices, so a role that expands past
  // that is split across several batches (one draw call each).
  const MAX_BATCH_VERTICES = 65535;

  /**
   * Base64 -> typed array. The bytes were written little-endian, and every
   * platform a browser runs on today is little-endian, so the view can be taken
   * straight over the decoded buffer instead of being read value by value.
   */
  function decodeBuffer(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer, 0, bytes.length / Type.BYTES_PER_ELEMENT);
  }

  function expand(header) {
    if (!header || header.format !== FORMAT) {
      throw new Error(`unsupported geometry format: ${header && header.format}`);
    }
    const parts = header.parts.map((part) => ({
      role: part.role,
      vertexCount: part.vertexCount,
      indexCount: part.indexCount,
      scale: part.scale,
      offset: part.offset,
      positions: decodeBuffer(part.positions, Uint16Array),
      normals: decodeBuffer(part.normals, Int8Array),
      indices: decodeBuffer(part.indices, Uint16Array)
    }));

    const bbox = header.bboxMm;
    const extent = Math.max(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2], 1);
    const quantScale = extent / 65534;
    const quantOffset = [bbox[0], bbox[1], bbox[2]];

    // Pass one: how big does each batch need to be? Allocating exactly once
    // avoids the repeated array growth that dominates this on a slow CPU.
    const plan = new Map(); // role -> array of batch specs
    const assignment = [];
    for (const placement of header.instances) {
      const part = parts[placement.part];
      let batches = plan.get(part.role);
      if (!batches) {
        batches = [];
        plan.set(part.role, batches);
      }
      let batch = batches[batches.length - 1];
      if (!batch || batch.vertexCount + part.vertexCount > MAX_BATCH_VERTICES) {
        batch = { role: part.role, vertexCount: 0, indexCount: 0 };
        batches.push(batch);
      }
      assignment.push({ placement, part, batch });
      batch.vertexCount += part.vertexCount;
      batch.indexCount += part.indexCount;
    }

    const batches = [];
    for (const roleBatches of plan.values()) {
      for (const batch of roleBatches) {
        batch.positions = new Uint16Array(batch.vertexCount * 3);
        batch.normals = new Int8Array(batch.vertexCount * 4);
        batch.indices = new Uint16Array(batch.indexCount);
        batch.writtenVertices = 0;
        batch.writtenIndices = 0;
        batches.push(batch);
      }
    }

    // Pass two: dequantise into the part's own space, apply the placement
    // matrix, requantise into module space. The part-local step keeps small
    // pieces precise; the module-level step is what the GPU consumes.
    for (const { placement, part, batch } of assignment) {
      const m = placement.m;
      const base = batch.writtenVertices;
      const ps = part.scale;
      const po = part.offset;

      for (let i = 0; i < part.vertexCount; i += 1) {
        const lx = part.positions[i * 3] * ps + po[0];
        const ly = part.positions[i * 3 + 1] * ps + po[1];
        const lz = part.positions[i * 3 + 2] * ps + po[2];
        const x = m[0] * lx + m[3] * ly + m[6] * lz + m[9];
        const y = m[1] * lx + m[4] * ly + m[7] * lz + m[10];
        const z = m[2] * lx + m[5] * ly + m[8] * lz + m[11];
        const out = (base + i) * 3;
        batch.positions[out] = quantise(x, quantOffset[0], quantScale);
        batch.positions[out + 1] = quantise(y, quantOffset[1], quantScale);
        batch.positions[out + 2] = quantise(z, quantOffset[2], quantScale);

        const nx = part.normals[i * 4] / 127;
        const ny = part.normals[i * 4 + 1] / 127;
        const nz = part.normals[i * 4 + 2] / 127;
        let wx = m[0] * nx + m[3] * ny + m[6] * nz;
        let wy = m[1] * nx + m[4] * ny + m[7] * nz;
        let wz = m[2] * nx + m[5] * ny + m[8] * nz;
        const length = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
        const normalOut = (base + i) * 4;
        batch.normals[normalOut] = clampByte(wx / length);
        batch.normals[normalOut + 1] = clampByte(wy / length);
        batch.normals[normalOut + 2] = clampByte(wz / length);
        batch.normals[normalOut + 3] = 0;
      }

      for (let i = 0; i < part.indexCount; i += 1) {
        batch.indices[batch.writtenIndices + i] = part.indices[i] + base;
      }

      batch.writtenVertices += part.vertexCount;
      batch.writtenIndices += part.indexCount;
    }

    return {
      bboxMm: bbox,
      quantScale,
      quantOffset,
      batches: batches.map((batch) => ({
        role: batch.role,
        vertexCount: batch.vertexCount,
        indexCount: batch.indexCount,
        positions: batch.positions,
        normals: batch.normals,
        indices: batch.indices
      }))
    };
  }

  function quantise(value, offset, scale) {
    const q = Math.round((value - offset) / scale);
    return q < 0 ? 0 : q > 65535 ? 65535 : q;
  }

  function clampByte(value) {
    const scaled = Math.round(value * 127);
    return scaled < -127 ? -127 : scaled > 127 ? 127 : scaled;
  }

  const cache = new Map();

  /**
   * Fetch and expand one module, at most once per page load. The promise is
   * cached rather than the result, so two near-simultaneous requests for the
   * same module share a single download.
   */
  function load(baseUrl, moduleId, version) {
    if (!cache.has(moduleId)) {
      const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
      const promise = fetch(`${baseUrl}/${encodeURIComponent(moduleId)}.json${suffix}`)
        .then((response) => {
          if (!response.ok) throw new Error(`${moduleId}: HTTP ${response.status}`);
          return response.json();
        })
        .then(expand)
        .catch((error) => {
          cache.delete(moduleId); // a transient failure must not be sticky
          throw error;
        });
      cache.set(moduleId, promise);
    }
    return cache.get(moduleId);
  }

  return { load, expand, ROLE_STEEL: 0, ROLE_SURFACE: 1, ROLE_FOOT: 2, ROLE_PAPER: 3 };
})();

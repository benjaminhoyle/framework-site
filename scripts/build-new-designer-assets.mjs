#!/usr/bin/env node
/**
 * Build the /new-designer runtime assets from the shelving-3d-pipeline repo.
 *
 *   node scripts/build-new-designer-assets.mjs [--pipeline /path/to/shelving-3d-pipeline]
 *
 * Produces:
 *   assets/shelving/catalog.json        module metadata + sockets + prices + finishes
 *   assets/shelving/modules/<id>.json   compact geometry bundle, one per module
 *
 * Why not ship the GLBs directly: the pipeline GLBs total 22MB, carry 20-40
 * separate meshes each (one draw call per leg/rail/washer), and the old builder
 * rebuilt per-instance materials AND ran EdgesGeometry over every mesh at
 * runtime. On a mid-range Android that is seconds of jank per placement. Here
 * each module is baked once, offline, into:
 *
 *   - geometry merged into at most 4 groups (one per colour role), so a module
 *     is 2-4 draw calls instead of 38,
 *   - positions quantised to uint16 and normals to int8 (a 4x shrink over
 *     float32, and the exact formats the GPU wants),
 *   - uint16 indices, so WebGL1 works with no extensions.
 *
 * The container is JSON with base64 vertex buffers rather than the obvious raw
 * binary. Netlify compresses by content type: application/json is brotli'd at
 * the edge, application/octet-stream is served as-is. Base64 costs about a third
 * more bytes before compression but roughly a quarter as many after it, which is
 * the number that reaches a phone on a slow connection.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PIPELINE = path.resolve(SITE_ROOT, "..", "shelving-3d-pipeline");

const argv = process.argv.slice(2);
const pipelineArg = argv.indexOf("--pipeline");
const PIPELINE = path.resolve(pipelineArg >= 0 ? argv[pipelineArg + 1] : DEFAULT_PIPELINE);

const OUT_DIR = path.join(SITE_ROOT, "assets", "shelving");
const OUT_MODULES = path.join(OUT_DIR, "modules");
const FORMAT = "framework-module-geometry@1";

// Colour roles, matching the desktop builder's classifyMeshRole(). Baked in
// here so the runtime never has to measure a mesh to decide how to paint it.
const ROLE_STEEL = 0;
const ROLE_SURFACE = 1;
const ROLE_FOOT = 2; // black rubber: the feet
const ROLE_PAPER = 3;
const ROLE_CORD = 4; // dark grey flex: the lamp cord
const SHELF_ROLES = new Set(["base", "extension", "adapter"]);

// Corner modules have no placement rules in the engine yet (generateCandidates
// returns [] for them), so shipping their geometry would be dead weight.
const SKIP_MODULE = (module) => Boolean(module.isCorner);

// ---------------------------------------------------------------------------
// glTF / GLB reading
// ---------------------------------------------------------------------------

const COMPONENT_TYPES = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 }
};
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`${file}: not a GLB (bad magic)`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buffer.subarray(start, start + length).toString("utf8"));
    else if (type === 0x004e4942) bin = buffer.subarray(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`${file}: no JSON chunk`);
  return { json, bin };
}

function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors[index];
  const component = COMPONENT_TYPES[accessor.componentType];
  const components = TYPE_COUNTS[accessor.type];
  if (!component || !components) throw new Error(`Unsupported accessor ${accessor.componentType}/${accessor.type}`);
  if (accessor.sparse) throw new Error("Sparse accessors are not supported");
  const view = gltf.bufferViews[accessor.bufferView];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const elementBytes = component.size * components;
  const stride = view.byteStride || elementBytes;
  const out = new component.array(accessor.count * components);

  if (stride === elementBytes) {
    // Tightly packed: one copy. bin.buffer needs bin.byteOffset added because
    // the chunk is a subarray of the whole file buffer, not its own allocation.
    const src = new component.array(bin.buffer, bin.byteOffset + base, accessor.count * components);
    out.set(src);
    return out;
  }
  for (let i = 0; i < accessor.count; i += 1) {
    const src = new component.array(bin.buffer, bin.byteOffset + base + i * stride, components);
    out.set(src, i * components);
  }
  return out;
}

// --- 4x4 column-major matrix helpers (glTF convention) ---------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1
  ];
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

function transformDirection(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z
  ];
}

/**
 * The pipeline GLBs wrap everything in a single "VisualSceneNode" whose matrix
 * converts Rhino mm (x = width, y = depth, z = height) into three.js metres.
 * We deliberately do NOT apply it: the placement engine, the socket coordinates
 * and the instance translations are all in Rhino mm, so the geometry stays in
 * Rhino mm too and the renderer does the single axis conversion at draw time.
 * Skipping the root is only correct if the root really is that conversion, so
 * this asserts the matrix rather than trusting the file.
 */
const EXPECTED_ROOT = [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1];

function assertExpectedRoot(matrix, file) {
  if (!matrix) throw new Error(`${file}: scene root has no matrix (expected the Rhino mm -> metres conversion)`);
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs(matrix[i] - EXPECTED_ROOT[i]) > 1e-6) {
      throw new Error(`${file}: unexpected scene root matrix; the Rhino-mm assumption no longer holds`);
    }
  }
}

/**
 * Every mesh *placement* in the file: which primitive, and where it sits in
 * Rhino mm.
 *
 * These GLBs reuse geometry heavily -- a base's leg/foot assembly is one mesh
 * referenced by four transformed nodes, and that one mesh is 4776 of the
 * module's 9848 unique triangles. Flattening placements into merged geometry
 * tripled the download for no visual gain, so placements stay separate here and
 * the runtime re-expands them.
 */
function collectPlacements(gltf, bin, file) {
  const scene = gltf.scenes[gltf.scene || 0];
  const roots = scene.nodes || [];
  if (roots.length !== 1) throw new Error(`${file}: expected exactly one scene root, found ${roots.length}`);
  assertExpectedRoot(gltf.nodes[roots[0]].matrix, file);

  const primitives = new Map(); // "mesh:primitive" -> geometry, read once
  const placements = [];
  const walk = (nodeIndex, parentMatrix) => {
    const node = gltf.nodes[nodeIndex];
    const matrix = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh != null) {
      (gltf.meshes[node.mesh].primitives || []).forEach((primitive, primitiveIndex) => {
        if (primitive.mode != null && primitive.mode !== 4) return; // triangles only
        const positionIndex = primitive.attributes?.POSITION;
        if (positionIndex == null) return;
        const key = `${node.mesh}:${primitiveIndex}`;
        if (!primitives.has(key)) {
          primitives.set(key, {
            key,
            positions: readAccessor(gltf, bin, positionIndex),
            normals: primitive.attributes?.NORMAL != null
              ? readAccessor(gltf, bin, primitive.attributes.NORMAL)
              : null,
            indices: primitive.indices != null ? readAccessor(gltf, bin, primitive.indices) : null
          });
        }
        placements.push({ primitive: primitives.get(key), matrix });
      });
    }
    for (const child of node.children || []) walk(child, matrix);
  };
  // Start at the root's children with identity: that is exactly "coordinates in
  // the root's own frame", i.e. Rhino mm.
  for (const child of gltf.nodes[roots[0]].children || []) walk(child, IDENTITY);
  return placements;
}

// ---------------------------------------------------------------------------
// Colour-role classification (ported from the desktop builder)
// ---------------------------------------------------------------------------

/**
 * Rhino mm axes: x = width, y = depth, z = height. The desktop builder wrote
 * this against three.js axes (y = height); the comparisons below are the same
 * rules with the axis names translated.
 */
function classifyPrimitive(bbox, moduleRole) {
  const width = bbox[3] - bbox[0];
  const depth = bbox[4] - bbox[1];
  const height = bbox[5] - bbox[2];
  const footprintMin = Math.min(width, depth);
  if (moduleRole === "lamp" && footprintMin > 120 && height > 100) return ROLE_PAPER;
  if (moduleRole === "base" && height < 50 && Math.max(width, depth) < 60 && bbox[5] < 20) return ROLE_FOOT;
  if (SHELF_ROLES.has(moduleRole) && height < 30 && footprintMin > 120) return ROLE_SURFACE;
  return ROLE_STEEL;
}

// ---------------------------------------------------------------------------
// Geometry merging + edge extraction
// ---------------------------------------------------------------------------

/**
 * Vertex-cluster decimation for over-tessellated small parts.
 *
 * The Rhino models carry lathe-quality detail that no shelf configurator can
 * show: a base's rubber foot is 4,776 triangles for a 50mm black pad that
 * covers about five phone pixels, and it is the single largest thing in the
 * file. Snapping vertices to a grid and collapsing the duplicates cuts those
 * parts by an order of magnitude with no visible change at builder zoom.
 *
 * The grid is sized from the part's SHORTEST axis, not its longest: sizing off
 * the longest would collapse a 20mm-diameter, 400mm-long leg tube into a flat
 * ribbon. Parts that do not shrink much are left untouched, so shelf boards and
 * other already-simple geometry keep their exact shape.
 */
const DECIMATE_MIN_TRIANGLES = 300;
const DECIMATE_MIN_SAVING = 0.25;
// Cells across the shortest axis. Higher keeps rounder tubes and costs bytes.
const DECIMATE_CELLS_ACROSS = 8;
const DECIMATE_CELL_MIN_MM = 1.2;
const DECIMATE_CELL_MAX_MM = 6;
// A grid cell that is coarse next to the local wall thickness welds a hollow
// shell's inside to its outside, which is what wrecked the lamp shade: its
// bounding box is 220mm across so the cell came out at the 8mm cap, but the
// paper is about a millimetre thick. Collapsing a surface destroys area, so
// comparing surface area before and after catches it without having to measure
// thickness. A faceted tube loses a few percent; a welded shell loses a third.
const DECIMATE_MIN_AREA_KEPT = 0.82;

function surfaceArea(positions, indices) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
  }
  return area;
}

/**
 * Smooth vertex normals from the faces that actually exist.
 *
 * Decimation moves vertices, so carrying the original normals across leaves
 * shading that disagrees with the new surface -- which is exactly the streaking
 * that showed up along the legs and the lamp shade. Recomputing them from the
 * decimated faces (area-weighted, which falls out of using the uncrossed
 * normal) makes a faceted tube read as round again.
 */
function recomputeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length > 1e-9) {
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }
  }
  return normals;
}

function decimate(positions, normals, indices) {
  const bounds = boundsOf(positions);
  const extents = [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]];
  const shortest = Math.min(...extents.filter((value) => value > 0.01));
  if (!Number.isFinite(shortest) || shortest <= 0) return null;
  const cell = Math.min(
    DECIMATE_CELL_MAX_MM,
    Math.max(DECIMATE_CELL_MIN_MM, shortest / DECIMATE_CELLS_ACROSS)
  );

  const cells = new Map();
  const vertexCell = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i += 1) {
    const key = `${Math.floor((positions[i * 3] - bounds[0]) / cell)},${Math.floor((positions[i * 3 + 1] - bounds[1]) / cell)},${Math.floor((positions[i * 3 + 2] - bounds[2]) / cell)}`;
    let entry = cells.get(key);
    if (!entry) {
      entry = { index: cells.size, position: [0, 0, 0], count: 0 };
      cells.set(key, entry);
    }
    entry.position[0] += positions[i * 3];
    entry.position[1] += positions[i * 3 + 1];
    entry.position[2] += positions[i * 3 + 2];
    entry.count += 1;
    vertexCell[i] = entry.index;
  }

  const outPositions = new Float32Array(cells.size * 3);
  for (const entry of cells.values()) {
    for (let axis = 0; axis < 3; axis += 1) outPositions[entry.index * 3 + axis] = entry.position[axis] / entry.count;
  }

  const outIndices = [];
  const seen = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertexCell[indices[i]];
    const b = vertexCell[indices[i + 1]];
    const c = vertexCell[indices[i + 2]];
    if (a === b || b === c || a === c) continue; // collapsed to a line
    const key = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(key)) continue; // both sides of a collapsed sliver
    seen.add(key);
    outIndices.push(a, b, c);
  }
  if (!outIndices.length) return null;
  if (outIndices.length / indices.length > 1 - DECIMATE_MIN_SAVING) return null;

  const decimatedIndices = Uint32Array.from(outIndices);
  const areaKept = surfaceArea(outPositions, decimatedIndices) / (surfaceArea(positions, indices) || 1);
  if (areaKept < DECIMATE_MIN_AREA_KEPT) return null; // the shape did not survive

  return {
    positions: outPositions,
    normals: recomputeNormals(outPositions, decimatedIndices),
    indices: decimatedIndices,
    vertexCount: cells.size
  };
}

/**
 * Average normals across coincident vertices, so a faceted surface shades as the
 * smooth form it approximates.
 *
 * The lamp shade is a fluted paper shell -- 80 flat facets whose radius swings
 * between 91mm and 106mm -- and each facet arrives with its own unwelded
 * vertices and its own flat normal. At the size a shade occupies on screen those
 * facets alias into the irregular vertical streaking that made it look broken.
 * Welding by position and averaging keeps the fluted silhouette while shading it
 * like the cylinder it reads as.
 *
 * Normals more than 90 degrees apart are not averaged together: the shell's
 * inside and outside meet at the rim, and blending those would light the rim
 * from nowhere.
 */
function smoothCoincidentNormals(positions, normals) {
  const groups = new Map();
  const count = positions.length / 3;
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(positions[i * 3] * 20)},${Math.round(positions[i * 3 + 1] * 20)},${Math.round(positions[i * 3 + 2] * 20)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Cluster the members by facing, then average within each cluster.
    const clusters = [];
    for (const index of members) {
      const n = [normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]];
      const cluster = clusters.find((entry) =>
        entry.sum[0] * n[0] + entry.sum[1] * n[1] + entry.sum[2] * n[2] > 0);
      if (cluster) {
        cluster.members.push(index);
        for (let axis = 0; axis < 3; axis += 1) cluster.sum[axis] += n[axis];
      } else {
        clusters.push({ members: [index], sum: n.slice() });
      }
    }
    for (const cluster of clusters) {
      const length = Math.hypot(cluster.sum[0], cluster.sum[1], cluster.sum[2]);
      if (length < 1e-9) continue;
      for (const index of cluster.members) {
        for (let axis = 0; axis < 3; axis += 1) normals[index * 3 + axis] = cluster.sum[axis] / length;
      }
    }
  }
}

/** One reusable primitive, in its own local mm space, ready to quantise. */
function preparePart(primitive) {
  const vertexCount = primitive.positions.length / 3;
  const positions = Float32Array.from(primitive.positions);
  const normals = new Float32Array(vertexCount * 3);
  if (primitive.normals) {
    for (let i = 0; i < vertexCount; i += 1) {
      const nx = primitive.normals[i * 3];
      const ny = primitive.normals[i * 3 + 1];
      const nz = primitive.normals[i * 3 + 2];
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[i * 3] = nx / length;
      normals[i * 3 + 1] = ny / length;
      normals[i * 3 + 2] = nz / length;
    }
  }
  let indices;
  if (primitive.indices) {
    indices = Uint32Array.from(primitive.indices);
  } else {
    indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i += 1) indices[i] = i;
  }
  // Primitives without NORMAL are rare here, but a zero normal would render as
  // a black facet; fall back to a flat face normal in that case.
  fillMissingNormals(positions, normals, indices);

  let part = { positions, normals, indices, vertexCount };
  if (indices.length / 3 > DECIMATE_MIN_TRIANGLES) part = decimate(positions, normals, indices) || part;
  return part;
}

function fillMissingNormals(positions, normals, indices) {
  const missing = [];
  for (let i = 0; i < normals.length; i += 3) {
    if (normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0) missing.push(i / 3);
  }
  if (!missing.length) return;
  const needed = new Set(missing);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    if (!needed.has(a) && !needed.has(b) && !needed.has(c)) continue;
    const normal = faceNormal(positions, a, b, c);
    for (const vertex of [a, b, c]) {
      if (!needed.has(vertex)) continue;
      normals[vertex * 3] = normal[0];
      normals[vertex * 3 + 1] = normal[1];
      normals[vertex * 3 + 2] = normal[2];
    }
  }
}

function faceNormal(positions, a, b, c) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

// ---------------------------------------------------------------------------
// Generated geometry
// ---------------------------------------------------------------------------

/** A closed vertical cylinder, as a standalone part. */
function cylinderPart(role, centreX, centreY, z0, z1, radius, segments) {
  const rings = segments;
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i < rings; i += 1) {
    const angle = (i / rings) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const x = centreX + nx * radius;
    const y = centreY + ny * radius;
    positions.push(x, y, z0, x, y, z1);
    normals.push(nx, ny, 0, nx, ny, 0);
  }
  for (let i = 0; i < rings; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = ((i + 1) % rings) * 2;
    const d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  // Caps, so the flex reads as solid where it meets the shade and the arm.
  const capBottom = positions.length / 3;
  positions.push(centreX, centreY, z0);
  normals.push(0, 0, -1);
  const capTop = positions.length / 3;
  positions.push(centreX, centreY, z1);
  normals.push(0, 0, 1);
  for (let i = 0; i < rings; i += 1) {
    const a = i * 2;
    const c = ((i + 1) % rings) * 2;
    indices.push(capBottom, c, a);
    indices.push(capTop, a + 1, c + 1);
  }
  return {
    role,
    vertexCount: positions.length / 3,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices)
  };
}

const LAMP_FLEX_DIAMETER_MM = 5;

/**
 * The lamp's flex: the pipeline model has the shade hanging in mid-air below the
 * arm with nothing joining them. Add a black cord on the shade's axis, from
 * inside the shade up to the arm's downward stub.
 *
 * Derived from the geometry rather than hard-coded numbers, so it still lands
 * correctly if the lamp model changes.
 */
function lampFlexPart(parts, instances, placementBounds) {
  let shade = null;
  let stub = null;
  instances.forEach((instance, index) => {
    const bounds = placementBounds[index];
    if (parts[instance.part].role === ROLE_PAPER) {
      shade = shade
        ? [Math.min(shade[0], bounds[0]), Math.min(shade[1], bounds[1]), Math.min(shade[2], bounds[2]),
          Math.max(shade[3], bounds[3]), Math.max(shade[4], bounds[4]), Math.max(shade[5], bounds[5])]
        : bounds.slice();
    }
  });
  if (!shade) return null;
  // The cord hangs on the shade's own axis. (An earlier version took the x
  // centre of whichever steel part it found above the shade, which matched the
  // long horizontal arm and put the cord halfway back along it.)
  const centreX = (shade[0] + shade[3]) / 2;
  const centreY = (shade[1] + shade[4]) / 2;

  // Where it meets the arm: the lowest steel geometry the shade's axis passes
  // through, so the cord stops at the arm rather than inside or beyond it.
  instances.forEach((instance, index) => {
    const bounds = placementBounds[index];
    if (parts[instance.part].role !== ROLE_STEEL) return;
    if (bounds[5] < shade[5]) return; // not above the shade
    if (centreX < bounds[0] || centreX > bounds[3]) return; // axis misses it
    if (centreY < bounds[1] || centreY > bounds[4]) return;
    if (!stub || bounds[2] < stub[2]) stub = bounds.slice();
  });

  // Start at the shade's mid-height, where a bulb would hang, so the cord reads
  // as continuous through the shade's open bottom.
  const z0 = (shade[2] + shade[5]) / 2;
  const z1 = (stub ? stub[2] : shade[5] + 120) + 8;
  if (z1 <= z0) return null;
  return cylinderPart(ROLE_CORD, centreX, centreY, z0, z1, LAMP_FLEX_DIAMETER_MM / 2, 10);
}

/**
 * How much of a module's shape actually moves when it is turned 180 degrees
 * about its socket pivot, as a fraction of its vertices.
 *
 * This is what decides whether the UI offers a Rotate action. The socket layout
 * is the wrong test: a top bar's two sockets swap places under a half turn, so
 * they look unchanged, while its cross bar flips from pointing forwards to
 * pointing backwards -- the single most important thing to be able to rotate.
 */
function rotationShift(parts, instances, pivot) {
  const points = new Set();
  const list = [];
  for (const instance of instances) {
    const part = parts[instance.part];
    const m = instance.matrix || instance.m;
    for (let v = 0; v < part.vertexCount; v += 1) {
      const [x, y, z] = transformPoint(m.length === 12 ? threeByFourToMatrix(m) : m,
        part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]);
      const key = `${Math.round(x * 2)},${Math.round(y * 2)},${Math.round(z * 2)}`;
      if (!points.has(key)) {
        points.add(key);
        list.push([x, y, z]);
      }
    }
  }
  if (!list.length) return 0;
  let moved = 0;
  for (const [x, y, z] of list) {
    const key = `${Math.round((2 * pivot[0] - x) * 2)},${Math.round((2 * pivot[1] - y) * 2)},${Math.round(z * 2)}`;
    if (!points.has(key)) moved += 1;
  }
  return moved / list.length;
}

function threeByFourToMatrix(m) {
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1];
}

// --- socket-derived geometry shared with the runtime -----------------------

function socketsOfKind(module, kind) {
  return (module.sockets || []).filter((socket) => socket.kind === kind);
}

function rotationSockets(module) {
  const bottom = socketsOfKind(module, "bottom");
  if (bottom.length) return bottom;
  const floor = socketsOfKind(module, "floor");
  if (floor.length) return floor;
  return socketsOfKind(module, "top");
}

/** The point a module turns about, in its own local mm. Mirrors the engine. */
function localPivot(module) {
  const sockets = rotationSockets(module);
  if (!sockets.length) return [0, 0];
  const xs = sockets.map((socket) => socket.normalized_mm[0]);
  const ys = sockets.map((socket) => socket.normalized_mm[1]);
  const pivotX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const pivotY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const origin = sockets.find((socket) =>
    Math.abs(socket.normalized_mm[0]) < 1 && Math.abs(socket.normalized_mm[1]) < 1) || sockets[0];
  return [
    origin.local_mm[0] + pivotX - origin.normalized_mm[0],
    origin.local_mm[1] + pivotY - origin.normalized_mm[1]
  ];
}

// ---------------------------------------------------------------------------
// Part deduplication
// ---------------------------------------------------------------------------

const SIGN_FLIPS = [];
for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) SIGN_FLIPS.push([sx, sy, sz]);

/**
 * A signature for one part under one axis-mirroring, translation-invariant.
 * Two parts sharing a signature are the same shape, so one can be dropped and
 * its placements re-pointed at the survivor.
 */
function partSignature(part, sign) {
  const { positions, normals, indices } = part;
  const min = [Infinity, Infinity, Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis] * sign[axis];
      if (value < min[axis]) min[axis] = value;
    }
  }
  const chunks = [];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      chunks.push(Math.round((positions[i + axis] * sign[axis] - min[axis]) * 100));
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) chunks.push(Math.round(normals[i + axis] * sign[axis] * 1000));
  }
  return { key: `${part.role}|${indices.join(",")}|${chunks.join(",")}`, min };
}

function worldBoundsOfPlacement(positions, matrix) {
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const point = transformPoint(matrix, positions[i], positions[i + 1], positions[i + 2]);
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < bbox[axis]) bbox[axis] = point[axis];
      if (point[axis] > bbox[axis + 3]) bbox[axis + 3] = point[axis];
    }
  }
  return bbox;
}

/**
 * Some pipeline GLBs keep the Rhino block instancing (a base's four legs are
 * one mesh under four transformed nodes); others were flattened by the
 * exporter into 38 standalone meshes, tripling the download for identical
 * shapes. This recovers the lost instancing by matching parts up to an axis
 * mirroring plus a translation -- exactly how the legs/feet differ.
 *
 * Every rewritten placement is re-checked against the world bounds it had
 * before; a group that fails is left alone rather than trusted.
 */
function dedupeParts(parts, placements) {
  const signatures = parts.map((part) => {
    let best = null;
    SIGN_FLIPS.forEach((sign) => {
      const candidate = partSignature(part, sign);
      if (!best || candidate.key < best.key) best = { ...candidate, sign };
    });
    return best;
  });

  const groups = new Map();
  signatures.forEach((signature, index) => {
    if (!groups.has(signature.key)) groups.set(signature.key, []);
    groups.get(signature.key).push(index);
  });

  // partIndex -> { representative, D, c }: p_part = D * p_representative + c
  const remap = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const representative = members[0];
    const rep = signatures[representative];
    const rewrites = [];
    let ok = true;
    for (const member of members.slice(1)) {
      const own = signatures[member];
      const d = [own.sign[0] * rep.sign[0], own.sign[1] * rep.sign[1], own.sign[2] * rep.sign[2]];
      const c = [
        own.sign[0] * (own.min[0] - rep.min[0]),
        own.sign[1] * (own.min[1] - rep.min[1]),
        own.sign[2] * (own.min[2] - rep.min[2])
      ];
      // Verify against the part's own vertices before trusting the algebra.
      const source = parts[member].positions;
      const target = parts[representative].positions;
      for (let i = 0; i < source.length && ok; i += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          if (Math.abs(d[axis] * target[i + axis] + c[axis] - source[i + axis]) > 0.02) ok = false;
        }
      }
      rewrites.push({ member, representative, d, c });
    }
    if (!ok) continue;
    for (const rewrite of rewrites) remap.set(rewrite.member, rewrite);
  }
  if (!remap.size) return { parts, placements, merged: 0 };

  const rewritten = placements.map((placement) => {
    const rule = remap.get(placement.part);
    if (!rule) return placement;
    const m = placement.matrix;
    // world = M * (D*p + c) = (M*D) * p + (M*c)
    const matrix = [
      m[0] * rule.d[0], m[1] * rule.d[0], m[2] * rule.d[0], 0,
      m[4] * rule.d[1], m[5] * rule.d[1], m[6] * rule.d[1], 0,
      m[8] * rule.d[2], m[9] * rule.d[2], m[10] * rule.d[2], 0,
      ...transformPoint(m, rule.c[0], rule.c[1], rule.c[2]), 1
    ];
    const before = worldBoundsOfPlacement(parts[placement.part].positions, m);
    const after = worldBoundsOfPlacement(parts[rule.representative].positions, matrix);
    for (let i = 0; i < 6; i += 1) {
      if (Math.abs(before[i] - after[i]) > 0.05) return placement; // keep the original
    }
    return { part: rule.representative, matrix };
  });

  // Drop parts nothing points at any more, and renumber.
  const used = new Set(rewritten.map((placement) => placement.part));
  const keep = parts.map((_, index) => index).filter((index) => used.has(index));
  const renumber = new Map(keep.map((index, position) => [index, position]));
  return {
    parts: keep.map((index) => parts[index]),
    placements: rewritten.map((placement) => ({ part: renumber.get(placement.part), matrix: placement.matrix })),
    merged: parts.length - keep.length
  };
}

// ---------------------------------------------------------------------------
// Bundle writer
// ---------------------------------------------------------------------------

function boundsOf(positions) {
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis];
      if (value < bbox[axis]) bbox[axis] = value;
      if (value > bbox[axis + 3]) bbox[axis + 3] = value;
    }
  }
  if (!Number.isFinite(bbox[0])) return [0, 0, 0, 0, 0, 0];
  return bbox;
}

function quantise(values, offset, scale) {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const q = Math.round((values[i + axis] - offset[axis]) / scale);
      out[i + axis] = Math.min(65535, Math.max(0, q));
    }
  }
  return out;
}

function quantiseNormals(normals) {
  // int8, 4 bytes per vertex: the 4th byte is padding that keeps every vertex
  // 4-byte aligned, which some mobile GL drivers are much happier with.
  const out = new Int8Array((normals.length / 3) * 4);
  for (let i = 0; i < normals.length / 3; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      out[i * 4 + axis] = Math.max(-127, Math.min(127, Math.round(normals[i * 3 + axis] * 127)));
    }
    out[i * 4 + 3] = 0;
  }
  return out;
}

/** Little-endian bytes of a typed array, base64-encoded. */
function encodeBuffer(typedArray) {
  return Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).toString("base64");
}

function buildModuleBundle(parts, instances, bboxMm) {
  return {
    format: FORMAT,
    bboxMm,
    parts: parts.map((part) => {
      if (part.vertexCount > 65535) {
        throw new Error(`part has ${part.vertexCount} vertices; uint16 indices cannot address it`);
      }
      // Quantised in the part's OWN bounds: a 20mm washer keeps sub-micron
      // precision instead of inheriting a metre-wide module's step size. The
      // runtime dequantises, applies the placement matrix, and requantises into
      // module space, so this error never accumulates.
      const bounds = boundsOf(part.positions);
      const offset = [bounds[0], bounds[1], bounds[2]];
      const extent = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2], 0.001);
      const scale = extent / 65534;
      return {
        role: part.role,
        vertexCount: part.vertexCount,
        indexCount: part.indices.length,
        scale,
        offset: offset.map((value) => Number(value.toFixed(4))),
        positions: encodeBuffer(quantise(part.positions, offset, scale)),
        normals: encodeBuffer(quantiseNormals(part.normals)),
        indices: encodeBuffer(Uint16Array.from(part.indices))
      };
    }),
    instances
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function loadPipelineCatalog() {
  const file = path.join(PIPELINE, "app", "js", "shelving-builder-v2-data.js");
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("var data =");
  const end = source.lastIndexOf("};");
  if (start < 0 || end < 0) throw new Error(`${file}: could not find the data literal`);
  return JSON.parse(source.slice(start + "var data =".length, end + 1));
}

/** Round every number in a structure; the runtime works to 1mm tolerance. */
function trim(value, places = 2) {
  if (typeof value === "number") return Number(value.toFixed(places));
  if (Array.isArray(value)) return value.map((entry) => trim(entry, places));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = trim(entry, places);
    return out;
  }
  return value;
}


/**
 * Builder colours, read from the /designer page's own theme table.
 *
 * Two palettes serve two purposes and are deliberately kept apart:
 *
 *   - `steelHex` / `mdfHex` come from the pipeline's shared/finishes.json and
 *     are the real material colours the Blender renders and the DAM use. Those
 *     must not drift.
 *   - `builder` comes from designer-engine.js's THEME_* sets, which is what the
 *     existing /designer page draws with. Using them here means the two site
 *     designers look like the same product.
 *
 * finishes.json's `siteTheme` is the join between them, so neither side has to
 * know about the other.
 */
function loadDesignerThemeColors() {
  const file = path.join(SITE_ROOT, "js", "designer-engine.js");
  const source = fs.readFileSync(file, "utf8");
  const themes = {};
  // Each THEME_n block up to the next one; pull the fills we need by set name.
  const blocks = source.split(/\n\s*(THEME_\d+):\s*\{/).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    const name = blocks[i];
    const body = blocks[i + 1];
    const pick = (set) => {
      const match = body.match(new RegExp(`${set}:\\s*\\{[^}]*fill:\\s*'(#[0-9a-fA-F]{3,8})'`));
      return match ? match[1] : null;
    };
    const surface = pick("SET_1");
    const steel = pick("SET_4");
    if (!surface || !steel) throw new Error(`${file}: ${name} is missing SET_1/SET_4 fills`);
    themes[name] = { surface, steel, edge: pick("SET_2"), postBase: pick("SET_5") };
  }
  if (!Object.keys(themes).length) throw new Error(`${file}: found no THEME_* palettes`);
  return themes;
}

/**
 * Price for a module, filling in from its other cut where the list is missing
 * one. A trimmed cut is the same unit shortened and sells for the same money,
 * so the two are always priced together -- but the generated list only carries
 * whichever one the shop happens to have listed, which left pieces reading
 * "on request" in the designer for no real reason.
 */
function priceFor(prices, id) {
  if (prices[id] != null) return prices[id];
  const pair = id.endsWith("_trimmed") ? id.slice(0, -"_trimmed".length) : `${id}_trimmed`;
  return prices[pair] ?? null;
}

/** Front-to-back span of a module's own support sockets, in mm. */
function depthSpan(module) {
  const sockets = rotationSockets(module);
  if (!sockets.length) return 0;
  const ys = sockets.map((socket) => socket.normalized_mm[1]);
  return Math.max(...ys) - Math.min(...ys);
}

function bottomRowCount(module) {
  const rows = new Set(rotationSockets(module).map((socket) => Math.round(socket.normalized_mm[1])));
  return rows.size;
}

function buildCatalog(pipeline, builtModules, rotationShifts) {
  const prices = JSON.parse(fs.readFileSync(path.join(PIPELINE, "shared", "prices.json"), "utf8"));
  const finishes = JSON.parse(fs.readFileSync(path.join(PIPELINE, "shared", "finishes.json"), "utf8"));
  const vocabulary = JSON.parse(fs.readFileSync(path.join(PIPELINE, "shared", "module-vocabulary.json"), "utf8"));
  const displayNames = new Map(vocabulary.types.map((type) => [type.type, type.displayName]));
  const themes = loadDesignerThemeColors();

  const modules = {};
  for (const [id, module] of Object.entries(pipeline.modules)) {
    if (!builtModules.has(id)) continue;
    modules[id] = trim({
      id,
      canonicalId: module.canonicalId || id,
      label: displayNames.get(id) || module.label || id,
      role: module.role,
      family: module.family || null,
      widthKind: module.widthKind || null,
      depthKind: module.depthKind || null,
      trimmed: id.endsWith("_trimmed"),
      widthSpanMm: module.widthSpanMm || 0,
      // How far the module's own sockets span front to back. Used to line up
      // the BACKS of units of different depths against a wall, rather than
      // their fronts.
      depthSpanMm: depthSpan(module),
      // Distinct depth rows the module rests on. A piece with only one (a top
      // bar, a lamp) has to be turned to face into the shelf depending on
      // whether it lands on the front row or the back row.
      bottomRowCount: bottomRowCount(module),
      // Fraction of the module's shape that moves under a half turn; the UI
      // offers a Rotate action above a threshold. See rotationShift().
      rotation180Shift: rotationShifts.get(id) || 0,
      dimensionsMm: module.dimensionsMm || null,
      bboxMm: module.bboxMm || null,
      localPivotMm: localPivot(module),
      sockets: (module.sockets || []).map((socket) => ({
        id: socket.id,
        kind: socket.kind,
        local_mm: socket.local_mm,
        normalized_mm: socket.normalized_mm
      })),
      horizontalBoxes: (module.horizontalBoxes || []).map((box) => ({ kind: box.kind, bbox: box.bbox })),
      priceKsh: priceFor(prices.prices, id)
    });
  }

  const aliases = {};
  for (const [from, to] of Object.entries(pipeline.aliases || {})) {
    if (modules[to]) aliases[from] = to;
  }

  return {
    schema: "framework-new-designer-catalog@1",
    generatedAt: new Date().toISOString().slice(0, 10),
    units: "millimetres",
    currency: prices.currency || "KSh",
    accessoryPrices: { bookend: prices.prices.bookend ?? null },
    finishes: finishes.finishes.map((finish) => {
      const theme = themes[finish.siteTheme];
      if (!theme) throw new Error(`no ${finish.siteTheme} palette in designer-engine.js for finish "${finish.id}"`);
      return {
        id: finish.id,
        displayName: finish.displayName,
        // Real material colours, for renders and the DAM.
        steelHex: finish.steelHex,
        mdfHex: finish.mdfHex,
        // Screen colours, matching the /designer page.
        builder: theme
      };
    }),
    aliases,
    modules
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(PIPELINE)) {
    throw new Error(`Pipeline repo not found at ${PIPELINE} (pass --pipeline <path>)`);
  }
  fs.mkdirSync(OUT_MODULES, { recursive: true });

  const pipeline = loadPipelineCatalog();
  const built = new Set();
  const report = [];
  const rotationShifts = new Map();
  let totalBytes = 0;

  for (const [id, module] of Object.entries(pipeline.modules)) {
    if (SKIP_MODULE(module)) continue;
    if (!module.glb) {
      console.warn(`skip ${id}: no GLB in the pipeline catalog`);
      continue;
    }
    const glbPath = path.join(PIPELINE, module.glb.replace(/^\//, ""));
    if (!fs.existsSync(glbPath)) {
      console.warn(`skip ${id}: ${glbPath} is missing`);
      continue;
    }

    const { json, bin } = readGlb(glbPath);
    const placements = collectPlacements(json, bin, glbPath);
    if (!placements.length) {
      console.warn(`skip ${id}: no triangle primitives`);
      continue;
    }

    const parts = [];
    const partIndex = new Map();
    const instances = [];
    const placementBounds = [];
    const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

    for (const placement of placements) {
      const placed = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const source = placement.primitive.positions;
      for (let i = 0; i < source.length; i += 3) {
        const point = transformPoint(placement.matrix, source[i], source[i + 1], source[i + 2]);
        for (let axis = 0; axis < 3; axis += 1) {
          if (point[axis] < placed[axis]) placed[axis] = point[axis];
          if (point[axis] > placed[axis + 3]) placed[axis + 3] = point[axis];
        }
      }
      for (let axis = 0; axis < 3; axis += 1) {
        if (placed[axis] < bbox[axis]) bbox[axis] = placed[axis];
        if (placed[axis + 3] > bbox[axis + 3]) bbox[axis + 3] = placed[axis + 3];
      }

      // Role depends on where a placement sits (a foot is only a foot near the
      // floor), so the same primitive used twice can land in two roles; keying
      // parts by role too keeps each one single-coloured.
      const role = classifyPrimitive(placed, module.role);
      const key = `${placement.primitive.key}:${role}`;
      if (!partIndex.has(key)) {
        partIndex.set(key, parts.length);
        const part = Object.assign(preparePart(placement.primitive), { role });
        // The fluted lamp shade is the one surface fine enough to alias.
        if (role === ROLE_PAPER) smoothCoincidentNormals(part.positions, part.normals);
        parts.push(part);
      }
      instances.push({ part: partIndex.get(key), matrix: placement.matrix });
      placementBounds.push(placed);
    }

    // The pipeline lamp has no cord between its shade and its arm; add one.
    if (module.role === "lamp") {
      const flex = lampFlexPart(parts, instances, placementBounds);
      if (flex) {
        parts.push(flex);
        instances.push({ part: parts.length - 1, matrix: IDENTITY });
        placementBounds.push(boundsOf(flex.positions));
      } else {
        console.warn(`${id}: could not work out where the lamp flex goes`);
      }
    }

    rotationShifts.set(id, rotationShift(parts, instances, localPivot(module)));

    const deduped = dedupeParts(parts, instances);
    const bundle = buildModuleBundle(
      deduped.parts,
      // 3x4, column-major: the three basis columns then the translation. The
      // glTF matrix's fourth row is always (0,0,0,1) for these files.
      deduped.placements.map((placement) => ({
        part: placement.part,
        m: [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14].map((index) => Number(placement.matrix[index].toFixed(4)))
      })),
      bbox.map((value) => Number(value.toFixed(3)))
    );
    const serialised = JSON.stringify(bundle);
    fs.writeFileSync(path.join(OUT_MODULES, `${id}.json`), serialised);
    built.add(id);
    totalBytes += serialised.length;
    report.push({
      id,
      kb: Math.round(serialised.length / 1024),
      sourceKb: Math.round(fs.statSync(glbPath).size / 1024),
      parts: deduped.parts.length,
      instances: deduped.placements.length,
      tris: deduped.placements.reduce((sum, placement) => sum + deduped.parts[placement.part].indices.length / 3, 0)
    });
  }

  const catalog = buildCatalog(pipeline, built, rotationShifts);
  fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), JSON.stringify(catalog));

  report.sort((a, b) => b.kb - a.kb);
  console.log(`${"module".padEnd(32)}${"kb".padStart(6)}${"was".padStart(7)}${"parts".padStart(7)}${"inst".padStart(6)}${"tris".padStart(8)}`);
  for (const row of report) {
    console.log(
      `${row.id.padEnd(32)}${String(row.kb).padStart(6)}${String(row.sourceKb).padStart(7)}${String(row.parts).padStart(7)}${String(row.instances).padStart(6)}${String(row.tris).padStart(8)}`
    );
  }
  console.log(`\n${built.size} modules, ${Math.round(totalBytes / 1024)}KB of geometry`);
  console.log(`catalog.json ${Math.round(fs.statSync(path.join(OUT_DIR, "catalog.json")).size / 1024)}KB`);
}

main();

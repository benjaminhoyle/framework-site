/**
 * Building blocks for the props the assembly stories put on a shelf: books,
 * decorative objects, a lamp's light. Low-poly on purpose, so every face is
 * flat and shaded as one plane, the way the renderer draws the shelf.
 *
 * A mesh is a Map from colour role to { positions, normals, indices }; the
 * renderer paints role 0 with an instance's `steel`, role 1 with its `surface`,
 * role 2 its near-black and role 3 its paper cream. encodeBundle() writes a
 * mesh in framework-module-geometry@1, which js/builder/geometry.js expands.
 */

const TAU = Math.PI * 2;

function bucket(mesh, role) {
  if (!mesh.has(role)) mesh.set(role, { positions: [], normals: [], indices: [] });
  return mesh.get(role);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/** A flat polygon, as a fan, with one normal (worked out from it if not given). */
export function polygon(mesh, role, points, normal) {
  const n = normal || unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
  const part = bucket(mesh, role);
  const base = part.positions.length / 3;
  for (const p of points) {
    part.positions.push(p[0], p[1], p[2]);
    part.normals.push(n[0], n[1], n[2]);
  }
  for (let i = 1; i < points.length - 1; i += 1) part.indices.push(base, base + i, base + i + 1);
}

/** Four corners in order round the face, with one normal or one per corner. */
export function quad(mesh, role, corners, normal) {
  const part = bucket(mesh, role);
  const base = part.positions.length / 3;
  corners.forEach((corner, i) => {
    part.positions.push(corner[0], corner[1], corner[2]);
    const n = Array.isArray(normal[0]) ? normal[i] : normal;
    part.normals.push(n[0], n[1], n[2]);
  });
  part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function box(mesh, role, x0, y0, z0, x1, y1, z1) {
  quad(mesh, role, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  quad(mesh, role, [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0]);
  quad(mesh, role, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0]);
  quad(mesh, role, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
  quad(mesh, role, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  quad(mesh, role, [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], [0, 0, -1]);
}

/**
 * A ring of `sides` flat faces from radius r0 at z0 to r1 at z1, about
 * (cx, cy): a cylinder, a cone's frustum, a bowl, a vase's shoulder. Capped
 * top and bottom unless told not to.
 */
export function prism(mesh, role, { sides = 12, r0, r1 = r0, z0, z1, cx = 0, cy = 0, phase = 0, caps = true }) {
  const ring = (r, z) => Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * TAU;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
  });
  const lo = ring(r0, z0);
  const hi = ring(r1, z1);
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    const n = unit(cross(sub(lo[j], lo[i]), sub(hi[i], lo[i])));
    quad(mesh, role, [lo[i], lo[j], hi[j], hi[i]], n);
  }
  if (caps) {
    if (r1 > 0) polygon(mesh, role, hi, [0, 0, 1]);
    if (r0 > 0) polygon(mesh, role, lo.slice().reverse(), [0, 0, -1]);
  }
}

/** A box of side `size` standing on z0, turned `degrees` about its vertical axis. */
export function turnedBox(mesh, role, { size, z0, degrees = 0, cx = 0, cy = 0 }) {
  const h = size / 2;
  const a = (degrees * Math.PI) / 180;
  const corner = (x, y, z) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a), z];
  const z1 = z0 + size;
  const b = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (let i = 0; i < 4; i += 1) {
    const [x0, y0] = b[i];
    const [x1, y1] = b[(i + 1) % 4];
    const face = [corner(x0, y0, z0), corner(x1, y1, z0), corner(x1, y1, z1), corner(x0, y0, z1)];
    quad(mesh, role, face, unit(cross(sub(face[1], face[0]), sub(face[3], face[0]))));
  }
  polygon(mesh, role, b.map(([x, y]) => corner(x, y, z1)), [0, 0, 1]);
  polygon(mesh, role, b.slice().reverse().map(([x, y]) => corner(x, y, z0)), [0, 0, -1]);
}

/** A square pyramid on z0: base `size`, apex `height` above it. */
export function pyramid(mesh, role, { size, height, z0 = 0, cx = 0, cy = 0 }) {
  const h = size / 2;
  const base = [[cx - h, cy - h, z0], [cx + h, cy - h, z0], [cx + h, cy + h, z0], [cx - h, cy + h, z0]];
  const apex = [cx, cy, z0 + height];
  for (let i = 0; i < 4; i += 1) polygon(mesh, role, [base[i], base[(i + 1) % 4], apex]);
  polygon(mesh, role, base.slice().reverse(), [0, 0, -1]);
}

/** An icosahedron, subdivided `detail` times and pushed out to radius r: a faceted ball. */
export function icosphere(mesh, role, { r, cx = 0, cy = 0, cz = 0, detail = 1 }) {
  const t = (1 + Math.sqrt(5)) / 2;
  let vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6],
    [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let level = 0; level < detail; level += 1) {
    const next = [];
    const cache = new Map();
    const middle = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(key)) {
        const m = unit([(vertices[a][0] + vertices[b][0]) / 2, (vertices[a][1] + vertices[b][1]) / 2, (vertices[a][2] + vertices[b][2]) / 2]);
        cache.set(key, vertices.push(m) - 1);
      }
      return cache.get(key);
    };
    for (const [a, b, c] of faces) {
      const ab = middle(a, b);
      const bc = middle(b, c);
      const ca = middle(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  for (const face of faces) {
    const points = face.map((i) => [cx + vertices[i][0] * r, cy + vertices[i][1] * r, cz + vertices[i][2] * r]);
    const centre = unit([
      points.reduce((s, p) => s + p[0] - cx, 0), points.reduce((s, p) => s + p[1] - cy, 0), points.reduce((s, p) => s + p[2] - cz, 0)
    ]);
    let n = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    if (n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] < 0) n = n.map((v) => -v);
    polygon(mesh, role, points, n);
  }
}

/** A square-section bar from one point to another: a ray, a stroke. */
export function beam(mesh, role, from, to, thick) {
  const d = unit(sub(to, from));
  const helper = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit(cross(d, helper));
  const v = cross(d, u);
  const h = thick / 2;
  const corner = (p, su, sv) => [p[0] + (u[0] * su + v[0] * sv) * h, p[1] + (u[1] * su + v[1] * sv) * h, p[2] + (u[2] * su + v[2] * sv) * h];
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const a = signs.map(([su, sv]) => corner(from, su, sv));
  const b = signs.map(([su, sv]) => corner(to, su, sv));
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    const face = [a[i], a[j], b[j], b[i]];
    quad(mesh, role, face, unit(cross(sub(face[1], face[0]), sub(face[3], face[0]))));
  }
  polygon(mesh, role, b.slice(), d);
  polygon(mesh, role, a.slice().reverse(), d.map((x) => -x));
}

// ----------------------------------------------------------- transforms

export function transform(mesh, point, normal) {
  for (const part of mesh.values()) {
    for (let i = 0; i < part.positions.length; i += 3) {
      const p = point([part.positions[i], part.positions[i + 1], part.positions[i + 2]]);
      const n = normal([part.normals[i], part.normals[i + 1], part.normals[i + 2]]);
      part.positions.splice(i, 3, p[0], p[1], p[2]);
      part.normals.splice(i, 3, n[0], n[1], n[2]);
    }
  }
}

export function bounds(mesh) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const part of mesh.values()) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        b[axis] = Math.min(b[axis], part.positions[i + axis]);
        b[axis + 3] = Math.max(b[axis + 3], part.positions[i + axis]);
      }
    }
  }
  return b;
}

// -------------------------------------------------------------- encoding

const b64 = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");

function encodePart(role, part) {
  const count = part.positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < part.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], part.positions[i + axis]);
      max[axis] = Math.max(max[axis], part.positions[i + axis]);
    }
  }
  // Offset rounded down and scale rounded up, both before quantising, so the
  // numbers written are the numbers the loader decodes with.
  const offset = min.map((n) => Math.floor(n * 10000) / 10000);
  const extent = Math.max(1e-3, ...max.map((n, axis) => n - offset[axis]));
  const scale = Math.ceil((extent / 65535) * 1e9) / 1e9;
  const positions = new Uint16Array(count * 3);
  const normals = new Int8Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const q = Math.round((part.positions[i * 3 + axis] - offset[axis]) / scale);
      positions[i * 3 + axis] = Math.max(0, Math.min(65535, q));
    }
    const nx = part.normals[i * 3];
    const ny = part.normals[i * 3 + 1];
    const nz = part.normals[i * 3 + 2];
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[i * 4] = Math.round((nx / length) * 127);
    normals[i * 4 + 1] = Math.round((ny / length) * 127);
    normals[i * 4 + 2] = Math.round((nz / length) * 127);
  }
  return {
    role,
    vertexCount: count,
    indexCount: part.indices.length,
    scale,
    offset,
    positions: b64(positions),
    normals: b64(normals),
    indices: b64(new Uint16Array(part.indices))
  };
}

export function encodeBundle(mesh) {
  const b = bounds(mesh);
  const roles = [...mesh.keys()].sort((x, y) => x - y);
  const parts = roles.map((role) => encodePart(role, mesh.get(role)));
  return {
    format: "framework-module-geometry@1",
    bboxMm: [...b.slice(0, 3).map((n) => Math.floor(n * 100) / 100), ...b.slice(3).map((n) => Math.ceil(n * 100) / 100)],
    parts,
    instances: parts.map((_, part) => ({ part, m: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }))
  };
}

/** Decode a bundle part's positions, for measuring an existing module. */
export function partBounds(part) {
  const bytes = Buffer.from(part.positions, "base64");
  const q = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < q.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const v = part.offset[axis] + q[i + axis] * part.scale;
      b[axis] = Math.min(b[axis], v);
      b[axis + 3] = Math.max(b[axis + 3], v);
    }
  }
  return b;
}

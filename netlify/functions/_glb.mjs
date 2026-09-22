/**
 * A design, as a glTF binary (GLB), for AR.
 *
 * The whole point of this file is that it invents nothing. `/builder` already
 * holds, on the customer's phone, exactly the data a GLB carries: the placement
 * engine says where each module stands, and `js/builder/geometry.js` expands a
 * module's bundle into placed, per-colour-role vertex buffers. A GLB of a
 * design is that data plus a header, so both of those are imported and driven
 * here rather than re-implemented. If the shelf a customer stands in their
 * sitting room disagrees with the one they designed, it will be because the
 * engine changed, not because a second copy of the maths drifted.
 *
 * Three things are this file's own, and each is a decision worth naming.
 *
 * **Axes and units.** The builder works in millimetres, Z up, which is Rhino's
 * convention and the workshop's. glTF is metres, Y up. The swap is
 * (x, y, z) -> (x, z, -y), a rotation about X, which keeps the handedness and so
 * leaves every normal and every winding order alone. Getting this wrong does not
 * look wrong on a screen -- it looks like a shelf lying on its back on the floor
 * of somebody's flat, at true size.
 *
 * **Geometry once, placed many times.** A run of six units is six nodes
 * pointing at one mesh, not six copies of it, and that -- not any clever
 * encoding -- is what makes a big design about the size of a small one. The 77
 * catalogue designs come out at a mean of 401 kB, 137 kB over the wire once the
 * function gzips them.
 *
 * `quantise: true` writes the vertex data in the form geometry.js already
 * produced it (uint16 positions, int8 normals) through KHR_mesh_quantization,
 * folding the dequantisation into each node's matrix the way renderer.js folds
 * it into its model matrix. Measured over the same 77: 213 kB mean, 119 kB
 * gzipped -- 47% off the file and about half the memory a phone gives the
 * buffers, but only 13% off what actually travels. It is not the default,
 * because 18 kB is not worth an `extensionsRequired` that a viewer somewhere
 * refuses to open, and nothing has been tried on a real handset yet. The flag
 * is there so that one phone test can settle it.
 *
 * **Colour.** A GLB is lit by whoever draws it, so its materials carry the real
 * powder-coat and MDF colours (`steelHex` / `mdfHex`), the same ones the Blender
 * renders and the DAM use -- not the `builder` palette, which is pre-scaled to
 * compensate for the WebGL renderer's own light term and would come out pale
 * under a phone's estimated room lighting. baseColorFactor is linear, so each
 * hex is converted out of sRGB on the way in; skipping that step is the usual
 * reason an exported model looks washed out.
 */

import engine from "../../js/builder/engine.js";
import geometryLoader from "../../js/builder/geometry.js";

export { engine, geometryLoader };

// --------------------------------------------------------------- materials --

/*
 * The roles a vertex can have. 0 to 3 are geometry.js's own; 4 is the lamp's
 * cord, which renderer.js names and geometry.js does not.
 */
const ROLE_STEEL = 0;
const ROLE_SURFACE = 1;
const ROLE_FOOT = 2;
const ROLE_PAPER = 3;
const ROLE_CORD = 4;

// The three colours renderer.js holds outside the finishes, verbatim. A foot is
// the same black whatever the shelf is painted; so is a lamp's flex.
const FOOT_COLOR = "#15181a";
const PAPER_COLOR = "#fdf3e3";
const CORD_COLOR = "#4c5254";
// A piece left out of the invoice. /builder hatches it; a hatch is a screen-space
// effect with nowhere to live in a material, so in AR it is the same pale
// neutral, flat.
const OMITTED_COLOR = "#eef1f1";

/*
 * How each material answers light. Powder coat on steel tube is a satin paint
 * over a curved surface: not a mirror, not chalk. MDF with a matt lacquer is
 * rougher and flatter. Nothing here is metallic -- there is no bare steel on a
 * finished unit, and a metallic material under model-viewer's estimated room
 * lighting reflects a room that is not there.
 */
const SURFACES = {
  [ROLE_STEEL]: { roughness: 0.55, metallic: 0.0 },
  [ROLE_SURFACE]: { roughness: 0.78, metallic: 0.0 },
  [ROLE_FOOT]: { roughness: 0.85, metallic: 0.0 },
  [ROLE_PAPER]: { roughness: 0.92, metallic: 0.0 },
  [ROLE_CORD]: { roughness: 0.7, metallic: 0.0 }
};

const ROLE_NAMES = {
  [ROLE_STEEL]: "frame",
  [ROLE_SURFACE]: "board",
  [ROLE_FOOT]: "foot",
  [ROLE_PAPER]: "shade",
  [ROLE_CORD]: "cord"
};

/** sRGB hex -> linear RGBA, which is what baseColorFactor is defined in. */
export function linearRgba(hex) {
  const value = parseInt(String(hex).replace("#", ""), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return channels
    .map((channel) => channel / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    .concat(1);
}

function finishById(catalog, id) {
  return (catalog.finishes || []).find((entry) => entry.id === id) || (catalog.finishes || [])[0];
}

/**
 * The base colour for one role in one finish.
 *
 * `palette: "builder"` asks for the screen palette instead, scaled the way
 * app.js scales it. It is not what gets served -- it exists so the two can be
 * put side by side when somebody asks why the AR shelf is not pixel-identical to
 * the one in the builder.
 */
function roleColor(catalog, finishId, role, options) {
  if (options.muted) return OMITTED_COLOR;
  const finish = finishById(catalog, finishId);
  if (role === ROLE_FOOT) return FOOT_COLOR;
  if (role === ROLE_PAPER) return PAPER_COLOR;
  if (role === ROLE_CORD) return CORD_COLOR;
  if (options.palette === "builder" && finish && finish.builder) {
    // app.js's shaderPalette: the builder hexes are scaled up because its
    // shader's light term lands a shelf top at about 0.94 of base and a post at
    // about 0.79.
    return role === ROLE_SURFACE
      ? scaleHex(finish.builder.surface, 1.07)
      : scaleHex(finish.builder.steel, 1.26);
  }
  if (!finish) return "#888888";
  return role === ROLE_SURFACE ? finish.mdfHex : finish.steelHex;
}

function scaleHex(hex, gain) {
  const value = parseInt(String(hex).replace("#", ""), 16);
  return `#${[(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map((channel) => Math.min(255, Math.round(channel * gain)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

// ------------------------------------------------------------------ scene ---

/**
 * The placed pieces, as the renderer sees them.
 *
 * A port of renderInstance/bookendSceneEntries in js/builder/app.js, which is
 * not importable here (it is the page). The two things it carries that a
 * serialised design does not are the rotation pivot -- the engine and the
 * renderer must turn a piece about the same point or a rotated unit and its
 * sockets disagree -- and the bookends, which are not pieces at all: the design
 * holds a count and the engine works out which ends they hang on.
 */
export function sceneEntries(catalog, state) {
  const entries = state.instances.map((instance) => {
    const module = catalog.modules[instance.moduleId];
    const pivot = engine.localPivot(module);
    return {
      moduleId: instance.moduleId,
      translation: instance.translation,
      rotationDeg: instance.rotationDeg || 0,
      pivotMm: [instance.translation[0] + pivot[0], instance.translation[1] + pivot[1]],
      finishId: instance.finish || state.finish,
      muted: instance.omitted === true
    };
  });

  const accessory = catalog.accessories && catalog.accessories.bookend;
  if (accessory && state.bookends > 0) {
    const anchorMm = (accessory.attach && accessory.attach.anchorLocalMm) || [0, 0, 0];
    for (const placement of engine.bookendPlacements(catalog, state)) {
      entries.push({
        moduleId: "bookend",
        translation: [
          placement.worldMm[0] - anchorMm[0],
          placement.worldMm[1] - anchorMm[1],
          placement.worldMm[2] - anchorMm[2]
        ],
        rotationDeg: placement.rotationDeg,
        pivotMm: [placement.worldMm[0], placement.worldMm[1]],
        finishId: placement.finish || state.finish,
        muted: false
      });
    }
  }
  return entries;
}

/**
 * The node matrix for one placed piece, in glTF's column-major order.
 *
 * renderer.js's modelMatrix, carried into glTF's axes. Written twice because
 * the two files put the axis swap in different places, and the translation is
 * the same either way:
 *
 *   quantised -- the mesh holds the bundle's raw uint16, in the module's own
 *     Z-up space, so the node does everything:
 *       world_mm = Rz . (scale.v + offset + translation - pivot) + pivot
 *       gltf_m   = swap . world_mm / 1000
 *     and the linear part is swap . Rz . (scale / 1000).
 *
 *   float -- the mesh was already dequantised, swapped and scaled when it was
 *     written, so only the placement is left, expressed in glTF's axes:
 *     swap . Rz . swap^-1, which is a turn about the vertical, unscaled.
 *
 * `swap` is (x, y, z) -> (x, z, -y): a rotation about X, so it preserves
 * handedness and leaves winding orders and normals alone.
 */
function nodeMatrix(entry, geometry, quantised, recentreM) {
  const radians = ((entry.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [px, py] = entry.pivotMm;
  const t = entry.translation;
  const o = quantised ? geometry.quantOffset : [0, 0, 0];

  // The constant part: Rz . (offset + translation - pivot) + pivot, in mm.
  const bx = t[0] + o[0] - px;
  const by = t[1] + o[1] - py;
  const bz = t[2] + o[2];
  const wx = cos * bx - sin * by + px;
  const wy = sin * bx + cos * by + py;
  const wz = bz;
  const translation = [
    wx / 1000 + recentreM[0],
    wz / 1000 + recentreM[1],
    -wy / 1000 + recentreM[2]
  ];

  if (quantised) {
    // Columns of swap . Rz, scaled. Rz's columns are (cos, sin, 0),
    // (-sin, cos, 0), (0, 0, 1); swap sends each to (x, z, -y).
    const k = geometry.quantScale / 1000;
    return [
      cos * k, 0, -sin * k, 0,
      -sin * k, 0, -cos * k, 0,
      0, k, 0, 0,
      translation[0], translation[1], translation[2], 1
    ];
  }
  // swap . Rz . swap^-1: a turn of -rotationDeg about glTF's own up axis.
  return [
    cos, 0, -sin, 0,
    0, 1, 0, 0,
    sin, 0, cos, 0,
    translation[0], translation[1], translation[2], 1
  ];
}

/** A point of a mesh's local space through a node matrix. */
function applyMatrix(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

// -------------------------------------------------------------------- GLB ---

const ALIGN = 4;

class BufferWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  /** Append `view`'s bytes, 4-aligned, and return [byteOffset, byteLength]. */
  write(view) {
    const pad = (ALIGN - (this.length % ALIGN)) % ALIGN;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.length += pad;
    }
    const bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    const offset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.length;
    return [offset, bytes.length];
  }

  concat() {
    return Buffer.concat(this.chunks, this.length);
  }
}

function packGlb(json, binary) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (ALIGN - (jsonBytes.length % ALIGN)) % ALIGN;
  const binPad = (ALIGN - (binary.length % ALIGN)) % ALIGN;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binChunk = Buffer.concat([binary, Buffer.alloc(binPad, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN"

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

// ------------------------------------------------------------------ export --

/**
 * One design, as a GLB.
 *
 * `modules` is a Map of moduleId -> the object geometry.js's expand() returns.
 * Loading them is the caller's business, because the two callers load them
 * differently: the script off the disk, the function over HTTP from the site's
 * own CDN.
 *
 * Returns the file and the measurements worth asserting on: the bounding box in
 * metres, which has to agree with what /builder tells the customer in
 * centimetres, and the counts.
 */
export function buildGlb(catalog, state, modules, options = {}) {
  const quantised = options.quantise === true;
  const palette = options.palette === "builder" ? "builder" : "material";
  const entries = sceneEntries(catalog, state);
  if (!entries.length) throw new Error("that design has no pieces in it");

  const buffer = new BufferWriter();
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const materialIndex = new Map();
  const meshes = [];
  const meshIndex = new Map();
  const nodes = [];

  const addBufferView = (view, target) => {
    const [byteOffset, byteLength] = buffer.write(view);
    bufferViews.push({ buffer: 0, byteOffset, byteLength, ...(target ? { target } : {}) });
    return bufferViews.length - 1;
  };

  const addMaterial = (role, finishId, muted) => {
    const key = `${role}|${muted ? "muted" : finishId}`;
    if (materialIndex.has(key)) return materialIndex.get(key);
    const surface = SURFACES[role] || SURFACES[ROLE_STEEL];
    const hex = roleColor(catalog, finishId, role, { palette, muted });
    materials.push({
      name: muted ? `not quoted ${ROLE_NAMES[role] || role}` : `${finishId} ${ROLE_NAMES[role] || role}`,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: linearRgba(hex),
        metallicFactor: surface.metallic,
        roughnessFactor: surface.roughness
      },
      extras: { hex, role: ROLE_NAMES[role] || String(role) }
    });
    materialIndex.set(key, materials.length - 1);
    return materials.length - 1;
  };

  /*
   * One mesh per (module, finish, quoted-or-not). Every instance of that
   * combination is a node pointing at it, which is why a six-bay run costs
   * about what one bay costs.
   */
  const addMesh = (entry) => {
    const key = `${entry.moduleId}|${entry.muted ? "muted" : entry.finishId}`;
    if (meshIndex.has(key)) return meshIndex.get(key);
    const geometry = modules.get(entry.moduleId);
    if (!geometry) throw new Error(`no geometry loaded for ${entry.moduleId}`);

    const primitives = geometry.batches.map((batch) => {
      let positionAccessor;
      if (quantised) {
        // The bundle's own uint16, untouched. min/max are in those units; the
        // node matrix carries the scale and offset that turn them into metres.
        let minX = 65535; let minY = 65535; let minZ = 65535;
        let maxX = 0; let maxY = 0; let maxZ = 0;
        for (let i = 0; i < batch.vertexCount; i += 1) {
          const x = batch.positions[i * 3];
          const y = batch.positions[i * 3 + 1];
          const z = batch.positions[i * 3 + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        accessors.push({
          bufferView: addBufferView(batch.positions, 34962),
          componentType: 5123, // UNSIGNED_SHORT
          count: batch.vertexCount,
          type: "VEC3",
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ]
        });
      } else {
        // Dequantised into millimetres, then swapped and scaled into metres, so
        // the mesh stands on its own without the extension.
        const positions = new Float32Array(batch.vertexCount * 3);
        const s = geometry.quantScale;
        const o = geometry.quantOffset;
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < batch.vertexCount; i += 1) {
          const x = (batch.positions[i * 3] * s + o[0]) / 1000;
          const y = (batch.positions[i * 3 + 1] * s + o[1]) / 1000;
          const z = (batch.positions[i * 3 + 2] * s + o[2]) / 1000;
          // The same swap the node matrix applies in the quantised path.
          const out = [x, z, -y];
          positions[i * 3] = out[0];
          positions[i * 3 + 1] = out[1];
          positions[i * 3 + 2] = out[2];
          for (let a = 0; a < 3; a += 1) {
            if (out[a] < min[a]) min[a] = out[a];
            if (out[a] > max[a]) max[a] = out[a];
          }
        }
        accessors.push({
          bufferView: addBufferView(positions, 34962),
          componentType: 5126, // FLOAT
          count: batch.vertexCount,
          type: "VEC3",
          min,
          max
        });
      }
      positionAccessor = accessors.length - 1;

      // Normals. geometry.js writes four bytes a vertex (the fourth is padding
      // for the GPU); glTF wants three, so they are repacked tight. In the
      // float file they are also swapped, to match the positions.
      let normalAccessor;
      if (quantised) {
        const normals = new Int8Array(batch.vertexCount * 3);
        for (let i = 0; i < batch.vertexCount; i += 1) {
          normals[i * 3] = batch.normals[i * 4];
          normals[i * 3 + 1] = batch.normals[i * 4 + 1];
          normals[i * 3 + 2] = batch.normals[i * 4 + 2];
        }
        accessors.push({
          bufferView: addBufferView(normals, 34962),
          componentType: 5120, // BYTE
          normalized: true,
          count: batch.vertexCount,
          type: "VEC3"
        });
      } else {
        const normals = new Float32Array(batch.vertexCount * 3);
        for (let i = 0; i < batch.vertexCount; i += 1) {
          const nx = batch.normals[i * 4] / 127;
          const ny = batch.normals[i * 4 + 1] / 127;
          const nz = batch.normals[i * 4 + 2] / 127;
          const length = Math.hypot(nx, ny, nz) || 1;
          normals[i * 3] = nx / length;
          normals[i * 3 + 1] = nz / length;
          normals[i * 3 + 2] = -ny / length;
        }
        accessors.push({
          bufferView: addBufferView(normals, 34962),
          componentType: 5126,
          count: batch.vertexCount,
          type: "VEC3"
        });
      }
      normalAccessor = accessors.length - 1;

      accessors.push({
        bufferView: addBufferView(batch.indices, 34963),
        componentType: 5123,
        count: batch.indexCount,
        type: "SCALAR"
      });
      const indexAccessor = accessors.length - 1;

      return {
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices: indexAccessor,
        material: addMaterial(batch.role, entry.finishId, entry.muted),
        mode: 4
      };
    });

    meshes.push({ name: key, primitives });
    meshIndex.set(key, meshes.length - 1);
    return meshes.length - 1;
  };

  /*
   * Where the model sits relative to its own origin, which in AR is where it
   * lands on the floor the phone found. Twice over: once with no recentring, to
   * learn the box, and then for real. The shelf ends up standing on y = 0 and
   * centred on its own footprint, so a customer turning it with two fingers
   * turns it about its middle rather than swinging it round a corner.
   */
  const pass = (recentreM) => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const placed = entries.map((entry) => {
      const geometry = modules.get(entry.moduleId);
      // Measured through the quantised matrix whichever file is being written:
      // the two encodings put the same vertex in the same place in the world,
      // and this one takes the bundle's raw uint16 without a conversion.
      const m = nodeMatrix(entry, geometry, true, recentreM);
      /*
       * Measured off the vertices, not off the module's declared box. Seven of
       * the 53 bundles carry mesh outside their catalogue bboxMm -- standard and
       * wide feet reach 13mm below the plane the engine stands them on, and the
       * standard, slim and wide extensions overhang 2mm front and back -- and
       * the box that matters here is the one the model occupies on somebody's
       * floor, not the one the placement rules reason with. A rotation about the
       * vertical would also make a corner-of-the-box bound merely conservative
       * at any angle that is not a quarter turn, and the lamp arm sits at 315.
       */
      for (const batch of geometry.batches) {
        for (let i = 0; i < batch.vertexCount; i += 1) {
          const p = applyMatrix(
            m,
            batch.positions[i * 3],
            batch.positions[i * 3 + 1],
            batch.positions[i * 3 + 2]
          );
          for (let a = 0; a < 3; a += 1) {
            if (p[a] < box[a]) box[a] = p[a];
            if (p[a] > box[a + 3]) box[a + 3] = p[a];
          }
        }
      }
      return { entry, matrix: nodeMatrix(entry, geometry, quantised, recentreM) };
    });
    return { box, placed };
  };

  const first = pass([0, 0, 0]);
  const recentreM = [
    -(first.box[0] + first.box[3]) / 2,
    -first.box[1],
    -(first.box[2] + first.box[5]) / 2
  ];
  const final = pass(recentreM);

  for (const { entry, matrix } of final.placed) {
    nodes.push({ name: entry.moduleId, mesh: addMesh(entry), matrix });
  }

  const binary = buffer.concat();
  const sizeMm = engine.designBounds(catalog, state);
  const json = {
    asset: {
      version: "2.0",
      generator: "framework-site design-glb",
      // What this file is of, so a downloaded model can still be identified.
      extras: {
        finish: state.finish,
        bookends: state.bookends || 0,
        pieces: state.instances.length,
        sizeMm: sizeMm
          ? {
            widthMm: Math.round(sizeMm[3] - sizeMm[0]),
            depthMm: Math.round(sizeMm[4] - sizeMm[1]),
            heightMm: Math.round(sizeMm[5] - sizeMm[2])
          }
          : null
      }
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
    ...(quantised
      ? { extensionsUsed: ["KHR_mesh_quantization"], extensionsRequired: ["KHR_mesh_quantization"] }
      : {})
  };

  const file = packGlb(json, binary);
  return {
    glb: file,
    quantised,
    palette,
    // The box the file actually occupies, which is the number to check against
    // what the design record says the shelf measures.
    boxM: {
      widthM: final.box[3] - final.box[0],
      heightM: final.box[4] - final.box[1],
      depthM: final.box[5] - final.box[2]
    },
    counts: {
      nodes: nodes.length,
      meshes: meshes.length,
      materials: materials.length,
      vertices: [...meshIndex.keys()].reduce((total, key) => {
        const mesh = meshes[meshIndex.get(key)];
        return total + mesh.primitives.reduce((sum, p) => sum + accessors[p.attributes.POSITION].count, 0);
      }, 0)
    }
  };
}

// ------------------------------------------------------------ designs in ---

/**
 * A stored design record, as /builder reads one.
 *
 * `/api/design` and the 77 static catalogue files answer with the same shape,
 * and the order matters: the share hash is the form the page itself reads and
 * survives a catalogue rename, the serialised design is the fallback for a
 * record written before the hash was stored. app.js's loadSavedDesign picks
 * them in that order, so this does too.
 */
export function stateFromRecord(catalog, record) {
  if (record && record.hash) return stateFromHash(catalog, record.hash);
  if (record && record.design) {
    return engine.repairCornerGeometry(catalog, engine.deserializeState(catalog, record.design));
  }
  throw new Error("that design record carries neither a hash nor a design");
}

/**
 * The `#` payload, back into a design.
 *
 * A port of decodeDesign in js/builder/app.js, including the two tables
 * scripts/lib/design-lab.mjs drops: a per-piece finish (rows 6 and the tint
 * table) and the pieces left off the quote. Both change what the model looks
 * like, so neither can be dropped here.
 */
export function stateFromHash(catalog, encoded) {
  const raw = String(encoded || "").trim().replace(/^.*#/, "").replace(/^\/+/, "");
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
  const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  if (!Array.isArray(payload) || payload[0] !== 1) throw new Error("unsupported design link");
  const [, , finish, bookends, types, rows] = payload;
  const tints = payload[6] || [];
  const omitted = new Set(payload[7] || []);
  if (!Array.isArray(types) || !Array.isArray(rows) || !rows.length) {
    throw new Error("that design code has no pieces in it");
  }
  const instances = rows.map((row, index) => {
    const moduleId = types[row[0]];
    if (!catalog.modules[moduleId]) throw new Error(`the code names a piece that does not exist: ${moduleId}`);
    return {
      id: `item_${String(index + 1).padStart(3, "0")}`,
      type: moduleId,
      originWorldMm: [row[1], row[2], 0],
      rotationDeg: row[3] || 0,
      placement: row[4]
        ? { method: "socket", on: (row[5] || []).map((support) => `item_${String(support + 1).padStart(3, "0")}`) }
        : { method: "floor" },
      finish: row[6] ? (tints[row[6] - 1] || null) : null,
      omitted: omitted.has(index)
    };
  });
  return engine.repairCornerGeometry(
    catalog,
    engine.deserializeState(catalog, { schemaVersion: 1, finish, bookends: bookends || 0, instances })
  );
}

/** Every module id a design needs geometry for, bookends included. */
export function modulesNeeded(catalog, state) {
  const ids = new Set(state.instances.map((instance) => instance.moduleId));
  if ((state.bookends || 0) > 0 && catalog.accessories && catalog.accessories.bookend) ids.add("bookend");
  return [...ids];
}

/** Ksh, the way scripts/lib/design-lab.mjs prices a design. */
export function priceOf(catalog, state) {
  let total = 0;
  let unpriced = 0;
  for (const instance of state.instances) {
    const module = catalog.modules[instance.moduleId];
    if (!module || module.priceKsh == null) unpriced += 1;
    else total += module.priceKsh;
  }
  const bookendPrice = (catalog.accessoryPrices || {}).bookend;
  if (state.bookends > 0 && bookendPrice != null) total += bookendPrice * state.bookends;
  return { totalKsh: total, unpricedPieces: unpriced };
}

/**
 * Outside size in mm, ignoring a lamp: the envelope /builder quotes.
 *
 * The lab keeps the distinction and so does this, for the reason
 * scripts/lib/design-lab.mjs gives: this is the number a person reads, and it
 * has to be the one the page shows them. `designSizeMm` below is the whole box,
 * lamp arm included, which is what the GLB occupies and therefore what its
 * bounding box has to be checked against.
 */
export function shelfSizeMm(catalog, state) {
  const shelfOnly = state.instances.filter((instance) =>
    (catalog.modules[instance.moduleId] || {}).role !== "lamp");
  const bounds = engine.designBounds(catalog, shelfOnly.length ? { instances: shelfOnly } : state);
  const size = boundsToSize(bounds);
  /*
   * Height is measured from the floor, not across the box, because that is what
   * /builder quotes: app.js's heightAboveFloor is `Math.max(0, bounds[5])`.
   * Every base unit's box reaches 13mm below the placement plane -- the foot's
   * pad -- so the two differ by 13mm on every design with a base in it, and a
   * page that said 164cm beside a builder that says 163 would be two tools
   * disagreeing about one shelf in front of the customer. The model in AR still
   * stands on its own lowest vertex, pad included, which is where it would
   * stand on a real floor.
   */
  if (bounds) size.heightMm = Math.round(Math.max(0, bounds[5]));
  return size;
}

/** The whole box, lamp included. */
export function designSizeMm(catalog, state) {
  return boundsToSize(engine.designBounds(catalog, state));
}

function boundsToSize(bounds) {
  if (!bounds) return { widthMm: 0, depthMm: 0, heightMm: 0 };
  return {
    widthMm: Math.round(bounds[3] - bounds[0]),
    depthMm: Math.round(bounds[4] - bounds[1]),
    heightMm: Math.round(bounds[5] - bounds[2])
  };
}

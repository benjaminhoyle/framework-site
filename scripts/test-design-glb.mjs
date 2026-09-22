#!/usr/bin/env node
/**
 * The AR model, checked against the shelf it claims to be.
 *
 *   node scripts/test-design-glb.mjs
 *
 * A model in AR is a claim about the physical world: this is what you would
 * receive, this big, in this colour, standing on your floor. The failures that
 * matter are therefore not crashes. They are a shelf that is 90 degrees over on
 * its back, a shelf a tenth of its real size, a shelf in a colour the workshop
 * does not spray, and a page that says 164cm beside a /builder that says 163.
 * None of those throws; all of them are caught here.
 *
 * So the file is written back out of the bytes and measured, rather than the
 * builder's numbers being trusted twice. Every assertion goes through the GLB's
 * own accessors and node matrices, which is what a phone will read.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  engine, buildGlb, stateFromRecord, stateFromHash, modulesNeeded,
  shelfSizeMm, designSizeMm, linearRgba
} from "../netlify/functions/_glb.mjs";
import { loadCatalog, loadModules, readDesignRecord } from "./export-glb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = loadCatalog();

/*
 * Seven real codes, chosen for what each one can break rather than for variety.
 * They are catalogue designs, so they are on disk and this test needs no
 * network and no blob store.
 */
const CASES = [
  ["11W402W", "one unit, the smallest thing that can be exported"],
  ["01H0NP1", "two runs at two heights: the stepped case"],
  ["17DE2MY", "three metres wide, twelve pieces over two meshes"],
  ["1N3QG4F", "a corner: the largest design in the catalogue, and the one that turns"],
  ["0KM9EKA", "a tall stepped run, 2.4m by 2.2m"],
  ["0PSNETC", "per-piece colours: nine materials in one file"],
  ["3WU3UN2", "a lamp, which is the shade and cord roles and a 225 degree rotation"]
];

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

// --------------------------------------------------------------- the file ---

/** Read a GLB back into { json, bin }, checking the container as it goes. */
function parseGlb(buffer) {
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, "magic is not glTF");
  assert.equal(buffer.readUInt32LE(4), 2, "not glTF 2.0");
  assert.equal(buffer.readUInt32LE(8), buffer.length, "header length disagrees with the file");

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
    if (type === 0x004e4942) bin = body;
    offset += 8 + length;
    assert.equal(offset % 4, 0, "a chunk is not 4-aligned");
  }
  assert.ok(json, "no JSON chunk");
  assert.ok(bin, "no BIN chunk");
  return { json, bin };
}

/** Every POSITION, through its node's matrix, as the viewer would place it. */
function placedBox(json, bin) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const node of json.nodes) {
    const m = node.matrix;
    assert.ok(Array.isArray(m) && m.length === 16, "a node has no matrix");
    for (const primitive of json.meshes[node.mesh].primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      const view = json.bufferViews[accessor.bufferView];
      const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
      const read = accessor.componentType === 5126
        ? (i, a) => bin.readFloatLE(start + (i * 3 + a) * 4)
        : (i, a) => bin.readUInt16LE(start + (i * 3 + a) * 2);
      for (let i = 0; i < accessor.count; i += 1) {
        const x = read(i, 0);
        const y = read(i, 1);
        const z = read(i, 2);
        const p = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14]
        ];
        for (let a = 0; a < 3; a += 1) {
          if (p[a] < box[a]) box[a] = p[a];
          if (p[a] > box[a + 3]) box[a + 3] = p[a];
        }
      }
      vertices += accessor.count;
    }
  }
  return { box, vertices };
}

function exportOf(code, options) {
  const state = stateFromRecord(catalog, readDesignRecord(code));
  const result = buildGlb(catalog, state, loadModules(modulesNeeded(catalog, state)), options || {});
  return { state, result, ...parseGlb(result.glb) };
}

// ------------------------------------------------------------------ tests ---

console.log("the file, and the shelf it claims to be");

for (const [code, why] of CASES) {
  test(`${code}: ${why}`, () => {
    const { state, result, json, bin } = exportOf(code);
    const { box } = placedBox(json, bin);

    /*
     * Y up, metres, standing on the floor. AR drops the model's origin on the
     * surface it found, so a model whose vertical extent does not start at zero
     * is a shelf sunk into the carpet or hovering over it, and a model whose
     * longest axis is Z is a shelf lying on its back. Both look like the
     * software working.
     */
    assert.ok(Math.abs(box[1]) < 1e-4, `does not stand on y=0 (min y ${box[1]})`);
    assert.ok(Math.abs(box[0] + box[3]) < 1e-4, "not centred on x");
    assert.ok(Math.abs(box[2] + box[5]) < 1e-4, "not centred on z");

    // The box, against what the engine says the design measures. The tolerance
    // is 15mm and it is not slack: seven of the 53 module bundles carry mesh
    // outside their declared catalogue box, a standard foot by 13mm below the
    // plane it is stood on, and the model is right to include it.
    const full = designSizeMm(catalog, state);
    const measured = {
      widthMm: (box[3] - box[0]) * 1000,
      heightMm: (box[4] - box[1]) * 1000,
      depthMm: (box[5] - box[2]) * 1000
    };
    for (const axis of ["widthMm", "heightMm", "depthMm"]) {
      const delta = measured[axis] - full[axis];
      // A design with a lamp is the one exception in the other direction: the
      // engine bounds a module turned 225 degrees by its box corners, which is
      // wider than the mesh inside it.
      const slack = state.instances.some((i) => (catalog.modules[i.moduleId] || {}).role === "lamp")
        ? 200 : 15;
      assert.ok(Math.abs(delta) <= slack,
        `${axis} is ${Math.round(measured[axis])}mm, the design says ${full[axis]}mm`);
    }

    // Scale: a shelf is between a third of a metre and four metres in every
    // direction. This is the check that catches a millimetres-for-metres slip,
    // which is the classic glTF failure and is invisible on a screen.
    assert.ok(measured.heightMm > 300 && measured.heightMm < 4000, "height is not shelf-sized");
    assert.ok(measured.widthMm > 300 && measured.widthMm < 4000, "width is not shelf-sized");

    /*
     * Geometry once, placed many times. The unit of sharing is a module in a
     * colour, not a module: a design that puts one unit in Coral beside the
     * same unit in Sage is two meshes and is right to be. The +1 is the
     * bookends, which are not pieces of the design.
     */
    const distinct = new Set(state.instances
      .map((i) => `${i.moduleId}|${i.omitted ? "muted" : (i.finish || state.finish)}`)).size;
    assert.ok(json.meshes.length <= distinct + 1,
      `${json.meshes.length} meshes for ${distinct} distinct module-and-colour pairs`);
    assert.ok(json.meshes.length <= json.nodes.length, "more meshes than nodes");
    assert.ok(json.nodes.length >= state.instances.length, "a piece is missing a node");

    // Nothing the file needs is absent, and nothing it does not need is
    // required: the default file must open in a viewer with no extensions.
    assert.equal(json.extensionsRequired, undefined, "the default file requires an extension");
    assert.equal(json.buffers.length, 1, "more than one buffer in a GLB");
    assert.ok(json.buffers[0].byteLength <= bin.length, "the buffer outruns the BIN chunk");
    assert.equal(json.buffers[0].uri, undefined, "the GLB buffer must have no uri");
    assert.ok(result.glb.length < 1024 * 1024, `${Math.round(result.glb.length / 1024)}kB is too much`);
  });
}

test("every material is a colour the workshop sprays, or one of the three fixed ones", () => {
  const hexes = new Set();
  for (const [code] of CASES) {
    for (const material of exportOf(code).json.materials) {
      hexes.add(material.extras.hex.toLowerCase());
      // Linear, not sRGB. A baseColorFactor left in sRGB is the usual reason an
      // exported model looks washed out, and it is invisible in the file.
      const expected = linearRgba(material.extras.hex);
      const actual = material.pbrMetallicRoughness.baseColorFactor;
      for (let i = 0; i < 4; i += 1) {
        assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6, `${material.name} is not in linear space`);
      }
      assert.equal(material.pbrMetallicRoughness.metallicFactor, 0,
        `${material.name} is metallic; no finished unit has bare steel on it`);
    }
  }
  const allowed = new Set(["#15181a", "#fdf3e3", "#4c5254", "#eef1f1"]);
  for (const finish of catalog.finishes) {
    allowed.add(finish.steelHex.toLowerCase());
    allowed.add(finish.mdfHex.toLowerCase());
  }
  for (const hex of hexes) {
    assert.ok(allowed.has(hex), `${hex} is not a catalogue finish or a fixed part colour`);
  }
});

test("the quoted size is the one /builder quotes, measured from the floor", () => {
  for (const [code] of CASES) {
    const state = stateFromRecord(catalog, readDesignRecord(code));
    const shelfOnly = state.instances.filter((i) => (catalog.modules[i.moduleId] || {}).role !== "lamp");
    const bounds = engine.designBounds(catalog, { instances: shelfOnly });
    // app.js's heightAboveFloor. The two differ by the 13mm of foot below the
    // placement plane on every design with a base in it, which is all of them.
    assert.equal(shelfSizeMm(catalog, state).heightMm, Math.round(Math.max(0, bounds[5])),
      `${code}: the page would quote a height /builder does not`);
  }
});

test("a share hash carries per-piece colours and unquoted pieces into the model", () => {
  const state = stateFromRecord(catalog, readDesignRecord("0PSNETC"));
  const tinted = state.instances.filter((instance) => instance.finish);
  assert.ok(tinted.length > 0, "0PSNETC was chosen because it has per-piece colours");
  const { json } = exportOf("0PSNETC");
  const finishes = new Set(json.materials.map((m) => m.name.split(" ")[0]));
  assert.ok(finishes.size > 1, `one finish in the file, ${finishes.size} expected more`);

  // And the other half of the pair: a piece left off the invoice is drawn as
  // the pale blank /builder hatches, not in the shelf's colour.
  const hash = Buffer.from(JSON.stringify([
    1, "advanced", "coral", 0, ["compact_base"], [[0, 0, 0, 0, 0, []]], [], [0]
  ]), "utf8").toString("base64url");
  const omitted = stateFromHash(catalog, hash);
  assert.equal(omitted.instances[0].omitted, true, "the omission table was dropped");
  const built = buildGlb(catalog, omitted, loadModules(modulesNeeded(catalog, omitted)), {});
  const blank = parseGlb(built.glb).json.materials;
  assert.ok(blank.every((m) => m.extras.hex === "#eef1f1"),
    "an unquoted piece is drawn in a finish colour");
});

test("the quantised file is the same shelf, at half the size", () => {
  const plain = exportOf("1N3QG4F");
  const small = exportOf("1N3QG4F", { quantise: true });
  assert.deepEqual(small.json.extensionsRequired, ["KHR_mesh_quantization"],
    "a quantised file must say so");
  const a = placedBox(plain.json, plain.bin).box;
  const b = placedBox(small.json, small.bin).box;
  for (let i = 0; i < 6; i += 1) {
    assert.ok(Math.abs(a[i] - b[i]) < 0.002, `corner ${i} moved ${Math.round((a[i] - b[i]) * 1000)}mm`);
  }
  assert.ok(small.result.glb.length < plain.result.glb.length * 0.7,
    "quantising saved less than 30%, so it is not worth an extensionsRequired");
});

test("a design with no pieces is refused rather than written empty", () => {
  assert.throws(() => buildGlb(catalog, engine.createState(catalog, { finish: "sage" }), new Map()),
    /no pieces/);
});

console.log(failures ? `\n${failures} failed` : "\ndesign GLB tests passed");
process.exit(failures ? 1 : 0);

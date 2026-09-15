#!/usr/bin/env node
/**
 * The props on The Lantern Shelf in the /customize add-ons story: its books, a
 * few decorative objects, and the lamp's light.
 *
 *   node scripts/build-shelf-props.mjs
 *
 * Writes two things, both GENERATED:
 *
 *   assets/assembly/props.json   every prop's geometry in one file, as a pack of
 *                                framework-module-geometry@1 bundles (the format
 *                                the builder's modules use), so the story makes
 *                                one request for all of them rather than forty
 *   js/assembly/props.js         each prop's measurements, which the story needs
 *                                to lay the shelves out before any geometry has
 *                                arrived
 *
 * ## The books
 *
 * Contemporary African paperbacks: flat spines in bold colour, and on each a
 * single graphic idea (a colour block, a band, triangles, dots, a chevron, a
 * kente strip) or none, with cream title bars and marks. Two hardbacks with a
 * rounded spine and a colour block. Books were tried once on /assembly as
 * coloured boxes and taken out (docs/assembly-animation.md, section 8); what
 * makes a drawing read as a book is what a box does not have, so each is built
 * from that: a cream page block set inside the covers, and a spine that carries
 * the design. Every size is a real book's.
 *
 * ## The objects
 *
 * A squat vase, a bottle, a ball on a plinth, three stacked cubes, a pyramid, a
 * bowl of fruit and a plant in a pot: simple solids, faceted like the rest of
 * the drawing, a touch playful, and each in two of the books' own inks. They
 * are the things a shelf of books is styled with, and nothing that needs detail
 * to be believed.
 *
 * ## The lamp's shade
 *
 * Not a prop: the lamp comes on by the story painting its own shade yellow.
 * The shade is measured from assets/shelving/modules/lamp.json and written out
 * as `shade`, so the story's test can keep everything clear of it wherever the
 * lamp swings.
 *
 * ## Colour
 *
 * Not in the geometry. Role 0 is painted with the instance's `steel`, role 1
 * with its `surface`; role 3 is the renderer's paper cream, which the page
 * blocks and title bars share, and role 2 its near-black, which only the kente
 * strip uses.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  polygon, quad, box, prism, turnedBox, pyramid, icosphere, beam, transform, bounds, encodeBundle, partBounds
} from "./lib/props-geometry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PACK = path.join(ROOT, "assets", "assembly", "props.json");
const OUT_JS = path.join(ROOT, "js", "assembly", "props.js");
const PACK_URL = "/assets/assembly/props.json";

const COVER = 0;
const MOTIF = 1;
const INK = 2;
const CREAM = 3;

// ------------------------------------------------------------------ books

const BOOKS = [
  { id: "pb_block", kind: "paper", t: 18, d: 132, h: 198, motif: "block" },
  { id: "pb_band", kind: "paper", t: 22, d: 140, h: 210, motif: "band" },
  { id: "pb_zigzag", kind: "paper", t: 26, d: 138, h: 205, motif: "zigzag" },
  { id: "pb_dots", kind: "paper", t: 15, d: 128, h: 190, motif: "dots" },
  { id: "pb_title", kind: "paper", t: 30, d: 155, h: 234, motif: "title" },
  { id: "pb_half", kind: "paper", t: 20, d: 142, h: 216, motif: "half" },
  { id: "pb_chevron", kind: "paper", t: 24, d: 150, h: 228, motif: "chevron" },
  { id: "pb_kente", kind: "paper", t: 34, d: 160, h: 240, motif: "kente" },
  { id: "pb_slim", kind: "paper", t: 12, d: 124, h: 181, motif: "title" },
  { id: "pb_wide", kind: "paper", t: 28, d: 148, h: 222, motif: "block" },
  { id: "pb_plain_a", kind: "paper", t: 22, d: 140, h: 212, motif: "plain" },
  { id: "pb_plain_b", kind: "paper", t: 18, d: 130, h: 200, motif: "plain" },
  { id: "pb_plain_c", kind: "paper", t: 30, d: 158, h: 236, motif: "plain" },
  { id: "pb_plain_d", kind: "paper", t: 26, d: 138, h: 206, motif: "plain" },
  { id: "pb_plain_e", kind: "paper", t: 24, d: 150, h: 226, motif: "plain" },
  { id: "hb_block", kind: "hard", t: 38, d: 192, h: 250, motif: "block" },
  { id: "hb_half", kind: "hard", t: 44, d: 202, h: 262, motif: "half" },
  { id: "pb_chevron_lean", kind: "paper", t: 24, d: 150, h: 228, motif: "chevron", leanDeg: 11 },
  { id: "pb_title_lean", kind: "paper", t: 30, d: 155, h: 234, motif: "title", leanDeg: 9 },
  { id: "hb_half_flat", kind: "hard", t: 44, d: 202, h: 262, motif: "half", flat: true },
  { id: "pb_plain_c_flat", kind: "paper", t: 30, d: 158, h: 236, motif: "plain", flat: true },
  { id: "pb_plain_a_flat", kind: "paper", t: 22, d: 140, h: 212, motif: "plain", flat: true },
  { id: "pb_zigzag_flat", kind: "paper", t: 26, d: 138, h: 205, motif: "zigzag", flat: true },
  { id: "pb_dots_flat", kind: "paper", t: 15, d: 128, h: 190, motif: "dots", flat: true, mark: true }
];

/*
 * A shape printed proud of a flat spine: an outline in the spine's plane (x
 * across it, z up it), pushed out `lift` mm in front of y = 0. Proud rather
 * than painted, because the renderer has no textures.
 */
function relief(mesh, role, outline, lift = 0.5) {
  polygon(mesh, role, outline.map(([x, z]) => [x, -lift, z]), [0, -1, 0]);
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % outline.length];
    const nx = bz - az;
    const nz = -(bx - ax);
    const length = Math.hypot(nx, nz) || 1;
    quad(mesh, role, [[ax, -lift, az], [bx, -lift, bz], [bx, 0, bz], [ax, 0, az]], [nx / length, 0, nz / length]);
  }
}

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
function disc(cx, cz, r, sides = 12) {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });
}

/* One graphic idea per spine, in at most two printed colours. */
function motif(mesh, name, t, h) {
  const bar = (z0, z1, role = CREAM) => relief(mesh, role, rect(t * 0.38, z0, t * 0.62, z1));
  switch (name) {
    case "plain":
      break;
    case "block":
      relief(mesh, MOTIF, rect(0.25, 0, t - 0.25, h * 0.34));
      bar(h * 0.46, h * 0.86);
      break;
    case "band":
      relief(mesh, MOTIF, rect(0.25, h * 0.56, t - 0.25, h * 0.74));
      relief(mesh, CREAM, disc(t / 2, h * 0.12, t * 0.2));
      bar(h * 0.22, h * 0.48);
      break;
    case "zigzag": {
      const n = Math.max(2, Math.round(t / 9));
      const w = (t - 0.5) / n;
      const rise = w * 0.9;
      const z0 = h * 0.14;
      for (let i = 0; i < n; i += 1) {
        const x0 = 0.25 + i * w;
        relief(mesh, MOTIF, [[x0, z0], [x0 + w, z0], [x0 + w / 2, z0 + rise]]);
        relief(mesh, MOTIF, [[x0 + w, z0 + 2 * rise], [x0, z0 + 2 * rise], [x0 + w / 2, z0 + rise]]);
      }
      bar(h * 0.44, h * 0.86);
      break;
    }
    case "dots":
      for (const z of [0.62, 0.72, 0.82]) relief(mesh, MOTIF, disc(t / 2, h * z, t * 0.3));
      relief(mesh, CREAM, rect(0.25, h * 0.08, t - 0.25, h * 0.12));
      break;
    case "title":
      bar(h * 0.3, h * 0.88);
      relief(mesh, MOTIF, rect(t * 0.3, h * 0.08, t * 0.7, h * 0.08 + t * 0.4));
      break;
    case "half":
      relief(mesh, MOTIF, rect(0.25, h * 0.52, t - 0.25, h - 0.25));
      relief(mesh, CREAM, rect(t * 0.34, h * 0.1, t * 0.66, h * 0.1 + t * 0.32));
      break;
    case "chevron":
      for (const z of [0.58, 0.68]) {
        relief(mesh, MOTIF, [[0.25, h * z + t * 0.45], [t / 2, h * z], [t - 0.25, h * z + t * 0.45], [t / 2, h * z + t * 0.22]]);
      }
      relief(mesh, CREAM, rect(0.25, h * 0.06, t - 0.25, h * 0.1));
      break;
    case "kente": {
      const unit = h * 0.035;
      [MOTIF, INK, MOTIF, CREAM, MOTIF].forEach((role, i) => {
        relief(mesh, role, rect(0.25, h * 0.7 + i * unit, t - 0.25, h * 0.7 + (i + 1) * unit));
      });
      bar(h * 0.18, h * 0.6);
      break;
    }
    default:
      throw new Error(`no motif "${name}"`);
  }
}

/** A disc on the back cover (x = 0), which faces up when the book lies flat. */
function coverMark(mesh, d, h) {
  const r = Math.min(d, h) * 0.3;
  polygon(mesh, MOTIF, disc(d * 0.55, h * 0.5, r, 20).map(([y, z]) => [-0.5, y, z]), [-1, 0, 0]);
}

function paperback({ t, d, h, motif: name, mark }) {
  const mesh = new Map();
  const cover = 0.9;
  box(mesh, COVER, 0, 0, 0, t, cover, h);
  box(mesh, COVER, 0, cover, 0, cover, d, h);
  box(mesh, COVER, t - cover, cover, 0, t, d, h);
  box(mesh, CREAM, cover, cover + 0.2, 0.5, t - cover, d - 0.4, h - 0.5);
  motif(mesh, name, t, h);
  if (mark) coverMark(mesh, d, h);
  return mesh;
}

/* A hardback's rounded spine, or a band that follows it. */
function spine(mesh, role, t, s, b, { lift = 0, z0, z1, segments = 10 }) {
  const k = s + b;
  const outline = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const slope = (-k * Math.PI * Math.cos(Math.PI * u)) / t;
    const length = Math.hypot(slope, 1);
    const n = [slope / length, -1 / length, 0];
    const y = s - k * Math.sin(Math.PI * u);
    outline.push({ p: [u * t + n[0] * lift, y + n[1] * lift], n });
  }
  const back = s + 1.2;
  for (let i = 0; i < segments; i += 1) {
    const a = outline[i];
    const c = outline[i + 1];
    quad(mesh, role, [[a.p[0], a.p[1], z0], [c.p[0], c.p[1], z0], [c.p[0], c.p[1], z1], [a.p[0], a.p[1], z1]], [a.n, c.n, c.n, a.n]);
  }
  const first = outline[0].p;
  const last = outline[segments].p;
  quad(mesh, role, [[last[0], back, z0], [first[0], back, z0], [first[0], back, z1], [last[0], back, z1]], [0, 1, 0]);
  quad(mesh, role, [[first[0], back, z0], [first[0], first[1], z0], [first[0], first[1], z1], [first[0], back, z1]], [-1, 0, 0]);
  quad(mesh, role, [[last[0], last[1], z0], [last[0], back, z0], [last[0], back, z1], [last[0], last[1], z1]], [1, 0, 0]);
  const ring = outline.map((o) => o.p).concat([[last[0], back], [first[0], back]]);
  polygon(mesh, role, ring.map(([x, y]) => [x, y, z1]), [0, 0, 1]);
  polygon(mesh, role, ring.slice().reverse().map(([x, y]) => [x, y, z0]), [0, 0, -1]);
}

function hardback({ t, d, h, motif: name, mark }) {
  const mesh = new Map();
  const board = 2.4;
  const overhang = 3.5;
  const s = 1.5;
  const bulge = Math.max(1.2, Math.min(3.8, t * 0.09));
  box(mesh, COVER, 0, s, 0, board, d, h);
  box(mesh, COVER, t - board, s, 0, t, d, h);
  spine(mesh, COVER, t, s, bulge, { z0: 0, z1: h });
  box(mesh, CREAM, board, s + 1.4, overhang, t - board, d - overhang, h - overhang);
  if (name === "half") {
    spine(mesh, MOTIF, t, s, bulge, { lift: 0.6, z0: h * 0.55, z1: h - 0.3 });
    spine(mesh, CREAM, t, s, bulge, { lift: 1.0, z0: h * 0.12, z1: h * 0.18, segments: 8 });
  } else {
    spine(mesh, MOTIF, t, s, bulge, { lift: 0.6, z0: 0.3, z1: h * 0.3 });
    spine(mesh, CREAM, t, s, bulge, { lift: 1.0, z0: h * 0.5, z1: h * 0.58, segments: 8 });
  }
  if (mark) coverMark(mesh, d, h);
  return mesh;
}

/** Leaning towards +x, resting on its bottom edge at x = t. */
function lean(mesh, t, degrees) {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  transform(mesh,
    ([x, y, z]) => [t + (x - t) * cos + z * sin, y, -(x - t) * sin + z * cos],
    ([x, y, z]) => [x * cos + z * sin, y, -x * sin + z * cos]);
}

/** Lying on its front cover, spine still to the front: height along x, back cover up. */
function layFlat(mesh, t) {
  transform(mesh, ([x, y, z]) => [z, y, t - x], ([x, y, z]) => [z, y, -x]);
}

/** A book sits on z = 0 with its left face at x = 0. */
function settleBook(mesh) {
  const b = bounds(mesh);
  transform(mesh, ([x, y, z]) => [x - b[0], y, z - b[2]], (n) => n);
}

// ---------------------------------------------------------------- objects

const OBJECTS = {
  vase: (mesh) => {
    prism(mesh, COVER, { sides: 10, r0: 46, r1: 62, z0: 0, z1: 52 });
    prism(mesh, COVER, { sides: 10, r0: 62, r1: 32, z0: 52, z1: 112 });
    prism(mesh, MOTIF, { sides: 10, r0: 21, z0: 112, z1: 146 });
    prism(mesh, MOTIF, { sides: 10, r0: 21, r1: 28, z0: 146, z1: 154 });
  },
  bottle: (mesh) => {
    prism(mesh, COVER, { sides: 8, r0: 34, z0: 0, z1: 148 });
    prism(mesh, MOTIF, { sides: 8, r0: 35, z0: 56, z1: 76 });
    prism(mesh, COVER, { sides: 8, r0: 34, r1: 12, z0: 148, z1: 176 });
    prism(mesh, COVER, { sides: 8, r0: 11, z0: 176, z1: 222 });
    prism(mesh, MOTIF, { sides: 8, r0: 13, z0: 222, z1: 234 });
  },
  orb: (mesh) => {
    box(mesh, MOTIF, -42, -42, 0, 42, 42, 84);
    icosphere(mesh, COVER, { r: 50, cz: 84 + 47, detail: 1 });
  },
  cubes: (mesh) => {
    turnedBox(mesh, COVER, { size: 74, z0: 0 });
    turnedBox(mesh, MOTIF, { size: 56, z0: 74, degrees: 22 });
    turnedBox(mesh, CREAM, { size: 40, z0: 130, degrees: -14 });
  },
  pyramid: (mesh) => {
    pyramid(mesh, COVER, { size: 118, height: 124 });
    icosphere(mesh, MOTIF, { r: 16, cx: 0, cy: 0, cz: 124 + 12, detail: 0 });
  },
  bowl: (mesh) => {
    prism(mesh, COVER, { sides: 12, r0: 50, r1: 90, z0: 0, z1: 56 });
    icosphere(mesh, MOTIF, { r: 30, cx: -30, cy: -10, cz: 68, detail: 1 });
    icosphere(mesh, MOTIF, { r: 27, cx: 26, cy: -18, cz: 64, detail: 1 });
    icosphere(mesh, CREAM, { r: 25, cx: 2, cy: 30, cz: 66, detail: 1 });
  },
  plant: (mesh) => {
    prism(mesh, MOTIF, { sides: 10, r0: 40, r1: 52, z0: 0, z1: 84 });
    prism(mesh, MOTIF, { sides: 10, r0: 55, z0: 84, z1: 96 });
    icosphere(mesh, COVER, { r: 58, cx: -12, cy: 0, cz: 96 + 50, detail: 1 });
    icosphere(mesh, COVER, { r: 40, cx: 34, cy: -8, cz: 96 + 98, detail: 1 });
  }
};

/** An object stands on z = 0, centred on x = y = 0, which is what it turns about. */
function settleObject(mesh) {
  const b = bounds(mesh);
  const cx = (b[0] + b[3]) / 2;
  const cy = (b[1] + b[4]) / 2;
  transform(mesh, ([x, y, z]) => [x - cx, y - cy, z - b[2]], (n) => n);
}

// ------------------------------------------------------------------ shade

/*
 * The lamp's shade, in the lamp's own coordinates: the part of lamp.json
 * painted in the paper role.
 */
const lamp = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "shelving", "modules", "lamp.json"), "utf8"));
const shadePart = lamp.parts.find((part) => part.role === 3);
if (!shadePart) throw new Error("lamp.json has no paper-role part to measure the shade by");
const shade = partBounds(shadePart);
const SHADE = {
  cx: (shade[0] + shade[3]) / 2,
  cy: (shade[1] + shade[4]) / 2,
  r: Math.max(shade[3] - shade[0], shade[4] - shade[1]) / 2,
  z0: shade[2],
  z1: shade[5]
};

// ------------------------------------------------------------------ build

const modules = {};
const shapes = {};
const r4 = (n) => Math.round(n * 10000) / 10000;

function add(id, mesh, info) {
  const geometry = encodeBundle(mesh);
  modules[id] = geometry;
  shapes[id] = {
    ...info,
    bboxMm: geometry.bboxMm.map(r4),
    drawCalls: geometry.parts.length,
    vertices: geometry.parts.reduce((sum, part) => sum + part.vertexCount, 0)
  };
}

for (const book of BOOKS) {
  const mesh = book.kind === "hard" ? hardback(book) : paperback(book);
  if (book.leanDeg) lean(mesh, book.t, book.leanDeg);
  if (book.flat) layFlat(mesh, book.t);
  settleBook(mesh);
  add(book.id, mesh, {
    kind: "book", binding: book.kind, motif: book.motif, thicknessMm: book.t, depthMm: book.d, heightMm: book.h,
    leanDeg: book.leanDeg || 0, flat: Boolean(book.flat)
  });
}
for (const [id, build] of Object.entries(OBJECTS)) {
  const mesh = new Map();
  build(mesh);
  settleObject(mesh);
  add(id, mesh, { kind: "object" });
}

fs.mkdirSync(path.dirname(OUT_PACK), { recursive: true });
const pack = JSON.stringify({ format: "framework-module-pack@1", modules });
fs.writeFileSync(OUT_PACK, pack);

const lines = [
  "/**",
  " * Props for the /customize add-ons story. GENERATED, do not edit.",
  " *",
  " *   node scripts/build-shelf-props.mjs",
  " *",
  " * Every prop's geometry is one pack, `pack`. `bboxMm` is the prop as drawn: a",
  " * book sits on z = 0 with its left face at x = 0 and its spine towards -y; an",
  " * object sits on z = 0 centred on x = y = 0. Colour is the instance's: role 0",
  " * `steel`, role 1 `surface`. `shade` is the lamp's shade, in the lamp's own mm.",
  " */",
  "window.FrameworkProps = {",
  `    pack: ${JSON.stringify(PACK_URL)},`,
  `    shade: ${JSON.stringify(Object.fromEntries(Object.entries(SHADE).map(([k, v]) => [k, r4(v)])))},`,
  "    shapes: {",
  ...Object.entries(shapes).map(([id, shape], index, all) =>
    `        ${JSON.stringify(id)}: ${JSON.stringify(shape)}${index < all.length - 1 ? "," : ""}`),
  "    }",
  "};",
  ""
];
fs.writeFileSync(OUT_JS, lines.join("\n"));

console.log(`${Object.keys(modules).length} props in one pack, ${Math.round(pack.length / 1024)}KB before compression`);
for (const [id, shape] of Object.entries(shapes)) {
  const b = shape.bboxMm;
  console.log(`  ${shape.kind.padEnd(6)} ${id.padEnd(16)} ${(b[3] - b[0]).toFixed(0)} x ${(b[4] - b[1]).toFixed(0)} x ${(b[5] - b[2]).toFixed(0)} mm, ${shape.vertices} vertices, ${shape.drawCalls} draws`);
}

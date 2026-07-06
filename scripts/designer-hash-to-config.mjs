// Convert an OLD 2D-designer hash (designer.html "config code") into a canonical
// framework-config@1 object, faithfully reconstructing bay grouping and vertical
// stacking from the anchor grammar — not a linear-chain approximation.
//
// The layout math is replicated verbatim from designer-engine.js
// (positionPieceRelativeTo / processVerticalChain / processTokens, lines
// ~1598-1751) so results match what the old designer rendered. Module anchor
// coordinates are loaded from the real DesignerEngine.testPieces via a headless
// sandbox — no DOM needed (the engine touches no DOM at load time).
//
// Grammar (URL-decoded), see spec dam-step-0-vocabulary.md:
//   ( {pieceId} <conn> {pieceId> … )  <lateral>  ( … )  ;THEME_X
//   <conn>    = H|F <fam><side> - H|F <fam><side>   vertical stack (head/foot)
//   <lateral> = NE-SW | SW-NE | NW-SE | SE-NW        bay-to-bay (corner)
//   theme is global-only in this format (no per-module override).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolveSiteAlias, FRAMEWORK_CONFIG_SCHEMA } from
  '../../shelving-3d-pipeline/shared/framework-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '../js/designer-engine.js');

const THEME_TO_FINISH = { THEME_1: 'marine', THEME_2: 'sage', THEME_3: 'charcoal', THEME_4: 'coral' };

// ── Load real module anchor definitions from designer-engine.js (once) ──
let _testPieces = null;
function loadTestPieces() {
  if (_testPieces) return _testPieces;
  const src = fs.readFileSync(ENGINE, 'utf8');
  const sandbox = { window: {}, document: undefined, console: { log() {}, error() {}, warn() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'designer-engine.js', timeout: 5000 });
  const engine = sandbox.DesignerEngine || sandbox.window.DesignerEngine;
  if (!engine?.testPieces) throw new Error('DesignerEngine.testPieces not found after loading engine');
  _testPieces = engine.testPieces;
  return _testPieces;
}

// ── Layout primitives, replicated from designer-engine.js ──
function makeLayout(testPieces) {
  const findPiece = (id) => testPieces.find((p) => p.id === id);
  const isModuleId = (t) => testPieces.some((p) => p.id === t);
  const isLateral = (t) => ['NE-SW', 'SW-NE', 'NW-SE', 'SE-NW'].includes(t);
  const isVertical = (t) => /^(HS|FS|HW|FW|HD|FD|HC|FC)(NE|NW)-(HS|FS|HW|FW|HD|FD|HC|FC)(NE|NW)$/.test(t);

  function createPiece(id) {
    const info = findPiece(id);
    if (!info) throw new Error(`Invalid module: ${id}`);
    return { piece: info, x: 200, y: 200 };
  }
  // newPiece's `sourceType` anchor is aligned onto basePiece's `targetType` anchor.
  function positionRelative(newPiece, basePiece, sourceType, targetType) {
    const s = newPiece.piece.anchors.find((a) => a.type === sourceType);
    const t = basePiece.piece.anchors.find((a) => a.type === targetType);
    if (!s || !t) throw new Error(`Missing anchors ${sourceType}/${targetType} on ${newPiece.piece.id}/${basePiece.piece.id}`);
    newPiece.x = basePiece.x + t.x - s.x;
    newPiece.y = basePiece.y + t.y - s.y;
  }
  function analyzeConnection(token) {
    if (!isVertical(token)) return null;
    const [source, target] = token.split('-');
    return { source, target, isReversed: source.startsWith('F') };
  }

  function parseCode(code) {
    const tokens = [];
    let i = 0;
    const isConnChar = (c) => /[A-Z]/.test(c) || c === '-';
    while (i < code.length) {
      while (i < code.length && /\s/.test(code[i])) i++;
      if (i >= code.length) break;
      if (code[i] === '(' || code[i] === ')') { tokens.push(code[i]); i++; continue; }
      if (code[i] === '{') {
        i++; let id = '';
        while (i < code.length && code[i] !== '}') { id += code[i]; i++; }
        tokens.push(id); i++; continue;
      }
      if (isConnChar(code[i])) {
        let c = '';
        while (i < code.length && isConnChar(code[i])) { c += code[i]; i++; }
        if (c) tokens.push(c); continue;
      }
      i++;
    }
    return tokens.filter((t) => t.length > 0);
  }

  function processVerticalChain(tokens, startIndex) {
    const groupPieces = [];
    let i = startIndex, lastPiece = null, pending = null;
    while (i < tokens.length && tokens[i] !== ')') {
      const token = tokens[i];
      if (isModuleId(token)) {
        const np = createPiece(token);
        if (lastPiece && pending) {
          const c = analyzeConnection(pending);
          if (c) {
            const sourceType = c.isReversed ? c.target : c.source;
            const targetType = c.isReversed ? c.source : c.target;
            positionRelative(np, lastPiece, targetType, sourceType);
          }
          pending = null;
        }
        groupPieces.push(np);
        lastPiece = np;
      } else if (isVertical(token)) {
        pending = token;
      }
      i++;
    }
    return { pieces: groupPieces, endIndex: i };
  }

  function processTokens(tokens) {
    const groups = [];      // each: { pieces:[…], lateral:{connection, fromBay} | null }
    let currentGroupIndex = 0, i = 0;
    while (i < tokens.length) {
      if (tokens[i] === '(') {
        const { pieces, endIndex } = processVerticalChain(tokens, i + 1);
        groups.push({ pieces, lateral: null });
        i = endIndex + 1;
      } else if (isLateral(tokens[i])) {
        const connection = tokens[i];
        const [sourceType, targetType] = connection.split('-');
        i++;
        while (i < tokens.length && tokens[i] !== '(') i++;
        if (i < tokens.length) {
          const { pieces, endIndex } = processVerticalChain(tokens, i + 1);
          const prev = groups[currentGroupIndex].pieces;
          if (prev.length > 0 && pieces.length > 0) {
            positionRelative(pieces[0], prev[0], targetType, sourceType);
            const dx = pieces[0].x - 200, dy = pieces[0].y - 200;
            for (let j = 1; j < pieces.length; j++) { pieces[j].x += dx; pieces[j].y += dy; }
          }
          groups.push({ pieces, lateral: { connection, fromBay: currentGroupIndex } });
          currentGroupIndex++;
          i = endIndex + 1;
        }
      } else { i++; }
    }
    return groups;
  }

  return { parseCode, processTokens };
}

// ── Public API ──

// Extract the module-code + trailing theme from a raw designerUrl.
export function splitDesignerUrl(designerUrl) {
  if (!designerUrl) return null;
  const themeMatch = designerUrl.match(/;(THEME_\d)\s*$/);
  const globalTheme = themeMatch ? themeMatch[1] : null;
  let decoded;
  try { decoded = decodeURIComponent(designerUrl); } catch { return null; }
  // strip everything up to and including the first '#', and any trailing ;THEME
  const hashIdx = decoded.indexOf('#');
  let body = hashIdx >= 0 ? decoded.slice(hashIdx + 1) : decoded;
  body = body.replace(/;(THEME_\d)\s*$/, '');
  // context-figure suffix ")_[" is dropped for module reconstruction
  const ctx = body.indexOf(')_[');
  if (ctx !== -1) body = body.slice(0, ctx + 1);
  return { moduleCode: body, globalTheme };
}

// designerUrl (old designer.html bracket format) → framework-config@1.
// Returns { config, warnings:[] } or throws on an unrecoverable parse error.
export function hashToConfig(designerUrl, { id, vocab, themeToFinish = THEME_TO_FINISH } = {}) {
  const split = splitDesignerUrl(designerUrl);
  if (!split || !/\{/.test(split.moduleCode)) {
    throw new Error('not an old-format designer hash (no {pieceId} tokens)');
  }
  const testPieces = loadTestPieces();
  const { parseCode, processTokens } = makeLayout(testPieces);
  const groups = processTokens(parseCode(split.moduleCode));

  const finish = themeToFinish[split.globalTheme] || null;
  const typeSet = vocab ? new Set(vocab.types.map((t) => t.type)) : null;
  const warnings = [];
  const modules = [];
  let counter = 0;

  groups.forEach((group, bayIndex) => {
    const rootLocalId = group.pieces.length ? `item_${String(counter + 1).padStart(3, '0')}` : null;
    group.pieces.forEach((gp, idx) => {
      counter += 1;
      const localId = `item_${String(counter).padStart(3, '0')}`;
      const pieceId = gp.piece.id;
      const type = resolveSiteAlias(pieceId, vocab);
      if (typeSet && !typeSet.has(type)) warnings.push(`unmapped piece "${pieceId}" -> "${type}"`);
      const mod = {
        id: localId,
        type,
        finish,
        x: Math.round((gp.x - 200) * 1000) / 1000,   // designer units, bay-relative
        y: Math.round((gp.y - 200) * 1000) / 1000,
        _designer: { pieceId, x: gp.x, y: gp.y, bay: bayIndex },
      };
      if (idx === 0) {
        mod.placement = 'floor';
        if (group.lateral) {
          // link this bay's root to the prior bay's root
          const fromRoot = modules.find((m) => m._designer.bay === group.lateral.fromBay && m.placement === 'floor');
          if (fromRoot) mod.lateralOn = { ref: fromRoot.id, connection: group.lateral.connection };
        }
      } else {
        mod.on = [`item_${String(counter - 1).padStart(3, '0')}`];
      }
      modules.push(mod);
    });
  });

  const config = {
    schema: FRAMEWORK_CONFIG_SCHEMA,
    id,
    description: 'backfilled from site designerUrl (old 2D designer format)',
    provenance: { source: 'designer.html-hash', bays: groups.length },
    ...(finish ? { defaultFinish: finish } : {}),
    modules,
  };
  return { config, warnings };
}

export { THEME_TO_FINISH };

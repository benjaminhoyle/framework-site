# Shelving Builder V1 Notes

Date: 2026-06-30

## View Decision

Use a fast isometric product view for the first builder mockup, not the Blender/Cycles render.

The online builder should eventually use Three.js with optimized per-module GLB assets, simple environment lighting, flat-ish Framework materials, contact shadows, and a constrained orbit camera. It should feel closer to a clean product configurator than a CAD viewport. Blender stays for high-quality renders and AI image inputs.

The temporary tester in `shelving-builder.html` uses SVG isometric pseudo-3D instead of real meshes. That is intentional: it tests run/level grammar, owned sockets, named gaps, generated level patterns, color assignment, and framing before the real module GLBs arrive.

The mesh render experiment is paused. The current committed page should stay a skeleton/proxy configurator. Actual model rendering should be a proper Three.js/WebGL viewer using block-derived module assets, not an SVG painter's-algorithm projection.

Recommended v1 camera preset:

- `Isometric`: default and only view for now, auto-framed by generated bounds.

## Add And Remove Logic

The builder should not hard-code product-specific buttons. It should generate legal next-level patterns from the current run state.

Core rule:

1. Each placed module exposes owned top sockets.
2. Adjacent modules may have sockets at the same coordinate, but those sockets are not merged.
3. A named gap between adjacent modules creates a bridge span when the gap distance matches a module span.
4. A next-level pattern is legal when each module consumes explicit support socket IDs on one plane.
5. A support socket can be consumed only once per level.
6. Shelf surface intervals on the same plane must not overlap.
7. A `wide_adapter` cannot sit on a composite support span that includes a booster.
8. A vertical booster stack can be at most two boosters high.
9. The current prototype removes from the top level down rather than allowing arbitrary middle deletion.

This supports the cases we care about:

- normal vertical stacking,
- a booster plus slim extension on a wide adapter,
- a wide extension spanning two separately supported sub-spans.
- two adjacent bases with no shared socket merge,
- two bases separated by a slim/standard/wide gap with a matching bridge module.

The "two bases plus one spanning module" idea is represented as a gap bridge: the two bases stay separate, and the bridge consumes one owned socket from each base.

Corner modules should later enter through plan adjacency, not through shared sockets. A corner base can create a perpendicular run with its own coordinate frame while the vertical level grammar remains the same inside each run.

## UI Shape

The interaction should feel related to `designer.html`, but the buttons should move from visual SVG anchors to generated legal moves.

Suggested behavior:

- The floor run is edited by adding base units with a chosen gap: adjacent, slim, standard, or wide.
- Legal next levels are generated as whole patterns.
- One compact layer chooser cycles through legal patterns with previous/next controls, then adds or applies the selected pattern.
- The layer chooser lives on the view stage, similar in spirit to the existing `designer.html` plus/cycle controls.
- Existing levels can be selected and cycled. Replacement candidates are filtered against both the level below and the level above.
- Split and bridge moves are support-plane patterns.
- Color is per module, with the four named finishes: sage, marine, coral, charcoal.
- JSON remains visible during development so we can compare browser state with the Python pipeline config grammar.

## Prototype

Open:

```txt
/Users/ben/code/framework/framework-site/shelving-builder.html
```

Smoke test:

```sh
node scripts/test-shelving-builder-core.js
```

## Fresh Chat Handoff

Recommended next objective:

Build a reliable parser/export step for the updated Rhino source blocks, then feed those canonical module definitions back into both the builder grammar and a real WebGL viewer.

Current Rhino source:

```txt
/Users/ben/code/framework/shelving-3d-pipeline/source/260629_standard-configs.3dm
```

Observed source facts from the updated file:

- The file is readable with `rhino3dm`, is in millimeters, and contains about 56 instance definitions.
- Block names now include the original families plus new `deep`, `broad`, `compact`, `corner`, spacer, hanger, lamp, top-bar, and foot/hardware definitions.
- `_trimmed` blocks look like the best canonical module assets because their local coordinates normalize cleanly.
- Important naming cleanup: `standard booster` has a space, and there are duplicate/capitalized corner names. Normalize to stable snake_case IDs before building configs.
- Useful material/layer hints include `12mm MDF`, `16mm solid`, `20x1.5 round`, `20x1.5 square`, `20x20x1.5`, `20x3 flat`, `bolts`, `Drill`, and `Light`.
- Support signatures appear to normalize to width spans around `440`, `703`, and `1143` mm, with standard depth around `257` mm and deep/broad/compact depth around `427` mm.
- Bases are roughly `z 13 -> 435`; extensions, spacers, and hangers are roughly `z 33 -> 335`.

Open design decisions for the next pass:

- Decide whether the parser emits canonical JSON first, GLB assets first, or both in one export step.
- Treat corner modules as perpendicular run adjacency with their own coordinate frame, not shared sockets.
- Add screw feet to all base units once the Rhino geometry includes them.
- Keep the browser builder constrained to legal whole-level patterns until the grammar is stable.

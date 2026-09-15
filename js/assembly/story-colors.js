/**
 * The shot list for the add-ons on /colors: The Lantern Shelf takes a bookend
 * at the right-hand end of each shelf, books on all three, a fourth bookend at
 * the left of the top row, a few objects, and its lamp, which swings and comes
 * on, as you scroll.
 *
 * Direction only, like js/assembly/story.js and story-how.js. Every resting
 * place of the shelf comes out of js/assembly/lantern-shelf.js, which
 * scripts/bake-assembly-story.mjs generates from data/assembly/lantern.design.json
 * through the builder's own placement engine. That includes `ends`, every end
 * of the shelf that can take a bookend, from which this file chooses by name.
 * The props (books, objects, the lamp's light) are js/assembly/props.js,
 * generated with their geometry by scripts/build-shelf-props.mjs; they are laid
 * out here, from the bookends' feet and the boards the engine places.
 *
 * ## Beats
 *
 *   0 to 3%      the shelf, bare
 *   3 to 24%     the camera closes on the right-hand end of the bottom shelf,
 *                from the side and a little below; a bookend comes in from
 *                outside the end, below the bar, and rises onto it
 *   24 to 42%    back out: the same at the middle shelf, then the top one
 *   42 to 60%    square on, and the books slide into all three rows from the
 *                left, the top row first, each settling a beat after the one in
 *                front of it
 *   60 to 70%    to the top row's left-hand end, where the fourth bookend
 *                comes in and caps it
 *   70 to 84%    the whole shelf: objects slide into the spaces the books left
 *                and drop onto the open tops, with a small bounce
 *   84 to 100%   the lamp comes down into its post, swings on it, and comes on
 *
 * ## The camera
 *
 * Every camera key states a `view`, so scroll-story.js draws this story with
 * the renderer's orbit camera and turns the builder's light rig with it. The
 * lens is 16 degrees, a touch of perspective, and 24 for the close-up.
 *
 * ## The close-up, and the bar that looked bent
 *
 * Square tube crossing square tube under a shelf reads, from most three-quarter
 * views, as one bar with a jog in it. The geometry is exact (checked part by
 * part in separate colours); it is the Poggendorff illusion, a slanted bar
 * broken by a band looking offset either side. So the close-up is on the
 * bottom shelf, which has one rail rather than three, from the side and only
 * five degrees below the board: the underside is seen nearly edge on, the
 * crossing is a thin sliver, and nothing slants across the picture. And it
 * lights harder, so a tube's faces are told apart instead of reading as one
 * flat orange.
 *
 * ## Why the bookends come in sideways
 *
 * A bookend rises onto its bar only a few centimetres: its foot hangs about
 * 120 mm over the board below. So each one is held outside the end of the
 * shelf, clear of the frame, slides in under the board along the shelf's
 * length, stops under its bar, and rises the last 80 mm.
 *
 * ## The lamp
 *
 * The lamp in the geometry has a 33 mm pin; the one the workshop makes has a
 * 10 cm pin. So the camera never goes near the lamp's joint, and the lamp
 * pauses 150 mm over its post before the last drop. When it has swung, a glow
 * the size of its shade and two rings of rays come on, with a flicker, and the
 * lamp's words stay up through it.
 *
 * ## Nothing pops
 *
 * A part is hidden until the instant it starts to move, and shown then from a
 * place outside the frame; only the lamp's light switches on in the picture,
 * which is the point of it. scripts/test-assembly-story-colors.mjs measures
 * that with the orbit camera's own maths on every aspect from a phone to 21:9,
 * in the calm tier's cuts too, and checks that nothing passes through anything.
 */
(function () {
    "use strict";

    var shelf = window.FrameworkAssemblyShelf;
    var props = window.FrameworkProps;

    /*
     * The two product captions link to their products: the bookend to its own
     * page, and the lamp, which the catalogue sells on a shelf rather than on
     * its own, to The Lighted Console, the catalogue's lamp shelf.
     */
    var COPY = {
        bookend: {
            title: 'The Bookend',
            href: '/shelving.html?config=bookend',
            body: 'Slides up onto the bar under a shelf and holds a row of books upright. Ksh 1,000 each.'
        },
        rest: {
            title: 'Fully detachable',
            body: 'Put one at each end of a shelf and move them as your books move. Compatible with all but our trimmed units.'
        },
        lamp: {
            title: 'The Lamp',
            href: '/shelving.html?config=lighted-console',
            body: 'A steel lamp that drops into the shelving and pivots. Lamp shade and bulb not included.'
        },
        alt: {
            bookend: 'A sage bookend seated on the bar under a shelf, seen from below.',
            lamp: 'The Lantern Shelf in Coral, with the lamp arm rising from its right end.'
        }
    };

    /*
     * The finish, as /builder paints it. The bake carries the catalogue's pair,
     * and /builder lifts both before they reach the shader (shaderPalette in
     * js/builder/app.js: steel by 1.26, boards by 1.07), because the lighting
     * darkens everything it draws.
     */
    var STEEL_GAIN = 1.26;
    var SURFACE_GAIN = 1.07;

    function lift(hex, gain) {
        var value = parseInt(String(hex).replace('#', ''), 16);
        return '#' + [16, 8, 0].map(function (shift) {
            var channel = Math.min(255, Math.round(((value >> shift) & 255) * gain));
            return (channel < 16 ? '0' : '') + channel.toString(16);
        }).join('');
    }

    // ------------------------------------------------------------- helpers

    function round(v) { return Math.round(v * 10000) / 10000; }

    function byId(list, id) {
        for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
        throw new Error('assembly story: no "' + id + '" in the bake');
    }

    function union(boxes, pad) {
        var margin = typeof pad === 'number' ? [pad, pad, pad] : pad;
        var box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        boxes.forEach(function (b) {
            for (var axis = 0; axis < 3; axis += 1) {
                box[axis] = Math.min(box[axis], b[axis]);
                box[axis + 3] = Math.max(box[axis + 3], b[axis + 3]);
            }
        });
        return [box[0] - margin[0], box[1] - margin[1], box[2] - margin[2],
            box[3] + margin[0], box[4] + margin[1], box[5] + margin[2]];
    }

    function shape(id) {
        var s = props.shapes[id];
        if (!s) throw new Error('assembly story: no prop "' + id + '"');
        return s;
    }

    var UNITS = shelf.pieces.filter(function (p) { return p.role !== 'lamp'; });
    var LAMP = shelf.pieces.filter(function (p) { return p.role === 'lamp'; })[0];
    // Out of the shelf from a bookend's end: the bake names the side of the
    // bookend's own unit, which is not the side of the shelf for the slim unit.
    function outward(bookend) { return /_right$/.test(bookend.id) ? 1 : -1; }

    // The four bookends, by the bake's names for the ends they hang on, in the
    // order they go on.
    var BOTTOM_RIGHT = byId(shelf.ends, 'end_item_001_right');
    var MIDDLE_RIGHT = byId(shelf.ends, 'end_item_002_right');
    var TOP_RIGHT = byId(shelf.ends, 'end_item_003_right');
    var TOP_LEFT = byId(shelf.ends, 'end_item_003_left');
    var BOOKENDS = [BOTTOM_RIGHT, MIDDLE_RIGHT, TOP_RIGHT, TOP_LEFT];

    /*
     * The surfaces things stand on: the top of each board, which the test
     * holds against the engine's own boards, and how far along each one runs.
     */
    var SURFACES = {
        bottom: { z: 97, from: -138, to: 1282 },
        middle: { z: 402, from: -138, to: 1282 },
        underSlim: { z: 704, from: -138, to: 579 },
        besideSlim: { z: 704, from: 579, to: 1282 },
        slimTop: { z: 1006, from: -138, to: 579 }
    };
    // Spines on a line 34 mm back from the front; objects centred on the board.
    var SPINE_LINE = 34;
    var MID_DEPTH = 129;

    // ------------------------------------------------------------ the rows

    /*
     * The inks: a cover and its motif. Contemporary African paperbacks, bright
     * and printed flat, with a cream, a sand and a blush to rest the eye.
     * Nothing coral or terracotta, which is the shelf's own colour.
     */
    var INK = {
        saffron: ['#EDB136', '#22335E'],
        cobalt: ['#41679E', '#EDB136'],
        teal: ['#237F79', '#F6E5C4'],
        fuchsia: ['#C24C80', '#F7D35C'],
        blush: ['#F3B4A6', '#22335E'],
        cream: ['#F3E7CD', '#237F79'],
        emerald: ['#2E7D5B', '#F3B4A6'],
        ochre: ['#D9A31C', '#F6E5C4'],
        sky: ['#6FB5DA', '#27336A'],
        sand: ['#E6D1A8', '#2F5DA8'],
        turquoise: ['#3FB3A6', '#22335E'],
        sage: ['#9CBF9A', '#22335E'],
        leaf: ['#7FAF7A', '#F3B4A6']
    };

    /*
     * The three rows, each written right to left from its right-hand bookend,
     * which is also the order the books arrive in. An entry is "shape ink", a
     * stack of books lying flat (bottom first, each with a small turn and a
     * nudge along the shelf so it looks put down), or a gap. A leaning book
     * leans right, into the book before it, which is always taller than the
     * point it touches.
     *
     * The top row runs the whole way to a second bookend, so its books close up
     * to fill it, in wider books and lighter inks so it does not read as a
     * block. Its last book is a slim one, because that bookend's pocket passes
     * over it on the way in. The other two stop about halfway, and the objects
     * take the rest.
     */
    var ROWS = [
        {
            id: 'top', surface: 'underSlim', right: TOP_RIGHT, left: TOP_LEFT,
            items: [
                'hb_half sand', 'pb_plain_c sky', 'pb_title saffron', 'hb_block teal', 'pb_plain_d blush',
                'pb_kente cream', 'pb_plain_c sage', 'pb_wide saffron', 'hb_half sky', 'pb_plain_d cream',
                'pb_title fuchsia', 'pb_plain_c blush', 'hb_block sand', 'pb_zigzag sky', 'pb_plain_e saffron',
                'pb_kente teal', 'pb_wide cobalt', 'pb_plain_e sky', 'pb_plain_d teal', 'pb_title cream',
                'pb_slim saffron'
            ]
        },
        {
            id: 'middle', surface: 'middle', right: MIDDLE_RIGHT, left: null,
            items: [
                'hb_block teal', 'pb_kente saffron', 'pb_plain_c sky', 'pb_dots sand', 'pb_plain_a fuchsia',
                'pb_zigzag cream', 'pb_plain_e sage', 'pb_chevron cobalt', 'pb_plain_d turquoise', 'pb_slim cobalt',
                'pb_band saffron', 'pb_plain_b blush', 'pb_title sage', 'pb_chevron_lean ochre'
            ]
        },
        {
            id: 'bottom', surface: 'bottom', right: BOTTOM_RIGHT, left: null,
            items: [
                'pb_title cream', 'hb_half cobalt', 'pb_plain_a ochre', 'pb_dots teal', 'pb_plain_c blush',
                'pb_plain_b sky', 'pb_zigzag fuchsia', 'pb_plain_d sage', 'pb_wide saffron', 'pb_plain_c turquoise',
                // Mostly plain covers, so the stack reads as a stack and not as
                // five more patterns, with a little room either side of it.
                { gap: 36 },
                { stack: [
                    ['hb_half_flat', 'sand', 0, 0], ['pb_plain_c_flat', 'teal', 2.5, 12],
                    ['pb_plain_a_flat', 'saffron', -1.5, 30], ['pb_zigzag_flat', 'sky', 3, 34],
                    ['pb_dots_flat', 'fuchsia', -2, 42]
                ] },
                { gap: 36 },
                'pb_band cobalt', 'pb_title ochre', 'pb_title_lean emerald'
            ]
        }
    ];

    /*
     * A capped row starts and ends at the inboard face of a bookend's foot,
     * 4.95 mm inside the pocket it hangs by; a loose row starts there and
     * stops where its books do. The test holds the numbers against the engine
     * and the bookend's own geometry.
     */
    var FOOT_INSET = 4.95;
    var LOOSE_GAP = 0.4;

    function width(id) { var b = shape(id).bboxMm; return b[3] - b[0]; }
    function stackWidth(layers) {
        return Math.max.apply(null, layers.map(function (layer) { return width(layer[0]) + layer[3]; })) + 6;
    }

    /** A prop's box on the shelf: its drawn box, moved and turned about its pivot. */
    function footprint(b, t, pivot, degrees) {
        var cos = Math.cos(degrees * Math.PI / 180);
        var sin = Math.sin(degrees * Math.PI / 180);
        var cx = t[0] + pivot[0];
        var cy = t[1] + pivot[1];
        var xs = [];
        var ys = [];
        [[b[0], b[1]], [b[3], b[1]], [b[3], b[4]], [b[0], b[4]]].forEach(function (corner) {
            var dx = t[0] + corner[0] - cx;
            var dy = t[1] + corner[1] - cy;
            xs.push(cx + dx * cos - dy * sin);
            ys.push(cy + dx * sin + dy * cos);
        });
        return [Math.min.apply(null, xs), Math.min.apply(null, ys), t[2] + b[2],
            Math.max.apply(null, xs), Math.max.apply(null, ys), t[2] + b[5]].map(round);
    }

    var BOOKS = [];

    function place(shapeId, ink, left, z, turn, row) {
        if (!INK[ink]) throw new Error('assembly story: no ink "' + ink + '"');
        var b = shape(shapeId).bboxMm;
        var piece = {
            id: 'book_' + (BOOKS.length + 1),
            moduleId: shapeId,
            pack: props.pack,
            palette: { steel: INK[ink][0], surface: INK[ink][1] },
            t: [round(left - b[0]), SPINE_LINE, round(z - b[2])],
            rot: turn || 0,
            pivot: [round((b[0] + b[3]) / 2), round((b[1] + b[4]) / 2)],
            shape: shapeId,
            ink: ink,
            row: row
        };
        piece.bounds = footprint(b, piece.t, piece.pivot, piece.rot);
        BOOKS.push(piece);
        return piece;
    }

    ROWS.forEach(function (row) {
        row.shelfTop = SURFACES[row.surface].z;
        row.from = row.right.anchor[0] - FOOT_INSET;
        row.to = row.left ? row.left.anchor[0] + FOOT_INSET : null;
        var entries = row.items.map(function (item) {
            if (typeof item === 'string') {
                var parts = item.split(' ');
                return { kind: 'book', shape: parts[0], ink: parts[1], width: width(parts[0]) };
            }
            if (item.gap) return { kind: 'gap', width: item.gap };
            return { kind: 'stack', layers: item.stack, width: stackWidth(item.stack) };
        });
        var used = entries.reduce(function (sum, e) { return sum + e.width; }, 0);
        var joins = entries.length - 1;
        var gap = LOOSE_GAP;
        if (row.to !== null) {
            var slack = (row.from - row.to) - used;
            if (slack < 0) throw new Error('assembly story: the ' + row.id + ' row is ' + (-slack).toFixed(1) + ' mm too long');
            gap = slack / joins;
        }
        row.gap = gap;
        row.groups = [];
        var cursor = row.from;
        entries.forEach(function (entry, index) {
            if (index > 0) cursor -= gap;
            cursor -= entry.width;
            if (entry.kind === 'book') {
                row.groups.push([place(entry.shape, entry.ink, cursor, row.shelfTop, 0, row.id)]);
            } else if (entry.kind === 'stack') {
                var height = 0;
                row.groups.push(entry.layers.map(function (layer) {
                    var piece = place(layer[0], layer[1], cursor + 3 + layer[3], row.shelfTop + height, layer[2], row.id);
                    var lb = shape(layer[0]).bboxMm;
                    height += lb[5] - lb[2];
                    return piece;
                }));
            }
        });
        row.end = cursor;
    });

    // -------------------------------------------------------------- objects

    /*
     * The objects, on what the books left: the open ends of the two lower rows,
     * the top of the slim unit, and the board beside it under the lamp, all low
     * enough to clear the lamp's shade wherever it swings. Each is two inks, a
     * body and an accent, from the books' own palette. `arrive` is how: slide
     * in from the left under a board, or drop onto an open top with a bounce.
     */
    var OBJECT_INK = {
        cubesWarm: ['#EDB136', '#C24C80'],
        bowlBlue: ['#41679E', '#EDB136'],
        orbTeal: ['#237F79', '#F3E7CD'],
        bottleFuchsia: ['#C24C80', '#F3E7CD'],
        bottleTeal: ['#237F79', '#F3E7CD'],
        vaseSaffron: ['#EDB136', '#237F79'],
        cubesSage: ['#9CBF9A', '#41679E'],
        plantLeaf: ['#7FAF7A', '#F3B4A6'],
        pyramidBlush: ['#F3B4A6', '#EDB136'],
        vaseFuchsia: ['#C24C80', '#F3E7CD']
    };
    // On each board the one furthest in slides first, so the next one in never
    // has to pass through it.
    var OBJECTS = [
        // Halfway along the open stretch between the bowl and the books.
        { shape: 'vase', surface: 'middle', x: 560, ink: 'vaseFuchsia', turn: 0, arrive: 'slide' },
        { shape: 'bowl', surface: 'middle', x: 185, ink: 'bowlBlue', turn: 0, arrive: 'slide' },
        { shape: 'cubes', surface: 'middle', x: -40, ink: 'cubesWarm', turn: 12, arrive: 'slide' },
        { shape: 'bottle', surface: 'bottom', x: 180, ink: 'bottleFuchsia', turn: 0, arrive: 'slide' },
        { shape: 'orb', surface: 'bottom', x: 20, ink: 'orbTeal', turn: 20, arrive: 'slide' },
        { shape: 'bottle', surface: 'slimTop', x: 30, ink: 'bottleTeal', turn: 0, arrive: 'drop' },
        { shape: 'vase', surface: 'slimTop', x: 195, ink: 'vaseSaffron', turn: 0, arrive: 'drop' },
        { shape: 'cubes', surface: 'slimTop', x: 395, ink: 'cubesSage', turn: -10, arrive: 'drop' },
        { shape: 'plant', surface: 'besideSlim', x: 700, ink: 'plantLeaf', turn: 0, arrive: 'drop' },
        { shape: 'pyramid', surface: 'besideSlim', x: 1000, ink: 'pyramidBlush', turn: 45, arrive: 'drop' }
    ].map(function (object, index) {
        var b = shape(object.shape).bboxMm;
        var t = [object.x, MID_DEPTH, SURFACES[object.surface].z - b[2]];
        return {
            id: 'object_' + (index + 1),
            moduleId: object.shape,
            pack: props.pack,
            palette: { steel: OBJECT_INK[object.ink][0], surface: OBJECT_INK[object.ink][1] },
            t: t,
            rot: object.turn,
            pivot: [0, 0],
            surface: object.surface,
            arrive: object.arrive,
            bounds: footprint(b, t, [0, 0], object.turn)
        };
    });

    // ---------------------------------------------------------- the light

    /*
     * The lamp comes on as a light rather than a colour. While its track says
     * `lit`, the inside of the shade glows and the outside brightens, and light
     * leaves a bulb at the shade's centre through its two open ends: down onto
     * the board and whatever stands in that cone, and up onto the arm
     * (renderer.setLamp; the engine carries it to wherever the lamp is). Nothing
     * below the board the lamp stands over is lit, because the board is in the
     * way. The shade is measured off lamp.json by scripts/build-shelf-props.mjs.
     */
    var SHADE = props.shade;
    var BULB = [SHADE.cx, SHADE.cy, (SHADE.z0 + SHADE.z1) / 2];
    var BULB_AT_REST = (function () {
        var turn = (LAMP.rot * Math.PI) / 180;
        var x = BULB[0] - LAMP.pivot[0];
        var y = BULB[1] - LAMP.pivot[1];
        return [
            LAMP.t[0] + LAMP.pivot[0] + Math.cos(turn) * x - Math.sin(turn) * y,
            LAMP.t[1] + LAMP.pivot[1] + Math.sin(turn) * x + Math.cos(turn) * y,
            LAMP.t[2] + BULB[2]
        ];
    })();
    // The highest board under the bulb.
    var LAMP_FLOOR = Object.keys(SURFACES).map(function (name) { return SURFACES[name]; })
        .filter(function (s) { return s.z < BULB_AT_REST[2] && s.from <= BULB_AT_REST[0] && BULB_AT_REST[0] <= s.to; })
        .reduce(function (top, s) { return Math.max(top, s.z); }, -Infinity);
    // The boards are pale, so a light at full strength turns them white; this
    // is enough to read as a pool on them without losing their colour.
    var LIGHT = { inside: '#FFE9A6', outside: '#FFFAF0', outsideLit: 0.5, color: '#FFF1D6', reach: 600, strength: 0.55 };

    // -------------------------------------------------------- the moves

    var RISE = 80;
    // How far out a part waits, measured by the test: clear of the close-up
    // for the first bookend, clear of the wide frames for everything after.
    var NEAR_OUT = 600;
    var FAR_OUT = 5200;
    var DROP = 2600;
    var BOUNCE = 24;
    var LAMP_LIFT = 2400;
    var LAMP_HOVER = 150;
    var LAMP_SWING = [28, -22];

    function below() { return [0, 0, -RISE]; }
    function outside(b, reach) { return [outward(b) * reach, 0, -RISE]; }
    var HOME = [0, 0, 0];

    // -------------------------------------------------------------- the shot

    var LENS = 16;
    var HARD = [0.44, 0.44, 0.08, 0.10];
    var FRONT = { azimuthDeg: 30, elevationDeg: 20, fovDeg: LENS };
    var RIGHT_END = { azimuthDeg: 36, elevationDeg: 14, fovDeg: LENS };
    var SQUARE = { azimuthDeg: 10, elevationDeg: 12, fovDeg: LENS };
    // The close-up: from the side, five degrees under the board (see above).
    var SIDE = { azimuthDeg: 25, elevationDeg: -5, fovDeg: 24, light: HARD };
    // The top row's left-hand end from front-left: a bookend is a plate across
    // the shelf's length, so square on it is a sliver.
    var CAP = { azimuthDeg: -34, elevationDeg: 8, fovDeg: LENS };

    var BARE = union(UNITS.map(function (p) { return p.bounds; }), [120, 80, 90]);
    var WHOLE = union(shelf.pieces.map(function (p) { return p.bounds; }), [110, 70, 80]);
    var a = BOTTOM_RIGHT.anchor;
    var NEAR = [a[0] - 175, a[1] - 70, a[2] - 265, a[0] + 95, a[1] + 70, a[2] + 40];
    var c = TOP_LEFT.anchor;
    var TOP_LEFT_END = [c[0] - 260, 20, SURFACES.underSlim.z - 40, c[0] + 420, 250, c[2] + 30];

    var T = {
        closeIn: 0.03, close: 0.10, closeOut: 0.24, wide: 0.30, wideOut: 0.42,
        rows: 0.46, rowsOut: 0.60, cap: 0.635, capOut: 0.70, whole: 0.74
    };

    var cameraKeys = [
        { at: 0, focus: BARE, padding: 1.06, view: FRONT },
        { at: T.closeIn, focus: BARE, padding: 1.06, view: FRONT },
        { at: T.close, focus: NEAR, padding: 1.1, view: SIDE },
        { at: T.closeOut, focus: NEAR, padding: 1.1, view: SIDE },
        { at: T.wide, focus: BARE, padding: 1.06, view: RIGHT_END },
        { at: T.wideOut, focus: BARE, padding: 1.06, view: RIGHT_END },
        { at: T.rows, focus: BARE, padding: 1.04, view: SQUARE },
        { at: T.rowsOut, focus: BARE, padding: 1.04, view: SQUARE },
        { at: T.cap, focus: TOP_LEFT_END, padding: 1.05, view: CAP },
        { at: T.capOut, focus: TOP_LEFT_END, padding: 1.05, view: CAP },
        { at: T.whole, focus: WHOLE, padding: 1.04, view: FRONT },
        { at: 1, focus: WHOLE, padding: 1.04, view: FRONT }
    ];

    var tracks = {};

    function bookendTrack(bookend, reach, shown, stop, home) {
        tracks[bookend.id] = [
            { at: 0, off: outside(bookend, reach), hidden: true },
            { at: shown, off: outside(bookend, reach), hidden: false },
            { at: stop, off: below() },
            { at: home, off: HOME }
        ];
    }

    tracks[BOTTOM_RIGHT.id] = [
        { at: 0, off: outside(BOTTOM_RIGHT, NEAR_OUT), hidden: true },
        { at: T.close, off: outside(BOTTOM_RIGHT, NEAR_OUT), hidden: false },
        { at: 0.12, off: outside(BOTTOM_RIGHT, NEAR_OUT) },
        { at: 0.18, off: below() },
        { at: 0.22, off: HOME }
    ];
    bookendTrack(MIDDLE_RIGHT, FAR_OUT, 0.31, 0.345, 0.365);
    bookendTrack(TOP_RIGHT, FAR_OUT, 0.37, 0.40, 0.42);
    bookendTrack(TOP_LEFT, FAR_OUT, 0.64, 0.67, 0.69);

    /*
     * The books: one train per row, from the left. Every book in a row travels
     * the same distance with the same ease, the far right-hand one first and
     * each of the rest a beat behind, so the spaces between them open as they
     * cross the shelf and close as each settles. The rows start a little
     * apart, top first.
     */
    var ROW_START = { top: 0.47, middle: 0.495, bottom: 0.52 };
    var BOOK_BEAT = 0.0013;
    var BOOK_MOVE = 0.05;
    ROWS.forEach(function (row) {
        row.groups.forEach(function (group, index) {
            var start = round(ROW_START[row.id] + index * BOOK_BEAT);
            group.forEach(function (book) {
                tracks[book.id] = [
                    { at: 0, off: [-FAR_OUT, 0, 0], hidden: true },
                    { at: start, off: [-FAR_OUT, 0, 0], hidden: false },
                    { at: round(start + BOOK_MOVE), off: HOME }
                ];
            });
        });
    });

    /*
     * The objects: the two under boards slide in from the left and settle, the
     * rest drop from above and bounce once. One after another, overlapping a
     * little, so the shelf fills in a patter rather than all at once.
     */
    OBJECTS.forEach(function (object, index) {
        // Ten of them, done by the time the lamp comes down at 0.845.
        var start = round(0.745 + index * 0.008);
        if (object.arrive === 'slide') {
            tracks[object.id] = [
                { at: 0, off: [-FAR_OUT, 0, 0], hidden: true },
                { at: start, off: [-FAR_OUT, 0, 0], hidden: false },
                { at: round(start + 0.03), off: HOME, ease: 'out' }
            ];
        } else {
            tracks[object.id] = [
                { at: 0, off: [0, 0, DROP], hidden: true },
                { at: start, off: [0, 0, DROP], hidden: false },
                { at: round(start + 0.016), off: HOME, ease: 'in' },
                { at: round(start + 0.022), off: [0, 0, BOUNCE], ease: 'out' },
                { at: round(start + 0.028), off: HOME, ease: 'in' }
            ];
        }
    });

    tracks[LAMP.id] = [
        { at: 0, off: [0, 0, LAMP_LIFT], hidden: true },
        { at: 0.845, off: [0, 0, LAMP_LIFT], hidden: false },
        { at: 0.87, off: [0, 0, LAMP_HOVER] },
        { at: 0.89, off: HOME },
        { at: 0.895, turn: 0 },
        { at: 0.915, turn: LAMP_SWING[0] },
        { at: 0.935, turn: LAMP_SWING[1] },
        { at: 0.955, turn: 0 }
    ];

    // It comes on once it is back square, blinks off for a moment, and stays on.
    var SWITCH_ON = 0.96;
    tracks[LAMP.id].push(
        { at: SWITCH_ON, lit: true },
        { at: 0.966, lit: false },
        { at: 0.97, lit: true }
    );

    function bare(p) {
        var out = { id: p.id, moduleId: p.moduleId, t: p.t, rot: p.rot, pivot: p.pivot };
        if (p.pack) out.pack = p.pack;
        if (p.palette) out.palette = p.palette;
        if (p.id === LAMP.id) out.glow = { inside: LIGHT.inside, outside: LIGHT.outside, outsideLit: LIGHT.outsideLit };
        return out;
    }

    window.FrameworkAssemblyStory = {
        title: shelf.title,
        finish: shelf.finish,
        finishName: shelf.finishName,
        palette: { steel: lift(shelf.palette.steel, STEEL_GAIN), surface: lift(shelf.palette.surface, SURFACE_GAIN) },

        photoBase: '/images/shelving/configs/',

        pieces: shelf.pieces.concat(BOOKENDS).map(bare)
            .concat(BOOKS.map(bare)).concat(OBJECTS.map(bare)),

        /* For the test: who does what, and the numbers it is measured against. */
        bookendOrder: BOOKENDS.map(function (b) { return b.id; }),
        lamp: LAMP.id,
        books: BOOKS,
        objects: OBJECTS,
        light: {
            piece: LAMP.id, bulb: BULB, radius: SHADE.r, below: SHADE.z0, above: SHADE.z1,
            floor: LAMP_FLOOR, color: LIGHT.color, reach: LIGHT.reach, strength: LIGHT.strength
        },
        switchOn: SWITCH_ON,
        surfaces: SURFACES,
        rows: ROWS.map(function (row) {
            return {
                id: row.id, shelfTop: row.shelfTop, right: row.right.id, left: row.left ? row.left.id : null,
                from: row.from, to: row.to, end: row.end, gap: row.gap,
                books: row.groups.reduce(function (all, group) { return all.concat(group.map(function (b) { return b.id; })); }, [])
            };
        }),
        spineLine: SPINE_LINE,
        footInset: FOOT_INSET,
        riseMm: RISE,
        lampHoverMm: LAMP_HOVER,
        lampSwingDeg: LAMP_SWING,
        gains: { steel: STEEL_GAIN, surface: SURFACE_GAIN },
        inks: INK,
        tracks: tracks,

        keys: cameraKeys,

        captions: [
            { id: 'bookend', from: 0.06, to: 0.25, photo: '/images/shelving/animations/bookend-slide.jpg' },
            { id: 'rest', from: 0.29, to: 0.70 },
            { id: 'lamp', from: 0.895, to: 0.999, photo: 'lantern-shelf-emptied' }
        ].map(function (caption) {
            return {
                id: caption.id, from: caption.from, to: caption.to,
                title: COPY[caption.id].title,
                href: COPY[caption.id].href || null,
                body: COPY[caption.id].body || null,
                photo: caption.photo || null,
                photoAlt: COPY.alt[caption.id] || null
            };
        }),

        pins: []
    };
})();

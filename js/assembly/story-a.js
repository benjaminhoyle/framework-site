/**
 * Landing A, "One unit first": The Curator's Shelf adding up as you scroll.
 *
 * The same shape as js/assembly/story.js and the same generated geometry
 * (js/assembly/curator-shelf.js); only the direction differs. Where story.js
 * explains the system, this one tells the segment message in numbers: a shelf
 * you can buy one unit at a time, so the price starts where you start. Each
 * part is named on screen as it lands, by the name the catalogue and the
 * builder use, and the running total in the captions is the "As shown" price
 * by the end.
 *
 * Five beats over about three screens. The joint close-up is cut: "No tools"
 * in the second caption says what that beat proved, and the catalogue still
 * carries the joint. Nothing lands in pairs, as before.
 *
 * Captions are from research/landing-strategy.md section 4, contender A,
 * taken verbatim; scripts/test-landing-a.mjs checks them against that file.
 * The pins depart from the brief on purpose: it wrote a price tag per part,
 * and Ben asked (2026-09-11) for the name of the unit instead. The captions
 * already carried the running total, so nothing else moved.
 */
(function () {
    "use strict";

    var shelf = window.FrameworkAssemblyShelf;

    /*
     * Every word on the page, in one place, one `id: 'string'` per line.
     * The running total lives here; the pins carry only each part's name.
     */
    var COPY = {
        base: {
            title: 'One unit stands on its own.',
            body: 'A two-tier base on adjustable feet, so it sits level on any floor. Ksh 8,000/- as shown.'
        },
        adapter: {
            title: 'The next one drops on. No tools.',
            body: 'A pin under each leg slides into the post below. Ksh 15,000/- so far.'
        },
        tier: {
            title: 'Add a tier when you need one.',
            body: 'A short unit, a post, and a shelf across them. Ksh 29,500/- so far.'
        },
        whole: {
            title: 'Or the whole shelf at once.',
            body: 'As shown: The Curator\'s Shelf, Ksh 36,500/- in Coral. Delivered assembled within Nairobi.'
        },
        pins: {
            item_001: 'Wide Base',
            item_002: 'Wide Adapter',
            item_003: 'Slim Extension',
            item_004: 'Standard Booster',
            item_005: 'Standard Extension',
            item_006: 'Standard Booster',
            item_007: 'Wide Extension'
        },
        alt: {
            base: 'A steel leg meeting the floor beside the lowest shelf board.',
            tier: 'The finished shelf, empty, showing the uneven pockets.',
            whole: 'The finished shelf holding books, bowls and small figures.'
        }
    };

    // ------------------------------------------------------------- helpers

    function piece(id) {
        for (var i = 0; i < shelf.pieces.length; i += 1) {
            if (shelf.pieces[i].id === id) return shelf.pieces[i];
        }
        throw new Error('assembly story: no piece "' + id + '"');
    }

    /** The bounding box of some pieces, grown by a margin, as a focus box. */
    function around(ids, pad) {
        var margin = typeof pad === 'number' ? [pad, pad, pad] : pad;
        var box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        ids.forEach(function (id) {
            var b = piece(id).bounds;
            for (var axis = 0; axis < 3; axis += 1) {
                if (b[axis] < box[axis]) box[axis] = b[axis];
                if (b[axis + 3] > box[axis + 3]) box[axis + 3] = b[axis + 3];
            }
        });
        return [
            box[0] - margin[0], box[1] - margin[1], box[2] - margin[2],
            box[3] + margin[0], box[4] + margin[1], box[5] + margin[2]
        ];
    }

    var everything = shelf.pieces.map(function (p) { return p.id; });

    /** The same box with its ceiling moved, for opening the frame into space. */
    function upTo(box, z) {
        return [box[0], box[1], box[2], box[3], box[4], z];
    }

    /** The same box with its floor moved, for keeping the model high in frame. */
    function downTo(box, z) {
        return [box[0], box[1], z, box[3], box[4], box[5]];
    }

    /**
     * The point on a piece its name tag rides.
     *
     * The front-right post, at mid height: nearest the camera in the locked
     * isometric, so the dot is never behind a board. Which post is front-right
     * is read off the joints the piece lands on (or, for the base, the joints
     * the adapter lands on it with), against the renderer's own view direction,
     * so a camera change moves the tags to the right leg by itself.
     */
    function tagPoint(id) {
        var view = (window.FrameworkDesignerRenderer && window.FrameworkDesignerRenderer.VIEW_DIRECTION)
            || [0.68, -0.68, 0.56];
        var p = piece(id);
        var joints = p.joints.length ? p.joints : piece('item_002').joints;
        var best = null;
        var bestScore = -Infinity;
        joints.forEach(function (point) {
            var score = point[0] * view[0] + point[1] * view[1];
            if (score > bestScore) { bestScore = score; best = point; }
        });
        return [best[0], best[1], (p.bounds[2] + p.bounds[5]) / 2];
    }

    // ------------------------------------------------------------- the shot

    // Framed on the base, a little wider than story.js so the floor reads.
    var BASE = around(['item_001'], [190, 70, 130]);
    // Before the stage locks only its top shows under the intro, so the first
    // frame keeps the base high: the box reaches well below the floor.
    var OPENING = downTo(around(['item_001'], [260, 110, 160]), -1500);
    var WHOLE = around(everything, [110, 60, 80]);
    var WHOLE_WIDE = around(everything, [150, 80, 110]);
    var FINAL = around(everything, [170, 90, 120]);

    window.FrameworkAssemblyStory = {
        title: shelf.title,
        finish: shelf.finish,
        palette: shelf.palette,
        photoBase: '/images/shelving/configs/',

        pieces: shelf.pieces.map(function (p) {
            return { id: p.id, moduleId: p.moduleId, t: p.t, rot: p.rot, pivot: p.pivot };
        }),

        keys: [
            /* --- 1. one unit, 0 to 15% -------------------------------------- */
            {
                at: 0,
                focus: OPENING, padding: 1.02,
                pieces: {
                    item_001: {},
                    item_002: { hidden: true, off: [0, 0, 1300] },
                    item_003: { hidden: true, off: [0, 0, 1100] },
                    item_004: { hidden: true, off: [0, 0, 1100] },
                    item_005: { hidden: true, off: [0, 0, 820] },
                    item_006: { hidden: true, off: [0, 0, 820] },
                    item_007: { hidden: true, off: [0, 0, 520] }
                }
            },
            // Settles onto the base in the first scroll: a small move, because
            // the first thing a reader does is scroll a little to find out
            // whether the page answers at all.
            { at: 0.07, focus: BASE, padding: 1.06 },
            { at: 0.14, focus: BASE, padding: 1.06 },

            /* --- 2. the next one drops on, 15 to 40% ------------------------ */
            // The frame opens upward into empty space before anything is in
            // it, the piece arrives from above the frame, and then a hold.
            { at: 0.19, focus: upTo(BASE, 1420), padding: 1.04, pieces: { item_002: { hidden: false } } },
            { at: 0.33, focus: upTo(BASE, 1010), padding: 1.04, pieces: { item_002: { off: [0, 0, 0] } } },
            { at: 0.39, focus: upTo(BASE, 1010), padding: 1.04 },

            /* --- 3. add a tier, 40 to 70% ----------------------------------- */
            /*
             * One pull back to the whole shelf, then a hold while four pieces
             * land in sequence: the short unit, the post, the shelf across
             * them, the second post. Each starts while the one before it is
             * still falling and lands after it, so they read as four decisions
             * and not one chord. Each is revealed above the frame it enters.
             */
            { at: 0.44, focus: WHOLE, padding: 1.03, pieces: { item_003: { hidden: false } } },
            { at: 0.49, pieces: { item_004: { hidden: false } } },
            { at: 0.51, pieces: { item_003: { off: [0, 0, 0] } } },
            { at: 0.555, pieces: { item_004: { off: [0, 0, 0] } } },
            { at: 0.56, pieces: { item_005: { hidden: false } } },
            { at: 0.605, pieces: { item_006: { hidden: false } } },
            { at: 0.625, pieces: { item_005: { off: [0, 0, 0] } } },
            { at: 0.67, pieces: { item_006: { off: [0, 0, 0] } } },
            { at: 0.68, focus: WHOLE, padding: 1.03 },

            /* --- 4. the whole shelf, 70 to 90% ------------------------------ */
            // A touch wider for the price line, then the top lands and holds.
            { at: 0.72, focus: WHOLE_WIDE, padding: 1.04, pieces: { item_007: { hidden: false } } },
            { at: 0.81, pieces: { item_007: { off: [0, 0, 0] } } },
            { at: 0.90, focus: WHOLE_WIDE, padding: 1.04 },

            /* --- 5. the hero holds, 90 to 100% ------------------------------ */
            // Nothing moves but the camera, a final small settle outward.
            { at: 1.0, focus: FINAL, padding: 1.05 }
        ],

        /*
         * Captions. A window on the same timeline, faded at its edges by the
         * engine. The first starts before 0 so it is already up when the stage
         * locks; the last ends before 1 so the close below takes over.
         */
        captions: [
            { id: 'base', from: -0.06, to: 0.15, photo: 'asymmetric-display-foot' },
            { id: 'adapter', from: 0.155, to: 0.40 },
            { id: 'tier', from: 0.405, to: 0.70, photo: 'asymmetric-display-emptied' },
            { id: 'whole', from: 0.705, to: 0.97, photo: 'asymmetric-display-populated' }
        ].map(function (caption) {
            return {
                id: caption.id, from: caption.from, to: caption.to,
                title: COPY[caption.id].title,
                body: COPY[caption.id].body,
                photo: caption.photo || null,
                photoAlt: COPY.alt[caption.id] || null
            };
        }),

        /*
         * Pins: one name tag per piece, riding it down (`follow`) and fading
         * once it has landed. The base has nowhere to arrive from, so its tag
         * is simply up for the first beat. The name is the catalogue's, which
         * is also the builder's, so a reader who goes there next meets the same
         * words; what the part is for is said in the caption.
         */
        pins: [
            { id: 'item_001', from: -0.08, to: 0.14 },
            { id: 'item_002', from: 0.19, to: 0.36 },
            { id: 'item_003', from: 0.44, to: 0.53 },
            { id: 'item_004', from: 0.49, to: 0.575 },
            { id: 'item_005', from: 0.56, to: 0.645 },
            { id: 'item_006', from: 0.605, to: 0.69 },
            { id: 'item_007', from: 0.72, to: 0.83 }
        ].map(function (pin) {
            return {
                id: pin.id, from: pin.from, to: pin.to, follow: pin.id,
                point: tagPoint(pin.id), dx: 92, dy: -26,
                label: COPY.pins[pin.id]
            };
        })
    };
})();

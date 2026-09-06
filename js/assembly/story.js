/**
 * The shot list: The Curator's Shelf, assembling itself as you scroll.
 *
 * Direction only. Every coordinate this file reaches for comes out of
 * js/assembly/curator-shelf.js, which scripts/bake-assembly-story.mjs generates
 * by running the design through the builder's own placement engine. So the
 * geometry is generated and the storytelling is authored, and a change in Rhino
 * moves the animation without anybody retyping a millimetre.
 *
 * ## Why this shelf
 *
 * Because it is the awkward one. A plain run of identical units would animate
 * more sweetly and explain nothing: stacking three of the same box teaches you
 * that boxes stack. The Curator's Shelf is asymmetric, and everything that
 * makes it asymmetric is a rule of the system rather than a special part --
 * which is exactly the thing that is hard to say in a photograph and easy to
 * show in a move.
 *
 * The shelf is also literally what it claims: the pieces below total Ksh 36,500
 * at catalogue prices, which is the price on the product page.
 *
 * ## The three things a key can say
 *
 *   at      where on the 0..1 scroll timeline this key sits
 *   focus   the box that must be in frame -- NOT a camera position. The
 *           renderer fits a box to the viewport it actually has, so one set of
 *           numbers frames correctly on a 390px phone and a 27" monitor. This
 *           is the single most useful property of the whole approach.
 *   pieces  per-piece offsets from the resting place, in mm. A piece not
 *           mentioned in a key inherits what the previous key said, so a key
 *           only states what changes.
 *
 * Two keys with the same content are a hold: the story stops moving while the
 * reader gets through the caption. That is the whole mechanism for "pause for
 * an annotation" -- there is no separate concept for it.
 */
(function () {
    "use strict";

    var shelf = window.FrameworkAssemblyShelf;

    /*
     * Every word on the page, in one place.
     *
     * Separated from the timing so the copy can be edited by somebody who is
     * not editing an animation. scripts/assembly-copy.mjs writes this block out
     * as a plain text file and reads an edited one back in, which is why the
     * shape below is boring and regular: it is rewritten by a script, so keep
     * it one `id: 'string'` per line.
     */
    var COPY = {
        base: {
            title: 'It starts with the base',
            body: 'A simple two-tier unit with adjustable feet, which let it sit firmly on any surface. Use it as it is, or add on extensions for more storage.'
        },
        adapter: {
            title: 'The next level just drops on.',
            body: 'We’ve done the hard work of fabricating perfectly interlocking parts. All you need to do is stack them together.'
        },
        joint: {
            title: 'A simple joint',
            body: 'Connecting two joints is as easy as sliding the 16mm rod from above into the 20mm tube below. That’s it.'
        },
        stagger: {
            title: 'This is where you can get creative.',
            body: 'We’re all for a simple, stacked shelf. But if you want something more distinctive, our system is for you.'
        },
        bridge: {
            title: 'One shelf, many possibilities.',
            body: 'You can start with a small shelf then add onto it as your needs change.'
        },
        cap: {
            title: 'Close it off at the top.',
            body: 'The design shown goes for Ksh 36,500 in Coral.'
        },
        pins: {
            socket: 'socket',
            drop: 'Units slide together',
            spigot: '16mm pin',
            booster: 'a 20 mm post',
            onShelf: 'on a shelf',
            onPost: 'on a post'
        },
        alt: {
            base: 'A steel leg meeting the floor beside the lowest shelf board.',
            joint: 'A leg held just above the one below it, showing the pin and the tube it drops into.',
            stagger: 'The finished shelf, empty, showing the uneven pockets.',
            bridge: 'The finished shelf seen from an angle.',
            cap: 'The finished shelf holding books, bowls and small figures.'
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

    /**
     * A box around a point. `half` is one number, or one per axis.
     *
     * Per axis matters more than it looks. fit() sizes the view to whichever of
     * the box's two screen dimensions needs more room, so on a portrait phone a
     * box's *width* sets the zoom and its height is padded out — a 300mm cube
     * ends up framed as though it were 470mm tall, and the subject sits small in
     * the middle of a lot of nothing. Thinning the box along the axis that has
     * nothing to show (here depth: this joint is on the front face, and there is
     * no second thing behind it) takes that padding back.
     */
    function cube(point, half) {
        var h = typeof half === 'number' ? [half, half, half] : half;
        return [
            point[0] - h[0], point[1] - h[1], point[2] - h[2],
            point[0] + h[0], point[1] + h[1], point[2] + h[2]
        ];
    }

    /**
     * Of the joints a piece lands on, the one nearest the camera.
     *
     * A concealed joint is only worth a close-up from the side that can see it,
     * and which side that is depends on where the camera stands -- so the pick
     * is made against the renderer's own view direction rather than written
     * down here. Move the camera and the close-up follows it to the right leg.
     */
    function frontJoint(id) {
        var view = (window.FrameworkDesignerRenderer && window.FrameworkDesignerRenderer.VIEW_DIRECTION)
            || [0.68, -0.68, 0.56];
        var joints = piece(id).joints;
        var best = null;
        var bestScore = -Infinity;
        joints.forEach(function (point) {
            var score = point[0] * view[0] + point[1] * view[1] + point[2] * view[2];
            if (score > bestScore) { bestScore = score; best = point; }
        });
        return best;
    }

    // ------------------------------------------------------------- the shot

    // The joint the story dives into: where the adapter meets the base.
    var JOINT = frontJoint('item_002');
    var BASE = around(['item_001'], [130, 60, 80]);
    var WHOLE = around(everything, [110, 60, 80]);

    window.FrameworkAssemblyStory = {
        title: shelf.title,
        finish: shelf.finish,
        palette: shelf.palette,

        /*
         * Photographs of this shelf, for the tier that should not be asked to
         * download geometry. They are the site's own product shots -- the same
         * ones /shelving already serves for this product, which is why they may
         * arrive from cache. `photo` on a caption names one; a caption about a
         * movement rather than about a thing goes without.
         */
        photoBase: '/images/shelving/configs/',

        /*
         * Resting places, straight from the engine. The animation only ever adds
         * an offset to these, so no frame of this story can show a joint that
         * would not close in steel: the only thing being animated is how far a
         * piece still has to travel.
         */
        pieces: shelf.pieces.map(function (p) {
            return { id: p.id, moduleId: p.moduleId, t: p.t, rot: p.rot, pivot: p.pivot };
        }),

        keys: [
            /* --- 1. one base ------------------------------------------------- */
            {
                at: 0,
                focus: around(['item_001'], [300, 140, 190]), padding: 1.02,
                pieces: {
                    item_001: {},
                    item_002: { hidden: true, off: [0, 0, 800] },
                    item_003: { hidden: true, off: [0, 0, 1100] },
                    item_004: { hidden: true, off: [0, 0, 1100] },
                    item_005: { hidden: true, off: [0, 0, 820] },
                    item_006: { hidden: true, off: [0, 0, 820] },
                    item_007: { hidden: true, off: [0, 0, 520] }
                }
            },
            // Settles onto the base. A small move, because the first thing a
            // reader does is scroll a little to find out whether the page
            // answers at all.
            { at: 0.08, focus: BASE, padding: 1.06 },
            { at: 0.16, focus: BASE, padding: 1.06 },

            /* --- 2. the adapter, full width ---------------------------------- */
            // The frame opens upward into empty space before anything is in it:
            // the reader sees room for a piece, and then the piece.
            { at: 0.23, focus: upTo(BASE, 1420), padding: 1.04, pieces: { item_002: { hidden: false } } },
            { at: 0.31, focus: upTo(BASE, 1010), padding: 1.04, pieces: { item_002: { off: [0, 0, 150] } } },

            /* --- 3. into the joint ------------------------------------------- */
            /*
             * A dolly of about 6x onto one leg, and then a stop.
             *
             * The stop is the point of the chapter. This joint is concealed once
             * it is closed: the pin goes down inside the tube, so a close-up of
             * the finished shelf shows a post with a seam in it and explains
             * nothing. Held 90mm open it explains itself -- a collar on the
             * base, a narrower pin under the adapter, air in between -- which is
             * why the descent is split either side of a hold rather than run
             * straight through.
             */
            { at: 0.37, focus: cube([JOINT[0], JOINT[1], JOINT[2] + 60], [150, 62, 150]), padding: 1.0, pieces: { item_002: { off: [0, 0, 90] } } },
            { at: 0.46, focus: cube([JOINT[0], JOINT[1], JOINT[2] + 60], [150, 62, 150]), padding: 1.0 },
            { at: 0.53, focus: cube([JOINT[0], JOINT[1], JOINT[2] + 45], [150, 62, 150]), padding: 1.0, pieces: { item_002: { off: [0, 0, 0] } } },
            { at: 0.58, focus: cube([JOINT[0], JOINT[1], JOINT[2] + 45], [150, 62, 150]), padding: 1.0 },

            /* --- 4. the stagger ---------------------------------------------- */
            /*
             * Back out to the whole shelf while the rest of it lands. Each piece
             * is revealed at the key where it starts moving, at an offset that
             * puts it above the frame it is about to enter, so nothing ever
             * appears out of nowhere inside the picture.
             *
             * Nothing lands in pairs. Two pieces arriving together read as one
             * event -- and this shelf's whole argument is that a short unit and a
             * bare post are two different answers to the same problem, which
             * nobody can see if they come down as a chord. So each piece starts
             * while the one before it is still falling and lands after it: close
             * enough to be one movement, far enough apart to be two decisions.
             *
             * The order within each tier is the shelf unit first, then the
             * booster. That way the booster arrives as the odd one out, into a
             * gap the eye has already noticed, which is the moment the caption
             * is talking about.
             */
            { at: 0.68, focus: WHOLE, padding: 1.03, pieces: { item_003: { hidden: false } } },
            { at: 0.725, pieces: { item_004: { hidden: false } } },
            { at: 0.745, pieces: { item_003: { off: [0, 0, 0] } } },
            { at: 0.79, pieces: { item_004: { off: [0, 0, 0] } } },

            /* --- 5. one shelf across two supports ---------------------------- */
            // The support first, then the thing it supports: the long shelf has
            // to be seen arriving *onto* something, or it is just another shelf.
            { at: 0.80, pieces: { item_006: { hidden: false } } },
            { at: 0.835, pieces: { item_005: { hidden: false } } },
            { at: 0.855, pieces: { item_006: { off: [0, 0, 0] } } },
            { at: 0.895, pieces: { item_005: { off: [0, 0, 0] } } },

            /* --- 6. the cap --------------------------------------------------- */
            { at: 0.905, pieces: { item_007: { hidden: false } } },
            { at: 0.965, pieces: { item_007: { off: [0, 0, 0] } } },
            { at: 1.0, focus: around(everything, [170, 90, 120]), padding: 1.04 }
        ],

        /*
         * Captions. `from`/`to` are windows on the same 0..1 timeline; the engine
         * fades each in and out at its edges. They are deliberately not attached
         * to keys -- a caption usually wants to arrive slightly before the move
         * it describes and outstay it slightly.
         */
        captions: [
            { id: 'base', from: 0.00, to: 0.18, photo: 'asymmetric-display-foot' },
            { id: 'adapter', from: 0.20, to: 0.35 },
            { id: 'joint', from: 0.38, to: 0.61, photo: 'asymmetric-display-joint' },
            { id: 'stagger', from: 0.645, to: 0.795, photo: 'asymmetric-display-emptied' },
            { id: 'bridge', from: 0.805, to: 0.905, photo: 'asymmetric-display-angle' },
            { id: 'cap', from: 0.915, to: 1.08, photo: 'asymmetric-display-populated' }
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
         * Pins: a dot on a real point in the model with a label beside it.
         *
         * `point` is a world position with the shelf fully assembled; when
         * `follow` names a piece, that piece's current offset is added to it.
         * That is what lets a label ride a falling part instead of hanging in
         * the air where the part will eventually be. `dx`/`dy` place the label
         * beside the dot, in CSS pixels, and a leader line joins the two.
         */
        pins: [
            // Points at the very socket the story is about to dive into, which
            // is why it uses the same frontJoint() pick rather than a coordinate.
            { id: 'socket', from: 0.05, to: 0.17, point: JOINT, dx: 78, dy: -36 },
            {
                id: 'drop', from: 0.23, to: 0.34, follow: 'item_002',
                point: [JOINT[0], JOINT[1], JOINT[2] + 302], dx: 104, dy: -22
            },
            { id: 'spigot', from: 0.41, to: 0.60, point: [JOINT[0], JOINT[1], JOINT[2] + 48], dx: 108, dy: -42 },
            { id: 'booster', from: 0.755, to: 0.845, point: [1143, 0, 875], dx: 96, dy: -30 },
            { id: 'onShelf', from: 0.855, to: 0.945, point: [440, 0, 1026], dx: -86, dy: -34 },
            { id: 'onPost', from: 0.855, to: 0.945, point: [1143, 0, 1026], dx: 92, dy: -34 }
        ].map(function (pin) {
            return {
                id: pin.id, from: pin.from, to: pin.to, follow: pin.follow || null,
                point: pin.point, dx: pin.dx, dy: pin.dy,
                label: COPY.pins[pin.id]
            };
        })
    };
})();

/**
 * The scroll-driven assembly story: engine.
 *
 * Plays window.FrameworkAssemblyStory through the /builder renderer, with
 * scroll position as the only clock.
 *
 * ## Why this is live 3D and not a video or an image sequence
 *
 * The usual way to build one of these -- the way Apple builds them -- is to
 * render a few hundred frames offline and cross-fade through them as the page
 * scrolls, because the models involved are far too heavy to run in a browser.
 * Ours are not. The three module bundles this story needs come to about 50KB
 * gzipped and roughly 30,000 triangles all together, and the renderer that
 * draws them is 15KB. A 60-frame image sequence at a size worth looking at is
 * 2MB before it starts, and a scrubbed <video> is worse: seeking by
 * currentTime is unreliable on iOS and outright janky inside Instagram's
 * webview, which is where most of this page's traffic will land.
 *
 * So the live version is the *small* version here, not the expensive one, and
 * the fallback exists for devices that cannot run WebGL or should not be asked
 * to animate -- not for slow connections.
 *
 * ## The camera
 *
 * There is no camera position in the story file. A key names a *box that must
 * be in frame*, and the renderer's fit() sizes the view to whatever viewport it
 * actually has. One set of numbers therefore frames correctly on a 390px phone
 * and a 27" monitor, which is the thing that usually needs two.
 *
 * Between keys the box's centre moves linearly but its size moves
 * geometrically: a zoom that is linear in millimetres races at the wide end and
 * crawls at the tight end, and this story dollies 7x in one move. Interpolating
 * the half-extent in log space is what makes it read as one continuous push in
 * rather than as a lurch.
 *
 * ## Why a rAF loop and not a scroll listener
 *
 * Reading window.scrollY inside requestAnimationFrame costs nothing and is
 * always the value the frame is about to be composited at. A scroll listener,
 * by contrast, fires at its own rate, can coalesce during a fling, and on iOS
 * has historically gone quiet during momentum -- which strands the animation
 * mid-move while the page keeps travelling. The loop only runs while the track
 * is on screen, so the page costs nothing above and below it.
 */
window.FrameworkAssembly = (function () {
    "use strict";

    var GEOMETRY_BASE = '/assets/shelving/modules';
    /*
     * /builder's asset version, kept equal to it by
     * scripts/bump-builder-version.mjs. The bundles are cached for a week, so a
     * story asking for them unversioned could draw last week's geometry after a
     * rebuild; asking with the builder's number also shares the builder's cache.
     */
    var GEOMETRY_VERSION = '157';

    // --------------------------------------------------------------- tiers

    /*
     * What this device should be asked to do.
     *
     *   full    live 3D, device pixel ratio up to 2, antialiased
     *   lite    live 3D, pixel ratio up to 1.5, antialiased, capped at 30fps
     *   calm    live 3D, but the camera cuts between shots instead of moving
     *   still   the story as a stack of stills, drawn once by the same renderer
     *   photo   the story as words and the shelf's own product photographs
     *
     * The order of these checks is the interesting part, and it is not the
     * order of severity.
     *
     * Save-Data and 2G are asked *before* WebGL, because the still tier is not
     * actually cheap over the wire: it renders its pictures locally, so it still
     * pulls the 96KB of module geometry the animation needs. That is a fine
     * trade for someone who merely dislikes motion and a bad one for someone on
     * a metered 2G connection -- who is better served by five 5KB thumbnails of
     * the real shelf, which they may already have cached from /shelving.
     *
     * So: connection first (cheapest bytes), then capability, then preference,
     * then raw device power. The signals are the ones the platform actually
     * gives us; deviceMemory and hardwareConcurrency are absent on iOS, which is
     * fine -- an iPhone that reports nothing is not the device being guarded
     * against here.
     */
    var TIERS = ['full', 'lite', 'calm', 'still', 'photo'];

    function detectTier() {
        var override = new URLSearchParams(window.location.search).get('tier');
        // A name this file does not know is ignored, not run as a fifth kind
        // of live tier: `?tier=fast` used to behave as `full` without saying so.
        if (override && TIERS.indexOf(override) >= 0) return { tier: override, why: 'forced by ?tier=' + override };

        var link = navigator.connection || {};
        if (link.saveData === true) return { tier: 'photo', why: 'Save-Data is on' };
        if (/^(slow-2g|2g)$/.test(link.effectiveType || '')) return { tier: 'photo', why: 'effectiveType ' + link.effectiveType };

        if (!hasWebGL()) return { tier: 'photo', why: 'no WebGL context' };

        /*
         * prefers-reduced-motion asks for less movement, not for no page.
         *
         * The first version of this sent it to the stills, and that is too
         * blunt: the setting is common on iPhones -- people turn it on for
         * battery, or for the parallax in the OS, and forget -- so a large share
         * of exactly the visitors this page is for were getting a stack of
         * pictures.
         *
         * What actually causes trouble is whole-field movement: the camera
         * dollying and panning under someone who did not ask it to. A cut does
         * not; film cuts constantly and nobody is made ill by it. And a piece
         * sliding into place inside a still frame is small-area motion the
         * viewer is driving themselves, at their own speed, which is the same
         * thing scrolling any page does.
         *
         * So `calm` keeps the whole story and takes away the camera move: every
         * shot the animation would have travelled through is still shown, it is
         * simply cut to. `?tier=still` remains for anyone who wants the older,
         * more conservative behaviour.
         */
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) return { tier: 'calm', why: 'prefers-reduced-motion' };

        /*
         * WebGL that is there but drawn by the CPU. Chrome with the GPU
         * blocklisted, a virtual machine, a remote desktop: the context is
         * created, every capability check passes, and each frame then has to
         * be rasterised in software, which at 1.5 million pixels a frame is
         * seconds, not milliseconds. The pace judge would get there in the end;
         * this gets there before the first frame.
         */
        var drawnBy = rendererName();
        if (isSoftwareRenderer(drawnBy)) return { tier: 'lite', why: 'software WebGL: ' + drawnBy };

        var cores = navigator.hardwareConcurrency || 0;
        var memory = navigator.deviceMemory || 0;
        if ((cores && cores <= 4) || (memory && memory <= 4)) {
            return { tier: 'lite', why: (cores || '?') + ' cores, ' + (memory || '?') + 'GB' };
        }
        if (/^3g$/.test(link.effectiveType || '')) return { tier: 'lite', why: 'effectiveType 3g' };
        return { tier: 'full', why: (cores || '?') + ' cores, ' + (memory || '?') + 'GB' };
    }

    function hasWebGL() {
        try {
            var probe = document.createElement('canvas');
            return Boolean(probe.getContext('webgl') || probe.getContext('experimental-webgl'));
        } catch (error) {
            return false;
        }
    }

    /** What the browser says is drawing its WebGL, or '' where it will not say. */
    function rendererName() {
        try {
            var probe = document.createElement('canvas');
            var gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
            var info = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '') : '';
        } catch (error) {
            return '';
        }
    }

    // The names the CPU rasterisers go by: Chrome's, Mesa's, Windows'.
    function isSoftwareRenderer(name) {
        return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name || '');
    }

    /**
     * The judge for the adaptive pixel ratio.
     *
     * The tier guess is made from navigator.deviceMemory and hardwareConcurrency,
     * and on the devices this most needs to protect it is wrong: a mid-range
     * Android reports eight cores and no memory at all, lands in `full`, and
     * then has to fill 1.5 million pixels a frame on a GPU that cannot. iOS
     * reports neither number, so every iPhone -- old ones included -- also
     * lands in `full`. So the guess is checked against what actually happens:
     * a run of painted frames slower than about 30fps steps the drawing buffer
     * down, twice at most and only downwards, because a page renegotiating its
     * own resolution in both directions mid-scroll is worse to look at than one
     * that is slightly soft.
     *
     * The only evidence of a fill-rate-bound frame is the time between two
     * requestAnimationFrame ticks. But that same interval also lengthens when
     * the browser throttles the loop and the GPU has nothing to do with it:
     * Chrome's energy saver, a 30Hz external display, a window on a second
     * screen. The first version judged against a fixed 32ms, and on a MacBook
     * on battery that is every frame, so after twelve scrolled frames the page
     * went to 1x on a Retina display for no reason and stayed there. That is
     * what "a bit pixellated" on a desktop was.
     *
     * So the interval is judged against the interval the display actually
     * delivers when the page is idle, which the loop sees for free on every
     * frame the scroll position has not moved. A painted frame counts as slow
     * only if it took materially longer than an idle one. A throttled loop has
     * slow idle frames too and is left alone; a slow GPU has fast idle frames
     * and slow painted ones, which is the case this exists for.
     */
    function createPace(options) {
        var ratios = options.ratios;
        var slowMs = options.slowMs || 32;
        var run = options.run || 12;
        var idle = 0;
        var idleSeen = 0;
        var slowFrames = 0;
        var step = 0;
        return {
            ratio: function () { return ratios[step]; },
            step: function () { return step; },
            idle: function () { return idle; },
            /** One frame's evidence. Returns true when the ratio just stepped down. */
            observe: function (elapsed, painted) {
                if (!painted) {
                    // A running average, and each sample capped: one long idle
                    // frame is a tab switch, not a 500ms refresh rate.
                    var sample = Math.min(elapsed, 100);
                    idle = idleSeen ? idle + (sample - idle) * 0.25 : sample;
                    idleSeen += 1;
                    return false;
                }
                if (step >= ratios.length - 1) return false;
                // No verdict until the display's own rate is known.
                if (idleSeen < 3) return false;
                var threshold = Math.max(slowMs, idle * 1.9);
                // A single long frame is a garbage collection or a tab switch,
                // not a verdict. A run of them is the device telling us.
                slowFrames = elapsed > threshold ? slowFrames + 1 : 0;
                if (slowFrames < run) return false;
                slowFrames = 0;
                step += 1;
                return true;
            }
        };
    }

    // ------------------------------------------------------------ timeline

    var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    /**
     * Give every key a complete picture of every piece.
     *
     * Authoring a key that only states what changes is the difference between a
     * readable story file and a wall of repeated coordinates -- but sampling
     * wants a full state at both ends of a segment, so the gaps are filled
     * forward once, here, rather than searched backwards on every frame.
     */
    function resolveKeys(story) {
        var carried = {};
        story.pieces.forEach(function (piece) {
            carried[piece.id] = { off: [0, 0, 0], hidden: false };
        });
        /*
         * Sorted here rather than demanded of the author. A story is written in
         * tracks -- the camera, the shelf, the books -- and each track reads as a
         * sequence; interleaving them by hand into one chronological list to
         * satisfy the sampler makes the file unreadable and turns inserting a
         * beat into an editing exercise. The sampler wants time order, so it
         * takes time order for itself.
         */
        var ordered = story.keys.slice().sort(function (a, b) { return a.at - b.at; });
        var resolved = ordered.map(function (key) {
            var stated = key.pieces || {};
            var full = {};
            Object.keys(carried).forEach(function (id) {
                var was = carried[id];
                var now = stated[id] || {};
                full[id] = {
                    off: now.off ? now.off.slice() : was.off.slice(),
                    hidden: now.hidden === undefined ? was.hidden : now.hidden === true
                };
                carried[id] = full[id];
            });
            return {
                at: key.at,
                focus: key.focus || null,
                padding: key.padding || null,
                view: key.view || null,
                pieces: full
            };
        });
        resolved.tracks = resolveTracks(story);
        return resolved;
    }

    /*
     * Pieces with a timeline of their own.
     *
     * Keys ease each segment between two consecutive instants of the whole
     * story, so every key stops every piece: a piece moving through a key that
     * belongs to something else slows to nothing there and hurries after. That
     * is fine for a handful of parts laid end to end and useless for a row of
     * books arriving a moment apart, where each book's start is a key for all
     * the others. So a story may give a piece a `track` instead: its own list of
     * instants, each segment eased on its own (`ease`: inOut, the default, or
     * in, out, linear), with an offset, a turn in degrees about the piece's
     * pivot, and whether it is drawn. A tracked piece ignores the keys; the
     * camera and every untracked piece go on exactly as before.
     */
    function resolveTracks(story) {
        var tracks = {};
        Object.keys(story.tracks || {}).forEach(function (id) {
            var off = [0, 0, 0];
            var turn = 0;
            var hidden = false;
            // Whether a lamp is on: it steps like `hidden`, and a lit piece
            // paints with its `litPalette`.
            var lit = false;
            tracks[id] = story.tracks[id].slice().sort(function (a, b) { return a.at - b.at; }).map(function (point) {
                if (point.off) off = point.off.slice();
                if (point.turn != null) turn = point.turn;
                if (point.hidden !== undefined) hidden = point.hidden === true;
                if (point.lit !== undefined) lit = point.lit === true;
                return { at: point.at, off: off, turn: turn, hidden: hidden, lit: lit, ease: point.ease || 'inOut' };
            });
        });
        return tracks;
    }

    var EASES = {
        inOut: easeInOutCubic,
        in: function (t) { return t * t * t; },
        out: function (t) { return 1 - Math.pow(1 - t, 3); },
        linear: function (t) { return t; }
    };

    /** A tracked piece at one point: eased within its own segment. */
    function sampleTrack(track, p) {
        var first = track[0];
        if (p <= first.at) return { off: first.off.slice(), turn: first.turn, hidden: first.hidden, lit: first.lit };
        for (var i = 1; i < track.length; i += 1) {
            var to = track[i];
            if (p < to.at) {
                var from = track[i - 1];
                var t = (EASES[to.ease] || easeInOutCubic)((p - from.at) / Math.max(1e-9, to.at - from.at));
                return {
                    off: [lerp(from.off[0], to.off[0], t), lerp(from.off[1], to.off[1], t), lerp(from.off[2], to.off[2], t)],
                    turn: lerp(from.turn, to.turn, t),
                    hidden: from.hidden,
                    lit: from.lit
                };
            }
        }
        var last = track[track.length - 1];
        return { off: last.off.slice(), turn: last.turn, hidden: last.hidden, lit: last.lit };
    }

    /**
     * The camera is a sparse track over the same timeline.
     *
     * A key that states no `focus` is invisible to the camera: the shot
     * interpolates across it, between the nearest keys either side that do state
     * one. That separation is what lets a piece be timed finely -- a run of books
     * landing on one shelf two thirds of the way through a long dolly -- without
     * the extra key chopping the dolly into two segments and stalling it.
     *
     * Carrying the last focus forward instead, which is the obvious thing, makes
     * every added key a camera hold. It is not obvious that it has happened,
     * either: the shot simply stops for a moment and then hurries.
     */
    function fillCameras(keys) {
        keys.cameras = keys.filter(function (key) { return Boolean(key.focus); });
        if (!keys.cameras.length) throw new Error('assembly: no key states a focus box');
        /*
         * A story either never states a `view` or states one on its first
         * camera key. The first kind is drawn in the builder's locked
         * isometric, as /how and /assembly are. The second is drawn with the
         * renderer's orbit camera, a perspective view at an azimuth and an
         * elevation, so a shot can turn and look up from under a shelf; a
         * camera key that states no view keeps the one before it.
         */
        var angled = Boolean(keys.cameras[0].view);
        keys.cameras.forEach(function (key, index) {
            if (!key.padding) key.padding = index ? keys.cameras[index - 1].padding : 1.05;
            if (key.view && !angled) throw new Error('assembly: a view is stated at ' + key.at + ' but not on the first camera key');
            if (angled && !key.view) key.view = keys.cameras[index - 1].view;
        });
        keys.angled = angled;
        return keys;
    }

    /** The two keys bracketing p, and how far between them it is. */
    function bracket(keys, p) {
        var i = 0;
        while (i < keys.length - 2 && keys[i + 1].at <= p) i += 1;
        var a = keys[i];
        var b = keys[i + 1] || a;
        var span = b.at - a.at;
        return { a: a, b: b, t: span > 0 ? clamp01((p - a.at) / span) : 0 };
    }

    /**
     * Interpolate a focus box.
     *
     * Centre linearly, half-extent geometrically -- see the note at the top of
     * this file. The 1mm floor is there so a degenerate axis (a box with no
     * depth, which is a perfectly reasonable thing to write) cannot put a zero
     * inside the ratio.
     */
    function blendFocus(a, b, t) {
        var out = new Array(6);
        for (var axis = 0; axis < 3; axis += 1) {
            var ca = (a[axis] + a[axis + 3]) / 2;
            var cb = (b[axis] + b[axis + 3]) / 2;
            var ha = Math.max(1, (a[axis + 3] - a[axis]) / 2);
            var hb = Math.max(1, (b[axis + 3] - b[axis]) / 2);
            var c = lerp(ca, cb, t);
            var h = ha * Math.pow(hb / ha, t);
            out[axis] = c - h;
            out[axis + 3] = c + h;
        }
        return out;
    }

    /*
     * How far a calm frame has faded to the page's white around a cut.
     *
     * A cut is honest, but in the middle of a scroll it is a jolt, and it reads
     * as the page having skipped something. So a reader who asked for less
     * motion gets a fade through white instead: the frame fades out over a
     * short stretch of scroll before the cut and back in after it, and the shot
     * changes while nothing is showing. A fade is not motion, which is why it
     * is the usual stand-in for a camera move under reduced motion. Two
     * identical camera keys are a hold, not a cut, and do not fade.
     */
    var CUT_FADE = 0.02;

    function sameShot(a, b) {
        if (a === b) return true;
        for (var i = 0; i < 6; i += 1) {
            if (a.focus[i] !== b.focus[i]) return false;
        }
        if (a.padding !== b.padding) return false;
        if (!a.view || !b.view) return !a.view && !b.view;
        return a.view.azimuthDeg === b.view.azimuthDeg && a.view.elevationDeg === b.view.elevationDeg
            && (a.view.fovDeg || 0) === (b.view.fovDeg || 0);
    }

    function cutVeil(shot, p) {
        if (sameShot(shot.a, shot.b)) return 0;
        var length = shot.b.at - shot.a.at;
        var reach = Math.min(CUT_FADE, length / 2);
        if (!(reach > 0)) return 0;
        // The cut is where the eased shot passes halfway, which for a
        // symmetric ease is halfway through the segment.
        var x = clamp01(Math.abs(p - (shot.a.at + length / 2)) / reach);
        return 1 - x * x * (3 - 2 * x);
    }

    /**
     * The state of the story at one point on the timeline.
     *
     * `calm` cuts the camera instead of moving it: the shot changes at the
     * midpoint between two camera keys rather than travelling between them, and
     * `veil` says how far the frame has faded through white around that cut
     * (see cutVeil). The pieces still move, because they are objects inside a
     * still frame rather than the frame itself.
     */
    function sample(keys, p, calm) {
        var found = bracket(keys, p);
        var t = easeInOutCubic(found.t);
        var shot = bracket(keys.cameras || keys, p);
        var ct = easeInOutCubic(shot.t);
        var cut = calm ? (ct < 0.5 ? shot.a : shot.b) : null;
        var veil = calm ? cutVeil(shot, p) : 0;
        var pieces = {};
        Object.keys(found.a.pieces).forEach(function (id) {
            var from = found.a.pieces[id];
            var to = found.b.pieces[id];
            pieces[id] = {
                // Visibility steps at the key rather than blending: there is no
                // half-drawn piece, and a piece only ever appears off-frame.
                hidden: from.hidden,
                off: [
                    lerp(from.off[0], to.off[0], t),
                    lerp(from.off[1], to.off[1], t),
                    lerp(from.off[2], to.off[2], t)
                ],
                turn: 0
            };
        });
        var tracks = keys.tracks || {};
        Object.keys(tracks).forEach(function (id) { pieces[id] = sampleTrack(tracks[id], p); });
        var view = null;
        if (shot.a.view) {
            view = cut ? cut.view : {
                azimuthDeg: lerp(shot.a.view.azimuthDeg, shot.b.view.azimuthDeg, ct),
                elevationDeg: lerp(shot.a.view.elevationDeg, shot.b.view.elevationDeg, ct),
                fovDeg: lerp(shot.a.view.fovDeg || ORBIT_FOV_DEG, shot.b.view.fovDeg || ORBIT_FOV_DEG, ct)
            };
            // A view may set how hard the light falls (renderer LIGHTS.weights);
            // it blends between shots like the rest of the view.
            if (!cut && (shot.a.view.light || shot.b.view.light)) {
                var weightsA = shot.a.view.light || DEFAULT_WEIGHTS;
                var weightsB = shot.b.view.light || DEFAULT_WEIGHTS;
                view.light = weightsA.map(function (w, i) { return lerp(w, weightsB[i], ct); });
            }
        }
        return {
            focus: cut ? cut.focus : blendFocus(shot.a.focus, shot.b.focus, ct),
            padding: cut ? cut.padding : lerp(shot.a.padding, shot.b.padding, ct),
            view: view,
            veil: veil,
            pieces: pieces
        };
    }

    /*
     * The angled camera's distance for a focus box.
     *
     * fit() frames a box for the isometric, where the frame is a half-height and
     * distance means nothing. The orbit camera is a perspective, so the same
     * promise, "this box is in frame on whatever screen there is", is a
     * distance instead: the box's corners measured along the camera's own
     * right, up and forward, and the camera stood back far enough that the
     * nearest face still fits both axes of the field of view. One set of keys
     * still frames a phone and a monitor alike.
     */
    var ORBIT_FOV_DEG = 38;
    var DEFAULT_WEIGHTS = [0.62, 0.26, 0.07, 0.12];

    function orbitBasis(view) {
        var az = view.azimuthDeg * Math.PI / 180;
        var el = view.elevationDeg * Math.PI / 180;
        var offset = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
        var forward = [-offset[0], -offset[1], -offset[2]];
        var right = [forward[1], -forward[0], 0];
        var length = Math.hypot(right[0], right[1]) || 1;
        right = [right[0] / length, right[1] / length, 0];
        var up = [
            right[1] * forward[2] - right[2] * forward[1],
            right[2] * forward[0] - right[0] * forward[2],
            right[0] * forward[1] - right[1] * forward[0]
        ];
        return { offset: offset, forward: forward, right: right, up: up };
    }

    function orbitDistance(focus, padding, view, aspect) {
        var basis = orbitBasis(view);
        var centre = [(focus[0] + focus[3]) / 2, (focus[1] + focus[4]) / 2, (focus[2] + focus[5]) / 2];
        var across = 0;
        var upward = 0;
        var depth = 0;
        [focus[0], focus[3]].forEach(function (x) {
            [focus[1], focus[4]].forEach(function (y) {
                [focus[2], focus[5]].forEach(function (z) {
                    var d = [x - centre[0], y - centre[1], z - centre[2]];
                    across = Math.max(across, Math.abs(d[0] * basis.right[0] + d[1] * basis.right[1] + d[2] * basis.right[2]));
                    upward = Math.max(upward, Math.abs(d[0] * basis.up[0] + d[1] * basis.up[1] + d[2] * basis.up[2]));
                    depth = Math.max(depth, Math.abs(d[0] * basis.forward[0] + d[1] * basis.forward[1] + d[2] * basis.forward[2]));
                });
            });
        });
        var halfV = (view.fovDeg || ORBIT_FOV_DEG) * Math.PI / 360;
        var halfH = Math.atan(Math.tan(halfV) * aspect);
        return depth + (padding || 1) * Math.max(upward / Math.tan(halfV), across / Math.tan(halfH), 120);
    }

    /*
     * The builder's light rig, turned with the camera.
     *
     * The renderer's rig is placed for the builder's one view, front-right and
     * above, and from there it lights the faces the builder sees. Seen from
     * under a shelf the same rig lights nothing in the picture, and a coral
     * board's underside came out brown. So an angled story takes the rig as the
     * builder's camera sees it (each light's share along that camera's right,
     * up and towards-the-viewer) and rebuilds it along this camera's: whatever
     * faces the camera is lit as it would be in the builder.
     */
    var builderBasis = null;

    function turnedLights(view) {
        var renderer = window.FrameworkDesignerRenderer;
        if (!renderer || !renderer.LIGHTS || !renderer.VIEW_DIRECTION) return null;
        if (!builderBasis) {
            var d = renderer.VIEW_DIRECTION;
            builderBasis = orbitBasis({
                azimuthDeg: Math.atan2(d[0], -d[1]) * 180 / Math.PI,
                elevationDeg: Math.asin(d[2]) * 180 / Math.PI
            });
        }
        /*
         * Below the horizon the rig is the one for the same angle above it,
         * seen in a mirror: an underside seen from below is lit as a top is
         * seen from above. Turning alone left a board's underside at a grazing
         * angle to a key that stays near the camera's own height, and it came
         * out grey-brown. The mirror comes in over the first six degrees below
         * level, so a camera passing through the horizon sees no step.
         */
        var below = view.elevationDeg < 0 ? Math.min(1, -view.elevationDeg / 6) : 0;
        var to = orbitBasis({ azimuthDeg: view.azimuthDeg, elevationDeg: Math.abs(view.elevationDeg) });
        function turn(v) {
            var along = [builderBasis.right, builderBasis.up, builderBasis.offset].map(function (axis) {
                return v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
            });
            var out = [0, 1, 2].map(function (i) {
                return along[0] * to.right[i] + along[1] * to.up[i] + along[2] * to.offset[i];
            });
            out[2] *= 1 - 2 * below;
            return out;
        }
        return {
            key: turn(renderer.LIGHTS.key), rim: turn(renderer.LIGHTS.rim), up: turn(renderer.LIGHTS.up),
            weights: view.light || renderer.LIGHTS.weights || DEFAULT_WEIGHTS
        };
    }

    /** Point the renderer at a sampled moment: isometric fit, or the orbit. */
    function aim(renderer, moment, aspect) {
        if (!moment.view) {
            renderer.fit(moment.focus, moment.padding);
            return;
        }
        renderer.setViewMode('orbit');
        renderer.fit(moment.focus, moment.padding);
        renderer.setOrbit({
            azimuthDeg: moment.view.azimuthDeg,
            elevationDeg: moment.view.elevationDeg,
            fovDeg: moment.view.fovDeg || ORBIT_FOV_DEG,
            distanceMm: orbitDistance(moment.focus, moment.padding, moment.view, aspect)
        });
        if (renderer.setLighting) renderer.setLighting(turnedLights(moment.view));
    }

    /** Fade a window in over its first fifth and out over its last fifth. */
    function windowOpacity(p, from, to) {
        if (p < from || p > to) return 0;
        var span = Math.max(0.0001, to - from);
        var edge = Math.min(0.055, span * 0.28);
        var inAt = clamp01((p - from) / edge);
        var outAt = clamp01((to - p) / edge);
        return Math.min(inAt, outAt);
    }

    // -------------------------------------------------------------- scene

    /**
     * Exactly the module bundles this story names, and nothing else.
     *
     * Not the whole catalogue's worth of geometry -- a story using six modules
     * downloads six, which is the difference between 96KB and 3MB. And not
     * catalog.json either: the only things it was ever needed for are a pivot
     * per module and a pair of hex colours, both of which the bake script wrote
     * into the story. That is one fewer round trip on the critical path, and one
     * fewer file that can change for reasons this page does not care about.
     */
    function loadScene(story) {
        var geometry = window.FrameworkDesignerGeometry;
        var wanted = [];
        /*
         * A piece that is not a builder module says where its geometry is:
         * `base`, a folder of bundles like the builder's, or `pack`, one file
         * holding many (framework-module-pack@1). Forty books and objects are
         * one request from a pack instead of forty.
         */
        var bases = {};
        var packs = {};
        story.pieces.forEach(function (piece) {
            if (wanted.indexOf(piece.moduleId) < 0) {
                wanted.push(piece.moduleId);
                if (piece.pack) packs[piece.moduleId] = piece.pack;
                else bases[piece.moduleId] = piece.base || GEOMETRY_BASE;
            }
        });
        var packRequests = {};
        function fromPack(url, id) {
            if (!packRequests[url]) {
                packRequests[url] = fetch(url).then(function (response) {
                    if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
                    return response.json();
                });
            }
            return packRequests[url].then(function (pack) {
                var header = pack.modules && pack.modules[id];
                if (!header) throw new Error(url + ' has no module "' + id + '"');
                return geometry.expand(header);
            });
        }
        return Promise.all(wanted.map(function (id) {
            var loading = packs[id] ? fromPack(packs[id], id) : geometry.load(bases[id], id, bases[id] === GEOMETRY_BASE ? GEOMETRY_VERSION : null);
            return loading.then(function (expanded) {
                return { id: id, geometry: expanded };
            });
        })).then(function (modules) {
            return { modules: modules };
        });
    }

    /**
     * The instance list handed to the renderer for one sampled moment.
     *
     * Same shape /builder builds: a translation, a rotation, and the pivot the
     * rotation turns about. The offset is simply added to the resting
     * translation, which is why no frame can show an impossible joint -- the
     * only thing being animated is how far a piece still has to travel.
     */
    function instancesFor(story, moment) {
        var out = [];
        story.pieces.forEach(function (piece) {
            var state = moment.pieces[piece.id];
            if (state.hidden) return;
            var pivot = piece.pivot || [0, 0];
            var t = [
                piece.t[0] + state.off[0],
                piece.t[1] + state.off[1],
                piece.t[2] + state.off[2]
            ];
            out.push({
                id: piece.id,
                moduleId: piece.moduleId,
                translation: t,
                // A turn is about the piece's own pivot: the lamp's is its post.
                rotationDeg: (piece.rot || 0) + (state.turn || 0),
                pivotMm: [t[0] + pivot[0], t[1] + pivot[1]],
                // A piece with colours of its own (a book) paints with them.
                palette: piece.palette || null,
                // A lamp whose track says it is lit glows; see lampFor().
                glow: (state.lit && piece.glow) || null
            });
        });
        return out;
    }

    /**
     * The story's lamp light at one sampled moment, or null while it is off.
     *
     * The story gives the bulb and the shade's openings in the lamp's own
     * millimetres. They are carried into the world exactly as the renderer
     * carries the lamp (turned about its pivot, then placed), so the light
     * leaves the shade wherever the lamp happens to be.
     */
    function lampFor(story, moment) {
        var light = story.light;
        if (!light) return null;
        var state = moment.pieces[light.piece];
        if (!state || state.hidden || !state.lit) return null;
        var piece = null;
        story.pieces.forEach(function (candidate) {
            if (candidate.id === light.piece) piece = candidate;
        });
        if (!piece) return null;
        var pivot = piece.pivot || [0, 0];
        var t = [piece.t[0] + state.off[0], piece.t[1] + state.off[1], piece.t[2] + state.off[2]];
        var turn = (((piece.rot || 0) + (state.turn || 0)) * Math.PI) / 180;
        var x = light.bulb[0] - pivot[0];
        var y = light.bulb[1] - pivot[1];
        return {
            bulbMm: [
                t[0] + pivot[0] + Math.cos(turn) * x - Math.sin(turn) * y,
                t[1] + pivot[1] + Math.sin(turn) * x + Math.cos(turn) * y,
                t[2] + light.bulb[2]
            ],
            radiusMm: light.radius,
            belowMm: t[2] + light.below,
            aboveMm: t[2] + light.above,
            floorMm: light.floor,
            color: light.color,
            reachMm: light.reach,
            strength: light.strength == null ? 1 : light.strength
        };
    }

    /** Where a pin's dot is right now, in world mm. */
    function pinPoint(pin, moment) {
        if (!pin.follow) return pin.point;
        var state = moment.pieces[pin.follow];
        if (!state) return pin.point;
        return [
            pin.point[0] + state.off[0],
            pin.point[1] + state.off[1],
            pin.point[2] + state.off[2]
        ];
    }

    // ------------------------------------------------------------- overlay

    var SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * A caption's words, as elements: the title, and the body only if there is
     * one. A story may give a caption a title and nothing else, and an empty
     * paragraph under it is a gap the card pays for in height and the reader
     * reads as something missing.
     */
    function captionWords(caption) {
        var nodes = [];
        var heading = document.createElement('h2');
        /*
         * A caption that names a product can link to it: the title is the
         * link. The overlay passes pointer events through to the page so a
         * swipe over the stage always scrolls; the link alone takes them back
         * (css/assembly.css), and only while its card is visible.
         */
        if (caption.href) {
            var link = document.createElement('a');
            link.href = caption.href;
            link.textContent = caption.title;
            heading.appendChild(link);
        } else {
            heading.textContent = caption.title;
        }
        nodes.push(heading);
        if (caption.body) {
            var body = document.createElement('p');
            body.textContent = caption.body;
            nodes.push(body);
        }
        return nodes;
    }


    function buildOverlay(stage, story) {
        var overlay = document.createElement('div');
        overlay.className = 'fa-overlay';

        var pins = document.createElementNS(SVG_NS, 'svg');
        pins.setAttribute('class', 'fa-pins');
        pins.setAttribute('aria-hidden', 'true');
        overlay.appendChild(pins);

        var captions = story.captions.map(function (caption) {
            var card = document.createElement('div');
            card.className = 'fa-caption';
            captionWords(caption).forEach(function (node) { card.appendChild(node); });
            overlay.appendChild(card);
            return { spec: caption, node: card, shown: -1 };
        });

        var pinNodes = story.pins.map(function (pin) {
            var line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('stroke', '#1b1f1e');
            line.setAttribute('stroke-width', '1');
            var dot = document.createElementNS(SVG_NS, 'circle');
            dot.setAttribute('r', '3.5');
            dot.setAttribute('fill', '#1b1f1e');
            pins.appendChild(line);
            pins.appendChild(dot);
            var label = document.createElement('div');
            label.className = 'fa-pin-label';
            label.textContent = pin.label;
            overlay.appendChild(label);
            return { spec: pin, line: line, dot: dot, label: label, shown: -1 };
        });

        // The scroll cue; runLive's paintHint() decides when it shows.
        var hint = document.createElement('div');
        hint.className = 'fa-scroll-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = 'Scroll';
        overlay.appendChild(hint);

        stage.appendChild(overlay);

        /*
         * How much of the screen the words need, measured rather than guessed.
         *
         * On a phone the canvas gives up this band so the caption is never on
         * top of the model (see css/assembly.css). The cards are laid out but
         * invisible at this point, so they have a height to read. Measured
         * again whenever the track is re-measured, because the web font
         * arriving after the first paint changes the height of a four-line
         * caption by a line, and a band sized to the fallback font clips the
         * last line of the real one.
         */
        function fitBand() {
            var tallest = 0;
            captions.forEach(function (caption) {
                tallest = Math.max(tallest, caption.node.offsetHeight);
            });
            var band = (tallest + 40) + 'px';
            if (stage.style.getPropertyValue('--fa-caption-band') !== band) {
                stage.style.setProperty('--fa-caption-band', band);
            }
        }
        fitBand();

        return { root: overlay, captions: captions, pins: pinNodes, hint: hint, fitBand: fitBand };
    }

    /*
     * Writing to the DOM every frame is the expensive half of a page like this,
     * so each caption and pin remembers what it was last set to and only
     * touches style when the value has actually moved a visible amount.
     */
    function paintCaptions(overlay, p) {
        overlay.captions.forEach(function (caption, index) {
            var opacity = windowOpacity(p, caption.spec.from, caption.spec.to);
            if (Math.abs(opacity - caption.shown) < 0.01) return;
            caption.shown = opacity;
            caption.node.style.opacity = opacity;
            caption.node.style.transform = 'translate3d(0,' + ((1 - opacity) * 12).toFixed(1) + 'px,0)';
            caption.node.style.visibility = opacity <= 0.01 ? 'hidden' : 'visible';
        });
    }

    /*
     * A frame narrower than this gets a pin's `narrow` windows if it has any.
     * 640 px is below the smallest tablet and above the widest phone, and the
     * three /how pages all step their own layout at 760.
     */
    var NARROW_PINS_PX = 640;

    /**
     * The window and the offset a pin is drawn with at this frame width.
     *
     * A pin states one timing and one offset for a screen with room, and may
     * state a second set for a screen without. A label is as wide as its words
     * at any width, so on a phone three of them cannot be placed beside three
     * different parts of one shelf without crossing each other; a story that
     * has something to say about that says it in `narrow`, usually by giving
     * each pin a third of the same hold so they come one at a time. Anything
     * `narrow` leaves out falls back to the wide value, so a story can change
     * the timing alone or the offset alone.
     */
    function pinBand(spec, width) {
        if (!spec.narrow || width >= NARROW_PINS_PX) return spec;
        var n = spec.narrow;
        return {
            from: n.from == null ? spec.from : n.from,
            to: n.to == null ? spec.to : n.to,
            dx: n.dx == null ? spec.dx : n.dx,
            dy: n.dy == null ? spec.dy : n.dy
        };
    }

    /*
     * Pins are placed from the camera that drew the frame, and then kept inside
     * it. Two things have to be true that are not true by construction:
     *
     *  - the dot has to be on screen. A close-up of one leg puts most of the
     *    shelf outside the frame, and a leader line to an anchor three metres
     *    off the left edge is a line across the picture to nothing. Anchors that
     *    leave the frame fade out.
     *  - the label has to be on screen. Its offset from the dot is written in
     *    the story in pixels, which cannot know how wide the viewport is, so a
     *    label placed to the right of an anchor near the right edge hangs off
     *    it. Clamping the label -- and leaving the dot where it belongs -- keeps
     *    the leader line honest while the words stay readable.
     */
    function paintPins(overlay, project, moment, p, width, height) {
        overlay.pins.forEach(function (pin) {
            var band = pinBand(pin.spec, width);
            // A pin belongs to the picture, so it fades with it at a calm cut.
            var opacity = windowOpacity(p, band.from, band.to) * (1 - (moment.veil || 0));
            var at = opacity > 0.01 ? project(pinPoint(pin.spec, moment)) : null;
            if (at) {
                // Fade out over the last 40px of the frame rather than snapping,
                // so a pin leaving the shot goes quietly.
                var edge = Math.min(
                    at.x + 40, width - at.x + 40,
                    at.y + 40, height - at.y + 40
                );
                opacity *= clamp01(edge / 80);
            }
            if (!at || opacity <= 0.01) {
                if (pin.shown > 0.01) {
                    pin.shown = 0;
                    pin.label.style.opacity = 0;
                    pin.line.setAttribute('opacity', '0');
                    pin.dot.setAttribute('opacity', '0');
                }
                return;
            }
            pin.shown = opacity;
            // offsetWidth forces layout, so it is measured once per label and
            // then trusted: the text never changes.
            if (!pin.halfWidth) pin.halfWidth = pin.label.offsetWidth / 2 || 40;
            var margin = pin.halfWidth + 14;
            /*
             * The story writes an offset, not a side. A label placed to the
             * right of an anchor near the right edge gets clamped back over its
             * own dot, and on a phone -- where the frame is a third the width --
             * that is most of them. So the offset is treated as a distance and
             * the side is chosen here, flipping to whichever has room. The dot
             * never moves, so the leader line stays honest either way.
             */
            var reach = band.dx == null ? 80 : band.dx;
            if (at.x + reach + margin > width || at.x + reach - margin < 0) {
                var flipped = at.x - reach;
                if (flipped + margin <= width && flipped - margin >= 0) reach = -reach;
            }
            var lx = Math.max(margin, Math.min(width - margin, at.x + reach));
            var ly = Math.max(24, Math.min(height - 24, at.y + (band.dy == null ? -30 : band.dy)));
            pin.dot.setAttribute('cx', at.x);
            pin.dot.setAttribute('cy', at.y);
            pin.dot.setAttribute('opacity', opacity);
            pin.line.setAttribute('x1', at.x);
            pin.line.setAttribute('y1', at.y);
            pin.line.setAttribute('x2', lx);
            pin.line.setAttribute('y2', ly);
            pin.line.setAttribute('opacity', opacity * 0.55);
            pin.label.style.opacity = opacity;
            pin.label.style.transform = 'translate3d(' + lx + 'px,' + ly + 'px,0) translate(-50%,-50%)';
        });
    }

    // -------------------------------------------------------- the live tier

    function runLive(options) {
        var story = options.story;
        var track = options.track;
        var stage = options.stage;
        var lite = options.tier === 'lite';
        var calm = options.tier === 'calm';

        var keys = fillCameras(resolveKeys(story));
        var overlay = buildOverlay(stage, story);

        var renderer = null;
        var scene = null;
        var ready = false;
        var moment = null;
        var progress = 0;
        var shownVeil = 0;

        /*
         * Pins are placed from the camera that actually drew the frame, not the
         * one we last asked for. The renderer coalesces draw requests, so on the
         * frame a fling lands on those are not the same thing -- and a label
         * half a move behind its own dot is the one artefact people notice.
         *
         * Antialiasing stays on in every live tier. It was turned off in `lite`
         * as a saving, and the saving is imaginary: multisampling is resolved
         * in tile memory on every mobile GPU this page will meet, while the
         * cost of doing without it is real and was the first thing Ben saw --
         * a thin crossbar drawn as a comb of stair-steps where its top face
         * meets its side along a shallow diagonal. Fill rate is the lever for
         * a slow device, and that is what the pixel ratio below is for.
         */
        renderer = window.FrameworkDesignerRenderer.create(options.canvas, {
            antialias: true,
            onFrame: function () {
                if (moment && ready) {
                    paintPins(overlay, renderer.project, moment, progress,
                        options.canvas.clientWidth, options.canvas.clientHeight);
                }
            }
        });
        if (!renderer) {
            overlay.root.remove();
            return runPhoto(options, 'WebGL context could not be created');
        }

        /*
         * Track geometry is measured once and on resize, never per frame.
         * getBoundingClientRect() inside a scroll loop is the classic way to
         * turn a smooth page into a stuttering one: it forces layout at the
         * exact moment the browser is trying to composite.
         */
        var span = 1;
        var top = 0;
        var painted = -1;

        function measure() {
            var rect = track.getBoundingClientRect();
            top = rect.top + window.scrollY;
            span = Math.max(1, track.offsetHeight - stage.offsetHeight);
            overlay.fitBand();
            renderer.resize();
            painted = -1; // reframe: fit() depends on the aspect ratio
        }

        function scrollProgress() {
            return clamp01((window.scrollY - top) / span);
        }

        /*
         * The words do not wait for the geometry.
         *
         * The six module bundles are 96KB and arrive whenever the connection
         * lets them; the scroll loop starts before they do. Until the scene is
         * ready a frame paints the caption for wherever the reader is, so
         * someone who scrolls into the track on a slow connection reads the
         * story against a blank stage rather than seeing nothing at all, and
         * the shelf appears in the right place when it lands.
         */
        function apply(p) {
            progress = p;
            moment = sample(keys, p, calm);
            paintCaptions(overlay, p);
            if (!ready) return;
            renderer.setInstances(instancesFor(story, moment));
            if (renderer.setLamp) renderer.setLamp(lampFor(story, moment));
            var canvas = options.canvas;
            aim(renderer, moment, (canvas.clientWidth || 1) / Math.max(1, canvas.clientHeight || 1));
            // A calm cut fades the picture through white (sample's `veil`);
            // written only when it changes, which outside a cut is never.
            var veil = moment.veil || 0;
            if (veil !== shownVeil && (Math.abs(veil - shownVeil) > 0.002 || veil === 0)) {
                shownVeil = veil;
                canvas.style.opacity = veil ? String(Math.round((1 - veil) * 1000) / 1000) : '';
            }
        }

        /*
         * Adaptive pixel ratio. Fill rate is the only thing this page spends
         * anything on, so it is the only thing worth taking away, and the
         * difference between 2x and 1.5x on a flat-shaded isometric is
         * genuinely hard to see. createPace() above says how the verdict is
         * reached, and why it is not a fixed number of milliseconds.
         *
         * `lite` starts at 1.5x rather than 1x: a 390px phone at 1.5x is a
         * 0.6 megapixel frame, which is nothing, and 1x on a 3x phone is what
         * "a bit pixellated" looks like. The judge still has 1x to fall to.
         */
        var device = Math.min(window.devicePixelRatio || 1, 2);
        var pace = createPace({
            ratios: lite ? [Math.min(device, 1.5), 1] : [device, 1.5, 1]
        });
        renderer.setPixelRatio(pace.ratio());

        var running = false;
        var queued = false;
        var lastAt = 0;
        // Halving the frame rate on a slow device buys back far more than it
        // costs to look at: the story is a slow move, and 30fps of it reads
        // as smooth where 60 dropped frames does not.
        var minInterval = lite ? 32 : 0;

        /*
         * The drawn progress follows the scroll position rather than jumping to
         * it: each frame closes most of the gap, over about a fifth of a
         * second. On a phone one flick can carry the reader through a whole
         * camera move in a frame or two, and the move is then never seen; eased,
         * it plays. Every frame is still a pure function of the one progress it
         * draws, so captions, pins and pieces never disagree. A jump of more
         * than a third of the story (an anchor, a restored scroll position) is
         * taken at once rather than played back. `calm` is eased too: easing
         * adds no movement of its own, and it is what lets a flick show the
         * fade at a cut rather than skip straight past it.
         */
        var SCRUB_MS = 140;
        var JUMP = 0.33;

        /*
         * The scroll cue. Some readers on phones reach the locked stage, see a
         * picture and a caption, and do not think to scroll. So when the stage
         * is locked and the reader has stopped, the cue comes up: after a moment
         * while they are still on the opening frame, after a longer pause once
         * they have moved the story on, and never at the end. It goes the
         * instant the scroll position moves. Judged from the scroll position
         * itself, so it costs one comparison a frame.
         */
        // Short enough to catch someone who has stopped, long enough not to
        // flash up between two swipes.
        var HINT_FIRST_MS = 450;
        var HINT_AGAIN_MS = 1200;
        var HINT_BEGUN = 0.04;
        var HINT_END = 0.97;
        var movedAt = 0;
        var lastTarget = -1;
        var begun = false;
        var hintOn = false;
        /*
         * How far the reader has scrolled back up since they last went down.
         * Going back up is the plainest sign of someone who has lost the
         * thread, so it brings the cue up at once, and it stays up until they
         * scroll down again. A few pixels of wobble at the end of a swipe do
         * not count.
         */
        var HINT_BACK = 0.004;
        var backTravel = 0;

        function paintHint(now, target) {
            if (target !== lastTarget) {
                if (lastTarget >= 0 && target < lastTarget) backTravel += lastTarget - target;
                else backTravel = 0;
                lastTarget = target;
                movedAt = now;
            }
            if (target > HINT_BEGUN) begun = true;
            var locked = window.scrollY >= top - 2 && window.scrollY <= top + span + 2;
            var paused = target < HINT_END && now - movedAt > (begun ? HINT_AGAIN_MS : HINT_FIRST_MS);
            // Not while the shelf is still loading: the loading mark is up then.
            var on = ready && locked && (backTravel > HINT_BACK || paused);
            if (on !== hintOn) {
                hintOn = on;
                overlay.hint.classList.toggle('is-on', on);
            }
        }

        function frame() {
            queued = false;
            if (!running) return;
            queued = true;
            window.requestAnimationFrame(frame);
            var now = performance.now();
            if (now - lastAt < minInterval) return;
            var elapsed = now - lastAt;
            lastAt = now;
            var target = scrollProgress();
            paintHint(now, target);
            var p = target;
            if (painted >= 0 && Math.abs(target - painted) < JUMP) {
                p = painted + (target - painted) * (1 - Math.exp(-Math.min(elapsed, 100) / SCRUB_MS));
                if (Math.abs(target - p) < 0.0004) p = target;
            }
            // The first frame after a restart has no previous frame to be
            // measured against, so it is neither idle evidence nor slow
            // evidence; `painted` is -1 exactly then.
            if (Math.abs(p - painted) < 0.0004) {
                if (painted >= 0) pace.observe(elapsed, false);
                return;
            }
            if (ready && painted >= 0 && pace.observe(elapsed, true)) {
                renderer.setPixelRatio(pace.ratio());
                renderer.resize();
            }
            painted = p;
            apply(p);
        }

        measure();
        apply(scrollProgress());
        painted = progress;

        /*
         * The loop only turns over while the track is on screen. Above and
         * below it this page costs nothing at all.
         *
         * The observer can deliver several entries at once after a burst of
         * layout, and the last one is the current state. And there is at most
         * one loop: `queued` says a frame is already on its way, so a track
         * that leaves and comes back inside one frame does not end up with two
         * loops each reading the scroll position and judging the pace twice.
         */
        var watcher = new IntersectionObserver(function (entries) {
            var visible = entries[entries.length - 1].isIntersecting;
            if (visible === running) return;
            running = visible;
            if (running) {
                painted = -1;
                if (!queued) { queued = true; window.requestAnimationFrame(frame); }
            }
        }, { rootMargin: '10% 0px' });
        watcher.observe(track);

        /*
         * Anything that moves the track re-measures it.
         *
         * `top` is where the track starts, and everything above the track
         * can still change after this code has run: the site header that
         * js/site.js puts in at window.load pushes it down by 70 to 90px, a
         * web font arriving with display=swap reflows the intro by another
         * 35px, and on a phone the menu opening does the same. Measured once
         * at load, the story would then begin that many pixels before the
         * stage locks, or end that many after it unlocks.
         *
         * So the page is not asked to remember to dispatch a resize (how.html
         * used to); the body's own size is watched. It changes whenever the
         * header lands, a font swaps, or an image without dimensions loads,
         * and a measurement costs one getBoundingClientRect, once, off the
         * scroll path. The plain listeners cover browsers without
         * ResizeObserver and the cases it does not see: a viewport change,
         * a rotation, and a return from the back-forward cache, which puts
         * the page back exactly as it was, scroll position included, without
         * a load event.
         */
        var resizeTimer = null;
        function scheduleMeasure() {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(measure, 120);
        }
        window.addEventListener('resize', scheduleMeasure, { passive: true });
        window.addEventListener('orientationchange', scheduleMeasure);
        window.addEventListener('pageshow', scheduleMeasure);
        if (document.readyState === 'complete') scheduleMeasure();
        else window.addEventListener('load', scheduleMeasure);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleMeasure);
        var sizer = null;
        if (window.ResizeObserver) {
            sizer = new ResizeObserver(scheduleMeasure);
            sizer.observe(document.body);
            sizer.observe(track);
        }

        function stop() {
            running = false;
            watcher.disconnect();
            if (sizer) sizer.disconnect();
            window.clearTimeout(resizeTimer);
        }

        /*
         * A lost WebGL context comes back empty.
         *
         * Android and in-app browsers drop the context readily when a tab
         * goes to the background; the renderer catches the event and keeps
         * the context alive, but the geometry it had uploaded is gone with
         * the old context, and so is the GL state create() set up. Without
         * this the page came back from the background as a black rectangle
         * (verified: every sampled pixel of the drawing buffer at 0,0,0
         * after a forced lose/restore) and stayed that way for the rest of
         * the visit. The renderer's own restored handler runs first, since
         * it was registered first, so by the time this runs the context is
         * usable again and the shader is rebuilt: put the modules back, put
         * the state back, and draw the frame the reader is looking at.
         */
        options.canvas.addEventListener('webglcontextrestored', function () {
            if (!scene) return;
            var gl = options.canvas.getContext('webgl') || options.canvas.getContext('experimental-webgl');
            if (gl) {
                gl.clearColor(1, 1, 1, 1);
                gl.enable(gl.DEPTH_TEST);
                gl.disable(gl.CULL_FACE);
            }
            scene.modules.forEach(function (module) { renderer.addModule(module.id, module.geometry); });
            painted = -1;
            apply(scrollProgress());
        });

        return loadScene(story).then(function (loaded) {
            scene = loaded;
            renderer.setPalette(story.palette);
            scene.modules.forEach(function (module) { renderer.addModule(module.id, module.geometry); });
            ready = true;
            // The frame the reader is looking at, now with the shelf in it.
            painted = -1;
            apply(scrollProgress());
            painted = progress;

            /*
             * A handle for the bench: seek(p) puts the story at an exact point
             * without a scroll gesture, which is how a still gets checked and
             * how a frame gets reproduced from a bug report.
             */
            return {
                tier: options.tier, keys: keys.length, modules: scene.modules.length,
                pixelRatio: function () { return pace.ratio(); },
                pace: pace,
                renderer: renderer, story: story, instancesFor: instancesFor, lampFor: lampFor,
                seek: function (p) { window.scrollTo(0, top + span * clamp01(p)); },
                at: scrollProgress,
                measure: measure,
                moment: function () { return moment; }
            };
        }).catch(function (error) {
            stop();
            overlay.root.remove();
            return runPhoto(options, error.message);
        });
    }

    // ------------------------------------------------------- the still tier

    /*
     * The same story, drawn once per caption into a stack of images.
     *
     * Worth being clear about why this is not a folder of exported PNGs: it is
     * produced by the renderer that draws the live version, from the same story
     * file, at load. A geometry change downstream of Rhino therefore updates the
     * fallback in the same breath as the animation, and there is no third thing
     * to remember to regenerate. The cost is one draw and one encode per still
     * on a device we have already decided is slow -- about 40ms each at this
     * size, once, off the critical path.
     */
    function runStill(options) {
        var story = options.story;
        var canvas = document.createElement('canvas');
        // Antialiased for the same reason the live tiers are: a still is looked
        // at for longer than a frame, and it is drawn once.
        var renderer = window.FrameworkDesignerRenderer.create(canvas, { antialias: true });
        if (!renderer) return runPhoto(options, 'WebGL context could not be created');

        var keys = fillCameras(resolveKeys(story));
        var steps = document.createElement('div');
        steps.className = 'fa-steps';
        options.track.parentNode.replaceChild(steps, options.track);

        var placed = story.captions.map(function (caption) {
            var step = document.createElement('section');
            step.className = 'fa-step';
            var blank = document.createElement('div');
            blank.className = 'fa-step-blank';
            step.appendChild(blank);
            captionWords(caption).forEach(function (node) { step.appendChild(node); });
            steps.appendChild(step);
            return { spec: caption, slot: blank };
        });

        return loadScene(story).then(function (scene) {
            renderer.setPalette(story.palette);
            scene.modules.forEach(function (module) { renderer.addModule(module.id, module.geometry); });

            var width = Math.min(880, Math.round((steps.clientWidth || 720)));
            var height = Math.round(width * 0.75);
            // Drawn at the screen's own density, once, so a still on a Retina
            // display is as crisp as the live version would have been. Six
            // stills at 2x is one extra frame's worth of pixels, paid once.
            var density = Math.min(window.devicePixelRatio || 1, 2);
            var paper = document.createElement('canvas');
            paper.width = Math.round(width * density);
            paper.height = Math.round(height * density);
            var context = paper.getContext('2d');

            placed.forEach(function (step) {
                // The still is taken from the middle of the caption's window,
                // which is where the move it describes has just completed.
                var p = (step.spec.from + step.spec.to) / 2;
                var moment = sample(keys, p);
                renderer.setInstances(instancesFor(story, moment));
                if (renderer.setLamp) renderer.setLamp(lampFor(story, moment));
                // The orbit's distance is set for the paper's shape; the
                // snapshot keeps it and takes its framing from the box.
                if (moment.view) aim(renderer, moment, paper.width / paper.height);
                // Drawn at the paper's size, not the picture's: the paper is
                // `density` times larger, and a snapshot taken at CSS size
                // filled a quarter of it and left the rest grey.
                var shot = renderer.snapshot({
                    width: paper.width, height: paper.height,
                    boundsMm: moment.focus, padding: moment.padding
                });
                // readPixels hands back rows bottom-up, the way GL stores them.
                var image = context.createImageData(shot.width, shot.height);
                var rowBytes = shot.width * 4;
                for (var row = 0; row < shot.height; row += 1) {
                    var from = (shot.height - 1 - row) * rowBytes;
                    image.data.set(shot.pixels.subarray(from, from + rowBytes), row * rowBytes);
                }
                context.putImageData(image, 0, 0);
                var picture = document.createElement('img');
                picture.width = width;
                picture.height = height;
                picture.alt = step.spec.title;
                // Safari only learned to encode WebP in 14, and toDataURL
                // quietly hands back a PNG rather than failing when it cannot,
                // so ask and then check rather than sniffing the browser.
                var encoded = paper.toDataURL('image/webp', 0.82);
                picture.src = encoded.lastIndexOf('data:image/webp', 0) === 0
                    ? encoded : paper.toDataURL('image/png');
                step.slot.parentNode.replaceChild(picture, step.slot);
            });

            renderer.dispose();
            return { tier: 'still', steps: placed.length };
        }).catch(function (error) {
            // The words are already on the page; only the empty picture frames
            // need taking away, so a failure here degrades to the last tier
            // rather than to a column of grey boxes.
            placed.forEach(function (step) {
                if (step.slot.parentNode) step.slot.parentNode.removeChild(step.slot);
            });
            return { tier: 'still', steps: placed.length, why: 'stills failed: ' + error.message };
        });
    }

    // ------------------------------------------------------- the photo tier

    /**
     * The story as words and photographs of the shelf that was actually built.
     *
     * The last resort, and not a poor one: these are the site's own product
     * photographs, one of them a close-up of the very joint the animation dives
     * into. On Save-Data the thumbnails are used -- five of them come to about
     * 34KB, against 96KB of geometry -- and a visitor arriving from /shelving
     * may have them cached already.
     *
     * A caption without a photograph is a caption about a movement rather than
     * about a thing, and gets none rather than a stand-in.
     */
    function runPhoto(options, why) {
        var story = options.story;
        var thumbs = (navigator.connection || {}).saveData === true
            || /^(slow-2g|2g)$/.test((navigator.connection || {}).effectiveType || '');

        var steps = document.createElement('div');
        steps.className = 'fa-steps';
        story.captions.forEach(function (caption) {
            var step = document.createElement('section');
            step.className = 'fa-step';
            if (caption.photo) {
                var picture = document.createElement('img');
                // A photograph named by its own path is not a catalogue shot
                // and has no thumbnail beside it: it is used as it stands.
                picture.src = caption.photo.charAt(0) === '/' ? caption.photo
                    : story.photoBase + (thumbs ? 'thumbs/' : '') + caption.photo + '.jpg';
                picture.alt = caption.photoAlt || caption.title;
                picture.loading = 'lazy';
                picture.decoding = 'async';
                step.appendChild(picture);
            }
            captionWords(caption).forEach(function (node) { step.appendChild(node); });
            steps.appendChild(step);
        });

        var host = options.track.parentNode;
        if (host) host.replaceChild(steps, options.track);
        else document.body.appendChild(steps);
        return Promise.resolve({ tier: 'photo', why: why });
    }

    // ---------------------------------------------------------------- entry

    /*
     * The tier badge: which tier this device got and why, with a link to force
     * each. Only on ?bench=1, or where the page asks for it (the lab does, on
     * localhost): it sits over the model and is a developer's readout. It
     * lives here rather than in one page because "which tier did my phone
     * get?" is asked of whichever page the phone is on, and a phone is exactly
     * where a console is hardest to get at.
     */
    function showBadge(result) {
        var badge = document.createElement('div');
        badge.className = 'fa-badge';
        badge.appendChild(document.createTextNode('tier: ' + result.tier + '  (' + (result.why || '') + ')\n'));
        TIERS.forEach(function (name, index) {
            if (index) badge.appendChild(document.createTextNode('  '));
            var link = document.createElement('a');
            link.href = '?bench=1&tier=' + name;
            link.textContent = name;
            badge.appendChild(link);
        });
        document.body.appendChild(badge);
    }

    function start(settings) {
        var story = window.FrameworkAssemblyStory;
        var track = document.querySelector(settings.track);
        var stage = track && track.querySelector(settings.stage);
        var canvas = stage && stage.querySelector(settings.canvas);
        if (!story || !track || !stage || !canvas) {
            return Promise.reject(new Error('assembly: missing story or markup'));
        }
        var decided = detectTier();
        var options = {
            story: story, track: track, stage: stage, canvas: canvas,
            tier: decided.tier
        };
        var run = decided.tier === 'photo' ? runPhoto(options, decided.why)
            : decided.tier === 'still' ? runStill(options)
                : runLive(options);
        /*
         * The loading mark (`.fa-loading`, in the page's own markup so it is
         * there before any of this has downloaded) goes once there is a story
         * to look at: the live shelf's first frame, the stills, the photographs,
         * or a failure. The still and photo tiers replace the track, and the
         * mark with it, so for them this finds nothing to do.
         */
        function settle() {
            var loading = stage.querySelector('.fa-loading');
            if (!loading) return;
            loading.classList.add('is-done');
            window.setTimeout(function () { loading.hidden = true; }, 600);
        }
        return run.then(function (result) {
            settle();
            // A fallback says why it fell back; otherwise the tier's own reason.
            result.why = result.why || decided.why;
            if (settings.bench || /[?&]bench=1/.test(window.location.search)) showBadge(result);
            if (settings.onReady) settings.onReady(result);
            return result;
        }, function (error) {
            settle();
            throw error;
        });
    }

    return {
        start: start, detectTier: detectTier, sample: sample, resolveKeys: resolveKeys,
        fillCameras: fillCameras, blendFocus: blendFocus, windowOpacity: windowOpacity,
        // For scripts/test-assembly-story.mjs: the parts that decide what a
        // device is asked to do, testable without a browser.
        createPace: createPace, isSoftwareRenderer: isSoftwareRenderer, TIERS: TIERS,
        // For the bench and scripts/test-assembly-story-colors.mjs: the angled
        // camera, as the page points it.
        aim: aim, orbitDistance: orbitDistance, sampleTrack: sampleTrack, turnedLights: turnedLights,
        lampFor: lampFor, ORBIT_FOV_DEG: ORBIT_FOV_DEG
    };
})();

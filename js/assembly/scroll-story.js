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

    // --------------------------------------------------------------- tiers

    /*
     * What this device should be asked to do.
     *
     *   full    live 3D, device pixel ratio up to 2, antialiased
     *   lite    live 3D at 1x with no antialiasing, capped at 30fps
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
    function detectTier() {
        var override = new URLSearchParams(window.location.search).get('tier');
        if (override) return { tier: override, why: 'forced by ?tier=' + override };

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
        return ordered.map(function (key) {
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
                pieces: full
            };
        });
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
        keys.cameras.forEach(function (key, index) {
            if (!key.padding) key.padding = index ? keys.cameras[index - 1].padding : 1.05;
        });
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

    /**
     * The state of the story at one point on the timeline.
     *
     * `calm` cuts the camera instead of moving it: the shot changes at the
     * midpoint between two camera keys rather than travelling between them. The
     * pieces still move, because they are objects inside a still frame rather
     * than the frame itself.
     */
    function sample(keys, p, calm) {
        var found = bracket(keys, p);
        var t = easeInOutCubic(found.t);
        var shot = bracket(keys.cameras || keys, p);
        var ct = easeInOutCubic(shot.t);
        var cut = calm ? (ct < 0.5 ? shot.a : shot.b) : null;
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
                ]
            };
        });
        return {
            focus: cut ? cut.focus : blendFocus(shot.a.focus, shot.b.focus, ct),
            padding: cut ? cut.padding : lerp(shot.a.padding, shot.b.padding, ct),
            pieces: pieces
        };
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
        story.pieces.forEach(function (piece) {
            if (wanted.indexOf(piece.moduleId) < 0) wanted.push(piece.moduleId);
        });
        return Promise.all(wanted.map(function (id) {
            return geometry.load(GEOMETRY_BASE, id, null).then(function (expanded) {
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
                rotationDeg: piece.rot || 0,
                pivotMm: [t[0] + pivot[0], t[1] + pivot[1]]
            });
        });
        return out;
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
            var heading = document.createElement('h2');
            heading.textContent = caption.title;
            var body = document.createElement('p');
            body.textContent = caption.body;
            card.appendChild(heading);
            card.appendChild(body);
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

        var rail = document.createElement('div');
        rail.className = 'fa-rail';
        var dots = story.captions.map(function () {
            var dot = document.createElement('span');
            rail.appendChild(dot);
            return dot;
        });
        overlay.appendChild(rail);

        stage.appendChild(overlay);

        /*
         * How much of the screen the words need, measured rather than guessed.
         *
         * On a phone the canvas gives up this band so the caption is never on
         * top of the model (see css/assembly.css). The cards are laid out but
         * invisible at this point, so they have a height to read; the reflow it
         * costs happens once, before the first frame.
         */
        var tallest = 0;
        captions.forEach(function (caption) {
            tallest = Math.max(tallest, caption.node.offsetHeight);
        });
        stage.style.setProperty('--fa-caption-band', (tallest + 40) + 'px');

        return { root: overlay, captions: captions, pins: pinNodes, dots: dots };
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
            overlay.dots[index].classList.toggle('is-on', opacity > 0.5);
        });
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
            var opacity = windowOpacity(p, pin.spec.from, pin.spec.to);
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
            var reach = pin.spec.dx == null ? 80 : pin.spec.dx;
            if (at.x + reach + margin > width || at.x + reach - margin < 0) {
                var flipped = at.x - reach;
                if (flipped + margin <= width && flipped - margin >= 0) reach = -reach;
            }
            var lx = Math.max(margin, Math.min(width - margin, at.x + reach));
            var ly = Math.max(24, Math.min(height - 24, at.y + (pin.spec.dy || -30)));
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
        var moment = null;
        var progress = 0;

        /*
         * Pins are placed from the camera that actually drew the frame, not the
         * one we last asked for. The renderer coalesces draw requests, so on the
         * frame a fling lands on those are not the same thing -- and a label
         * half a move behind its own dot is the one artefact people notice.
         */
        renderer = window.FrameworkDesignerRenderer.create(options.canvas, {
            antialias: !lite,
            onFrame: function () {
                if (moment) {
                    paintPins(overlay, renderer.project, moment, progress,
                        options.canvas.clientWidth, options.canvas.clientHeight);
                }
            }
        });
        if (!renderer) {
            overlay.root.remove();
            return runPhoto(options, 'WebGL context could not be created');
        }
        return loadScene(story).then(function (scene) {
            renderer.setPalette(story.palette);
            scene.modules.forEach(function (module) { renderer.addModule(module.id, module.geometry); });

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
                renderer.resize();
                painted = -1; // reframe: fit() depends on the aspect ratio
            }

            function scrollProgress() {
                return clamp01((window.scrollY - top) / span);
            }

            function apply(p) {
                progress = p;
                moment = sample(keys, p, calm);
                renderer.setInstances(instancesFor(story, moment));
                renderer.fit(moment.focus, moment.padding);
                paintCaptions(overlay, p);
            }

            /*
             * Adaptive pixel ratio.
             *
             * The tier guess is made from navigator.deviceMemory and
             * hardwareConcurrency, and on the devices this most needs to protect
             * it is wrong: a mid-range Android reports eight cores and no memory
             * at all, lands in `full`, and then has to fill 1.5 million pixels a
             * frame on a GPU that cannot. iOS reports neither number, so every
             * iPhone -- old ones included -- also lands in `full`.
             *
             * So the guess is checked against what actually happens. If the page
             * spends a stretch of frames slower than about 30fps *while it is
             * repainting*, the drawing buffer is stepped down. Fill rate is the
             * only thing this page spends anything on, so it is also the only
             * thing worth taking away, and the difference between 2x and 1x on a
             * flat-shaded isometric is genuinely hard to see.
             *
             * Only ever downwards, and only twice: a page that renegotiates its
             * own resolution in both directions during a scroll is worse to look
             * at than one that is simply a bit soft.
             */
            var ratios = lite ? [1] : [Math.min(window.devicePixelRatio || 1, 2), 1.25, 1];
            var ratioStep = 0;
            renderer.setPixelRatio(ratios[0]);
            var slowFrames = 0;
            var SLOW_MS = 32;
            var SLOW_RUN = 12;

            function checkPace(elapsed) {
                if (ratioStep >= ratios.length - 1) return;
                // A single long frame is a garbage collection or a tab switch,
                // not a verdict. A run of them is the device telling us.
                slowFrames = elapsed > SLOW_MS ? slowFrames + 1 : 0;
                if (slowFrames < SLOW_RUN) return;
                slowFrames = 0;
                ratioStep += 1;
                renderer.setPixelRatio(ratios[ratioStep]);
                renderer.resize();
                painted = -1;
            }

            var running = false;
            var lastAt = 0;
            // Halving the frame rate on a slow device buys back far more than it
            // costs to look at: the story is a slow move, and 30fps of it reads
            // as smooth where 60 dropped frames does not.
            var minInterval = lite ? 32 : 0;

            function frame() {
                if (!running) return;
                window.requestAnimationFrame(frame);
                var now = performance.now();
                if (now - lastAt < minInterval) return;
                var elapsed = now - lastAt;
                lastAt = now;
                var p = scrollProgress();
                if (Math.abs(p - painted) < 0.0004) return;
                // Only frames that did work are evidence about how fast the work
                // is; an idle frame says nothing.
                if (painted >= 0) checkPace(elapsed);
                painted = p;
                apply(p);
            }

            measure();
            apply(scrollProgress());
            painted = progress;

            // The loop only turns over while the track is on screen. Above and
            // below it this page costs nothing at all.
            var watcher = new IntersectionObserver(function (entries) {
                var visible = entries[0].isIntersecting;
                if (visible === running) return;
                running = visible;
                if (running) { painted = -1; window.requestAnimationFrame(frame); }
            }, { rootMargin: '10% 0px' });
            watcher.observe(track);

            var resizeTimer = null;
            window.addEventListener('resize', function () {
                window.clearTimeout(resizeTimer);
                resizeTimer = window.setTimeout(measure, 120);
            }, { passive: true });

            /*
             * A handle for the bench: seek(p) puts the story at an exact point
             * without a scroll gesture, which is how a still gets checked and
             * how a frame gets reproduced from a bug report.
             */
            return {
                tier: options.tier, keys: keys.length, modules: scene.modules.length,
                pixelRatio: function () { return ratios[ratioStep]; },
                renderer: renderer, story: story, instancesFor: instancesFor,
                seek: function (p) { window.scrollTo(0, top + span * clamp01(p)); },
                at: scrollProgress,
                moment: function () { return moment; }
            };
        }).catch(function (error) {
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
        var renderer = window.FrameworkDesignerRenderer.create(canvas, { antialias: false });
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
            var heading = document.createElement('h2');
            heading.textContent = caption.title;
            var body = document.createElement('p');
            body.textContent = caption.body;
            step.appendChild(blank);
            step.appendChild(heading);
            step.appendChild(body);
            steps.appendChild(step);
            return { spec: caption, slot: blank };
        });

        return loadScene(story).then(function (scene) {
            renderer.setPalette(story.palette);
            scene.modules.forEach(function (module) { renderer.addModule(module.id, module.geometry); });

            var width = Math.min(880, Math.round((steps.clientWidth || 720)));
            var height = Math.round(width * 0.75);
            var paper = document.createElement('canvas');
            paper.width = width;
            paper.height = height;
            var context = paper.getContext('2d');

            placed.forEach(function (step) {
                // The still is taken from the middle of the caption's window,
                // which is where the move it describes has just completed.
                var p = (step.spec.from + step.spec.to) / 2;
                var moment = sample(keys, p);
                renderer.setInstances(instancesFor(story, moment));
                var shot = renderer.snapshot({
                    width: width, height: height,
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
                picture.src = story.photoBase + (thumbs ? 'thumbs/' : '') + caption.photo + '.jpg';
                picture.alt = caption.photoAlt || caption.title;
                picture.loading = 'lazy';
                picture.decoding = 'async';
                step.appendChild(picture);
            }
            var heading = document.createElement('h2');
            heading.textContent = caption.title;
            var body = document.createElement('p');
            body.textContent = caption.body;
            step.appendChild(heading);
            step.appendChild(body);
            steps.appendChild(step);
        });

        var host = options.track.parentNode;
        if (host) host.replaceChild(steps, options.track);
        else document.body.appendChild(steps);
        return Promise.resolve({ tier: 'photo', why: why });
    }

    // ---------------------------------------------------------------- entry

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
        return run.then(function (result) {
            result.why = decided.why;
            if (settings.onReady) settings.onReady(result);
            return result;
        });
    }

    return { start: start, detectTier: detectTier, sample: sample, resolveKeys: resolveKeys, fillCameras: fillCameras, blendFocus: blendFocus, windowOpacity: windowOpacity };
})();

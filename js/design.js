/*
 * /d/<CODE>: putting one saved design in the room it is for.
 *
 * The markup and the facts come from netlify/functions/design-page.mjs, which
 * resolves the code server-side; this file does three things and nothing else.
 *
 * 1. It decides which of three things stands under the picture: the AR button,
 *    or one of two sentences saying why it is not there. What it never does is
 *    decide from the user agent whether AR works -- that comes from
 *    model-viewer's own `canActivateAR`, which knows about WebXR, Scene Viewer
 *    and Quick Look and about whether this phone has the sensors. The one thing
 *    the component gets wrong, and the reason this file exists at all: inside
 *    Facebook's Android in-app browser the user agent still says Chrome, so the
 *    component offers AR and tapping it does nothing. AR cannot launch in those
 *    browsers on either platform (on iOS they are a WKWebView, which cannot open
 *    Quick Look; on Android an unmodified WebView cannot hand off to Scene
 *    Viewer), and that is where most of this site's phone traffic arrives. So
 *    the ask there is to leave. Everywhere else that cannot place a model -- a
 *    desktop, an Android phone without Play Services for AR -- the ask is to
 *    open it on a phone.
 *
 * 2. It beacons `ar_open` and `ar_placed` into the event lake through
 *    window.fwk.track, so the question the experiment actually asks -- of the
 *    people sent an AR link, how many open it, and how many get as far as
 *    standing it on their floor -- has an answer. `ar_placed` fires on
 *    model-viewer's own ar-status event reaching "object-placed", which is the
 *    component telling us the model is on a surface, not that a session opened.
 *
 * 3. It copies the link, for the in-app-browser case. That panel would
 *    otherwise be an instruction with no way to follow it: the address bar in
 *    those browsers is not editable, and the escape tricks that used to open
 *    Safari from them stopped working.
 *
 * Nothing here is required for the page to be useful. Without JavaScript the
 * facts, the price and the links are already in the HTML; this adds the room.
 */
(function () {
    'use strict';

    var page = document.querySelector('[data-design-code]');
    if (!page) return;

    var code = page.getAttribute('data-design-code');
    var viewer = document.querySelector('model-viewer');
    var arButton = document.querySelector('.dp-ar');
    var DECIDE_TIMEOUT_MS = 4000;
    var inApp = document.querySelector('[data-when="in-app"]');
    var noAr = document.querySelector('[data-when="no-ar"]');
    var note = document.querySelector('.dp-stage-note');

    // The same two tests js/site.js uses for its `in_app_browser` dimension, so
    // what the page decides and what the lake records cannot disagree.
    function inAppBrowser() {
        var ua = navigator.userAgent || '';
        if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'fb';
        if (/Instagram/i.test(ua)) return 'ig';
        return null;
    }

    function track(event, dims) {
        try {
            if (window.fwk && window.fwk.track) window.fwk.track(event, dims);
        } catch (error) { /* a beacon must never break the page */ }
    }

    function show(element) {
        if (element) element.hidden = false;
    }

    /*
     * One of three, and never two.
     *
     * The in-app browser is settled first and without asking the component,
     * because the component would say yes: inside Facebook's Android WebView the
     * user agent is Chrome's. The `ar` attribute comes off the viewer outright
     * so nothing can offer a session that cannot start, and the way out is
     * offered instead.
     *
     * Otherwise it waits on `canActivateAR`, which settles shortly after the
     * element upgrades rather than at the moment it upgrades -- asking once and
     * believing the answer showed "open this on a phone" to a phone. Four
     * seconds, then the message: being told late is better than being told
     * wrongly.
     */
    function decide() {
        if (inAppBrowser()) {
            if (viewer) viewer.removeAttribute('ar');
            show(inApp);
            return;
        }
        var until = Date.now() + DECIDE_TIMEOUT_MS;
        (function poll() {
            if (viewer && viewer.canActivateAR) return show(arButton);
            if (Date.now() > until) return show(noAr);
            setTimeout(poll, 250);
        })();
    }

    if (window.customElements && customElements.whenDefined) {
        customElements.whenDefined('model-viewer').then(decide, function () { show(noAr); });
    } else {
        show(noAr);
    }

    // A model that never arrives has to say so. The stage is otherwise a blank
    // grey rectangle, which reads as a slow connection forever.
    if (viewer) {
        viewer.addEventListener('load', function () {
            if (note) note.hidden = true;
        });
        viewer.addEventListener('error', function () {
            if (note) note.textContent = 'The 3D view could not load. The size and the price above are right.';
        });

        viewer.addEventListener('ar-status', function (event) {
            if (event.detail.status === 'object-placed') {
                track('ar_placed', { design_code: code });
            }
        });
    }

    /*
     * The button is outside the viewer, so the session has to be asked for. It
     * must be asked for from inside the click handler: every platform requires a
     * user gesture to open an AR session, and a call made from a promise or a
     * timer a moment later is refused.
     */
    if (arButton) {
        arButton.addEventListener('click', function () {
            track('ar_open', { design_code: code });
            if (viewer && viewer.activateAR) viewer.activateAR();
        });
    }

    var copy = document.querySelector('.dp-copy');
    if (copy) {
        copy.addEventListener('click', function () {
            var link = page.getAttribute('data-design-url') || window.location.href;
            var said = function () {
                copy.textContent = 'Link copied';
                setTimeout(function () { copy.textContent = 'Copy the link'; }, 2500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(said, function () { /* below */ });
                return;
            }
            // Clipboard access is blocked in some in-app browsers, which is
            // exactly where this button lives, so there is a fallback: select
            // the address so it can be copied by hand.
            var field = document.createElement('input');
            field.value = link;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.opacity = '0';
            document.body.appendChild(field);
            field.select();
            try { document.execCommand('copy'); said(); } catch (error) { field.style.opacity = '1'; }
            setTimeout(function () { field.remove(); }, 4000);
        });
    }
})();

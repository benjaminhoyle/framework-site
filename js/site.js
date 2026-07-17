// site.js

// === WhatsApp deep links ===================================================
// Single source of truth for our WhatsApp contact link. Every WhatsApp CTA MUST
// open a chat with a message already typed in. An empty chat is where ad leads
// leak away: the visitor taps the button, the pixel fires "Lead", WhatsApp opens
// to a blank thread, and most people never bother writing anything — so the
// message never actually reaches us and the "Website leads" count runs far ahead
// of real inbound conversations. Build links with buildWhatsAppUrl(); the
// load-time sweep (ensureWhatsAppMessages) is a safety net for injected/future
// links, and scripts/test-whatsapp-links.js fails if a bare wa.me link slips in.
window.WHATSAPP_PHONE = '254783891005';
window.WHATSAPP_DEFAULT_MESSAGE = 'Hi Framework! I am interested in your shelving and would like some help.';

window.buildWhatsAppUrl = function (message) {
    var text = (message == null || message === '') ? window.WHATSAPP_DEFAULT_MESSAGE : message;
    return 'https://wa.me/' + window.WHATSAPP_PHONE + '?text=' + encodeURIComponent(text);
};

// Guarantee no WhatsApp link ever opens a blank chat. Any anchor pointing at
// wa.me / api.whatsapp.com without a ?text= gets its data-wa-message (or the
// default) applied. Placeholder links (href="#") that other code fills on demand
// — e.g. the shelving lightbox order buttons — don't match and are left alone.
window.ensureWhatsAppMessages = function (root) {
    var scope = root || document;
    var links = scope.querySelectorAll('a[href*="wa.me/"], a[href*="api.whatsapp.com/send"]');
    Array.prototype.forEach.call(links, function (link) {
        var href = link.getAttribute('href') || '';
        if (/[?&]text=/.test(href)) return; // already carries a message
        link.setAttribute('href', window.buildWhatsAppUrl(link.getAttribute('data-wa-message')));
    });
};

window.trackCheckoutConversion = function (url, eventParams = {}) {
    // First track the GA4 event (keep your existing GA4 tracking)
    gtag('event', 'begin_checkout', eventParams);

    // Add the Google Ads conversion tracking
    var callback = function () {
        if (typeof url === 'string' && url) {
            window.open(url, '_blank'); // Using window.open to open in new tab
        }
    };

    gtag('event', 'conversion', {
        'send_to': 'AW-16875113878/CZhpCJXg0bYaEJab1-4-',
        'value': eventParams.value || 1.0,
        'currency': 'KES', // Changed to KES to match your existing code
        'event_callback': callback,
        'event_timeout': 2000
    });

    return false;
}

window.trackContactConversion = function (url, eventParams = {}) {
    // First track the GA4 event (keep your existing GA4 tracking)
    gtag('event', 'contact_chat', eventParams);

    // Meta pixel: a person opened a conversation with us. "Contact" = a generic
    // chat/enquiry with no specific product attached (floating button, guidance
    // buttons, header/footer WhatsApp links). Product order/customise actions
    // fire "Lead" instead — keeping the two events distinct is what makes the
    // campaign's lead optimisation and the conversions breakdown meaningful.
    if (typeof fbq === 'function') {
        fbq('track', 'Contact', {
            content_name: eventParams.content_name || 'WhatsApp Chat',
            content_category: eventParams.content_category || eventParams.link_target || 'contact'
        });
    }

    // Add the Google Ads conversion tracking
    var callback = function () {
        if (typeof url === 'string' && url) {
            window.open(url, '_blank'); // Using window.open to open in new tab
        }
    };

    gtag('event', 'conversion', {
        'send_to': 'AW-16875113878/1BgKCJjg0bYaEJab1-4-',
        'value': eventParams.value || 1.0,
        'currency': 'KES', // Changed to KES to match your existing code
        'event_callback': callback,
        'event_timeout': 2000
    });

    return false;
}

// Use window.load instead of DOMContentLoaded for better style loading
window.addEventListener('load', function () {
    loadHeaderAndFooter();
    setupMobileMenu();
    highlightActivePage();
    ensureWhatsAppMessages(); // safety net: no WhatsApp CTA opens a blank chat
});

function loadHeaderAndFooter() {
    // Get current page filename
    const currentPage = window.location.pathname.split("/").pop() || 'index.html';

    // Skip header and footer for designer.html
    const isDesignerPage = currentPage === 'designer.html';

    // Add favicon dynamically
    if (!document.querySelector('link[rel="icon"]')) {
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.href = 'images/global/fwk-icon-lg.png';
        document.head.appendChild(favicon);
    }

    // Only add header if not on designer.html
    if (!isDesignerPage) {
        const headerContent = `
            <div class="logo">
                <a href="index.html">
                    <img src="/images/global/fwk-icon.png" alt="Framework Designs Logo">
                </a>
            </div>
            <nav>
                <ul id="nav-menu">
                    <li><a href="index.html">Home</a></li>
                    <li><a href="shelving.html">Shelving</a></li>
                    <li><a href="products-services.html">Products and Services</a></li>
    <li><a href="${window.buildWhatsAppUrl()}" target="_blank" rel="noopener noreferrer" data-fwk-handoff="header" onclick="trackContactConversion('', {link_target:'header_contact'});">Contact</a></li>            </ul>
            </nav>
            <button id="mobile-menu-toggle" aria-label="Toggle mobile menu">
                <span></span>
                <span></span>
                <span></span>
            </button>
        `;

        const header = document.createElement('header');
        header.innerHTML = headerContent;
        document.body.prepend(header);

        // Add the 'loaded' class after a brief delay to ensure styles are applied
        requestAnimationFrame(() => {
            header.classList.add('loaded');
        });

        // Rest of footer code remains the same...

        // Only add footer if not on designer.html
        const footerContent = `
        <div class="footer-content">
            <div class="footer-info">
                <p>© ${new Date().getFullYear()} Framework Designs Limited</p>
                <p>Email: <a href="mailto:info@framework.co.ke" class="text-link">info@framework.co.ke</a></p>
    <p>WhatsApp: <a href="${window.buildWhatsAppUrl()}" target="_blank" rel="noopener noreferrer" class="text-link" data-fwk-handoff="footer" onclick="trackContactConversion('', {link_target:'footer_whatsapp'});">+254 783 891 005</a></p>            <p>Instagram: <a href="https://www.instagram.com/framework_nairobi/" target="_blank" rel="noopener noreferrer" class="text-link">framework_nairobi</a></p>
            </div>
            <div class="footer-keywords">
                <p class="footer-tags">Custom Steel Shelving | Modular Furniture Kenya | Space-Saving Solutions | Kenyan-Made Furniture</p>
            </div>
        </div>
    `;

        const footer = document.createElement('footer');
        footer.innerHTML = footerContent;
        document.body.append(footer);
    }
}

function setupMobileMenu() {
    // Skip setup if there's no toggle (like on designer.html)
    const toggle = document.getElementById('mobile-menu-toggle');
    if (!toggle) return;

    const menu = document.getElementById('nav-menu');
    const header = document.querySelector('header');
    if (!menu || !header) return;

    function toggleMobileMenu() {
        menu.classList.toggle('show');
        header.classList.toggle('mobile-menu-open');
    }

    toggle.addEventListener('click', toggleMobileMenu);

    // Close menu when clicking outside
    document.addEventListener('click', function (event) {
        const isClickInsideMenu = menu.contains(event.target);
        const isClickOnToggle = toggle.contains(event.target);
        if (!isClickInsideMenu && !isClickOnToggle && menu.classList.contains('show')) {
            toggleMobileMenu();
        }
    });

    function checkMobileView() {
        if (window.innerWidth <= 768) {
            header.classList.add('mobile-view');
        } else {
            header.classList.remove('mobile-view');
            menu.classList.remove('show');
        }
    }

    window.addEventListener('resize', checkMobileView);
    checkMobileView(); // Initial check
}

function highlightActivePage() {
    // Skip if nav-menu doesn't exist (like on designer.html)
    if (!document.getElementById('nav-menu')) return;

    const currentPage = window.location.pathname.split("/").pop() || 'index.html';
    const navLinks = document.querySelectorAll('#nav-menu a');

    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// === WS1 funnel emitter =====================================================
// Instruments the on-site funnel (ad -> site -> WhatsApp) as stable customer
// milestones (checkpoints), never page mechanics. Events fire fire-and-forget
// via navigator.sendBeacon('/api/track', ...) so they never block a click or a
// paint. NO PII is ever emitted here — name/phone live only in Airtable. See
// docs/strategy.md Part 2 (event schema) and docs/build-spec.md WS1.
(function () {
    'use strict';

    var ENDPOINT = '/api/track';
    var SS = window.sessionStorage;
    // Crockford Base32, uppercase, no I/L/O/U — matches the short-code spec.
    var CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    function ss(key, val) {
        try {
            if (val === undefined) return SS.getItem(key);
            SS.setItem(key, val);
            return val;
        } catch (e) { return null; } // private mode / storage disabled
    }

    // 6-char Crockford Base32 via crypto.getRandomValues (~1B combos).
    function mintCode() {
        var out = '';
        try {
            var buf = new Uint8Array(6);
            (window.crypto || window.msCrypto).getRandomValues(buf);
            for (var i = 0; i < 6; i++) out += CROCKFORD[buf[i] % 32];
        } catch (e) {
            for (var j = 0; j < 6; j++) out += CROCKFORD[Math.floor(Math.random() * 32)];
        }
        return out;
    }

    function sessionId() {
        var id = ss('fwk_sid');
        if (!id) { id = mintCode() + mintCode(); ss('fwk_sid', id); }
        return id;
    }

    function detectDevice() {
        return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    }

    function detectInApp() {
        var ua = navigator.userAgent || '';
        if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'fb';
        if (/Instagram/i.test(ua)) return 'ig';
        return 'none';
    }

    // First-touch ad params, captured once per session from the landing URL.
    function firstTouch() {
        var cached = ss('fwk_first');
        if (cached) { try { return JSON.parse(cached); } catch (e) {} }
        var q = new URLSearchParams(window.location.search);
        var page = (window.location.pathname.split('/').pop() || 'index.html');
        var entry_type = q.get('config') ? 'product_deeplink'
            : (page === 'shelving.html' ? 'catalog'
                : ((page === 'index.html' || page === '') ? 'home' : 'other'));
        var ft = {
            utm_source: q.get('utm_source') || null,
            utm_campaign: q.get('utm_campaign') || null,
            utm_content: q.get('utm_content') || null,
            utm_term: q.get('utm_term') || null,
            ad_id: q.get('ad_id') || null,
            fbclid: q.get('fbclid') || null,
            device: detectDevice(),
            in_app_browser: detectInApp(),
            entry_type: entry_type
        };
        ss('fwk_first', JSON.stringify(ft));
        return ft;
    }

    // Core emitter. Every event carries session_id + ts; the server enriches
    // received_at / country / UA. Unknown/oversized payloads are dropped server-side.
    function track(event, dims) {
        var ft = firstTouch();
        var payload = {
            type: 'event',
            event: event,
            session_id: sessionId(),
            ts: Date.now(),
            // Session-level ad attributes ride only where the server needs them:
            // included on every event so the lake can group by ad without a join.
            ad: { utm_source: ft.utm_source, utm_campaign: ft.utm_campaign, utm_content: ft.utm_content, ad_id: ft.ad_id, fbclid: ft.fbclid },
            device: ft.device,
            in_app_browser: ft.in_app_browser,
            dims: dims || {}
        };
        beacon(payload);
    }

    function beacon(payload) {
        try {
            var body = JSON.stringify(payload);
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
            } else {
                fetch(ENDPOINT, { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
            }
        } catch (e) { /* tracking must never break the page */ }
    }

    // --- Checkpoints ---------------------------------------------------------

    // C1 Arrived — once per session.
    function arrive() {
        if (ss('fwk_arrived')) return;
        ss('fwk_arrived', '1');
        var ft = firstTouch();
        track('arrive', { entry_type: ft.entry_type });
    }

    // C3 Engaged — once, when 4+ distinct products viewed OR designer entered.
    function engage(via) {
        if (ss('fwk_engaged')) return;
        ss('fwk_engaged', '1');
        var count = productsViewed().length;
        track('engage', { engaged_via: via, products_viewed_count: count });
    }

    function productsViewed() {
        try { return JSON.parse(ss('fwk_products') || '[]'); } catch (e) { return []; }
    }

    // C2 Saw a product. Records the id for the engage threshold and emits the event.
    function productView(product_id, view_source, extra) {
        var seen = productsViewed();
        if (product_id && seen.indexOf(product_id) < 0) {
            seen.push(product_id);
            ss('fwk_products', JSON.stringify(seen));
        }
        var dims = { product_id: product_id || null, view_source: view_source || 'unknown' };
        if (extra) for (var k in extra) dims[k] = extra[k];
        track('product_view', dims);
        if (seen.length >= 4) engage('multi_product');
    }

    // --- WhatsApp handoff + short code (C4) -----------------------------------

    function isWhatsAppHref(href) {
        return /wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/send/i.test(href || '');
    }

    // handoff_source: explicit data-fwk-handoff wins; else infer from id/context.
    function handoffSource(a) {
        var explicit = a.getAttribute('data-fwk-handoff');
        if (explicit) return explicit;
        var id = a.id || '';
        if (id === 'lb-order') return 'lightbox_order';
        if (id === 'lb-customize') return 'lightbox_customize';
        return 'other';
    }

    function currentDepth() {
        if (ss('fwk_engaged')) return 'engaged';
        if (productsViewed().length > 0) return 'product_viewed';
        return 'arrived';
    }

    // Pull a product id out of a framework config deep-link inside the message.
    function productFromText(text) {
        var m = /[?&]config=([^&\s]+)/.exec(text || '');
        return m ? decodeURIComponent(m[1]) : null;
    }

    // Inject &r=CODE so the code rides into WhatsApp's First Message Body. If the
    // pre-fill carries a framework config URL, append to that URL; otherwise add a
    // trailing "r=CODE" token so exact matching still works for generic chats.
    function injectRef(text, code) {
        if (/framework\.co\.ke\/[^\s"'<]*\?config=/.test(text)) {
            // Bound the URL token to non-space/quote chars so trailing prose can't
            // be swallowed into the query string.
            return text.replace(/(framework\.co\.ke\/[^\s"'<]*\?config=[^\s"'<]*)/, function (url) {
                return /[?&]r=/.test(url) ? url : url + '&r=' + code;
            });
        }
        return text + '\n\nr=' + code;
    }

    // Build the outgoing WhatsApp href with the ref injected.
    function rebuildHref(href, newText) {
        var phone = window.WHATSAPP_PHONE || '254783891005';
        var enc = encodeURIComponent(newText);
        // Plain wa.me on every platform — identical to the shipped behavior, just
        // with the &r=CODE ref now inside the pre-fill. The Android intent:// deep
        // link (to skip the wa.me interstitial) is DEFERRED until it's tested on a
        // real budget phone in the FB in-app WebView (our primary environment):
        //   'intent://send/?phone='+phone+'&text='+enc+'#Intent;scheme=whatsapp;'+
        //   'package=com.whatsapp;S.browser_fallback_url='+encodeURIComponent(waUrl)+';end'
        return 'https://wa.me/' + phone + '?text=' + enc;
    }

    // Capture-phase, delegated: catches every WhatsApp CTA (including ones injected
    // later) before navigation, so we can mint the code, rewrite the href and beacon.
    function onWhatsAppClick(e) {
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (!isWhatsAppHref(href)) return;

        var textMatch = /[?&]text=([^&]*)/.exec(href);
        var msg = textMatch ? decodeURIComponent(textMatch[1].replace(/\+/g, ' ')) : (window.WHATSAPP_DEFAULT_MESSAGE || '');

        var code = mintCode();
        var product_id = a.getAttribute('data-clarity-config-id') || productFromText(msg);
        var source = handoffSource(a);

        // Rewrite the link in place so the ref goes out with this very click.
        try { a.setAttribute('href', rebuildHref(href, injectRef(msg, code))); } catch (err) {}

        // Beacon the handoff event...
        track('wa_handoff', {
            handoff_source: source,
            handoff_depth: currentDepth(),
            product_id: product_id || null,
            has_config: !!product_id,
            short_code: code
        });
        // ...and the code -> payload record (resolves to session/product/ad).
        var ft = firstTouch();
        beacon({
            type: 'code',
            code: code,
            session_id: sessionId(),
            product_id: product_id || null,
            handoff_source: source,
            ad: { utm_source: ft.utm_source, utm_campaign: ft.utm_campaign, utm_content: ft.utm_content, ad_id: ft.ad_id, fbclid: ft.fbclid },
            ts: Date.now()
        });
    }

    // --- Public surface + init ----------------------------------------------

    window.fwk = {
        track: track,
        productView: productView,
        engage: engage,
        mintCode: mintCode,
        sessionId: sessionId
    };

    function init() {
        // Capture phase so we run before the browser follows the link.
        document.addEventListener('click', onWhatsAppClick, true);
        arrive();
        // C2 for an ad-landing deep-link. shelving.html's auto-open runs during
        // parse — before this deferred script defines window.fwk — so we emit the
        // deep-link product_view here where timing is guaranteed. Marked once per
        // session so a later manual re-open of the same product doesn't double-fire.
        var q = new URLSearchParams(window.location.search);
        var landConfig = q.get('config');
        if (landConfig && !ss('fwk_deeplink_pv')) {
            ss('fwk_deeplink_pv', '1');
            productView(landConfig, 'deeplink', { view_source_raw: 'url_parameter' });
        }
        // C3: entering the designer counts as engagement.
        var page = (window.location.pathname.split('/').pop() || '');
        if (/^(simplified-)?designer\.html$/.test(page)) engage('designer');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
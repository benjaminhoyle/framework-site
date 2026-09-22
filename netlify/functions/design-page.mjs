// /d/<CODE> — one saved design, at full size, in the room it is for.
//
// The address `/d/:code` was reserved in netlify.toml in a comment that said
// "DO NOT enable yet: no handlers exist". This is the handler.
//
// It is a function rather than a static page with a rewrite, and that is the
// only interesting decision in the file. `/builder/<CODE>` is a rewrite, and it
// can be, because the builder is a tool the visitor is already inside. This page
// is a link pasted into a WhatsApp chat, so the first thing about it that
// anybody sees is the preview card WhatsApp draws from its og: tags, and a
// rewrite serves one set of tags for every design in the world. Resolving the
// code here means the card says what the shelf is, how big it is and what it
// costs, before anyone taps anything -- and the page then arrives with its facts
// already in the HTML rather than after a fetch, which on a Nairobi phone is the
// difference between reading a price and watching a spinner.
//
// What it does NOT do is draw the shelf into the preview card. og:image is a
// photograph of a real shelf in the same colour, from /customize. See the note
// at the foot of this file for what a per-design card would take.
//
// Nothing personal is on this page by construction, exactly as for /api/design:
// a design is a list of parts and a price, and the site has no name or phone
// number to leak into one.

import {
  CODE_RE, assetOrigin, loadCatalog, readDesign, contractTag, isMissing
} from './_designs.mjs';
import { stateFromRecord, priceOf, shelfSizeMm } from './_glb.mjs';

const SITE = 'https://www.framework.co.ke';

// The four colour shots from /customize: a real photograph of a real shelf in
// the finish this design is in. Not the design itself -- honest, and better than
// one generic image for all of them.
const FINISH_IMAGE = {
  marine: '/images/shelving/configs/quadruple-emptied.jpg',
  sage: '/images/shelving/configs/versatile-stack-emptied.jpg',
  charcoal: '/images/shelving/configs/low-console-emptied.jpg',
  coral: '/images/shelving/configs/wide-four-tier-emptied.jpg'
};
const FALLBACK_IMAGE = '/images/shelving/configs/asymmetric-display-emptied.jpg';

export default async (req, context) => {
  const url = new URL(req.url);
  /*
   * Three ways in, because the code arrives three ways: /d/<CODE> from a link
   * the team pastes, ?code= from the form on /d (a GET form, so it works with
   * no JavaScript), and the bare path when the route matched without a param.
   * A bare /d is not a miss, it is somebody holding a code and no link, so it
   * gets the form rather than the 404.
   */
  const raw = (context && context.params && context.params.code)
    || url.searchParams.get('code')
    || url.pathname.replace(/^\/d\/?/, '').replace(/\/$/, '');
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return openAnother();
  if (!CODE_RE.test(code)) return notFound();

  const origin = assetOrigin(req);
  let facts;
  try {
    const { catalog, raw: rawCatalog } = await loadCatalog(origin);
    const record = await readDesign(origin, code);
    if (!record || (!record.hash && !record.design)) return notFound();
    const state = stateFromRecord(catalog, record);
    /*
     * Every finish on the shelf, the design's own first. A design can carry a
     * colour per piece, and app.js names them all for exactly this reason: on a
     * shelf with charcoal posts and coral, marine and sage boards, the word
     * "Sage" beside the picture is a half-truth. This is its finishesInUse.
     */
    const used = [state.finish].concat(
      state.instances.map((instance) => instance.finish).filter(Boolean)
    ).filter((id, index, all) => all.indexOf(id) === index);
    const finishes = used
      .map((id) => (catalog.finishes || []).find((entry) => entry.id === id))
      .filter(Boolean);
    const finish = finishes[0] || (catalog.finishes || [])[0];
    facts = {
      code,
      size: shelfSizeMm(catalog, state),
      // The stored total is what the customer was quoted, and it is the number
      // that has to appear: re-deriving it here would be a second opinion about
      // a price somebody has already been given. The engine's own total is the
      // fallback for a record that never carried one.
      totalKsh: Number.isFinite(Number(record.total_ksh)) && Number(record.total_ksh) > 0
        ? Number(record.total_ksh)
        : priceOf(catalog, state).totalKsh,
      quoted: Number.isFinite(Number(record.total_ksh)) && Number(record.total_ksh) > 0,
      finishId: state.finish,
      // The og:image is a photograph of a shelf in the design's own finish;
      // there is no photograph of a four-colour one, and the base colour is the
      // closest true thing.
      finishName: finishes.length
        ? finishes.map((entry) => entry.displayName).join(' & ')
        : state.finish,
      pieces: state.instances.length,
      bookends: state.bookends || 0,
      tag: contractTag(rawCatalog)
    };
  } catch (error) {
    if (isMissing(error)) return notFound();
    return new Response(`design page failed: ${error && error.message}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  return new Response(render(facts), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The design behind a code never changes, but the page around it does, so
      // this is short at the browser and long at the edge, keyed by the
      // catalogue's content hash the way the model is.
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      'netlify-cdn-cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      etag: `"page-${facts.code}-${facts.tag}"`
    }
  });
};

// ------------------------------------------------------------------ words ---

const comma = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A size in the units a person uses for it: metres over a metre, else cm. */
function span(mm) {
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm / 10)} cm`;
}

/*
 * The headline, which is the size.
 *
 * "Will it fit" is the question AR answers and the one a chat cannot settle, and
 * it is the question behind the objection that ends the most threads. So the
 * first line of the page is the shelf's width and height, not its name -- most
 * of these shelves have no name, they have a code.
 */
function headline(size) {
  return `${span(size.widthMm)} wide, ${span(size.heightMm)} tall`;
}

function facts(design) {
  const parts = [
    design.finishName,
    `${span(design.depthMm !== undefined ? design.depthMm : design.size.depthMm)} deep`,
    `${design.pieces} ${design.pieces === 1 ? 'piece' : 'pieces'}`
  ];
  if (design.bookends) parts.push(`${design.bookends} ${design.bookends === 1 ? 'bookend' : 'bookends'}`);
  return parts.join(' · ');
}

const escape = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ------------------------------------------------------------------ markup --

function render(design) {
  const title = headline(design.size);
  const price = `Ksh ${comma(design.totalKsh)}`;
  const summary = `${title}, in ${design.finishName}. ${price}. See it at full size in your own room.`;
  const image = SITE + (FINISH_IMAGE[design.finishId] || FALLBACK_IMAGE);
  const here = `${SITE}/d/${design.code}`;
  const model = `/api/design-glb/${design.code}.glb`;
  const wa = `https://wa.me/254783891005?text=${encodeURIComponent(
    `Hi Framework! I'm looking at design ${design.code} (${title}, ${design.finishName}, ${price}). ${here}`
  )}`;

  return `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>A shelf ${escape(title.replace(', ', ' and '))}, in ${escape(design.finishName)} | Framework Nairobi</title>
    <meta name="description" content="${escape(summary)}">
    <!--
      A page per saved design, rendered by netlify/functions/design-page.mjs.
      Every fact on it comes from the design record the code resolves to; the
      3D model is /api/design-glb, built from /builder's own geometry.

      noindex on purpose. Most of these codes are one customer's shelf, sent to
      one person in a WhatsApp reply, and a search result for somebody's living
      room is not something anybody asked for. The 77 catalogue designs are
      already on /shelving under their own names. If these are ever to be
      indexed it should be a decision about the catalogue ones only.
    -->
    <meta name="robots" content="noindex, follow">
    <link rel="canonical" href="${here}">
    <meta property="og:type" content="product">
    <meta property="og:url" content="${here}">
    <meta property="og:site_name" content="Framework Designs">
    <meta property="og:title" content="${escape(title)} in ${escape(design.finishName)}">
    <meta property="og:description" content="${escape(summary)}">
    <meta property="og:image" content="${image}">
    <meta property="og:image:width" content="1400">
    <meta property="og:image:height" content="1400">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#ffffff">
    <link rel="icon" href="/images/global/fwk-icon-lg.png">
    <!-- Meta Pixel Code -->
    <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '1492649948884685');
    fbq('track', 'PageView');
    </script>
    <noscript><img height="1" width="1" style="display:none"
    src="https://www.facebook.com/tr?id=1492649948884685&ev=PageView&noscript=1"/></noscript>
    <!-- End Meta Pixel Code -->
    <!-- Google tag (gtag.js): one loader for Google Ads and GA4. -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-16875113878"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', 'AW-16875113878');
        gtag('config', 'G-HXHT6KGZT3');
    </script>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@400;500;700&display=swap">
    <link rel="stylesheet" href="/css/styles.css">
    <link rel="stylesheet" href="/css/pages.css">
    <link rel="stylesheet" href="/css/design.css">
    <!-- The model is the thing this page is for; it can start downloading while
         the component that draws it is still on its way. -->
    <link rel="preload" href="${model}" as="fetch" crossorigin="anonymous">
    <script src="/js/site.js" defer></script>
    <!--
      <model-viewer>, from cdnjs, which is where this site's other CDN scripts
      come from (see catalog-studio.html and scene-studio.html). It is about a
      megabyte before compression, so it is deferred behind everything the page
      says: the size, the colour and the price are readable before it lands, and
      a phone on a slow connection is never left with nothing to read.

      It is what makes AR work on both platforms without an app: WebXR or Scene
      Viewer on Android, and on an iPhone it builds the USDZ itself, in the page,
      when the button is tapped in Safari.
    -->
    <script type="module" defer
        src="https://cdnjs.cloudflare.com/ajax/libs/model-viewer/4.3.1/model-viewer.min.js"
        integrity="sha512-WtemAzWLjxA7jjTEyJG3ya0NCiRbu8z9+fAAeBvKE3ubUChqYTny7LcP+OFdjA+Ki9iqRuE0AigGBK5mlVDPug=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="/js/design.js" defer></script>
</head>

<body>

    <main class="pg dp" data-design-code="${design.code}" data-design-url="${here}">
        <p class="pg-small dp-small">Design ${design.code}</p>
        <h1>${escape(title)}</h1>
        <p class="dp-facts">${escape(facts(Object.assign({}, design, { depthMm: design.size.depthMm })))}</p>
        <p class="dp-price">${price}</p>

        <model-viewer class="dp-stage"
            src="${model}"
            alt="A Framework shelf, ${escape(title)}, in ${escape(design.finishName)}"
            ar
            ar-modes="webxr scene-viewer quick-look"
            ar-scale="fixed"
            ar-placement="floor"
            camera-controls
            disable-zoom
            touch-action="pan-y"
            shadow-intensity="0.85"
            shadow-softness="0.8"
            tone-mapping="neutral"
            exposure="0.9"
            environment-image="neutral"
            camera-orbit="30deg 76deg 105%"
            loading="eager">
            <p class="dp-stage-note" slot="progress-bar">Loading the shelf…</p>
            <!--
              An empty ar-button slot, which suppresses the component's own
              floating cube in the corner of the stage. The ask on this page is a
              sentence in the site's own button, in the page's own flow, under
              the picture rather than on top of the shelf. js/design.js shows it
              when model-viewer says AR can launch, which is the same signal the
              slot would have used.
            -->
            <span slot="ar-button" class="dp-ar-slot"></span>
        </model-viewer>

        <button type="button" class="dp-ar" hidden>See it on your wall</button>

        <!--
          What is said where the button cannot be. Both start hidden and
          js/design.js shows at most one: an Instagram or Facebook window, where
          AR cannot launch at all and the way out is to leave; or anything else
          that cannot place a model, which is every desktop and an older phone.
        -->
        <div class="dp-elsewhere" data-when="in-app" hidden>
            <p><b>Open this in your browser to see it on your wall.</b></p>
            <p>Instagram and Facebook open links in their own window, which cannot
               use the camera for this. Copy the link, then paste it into Chrome or
               Safari — or into a WhatsApp chat and open it from there.</p>
            <button type="button" class="dp-copy">Copy the link</button>
        </div>

        <div class="dp-elsewhere" data-when="no-ar" hidden>
            <p><b>To stand it in your room, open this page on a phone.</b></p>
            <p>That needs an iPhone, or an Android phone with Google Play Services
               for AR. You can turn the shelf above on any device.</p>
        </div>

        <div class="pg-ask">
            <h2>Any questions about this one?</h2>
            <p>Message us and we will answer with the sizes, the colours and when
               it could be delivered.</p>
            <a class="pg-wa" href="${wa}" target="_blank" rel="noopener noreferrer"
               data-fwk-handoff="design_page">Ask about design ${design.code}</a>
        </div>

        <div class="pg-doors">
            <a class="pg-door" href="/builder/${design.code}">
                <b>Change it</b>
                <span>Open this shelf in the builder and make it yours</span>
            </a>
            <a class="pg-door pg-door-dark" href="/how">
                <b>How it works</b>
                <span>Separate parts that stack together, no tools</span>
            </a>
        </div>
    </main>

</body>

</html>
`;
}

/*
 * /d on its own: the door for a code that arrived without a link. A customer
 * has the code on the picture their shelf came in, or on a quote; the team has
 * it on the staff screen. Both then have to type framework.co.ke/d/<CODE> from
 * memory, which is the sort of thing that works for us and not for them.
 *
 * A GET form, so it needs no JavaScript and no new endpoint: it submits to /d
 * with ?code=, which the handler above reads as the code.
 */
function openAnother() {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open a saved design | Framework Nairobi</title>
<meta name="description" content="Open any Framework design by its code to see its size, its price and how it stands in your own room.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/pages.css">
<link rel="stylesheet" href="/css/design.css">
<script src="/js/site.js" defer></script></head>
<body><main class="pg dp">
<h1>Open a saved design</h1>
<p>Every shelf we design has a seven character code. Enter it to see that shelf
   at its real size, with its price, and to stand it in your own room.</p>
<form class="dp-find" method="get" action="/d">
  <label class="dp-find-label" for="dp-code">Design code</label>
  <input class="dp-find-input" id="dp-code" name="code" type="text" inputmode="latin"
         autocapitalize="characters" autocomplete="off" spellcheck="false"
         maxlength="7" size="7" placeholder="1F6HMTB" aria-describedby="dp-find-note" required>
  <button class="dp-find-go" type="submit">Open it</button>
</form>
<p class="dp-find-note" id="dp-find-note">The code is printed on the picture of your shelf and on your quote.</p>
<div class="pg-doors">
  <a class="pg-door" href="/shelving.html"><b>See the designs</b><span>Sizes and prices for every shelf we make</span></a>
  <a class="pg-door pg-door-dark" href="/builder"><b>Design one</b><span>Build a shelf and get its own code</span></a>
</div>
</main></body></html>
`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' }
  });
}

function notFound() {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>That design could not be found | Framework Nairobi</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@400;700&display=swap">
<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/pages.css">
<link rel="stylesheet" href="/css/design.css">
<script src="/js/site.js" defer></script></head>
<body><main class="pg dp">
<h1>That design could not be found</h1>
<p>The code may have been mistyped. Design codes are seven characters, as printed
   on the picture the shelf came in.</p>
<div class="pg-doors"><a class="pg-door" href="/d"><b>Try another code</b>
<span>Seven characters, from your picture or your quote</span></a>
<a class="pg-door pg-door-dark" href="/builder"><b>Design one</b>
<span>Build a shelf and get its own code</span></a></div>
</main></body></html>
`, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/*
 * A per-design og:image, when it is wanted.
 *
 * The picture the preview card ought to carry already exists: js/builder/
 * present.js draws a 1080x1350 PNG of the shelf with its size, its price, its
 * pieces and its code. It is drawn in the browser, on a canvas, at the moment
 * somebody shares a design, and it is thrown away.
 *
 * What stands between that and this page is one step, not a pipeline: the PNG
 * has to be kept. The cheapest version is a dozen lines in app.js's save path --
 * `canvas.toBlob`, POST beside the existing /api/design write, into a Blobs
 * store keyed by the same code -- and a small function to serve it, and then
 * `og:image` here becomes `/api/design-card/<CODE>.png` with this photograph as
 * the fallback for designs saved before it existed. That change belongs in
 * app.js, which is being worked in, so it is written up rather than made: see
 * the report for the patch.
 *
 * The other two routes are worse. Drawing the shelf server-side means WebGL in a
 * function, which means a headless GPU stack the site does not have. Generating
 * a picture with an image model means a made-up shelf on a card that states a
 * real price, which is the failure the renderer's own README records and Ben's
 * rules forbid.
 */

export const config = { path: ['/d/:code', '/d'] };

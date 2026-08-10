/**
 * The chrome both studios wear: the nav, the buttons, the fields, the log.
 *
 * The scene studio and the catalogue studio do different work and should look
 * different where they do — one is a branching pipeline of scenes, the other a
 * single product row marched through a fixed sequence. But they had also drifted
 * apart in every place they do the *same* thing. Two copies of the nav bar, two
 * button vocabularies (one in inline style objects, one in CSS classes) that
 * disagreed on height, weight and radius, two activity logs with two entry
 * shapes and only one of them copyable.
 *
 * None of that is a difference anybody chose. It is what happens when the same
 * component is written twice, so it is written once here and both pages import
 * it. `js/studio/scale.js` builds on this too — its panel uses these buttons
 * rather than inventing a third set, so load this first.
 *
 * What is deliberately NOT here: layout, and anything about what a page is for.
 * The scene studio's node pipeline and the catalogue studio's job queue are not
 * two versions of one component, and flattening them would make both worse.
 *
 *     <div id="framework-nav"></div>      <!-- before the scripts -->
 *     <script src="/js/studio/chrome.js"></script>
 *
 *     FrameworkStudio.ActivityLog({entries, onClear})
 */
(function(){
  "use strict";

  /**
   * The render console, which is not a page here at all.
   *
   * It runs on the machine in front of you, because rendering needs Blender and
   * the module geometry and neither belongs in a browser. **A page cannot start
   * it.** No browser gives a web page a way to run a program, which is the
   * single most important thing browsers refuse to do; framework.co.ke could not
   * be allowed to start processes on your Mac even if we wanted it to.
   *
   * Two things a page *can* do, and both are here:
   *
   *   - **Link to it.** A navigation to `http://localhost:…` is not a fetch, so
   *     no mixed-content rule, CORS preflight or local-network check applies to
   *     it. It opens in a new tab, so a console that is not running leaves you
   *     with one dead tab rather than losing the studio you were working in.
   *   - **Say how to start it.** Which is what the `?` is for.
   *
   * What is deliberately *not* here is an "is it running?" light. Checking would
   * mean fetching localhost from an https page, and that is allowed in Chrome,
   * refused in Safari and Firefox, and increasingly gated behind a permission
   * prompt in Chrome too. A status light that is wrong on half the browsers is
   * worse than no status light.
   */
  const LOCAL_CONSOLE = {
    label: "Render console",
    url: "http://localhost:8775/console/",
    help: [
      ["macOS", "Double-click <code>framework-pipeline.command</code> in the <code>framework-renderer</code> folder."],
      ["Windows", "Double-click <code>framework-pipeline.bat</code> in the same folder."],
      ["Terminal", "<code>python3 scripts/launch/pipeline.py</code> from that folder."]
    ]
  };

  /** Every private page, in the order a person moves through them. */
  const PAGES = [
    {href: "/builder",        label: "3D Builder"},
    {href: "/scene-studio",   label: "Scene Studio"},
    {href: "/catalog-studio", label: "Catalog Studio"},
    {href: "/catalog.html",   label: "Catalog Manager"},
    {href: "/metrics.html",   label: "Monitor"}
  ];

  const CSS = `
/* ─── Nav ─────────────────────────────────────────────────────────── */
.fw-nav{display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:7px 14px;background:#141414;border-bottom:1px solid #2a2a2a;font-family:'DM Sans',system-ui,sans-serif}
.fw-nav-mark{color:#d5a25d;font-weight:800;letter-spacing:.1em;font-size:10px;text-transform:uppercase;margin-right:14px}
.fw-nav a{text-decoration:none;color:#cfcfcf;font-size:12px;font-weight:600;padding:5px 11px;border-radius:6px}
.fw-nav a:hover{background:#1e1e1e;color:#ece8df}
.fw-nav a[aria-current="page"]{background:#2a2213;color:#f6bd64}
.fw-nav-spacer{flex:1;min-width:12px}
.fw-nav-local{display:flex;align-items:center;gap:2px;position:relative}
.fw-nav-local a{color:#9fb3a8}
.fw-nav-help{height:22px;width:22px;padding:0;border-radius:999px;border:1px solid #3c4140;background:#1c1f1f;color:#cfcfcf;font:inherit;font-size:11px;font-weight:800;cursor:pointer;line-height:1}
.fw-nav-help:hover{background:#282c2c;color:#ece8df}
.fw-local-help{position:absolute;top:30px;right:0;z-index:40;width:min(400px,80vw);background:#171919;border:1px solid #3a403e;border-radius:8px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:12px;font-size:12px;line-height:1.5;color:#cdd5cf;text-align:left}
.fw-local-help[hidden]{display:none}
.fw-local-help h3{margin:0 0 6px;font-size:12px;color:#fff}
.fw-local-help p{margin:0 0 8px}
.fw-local-help dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:baseline}
.fw-local-help dt{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8d887c;font-weight:800}
.fw-local-help dd{margin:0}
.fw-local-help code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#0d0f0f;border:1px solid #2a2f2e;border-radius:4px;padding:1px 5px;color:#e8e2d4}

/* ─── Buttons ─────────────────────────────────────────────────────── */
/* One family. btn is the default; the rest are modifiers, and a disabled button
   is dimmed by this rule rather than by an inline opacity at each call site. */
.btn{height:36px;padding:0 13px;border-radius:7px;background:#262929;color:#f6f2e9;border:1px solid #3c4140;font:inherit;font-weight:800;font-size:12px;display:inline-flex;align-items:center;justify-content:center;gap:7px;text-decoration:none;white-space:nowrap}
.btn:hover:not(:disabled){background:#323737}
.btn:not(:disabled){cursor:pointer}
.btn:disabled{cursor:not-allowed;opacity:.5}
.btn-primary{background:#e6a44d;color:#17130c;border-color:#f0ba71}
.btn-primary:hover:not(:disabled){background:#f0b866}
.btn-soft{background:#182523;border-color:#375247;color:#d9f0e4}
.btn-soft:hover:not(:disabled){background:#1f2f2c}
.btn-danger{background:#2b1b1b;border-color:#6b3737;color:#ffd7d7}
.btn-danger:hover:not(:disabled){background:#372121}
.btn-large{height:42px;padding:0 18px;font-size:13px}
.btn-small{height:30px;padding:0 10px;font-size:11px;border-radius:6px}
.btn-tiny{height:22px;padding:0 7px;font-size:9px;border-radius:5px;gap:4px}

/* ─── Page header ─────────────────────────────────────────────────── */
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#d5a25d;font-weight:800}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}
.top h1{margin:3px 0 0;font-size:24px;line-height:1.05}
.top-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}

/* ─── Panels ──────────────────────────────────────────────────────── */
.panel{background:#171919;border:1px solid #2a2f2e;border-radius:8px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.22)}
.panel-tight{background:#171919;border:1px solid #2a2f2e;border-radius:8px;padding:10px}
.panel-title{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}
.title{font-size:14px;font-weight:800;color:#fff}
.sub{font-size:11px;color:#9da6a1;line-height:1.4;margin-top:2px}
.label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#8d887c;margin-bottom:6px}

/* ─── Fields ──────────────────────────────────────────────────────── */
.input,.select,.textarea{width:100%;border-radius:7px;border:1px solid #3a403e;background:#101212;color:#f4efe6;padding:0 10px;outline:none;font:inherit}
.input,.select{height:36px}
.input-small,.select-small{height:30px;border-radius:6px;font-size:11px;padding:0 9px}
.textarea{min-height:68px;padding:9px 10px;resize:vertical;line-height:1.35}
.input:focus,.select:focus,.textarea:focus{border-color:#d99a47}
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a5ada8;font-weight:800}

/* ─── Activity log ────────────────────────────────────────────────── */
.fw-log-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.fw-log-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#8d887c}
.fw-log-actions{display:flex;gap:5px;align-items:center}
.fw-log-count{font-size:9px;color:#8d887c}
.fw-log{max-height:190px;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.45;padding:7px 8px;background:#0a0a0a;border-radius:4px;border:1px solid #24211b}
.fw-log-row{white-space:pre-wrap;overflow-wrap:anywhere;padding:1px 0;color:#c9d0cc}
.fw-log-time{color:#555}
.fw-log-empty{color:#6d6a63}
.fw-log-row.error .fw-log-level{color:#ef4444}
.fw-log-row.warning .fw-log-level{color:#f6bd64}
.fw-log-row.success .fw-log-level{color:#22c55e}
.fw-log-row.cost .fw-log-level{color:#f59e0b}
.fw-log-row.debug .fw-log-level{color:#60a5fa}
.fw-log-row.info .fw-log-level{color:#c8c0b2}
`;

  let stylesInjected = false;
  function injectStyles(){
    if(stylesInjected || typeof document === "undefined") return;
    stylesInjected = true;
    const el = document.createElement("style");
    el.setAttribute("data-framework-chrome", "");
    el.textContent = CSS;
    // First in the head, so a page's own stylesheet can still override a rule
    // it has a reason to override.
    document.head.insertBefore(el, document.head.firstChild);
  }

  /** Fill `#framework-nav`, marking whichever page we are on. */
  function mountNav(){
    injectStyles();
    const host = document.getElementById("framework-nav");
    if(!host) return;
    const here = window.location.pathname.replace(/\/$/, "") || "/";
    host.className = "fw-nav";
    const links = PAGES.map(page => {
      const current = here === page.href || here === page.href.replace(/\.html$/, "");
      return `<a href="${page.href}"${current ? ' aria-current="page"' : ""}>${page.label}</a>`;
    }).join("");
    const steps = LOCAL_CONSOLE.help
      .map(([platform, how]) => `<dt>${platform}</dt><dd>${how}</dd>`).join("");
    host.innerHTML = '<span class="fw-nav-mark">Framework</span>' + links
      + '<span class="fw-nav-spacer"></span>'
      + '<span class="fw-nav-local">'
      +   `<a href="${LOCAL_CONSOLE.url}" target="_blank" rel="noopener">${LOCAL_CONSOLE.label} ↗</a>`
      +   '<button class="fw-nav-help" type="button" aria-expanded="false" title="How to start the render console">?</button>'
      +   '<div class="fw-local-help" hidden>'
      +     "<h3>The render console runs on this machine</h3>"
      +     "<p>It needs Blender and the module geometry, so it cannot live on the site — "
      +     "and no web page is allowed to start a program on your computer. Start it yourself, "
      +     "then the link opens it.</p>"
      +     `<dl>${steps}</dl>`
      +   "</div>"
      + "</span>";

    const help = host.querySelector(".fw-local-help");
    const toggle = host.querySelector(".fw-nav-help");
    const setOpen = open => {
      help.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", event => { event.stopPropagation(); setOpen(help.hidden); });
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", event => { if(event.key === "Escape") setOpen(false); });
  }

  // ─── Activity log ───────────────────────────────────────────────────

  /**
   * One entry, from either studio's shape.
   *
   * The two pages named the same two fields differently (`type`/`msg` against
   * `level`/`message`). Rather than rewrite every `addLog` call on both sides,
   * the component reads either — the entries are append-only records that also
   * sit in saved sessions, and renaming them would break reading an old one.
   */
  function normalise(entry){
    return {
      time: entry.time || "",
      level: entry.level || entry.type || "info",
      message: entry.message != null ? entry.message : (entry.msg || "")
    };
  }

  function asText(entries){
    return entries.map(e => { const n = normalise(e); return `${n.time} [${n.level}] ${n.message}`; }).join("\n");
  }

  /**
   * The activity log, with the two things a log is for: reading the last thing
   * that happened, and getting the whole lot out when something went wrong.
   *
   * It follows the tail unless the reader has scrolled up, because a log that
   * yanks itself back to the bottom while you are reading it is useless during
   * exactly the run you needed it for.
   */
  function ActivityLog(props){
    injectStyles();
    const React = window.React;
    const h = React.createElement;
    const {entries = [], onClear, onCopied, title = "Activity"} = props;
    const boxRef = React.useRef(null);
    const followRef = React.useRef(true);

    React.useEffect(() => {
      const box = boxRef.current;
      if(box && followRef.current) box.scrollTop = box.scrollHeight;
    }, [entries]);

    const onScroll = () => {
      const box = boxRef.current;
      if(box) followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    };

    const copy = () => {
      navigator.clipboard.writeText(asText(entries));
      if(typeof onCopied === "function") onCopied();
    };

    return h("div", null,
      h("div", {className: "fw-log-head"},
        title ? h("span", {className: "fw-log-title"}, title) : h("span"),
        h("div", {className: "fw-log-actions"},
          h("span", {className: "fw-log-count"}, String(entries.length)),
          h("button", {className: "btn btn-tiny", onClick: copy, disabled: !entries.length}, "Copy"),
          h("button", {className: "btn btn-tiny", onClick: onClear, disabled: !entries.length}, "Clear")
        )
      ),
      h("div", {className: "fw-log", ref: boxRef, onScroll},
        entries.length
          ? entries.map((entry, i) => {
              const n = normalise(entry);
              return h("div", {key: entry.id || i, className: `fw-log-row ${n.level}`},
                h("span", {className: "fw-log-time"}, n.time), " ",
                h("span", {className: "fw-log-level"}, `[${n.level}]`), " ",
                n.message
              );
            })
          : h("div", {className: "fw-log-empty"}, "Nothing yet.")
      )
    );
  }

  window.FrameworkStudio = {PAGES, LOCAL_CONSOLE, injectStyles, mountNav, ActivityLog, logAsText: asText};
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountNav);
  else mountNav();
})();

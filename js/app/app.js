/*
 * The staff app at /app: clients, their designs, invoices and deliveries, one place.
 *
 * No framework and no build step, like the rest of the site. Views are functions that
 * return HTML; clicks and changes go through `ACT` and `CHANGE`, found by data-a and
 * data-c on the element. The server's answer is always the whole client page (the
 * `doc`), so there is one shape to draw and nothing to keep in step by hand.
 *
 * Speed comes from three things: the shell is static and cached by sw.js; the list of
 * clients is held in the browser, so search is a filter over an array and needs no
 * network; and a client's page draws at once from the last copy this device saw, then
 * refreshes underneath. None of that local copy is a record of anything: clear it and
 * the next load fetches it again.
 */
(function () {
  'use strict';

  const CFG = window.FW_APP || {};
  const MEMORY = !!CFG.memory; // the single-file demo: no server, hash routes
  const R = window.FrameworkAppRules;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (inner, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
  const ICON = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    back: svg('<path d="m15 5-7 7 7 7"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>'),
    chat: svg('<path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12Z"/>'),
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    clients: svg('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5"/><path d="M16 5a3.3 3.3 0 0 1 0 6.3M18 14.8c1.7.7 2.7 2.4 3 5.2"/>'),
    truck: svg('<path d="M2 6h12v11H2zM14 10h4l4 4v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
    shelf: svg('<path d="M6 3v18M18 3v18M6 7h12M6 12h12M6 17h12"/>'),
    home: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>')
  };
  // Steel left, board right: the site's split circle. Hexes from builder-contract.json.
  const FINISHES = {
    Sage: ['#6F986A', '#B3D4BE'], Marine: ['#143F68', '#82AAD0'],
    Charcoal: ['#171E20', '#94A4B0'], Coral: ['#C8554B', '#F29A8C']
  };
  const dot = (name) => (FINISHES[name]
    ? `<span class="fdot" style="--st:${FINISHES[name][0]};--bd:${FINISHES[name][1]}" role="img" aria-label="${name}"></span>`
    : '<span class="fdot none"></span>');
  /** Nine digits with no leading 0 is how many are stored. Shown and sent as a number you can dial. */
  const fPhone = (p) => (/^[17]\d{8}$/.test(String(p || '').trim()) ? `0${String(p).trim()}` : String(p || ''));
  const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? u : null);
  const money = (n) => (n == null ? '' : `KSh ${Math.round(n).toLocaleString('en-US')}`);
  const today = () => CFG.today || new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateOf = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  const fDate = (s) => { const d = dateOf(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const fDay = (s) => { const d = dateOf(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const fMinutes = (m) => { const h = Math.floor(m / 60); const mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; const h12 = ((h + 11) % 12) + 1; return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`; };
  function fWhen(at) {
    if (!at) return '';
    const days = Math.round((dateOf(today()) - dateOf(at)) / 864e5);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d`;
    return fDate(at);
  }

  // Elvis's own words, as sent in the chats.
  const WORDS = {
    ask: "For me to proceed with processing, kindly share:\n- Your name (for the invoice)\n- Whether you'd like pickup or delivery\n- If delivery, your location so I can calculate cost and the phone number to call when we deliver",
    received: (date) => {
      const days = Math.round((dateOf(date) - dateOf(today())) / 864e5);
      const monday = (x) => { const d = dateOf(x); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };
      const day = LONG_DAYS[dateOf(date).getUTCDay()];
      const when = days === 1 ? 'tomorrow' : (monday(date) === monday(today()) ? `on ${day}` : `next ${day}`);
      return `Well received. Thank you\nWe will deliver ${when}`;
    }
  };

  // ------------------------------------------------------------------- talking to data

  const S = { me: null, index: null, docs: {}, common: null, promotions: null, staff: null, search: '', sheet: null, toast: null };

  /** Everything of this person's on this device, for sign-out and for a session that has ended. */
  const forgetDevice = () => {
    try { Object.keys(localStorage).filter((k) => k.startsWith('fw.')).forEach((k) => localStorage.removeItem(k)); } catch { /* nothing to clear */ }
  };

  const cache = {
    get(k) { try { return JSON.parse(localStorage.getItem(`fw.${k}`)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(`fw.${k}`, JSON.stringify(v)); } catch { /* full or private; the network still works */ } },
    del(k) { try { localStorage.removeItem(`fw.${k}`); } catch { /* nothing to do */ } }
  };

  async function api(method, path, body) {
    if (MEMORY) return window.FW_MEMORY_API(method, path, body, S.me);
    const opts = { method, headers: {} };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res = await fetch(`/api/app/${path}`, opts);
    if (res.status === 401) {
      // Modules go stale after an hour on purpose. /api/me refreshes them, then one retry.
      const me = await fetch('/api/me');
      if (!me.ok) { go('/app/login', { replace: true }); throw new Error('signed_out'); }
      res = await fetch(`/api/app/${path}`, opts);
    }
    const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
    if (!data.ok) { const e = new Error(data.error || 'failed'); e.data = data; e.status = res.status; throw e; }
    return data;
  }

  async function loadIndex() {
    const { rows } = await api('GET', 'clients');
    S.index = rows;
    cache.set('index', rows);
    return rows;
  }

  /** A saved field answers with the client alone. */
  function tookClient(client) {
    const doc = S.docs[client.id];
    if (doc) took({ ...doc, client: { ...doc.client, ...client, lastActivity: new Date().toISOString() } });
  }

  /** Puts a fresh doc everywhere it is shown, and moves its row to the top of the list. */
  function took(doc) {
    S.docs[doc.client.id] = doc;
    cache.set(`doc.${doc.client.id}`, doc);
    if (S.index) {
      const fresh = R.indexRow(doc, today());
      const row = S.index.find((r) => r.id === doc.client.id);
      if (row) Object.assign(row, fresh); else S.index.unshift(fresh);
      cache.set('index', S.index);
    }
    return doc;
  }

  const imageUrl = (code) => (window.FW_IMAGE ? window.FW_IMAGE(code) : `/api/design-image/${code}`);

  // -------------------------------------------------------------------------- routing

  const routes = [
    [/^\/app\/?$/, viewHome],
    [/^\/app\/clients\/?$/, viewClients],
    [/^\/app\/clients\/([^/]+)\/?$/, viewClient],
    [/^\/app\/deliveries\/?$/, viewDeliveries],
    [/^\/app\/admin\/?$/, viewAdmin],
    [/^\/app\/login\/?$/, viewLogin]
  ];
  const here = () => (MEMORY ? (location.hash.slice(1).split('?')[0] || CFG.start || '/app/clients') : location.pathname);
  function go(path, { replace = false } = {}) {
    if (MEMORY) {
      if (replace) history.replaceState(null, '', `#${path}`); else history.pushState(null, '', `#${path}`);
      render();
      return;
    }
    history[replace ? 'replaceState' : 'pushState'](null, '', path);
    render();
  }
  const hrefFor = (path) => (MEMORY ? `#${path}` : path);

  // ------------------------------------------------------------------------ the frame

  const MODULES = [
    { key: 'clients', label: 'Clients', href: '/app/clients', icon: 'clients', tab: true },
    { key: 'deliveries', label: 'Deliveries', href: '/app/deliveries', icon: 'truck', tab: true },
    { key: 'driver', label: 'My run', href: '/app/deliveries', icon: 'truck', tab: true },
    { key: 'workshop', label: 'Workshop', href: '/app/deliveries', icon: 'shelf', tab: true },
    { key: 'clients', label: 'Builder', href: '/builder?mode=advanced', icon: 'shelf', tab: true, external: true },
    { key: 'tracker', label: 'Sales', href: '/elvis', external: true },
    { key: 'monitor', label: 'Monitor', href: '/metrics', external: true },
    { key: 'marketing', label: 'Marketing', href: '/marketing', external: true },
    { key: 'catalog', label: 'Catalogue', href: '/catalog-studio', external: true },
    { key: 'studio', label: 'Studio', href: '/studio', external: true },
    { key: 'queue', label: 'Queue', href: 'https://framework-queue.netlify.app', external: true },
    { key: 'admin', label: 'Admin', href: '/app/admin' }
  ];
  const mine = () => {
    const seen = new Set();
    return MODULES.filter((m) => S.me && S.me.modules.includes(m.key)).filter((m) => {
      if (m.key === 'driver' && S.me.modules.includes('workshop')) return false;
      if (seen.has(m.href)) return false;
      seen.add(m.href);
      return true;
    });
  };

  function linkFor(m) {
    const cur = here();
    const on = !m.external && cur.startsWith(m.href);
    const attrs = m.external
      ? (MEMORY && m.href.startsWith('/builder') ? `href="#" data-a="demo-builder" data-href="${esc(m.href)}"` : `href="${esc(MEMORY && m.href.startsWith('/') ? `https://www.framework.co.ke${m.href}` : m.href)}"`)
      : `href="${hrefFor(m.href)}" data-go="${esc(m.href)}"`;
    return { on, attrs };
  }

  function frame(title, body, { back = null, right = '', fill = false } = {}) {
    const items = mine();
    const tabs = items.filter((m) => m.tab).slice(0, 3);
    const tabLinks = tabs.map((m) => { const l = linkFor(m); return `<a ${l.attrs} class="${l.on ? 'on' : ''}">${ICON[m.icon]}<span>${m.label}</span></a>`; }).join('');
    const topLinks = items.map((m) => { const l = linkFor(m); return `<a ${l.attrs} class="${l.on ? 'on' : ''}">${m.label}</a>`; }).join('');
    const backBtn = back
      ? `<a class="iconbtn" href="${hrefFor(back)}" data-go="${esc(back)}" aria-label="Back">${ICON.back}</a>`
      : `<a class="mark" href="${hrefFor('/app')}" data-go="/app" aria-label="Framework"><img src="${CFG.logo || '/images/global/fwk-icon.png'}" alt=""></a>`;
    return `<header class="bar">${backBtn}
        <h1 class="${back ? '' : 'mobile-only'}">${esc(title)}</h1>
        ${back ? '' : `<nav class="top-links">${topLinks}</nav>`}
        ${right}
      </header>
      ${fill ? body : `<main class="page">${body}</main>`}
      <nav class="tabs">${tabLinks}<button data-a="more" aria-label="More">${ICON.home}<span>More</span></button></nav>`;
  }

  // --------------------------------------------------------------------------- render

  let token = 0;
  async function render() {
    const mine_ = ++token;
    const path = here();
    if (!S.me && !path.startsWith('/app/login')) {
      try {
        if (MEMORY) S.me = window.FW_MEMORY_ME();
        else {
          const r = await fetch('/api/me');
          if (r.ok) S.me = await r.json();
          else { try { sessionStorage.setItem('fw.next', location.pathname); } catch { /* fine */ } return go('/app/login', { replace: true }); }
        }
      } catch { return; }
    }
    if (mine_ !== token) return;
    for (const [re, view] of routes) {
      const m = re.exec(path);
      if (m) { await view(...m.slice(1)); return; }
    }
    go('/app', { replace: true });
  }

  const paint = (html) => { $('#app').innerHTML = html; };

  // ----------------------------------------------------------------------------- home

  function viewHome() {
    const tiles = mine().map((m) => {
      const l = linkFor(m);
      return `<a class="card module" ${l.attrs}>${ICON[m.icon] || ICON.home}<span>${m.label}</span></a>`;
    }).join('');
    paint(frame('Framework', `<div class="modules">${tiles}</div>
      ${CFG.demoPeople
        ? `<div class="row" style="margin-top:24px;justify-content:center;flex-wrap:wrap">${CFG.demoPeople.map((n) => `<button class="chip ${S.me.name === n ? 'on' : ''}" data-a="demo-as" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
        : `<div style="margin-top:28px;text-align:center"><button class="btn quiet small" data-a="signout">Sign out</button></div>`}`));
  }

  // -------------------------------------------------------------------------- clients

  function viewClients() {
    if (!S.index) S.index = cache.get('index');
    paint(frame('Clients', `<div class="search-wrap"><div class="search">${ICON.search}
        <input id="q" class="input" type="search" value="${esc(S.search)}" placeholder="Search" autocomplete="off" aria-label="Search clients"></div></div>
      <div id="rows" class="card list"></div>`,
      { right: `<button class="iconbtn" data-a="new-client" aria-label="New client">${ICON.plus}</button>` }));
    drawRows();
    const q = $('#q');
    q.addEventListener('input', () => { S.search = q.value; drawRows(); });
    if (matchMedia('(min-width: 900px)').matches) q.focus();
    loadIndex().then(drawRows).catch(() => { /* the cached list still works */ });
  }

  function filtered() {
    const rows = (S.index || []).slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const q = S.search.trim();
    if (!q) return rows.slice(0, 80);
    return rows.filter((r) => R.matches(r.find, q)).slice(0, 80);
  }

  function drawRows() {
    const box = $('#rows');
    if (!box) return;
    if (!S.index) { box.innerHTML = '<div class="empty">Loading</div>'; return; }
    const rows = filtered();
    const q = S.search.trim();
    const html = rows.map((r) => `<a class="client" href="${hrefFor(`/app/clients/${r.id}`)}" data-go="/app/clients/${esc(r.id)}">
        <span class="thumb">${r.thumb ? `<img loading="lazy" src="${imageUrl(r.thumb)}" alt="" data-render="${esc(r.thumb)}">` : ''}</span>
        <span class="grow"><div class="name">${esc(r.name)}</div><div class="sub">${esc(r.line)}</div></span>
        <span class="when">${esc(fWhen(r.at))}</span></a>`).join('');
    // Searching first and creating second means the same person doesn't get a second page.
    const make = q && !rows.length ? `<button class="client new-row" data-a="new-client" data-q="${esc(q)}">
        <span class="thumb blank">${ICON.plus}</span>
        <span class="grow">New client: ${esc(q)}</span></button>` : '';
    box.innerHTML = html + make;
    if (!rows.length && !q) box.innerHTML = '<div class="empty">No clients yet</div>';
  }

  // ---------------------------------------------------------------------- client page

  /** A name is free to change until there is an order: every Order ID is built from it. */
  const locked = (c) => (c.orderIds || []).length > 0;

  async function viewClient(id) {
    if (!S.docs[id]) { const kept = cache.get(`doc.${id}`); if (kept) S.docs[id] = kept; }
    drawClient(id);
    try {
      const { doc } = await api('GET', `clients/${id}`);
      took(doc);
      if (here().endsWith(id) && !S.sheet && !(document.activeElement && document.activeElement.closest('[data-keep]'))) drawClient(id);
    } catch (e) {
      if (e.status === 404) paint(frame('Not found', '<div class="empty">No client here.</div>', { back: '/app/clients' }));
    }
  }

  function chatLink(doc) {
    // The chat with the latest word from either side is the one being talked in.
    const chats = (doc.chats || []).filter((c) => safeUrl(c.url)).sort((a, b) => String(b.lastContact || '').localeCompare(String(a.lastContact || '')));
    return chats.length ? hrefOf(chats[0].url) : null;
  }

  const hrefOf = (url) => R.chatHref(url, { phone: matchMedia('(pointer: coarse)').matches });

  function drawClient(id) {
    const doc = S.docs[id];
    if (!doc) { paint(frame('', '<div class="empty">Loading</div>', { back: '/app/clients' })); return; }
    const scroll = window.scrollY;
    const { client } = doc;
    const chat = chatLink(doc);
    const right = `${chat ? `<a class="btn small" href="${esc(chat)}" target="fw-chat" rel="noopener">${ICON.chat}Chat</a>` : ''}
      <button class="iconbtn" data-a="client-menu" data-id="${esc(id)}" aria-label="More">${ICON.more}</button>`;

    const orders = doc.orders || [];
    const open = orders.filter((o) => !o.delivered);
    const past = orders.filter((o) => o.delivered);
    // What's next comes first: once there is an open invoice, that is what this page is about.
    const parts = open.length
      ? [invoicesBlock(doc, open), designsBlock(doc), detailsBlock(doc), pastBlock(doc, past), offersBlock(doc)]
      : [designsBlock(doc), detailsBlock(doc), pastBlock(doc, past), offersBlock(doc)];

    paint(frame('', `
      <div class="who" data-keep>${locked(client) ? `<div class="nm">${esc(client.name)}</div>` : `<input class="nm" value="${esc(client.name)}" data-c="client-field" data-f="name" data-id="${esc(id)}" aria-label="Client name">`}</div>
      ${whoLine(doc)}
      ${parts.join('')}`, { back: '/app/clients', right }));
    window.scrollTo(0, scroll);
  }

  /** The chat's name when it isn't the client's name, the ball if it's with us now, and how long a lead has been quiet. */
  function whoLine(doc) {
    const name = doc.client.name.toLowerCase();
    const chats = doc.chats || [];
    const other = chats.filter((c) => c.name && c.name.toLowerCase() !== name);
    const words = [];
    if (other.length) words.push(other.map((c) => `${esc(c.name)}${c.platform ? ` <span class="faint">${esc(c.platform)}</span>` : ''}`).join(', '));
    const latest = chats.slice().sort((a, b) => String(b.lastContact || '').localeCompare(String(a.lastContact || '')))[0];
    const heard = latest && latest.lastClient;
    const daysQuiet = heard ? Math.round((dateOf(today()) - dateOf(heard)) / 864e5) : null;
    if (latest && latest.awaiting === 'us' && daysQuiet !== null && daysQuiet <= 14) words.push('<span class="tag warn">Waiting on us</span>');
    else if (daysQuiet !== null && daysQuiet >= 7 && !(doc.orders || []).length) words.push(`<span class="faint">Last heard ${fDate(heard)}</span>`);
    if (!words.length) return '';
    return `<div class="who-line">${words.join(' ')}</div>`;
  }

  function designsBlock(doc) {
    const id = doc.client.id;
    const designs = (doc.designs || []).filter((d) => !d.archived).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    if (!designs.length) return `<button class="add-first" data-a="add-design" data-id="${esc(id)}">${ICON.plus}<span>Add a design</span></button>`;
    const heading = (doc.orders || []).some((o) => !o.delivered) ? '<div class="h2">Designs</div>' : '';
    const SHOW = 5;
    const add = `<button class="add-card" data-a="add-design" data-id="${esc(id)}" aria-label="Add a design">${ICON.plus}<span>Add</span></button>`;
    const older = designs.length > SHOW
      ? `<details class="fold"><summary>Older</summary><div class="designs">${designs.slice(SHOW).map((d) => designCard(doc, d)).join('')}</div></details>`
      : '';
    return `${heading}<div class="designs">${add}${designs.slice(0, SHOW).map((d) => designCard(doc, d)).join('')}</div>${older}`;
  }

  function designCard(doc, d) {
    const size = d.w ? `${d.w} × ${d.d} × ${d.h}` : d.code;
    const sub = d.invoice ? esc(d.invoice) : (d.sentAt ? `Sent ${fDate(d.sentAt)}` : money(d.total));
    return `<div class="card design ${d.invoice || d.orderId ? 'chosen' : ''}">
      <button class="pic" data-a="open-design" data-id="${esc(doc.client.id)}" data-code="${esc(d.code)}" aria-label="Open ${esc(size)}"><img loading="lazy" src="${imageUrl(d.code)}" alt="" data-render="${esc(d.code)}"></button>
      <div class="foot"><div class="meta"><b>${esc(size)}</b>${sub}</div>
        <button class="btn copy" data-a="copy" data-code="${esc(d.code)}" data-id="${esc(doc.client.id)}" aria-label="Copy image">${ICON.copy}</button></div>
    </div>`;
  }

  const STAGE = {
    draft: ['Draft', ''], open: ['Open', 'warn'], approved: ['Approved', ''],
    'part-paid': ['Part paid', 'warn'], paid: ['Paid', 'good'], delivered: ['Delivered', 'good']
  };

  function stageTag(o) {
    const stage = R.invoiceStage(o);
    if (o.zohoStatus === 'pending_approval') return '<span class="tag warn">Awaiting approval</span>';
    const [word, cls] = STAGE[stage] || ['', ''];
    return `<span class="tag ${cls}">${word}</span>`;
  }


  function deliveryLine(doc, o) {
    const stale = o.deliveryDate && o.deliveryDate < today();
    // An old day on a draft was only ever a hope.
    if (o.zohoStatus === 'draft' && (stale || !o.deliveryDate) && !o.pickup) return '';
    if (o.pickup) return o.deliveryDate && !stale ? `<div class="when-line">Collecting ${fDay(o.deliveryDate)}</div>` : (o.zohoStatus === 'draft' ? '' : '<div class="when-line">Collecting</div>');
    if (!o.deliveryDate) return '';
    const win = o.winS != null ? `, ${fMinutes(o.winS)} to ${fMinutes(o.winE)}` : ', time to agree';
    const agreed = o.clientState === 'yes' ? ' <span class="tag good">Confirmed</span>' : '';
    const addr = String(doc.client.address || '').trim();
    const flags = [];
    if (!addr) flags.push('No address');
    else if (!doc.client.place) flags.push('No map pin, ask the client to confirm');
    if (!o.feeCharged && !(o.items || []).some((x) => x.fee)) flags.push('No delivery charge on this invoice');
    return `<div class="when-line">${fDay(o.deliveryDate)}${win}${agreed}</div>${flags.map((f) => `<div class="flag">${f}</div>`).join('')}`;
  }

  function itemsOf(o) {
    // Two shelves often share a part: one line for it, with the count, per colour.
    const lines = new Map();
    for (const x of o.items || []) {
      if (!x.name) continue;
      const key = `${x.name}|${x.color}|${x.fee || ''}`;
      if (lines.has(key)) lines.get(key).qty += Number(x.qty) || 0; else lines.set(key, { ...x, qty: Number(x.qty) || 0 });
    }
    return [...lines.values()].map((x) => `<div class="li">${x.fee ? '<span class="fdot none"></span>' : dot(x.color)}<span>${x.fee ? `Delivery, ${money(x.fee)}` : `${x.qty} × ${esc(x.name)}`}</span></div>`).join('');
  }

  function invoicesBlock(doc, open) {
    const id = doc.client.id;
    const cards = open.map((o) => {
      const stage = R.invoiceStage(o);
      const bal = o.balance > 0 && stage !== 'draft' ? `<span class="tag warn">Balance ${money(o.balance)}</span>` : '';
      const buttons = [];
      if (stage === 'draft') {
        buttons.push(`<button class="btn primary small" data-a="send-approval" data-id="${esc(id)}" data-order="${esc(o.id)}">Send for approval</button>`);
        buttons.push(`<button class="btn small" data-a="revise" data-id="${esc(id)}" data-order="${esc(o.id)}">Change</button>`);
        if (!o.pickup) buttons.push(`<button class="btn small" data-a="add-delivery" data-id="${esc(id)}" data-order="${esc(o.id)}">${o.deliveryDate ? 'Change day' : 'Add delivery'}</button>`);
      } else if (!o.deliveryDate && !o.pickup) {
        buttons.push(`<button class="btn primary small" data-a="add-delivery" data-id="${esc(id)}" data-order="${esc(o.id)}">Add delivery</button>`);
      } else {
        if (!o.pickup && o.clientState !== 'yes') buttons.push(`<button class="btn small" data-a="copy-text" data-text="${esc(WORDS.received(o.deliveryDate))}">${ICON.copy}Message</button>`);
        buttons.push(`<button class="btn small" data-a="add-delivery" data-id="${esc(id)}" data-order="${esc(o.id)}">Change day</button>`);
        if (!o.pickup) buttons.push(`<a class="btn small" href="${hrefFor('/app/deliveries')}" data-go="/app/deliveries" data-day="${esc(o.deliveryDate)}">Deliveries</a>`);
      }
      // Past draft, the invoice itself is changed in Zoho, so the way there is right here.
      if (o.invoice && !MEMORY && S.me.modules.includes('invoice')) buttons.push(`<a class="btn small quiet" href="/api/zoho-door/${encodeURIComponent(o.invoice)}" target="_blank" rel="noopener">Zoho</a>`);
      return `<div class="card invoice">
        <div class="top"><span class="no">${esc(o.invoice || `Order ${o.code}`)}</span>${stageTag(o)}${bal}
          <span class="grow"></span><span class="muted small">${o.total ? money(o.total) : ''}</span></div>
        ${o.revisions ? `<div class="muted small">Revised ${o.revisions === 1 ? 'once' : `${o.revisions} times`}</div>` : ''}
        <div class="items">${itemsOf(o)}</div>
        ${deliveryLine(doc, o)}
        <div class="act">${buttons.join('')}</div></div>`;
    }).join('');
    return `<div class="h2 first">Invoice${open.length > 1 ? 's' : ''}</div>${cards}`;
  }

  function pastBlock(doc, past) {
    if (!past.length) return '';
    const rows = past.slice().sort((a, b) => String(b.deliveryDate || b.received || '').localeCompare(String(a.deliveryDate || a.received || '')))
      .map((o) => `<div class="past"><div class="row"><b class="grow">${esc(o.invoice || `Order ${o.code}`)}</b><span class="muted small">${o.deliveryDate ? fDate(o.deliveryDate) : ''}</span></div>
        <div class="items">${itemsOf(o)}</div></div>`).join('');
    return `<details class="fold"><summary>Past orders</summary><div class="card panel">${rows}</div></details>`;
  }

  function detailLine(id, label, field, value, { area = false, type = 'text', extra = '' } = {}) {
    const control = area
      ? `<textarea rows="2" class="inline-input" data-c="client-field" data-f="${field}" data-id="${esc(id)}" ${field === 'address' ? 'data-i="address"' : ''}>${esc(value)}</textarea>${field === 'address' ? '<span class="place-list"></span>' : ''}`
      : `<input class="inline-input" type="${type}" data-c="client-field" data-f="${field}" data-id="${esc(id)}" value="${esc(value)}">`;
    return `<label class="line" data-keep><span class="k">${label}</span><span class="v">${control}${extra}</span><span class="saved" data-saved="${field}">Saved</span></label>`;
  }

  function detailsBlock(doc) {
    const c = doc.client;
    const id = c.id;
    const orders = doc.orders || [];
    const known = c.phone && c.address;
    const chatPhone = !c.phone && (doc.chats || []).map((x) => x.phone).find(Boolean);
    const useChat = chatPhone ? `<button class="linkbtn" data-a="use-phone" data-id="${esc(id)}" data-phone="${esc(chatPhone)}">Use ${esc(chatPhone)}</button>` : '';
    const canAsk = !known && !c.zohoContactId && !orders.length;
    const waiting = R.openDesigns(doc).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    const canInvoice = waiting.length && S.me.modules.includes('invoice');
    const summary = known ? `<span class="faint trunc">${esc(fPhone(c.phone))}, ${esc(String(c.address).replace(/\s+/g, ' '))}</span>` : '';
    return `<details class="fold" ${known && orders.length ? '' : 'open'}><summary>Details ${summary}</summary>
      <div class="card panel">
        ${detailLine(id, 'Phone', 'phone', fPhone(c.phone), { type: 'tel', extra: useChat })}
        ${detailLine(id, 'Address', 'address', c.address, { area: true })}
        ${detailLine(id, 'KRA PIN', 'pin', c.pin)}
        ${detailLine(id, 'Company', 'company', c.company)}
        ${detailLine(id, 'Notes', 'notes', c.notes, { area: true })}
      </div>
      <div class="row detail-acts">
        ${canAsk ? `<button class="btn small" data-a="copy-words" data-w="ask">${ICON.copy}Copy the ask</button>` : ''}
        <span class="grow"></span>
        ${canInvoice ? `<button class="btn small primary" data-a="invoice" data-id="${esc(id)}" data-code="${esc(waiting[0].code)}">Invoice</button>` : ''}
      </div></details>`;
  }

  function offersBlock(doc) {
    const rows = doc.offers || [];
    if (!rows.length) return '';
    const live = rows.some((p) => p.ends && p.ends >= today());
    return `<details class="fold" ${live ? 'open' : ''}><summary>Offers</summary><div class="card panel">${rows.map((p) => `<div class="promo"><span class="grow">${esc(p.name)}${p.ends ? ` <span class="muted small">until ${fDate(p.ends)}</span>` : ''}</span></div>`).join('')}</div></details>`;
  }

  // --------------------------------------------------------------------------- sheets

  /*
   * A sheet has its own history entry, so a phone's back button closes it rather than
   * leaving the page, which is what people's thumbs expect.
   */
  function openSheet(html, { tall = false } = {}) {
    closeSheetNow();
    const el = document.createElement('div');
    el.className = 'scrim';
    el.innerHTML = `<div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
    S.sheet = el;
    history.pushState({ sheet: true }, '', location.href);
    document.documentElement.classList.add('locked');
    return el;
  }
  function closeSheetNow() { if (S.sheet) { S.sheet.remove(); S.sheet = null; document.documentElement.classList.remove('locked'); } }
  /** Drops the sheet and its history entry, then runs `then` once the browser has settled. */
  function closeSheet(then) {
    if (!S.sheet) { if (then) then(); return; }
    closeSheetNow();
    const done = () => { window.removeEventListener('popstate', done); if (then) setTimeout(then, 0); };
    window.addEventListener('popstate', done);
    S.skipPop = true;
    history.back();
  }
  const sheetHead = (title) => `<div class="sheet-head"><h2>${esc(title)}</h2><button class="iconbtn" data-a="close" aria-label="Close">${ICON.close}</button></div>`;

  function toast(msg, action) {
    const old = $('.toast-wrap');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast-wrap';
    el.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${action || ''}</div>`;
    document.body.appendChild(el);
    clearTimeout(S.toast);
    S.toast = setTimeout(() => el.remove(), action ? 6000 : 2500);
  }
  const dropToast = () => { const t = $('.toast-wrap'); if (t) t.remove(); };

  // ---- add a design ----

  let addState = { id: null, finish: 'Sage' };

  async function sheetAddDesign(id) {
    const last = (S.docs[id].designs || []).filter((d) => d.finish).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))[0];
    addState = { id, finish: last && FINISHES[last.finish] ? last.finish : (addState.finish || 'Sage') };
    const el = openSheet(`${sheetHead('Add a design')}
      <a class="btn primary wide big" href="${esc(builderHref(id))}" ${MEMORY ? `data-a="demo-builder" data-href="${esc(builderHref(id))}"` : ''}>Open builder</a>
      <div class="row add-row"><input class="input grow" id="code" placeholder="Code or link" autocomplete="off" autocapitalize="characters"><div class="fdots" id="finishes">${finishButtons()}</div></div>
      <div class="quick" id="quick"><div class="empty" style="grid-column:1/-1">Loading</div></div>`, { tall: true });
    $('#code', el).addEventListener('input', (e) => { const [code] = R.designCodesIn(e.target.value); if (code) addCode(code); });
    $('#code', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !R.designCodesIn(e.target.value).length) toast('No design code in that'); });
    if (!S.common) { try { S.common = (await api('GET', 'common')).rows; } catch { S.common = []; } }
    drawQuick();
  }

  const finishButtons = () => Object.keys(FINISHES).map((f) => `<button data-a="pick-finish" data-f="${f}" class="${addState.finish === f ? 'on' : ''}" aria-label="${f}">${dot(f)}</button>`).join('');

  function drawQuick() {
    const box = $('#quick');
    if (!box) return;
    const f = addState.finish;
    box.innerHTML = (S.common || []).map((c) => {
      const code = (c.variants && c.variants[f]) || c.code;
      return `<button data-a="quick-add" data-code="${esc(c.code)}" data-shown="${esc(code)}"><img loading="lazy" src="${imageUrl(code)}" alt="" data-render="${esc(code)}"><span>${esc(`${c.w} × ${c.d} × ${c.h}`)}</span></button>`;
    }).join('') || '<div class="empty" style="grid-column:1/-1">Nothing yet</div>';
  }

  async function addCode(code, source) {
    try {
      const { doc } = await api('POST', `clients/${addState.id}/designs`, { code, source });
      took(doc);
      closeSheet(() => { drawClient(addState.id); toast('Added', `<button data-a="copy" data-code="${esc(String(code).toUpperCase())}" data-id="${esc(addState.id)}">Copy image</button>`); });
    } catch (e) {
      if (e.message === 'unknown_code') toast('No design with that code');
      else if (e.message !== 'bad_code') toast('Could not add. Try again.');
    }
  }

  const builderHref = (id) => `/builder?mode=advanced&for=${encodeURIComponent(id)}`;

  // ---- one design ----

  function sheetDesign(id, code) {
    const doc = S.docs[id];
    const d = doc.designs.find((x) => x.code === code);
    if (!d) return;
    const raised = d.invoice || d.orderId;
    const canInvoice = S.me.modules.includes('invoice');
    // Past draft the invoice is what counts, and a colour here would change nothing on it.
    const onDraft = d.invoice && !d.orderId && (doc.orders || []).some((o) => o.invoice === d.invoice && o.zohoStatus === 'draft');
    const fixed = raised && !onDraft;
    const edit = `/builder/${esc(code)}?mode=advanced&for=${encodeURIComponent(id)}`;
    openSheet(`${sheetHead(d.w ? `${d.w} × ${d.d} × ${d.h} cm` : d.code)}
      <img class="big-pic" src="${imageUrl(code)}" alt="" data-render="${esc(code)}">
      ${fixed ? '' : `<div class="row design-row"><div class="fdots">${Object.keys(FINISHES).map((f) => `<button data-a="recolor" data-id="${esc(id)}" data-code="${esc(code)}" data-f="${f}" class="${d.finish === f ? 'on' : ''}" aria-label="${f}">${dot(f)}</button>`).join('')}</div></div>`}
      <div class="sheet-actions">
        <button class="btn primary" data-a="copy" data-code="${esc(code)}" data-id="${esc(id)}">${ICON.copy}Copy image</button>
        ${raised ? `<button class="btn" disabled>${esc(d.invoice || 'Invoiced')}</button>` : (canInvoice ? `<button class="btn" data-a="invoice" data-id="${esc(id)}" data-code="${esc(code)}">Invoice</button>` : '')}
      </div>
      <div class="row" style="margin-top:6px">
        <a class="btn quiet small" href="${edit}" ${MEMORY ? `data-a="demo-builder" data-href="${edit}"` : ''}>Edit in builder</a>
        <span class="grow"></span>
        ${raised ? '' : `<button class="btn quiet small" data-a="archive" data-id="${esc(id)}" data-row="${esc(d.id)}">Remove</button>`}
      </div>`);
  }

  // ---- copying ----

  async function toPng(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('no_image');
    const blob = await res.blob();
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
  }

  async function copyImage(code, id) {
    const doc = id ? S.docs[id] : null;
    const chat = doc ? chatLink(doc) : null;
    const jump = chat ? `<a href="${esc(chat)}" target="fw-chat" rel="noopener">Open chat</a>` : '';
    try {
      // Handed over as a promise so the browser still counts this as the tap itself.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(imageUrl(code)) })]);
      toast('Copied', jump);
    } catch (err) {
      // Where images can't reach the clipboard, the phone's share sheet can reach the chat.
      try {
        const file = new File([await toPng(imageUrl(code))], `${code}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      } catch { /* cancelled, or nothing can take it */ }
      toast('Could not copy on this device');
    }
  }

  async function copyWords(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy on this device'); }
  }

  // ---- invoice ----

  function sheetInvoice(id, code, reviseOrder, draft) {
    const doc = S.docs[id];
    const c = doc.client;
    const inv = reviseOrder ? reviseOrder.invoice : null;
    const inPlay = new Set(R.openDesigns(doc).map((d) => d.code));
    const open = doc.designs.filter((d) => !d.archived && ((inPlay.has(d.code)) || d.code === code || (inv && d.invoice === inv)))
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    const on = (d) => (inv ? d.invoice === inv : d.code === code);
    const rows = open.map((d) => `<label class="pick"><input type="checkbox" name="code" value="${esc(d.code)}" ${on(d) ? 'checked' : ''}>
        <img src="${imageUrl(d.code)}" alt="" data-render="${esc(d.code)}"><span class="grow">${esc(d.w ? `${d.w} × ${d.d} × ${d.h}` : d.code)}<br><span class="muted small">${esc(d.finish || '')}, ${money(d.total)}</span></span></label>`).join('');
    const fee = reviseOrder ? (draft && draft.fee != null ? draft.fee : '') : 2000;
    const pickup = reviseOrder ? !!(draft && draft.pickup) : false;
    const asking = !inv && (!c.phone || !c.address) && !locked(c);
    openSheet(`${sheetHead(inv ? `Change ${inv}` : 'Invoice')}
      <form id="inv">
        <div class="picks">${rows}</div>
        ${asking ? '<label class="field"><span>Paste their reply</span><textarea class="input" rows="2" id="reply" data-c="parse-reply"></textarea></label>' : ''}
        <label class="field"><span>Name on invoice</span><input class="input" name="name" value="${esc(c.name)}" required ${locked(c) ? 'readonly' : ''}></label>
        ${locked(c) || inv ? '' : `<label class="field"><span>Company, if invoicing one</span><input class="input" name="company" value="${esc(c.company)}" data-i="company"></label>
        <label class="field switch" id="to-company" ${c.company ? '' : 'hidden'}><span>Invoice to the company</span><input type="checkbox" name="toCompany" ${c.company ? 'checked' : ''}></label>`}
        <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(fPhone(c.phone) || (doc.chats || []).map((x) => x.phone).find(Boolean) || '')}"></label>
        <label class="field"><span>KRA PIN</span><input class="input" name="pin" value="${esc(c.pin)}"></label>
        ${c.vatExempt ? '<label class="field switch"><span>VAT exempt</span><input type="checkbox" name="exempt" checked></label>' : ''}
        <label class="field switch"><span>Client collects</span><input type="checkbox" name="pickup" data-c="toggle-pickup" ${pickup ? 'checked' : ''}></label>
        <div id="deliv" ${pickup ? 'hidden' : ''}><label class="field"><span>Address</span><textarea class="input" name="address" rows="2" data-i="address">${esc(c.address)}</textarea><span class="place-list"></span></label>
          <label class="field"><span>Delivery charge</span><input class="input" name="fee" inputmode="numeric" value="${esc(fee)}"></label></div>
        <button class="btn primary wide big" data-a="raise" data-id="${esc(id)}" ${inv ? `data-revise="${esc(inv)}"` : ''}>${inv ? 'Save draft' : 'Create draft'}</button>
      </form>`, { tall: true });
  }

  /** Exactly what's on the invoice, read from Zoho, before it goes for approval. */
  async function sheetSubmit(id, orderId) {
    const doc = S.docs[id];
    const o = doc.orders.find((x) => x.id === orderId);
    const { draft } = await api('GET', `orders/${orderId}/draft`);
    const rows = (draft.lines || []).map((l) => `<div class="inv-line"><span class="grow">${esc(l.qty > 1 ? `${l.qty} × ` : '')}${esc(l.name)}${l.color ? ` <span class="muted">${esc(l.color)}</span>` : ''}</span>${l.amount != null ? `<span>${money(l.amount)}</span>` : ''}</div>`).join('');
    openSheet(`${sheetHead(o.invoice)}
      <form>
        <div class="card panel inv-lines">${rows}</div>
        ${draft.pickup ? '' : `<label class="field"><span>Delivery charge</span><input class="input" name="fee" inputmode="numeric" value="${esc(draft.fee ?? '')}" data-was="${esc(draft.fee ?? '')}" data-total="${esc(draft.total)}" data-i="fee"></label>`}
        <div class="row inv-total"><span class="grow">Total</span><strong id="inv-total">${money(draft.total)}</strong></div>
        <label class="field"><span>Paid so far</span><input class="input" name="amount" inputmode="numeric"></label>
        <button class="btn primary wide big" data-a="save-submit" data-id="${esc(id)}" data-order="${esc(orderId)}">Send for approval</button>
      </form>`, { tall: true });
  }

  // ---- delivery ----

  function sheetDelivery(id, orderId) {
    const doc = S.docs[id];
    const order = doc.orders.find((o) => o.id === orderId);
    const days = R.deliveryDaysFrom(today());
    const had = order.deliveryDate;
    const list = had && !days.includes(had) ? [had, ...days] : days;
    const chosen = had || days[0];
    const addr = doc.client.address;
    openSheet(`${sheetHead(had || order.pickup ? 'Change delivery' : 'Add delivery')}
      <form>
        <label class="field"><span>Day</span><select class="input select" name="date" data-c="pick-day">${list.map((d) => `<option value="${d}" ${d === chosen && !order.pickup ? 'selected' : ''}>${fDay(d)}</option>`).join('')}<option value="other">Another day</option><option value="collect" ${order.pickup ? 'selected' : ''}>Client collects</option></select></label>
        <label class="field" id="other-day" hidden><span>Date</span><input class="input" name="other" type="date" min="${today()}"></label>
        ${addr ? '' : '<div class="muted small" style="margin-bottom:10px">No address yet</div>'}
        <button class="btn primary wide big" data-a="save-delivery" data-id="${esc(id)}" data-order="${esc(orderId)}">${had || order.pickup ? 'Save' : 'Add'}</button>
      </form>`);
  }

  // ---- menus ----

  function sheetMore() {
    openSheet(`${sheetHead('Framework')}
      ${mine().filter((m) => !m.tab).map((m) => { const l = linkFor(m); return `<a class="pick" ${l.attrs}><span class="grow row-label">${m.label}</span></a>`; }).join('')}
      <button class="pick" data-a="signout"><span class="grow muted row-label">Sign out</span></button>`);
  }

  function sheetClientMenu(id) {
    const doc = S.docs[id];
    const chats = (doc.chats || []).filter((c) => safeUrl(c.url));
    openSheet(`${sheetHead(doc.client.name)}
      ${chats.length > 1 ? chats.map((c) => `<a class="pick" href="${esc(hrefOf(c.url))}" target="fw-chat" rel="noopener"><span class="grow row-label">${esc(c.name)} <span class="muted small">${esc(c.platform || '')}</span></span></a>`).join('') : ''}
      ${(doc.chats || []).length ? `<button class="pick" data-a="log-offer" data-id="${esc(id)}"><span class="grow row-label">Sent an offer</span></button>` : ''}
      <button class="pick" data-a="link-chat" data-id="${esc(id)}"><span class="grow row-label">Link another chat</span></button>`);
  }

  async function sheetOffer(id) {
    if (!S.promotions) { try { S.promotions = (await api('GET', 'promotions')).rows; } catch { S.promotions = []; } }
    const had = new Set((S.docs[id].offers || []).map((p) => p.id));
    const live = S.promotions.filter((p) => (!p.ends || p.ends >= today()) && !had.has(p.id));
    openSheet(`${sheetHead('Sent an offer')}
      ${live.map((p) => `<button class="pick" data-a="save-offer" data-id="${esc(id)}" data-promo="${esc(p.id)}"><span class="grow row-label">${esc(p.name)}<br><span class="muted small">${esc(p.terms || '')}</span></span></button>`).join('') || '<div class="empty">No offers running</div>'}`);
  }

  function sheetLinkChat(id) {
    openSheet(`${sheetHead('Link another chat')}
      <form><label class="field"><span>Chat link or number</span><input class="input" name="q" required autocomplete="off"></label>
        <div id="link-msg" class="muted small" style="margin-bottom:10px"></div>
        <button class="btn primary wide big" data-a="save-link" data-id="${esc(id)}">Link</button></form>`);
  }

  /** Who has written in with no page yet. Typing narrows it, and a link or number can go straight in. */
  function sheetNewClient(q) {
    const el = openSheet(`${sheetHead('New client')}
      <form id="nc">
        <label class="field"><span>Name, chat link or number</span><input class="input" name="q" value="${esc(q || '')}" autocomplete="off" data-i="nc-filter"></label>
        <div id="nc-choose"></div>
        <button class="btn primary wide big" data-a="save-client" id="nc-go" ${q ? '' : 'hidden'}>Make page</button>
      </form>
      <div id="nc-recent" class="recent"></div>`, { tall: true });
    if (!q) $('input', el).focus();
    drawRecent();
    api('GET', 'chats/recent').then((r) => { S.recent = r.rows; drawRecent(); }).catch(() => { /* typing still works */ });
  }

  function drawRecent() {
    const box = $('#nc-recent');
    if (!box) return;
    const q = $('#nc input[name="q"]').value.trim();
    const rows = (S.recent || []).filter((c) => !q || R.nameResembles(c.name, q) || R.matches(c.phone || '', q)).slice(0, 25);
    box.innerHTML = rows.map((c) => `<button class="pick" data-a="pick-chat" data-chat="${esc(c.id)}">
        <span class="thumb">${c.thumb ? `<img loading="lazy" src="${imageUrl(c.thumb)}" alt="" data-render="${esc(c.thumb)}">` : ''}</span>
        <span class="grow row-label">${esc(c.name)}<br><span class="muted small">${esc(c.platform || '')}${c.designs ? ` · ${c.designs} design${c.designs === 1 ? '' : 's'}` : ''}</span></span>
        <span class="when">${esc(fWhen(c.lastContact))}</span></button>`).join('');
  }

  // -------------------------------------------------------------------------- planner

  /*
   * The delivery planner is its own page in a frame for now, and talks through this.
   * It reads what's open, and each change to a stop comes back as a change to the
   * order, so a client's page and the planner never tell two stories.
   */
  window.FW_PLANNER = {
    who: () => (S.me ? String(S.me.name || '').toLowerCase() : 'elvis'),
    day: () => S.plannerDay || null,
    orders: async () => (await api('GET', 'deliveries')).orders,
    open(clientId) { if (clientId) go(`/app/clients/${clientId}`); },
    change(orderId, fields) { return api('PATCH', `orders/${orderId}/delivery`, fields).then((r) => took(r.doc)).catch(() => {}); },
    log(entry) { return api('POST', 'log', entry).catch(() => {}); }
  };

  function viewDeliveries() {
    const src = CFG.planner || '/app/planner.html';
    paint(frame('Deliveries', `<div class="fill"><iframe id="planner" title="Deliveries" src="${esc(src)}"></iframe></div>`, { fill: true }));
    if (window.FW_PLANNER_MOUNT) window.FW_PLANNER_MOUNT($('#planner'));
  }

  // ---------------------------------------------------------------------------- admin

  async function viewAdmin() {
    paint(frame('Admin', '<div class="empty">Loading</div>', { back: '/app' }));
    S.staff = (await api('GET', 'staff')).rows;
    S.promotions = (await api('GET', 'promotions')).rows;
    drawAdmin();
  }

  function drawAdmin() {
    const labels = CFG.moduleLabels || {};
    const rows = (S.staff || []).map((p) => `<div class="card staffrow">
        <div class="row"><b class="grow">${esc(p.name || p.email)}</b>
          <label class="row small muted"><input type="checkbox" data-c="staff-active" data-id="${esc(p.id)}" ${p.active ? 'checked' : ''}> Active</label></div>
        <div class="muted small">${esc(p.email)}</div>
        <div class="chips">${Object.keys(labels).map((m) => `<button class="chip ${p.modules.includes(m) ? 'on' : ''}" data-a="toggle-module" data-id="${esc(p.id)}" data-m="${m}">${esc(labels[m])}</button>`).join('')}</div>
      </div>`).join('');
    const promos = (S.promotions || []).map((p) => `<details class="sent"><summary><span class="grow">${esc(p.name)}<br><span class="muted small">${esc(p.terms || '')}${p.ends ? ` until ${fDate(p.ends)}` : ''}</span></span><span class="faint">${(p.sentTo || []).length}</span></summary>
        ${(p.sentTo || []).map((t) => `<a class="pick" href="${hrefFor(`/app/clients/${t.id}`)}" data-go="/app/clients/${esc(t.id)}"><span class="grow row-label">${esc(t.name)}</span><span class="muted small">${t.at ? fDate(t.at) : ''}</span></a>`).join('')}</details>`).join('');
    paint(frame('Admin', `<div class="h2 first">Staff</div>${rows}
      <form class="card panel pad"><label class="field"><span>Gmail address</span><input class="input" name="email" type="email" required autocomplete="off"></label>
        <label class="field"><span>Name</span><input class="input" name="name"></label><button class="btn wide" data-a="add-staff">Add</button></form>
      <div class="h2">Promotions</div><div class="card panel">${promos}</div>
      <form class="card panel pad" style="margin-top:8px"><label class="field"><span>Name</span><input class="input" name="name" required></label>
        <label class="field"><span>Terms</span><input class="input" name="terms"></label>
        <label class="field"><span>Ends</span><input class="input" name="ends" type="date"></label><button class="btn wide" data-a="add-promo">Add</button></form>`, { back: '/app' }));
  }

  // ---------------------------------------------------------------------------- login

  function viewLogin() {
    forgetDevice();
    if (CFG.dev) {
      paint(`<div class="login"><div class="box"><img src="/images/global/fwk-icon-lg.png" alt="Framework">
        ${CFG.dev.map((p) => `<div style="margin-top:8px"><button class="btn wide" data-a="dev-login" data-email="${esc(p.email)}">${esc(p.name)}</button></div>`).join('')}</div></div>`);
      return;
    }
    paint(`<div class="login"><div class="box"><img src="/images/global/fwk-icon-lg.png" alt="Framework"><div id="g"></div><div class="msg" id="msg"></div></div></div>`);
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      let signedOut = false;
      try { signedOut = sessionStorage.getItem('fw.signedout') === '1'; sessionStorage.removeItem('fw.signedout'); } catch { /* fine */ }
      if (signedOut) window.google.accounts.id.disableAutoSelect();
      window.google.accounts.id.initialize({
        client_id: CFG.googleClientId,
        auto_select: !signedOut,
        use_fedcm_for_prompt: true,
        callback: async ({ credential }) => {
          const r = await fetch('/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
          const data = await r.json().catch(() => ({}));
          if (r.ok) {
            S.me = data;
            let next = '/app';
            try { next = sessionStorage.getItem('fw.next') || '/app'; sessionStorage.removeItem('fw.next'); } catch { /* fine */ }
            go(next, { replace: true });
            return;
          }
          $('#msg').textContent = data.error === 'not_staff' ? `${data.email} isn't on the staff list. Ask Ben.` : 'Could not sign in. Try again.';
        }
      });
      window.google.accounts.id.renderButton($('#g'), { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
      window.google.accounts.id.prompt();
    };
    document.head.appendChild(script);
  }

  // -------------------------------------------------------------------- image fallback

  /*
   * A design that has no stored picture yet (made in another colour, or raised from an
   * invoice) is drawn by the builder itself in a hidden frame, one at a time, then kept.
   * So the picture is always the builder's and there is no second renderer to maintain.
   */
  const renderQueue = [];
  let rendering = false;
  function queueRender(code) {
    if (MEMORY || renderQueue.includes(code)) return;
    renderQueue.push(code);
    pumpRender();
  }
  function pumpRender() {
    if (rendering || !renderQueue.length) return;
    rendering = true;
    const code = renderQueue.shift();
    const frameEl = document.createElement('iframe');
    frameEl.style.cssText = 'position:fixed;left:-2000px;top:0;width:900px;height:900px;border:0;visibility:hidden';
    frameEl.src = `/builder/${code}?render=present`;
    let timer = null;
    const finish = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); frameEl.remove(); rendering = false; setTimeout(pumpRender, 50); };
    async function onMessage(e) {
      if (e.source !== frameEl.contentWindow || !e.data || e.data.type !== 'fw-present' || e.data.code !== code) return;
      try {
        await fetch(`/api/design-image/${code}`, { method: 'PUT', body: e.data.blob });
        document.querySelectorAll(`img[data-render="${code}"]`).forEach((img) => { img.removeAttribute('data-failed'); img.src = `${imageUrl(code)}?t=${Date.now()}`; });
      } catch { /* it will be tried again next time this design is shown */ }
      finish();
    }
    timer = setTimeout(finish, 30000);
    window.addEventListener('message', onMessage);
    document.body.appendChild(frameEl);
  }
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.dataset && img.dataset.render && !img.dataset.failed) {
      img.dataset.failed = '1';
      queueRender(img.dataset.render);
    }
  }, true);

  // -------------------------------------------------------------------------- actions

  const ACT = {
    close() { closeSheet(); },
    more() { sheetMore(); },
    'new-client'(el) { sheetNewClient(el.dataset.q || S.search.trim()); },
    async 'save-client'(el, e) {
      e.preventDefault();
      const q = el.closest('form').elements.q.value.trim();
      if (q) await makeClient(q, undefined);
    },
    async 'pick-chat'(el) {
      const q = $('#nc input[name="q"]').value.trim();
      if (el.dataset.owner) { S.search = ''; closeSheet(() => go(`/app/clients/${el.dataset.owner}`)); return; }
      await makeClient(q, el.dataset.chat || null);
    },
    'add-design'(el) { sheetAddDesign(el.dataset.id); },
    'pick-finish'(el) { addState.finish = el.dataset.f; $('#finishes').innerHTML = finishButtons(); drawQuick(); },
    async 'quick-add'(el) {
      const { code, shown } = el.dataset;
      if (shown === code) { addCode(code, 'quick'); return; }
      const res = await api('POST', `clients/${addState.id}/recolor`, { code, finish: addState.finish });
      took(res.doc);
      closeSheet(() => { drawClient(addState.id); toast('Added', `<button data-a="copy" data-code="${esc(res.code)}" data-id="${esc(addState.id)}">Copy image</button>`); });
    },
    'open-design'(el) { sheetDesign(el.dataset.id, el.dataset.code); },
    copy(el) { copyImage(el.dataset.code, el.dataset.id); },
    'copy-words'(el) { copyWords(WORDS[el.dataset.w]); },
    'copy-text'(el) { copyWords(el.dataset.text); },
    async 'use-phone'(el) {
      const { id, phone } = el.dataset;
      const r = await api('PATCH', `clients/${id}`, { phone });
      tookClient(r.client); drawClient(id);
    },
    async recolor(el) {
      const { id, code, f } = el.dataset;
      const d = S.docs[id].designs.find((x) => x.code === code);
      if (d.finish === f) return;
      try {
        const res = await api('POST', `clients/${id}/recolor`, { code, finish: f });
        took(res.doc);
        // On a draft the new colour takes the old one's place, and the old one comes off.
        if (d.invoice && !d.orderId) {
          const others = S.docs[id].designs.filter((x) => x.invoice === d.invoice && x.code !== code).map((x) => x.code);
          const swapped = await api('POST', `clients/${id}/invoice`, { codes: [...others, res.code], revise: d.invoice });
          took(swapped.doc);
        }
        closeSheet(() => { drawClient(id); sheetDesign(id, res.code); });
      } catch { toast('Open it in the builder to change the colour'); }
    },
    invoice(el) {
      const { id, code } = el.dataset;
      if (S.sheet) closeSheet(() => sheetInvoice(id, code)); else sheetInvoice(id, code);
    },
    async revise(el) {
      const { id, order } = el.dataset;
      const { draft } = await api('GET', `orders/${order}/draft`);
      sheetInvoice(id, null, S.docs[id].orders.find((o) => o.id === order), draft);
    },
    async raise(el, e) {
      e.preventDefault();
      const f = el.closest('form');
      const codes = [...f.querySelectorAll('input[name="code"]:checked')].map((x) => x.value);
      if (!codes.length) { toast('Pick a design'); return; }
      if (!f.reportValidity()) return;
      const label = el.textContent;
      el.disabled = true;
      const id = el.dataset.id;
      const revise = el.dataset.revise || null;
      try {
        const was = S.docs[id].client;
        const changed = {};
        for (const k of ['name', 'company', 'phone', 'pin', 'address']) {
          const input = f.elements[k];
          if (input && !input.readOnly && input.value !== String(was[k] ?? '')) changed[k] = input.value;
        }
        const box = f.elements.address;
        if (box && (changed.address !== undefined || box.dataset.pin)) changed.place = box.dataset.pin || '';
        if (Object.keys(changed).length) tookClient((await api('PATCH', `clients/${id}`, changed)).client);
        const r = await api('POST', `clients/${id}/invoice`, {
          codes, pickup: f.elements.pickup.checked, delivery_fee: f.elements.fee ? f.elements.fee.value : '',
          invoiceTo: f.elements.toCompany && f.elements.toCompany.checked ? 'company' : 'person',
          vat_exempt: f.elements.exempt ? f.elements.exempt.checked : false, revise
        });
        took(r.doc);
        closeSheet(() => { drawClient(id); window.scrollTo(0, 0); toast(`${revise ? 'Saved' : 'Draft'} ${r.raised.invoice_number}`, r.raised.url ? `<a href="${esc(r.raised.url)}" target="_blank" rel="noopener">Open in Zoho</a>` : ''); });
      } catch (err) {
        el.disabled = false; el.textContent = label;
        const inv = err.data && err.data.invoice_number;
        const said = {
          client_exists: 'That name is already in Zoho',
          no_zoho_link: 'This client has orders but no Zoho link. Ask Ben.',
          not_a_draft: 'That invoice has left draft. Change it in Zoho.'
        };
        toast(inv ? `Already on ${inv}` : (said[err.message] || 'Could not create the draft'));
      }
    },
    'send-approval'(el) { sheetSubmit(el.dataset.id, el.dataset.order); },
    async 'save-submit'(el, e) {
      e.preventDefault();
      const { id, order } = el.dataset;
      const f = el.closest('form');
      el.disabled = true;
      try {
        const o = S.docs[id].orders.find((x) => x.id === order);
        const fee = f.elements.fee;
        // A changed charge goes on the draft first, so what's approved is what was just on screen.
        if (fee && fee.value !== fee.dataset.was) {
          const codes = S.docs[id].designs.filter((d) => d.invoice === o.invoice && !d.archived).map((d) => d.code);
          took((await api('POST', `clients/${id}/invoice`, { codes, revise: o.invoice, pickup: false, delivery_fee: fee.value })).doc);
        }
        const r = await api('POST', `orders/${order}/submit`, { amount: f.elements.amount.value });
        took(r.doc);
        closeSheet(() => drawClient(id));
      } catch { el.disabled = false; toast('Could not send it. Try again.'); }
    },
    'add-delivery'(el) { sheetDelivery(el.dataset.id, el.dataset.order); },
    async 'save-delivery'(el, e) {
      e.preventDefault();
      const { id, order } = el.dataset;
      const f = el.closest('form');
      const value = f.elements.date.value === 'other' ? f.elements.other.value : f.elements.date.value;
      if (!value) { toast('Pick a date'); return; }
      el.disabled = true;
      const collect = value === 'collect';
      const r = await api('POST', `orders/${order}/delivery`, collect ? { collect: true } : { date: value });
      took(r.doc);
      closeSheet(() => {
        drawClient(id);
        toast(collect ? 'Client collects' : fDay(value));
      });
    },
    async archive(el) {
      const { id, row } = el.dataset;
      const r = await api('PATCH', `designs/${row}`, { archived: true });
      took(r.doc);
      closeSheet(() => { drawClient(id); toast('Removed', `<button data-a="unarchive" data-id="${esc(id)}" data-row="${esc(row)}">Undo</button>`); });
    },
    async unarchive(el) {
      const { id, row } = el.dataset;
      const r = await api('PATCH', `designs/${row}`, { archived: false });
      took(r.doc); drawClient(id); dropToast();
    },
    'client-menu'(el) { sheetClientMenu(el.dataset.id); },
    'log-offer'(el) { const { id } = el.dataset; closeSheet(() => sheetOffer(id)); },
    'link-chat'(el) { const { id } = el.dataset; closeSheet(() => sheetLinkChat(id)); },
    async 'save-link'(el, e) {
      e.preventDefault();
      const { id } = el.dataset;
      const q = el.closest('form').elements.q.value.trim();
      try {
        const r = await api('POST', `clients/${id}/chats`, { q });
        took(r.doc);
        closeSheet(() => drawClient(id));
      } catch (err) {
        const msg = $('#link-msg');
        if (err.message === 'other_page') msg.textContent = `That chat is on ${err.data.otherName}'s page.`;
        else if (err.message === 'link_or_number') msg.textContent = 'Paste the chat link or a phone number.';
        else msg.textContent = 'No single chat matches that.';
      }
    },
    async 'save-offer'(el) {
      const { id, promo } = el.dataset;
      const r = await api('POST', `clients/${id}/offers`, { promotionId: promo });
      took(r.doc);
      S.promotions = null;
      closeSheet(() => drawClient(id));
    },
    async 'use-place'(el) {
      const box = el.closest('.field, .line');
      const area = $('textarea,input', box);
      const { place } = await api('POST', 'places/detail', { id: el.dataset.place });
      area.value = place ? place.text : el.dataset.text;
      area.dataset.pin = place && place.pin ? place.pin : '';
      $('.place-list', box).innerHTML = '';
      area.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async signout() {
      if (!MEMORY) await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});
      S.me = null;
      S.index = null;
      S.docs = {};
      forgetDevice();
      try { sessionStorage.setItem('fw.signedout', '1'); } catch { /* fine */ }
      closeSheetNow();
      go('/app/login', { replace: true });
    },
    async 'dev-login'(el) {
      await fetch('/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: el.dataset.email }) });
      const r = await fetch('/api/me');
      S.me = await r.json();
      go('/app', { replace: true });
    },
    async 'toggle-module'(el) {
      const person = S.staff.find((p) => p.id === el.dataset.id);
      const has = person.modules.includes(el.dataset.m);
      const modules = has ? person.modules.filter((m) => m !== el.dataset.m) : person.modules.concat(el.dataset.m);
      S.staff = (await api('PATCH', `staff/${person.id}`, { modules })).rows;
      drawAdmin();
    },
    async 'add-staff'(el, e) {
      e.preventDefault();
      const f = el.closest('form');
      if (!f.reportValidity()) return;
      S.staff = (await api('POST', 'staff', { email: f.elements.email.value, name: f.elements.name.value, modules: [] })).rows;
      drawAdmin();
    },
    async 'add-promo'(el, e) {
      e.preventDefault();
      const f = el.closest('form');
      if (!f.reportValidity()) return;
      await api('POST', 'promotions', { name: f.elements.name.value, terms: f.elements.terms.value, ends: f.elements.ends.value || null });
      S.promotions = (await api('GET', 'promotions')).rows;
      drawAdmin();
    },
    'demo-as'(el) { window.FW_SET_ME(el.dataset.n); },
    'demo-builder'(el, e) { if (window.FW_DEMO_BUILDER) { e.preventDefault(); window.FW_DEMO_BUILDER(el.dataset.href || el.getAttribute('href')); } },
    async 'retry-field'(el) {
      const { id, f } = el.dataset;
      const value = cache.get(`draft.${id}.${f}`);
      const r = await api('PATCH', `clients/${id}`, { [f]: value });
      tookClient(r.client); cache.del(`draft.${id}.${f}`); drawClient(id); dropToast();
    }
  };

  async function makeClient(q, chatId) {
    let r;
    try {
      r = await api('POST', 'clients', { q, chatId });
    } catch (err) {
      if (err.message === 'chat_not_in') { toast('That chat isn\'t in yet. Type their name instead.'); return; }
      throw err;
    }
    if (r.choose) {
      $('#nc-recent').innerHTML = '';
      $('#nc-choose').innerHTML = `${r.choose.map((c) => `<button class="pick" data-a="pick-chat" data-chat="${esc(c.id)}" ${c.ownerId ? `data-owner="${esc(c.ownerId)}"` : ''}><span class="grow row-label">${esc(c.name)} <span class="muted small">${esc(c.platform || '')}${c.lastContact ? `, ${fDate(c.lastContact)}` : ''}</span>${c.ownerName ? `<br><span class="muted small">Has a page: ${esc(c.ownerName)}</span>` : ''}</span></button>`).join('')}
        <button class="pick" data-a="pick-chat" data-chat=""><span class="grow row-label muted">None of these</span></button>`;
      $('#nc-go').hidden = true;
      return;
    }
    S.search = '';
    if (r.doc) took(r.doc);
    closeSheet(() => go(`/app/clients/${r.id}`));
  }

  const CHANGE = {
    async 'client-field'(el) {
      const { id, f } = el.dataset;
      const value = el.value;
      const doc = S.docs[id];
      if (!doc || String(doc.client[f] ?? '') === value) return;
      // What was typed stays on this device until the server has it: a dropped
      // connection must never cost someone an address they just took down.
      const draftKey = `draft.${id}.${f}`;
      cache.set(draftKey, value);
      try {
        // A new address drops the old pin, unless it was picked from the map just now.
        const r = await api('PATCH', `clients/${id}`, f === 'address' ? { address: value, place: el.dataset.pin || '' } : { [f]: value });
        tookClient(r.client);
        cache.del(draftKey);
        const tick = document.querySelector(`[data-saved="${f}"]`);
        if (tick) { tick.classList.add('show'); setTimeout(() => tick.classList.remove('show'), 1500); }
      } catch (err) {
        if (err.message === 'name_locked') { el.value = doc.client.name; toast('This name is on the invoices. Change it in Zoho.'); return; }
        toast('Not saved', `<button data-a="retry-field" data-id="${esc(id)}" data-f="${esc(f)}">Retry</button>`);
      }
    },
    'toggle-pickup'(el) { const box = $('#deliv'); if (box) box.hidden = el.checked; },
    'pick-day'(el) {
      const other = $('#other-day');
      other.hidden = el.value !== 'other';
      if (!other.hidden) $('input', other).focus();
    },
    'parse-reply'(el) {
      const f = el.closest('form');
      const got = R.parseReply(el.value);
      if (got.name) f.elements.name.value = got.name;
      if (got.phone) f.elements.phone.value = got.phone;
      if (got.address && f.elements.address) f.elements.address.value = got.address;
      if (got.pickup !== null) { f.elements.pickup.checked = got.pickup; const box = $('#deliv'); if (box) box.hidden = got.pickup; }
    },
    async 'staff-active'(el) {
      S.staff = (await api('PATCH', `staff/${el.dataset.id}`, { active: el.checked })).rows;
      drawAdmin();
    }
  };

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-go]');
    if (link && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (link.dataset.day) S.plannerDay = link.dataset.day;
      const dest = link.dataset.go;
      if (S.sheet) closeSheet(() => go(dest)); else go(dest);
      return;
    }
    const a = e.target.closest('[data-a]');
    if (a && ACT[a.dataset.a]) {
      if (a.tagName !== 'INPUT') e.preventDefault();
      if (a.dataset.busy) return;
      a.dataset.busy = '1';
      Promise.resolve(ACT[a.dataset.a](a, e))
        .catch((err) => { if (err && err.message !== 'signed_out') toast('Something went wrong. Try again.'); })
        .finally(() => { delete a.dataset.busy; });
    }
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-c]');
    if (c && CHANGE[c.dataset.c]) CHANGE[c.dataset.c](c, e);
  });
  let placeTimer = null;
  const INPUT = {
    fee(el) {
      const fee = (x) => Number(String(x).replace(/[^\d.]/g, '')) || 0;
      $('#inv-total').textContent = money(Number(el.dataset.total) - fee(el.dataset.was) + fee(el.value));
    },
    'nc-filter'(el) {
      $('#nc-go').hidden = !el.value.trim();
      $('#nc-choose').innerHTML = '';
      drawRecent();
    },
    company(el) {
      const box = $('#to-company');
      box.hidden = !el.value.trim();
      $('input', box).checked = !box.hidden;
    },
    address(el) {
      el.dataset.pin = '';
      clearTimeout(placeTimer);
      const list = $('.place-list', el.closest('.field, .line'));
      const q = el.value.trim();
      if (q.length < 3) { list.innerHTML = ''; return; }
      placeTimer = setTimeout(async () => {
        const { rows } = await api('POST', 'places', { q }).catch(() => ({ rows: [] }));
        list.innerHTML = rows.map((x) => `<button type="button" class="place" data-a="use-place" data-place="${esc(x.id)}" data-text="${esc(x.text)}">${esc(x.text)}</button>`).join('');
      }, 300);
    }
  };
  document.addEventListener('input', (e) => {
    const i = e.target.closest('[data-i]');
    if (i && INPUT[i.dataset.i]) INPUT[i.dataset.i](i, e);
  });
  document.addEventListener('submit', (e) => e.preventDefault());
  window.addEventListener('popstate', () => {
    if (S.skipPop) { S.skipPop = false; return; }
    if (S.sheet) { closeSheetNow(); return; }
    render();
  });

  // Back from the builder or the chat: show what changed there without a reload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.me && !S.sheet && !(document.activeElement && document.activeElement.closest('[data-keep]'))) render();
  });

  window.FW_APP_RENDER = render;
  render();
  if ('serviceWorker' in navigator && !MEMORY && !CFG.dev) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
})();

/*
 * The strip under /builder for someone signed in to the staff app: which client this
 * design is for, and one button to put it on their page. It replaces the builder's old
 * Staff login, whose job (client details, the invoice) now lives on the client's page.
 *
 * builder.html loads this only when the fw_staff cookie says someone is signed in, so
 * the public never downloads it. The cookie decides nothing: /api/me does, and if it
 * says no the strip never appears. It talks to the builder only through
 * window.FrameworkBuilder (docs/builder.md).
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.get('render')) return; // the hidden frame that draws pictures for a client page

  const FINISH_INK = '#245d5f';
  const css = `
    .nd-staff{display:none!important}
    #fw-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;height:56px;display:flex;align-items:center;gap:6px;
      padding:0 max(8px,env(safe-area-inset-right,0px)) env(safe-area-inset-bottom,0px) max(8px,env(safe-area-inset-left,0px));
      background:#fff;border-top:1px solid #e1e7e5;font:500 15px 'Red Hat Display',system-ui,sans-serif;color:#1b1f1e;box-sizing:content-box}
    #fw-bar *{box-sizing:border-box;font:inherit;color:inherit}
    #fw-bar button,#fw-bar a{border:0;background:none;min-height:44px;border-radius:10px;display:inline-flex;align-items:center;cursor:pointer;text-decoration:none}
    #fw-bar .menu{width:44px;justify-content:center;flex:none}
    #fw-bar .who{flex:1;min-width:0;padding:0 8px;justify-content:flex-start;font-weight:700}
    #fw-bar .who span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #fw-bar .who.none{color:#68726f;font-weight:500}
    #fw-bar .go{flex:none;padding:0 16px;background:${FINISH_INK};color:#fff;font-weight:700}
    #fw-bar .go[disabled]{opacity:.55}
    #fw-bar svg{width:22px;height:22px;display:block}
    #fw-sheet{position:fixed;inset:0;z-index:2147483001;background:rgba(10,16,15,.42);display:flex;align-items:flex-end;justify-content:center;font:500 15px 'Red Hat Display',system-ui,sans-serif;color:#1b1f1e}
    #fw-sheet .box{background:#fff;width:100%;max-width:560px;max-height:80dvh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px))}
    #fw-sheet input{width:100%;min-height:44px;border:1px solid #e1e7e5;border-radius:12px;padding:10px 12px;font:inherit;font-size:16px;margin-bottom:8px;box-sizing:border-box}
    #fw-sheet .rows{overflow:auto;flex:1}
    #fw-sheet a,#fw-sheet button.row{display:flex;align-items:center;width:100%;min-height:48px;padding:6px 4px;border:0;border-top:1px solid #e1e7e5;background:none;font:inherit;color:inherit;text-decoration:none;text-align:left;cursor:pointer}
    #fw-sheet small{display:block;color:#68726f;font-weight:400}
    @media (min-width:700px){#fw-sheet{align-items:center}#fw-sheet .box{border-radius:18px}}
  `;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

  const cached = () => { try { return JSON.parse(localStorage.getItem('fw.index')) || []; } catch { return []; } };
  const remember = (c) => { try { sessionStorage.setItem('fw.for', JSON.stringify(c)); } catch { /* fine */ } };
  const recalled = () => { try { return JSON.parse(sessionStorage.getItem('fw.for')); } catch { return null; } };

  let me = null;
  let client = null;
  let added = null; // the code last put on this client's page

  async function api(method, path, body) {
    const res = await fetch(`/api/app/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 && (await fetch('/api/me')).ok) return api(method, path, body);
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) throw new Error(data.error || 'failed');
    return data;
  }

  function drawBar() {
    const bar = document.getElementById('fw-bar');
    const b = window.FrameworkBuilder;
    const snap = b ? b.snapshot() : { empty: true };
    const name = client ? client.name : 'Choose client';
    const done = added && snap.code === added;
    bar.innerHTML = `<button class="menu" data-x="menu" aria-label="Menu">${MENU}</button>
      <button class="who ${client ? '' : 'none'}" data-x="pick"><span>${esc(name)}</span></button>
      ${done
        ? `<a class="go" href="/app/clients/${encodeURIComponent(client.id)}">Back to ${esc(firstWord(client.name))}</a>`
        : `<button class="go" data-x="add" ${snap.empty ? 'disabled' : ''}>Add</button>`}`;
  }

  const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || 'client';

  function closeSheet() { const s = document.getElementById('fw-sheet'); if (s) s.remove(); }

  function openSheet(html) {
    closeSheet();
    const s = document.createElement('div');
    s.id = 'fw-sheet';
    s.innerHTML = `<div class="box">${html}</div>`;
    s.addEventListener('click', (e) => { if (e.target === s) closeSheet(); });
    document.body.appendChild(s);
    return s;
  }

  function sheetMenu() {
    const items = [['/app/clients', 'Clients', 'clients'], ['/app/deliveries', 'Deliveries', 'deliveries'], ['/app', 'Home', null]]
      .filter((x) => !x[2] || me.modules.includes(x[2]));
    openSheet(items.map(([href, label]) => `<a href="${href}">${label}</a>`).join(''));
  }

  function rows(list, query) {
    const rules = window.FrameworkAppRules;
    const q = query.trim();
    const sorted = list.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const hits = q && rules ? sorted.filter((r) => rules.matches(r.find, q)) : sorted;
    return hits.slice(0, 40).map((r) => `<button class="row" data-pick="${esc(r.id)}"><span>${esc(r.name)}<small>${esc(r.line || '')}</small></span></button>`).join('')
      || `<div style="padding:16px;color:#68726f">${q ? 'No one by that name' : 'Loading'}</div>`;
  }

  async function sheetPick() {
    let list = cached();
    const s = openSheet('<input type="search" placeholder="Search" aria-label="Search clients"><div class="rows"></div>');
    const input = s.querySelector('input');
    const box = s.querySelector('.rows');
    const draw = () => { box.innerHTML = rows(list, input.value); };
    draw();
    input.addEventListener('input', draw);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const row = list.find((r) => r.id === b.dataset.pick);
      client = { id: row.id, name: row.name };
      remember(client);
      added = null;
      closeSheet();
      drawBar();
    });
    if (matchMedia('(hover: hover)').matches) input.focus();
    try {
      list = (await api('GET', 'clients')).rows;
      try { localStorage.setItem('fw.index', JSON.stringify(list)); } catch { /* fine */ }
      draw();
    } catch { /* the cached list still works */ }
  }

  async function add(button) {
    if (!client) { sheetPick(); return; }
    const b = window.FrameworkBuilder;
    button.disabled = true;
    button.textContent = 'Adding';
    try {
      const code = await b.save();
      // The picture first, so the client's page has it the moment it opens. If this fails
      // the page draws it again itself, so it is not worth stopping for.
      try {
        const image = await b.presentBlob();
        await fetch(`/api/design-image/${code}`, { method: 'PUT', body: image });
      } catch { /* drawn later */ }
      await api('POST', `clients/${encodeURIComponent(client.id)}/designs`, { code, source: 'builder' });
      added = code;
      drawBar();
    } catch {
      button.disabled = false;
      button.textContent = 'Try again';
    }
  }

  async function start() {
    const r = await fetch('/api/me').catch(() => null);
    if (!r || !r.ok) return;
    me = await r.json();
    if (!me.modules || !me.modules.includes('clients')) return;
    // The builder's own scripts may still be arriving.
    for (let i = 0; i < 100 && !window.FrameworkBuilder; i += 1) await new Promise((done) => setTimeout(done, 100));
    if (!window.FrameworkBuilder) return;
    await window.FrameworkBuilder.ready;

    const forId = params.get('for');
    if (forId) {
      const row = cached().find((c) => c.id === forId);
      client = row ? { id: row.id, name: row.name } : { id: forId, name: 'Client' };
      if (!row) api('GET', `clients/${encodeURIComponent(forId)}`).then(({ doc }) => { client.name = doc.client.name; remember(client); drawBar(); }).catch(() => {});
      remember(client);
    } else client = recalled();

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.id = 'fw-bar';
    document.body.appendChild(bar);
    window.FrameworkBuilder.setBottomInset(56);

    bar.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (!x) return;
      if (x.dataset.x === 'menu') sheetMenu();
      if (x.dataset.x === 'pick') sheetPick();
      if (x.dataset.x === 'add') add(x);
    });
    window.FrameworkBuilder.on('change', drawBar);
    drawBar();
  }

  const rulesScript = document.createElement('script');
  rulesScript.src = '/js/app/rules.js';
  document.head.appendChild(rulesScript);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

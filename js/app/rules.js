/*
 * The staff app's small pure rules, wrapped like js/builder/engine.js so one copy runs
 * in the browser and on the server: how a search matches, which days a delivery can go
 * on, the one line under a client's name. A second copy of any of these would be a
 * quiet way for the list and the server to disagree.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameworkAppRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------- delivery days */

  /** Wed and Sat, the days Elvis tells clients. Sunday is 0. Any other day can still be chosen by hand. */
  const DELIVERY_DAYS = [3, 6];

  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();

  /**
   * The delivery days to offer, the first being the default. At least one full workday has to fall
   * between today and the delivery, and Monday to Saturday are workdays. More is often needed,
   * which Elvis settles with Patrick by phone, so this only ever fills in the list.
   */
  function deliveryDaysFrom(today, { count = 6, days = DELIVERY_DAYS } = {}) {
    let workday = addDays(today, 1);
    if (dow(workday) === 0) workday = addDays(workday, 1);
    const out = [];
    let d = addDays(workday, 1);
    while (out.length < count) {
      if (days.includes(dow(d))) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  /* ------------------------------------------------------------------ matching */

  const digits = (s) => String(s || '').replace(/\D/g, '');
  /** The last nine digits are the number however it was typed: 07.., +2547.., 2547.. */
  const phoneKey = (s) => { const d = digits(s); return d.length >= 9 ? d.slice(-9) : ''; };
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Everything a client can be found by, flattened once for the index. */
  function searchTextFor(doc) {
    // Not notes or the KRA PIN: this list is held on every device and in Blobs, so it carries no more than search needs.
    const parts = [doc.client.name, doc.client.company, doc.client.address];
    const phones = [doc.client.phone];
    for (const c of doc.chats || []) { parts.push(c.name, c.key ? `|${c.key}` : '', c.threadId ? `chat${c.threadId}` : ''); phones.push(c.phone); }
    for (const d of doc.designs || []) parts.push(d.code);
    for (const o of doc.orders || []) { parts.push(o.invoice, o.code ? `#${o.code}` : '', o.project); phones.push(o.phone, o.onSitePhone); }
    const keys = phones.map(phoneKey).filter(Boolean);
    return fold(parts.filter(Boolean).join(' ')) + (keys.length ? ` ${keys.join(' ')}` : '');
  }

  /** Every word has to be somewhere. A typed number matches on its digits, however it was typed. */
  function matches(text, query) {
    // A pasted Business Suite link finds its chat, exactly.
    const link = /selected_item_id=(\d+)/.exec(String(query));
    if (link) return text.includes(`chat${link[1]}`);
    const words = fold(query).split(/\s+/).filter(Boolean);
    return words.every((w) => {
      if (/^[+\d][\d-]*$/.test(w)) {
        const key = digits(w).replace(/^(?:254|0)/, '');
        return key ? text.includes(key) : true;
      }
      return text.includes(w);
    });
  }

  /**
   * What someone typed into "new client": a pasted Business Suite link is exact (only
   * selected_item_id is read, because the path and order of the rest vary), a number
   * is next best, and a name is only ever a suggestion.
   */
  function parseIdentity(q) {
    const text = String(q || '').trim();
    if (!text) return { kind: 'empty' };
    const link = /selected_item_id=(\d+)/.exec(text);
    if (link) return { kind: 'thread', thread: link[1], text };
    if (/^[+\d][\d\s()-]{7,}$/.test(text)) return { kind: 'phone', key: phoneKey(text), text };
    return { kind: 'name', text: text.replace(/^@/, '') };
  }

  /** A name with its emoji, odd lettering, accents and case worn off: 𝔗𝔲𝔪𝔦.𝔒𝔲𝔪𝔞🎀 is "tumi ouma". */
  const looseName = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  /** Does what was typed resemble this name? Loose on purpose: it only offers, a person chooses. */
  function nameResembles(name, typed) {
    const have = looseName(name);
    const want = looseName(typed);
    if (!want) return fold(name).includes(fold(typed).trim()); // A name that is nothing but emoji.
    if (!have) return false;
    return (` ${have}`).includes(` ${want}`) || want.split(' ').every((w) => have.split(' ').some((h) => h.startsWith(w)));
  }

  /**
   * The link to open a chat. Tried on a phone, 7 Nov: the Business Suite app opens a WhatsApp chat from
   * its "all" inbox address and not from the one we store. An Instagram chat comes up as "Facebook user"
   * and goes nowhere from either, so on a phone that one goes to the inbox instead of to a dead end.
   */
  function chatHref(url, { phone = false } = {}) {
    let u;
    try { u = new URL(url); } catch { return url; }
    if (!/(^|\.)facebook\.com$/.test(u.hostname) || !u.pathname.startsWith('/latest/inbox')) return url;
    const q = u.searchParams;
    const instagram = q.get('thread_type') === 'IG_MESSAGE';
    if (instagram && !phone) return url;
    const out = new URLSearchParams();
    for (const k of ['asset_id', 'business_id', 'mailbox_id']) if (q.get(k)) out.set(k, q.get(k));
    if (!instagram) for (const k of ['selected_item_id', 'thread_type']) if (q.get(k)) out.set(k, q.get(k));
    return `${u.origin}/latest/inbox/all?${out}`;
  }

  /** Which chats this identity could mean. A name returns candidates, never a decision. */
  function chatsMatching(chats, identity) {
    if (identity.kind === 'thread') return chats.filter((c) => String(c.threadId) === identity.thread);
    if (identity.kind === 'phone') return chats.filter((c) => identity.key && (c.phones || [c.phone]).some((p) => phoneKey(p) === identity.key));
    if (identity.kind === 'name') {
      return chats.filter((c) => nameResembles(c.name, identity.text));
    }
    return [];
  }

  /**
   * Design codes in whatever was pasted: a bare code, a link, or the whole message the builder
   * writes for a client ("... Design code: 25M6S3J ..."). Never seven letters from the middle of
   * a sentence: "Framework" is seven letters.
   */
  function designCodesIn(input) {
    const text = String(input || '').trim();
    const found = new Set();
    for (const m of text.matchAll(/\/(?:d|builder)\/([0-9A-Za-z]{7})(?![0-9A-Za-z])/g)) found.add(m[1].toUpperCase());
    for (const m of text.matchAll(/design\s*code\s*[:#-]?\s*([0-9A-Za-z]{7})(?![0-9A-Za-z])/gi)) found.add(m[1].toUpperCase());
    if (!found.size && /^[0-9A-Za-z]{7}$/.test(text)) found.add(text.toUpperCase());
    return [...found];
  }

  /**
   * A client's answer to the ask, split into the boxes. Over 42 real replies this had the full
   * name in 27 and the right phone in 15 of the 17 that gave one. It only fills boxes the
   * person then checks, so it is allowed to be wrong.
   */
  function parseReply(text) {
    const out = { name: '', phone: '', address: '', pickup: null };
    let t = String(text || '').replace(/\r/g, '').trim();
    const num = /\+?\d[\d\s-]{7,}\d/.exec(t);
    if (num) { out.phone = num[0].trim(); t = t.replace(num[0], ' '); }
    if (/\b(pick\s?-?\s?up|collect|collection)\b/i.test(t)) out.pickup = true;
    else if (/\bdeliver/i.test(t)) out.pickup = false;
    t = t.replace(/\b(the\s+)?(my\s+)?(full\s+)?name(\s+for\s+the\s+invoice)?\s*(is|:|-)?/gi, '\n')
      .replace(/\b(phone|number|tel|contact|mobile|call)(\s+number)?\s*(is|:|-)?/gi, '\n')
      .replace(/\b(location|address|delivery address)\s*(is|:|-)?/gi, '\n')
      .replace(/\b(i\s+prefer\s+)?(to\s+be\s+)?(delivered|delivery|pick\s?-?\s?up|deliver)(\s+(please|to|at|in))?\b/gi, '\n')
      .replace(/\b(please|thanks|thank you|hello|hi|ok|okay|sure|great|yes|perfect|noted)\b[.,!]?/gi, ' ');
    const pieces = t.split(/\n|,|;|\.\s| - /).map((x) => x.replace(/^[\s.:-]+|[\s.:-]+$/g, '').replace(/\s+/g, ' ')).filter(Boolean)
      .filter((x) => !/\?$/.test(x) && x.split(' ').length <= 9);
    const place = /\b(road|rd|street|st|estate|apartments?|apt|house|flat|court|avenue|ave|lane|drive|close|gardens?|westlands|kilimani|karen|lavington|runda|kileleshwa|parklands|gigiri|langata|nairobi|kenya|block|unit|floor)\b/i;
    const i = pieces.findIndex((x) => /^[\p{L}'.-]+(\s+[\p{L}'.-]+){0,4}$/u.test(x) && !place.test(x));
    if (i >= 0) { out.name = pieces[i]; pieces.splice(i, 1); }
    out.address = pieces.join(', ');
    return out;
  }

  /* ------------------------------------------------------------- what a page says */

  const finalized = ['approved', 'pending_approval', 'sent', 'paid', 'partially_paid', 'overdue'];

  /** A draft has no order yet; the sync makes the order once the invoice leaves draft. */
  function invoiceStage(o) {
    if (o.delivered) return 'delivered';
    if (o.zohoStatus === 'draft') return 'draft';
    if (o.paid && o.balance === 0) return 'paid';
    if (o.paid) return 'part-paid';
    if (finalized.includes(o.zohoStatus)) return 'approved';
    return 'open';
  }

  /** Neither approval nor payment holds a delivery back. */
  const canAddDelivery = (o) => invoiceStage(o) !== 'delivered';

  const shortDay = (s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()}`;
  };

  /**
   * Designs that could still be bought. While an order is open that is every one not on an invoice,
   * because a second shelf often joins a draft. Once everything is delivered, a design from before
   * or on the day of the last order is a version they didn't choose, not a sale in progress.
   */
  function openDesigns(doc) {
    const orders = doc.orders || [];
    const unraised = (doc.designs || []).filter((d) => !d.archived && !d.invoice && !d.orderId);
    if (!orders.length || orders.some((o) => !o.delivered)) return unraised;
    const last = orders.reduce((max, o) => {
      const at = String(o.received || o.date || o.paid || '').slice(0, 10);
      return at > max ? at : max;
    }, '');
    return unraised.filter((d) => String(d.addedAt).slice(0, 10) > last);
  }

  /**
   * The one line under a client's name: the furthest thing along that is still open.
   * Worked out each time from orders and designs, never a stored status, which is a
   * field nobody would keep true.
   */
  function stateLine(doc, today) {
    const open = (doc.orders || []).filter((o) => !o.delivered);
    const next = open.filter((o) => o.deliveryDate && o.deliveryDate >= today)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))[0];
    if (next) return `${next.pickup ? 'Collecting' : 'Delivery'} ${shortDay(next.deliveryDate)}`;
    if (open.some((o) => canAddDelivery(o) && !o.deliveryDate)) return 'No delivery yet';
    const draft = open.find((o) => invoiceStage(o) === 'draft');
    if (draft) return `Draft ${draft.invoice || ''}`.trim();
    if (open.length) return open[0].invoice || 'In progress';
    const unraised = openDesigns(doc);
    if (unraised.length) return `${unraised.length} design${unraised.length === 1 ? '' : 's'}`;
    return '';
  }

  /** Where they are, in a few words, to tell two people of the same name apart. */
  function placeHint(doc) {
    const first = String(doc.client.address || '').split(/\n|,/).map((x) => x.trim()).filter(Boolean)[0] || '';
    return first.slice(0, 32);
  }

  function indexRow(doc, today) {
    const live = (doc.designs || []).filter((d) => !d.archived);
    const newest = live.slice().sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))[0];
    return {
      id: doc.client.id,
      name: doc.client.name,
      at: doc.client.lastActivity || doc.client.createdAt || null,
      line: stateLine(doc, today) || placeHint(doc),
      thumb: newest ? newest.code : null,
      find: searchTextFor(doc)
    };
  }

  return {
    DELIVERY_DAYS, deliveryDaysFrom, nameResembles, chatHref, digits, phoneKey, searchTextFor, matches,
    parseIdentity, chatsMatching, invoiceStage, canAddDelivery, stateLine, indexRow, openDesigns, designCodesIn, parseReply
  };
}));

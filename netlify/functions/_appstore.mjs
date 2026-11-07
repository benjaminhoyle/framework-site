// The staff app's store over Airtable. Airtable holds every business fact; the only
// thing kept anywhere else is the list of clients for search, in Blobs, and that can be
// deleted at any time and rebuilt from here (see `index`).
//
// What it writes, and why that does not break the one-writer rule in docs/order-sync.md:
//   Base - Clients      who a client is. Already a carve-out from that rule.
//   Clients - Designs   new, only this and the chat sync write it.
//   Staff: new. Marketing - Newsletters: its Sent in Messages link, for promotions.
//   Orders - Pipeline   ONLY the delivery fields, which Airtable owns after the sync has
//                       seeded them. Orders, money and line items stay the reconciler's.
// Zoho is reached only through zoho-push's own `push`, so invoices cannot be raised two ways.
//
// Never delete: a design is archived, a client is never removed from here.

import rules from '../../js/app/rules.js';

export const T = {
  clients: 'tblXu0CYFzDsJSOAt',
  orders: 'tblytDBTVFWFyP2qc',
  messages: 'tblRVeTjLV1xdcDfy',
  lines: 'tbldzNLAqG6d98eir',
  // By name until scripts/add-app-tables.mjs has made them; it prints the ids to put here.
  designs: 'Clients - Designs',
  // Marketing - Newsletters, reused: a promotion is a thing sent to some chats, which is what its
  // `Sent in Messages` link has always held.
  promotions: 'tblp4OVP8F4PUrMyb',
  staff: 'Staff',
  chatPairs: 'tblGOEV38QtW9rfM4'
};

const NOT_CUSTOMERS = new Set(['Not Lead', 'Collaboration', 'Duplicate Thread', 'Free Gift']);

const INDEX_MS = 30 * 60e3;
const CHATS_MS = 30 * 60e3;

const threadOf = (url) => { const m = /selected_item_id=(\d+)/.exec(String(url || '')); return m ? m[1] : null; };
const one = (v) => (Array.isArray(v) ? v[0] : v);
const platformOf = (url) => {
  const s = String(url || '');
  if (/WEC_MESSAGE/.test(s)) return 'WhatsApp';
  if (/IG_MESSAGE/.test(s)) return 'Instagram';
  if (/FB_MESSAGE/.test(s)) return 'Messenger';
  return '';
};

export const mapClient = (r) => {
  const f = r.fields;
  return {
    id: r.id,
    name: String(f.Name || '').trim(),
    phone: f['Primary Phone Number'] || '',
    address: String(f.Address || '').trimEnd(),
    pin: f['KRA PIN'] || '',
    vatExempt: f['VAT Exempt'] === true,
    notes: f.Notes || '',
    company: f.Company || '',
    place: f['Address Pin'] || '',
    zohoContactId: f['Zoho Contact ID'] || null,
    chatIds: f.Chats || [],
    orderIds: f.Orders || [],
    lastActivity: f['Last Activity'] || r.createdTime,
    createdAt: r.createdTime
  };
};

const CLIENT_WRITE = { name: 'Name', phone: 'Primary Phone Number', address: 'Address', pin: 'KRA PIN', notes: 'Notes', company: 'Company', place: 'Address Pin' };

export const mapChat = (r) => {
  const f = r.fields;
  return {
    id: r.id,
    threadId: threadOf(f['Chat Link']),
    pageId: one(f['Base - Clients']) || null,
    key: f.Key || null,
    name: f['Reference Name (can be messy)'] || f.Name || '',
    platform: platformOf(f['Chat Link']),
    url: f['Chat Link'] || null,
    status: f.Status || null,
    followUp: f['Follow Up Status'] || null,
    contactAfter: f['Contact After'] || null,
    lastContact: f['Last Contact'] || null,
    lastClient: f['Last Client Message'] || null,
    awaiting: f['Awaiting Reply'] || null,
    note: f['Status/Correspondence Note'] || '',
    phone: String(f['Chat Phones'] || '').split(',')[0].trim(),
    phones: String(f['Chat Phones'] || '').split(',').map((p) => p.trim()).filter(Boolean),
    pageId: one(f['Base - Clients']) || null,
    orderIds: f.Orders || []
  };
};

export const mapDesign = (r) => {
  const f = r.fields;
  let pieces = [];
  try { pieces = JSON.parse(f.Pieces || '[]'); } catch { /* a hand-edited cell is not worth failing a page over */ }
  return {
    id: r.id,
    clientId: one(f.Client) || null,
    chatId: f['Chat ID'] || one(f.Chat) || null,
    code: f.Code || '',
    w: f.W ?? null, d: f.D ?? null, h: f.H ?? null,
    finish: f.Finish || null,
    total: f.Total ?? null,
    pieces,
    source: f.Source || null,
    addedAt: f['Added At'] || r.createdTime,
    addedBy: f['Added By'] || '',
    sentAt: f['Sent At'] || null,
    invoice: f.Invoice || null,
    orderId: one(f.Order) || null,
    archived: f.Archived === true,
    invoiceStatus: f['Invoice Status'] || null,
    deliveryDay: f['Delivery Day'] || null,
    pickup: f['Draft Pickup'] === true
  };
};

/** Zoho's word for where an invoice is, as far as Airtable can say. Drafts have no order. */
function stageWord(f) {
  if (f['Payment Received'] && Number(f['Balance to Pay'] || 0) === 0) return 'paid';
  if (f['Payment Received']) return 'partially_paid';
  return 'approved';
}

export const mapOrder = (r, items = []) => {
  const f = r.fields;
  return {
    id: r.id,
    code: f['Order Code'] ?? null,
    clientId: one(f['Client Name']) || null,
    invoice: f['Zoho Invoice'] || null,
    zohoStatus: stageWord(f),
    orderStatus: f['Order Status'] || null,
    total: f['Total Revenue'] ?? null,
    balance: f['Balance to Pay'] ?? null,
    paid: f['Payment Received'] || null,
    received: f['Order Received'] || null,
    delivered: f['Order Status'] === 'Delivered',
    deliveryDate: f['Delivery - Scheduled Date'] || null,
    dateSet: f['Delivery - Date Set'] === true,
    winS: f['Delivery Window Start'] != null ? Math.round(f['Delivery Window Start'] / 60) : null,
    winE: f['Delivery Window End'] != null ? Math.round(f['Delivery Window End'] / 60) : null,
    pickup: f['Client Pickup'] === true,
    feeCharged: f['Delivery - Charged Client (ex VAT)'] ?? null,
    phone: one(f['Primary Phone Number']) || '',
    project: f['Project Name'] || '',
    items
  };
};

const lineItem = (r) => {
  const f = r.fields;
  const color = f.Color === 'Other' ? f['Other Color Name'] : f.Color;
  // `Line ID` reads "2 x Deep Spacer in Sage"; the name alone is what is drawn here.
  const name = String(f['Line ID'] || '').replace(/^\S+ x /, '').replace(/ in [^ ]+$/, '');
  return { qty: f.Quantity || 0, name, color, orderId: one(f.Order) };
};

const idsFormula = (ids) => (ids.length === 1 ? `RECORD_ID()='${ids[0]}'` : `OR(${ids.map((i) => `RECORD_ID()='${i}'`).join(',')})`);

/**
 * `at` is the _airtable.mjs slice ({ all, patch, create, query }), `blob` a Netlify Blobs
 * store for the index, `designLookup(code)` reads the design blob, `push(args)` is
 * zoho-push's own push. All passed in so the tests can run this over a fake.
 */
export function airtableStore({ at, blob, designLookup, recolor, push, submit, rename, draftOf, setDraftDay, places, log, now = () => Date.now() }) {
  const stampOf = () => new Date(now()).toISOString();

  async function byIds(table, ids, map) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 40) {
      const rows = await at.query(table, { filterByFormula: idsFormula(ids.slice(i, i + 40)) });
      out.push(...rows.map(map));
    }
    return out;
  }

  const touch = (clientId) => at.patch(T.clients, [{ id: clientId, fields: { 'Last Activity': stampOf() } }]);

  async function client(id) {
    const rows = await at.query(T.clients, { filterByFormula: `RECORD_ID()='${String(id).replace(/[^A-Za-z0-9]/g, '')}'` });
    return rows.length ? mapClient(rows[0]) : null;
  }

  async function designsFor(c) {
    // A link can only be filtered by its text, so each row also holds the record id as plain text.
    const rows = await at.query(T.designs, { filterByFormula: `{Client ID}='${c.id}'` });
    return rows.map(mapDesign);
  }

  return {
    client,
    designsFor,
    async chatsFor(c) { return byIds(T.messages, c.chatIds, mapChat); },

    async ordersFor(c) {
      const rows = await byIds(T.orders, c.orderIds, (r) => r);
      const lineIds = rows.flatMap((r) => r.fields['Line Items'] || []);
      const lines = await byIds(T.lines, lineIds, lineItem);
      const orders = rows.map((r) => mapOrder(r, lines.filter((l) => l.orderId === r.id)));
      // A draft has no order row yet; it is known only from the designs it was raised from.
      const designs = await designsFor(c);
      const known = new Set(orders.map((o) => o.invoice));
      const drafts = new Map();
      for (const d of designs) {
        if (d.invoice && !d.orderId && !known.has(d.invoice)) {
          const had = drafts.get(d.invoice) || {
            id: `draft-${d.invoice}`, clientId: c.id, invoice: d.invoice, zohoStatus: d.invoiceStatus ? 'pending_approval' : 'draft', total: 0,
            delivered: false, deliveryDate: d.deliveryDay, pickup: d.pickup, items: [], codes: []
          };
          had.total += d.total || 0;
          had.items.push(...(d.pieces || []).map((p) => ({ qty: p.qty, name: p.name, color: d.finish })));
          had.codes.push(d.code);
          drafts.set(d.invoice, had);
        }
      }
      return [...drafts.values(), ...orders];
    },

    async offersFor(c) {
      if (!c.chatIds.length) return [];
      const rows = await at.all(T.promotions);
      return rows.filter((r) => (r.fields['Sent in Messages'] || []).some((id) => c.chatIds.includes(id)))
        .map((r) => ({ id: r.id, name: r.fields.Name || '', terms: r.fields.Description || '', ends: r.fields.Ends || null }));
    },

    /** Chats with no page, newest first, with what has been sent in each, for making a page later. */
    async recentChats() {
      const chats = (await this.allChats()).filter((x) => !x.pageId && !NOT_CUSTOMERS.has(x.status) && x.threadId)
        .sort((a, b) => String(b.lastContact || '').localeCompare(String(a.lastContact || ''))).slice(0, 60);
      const sent = (await at.query(T.designs, { filterByFormula: "{Client ID}=''" })).map(mapDesign);
      return chats.map((x) => {
        const mine = sent.filter((d) => d.chatId === x.id);
        return { id: x.id, name: x.name, platform: x.platform, phone: x.phone, lastContact: x.lastContact, designs: mine.length, thumb: mine.length ? mine[mine.length - 1].code : null };
      });
    },

    async adoptDesigns(c, chatId) {
      const rows = await at.query(T.designs, { filterByFormula: `{Chat ID}='${chatId}'` });
      const loose = rows.filter((r) => !r.fields['Client ID']);
      if (loose.length) await at.patch(T.designs, loose.map((r) => ({ id: r.id, fields: { Client: [c.id], 'Client ID': c.id } })));
    },

    async placeSearch(q) { return places.search(q); },
    async placeDetail(id) { return places.detail(id); },

    /** Asked only when making a page. Kept half an hour in Blobs: 1,000 chats is eleven calls. */
    async allChats() {
      const kept = blob ? await blob.get('chats', { type: 'json' }).catch(() => null) : null;
      if (kept && now() - kept.at < CHATS_MS) return kept.rows;
      const rows = (await at.all(T.messages)).map(mapChat);
      if (blob) await blob.setJSON('chats', { at: now(), rows }).catch(() => {});
      return rows;
    },

    async clientForChat(chatId) {
      // Airtable makes the reverse link on the chat's row when Chats is created. A page made in
      // the last half hour isn't in the kept list yet, so the chat itself is asked.
      const [chat] = await at.query(T.messages, { filterByFormula: `RECORD_ID()='${chatId}'` });
      const pageId = chat && one(chat.fields['Base - Clients']);
      return pageId ? client(pageId) : null;
    },

    async createClient({ name, phone, chatIds }) {
      if (blob) await blob.delete('chats').catch(() => {});
      const fields = { Name: name, 'Last Activity': stampOf() };
      if (phone) fields['Primary Phone Number'] = phone;
      if (chatIds && chatIds.length) fields.Chats = chatIds;
      const [row] = await at.create(T.clients, [{ fields }]);
      return mapClient(row);
    },

    async patchClient(id, patch) {
      const fields = { 'Last Activity': stampOf() };
      for (const [k, v] of Object.entries(patch)) if (CLIENT_WRITE[k]) fields[CLIENT_WRITE[k]] = v;
      await at.patch(T.clients, [{ id, fields }]);
    },

    async lookupDesign(code) { return designLookup(code); },

    async addDesign(c, d) {
      const [row] = await at.create(T.designs, [{ fields: {
        Code: d.code, Client: [c.id], 'Client ID': c.id, W: d.w ?? null, D: d.d ?? null, H: d.h ?? null,
        Finish: d.finish || null, Total: d.total ?? null, Pieces: JSON.stringify(d.pieces || []),
        // The design's own hash, so the shelf survives anything that happens to the blob store.
        'Design Hash': d.hash || '',
        Source: d.source, 'Added At': stampOf(), 'Added By': d.addedBy || ''
      } }]);
      await touch(c.id);
      return mapDesign(row);
    },

    async patchDesign(id, { archived }) {
      const [row] = await at.patch(T.designs, [{ id, fields: { Archived: archived === true } }]);
      const d = mapDesign(row);
      if (d.clientId) await touch(d.clientId);
      return d;
    },

    async order(id) {
      if (String(id).startsWith('draft-')) {
        const invoice = String(id).slice(6).replace(/[^A-Z0-9]/g, '');
        const rows = (await at.query(T.designs, { filterByFormula: `{Invoice}='${invoice}'` })).map(mapDesign);
        if (!rows.length) return null;
        return { id, invoice, clientId: rows[0].clientId, zohoStatus: rows[0].invoiceStatus ? 'pending_approval' : 'draft', total: rows.reduce((n, d) => n + (d.total || 0), 0), deliveryDate: rows[0].deliveryDay, pickup: rows[0].pickup };
      }
      const rows = await at.query(T.orders, { filterByFormula: `RECORD_ID()='${String(id).replace(/[^A-Za-z0-9]/g, '')}'` });
      return rows.length ? mapOrder(rows[0]) : null;
    },

    /**
     * The delivery fields only. `Delivery - Date Set` stays off until a time is agreed,
     * so the driver's message keeps saying the date is not firm.
     */
    async setDelivery(o, { pickup, deliveryDate, winS, winE, clientState }) {
      // A draft has no order yet. Its day goes on the Zoho draft, which the sync carries to the order,
      // and on its design rows, so the page and the planner can show it meanwhile.
      if (String(o.id).startsWith('draft-')) {
        await setDraftDay(o.invoice, deliveryDate || null, pickup === true);
        const rows = await at.query(T.designs, { filterByFormula: `{Invoice}='${String(o.invoice).replace(/[^A-Z0-9]/g, '')}'` });
        await at.patch(T.designs, rows.map((r) => ({ id: r.id, fields: { 'Delivery Day': deliveryDate || null, 'Draft Pickup': pickup === true } })));
        await touch(o.clientId);
        return;
      }
      const fields = {};
      if (pickup !== undefined) fields['Client Pickup'] = pickup === true;
      if (deliveryDate !== undefined) fields['Delivery - Scheduled Date'] = deliveryDate || null;
      if (winS !== undefined) {
        fields['Delivery Window Start'] = winS != null ? winS * 60 : null;
        fields['Delivery Window End'] = winE != null ? winE * 60 : null;
      }
      if (clientState) fields['Delivery - Date Set'] = clientState === 'yes';
      await at.patch(T.orders, [{ id: o.id, fields }]);
      await touch(o.clientId);
    },

    async raiseInvoice({ client: c, designs, rep, options, revise }) {
      const [first, ...rest] = String(c.name).trim().split(/\s+/).reduce((acc, w, i, all) => {
        if (i === all.length - 1 && all.length > 1) acc[1] = w; else acc[0] = acc[0] ? `${acc[0]} ${w}` : w;
        return acc;
      }, ['', '']);
      const out = await push({
        codes: designs.map((d) => d.code),
        revise: revise || undefined,
        contact_id: c.zohoContactId || undefined,
        new_client: c.zohoContactId ? undefined : {
          first_name: first, last_name: rest[0] || '', company: options.invoiceTo === 'company' ? c.company : undefined
        },
        airtable_client_id: c.id,
        rep,
        phone: c.phone,
        address: c.address,
        kra_pin: c.pin,
        pickup: options.pickup,
        delivery_fee: options.delivery_fee,
        vat_exempt: options.vat_exempt === true,
        notes: options.notes
      });
      // Raised earlier and the page never heard, because a timeout came between the two. Zoho has
      // it, so the page takes it up rather than asking again or raising a second one.
      const taken = !out.ok && out.error === 'already_raised' && out.invoice_number;
      if (!out.ok && !taken) return out;
      const number = out.invoice_number;
      const onIt = new Set(designs.map((d) => d.id));
      const rows = (await designsFor(c)).filter((d) => d.invoice === number && !onIt.has(d.id));
      await at.patch(T.designs, [
        ...designs.map((d) => ({ id: d.id, fields: { Invoice: number } })),
        ...rows.map((d) => ({ id: d.id, fields: { Invoice: null } }))
      ]);
      await touch(c.id);
      return taken ? { ok: true, invoice_number: number, taken_up: true } : out;
    },

    async index(today) {
      const cached = blob ? await blob.get('index', { type: 'json' }).catch(() => null) : null;
      if (cached && now() - cached.at < INDEX_MS) return cached.rows;
      // One after another: four tables at once is how a 5-a-second base starts refusing.
      const clients = await at.all(T.clients);
      const chats = await at.query(T.messages, { filterByFormula: "{Base - Clients}!=''" });
      const designs = await at.all(T.designs);
      const orders = await at.all(T.orders);
      const chatMap = new Map(chats.map((r) => [r.id, mapChat(r)]));
      const byClient = new Map();
      for (const r of designs) {
        const d = mapDesign(r);
        if (!byClient.has(d.clientId)) byClient.set(d.clientId, []);
        byClient.get(d.clientId).push(d);
      }
      const ordersBy = new Map();
      for (const r of orders) {
        const o = mapOrder(r);
        if (!ordersBy.has(o.clientId)) ordersBy.set(o.clientId, []);
        ordersBy.get(o.clientId).push(o);
      }
      const rows = clients.map(mapClient).map((c) => rules.indexRow({
        client: c,
        chats: c.chatIds.map((i) => chatMap.get(i)).filter(Boolean),
        designs: byClient.get(c.id) || [],
        orders: ordersBy.get(c.id) || []
      }, today));
      if (blob) await blob.setJSON('index', { at: now(), rows }).catch(() => {});
      return rows;
    },

    /** Just the name and time, after a saved field, which answers with the client alone. */
    async touchIndex(id, fields) {
      if (!blob) return;
      const cached = await blob.get('index', { type: 'json' }).catch(() => null);
      const row = cached && cached.rows.find((r) => r.id === id);
      if (!row) return;
      Object.assign(row, fields);
      await blob.setJSON('index', cached).catch(() => {});
    },

    /** One client's row, after a write, so the next person's list is right without a rebuild. */
    async patchIndex(row) {
      if (!blob) return;
      const cached = await blob.get('index', { type: 'json' }).catch(() => null);
      if (!cached) return;
      const i = cached.rows.findIndex((r) => r.id === row.id);
      if (i >= 0) cached.rows[i] = row; else cached.rows.unshift(row);
      await blob.setJSON('index', cached).catch(() => {});
    },

    async commonDesigns() {
      const kept = blob ? await blob.get('common', { type: 'json' }).catch(() => null) : null;
      return kept || [];
    },

    async promotions() {
      const rows = await at.all(T.promotions);
      const chats = await this.allChats();
      const byId = new Map(chats.map((x) => [x.id, x]));
      return rows.map((r) => ({
        id: r.id, name: r.fields.Name || '', terms: r.fields.Description || '', ends: r.fields.Ends || null,
        sentTo: (r.fields['Sent in Messages'] || []).map((id) => {
          const chat = byId.get(id);
          return { id: chat ? chat.pageId : null, name: chat ? chat.name : '' };
        })
      }));
    },
    async addPromotion({ name, terms, ends, on }) {
      const [r] = await at.create(T.promotions, [{ fields: { Name: name, Description: terms, Ends: ends, Created: on } }]);
      return { id: r.id, name, terms, ends };
    },
    async addOffer(c, promotionId) {
      const rows = await at.all(T.promotions);
      const promo = rows.find((r) => r.id === promotionId);
      if (promo) await at.patch(T.promotions, [{ id: promo.id, fields: { 'Sent in Messages': [...new Set([...(promo.fields['Sent in Messages'] || []), c.chatIds[0]])] } }]);
      await touch(c.id);
    },

    async renameContact(c, name) { return rename(c.zohoContactId, name); },
    async draftDetail(o) { return draftOf(o.invoice); },

    async linkChat(c, chatId) {
      await at.patch(T.clients, [{ id: c.id, fields: { Chats: [...new Set([...c.chatIds, chatId])], 'Last Activity': stampOf() } }]);
      // A person saying these are one person is what the chat pipeline's own list holds too.
      if (c.chatIds.length) await at.create(T.chatPairs, [{ fields: { 'Duplicate Threads': [c.chatIds[0], chatId], Type: 'Same person, different chat' } }]);
      if (blob) await blob.delete('chats').catch(() => {});
    },

    async recolor(code, finish) { return recolor(code, finish); },

    /** Submits the Zoho draft for approval. The sync then makes the order, and approval stays with Ben. */
    async submitDraft(o, { amount }) {
      await submit(o.invoice);
      const rows = await at.query(T.designs, { filterByFormula: `{Invoice}='${String(o.invoice).replace(/[^A-Z0-9]/g, '')}'` });
      await at.patch(T.designs, rows.map((r) => ({ id: r.id, fields: { 'Invoice Status': 'Awaiting approval', 'Client Said Paid': amount } })));
      if (o.clientId) await touch(o.clientId);
    },

    async openOrders() {
      const rows = (await at.query(T.orders, { filterByFormula: "NOT({Order Status}='Delivered')" })).map((r) => mapOrder(r));
      const days = (await at.query(T.designs, { filterByFormula: "{Delivery Day}!=''" })).map(mapDesign).filter((d) => d.invoice && !d.orderId);
      const known = new Set(rows.map((o) => o.invoice));
      const drafts = new Map();
      for (const d of days) {
        if (known.has(d.invoice)) continue;
        const had = drafts.get(d.invoice) || { id: `draft-${d.invoice}`, clientId: d.clientId, invoice: d.invoice, zohoStatus: 'draft', deliveryDate: d.deliveryDay, pickup: d.pickup, items: [], codes: [] };
        had.codes.push(d.code);
        had.items.push(...d.pieces.map((p) => ({ qty: p.qty, name: p.name, color: d.finish })));
        drafts.set(d.invoice, had);
      }
      const clients = new Map((await at.all(T.clients)).map(mapClient).map((c) => [c.id, c]));
      return [...rows, ...drafts.values()].map((o) => {
        const c = clients.get(o.clientId) || {};
        return { ...o, clientName: c.name || '', address: c.address || '', place: c.place || '' };
      });
    },

    async staff() {
      return (await at.all(T.staff)).map((r) => ({
        id: r.id, email: String(r.fields.Email || '').toLowerCase(), name: r.fields.Name || '',
        modules: r.fields.Modules || [], active: r.fields.Active === true
      }));
    },
    async addStaff({ email, name, modules }) {
      const [r] = await at.create(T.staff, [{ fields: { Email: email, Name: name, Modules: modules, Active: true } }]);
      return { id: r.id };
    },
    async patchStaff(id, patch) {
      const fields = {};
      if (patch.modules) fields.Modules = patch.modules;
      if (patch.active !== undefined) fields.Active = patch.active;
      if (patch.name !== undefined) fields.Name = patch.name;
      await at.patch(T.staff, [{ id, fields }]);
    },

    /** Who did what, with the before and after, in the one log (_log.mjs). */
    async log({ who, action, target, detail }) { if (log) await log({ who, action, target, detail }); }
  };
}

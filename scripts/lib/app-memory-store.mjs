// The staff app's store, in memory, over a plain object. The dev server, the tests and
// the single-file demo run on this. It answers the same questions as the Airtable
// store (netlify/functions/_appstore.mjs) and scripts/test-app.mjs holds both to the
// same behaviours.
//
// Built by hand-free fixture: `db` comes from out/app-mock/fixtures.json, which holds
// real client data and is in no repo.

import rules from '../../js/app/rules.js';

export function memoryStore(db, { lookupDesign, recolorDesign } = {}) {
  let n = 1;
  const nid = (p) => `${p}mem${Date.now().toString(36)}${n++}`;
  const stamp = () => new Date().toISOString();
  db.clients = db.clients || [];
  db.chats = db.chats || [];
  db.designs = db.designs || [];
  db.orders = db.orders || [];
  db.promotions = db.promotions || [];
  db.staff = db.staff || [];
  db.common = db.common || [];
  db.logs = db.logs || [];

  const byId = (list, id) => list.find((x) => x.id === id) || null;
  const touch = (clientId) => { const c = byId(db.clients, clientId); if (c) c.lastActivity = stamp(); };

  const offersOf = (c) => db.promotions.filter((p) => (p.sentChatIds || []).some((id) => (c.chatIds || []).includes(id)))
    .map(({ id, name, terms, ends }) => ({ id, name, terms, ends }));

  const NOT_CUSTOMERS = new Set(['Not Lead', 'Collaboration', 'Duplicate Thread', 'Free Gift']);

  const docOf = (c) => ({
    client: c,
    chats: db.chats.filter((x) => (c.chatIds || []).includes(x.id)),
    designs: db.designs.filter((x) => x.clientId === c.id),
    orders: db.orders.filter((x) => x.clientId === c.id),
    offers: offersOf(c)
  });

  return {
    async index(today) { return db.clients.map((c) => rules.indexRow(docOf(c), today)); },
    async client(id) {
      const row = byId(db.clients, id);
      if (!row) return null;
      // Orders that exist, not drafts: what the name lock reads, as Airtable's Orders link would be.
      row.orderIds = db.orders.filter((o) => o.clientId === id && o.zohoStatus !== 'draft').map((o) => o.id);
      return row;
    },
    async chatsFor(c) { return docOf(c).chats; },
    async designsFor(c) { return docOf(c).designs; },
    async ordersFor(c) { return docOf(c).orders; },
    async offersFor(c) { return offersOf(c); },
    async allChats() { return db.chats; },
    async clientForChat(chatId) { return db.clients.find((c) => (c.chatIds || []).includes(chatId)) || null; },
    async createClient({ name, phone, chatIds }) {
      const row = { id: nid('rec'), name, phone: phone || '', address: '', pin: '', notes: '', company: '', place: '', chatIds: chatIds || [], createdAt: stamp(), lastActivity: stamp() };
      db.clients.push(row);
      return row;
    },
    async patchClient(id, patch) { const c = byId(db.clients, id); Object.assign(c, patch); c.lastActivity = stamp(); return c; },
    async lookupDesign(code) {
      const known = db.designs.find((d) => d.code === code) || (db.designIndex || {})[code];
      if (known) return { w: known.w, d: known.d, h: known.h, finish: known.finish, total: known.total, pieces: known.pieces };
      return lookupDesign ? lookupDesign(code) : null;
    },
    async adoptDesigns(c, chatId) {
      for (const d of db.designs) if (!d.clientId && d.chatId === chatId) d.clientId = c.id;
    },
    async recentChats() {
      const owned = new Set(db.clients.flatMap((c) => c.chatIds || []));
      return db.chats.filter((x) => !owned.has(x.id) && !NOT_CUSTOMERS.has(x.status) && x.threadId)
        .sort((a, b) => String(b.lastContact || '').localeCompare(String(a.lastContact || ''))).slice(0, 60)
        .map((x) => {
          const sent = db.designs.filter((d) => !d.clientId && d.chatId === x.id);
          return { id: x.id, name: x.name, platform: x.platform, phone: x.phone, lastContact: x.lastContact, designs: sent.length, thumb: sent.length ? sent[sent.length - 1].code : null };
        });
    },
    async placeSearch(q) {
      const want = rules.nameResembles;
      return (db.places || []).filter((x) => want(x.text, q)).slice(0, 5).map(({ id, text }) => ({ id, text }));
    },
    async placeDetail(id) {
      const x = byId(db.places || [], id);
      return x ? { text: x.text, pin: x.pin } : null;
    },
    async addDesign(c, fields) {
      const row = { id: nid('des'), clientId: c.id, addedAt: stamp(), archived: false, ...fields };
      db.designs.push(row);
      touch(c.id);
      return row;
    },
    async patchDesign(id, patch) {
      const d = byId(db.designs, id);
      if (!d) return null;
      Object.assign(d, patch);
      if (d.clientId) touch(d.clientId);
      return d;
    },
    async order(id) { return byId(db.orders, id); },
    async setDelivery(o, fields) { Object.assign(o, fields); touch(o.clientId); return o; },
    async raiseInvoice({ client, designs, rep, options, revise }) {
      const wasDraft = revise ? db.orders.find((o) => o.invoice === revise && o.clientId === client.id) : null;
      const kept = wasDraft && options.delivery_fee === undefined ? ((wasDraft.items || []).find((x) => x.fee) || {}).fee || 0 : null;
      const pickup = options.pickup === undefined && wasDraft ? !!wasDraft.pickup : options.pickup === true;
      const fee = pickup ? 0 : (kept !== null ? kept : (Number(String(options.delivery_fee || '').replace(/\D/g, '')) || 0));
      const total = designs.reduce((sum, d) => sum + (d.total || 0), 0) + fee;
      const items = designs.flatMap((d) => (d.pieces || []).map((p) => ({ qty: p.qty, name: p.name, color: d.finish })));
      if (fee) items.push({ qty: 1, name: 'Delivery', color: null, fee });
      let order = revise ? db.orders.find((o) => o.invoice === revise && o.clientId === client.id) : null;
      let was = null;
      if (revise && (!order || order.zohoStatus !== 'draft')) return { ok: false, error: 'not_a_draft', httpStatus: 409 };
      if (order) {
        was = { total: order.total, codes: order.codes };
        for (const d of db.designs) if (d.clientId === client.id && d.invoice === revise) d.invoice = null;
        Object.assign(order, { total, balance: total, items, codes: designs.map((d) => d.code), pickup, revisions: (order.revisions || 0) + 1 });
      } else {
        db.nextInvoice = (db.nextInvoice || 640500) + 1;
        order = {
          id: nid('ord'), clientId: client.id, invoice: `INV${db.nextInvoice}`, zohoStatus: 'draft', total, balance: total, paid: null,
          delivered: false, date: stamp().slice(0, 10), received: stamp().slice(0, 10), rep, pickup: options.pickup === true, deliveryDate: null,
          items, codes: designs.map((d) => d.code)
        };
        db.orders.push(order);
      }
      for (const d of designs) { const row = db.designs.find((x) => x.id === d.id); if (row) row.invoice = order.invoice; }
      touch(client.id);
      return { ok: true, invoice_number: order.invoice, url: null, total, was };
    },
    async commonDesigns() { return db.common; },
    async promotions() {
      return db.promotions.map((promo) => ({
        ...promo,
        sentTo: (promo.sentChatIds || []).map((id) => {
          const owner = db.clients.find((c) => (c.chatIds || []).includes(id));
          const chat = byId(db.chats, id);
          return { id: owner ? owner.id : null, name: owner ? owner.name : (chat ? chat.name : '') };
        })
      }));
    },
    async addPromotion({ name, terms, ends }) { const row = { id: nid('pro'), name, terms, ends, sentChatIds: [] }; db.promotions.push(row); return row; },
    async addOffer(c, promotionId) {
      const promo = byId(db.promotions, promotionId);
      if (promo) promo.sentChatIds = [...new Set([...(promo.sentChatIds || []), c.chatIds[0]])];
      touch(c.id);
    },
    async renameContact() { return { ok: true }; },
    async draftDetail(o) {
      const fee = ((o.items || []).find((x) => x.fee) || {}).fee ?? null;
      return {
        fee, pickup: !!o.pickup, total: o.total,
        lines: (o.items || []).filter((x) => !x.fee).map((x) => ({ name: x.name, qty: x.qty, color: x.color || null, amount: null }))
      };
    },
    async linkChat(c, chatId) {
      if ((c.chatIds || []).length) (db.chatPairs = db.chatPairs || []).push([c.chatIds[0], chatId]);
      c.chatIds = [...new Set([...(c.chatIds || []), chatId])];
      touch(c.id);
    },
    async recolor(code, finish) {
      const to = ((db.variants || {})[code] || {})[finish];
      if (to) return { code: to, ...((db.designIndex || {})[to] || {}), finish };
      return recolorDesign ? recolorDesign(code, finish) : null;
    },
    async submitDraft(o, { amount, on }) {
      o.zohoStatus = 'pending_approval';
      if (amount) { o.paid = on; o.balance = Math.max(0, Math.round((o.total || 0) - amount)); }
      touch(o.clientId);
      return o;
    },
    async openOrders() {
      // A draft only counts once someone has given it a day: most are quotes that may never come back.
      return db.orders.filter((o) => !o.delivered && (o.zohoStatus !== 'draft' || o.deliveryDate)).map((o) => {
        const c = byId(db.clients, o.clientId) || {};
        return { ...o, clientName: c.name || '', address: c.address || '', place: c.place || '' };
      });
    },
    async staff() { return db.staff; },
    async addStaff(p) { const row = { id: nid('stf'), active: true, ...p }; db.staff.push(row); return row; },
    async patchStaff(id, patch) { Object.assign(byId(db.staff, id), patch); return byId(db.staff, id); },
    async log(entry) { db.logs.push({ at: stamp(), ...entry }); }
  };
}

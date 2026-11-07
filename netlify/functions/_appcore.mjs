// The staff app's server rules, with no I/O: who may do what, and what each request
// does. Two things run this one file: the live function (app-api.mjs over Airtable)
// and the dev server and tests (over the memory store). So what is tested here is
// what the site does.
//
// `store` is the only way out to data. Every business fact lives in Airtable or Zoho;
// this file holds none and caches none.

import rules from '../../js/app/rules.js';

const { parseIdentity, chatsMatching, canAddDelivery, designCodesIn } = rules;

/** One row per code on a page, whatever the store holds: the same design added twice is one design. */
export function dedupeDesigns(rows) {
  const seen = new Map();
  for (const r of rows) {
    const had = seen.get(r.code);
    if (!had) { seen.set(r.code, r); continue; }
    const keep = String(r.addedAt) < String(had.addedAt) ? r : had;
    const other = keep === r ? had : r;
    seen.set(r.code, {
      ...keep,
      sentAt: keep.sentAt || other.sentAt || null,
      invoice: keep.invoice || other.invoice || null,
      orderId: keep.orderId || other.orderId || null
    });
  }
  return [...seen.values()];
}

/** A code, from a bare code, a link, or a whole pasted builder message. */
export const designCodeFrom = (input) => designCodesIn(input)[0] || null;

/** The fields a staff member may set on a client, and how each is cleaned. */
const CLIENT_FIELDS = {
  name: (v) => String(v || '').trim().slice(0, 120),
  phone: (v) => String(v || '').trim().slice(0, 40),
  address: (v) => String(v || '').trim().slice(0, 500),
  pin: (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
  notes: (v) => String(v || '').slice(0, 2000),
  company: (v) => String(v || '').trim().slice(0, 120),
  // "lat,lng" from the address box. Anything else clears it: an address retyped by hand has no pin.
  place: (v) => { const m = /^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/.exec(String(v || '').trim()); return m ? `${m[1]},${m[2]}` : ''; }
};

export function cleanClientPatch(body) {
  const out = {};
  for (const [k, clean] of Object.entries(CLIENT_FIELDS)) {
    if (body && body[k] !== undefined) out[k] = clean(body[k]);
  }
  if (out.name === '') delete out.name; // A page always has a name to be found by.
  return out;
}

/**
 * A name is free to change until there is an order, because `Order ID` is built from it. A draft's
 * contact can still follow: a client who wants the invoice under a company name says so before paying.
 */
export const nameIsLocked = (client) => (client.orderIds || []).length > 0;

/** What is still missing before an invoice can be raised. Delivery detail is not on this list. */
export function invoiceGaps(client) {
  const gaps = [];
  if (!String(client.name || '').trim()) gaps.push('name');
  return gaps;
}

/** Anyone on the delivery page. What each may do there is the planner's, and it is all logged. */
const RUNS = ['deliveries', 'driver', 'workshop'];
const RUNS_AND_CLIENTS = ['clients', ...RUNS];

const MODULE_FOR = [
  [/^staff/, 'admin'],
  [/^clients\/[^/]+\/invoice$/, 'invoice'],
  [/^orders\/[^/]+\/submit$/, 'invoice'],
  [/^orders\/[^/]+\/draft$/, 'invoice'],
  [/^orders\/[^/]+\/delivery$/, RUNS_AND_CLIENTS],
  [/^deliveries/, RUNS],
  [/^log$/, RUNS],
  [/^/, 'clients']
];

export const moduleFor = (path) => MODULE_FOR.find(([re]) => re.test(path))[1];

const ok = (json) => ({ status: 200, json: { ok: true, ...json } });
const bad = (status, error, extra) => ({ status, json: { ok: false, error, ...extra } });

export async function fullDoc(store, id) {
  const client = await store.client(id);
  if (!client) return null;
  const [chats, designs, orders, offers] = await Promise.all([
    store.chatsFor(client), store.designsFor(client), store.ordersFor(client), store.offersFor(client)
  ]);
  return { client, chats, designs: dedupeDesigns(designs), orders, offers };
}

async function respondWithDoc(store, id) {
  const doc = await fullDoc(store, id);
  return doc ? ok({ doc }) : bad(404, 'not_found');
}

/**
 * One request. `person` is the signed-in staff member, `today` an ISO date in Nairobi.
 * A person can only reach what their modules open; the caller has already established
 * who they are.
 */
export async function handle({ store, person, today, method, path, body = {} }) {
  // One form of the path for the check and the dispatch alike: "/staff", "staff/" and
  // "clients//x/invoice" must not reach a route under a looser module than the route needs.
  const segments = String(path).split('/').filter(Boolean);
  const need = moduleFor(segments.join('/'));
  if (!person || ![need].flat().some((m) => person.modules.includes(m))) return bad(403, 'not_allowed');

  const who = person.name || person.email;
  const logged = (action, target, detail) => store.log({ who, action, target, detail });
  const [head, id, sub] = segments;

  if (head === 'clients') {
    if (!id && method === 'GET') return ok({ rows: await store.index(today) });

    if (!id && method === 'POST') {
      const every = await store.allChats();
      let chat = null;
      let identity = { kind: 'name', text: '' };
      if (body.chatId) {
        // Chosen from the list of recent chats, or from the candidates below.
        chat = every.find((c) => c.id === body.chatId) || null;
        if (!chat) return bad(404, 'no_such_chat');
      } else {
        identity = parseIdentity(body.q);
        if (identity.kind === 'empty') return bad(422, 'empty');
        const chats = chatsMatching(every, identity);
        if (identity.kind !== 'name' && chats.length === 1) chat = chats[0];
        else if (chats.length && body.chatId === undefined) {
          // A name only ever suggests. It takes a person to say which of these it is. null is "none of these".
          const withOwners = await Promise.all(chats.slice(0, 8).map(async (x) => {
            const owner = await store.clientForChat(x.id);
            return { ...x, ownerId: owner ? owner.id : null, ownerName: owner ? owner.name : null };
          }));
          return ok({ choose: withOwners });
        }
      }
      // A link is to a chat, and a page can't be named after a URL. New chats arrive with the next refresh.
      if (!chat && identity.kind === 'thread') return bad(404, 'chat_not_in');
      // Someone already has a page for this chat: go there, never a second page.
      if (chat) {
        const taken = await store.clientForChat(chat.id);
        if (taken) return ok({ id: taken.id, existed: true });
      }
      const name = (chat && chat.name) || identity.text;
      const phone = identity.kind === 'phone' ? identity.text : (chat && chat.phone) || '';
      const made = await store.createClient({ name, phone, chatIds: chat ? [chat.id] : [] }, who);
      // Whatever has already been sent in that chat comes with it.
      if (chat) await store.adoptDesigns(made, chat.id);
      await logged('client.create', made.id, { q: identity.text || null, chat: chat ? chat.id : null });
      const page = await respondWithDoc(store, made.id);
      return { status: 200, json: { ...page.json, id: made.id, existed: false } };
    }

    if (id && !sub && method === 'GET') return respondWithDoc(store, id);

    if (id && !sub && method === 'PATCH') {
      const patch = cleanClientPatch(body);
      if (!Object.keys(patch).length) return bad(422, 'nothing_to_save');
      const before = await store.client(id);
      if (!before) return bad(404, 'not_found');
      if (patch.name !== undefined && patch.name !== before.name) {
        if (nameIsLocked(before)) return bad(409, 'name_locked');
        if (before.zohoContactId) {
          const renamed = await store.renameContact(before, patch.name);
          if (!renamed.ok) return bad(409, 'client_exists');
        }
      }
      await store.patchClient(id, patch);
      await logged('client.edit', id, { before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), after: patch });
      return ok({ client: { ...before, ...patch } });
    }

    // Another chat of the same person. A link or a number only: a name is never enough to join two people.
    if (id && sub === 'chats' && method === 'POST') {
      const identity = parseIdentity(body.q);
      if (identity.kind !== 'thread' && identity.kind !== 'phone') return bad(422, 'link_or_number');
      const found = chatsMatching(await store.allChats(), identity);
      if (found.length !== 1) return bad(404, 'no_such_chat', { count: found.length });
      const taken = await store.clientForChat(found[0].id);
      if (taken && taken.id !== id) return bad(409, 'other_page', { otherId: taken.id, otherName: taken.name });
      const client = await store.client(id);
      await store.linkChat(client, found[0].id);
      await store.adoptDesigns(client, found[0].id);
      await logged('client.link_chat', id, { chat: found[0].id });
      return respondWithDoc(store, id);
    }

    // The same shelf in another colour. Price does not depend on the finish.
    if (id && sub === 'recolor' && method === 'POST') {
      const client = await store.client(id);
      if (!client) return bad(404, 'not_found');
      const made = await store.recolor(String(body.code || ''), String(body.finish || ''));
      if (!made) return bad(404, 'unknown_code');
      const already = (await store.designsFor(client)).find((d) => d.code === made.code);
      if (!already) {
        const row = await store.addDesign(client, { ...made, source: 'recolor', addedBy: who });
        await logged('design.add', row.id, { client: id, code: made.code, from: body.code });
      } else if (already.archived) await store.patchDesign(already.id, { archived: false });
      const page = await respondWithDoc(store, id);
      return { status: 200, json: { ...page.json, code: made.code } };
    }

    if (id && sub === 'designs' && method === 'POST') {
      const code = designCodeFrom(body.code);
      if (!code) return bad(422, 'bad_code');
      const client = await store.client(id);
      if (!client) return bad(404, 'not_found');
      const already = (await store.designsFor(client)).find((d) => d.code === code);
      if (already) {
        if (already.archived) await store.patchDesign(already.id, { archived: false });
        return respondWithDoc(store, id);
      }
      const design = await store.lookupDesign(code);
      if (!design) return bad(404, 'unknown_code');
      const source = ['app', 'quick', 'builder'].includes(body.source) ? body.source : 'app';
      const row = await store.addDesign(client, { ...design, code, source, addedBy: who });
      await logged('design.add', row.id, { client: id, code });
      return respondWithDoc(store, id);
    }

    if (id && sub === 'invoice' && method === 'POST') {
      const client = await store.client(id);
      if (!client) return bad(404, 'not_found');
      const designs = dedupeDesigns(await store.designsFor(client))
        .filter((d) => (body.codes || []).includes(d.code));
      if (!designs.length) return bad(422, 'no_designs');
      const gaps = invoiceGaps(client);
      if (gaps.length) return bad(422, 'details_missing', { gaps });
      // Orders in the past with no Zoho link: the contact exists, and a new one would be a second person.
      if (!client.zohoContactId && (client.orderIds || []).length) return bad(409, 'no_zoho_link');
      const revise = body.revise || null;
      if (revise) {
        const orders = await store.ordersFor(client);
        if (!orders.some((o) => o.invoice === revise && o.zohoStatus === 'draft')) return bad(409, 'not_a_draft');
      }
      const taken = designs.find((d) => (d.invoice && d.invoice !== revise) || (d.orderId && !revise));
      if (taken) return bad(409, 'already_on_invoice', { invoice_number: taken.invoice, code: taken.code });
      const raised = await store.raiseInvoice({ client, designs, rep: who, options: body, revise });
      if (!raised.ok) return { status: raised.httpStatus || 422, json: raised };
      await logged(body.revise ? 'invoice.revise' : 'invoice.draft', id, {
        invoice: raised.invoice_number, codes: designs.map((d) => d.code), total: raised.total, was: raised.was || null
      });
      const page = await respondWithDoc(store, id);
      return { status: 200, json: { ...page.json, raised } };
    }

    // A named promotion sent to this client, recorded against their chat.
    if (id && sub === 'offers' && method === 'POST') {
      const client = await store.client(id);
      if (!client) return bad(404, 'not_found');
      if (!(client.chatIds || []).length) return bad(409, 'no_chat');
      await store.addOffer(client, String(body.promotionId || ''));
      await logged('offer.sent', id, { promotion: body.promotionId || null });
      return respondWithDoc(store, id);
    }
  }

  if (head === 'designs' && id && method === 'PATCH') {
    const row = await store.patchDesign(id, { archived: body.archived === true });
    if (!row) return bad(404, 'not_found');
    await logged('design.archive', id, { archived: body.archived === true });
    return respondWithDoc(store, row.clientId);
  }

  if (head === 'orders' && id && sub === 'delivery' && (method === 'POST' || method === 'PATCH')) {
    const order = await store.order(id);
    if (!order) return bad(404, 'not_found');
    // Giving an order its day belongs to whoever looks after the client. The planner only moves what has one.
    if (method === 'POST' && !person.modules.includes('clients')) return bad(403, 'not_allowed');
    if (method === 'POST' && !canAddDelivery(order)) return bad(409, 'not_ready');
    const date = body.date ? String(body.date).slice(0, 10) : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(422, 'bad_date');
    if (method === 'POST' && !date && !body.collect) return bad(422, 'bad_date');
    const fields = method === 'POST'
      // A new day means no agreed time yet. Collecting is a day too: it says when it is ready.
      ? { pickup: body.collect === true, deliveryDate: date, winS: null, winE: null, clientState: 'none' }
      : {
        ...(date ? { deliveryDate: date } : {}),
        ...(body.winS !== undefined ? { winS: body.winS, winE: body.winE } : {}),
        ...(body.clientState ? { clientState: String(body.clientState).slice(0, 12) } : {})
      };
    await store.setDelivery(order, fields);
    await logged('delivery.set', id, fields);
    return respondWithDoc(store, order.clientId);
  }

  // What a draft holds in Zoho right now, so changing it starts from the truth.
  if (head === 'orders' && id && sub === 'draft' && method === 'GET') {
    const order = await store.order(id);
    if (!order || order.zohoStatus !== 'draft') return bad(404, 'not_a_draft');
    return ok({ draft: await store.draftDetail(order) });
  }

  // Elvis has checked the lines: the draft goes for approval, and the sync makes the order from it.
  // Approving, which is what files with KRA, stays Ben's click in Zoho. Payment is optional here.
  if (head === 'orders' && id && sub === 'submit' && method === 'POST') {
    const order = await store.order(id);
    if (!order) return bad(404, 'not_found');
    if (order.zohoStatus !== 'draft') return bad(409, 'not_a_draft');
    const amount = Number(String(body.amount ?? '').replace(/[^\d.]/g, ''));
    await store.submitDraft(order, { amount: Number.isFinite(amount) && amount > 0 ? amount : null, on: today });
    await logged('invoice.submit', id, { invoice: order.invoice, amount: amount || null });
    return respondWithDoc(store, order.clientId);
  }

  // Every order still to reach someone, for the planner.
  if (head === 'deliveries' && method === 'GET') return ok({ orders: await store.openOrders() });

  // What someone did on the delivery page. Who it was comes from their sign-in, not from the page.
  if (head === 'log' && method === 'POST') {
    await logged('planner', String(body.rec || '').slice(0, 120) || null, {
      table: String(body.table || '').slice(0, 60) || null, run: String(body.run || '').slice(0, 40) || null, text: String(body.text || '').slice(0, 500)
    });
    return ok({});
  }

  // Chats nobody has made a page for, newest first, each with what has been sent in it.
  if (head === 'chats' && id === 'recent' && method === 'GET') return ok({ rows: await store.recentChats() });

  // The address box, through Google Maps.
  if (head === 'places' && method === 'POST') {
    if (id === 'detail') return ok({ place: await store.placeDetail(String(body.id || '')) });
    const q = String(body.q || '').trim().slice(0, 120);
    return ok({ rows: q.length < 3 ? [] : await store.placeSearch(q) });
  }

  if (head === 'common' && method === 'GET') return ok({ rows: await store.commonDesigns() });
  if (head === 'promotions' && method === 'GET') return ok({ rows: await store.promotions() });
  if (head === 'promotions' && method === 'POST') {
    const row = await store.addPromotion({
      name: String(body.name || '').trim().slice(0, 80),
      terms: String(body.terms || '').slice(0, 500),
      ends: body.ends ? String(body.ends).slice(0, 10) : null,
      on: today
    });
    await logged('promotion.add', row.id, { name: row.name });
    return ok({ row });
  }

  if (head === 'staff') {
    if (!id && method === 'GET') return ok({ rows: await store.staff() });
    if (!id && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return bad(422, 'bad_email');
      const row = await store.addStaff({ email, name: String(body.name || '').trim(), modules: body.modules || [] });
      await logged('staff.add', row.id, { email });
      return ok({ rows: await store.staff() });
    }
    if (id && method === 'PATCH') {
      const patch = {};
      if (Array.isArray(body.modules)) patch.modules = body.modules;
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (typeof body.name === 'string') patch.name = body.name.trim();
      await store.patchStaff(id, patch);
      await logged('staff.edit', id, patch);
      return ok({ rows: await store.staff() });
    }
  }

  return bad(404, 'no_route');
}

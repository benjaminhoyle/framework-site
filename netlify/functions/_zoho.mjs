// Zoho Books, from a refresh token. No browser, no session, no stored password.
//
// The credential is a Self Client issued once at api-console.zoho.com. Its
// refresh token does not expire; each invocation trades it for a one-hour access
// token. The org is on the **.com** data centre (accounts.zoho.com /
// www.zohoapis.com) — a Kenya org on the wrong DC 401s on every call, which is
// the first thing to check if this suddenly stops working.
//
// The scopes here are deliberately narrow. This credential lives in the cloud,
// so it can create and read invoices and contacts and nothing else — it is
// *verified* unable to reach banking or expenses. The wider credential, with
// banking and expenses, stays on Ben's machine in framework-ops/.env. Do not
// widen this one to save a round trip.

const ORG = () => need('ZOHO_ORG_ID');

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * One access token per invocation.
 *
 * Cached on the module, which on Netlify means "for as long as this container
 * lives" — usually a few minutes of warm invocations. Tokens last an hour, so a
 * cached one is nearly always still good; the 60s safety margin covers a token
 * that expires mid-pass.
 */
let cached = { token: null, expires: 0 };

export async function accessToken() {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: need('ZOHO_REFRESH_TOKEN'),
    client_id: need('ZOHO_CLIENT_ID'),
    client_secret: need('ZOHO_CLIENT_SECRET')
  });
  const res = await fetch(`${need('ZOHO_ACCOUNTS_HOST')}/oauth/v2/token`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) {
    throw new Error(`Zoho refresh failed: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

/**
 * Every call is counted.
 *
 * Zoho allows 2,000 calls per organization per DAY, not per minute — a limit
 * that is easy to walk into, because a full pass costs several hundred. Testing
 * this module exhausted a day's quota. The counter makes the cost visible in
 * every run row, so nobody has to guess how close to the wall a schedule sits.
 */
export const calls = { n: 0 };

async function call(path, params = {}, tries = 3, post = null, method = null) {
  calls.n += 1;
  const token = await accessToken();
  const url = new URL(`${need('ZOHO_API_HOST')}/books/v3${path}`);
  url.searchParams.set('organization_id', ORG());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const verb = method || (post ? 'POST' : 'GET');
  const res = await fetch(url, {
    method: verb,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(post ? { 'Content-Type': 'application/json' } : {})
    },
    ...(post ? { body: JSON.stringify(post) } : {})
  });
  // Two different 429s wear the same status code. The per-minute one is worth
  // waiting out; the DAILY quota will never succeed on retry — retrying it just
  // burns the next day's allowance too. Only back off for the per-minute case.
  if (res.status === 429) {
    const body = await res.text();
    if (/maximum call rate limit/i.test(body)) {
      throw new Error(`Zoho daily API quota exhausted (2,000/org/day) on ${path}`);
    }
    if (tries > 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return call(path, params, tries - 1, post, method);
    }
    throw new Error(`Zoho 429 on ${path}: ${body.slice(0, 160)}`);
  }
  // Only a read is safe to retry blindly. Re-POSTing a create could raise the
  // same invoice twice, and a duplicate in the books is worse than a failure a
  // person can see and repeat deliberately.
  if (res.status >= 500 && tries > 0 && verb === 'GET') {
    await new Promise((r) => setTimeout(r, 1500));
    return call(path, params, tries - 1);
  }
  if (!res.ok) {
    throw new Error(`Zoho ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Every page of a list endpoint. */
async function pageAll(path, key, params = {}) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const d = await call(path, { ...params, per_page: 200, page });
    out.push(...(d[key] || []));
    if (!d.page_context?.has_more_page) return out;
  }
}

/**
 * Invoices, optionally only those touched since a timestamp.
 *
 * `since` makes an incremental pass cheap — one call, and usually an empty list.
 * It CANNOT reveal a deleted invoice, because a deleted record has no
 * modification time to report, which is the whole reason a periodic full pass
 * still exists. INV640313 was deleted and went unnoticed for months.
 * Format: 2026-08-21T09:05:00+0300
 */
export function invoices({ since } = {}) {
  return pageAll('/invoices', 'invoices', since ? { last_modified_time: since } : {});
}

/**
 * One invoice in full.
 *
 * Required, not optional: the LIST response silently omits custom fields that
 * the DETAIL response returns — Delivery Address and Design Details among them —
 * so anything reading custom fields must list, then fetch.
 */
export async function invoice(id) {
  return (await call(`/invoices/${id}`)).invoice;
}

/**
 * Payments applied to one invoice, oldest first.
 *
 * The invoice itself carries only `last_payment_date`, which is the LAST one and
 * is wrong for every split-payment invoice (17 of them at last count). Airtable
 * records the date the deposit confirmed the order, so it wants the FIRST.
 * This endpoint works under invoices.READ — /customerpayments would need its own
 * scope, which this credential deliberately lacks.
 */
export async function payments(id) {
  const list = (await call(`/invoices/${id}/payments`)).payments || [];
  return list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * What actually goes to Zoho when raising a draft.
 *
 * `is_inclusive_tax` is the whole reason this is a separate function. The org is
 * tax-inclusive and catalogue rates already contain VAT, but a created invoice
 * defaults to EXCLUSIVE — so Zoho adds 16% on top and the customer is billed
 * 20,300 for a 17,500 shelf. Every invoice raised by hand carries `true`; the
 * first one raised through the API did not, and nothing about the response said
 * so. Verified against INV640435.
 */
export function draftInvoicePayload(fields) {
  return { is_inclusive_tax: true, ...fields };
}

/**
 * Raise a DRAFT invoice. Never a sent one.
 *
 * Zoho creates invoices as drafts unless told otherwise, and nothing here tells
 * it otherwise — deliberately. A draft is reversible: a rep reviews it, adds
 * delivery, and sends it themselves. That is what keeps this endpoint safe
 * behind a typed password, and why there is no `send` here to reach for.
 */
export async function createDraftInvoice(payload) {
  const d = await call('/invoices', {}, 1, draftInvoicePayload(payload));
  if (!d.invoice) throw new Error(`Zoho create returned no invoice: ${JSON.stringify(d).slice(0, 200)}`);
  return d.invoice;
}

/**
 * Which custom fields the invoice form actually has.
 *
 * Sending one that does not exist is rejected, and omitting a MANDATORY one is
 * rejected too — `cf_work_type` is mandatory, so an invoice raised without it
 * never gets created at all. Reading the list once per container means a field
 * added in Zoho starts working without a deploy, and one that is missing is
 * skipped rather than failing the whole push.
 */
let fieldCache = null;
export async function invoiceFields() {
  if (fieldCache) return fieldCache;
  const d = await call('/settings/fields', { entity: 'invoice' });
  fieldCache = new Set((d.fields || []).map((f) => f.api_name));
  return fieldCache;
}

export function items() {
  return pageAll('/items', 'items', { filter_by: 'Status.All' });
}

export function contacts() {
  return pageAll('/contacts', 'contacts');
}

/**
 * One contact in full: its addresses, its notes and its contact persons.
 *
 * The LIST response flattens phone and mobile off the primary contact person
 * and omits `notes` and the address objects entirely, so anything that means to
 * read or amend a person's details has to fetch the detail — the same trap as
 * `invoice()` above.
 *
 * Fetched one at a time and only for a contact a rep has actually chosen. That
 * is deliberate: a leaked push password should not be able to walk the customer
 * database out through this endpoint any faster than one call per person, under
 * a daily quota that runs out well before the list does.
 */
export async function contact(id) {
  return (await call(`/contacts/${id}`)).contact;
}

/**
 * A new customer.
 *
 * Zoho refuses a duplicate `contact_name` outright, which is the behaviour we
 * want: it is the only thing standing between "the rep could not find Jane" and
 * a second Jane Doe with half her history. The caller turns that refusal into
 * "search for them instead" rather than swallowing it.
 */
export async function createContact(payload) {
  const d = await call('/contacts', {}, 1, payload);
  if (!d.contact) throw new Error(`Zoho create returned no contact: ${JSON.stringify(d).slice(0, 200)}`);
  return d.contact;
}

/**
 * Amend an existing customer — phone, address, notes. Nothing else.
 *
 * A PUT, and `call()` will not retry it: a repeated update is harmless in
 * principle but would append a second "previous phone" line to the notes, and a
 * record that grows a line every time the network hiccups stops being read.
 */
export async function updateContact(id, payload) {
  const d = await call(`/contacts/${id}`, {}, 1, payload, 'PUT');
  return (d && d.contact) || null;
}

/**
 * The goods total actually charged, and the delivery charged, from one invoice.
 *
 * The org is **tax-inclusive**: a line's `rate` is the VAT-inclusive figure the
 * customer sees, and `item_total` is ex-VAT. Airtable holds catalogue prices
 * inclusive, so goods use `rate`; the delivery field deliberately holds ex-VAT,
 * so it uses `item_total`. Getting these two the wrong way round is a silent
 * 16% error, so they are derived in exactly one place.
 */
export function money(inv) {
  const lines = inv.line_items || [];
  // Delivery has been billed under more than one name. It is identified by what
  // it is, not by one exact string, so a line called "Delivery and Installation"
  // is not quietly counted as goods and left out of the delivery margin.
  const isDelivery = (li) => /^delivery/i.test(String(li.name || '').trim());
  const goods = lines.filter((li) => !isDelivery(li));
  return {
    goods: round2(goods.reduce((n, li) => n + li.rate * li.quantity, 0)),
    deliveryExVat: round2(lines.filter(isDelivery).reduce((n, li) => n + li.item_total, 0)),
    hasDeliveryLine: lines.some(isDelivery),
    discount: round2(Number(inv.discount_total) || 0),
    lines: goods
  };
}

export const round2 = (n) => Math.round(n * 100) / 100;

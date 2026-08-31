// Turning a saved design into invoice lines.
//
// Pure: no network, no credentials. Everything that decides *what* gets
// invoiced lives here so it can be tested without spending Zoho's daily call
// budget, and so the endpoint is left doing nothing but I/O.
//
// Three rules earned the hard way, each of which would otherwise be a silent
// error rather than a loud one:
//
//   1. Group by (moduleId, finish), never by moduleId alone. Both systems carry
//      colour per line, and `priceBreakdown()` in the builder discards it — it
//      exists to show a customer a total, not to describe an order.
//   2. Join on moduleId, never on the label. `moduleLabel()` strips "(Trimmed)"
//      in Simple mode, so a trimmed unit shown as "Standard Base" would be
//      invoiced — and built — as the untrimmed one. Same price today, so it
//      would never show up as a money error; it would show up as the wrong
//      thing arriving.
//   3. Price from Zoho, never from the contract. The catalogue is what a
//      customer was quoted; the invoice is what they are charged, and Zoho owns
//      that. A module the contract cannot price is still sellable if Zoho has a
//      rate for it.

/**
 * The Zoho item name for a builder module id.
 *
 * `standard_base_trimmed` -> `Standard Base (Trimmed)`. Verified against the
 * live catalogue: all 34 priced modules resolve. It is still checked at push
 * time rather than trusted — a rename in Zoho must fail loudly here, not
 * quietly invoice the wrong product.
 */
export function zohoItemName(moduleId) {
  const trimmed = moduleId.endsWith('_trimmed');
  const base = trimmed ? moduleId.slice(0, -'_trimmed'.length) : moduleId;
  const words = base.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return words + (trimmed ? ' (Trimmed)' : '');
}

/** `marine` -> `Marine`, matching the Colour option values on a Zoho line. */
export const finishLabel = (f) => (f ? f.charAt(0).toUpperCase() + f.slice(1) : '');

/**
 * A saved design, as the pieces that should appear on an invoice.
 *
 * Reads `design.instances` directly. Each instance carries its own `finish` only
 * when it differs from the design's, which is why the fallback matters: a shelf
 * painted one colour has no per-instance finish at all.
 *
 * Bookends are not instances — they are a count on the design — so they are
 * added separately, in the design's own colour.
 *
 * Instances marked `omitted` are skipped: they are pieces the client already
 * owns, drawn on the design so the shelf reads whole but never charged for.
 * The builder's own total leaves them out the same way, so an invoice raised
 * from a code matches the figure the client was shown.
 */
export function groupDesign(design) {
  if (!design || !Array.isArray(design.instances)) {
    throw new Error('design has no instances');
  }
  const counts = new Map();
  const bump = (moduleId, finish, n = 1) => {
    const key = `${moduleId}|${finish}`;
    const prev = counts.get(key) || { moduleId, finish, quantity: 0 };
    prev.quantity += n;
    counts.set(key, prev);
  };
  for (const i of design.instances) {
    if (i.omitted) continue;
    bump(i.type, i.finish || design.finish);
  }
  if (design.bookends > 0) bump('bookend', design.finish, design.bookends);
  // Stable order so two pushes of one design produce identical invoices.
  return [...counts.values()].sort(
    (a, b) => a.moduleId.localeCompare(b.moduleId) || a.finish.localeCompare(b.finish)
  );
}

/**
 * Grouped pieces as Zoho line items, priced from the live catalogue.
 *
 * Returns `unknown` rather than throwing so the caller can tell the rep exactly
 * which pieces need a manual line, instead of failing the whole push with one
 * unrecognised module.
 */
export function buildLineItems(groups, zohoItems) {
  const byName = new Map(
    zohoItems.filter((i) => i.status === 'active').map((i) => [i.name, i])
  );
  const line_items = [];
  const unknown = [];
  for (const g of groups) {
    const name = zohoItemName(g.moduleId);
    const item = byName.get(name);
    if (!item) {
      unknown.push({ moduleId: g.moduleId, expected: name, quantity: g.quantity, finish: g.finish });
      continue;
    }
    line_items.push({
      item_id: item.item_id,
      name: item.name,
      rate: item.rate,
      quantity: g.quantity,
      // Colour rides on the line, not the item: the same product is sold in
      // four finishes and the workshop needs to know which.
      item_custom_fields: g.finish ? [{ api_name: 'cf_color', value: finishLabel(g.finish) }] : []
    });
  }
  return { line_items, unknown };
}

/** What the invoice will total, so a rep can sanity-check before sending. */
export const linesTotal = (line_items) =>
  Math.round(line_items.reduce((n, li) => n + li.rate * li.quantity, 0) * 100) / 100;

/**
 * Whether any line is priced differently from what the customer was quoted.
 *
 * Not a blocker. Reps zero-rate and discount deliberately, and a quote from
 * before a price change is a normal thing to invoice at today's rate. It is
 * surfaced so the difference is a decision rather than a surprise.
 */
export function quoteDrift(line_items, quotedTotal) {
  if (quotedTotal == null) return null;
  const now = linesTotal(line_items);
  const delta = Math.round((now - quotedTotal) * 100) / 100;
  return delta === 0 ? null : { quoted: quotedTotal, now, delta };
}

/* ---------------------------------------------------------------- delivery --
 *
 * Delivery is a real Zoho item ("Delivery Fees"), not an ad-hoc line, so it
 * lands in the same account as every delivery ever billed and the reconciler's
 * `money()` recognises it.
 *
 * It is identified by what it is rather than by one exact string, for the same
 * reason `money()` is: the line has been called "Delivery" and "Delivery and
 * Installation" over the years, and a rename in Zoho must not quietly turn the
 * delivery charge into goods.
 */
export const isDeliveryName = (name) => /^delivery/i.test(String(name || '').trim());

/**
 * A typed amount of money, however it was typed.
 *
 * `Number("2,500")` is NaN, and a browser `<input type=number>` reports an
 * empty string for the same text rather than the digits behind it — so a rep
 * typing a thousands separator, which in Kenya is most of them, produced no
 * amount at all and no delivery line. Both ends now strip anything that is not
 * a digit or a decimal point before believing the field is empty.
 *
 * Returns null for "nothing was typed" AND for "that is not a number". The
 * caller has the raw text and can tell those apart; it must, because one of
 * them is a rep who meant to charge for delivery.
 */
export function moneyValue(v) {
  if (v == null) return null;
  const digits = String(v).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/**
 * The delivery line for a typed fee, or null when there is nothing to charge.
 *
 * The rate is VAT-INCLUSIVE, like every other line: the org is tax-inclusive,
 * so `rate` is the figure the customer sees and the rep quotes. Returning null
 * rather than a zero line matters — a KSh 0 delivery line on an invoice reads
 * as "delivery is free", which is a promise nobody made.
 */
export function deliveryLine(zohoItems, amountKsh) {
  const amount = moneyValue(amountKsh);
  if (amount == null || amount <= 0) return null;
  const item = zohoItems.find((i) => i.status === 'active' && isDeliveryName(i.name));
  if (!item) return { unknown: true, expected: 'Delivery Fees', amount };
  return { item_id: item.item_id, name: item.name, rate: amount, quantity: 1, item_custom_fields: [] };
}

/**
 * The goods on an invoice — everything except delivery.
 *
 * Quote drift compares against what the builder quoted, which is furniture
 * only: it has never known what delivery would cost. Comparing the whole
 * invoice would report a 2,000 discrepancy on every delivered order and train
 * reps to ignore the one warning that means something.
 */
export const goodsLines = (line_items) => line_items.filter((li) => !isDeliveryName(li.name));

/* ----------------------------------------------------------------- clients --
 *
 * A Zoho contact is the record of the person: their name, their phone and where
 * things go. The invoice carries its own copies as custom fields, so an order is
 * complete whatever happens here — which is what lets the contact write be a
 * best-effort step after the invoice rather than a gate in front of it.
 */

/** Zoho stores a display name as well as the two parts, and wants both. */
export const contactName = (first, last) => `${String(first || '').trim()} ${String(last || '').trim()}`.trim();

/**
 * The same phone number, however it was typed.
 *
 * Kenyan numbers are written 0722…, 722…, +254722… and 254 722 … by different
 * people on different days, and a rep retyping the number they were just shown
 * must not be read as a correction — that would write a pointless update and
 * leave a "previous phone" note recording no change at all.
 */
export function samePhone(a, b) {
  const digits = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.replace(/^(?:254|0)/, '');
  };
  const x = digits(a);
  const y = digits(b);
  return x === y || (Boolean(x) && Boolean(y) && x.slice(-9) === y.slice(-9));
}

/** Same address, ignoring the trailing newlines and double spaces people leave. */
export const sameAddress = (a, b) =>
  String(a || '').trim().replace(/\s+/g, ' ').toLowerCase()
  === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * A KRA PIN as it is stored, whatever the rep typed.
 *
 * `P051755191T` is read off a certificate, a WhatsApp message or a business
 * card, so it arrives lowercase, spaced, or with the label still attached. The
 * PIN itself is eleven characters with no spaces in it, so anything that is not
 * a letter or a digit is decoration.
 */
export const normalisePin = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The same PIN, however it was typed. */
export const samePin = (a, b) => normalisePin(a) === normalisePin(b);

/** The phone and address a Zoho contact currently holds, flattened. */
export function contactDetails(contact) {
  if (!contact) return { phone: '', address: '', pin: '', tax_treatment: '', first_name: '', last_name: '', name: '' };
  const person = (contact.contact_persons || []).find((p) => p.is_primary_contact)
    || (contact.contact_persons || [])[0] || {};
  return {
    name: contact.contact_name || '',
    first_name: contact.first_name || person.first_name || '',
    last_name: contact.last_name || person.last_name || '',
    // Zoho keeps two numbers per person and Kenyan clients are reachable on the
    // mobile; prefer it, but do not lose a landline that is all there is.
    phone: person.mobile || person.phone || contact.mobile || contact.phone || '',
    address: (contact.shipping_address && contact.shipping_address.address)
      || (contact.billing_address && contact.billing_address.address) || '',
    // Zoho returns the KRA PIN under two names on the same record. `tax_reg_no`
    // is the generic one and `vat_reg_no` the Kenya-flavoured copy; they hold
    // the same string, and reading both means a response that carries only one
    // of them still works.
    pin: contact.tax_reg_no || contact.vat_reg_no || '',
    // Read so it can be reported, not so it can be echoed back. See the note in
    // `contactUpdate`: a PIN and a treatment have to agree, and this is what
    // says whether they already do.
    tax_treatment: contact.tax_treatment || ''
  };
}

/**
 * A new Zoho contact from the four things the form asks for.
 *
 * The phone lives on the primary contact person, not on the contact: the
 * contact-level `phone`/`mobile` in a Zoho response are read-through copies of
 * that person's, and sending them at the top level silently does nothing.
 */
export function newContactPayload({ first_name, last_name, phone, address, pin }) {
  const name = contactName(first_name, last_name);
  const person = {
    first_name: String(first_name || '').trim(),
    last_name: String(last_name || '').trim(),
    is_primary_contact: true
  };
  if (phone) person.mobile = String(phone).trim();
  const payload = {
    contact_name: name,
    customer_sub_type: 'individual',
    contact_type: 'customer',
    first_name: person.first_name,
    last_name: person.last_name,
    contact_persons: [person]
  };
  if (address) {
    payload.billing_address = { address: String(address).trim() };
    payload.shipping_address = { address: String(address).trim() };
  }
  // A PIN comes with a tax treatment or it does not come at all: Zoho will not
  // hold `tax_reg_no` on a contact it believes is not VAT-registered, and the
  // PIN is what puts the customer's own registration on the eTIMS invoice. So
  // typing one here says "invoice this client in their registered name", and
  // the two fields are set together or neither is.
  const registered = normalisePin(pin);
  if (registered) {
    payload.tax_reg_no = registered;
    payload.tax_treatment = 'vat_registered';
  }
  return payload;
}

/**
 * What to send Zoho when a rep has corrected a client's details, and what the
 * correction replaced.
 *
 * Returns `null` when nothing actually changed, so the common case costs no API
 * call at all. The old values are prepended to the contact's Notes rather than
 * discarded: a number that stops working is a number somebody still has to try,
 * and a delivery address that was right last year is often right again.
 */
/**
 * The same decision as `contactUpdate`, for the Airtable client record.
 *
 * Base - Clients is the LIVE record of who a client is, and the order pipeline
 * only ever looks it up: `Orders - Pipeline.Delivery Address` is a lookup,
 * `Delivery Address Baked` is `IF({Client Pickup}, "Client to Collect",
 * {Delivery Address})`, and `Delivery Details Summary` — the text a driver is
 * actually sent — is a formula over those. So a corrected address that lands
 * only in Zoho does not merely go stale in a table nobody reads; it sends the
 * van to the old house.
 *
 * Deliberately the same shape as `contactUpdate` and using the same comparisons,
 * so "has this actually changed?" is answered identically on both sides and the
 * two records cannot converge on different answers.
 */
export function airtableClientPatch(row, { phone, address, pin, today }) {
  const current = row && row.fields ? row.fields : {};
  const nowPhone = String(current['Primary Phone Number'] || '');
  const nowAddress = String(current.Address || '');
  const nowPin = String(current['KRA PIN'] || '');
  const wantPhone = String(phone || '').trim();
  const wantAddress = String(address || '').trim();
  const wantPin = normalisePin(pin);
  const phoneChanged = Boolean(wantPhone) && !samePhone(wantPhone, nowPhone);
  const addressChanged = Boolean(wantAddress) && !sameAddress(wantAddress, nowAddress);
  const pinChanged = Boolean(wantPin) && !samePin(wantPin, nowPin);
  if (!phoneChanged && !addressChanged && !pinChanged) return null;

  const fields = {};
  if (phoneChanged) fields['Primary Phone Number'] = wantPhone;
  if (addressChanged) fields.Address = wantAddress;
  if (pinChanged) fields['KRA PIN'] = wantPin;

  const replaced = [];
  if (phoneChanged && nowPhone) replaced.push(`previous phone ${nowPhone}`);
  if (addressChanged && nowAddress) replaced.push(`previous address ${nowAddress.replace(/\s+/g, ' ').trim()}`);
  if (pinChanged && nowPin) replaced.push(`previous KRA PIN ${nowPin}`);
  if (replaced.length) {
    const line = `${today} (shelf designer): ${replaced.join('; ')}`;
    fields.Notes = [line, String(current.Notes || '').trim()].filter(Boolean).join('\n').slice(0, 2000);
  }
  return { fields, changed: { phone: phoneChanged, address: addressChanged, pin: pinChanged }, replaced };
}

/**
 * Where the two live records disagree.
 *
 * Only when BOTH hold a value and the values are not the same thing — a blank on
 * one side is a gap the next push fills, not a disagreement anyone has to
 * settle. Surfaced in the form rather than resolved by a rule, because there is
 * no way to tell from the outside which of two real phone numbers is current,
 * and the person who just spoke to the client can.
 */
export function clientDisagreement(zohoDetails, airtableFields) {
  const at = airtableFields || {};
  const zPhone = String((zohoDetails && zohoDetails.phone) || '');
  const zAddress = String((zohoDetails && zohoDetails.address) || '');
  const aPhone = String(at['Primary Phone Number'] || '').trim();
  const aAddress = String(at.Address || '').trim();
  const zPin = String((zohoDetails && zohoDetails.pin) || '');
  const aPin = String(at['KRA PIN'] || '').trim();
  return {
    phone: Boolean(zPhone && aPhone) && !samePhone(zPhone, aPhone),
    address: Boolean(zAddress && aAddress) && !sameAddress(zAddress, aAddress),
    pin: Boolean(zPin && aPin) && !samePin(zPin, aPin)
  };
}

export function contactUpdate(contact, { phone, address, pin, today }) {
  const now = contactDetails(contact);
  const wantPhone = String(phone || '').trim();
  const wantAddress = String(address || '').trim();
  const wantPin = normalisePin(pin);
  const phoneChanged = Boolean(wantPhone) && !samePhone(wantPhone, now.phone);
  const addressChanged = Boolean(wantAddress) && !sameAddress(wantAddress, now.address);
  const pinChanged = Boolean(wantPin) && !samePin(wantPin, now.pin);
  if (!phoneChanged && !addressChanged && !pinChanged) return null;

  const payload = {};
  if (phoneChanged) {
    const person = (contact.contact_persons || []).find((p) => p.is_primary_contact)
      || (contact.contact_persons || [])[0];
    payload.contact_persons = [{
      // Without the id Zoho ADDS a second contact person rather than editing the
      // one that is there, and the contact ends up with two of everybody.
      ...(person && person.contact_person_id ? { contact_person_id: person.contact_person_id } : {}),
      first_name: (person && person.first_name) || now.first_name,
      last_name: (person && person.last_name) || now.last_name,
      is_primary_contact: true,
      mobile: wantPhone
    }];
  }
  if (addressChanged) {
    payload.billing_address = { ...(contact.billing_address || {}), address: wantAddress };
    payload.shipping_address = { ...(contact.shipping_address || {}), address: wantAddress };
  }
  // A PIN and a tax treatment travel together, always.
  //
  // Zoho will not hold `tax_reg_no` against a contact it believes is not
  // VAT-registered, and 258 of 374 contacts are `vat_not_registered` — the
  // default for anyone created quickly. So echoing the treatment we found would
  // make the write fail for exactly the clients it exists to serve, while
  // sending the PIN alone would be an incoherent record.
  //
  // Setting it is therefore part of what typing a PIN MEANS here: this client
  // is invoiced in their own registered name, and their PIN belongs on the
  // eTIMS invoice. It changes how the customer is classified, not what they are
  // charged — the rate is the org's, and `is_taxable` is untouched — and the
  // result screen says so rather than letting it happen quietly.
  if (pinChanged) {
    payload.tax_reg_no = wantPin;
    payload.tax_treatment = 'vat_registered';
  }

  // Only record what was actually replaced. "Previous phone: (blank)" is noise
  // in a field a person reads.
  const replaced = [];
  if (phoneChanged && now.phone) replaced.push(`previous phone ${now.phone}`);
  if (addressChanged && now.address) replaced.push(`previous address ${now.address.replace(/\s+/g, ' ').trim()}`);
  if (pinChanged && now.pin) replaced.push(`previous KRA PIN ${now.pin}`);
  if (replaced.length) {
    const line = `${today} (shelf designer): ${replaced.join('; ')}`;
    payload.notes = [line, String(contact.notes || '').trim()].filter(Boolean).join('\n').slice(0, 2000);
  }
  return {
    payload,
    changed: { phone: phoneChanged, address: addressChanged, pin: pinChanged },
    // Whether this write also moves the contact from `vat_not_registered`, so
    // the rep is told rather than finding out from an accountant.
    registered: pinChanged && now.tax_treatment !== 'vat_registered',
    replaced
  };
}

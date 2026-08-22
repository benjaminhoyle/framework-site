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
  for (const i of design.instances) bump(i.type, i.finish || design.finish);
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

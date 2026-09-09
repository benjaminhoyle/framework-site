/**
 * The design lab's three records, read back and added to.
 *
 * Each is a file of JSON lines, appended and never rewritten, where a later
 * line wins over an earlier one for the same key: a design is keyed by its
 * fingerprint, a shot and a scene by their ids. The dev server serves them
 * and the studio writes them, and this is the one reading of what a line
 * means, so the two cannot disagree about it.
 */
import fs from "node:fs";

/** The current row for every key in `file`: later lines win. */
export function readStore(file) {
  const rows = {};
  if (!fs.existsSync(file)) return rows;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const key = row.fingerprint || row.id;
      if (key) rows[key] = row;
    } catch { /* a half-written last line; the rest still counts */ }
  }
  return rows;
}

/**
 * Is this row a whole row, or an addition to one?
 *
 * A whole row says what it is: a design carries its design, a shot its
 * design, a scene the shot it was made from, and all three carry a verdict
 * even when the verdict is null. A row with none of that, such as the audit's
 * `{ id, fidelity }`, is a fact about a row already on record, and is merged
 * onto it rather than replacing it.
 */
export function isPartialRow(row) {
  if (!row || typeof row !== "object") return false;
  if ("verdict" in row) return false;
  return !row.design && !row.shotId;
}

/**
 * The line to append for `row`, given what is on record for its key.
 *
 * A partial row is laid over the current one. A whole row replaces it, but
 * keeps a `fidelity` block it did not bring: the audit writes that from
 * outside the page, and a verdict pressed in the page a moment later should
 * not quietly throw the score away.
 */
export function mergeRow(current, row) {
  if (!current) return row;
  if (isPartialRow(row)) return Object.assign({}, current, row);
  if (current.fidelity && !row.fidelity) return Object.assign({}, row, { fidelity: current.fidelity });
  return row;
}

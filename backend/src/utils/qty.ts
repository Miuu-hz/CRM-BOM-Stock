/**
 * Quantity rounding helpers — shared by every code path that writes a converted
 * quantity into stock_items.quantity / stock_movements.quantity.
 *
 * WHY: these call sites used to wrap converted quantities in Math.floor().
 * The schema declares `quantity INTEGER`, but SQLite is dynamically typed and
 * stores REAL in an INTEGER column without complaint — the flooring was a code
 * decision, not a DB constraint. It silently destroyed stock whenever a unit
 * conversion scaled a quantity *down*: buying 500 g of a product whose base
 * unit is kg converts to 0.5, and Math.floor(0.5) === 0, so the receipt added
 * nothing to stock and nobody was told.
 */

/** Epsilon for "is this effectively a whole number?" checks. */
const EPS = 1e-6

/**
 * Round a converted quantity to 6 decimal places.
 *
 * Keeps fractional quantities intact (0.5 kg stays 0.5 kg) while clipping the
 * binary-floating-point noise that unit conversion produces — e.g.
 * 0.1 + 0.2 === 0.30000000000000004, or 3 * (1/3) === 0.9999999999999998.
 * Without the clip those residues accumulate in stock_items.quantity and a
 * receive-then-cancel round trip leaves a ghost 1e-16 behind instead of zero.
 */
export function roundQty(n: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 1e6) / 1e6
}

/**
 * Round a *pack* count (stock_items.sealed_qty) to a whole number.
 *
 * sealed_qty counts unopened packs, so it is an integer by nature — you cannot
 * hold 2.5 sealed boxes. Unlike loose quantity this legitimately rounds, but it
 * rounds to nearest rather than flooring (flooring silently ate a whole pack on
 * 2.999 coming out of a conversion) and it warns when the input was not already
 * whole, because a fractional pack count means the data upstream is wrong.
 */
export function roundPackQty(n: number, context?: string): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  const rounded = Math.round(v)
  if (Math.abs(v - rounded) > EPS) {
    console.warn(
      `[qty] sealed/pack quantity ${v} is not a whole number` +
        (context ? ` (${context})` : '') +
        ` — rounded to ${rounded}. Check the pack-size unit conversion for this item.`
    )
  }
  return rounded
}

/** True when `n` is a whole number within floating-point tolerance. */
export function isWholeQty(n: number): boolean {
  const v = Number(n)
  return Number.isFinite(v) && Math.abs(v - Math.round(v)) <= EPS
}

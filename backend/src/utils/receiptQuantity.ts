// Compare representable six-place quantities as integers so a real micro-unit
// is never treated as rounding noise. Finer legacy values retain float semantics.
export function compareReceiptQuantity(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new RangeError('INVALID_RECEIPT_QUANTITY');
  const scaled = (value: number) => {
    const integer = Math.round(value * 1_000_000);
    return Number.isSafeInteger(integer) && Math.abs(value - integer / 1_000_000) <= Math.abs(value) * Number.EPSILON * 8 ? integer : null;
  };
  const a = scaled(left), b = scaled(right);
  if (a !== null && b !== null) return Math.sign(a - b);
  const difference = left - right;
  return Math.abs(difference) <= Math.max(Math.abs(left), Math.abs(right)) * Number.EPSILON * 8 ? 0 : Math.sign(difference);
}

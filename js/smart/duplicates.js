// Finds saved entries that might be the same fill. It only warns; the user
// decides. Two fills with similar litres and amounts are common, so a match
// on those alone (different dates) is not treated as a duplicate.

const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const clean = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

/**
 * @param c        candidate entry (vehicleId, date, time, quantity, totalAmount, odometer, receiptNumber, id?)
 * @param entries  saved entries
 * @returns [{ entry, reasons: [string], strong: boolean }]
 */
export function findPossibleDuplicates(c, entries) {
  const out = [];
  for (const e of entries) {
    if (e.id === c.id || e.vehicleId !== c.vehicleId) continue;
    const reasons = [];
    let strong = false;
    if (c.receiptNumber && e.receiptNumber && clean(c.receiptNumber) === clean(e.receiptNumber)) {
      reasons.push('same receipt number');
      strong = true;
    }
    const sameMoney = near(c.quantity, e.quantity, 0.02) && near(c.totalAmount, e.totalAmount, 1);
    if (c.date === e.date && sameMoney) {
      if (c.time && e.time && c.time === e.time) { reasons.push('same date, time, quantity and amount'); strong = true; } else reasons.push('same date, quantity and amount');
    }
    if (typeof c.odometer === 'number' && c.odometer === e.odometer) reasons.push('same odometer reading');
    if (reasons.length) out.push({ entry: e, reasons, strong });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong));
}

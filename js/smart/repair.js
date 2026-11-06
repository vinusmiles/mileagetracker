// Fixes one misread digit using the bill's own arithmetic: litres × rate = total.
// Pure code: tested in /tests.
//
// A value is changed only when ONE edit of ONE digit (missing, extra or wrong) makes
// the sum work, and only one of the three fields can be fixed that way. Otherwise the
// values stay as read and the review screen shows its warning.

import { isPos } from '../core/calc.js';

const RATE_MIN = 40; // ₹ per litre or kg; a corrected rate outside this is not believable
const RATE_MAX = 250;

/** Every number one digit-edit away from `value` (kept to two decimals). */
function oneDigitEdits(value) {
  const digits = String(Math.round(value * 100));
  const out = new Set();
  for (let i = 0; i <= digits.length; i += 1) {
    if (i < digits.length) out.add(digits.slice(0, i) + digits.slice(i + 1));
    for (let d = 0; d <= 9; d += 1) {
      out.add(digits.slice(0, i) + d + digits.slice(i));
      if (i < digits.length) out.add(digits.slice(0, i) + d + digits.slice(i + 1));
    }
  }
  return [...out].filter((s) => s && s[0] !== '0').map((s) => Number(s) / 100).filter((n) => n !== value);
}

/** True when the sum works, allowing for the rounding of two-decimal figures. */
const sumWorks = (q, p, t) => Math.abs(q * p - t) <= 0.01 + (q + p) * 0.005;

function closest(candidates, target) {
  return candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
}

/**
 * @param v { quantityLitres, pricePerLitre, totalAmount }
 * @returns { field, from, to } for the single safe correction, or null
 */
export function findAmountRepair({ quantityLitres: q, pricePerLitre: p, totalAmount: t }) {
  if (!isPos(q) || !isPos(p) || !isPos(t) || sumWorks(q, p, t)) return null;
  const found = [
    ['totalAmount', t, oneDigitEdits(t).filter((x) => sumWorks(q, p, x)), q * p],
    ['quantityLitres', q, oneDigitEdits(q).filter((x) => sumWorks(x, p, t)), t / p],
    ['pricePerLitre', p, oneDigitEdits(p).filter((x) => x >= RATE_MIN && x <= RATE_MAX && sumWorks(q, x, t)), t / q],
  ].filter(([, , candidates]) => candidates.length);
  if (found.length !== 1) return null;
  const [field, from, candidates, target] = found[0];
  return { field, from, to: closest(candidates, target) };
}

// Cleans a challan reader result. Only challan facts are kept; names, phone numbers,
// licence numbers and addresses are never accepted.

import { toNum, round2 } from '../core/calc.js';
import { isValidDateStr } from '../core/dates.js';

const text = (v, max) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

export function normaliseChallan(raw) {
  const r = raw || {};
  const amount = toNum(r.amount);
  const st = String(r.status || '').toLowerCase();
  return {
    date: r.date && isValidDateStr(r.date) ? r.date : null,
    amount: amount > 0 ? round2(amount) : null,
    offence: text(r.offence, 160),
    challanNumber: text(r.challanNumber, 60),
    location: text(r.location, 160),
    status: st.includes('paid') && !st.includes('unpaid') && !st.includes('pending') ? 'paid' : (st ? 'unpaid' : null),
    registration: text(r.registration, 20),
  };
}

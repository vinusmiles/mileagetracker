// Traffic challans: pure logic (tested in /tests). Records are entered by the user
// (typed or read from a photo of the challan notice / SMS); GaadiKhata never fetches
// them from police portals, which require the owner to fill in a captcha.

import { isPos, round2 } from './calc.js';
import { isValidDateStr } from './dates.js';

export const CHALLAN_PORTALS = {
  ts: { name: 'Telangana e-Challan', url: 'https://echallan.tspolice.gov.in/publicview/' },
  india: { name: 'Parivahan e-Challan (all India)', url: 'https://echallan.parivahan.gov.in/' },
};

/** Telangana numbers start TS or TG; everything else goes to Parivahan first. */
export function portalsFor(registration) {
  const r = String(registration || '').replace(/\s+/g, '').toUpperCase();
  return /^(TS|TG)\d/.test(r) ? [CHALLAN_PORTALS.ts, CHALLAN_PORTALS.india] : [CHALLAN_PORTALS.india, CHALLAN_PORTALS.ts];
}

export function challanTotals(challans = []) {
  const unpaid = challans.filter((c) => c.status !== 'paid');
  const paid = challans.filter((c) => c.status === 'paid');
  const sum = (l) => round2(l.reduce((s, c) => s + (isPos(c.amount) ? c.amount : 0), 0));
  return { count: challans.length, unpaidCount: unpaid.length, unpaidAmount: sum(unpaid), paidCount: paid.length, paidAmount: sum(paid) };
}

export function validateChallan(c, today) {
  const errors = {};
  if (!c.date) errors.date = 'Enter the date of the challan.';
  else if (!isValidDateStr(c.date)) errors.date = 'Enter a real date.';
  else if (c.date > today) errors.date = 'The date cannot be in the future.';
  if (c.amount === null || c.amount === undefined) errors.amount = 'Enter the fine amount.';
  else if (!isPos(c.amount)) errors.amount = 'Amount must be more than ₹0.';
  else if (c.amount > 500000) errors.amount = 'That amount is too large.';
  if (!['paid', 'unpaid'].includes(c.status)) errors.status = 'Choose paid or unpaid.';
  if (c.status === 'paid' && c.paidDate && (!isValidDateStr(c.paidDate) || c.paidDate < c.date)) errors.paidDate = 'The paid date must be on or after the challan date.';
  for (const [k, max] of [['offence', 160], ['challanNumber', 60], ['location', 160], ['notes', 500]]) {
    if ((c[k] || '').length > max) errors[k] = `Keep this under ${max} characters.`;
  }
  return errors;
}

/** Possible duplicate: same challan number, or same date and amount on the same vehicle. */
export function findChallanDuplicate(c, list) {
  const clean = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  return list.find((x) => x.id !== c.id && x.vehicleId === c.vehicleId
    && ((c.challanNumber && clean(c.challanNumber) === clean(x.challanNumber)) || (c.date === x.date && Math.abs((c.amount || 0) - (x.amount || 0)) < 1))) || null;
}

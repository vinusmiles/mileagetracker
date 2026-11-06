// The structured result every extraction provider must return, and a function
// that cleans whatever a provider sends back. Pure code: tested in /tests.
//
// Rules: unknown or unreadable values become null (never guessed), and anything
// the provider was unsure about, or that failed cleaning, is listed in
// fieldsNeedingReview so the user must confirm it.

import { toNum, isPos, round2 } from '../core/calc.js';
import { isValidDateStr } from '../core/dates.js';
import { findAmountRepair } from './repair.js';

export const RECEIPT_FIELDS = ['fuelCompany', 'fuelStation', 'location', 'fuelType', 'transactionDate', 'transactionTime', 'quantityLitres', 'pricePerLitre', 'totalAmount', 'receiptNumber'];
export const ODOMETER_FIELDS = ['odometerKm', 'dashboardRangeKm', 'dashboardTime'];
export const ALL_FIELDS = [...RECEIPT_FIELDS, ...ODOMETER_FIELDS];

const FUEL_WORDS = { petrol: 'petrol', gasoline: 'petrol', ms: 'petrol', diesel: 'diesel', hsd: 'diesel', cng: 'cng' };

export function emptyExtraction({ receiptProvided = false, odometerProvided = false } = {}) {
  const out = Object.fromEntries(ALL_FIELDS.map((f) => [f, null]));
  return {
    ...out,
    currency: 'INR',
    receiptIsFuel: null, // false when the bill image is not a fuel bill or pump display
    billKind: null, // 'printed-bill' | 'pump-display' (a photo of the dispenser screen)
    odometerReadable: null, // false when no odometer could be found in the photo
    fieldsNeedingReview: [],
    repair: null, // { field, from, to } when one misread digit was corrected
    sourceImages: { receiptProvided, odometerProvided },
  };
}

const text = (v, max = 120) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

function validTime(v) {
  const s = text(v, 8);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function normaliseFuelType(v) {
  const s = text(v);
  if (!s) return null;
  const key = s.toLowerCase().replace(/[^a-z]/g, '');
  for (const [word, type] of Object.entries(FUEL_WORDS)) if (key.includes(word)) return type;
  return undefined; // present but not recognised
}

/**
 * Clean a provider's raw result.
 * @param raw      object from a provider (any shape; extra keys are ignored)
 * @param sources  { receiptProvided, odometerProvided }
 */
export function normaliseExtraction(raw, sources) {
  const out = emptyExtraction(sources);
  const review = new Set((raw?.fieldsNeedingReview || []).filter((f) => ALL_FIELDS.includes(f)));
  const r = raw || {};
  const set = (field, value) => {
    if (value === undefined) { out[field] = null; if (r[field] != null && r[field] !== '') review.add(field); } else out[field] = value;
  };

  if (sources.receiptProvided) {
    set('fuelCompany', text(r.fuelCompany));
    set('fuelStation', text(r.fuelStation));
    set('location', text(r.location, 200));
    set('fuelType', normaliseFuelType(r.fuelType));
    set('transactionDate', r.transactionDate == null || r.transactionDate === '' ? null : (isValidDateStr(r.transactionDate) ? r.transactionDate : undefined));
    set('transactionTime', validTime(r.transactionTime));
    for (const f of ['quantityLitres', 'pricePerLitre', 'totalAmount']) {
      const n = toNum(r[f]);
      set(f, n === null ? null : (isPos(n) ? round2(n) : undefined));
    }
    set('receiptNumber', text(r.receiptNumber, 40)); // text: receipt numbers can contain letters
    out.repair = findAmountRepair(out);
    if (out.repair) { out[out.repair.field] = out.repair.to; review.add(out.repair.field); }
    if (typeof r.receiptIsFuel === 'boolean') out.receiptIsFuel = r.receiptIsFuel;
    if (['printed-bill', 'pump-display'].includes(r.billKind)) out.billKind = r.billKind;
  }

  if (sources.odometerProvided) {
    const odo = toNum(r.odometerKm);
    set('odometerKm', odo === null ? null : (isPos(odo) ? Math.round(odo) : undefined));
    const range = toNum(r.dashboardRangeKm);
    set('dashboardRangeKm', range === null ? null : (Number.isFinite(range) && range >= 0 ? Math.round(range) : undefined));
    set('dashboardTime', validTime(r.dashboardTime));
    if (typeof r.odometerReadable === 'boolean') out.odometerReadable = r.odometerReadable;
    // A range value is never allowed to stand in for the odometer.
    if (out.odometerKm !== null && out.odometerKm === out.dashboardRangeKm) review.add('odometerKm');
  }

  out.fieldsNeedingReview = [...review].filter((f) => (RECEIPT_FIELDS.includes(f) ? sources.receiptProvided : sources.odometerProvided));
  return out;
}

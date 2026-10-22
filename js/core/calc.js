// Mileage and expense calculations. Pure functions only: no DOM, no storage,
// so they can be tested in Node and in the browser (see /tests).
//
// Mileage rule (full tank to full tank):
//   Between two full-tank fills S and E,
//   distance = E.odometer - S.odometer
//   fuel     = every fill after S, up to and including E
//   mileage  = distance / fuel
// The fuel bought at S itself is excluded: it replaced fuel used before S.

import { monthKey } from './dates.js';

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const isPos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Form input -> number; null when empty; NaN when not a number. */
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Oldest first: by date, then odometer, then creation time. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.odometer !== b.odometer) return a.odometer - b.odometer;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

function buildInterval(rows, s, e) {
  const start = rows[s].entry;
  const end = rows[e].entry;
  const span = rows.slice(s + 1, e + 1);
  const base = {
    startId: start.id, endId: end.id,
    startDate: start.date, endDate: end.date,
    startOdometer: start.odometer, endOdometer: end.odometer,
    fills: span.length,
  };
  if (span.some((r) => r.issue)) return { ...base, valid: false, reason: 'odometer-decrease' };
  const distance = end.odometer - start.odometer;
  if (!(distance > 0)) return { ...base, valid: false, reason: 'no-distance' };
  if (span.some((r) => !isPos(r.entry.quantity))) return { ...base, valid: false, reason: 'missing-quantity' };

  const fuel = span.reduce((sum, r) => sum + r.entry.quantity, 0);
  const costKnown = span.every((r) => isPos(r.entry.totalAmount));
  const cost = span.reduce((sum, r) => sum + (isPos(r.entry.totalAmount) ? r.entry.totalAmount : 0), 0);
  return {
    ...base,
    valid: true,
    distance,
    fuel,
    mileage: round2(distance / fuel),
    cost: costKnown ? round2(cost) : null,
    costPerKm: costKnown ? round2(cost / distance) : null,
  };
}

/**
 * Analyse one vehicle's fuel entries.
 * Returns per-entry rows (distance since the previous fill, any odometer problem,
 * and the mileage interval the entry closes), all full-tank intervals, and a summary.
 */
export function analyseVehicle(entries, vehicle = null) {
  const sorted = sortEntries(entries);
  const rows = sorted.map((entry, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    let distance = null;
    let issue = null;
    if (prev) {
      const d = entry.odometer - prev.odometer;
      if (d < 0) issue = 'odometer-decrease';
      else distance = d;
    }
    return { entry, distance, issue, interval: null };
  });

  const intervals = [];
  let start = -1;
  rows.forEach((row, i) => {
    if (!row.entry.fullTank) return;
    if (start >= 0) {
      const iv = buildInterval(rows, start, i);
      intervals.push(iv);
      row.interval = iv;
    }
    start = i;
  });

  const valid = intervals.filter((iv) => iv.valid);
  return { rows, intervals, summary: summarise(sorted, rows, intervals, valid, vehicle) };
}

/** Weighted average: total distance / total fuel over valid intervals. */
export function averageMileage(validIntervals) {
  const dist = validIntervals.reduce((s, iv) => s + iv.distance, 0);
  const fuel = validIntervals.reduce((s, iv) => s + iv.fuel, 0);
  return validIntervals.length && fuel > 0 ? round2(dist / fuel) : null;
}

/** Cost per km over valid intervals whose cost is fully known. */
export function costPerKm(validIntervals) {
  const known = validIntervals.filter((iv) => iv.cost !== null);
  const dist = known.reduce((s, iv) => s + iv.distance, 0);
  const cost = known.reduce((s, iv) => s + iv.cost, 0);
  return known.length && dist > 0 ? round2(cost / dist) : null;
}

function summarise(sorted, rows, intervals, valid, vehicle) {
  const odometers = sorted.map((e) => e.odometer).filter((n) => Number.isFinite(n));
  if (vehicle && Number.isFinite(vehicle.initialOdometer)) odometers.push(vehicle.initialOdometer);

  let status;
  if (!sorted.length) status = 'no-entries';
  else if (valid.length) status = 'ok';
  else if (!sorted.some((e) => e.fullTank)) status = 'need-full-tank';
  else if (intervals.length) status = 'check-readings';
  else status = 'need-next-full';

  const last = valid.length ? valid[valid.length - 1] : null;
  return {
    status,
    entryCount: sorted.length,
    latestMileage: last ? last.mileage : null,
    latestInterval: last,
    averageMileage: averageMileage(valid),
    costPerKm: costPerKm(valid),
    totalSpend: round2(sorted.reduce((s, e) => s + (isPos(e.totalAmount) ? e.totalAmount : 0), 0)),
    totalQuantity: sorted.reduce((s, e) => s + (isPos(e.quantity) ? e.quantity : 0), 0),
    latestOdometer: odometers.length ? Math.max(...odometers) : null,
    lastEntry: sorted.length ? sorted[sorted.length - 1] : null,
    issueCount: rows.filter((r) => r.issue).length,
  };
}

/** Group entries by 'YYYY-MM' -> { amount, quantity, count }. */
export function monthlyTotals(entries) {
  const out = {};
  for (const e of entries) {
    const k = monthKey(e.date);
    const m = (out[k] ||= { amount: 0, quantity: 0, count: 0 });
    if (isPos(e.totalAmount)) m.amount += e.totalAmount;
    if (isPos(e.quantity)) m.quantity += e.quantity;
    m.count += 1;
  }
  for (const k of Object.keys(out)) out[k].amount = round2(out[k].amount);
  return out;
}

/** Entries dated within [from, to], inclusive. Either bound may be null. */
export function inRange(entries, from, to) {
  return entries.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
}

/** Totals for a list of entries. */
export function totals(entries) {
  return {
    amount: round2(entries.reduce((s, e) => s + (isPos(e.totalAmount) ? e.totalAmount : 0), 0)),
    quantity: entries.reduce((s, e) => s + (isPos(e.quantity) ? e.quantity : 0), 0),
    count: entries.length,
  };
}

/**
 * Work out the missing one of quantity / price / total from the two the user typed.
 * `typed` is a Set of the fields the user entered. Returns { field, value } for
 * the field to fill in, or null when nothing should be calculated.
 */
export function deriveAmounts(values, typed) {
  const q = toNum(values.quantity);
  const p = toNum(values.pricePerUnit);
  const t = toNum(values.totalAmount);
  const has = (f) => typed.has(f);
  if (has('quantity') && has('pricePerUnit') && !has('totalAmount') && isPos(q) && isPos(p)) {
    return { field: 'totalAmount', value: round2(q * p) };
  }
  if (has('quantity') && has('totalAmount') && !has('pricePerUnit') && isPos(q) && isPos(t)) {
    return { field: 'pricePerUnit', value: round2(t / q) };
  }
  if (has('pricePerUnit') && has('totalAmount') && !has('quantity') && isPos(p) && isPos(t)) {
    return { field: 'quantity', value: round2(t / p) };
  }
  return null;
}

/** True when quantity × price is clearly different from the total paid. */
export function amountsMismatch(quantity, price, total) {
  if (!isPos(quantity) || !isPos(price) || !isPos(total)) return false;
  return Math.abs(quantity * price - total) > Math.max(1, total * 0.01);
}

// Consistency checks shown on the review screen. Pure code: tested in /tests.
// Each check is { level: 'ok' | 'info' | 'warn', code, message, fields }.

import { amountsMismatch, isPos, sortEntries } from '../core/calc.js';
import { FUEL_TYPES } from '../core/model.js';

const n = (x) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(x);
const rs = (x) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);

/**
 * @param v    review values: { date, quantity, pricePerUnit, totalAmount, odometer, fuelType,
 *             dashboardRangeKm, receiptIsFuel, odometerReadable, sourceImages }
 * @param ctx  { vehicle, entries (that vehicle's), today }
 */
export function reviewChecks(v, { vehicle, entries = [], today }) {
  const out = [];
  const src = v.sourceImages || {};

  if (src.receiptProvided && v.receiptIsFuel === false) {
    out.push({ level: 'warn', code: 'not-fuel-receipt', message: 'The fuel bill photo does not look like a fuel bill or pump display. Check the values or enter them yourself.', fields: [] });
  }
  if (src.odometerProvided && v.odometerReadable === false) {
    out.push({ level: 'warn', code: 'odometer-unreadable', message: 'No odometer reading could be found in the dashboard photo. Enter it yourself.', fields: ['odometer'] });
  }

  if (isPos(v.quantity) && isPos(v.pricePerUnit) && isPos(v.totalAmount)) {
    if (amountsMismatch(v.quantity, v.pricePerUnit, v.totalAmount)) {
      out.push({ level: 'warn', code: 'amount-mismatch', message: `${n(v.quantity)} × ₹${rs(v.pricePerUnit)} = ₹${rs(v.quantity * v.pricePerUnit)}, but the total says ₹${rs(v.totalAmount)}. Check all three.`, fields: ['quantity', 'pricePerUnit', 'totalAmount'] });
    } else {
      out.push({ level: 'ok', code: 'amount-match', message: `Fuel × rate matches the total (₹${rs(v.totalAmount)}).`, fields: [] });
    }
  }
  if (!isPos(v.quantity)) out.push({ level: 'info', code: 'quantity-missing', message: 'Enter the litres filled.', fields: ['quantity'] });
  if (!isPos(v.totalAmount)) out.push({ level: 'info', code: 'amount-missing', message: 'Enter the total amount paid.', fields: ['totalAmount'] });
  if (!v.date) out.push({ level: 'info', code: 'date-missing', message: 'Enter the date of the fill.', fields: ['date'] });
  if (!isPos(v.odometer)) out.push({ level: 'info', code: 'odometer-missing', message: 'Enter the odometer reading. Mileage needs it.', fields: ['odometer'] });

  if (v.fuelType && vehicle && v.fuelType !== vehicle.fuelType) {
    const r = FUEL_TYPES[v.fuelType]?.label || v.fuelType;
    const w = FUEL_TYPES[vehicle.fuelType]?.label || vehicle.fuelType;
    out.push({ level: 'warn', code: 'fuel-type-mismatch', message: `The bill says ${r}, but ${vehicle.nickname} uses ${w}. Check you picked the right vehicle.`, fields: ['fuelType'] });
  }

  if (isPos(v.odometer) && Number.isFinite(v.dashboardRangeKm) && v.odometer === v.dashboardRangeKm) {
    out.push({ level: 'warn', code: 'odometer-is-range', message: 'The odometer equals the remaining range shown on the dashboard. Make sure you used the ODO number.', fields: ['odometer'] });
  }

  const sorted = sortEntries(entries.filter((e) => e.id !== v.id));
  const latest = sorted[sorted.length - 1];
  if (v.date && latest && v.date < latest.date) {
    out.push({ level: 'info', code: 'older-than-latest', message: 'This fill is older than your latest entry. It will be placed by its date and mileage will be recalculated automatically.', fields: ['date'] });
  }
  if (isPos(v.odometer) && latest && v.date >= latest.date && v.odometer > latest.odometer) {
    const gap = v.odometer - latest.odometer;
    const limit = vehicle?.type === 'two' ? 2000 : 3000;
    if (gap > limit) out.push({ level: 'warn', code: 'odometer-jump', message: `That is ${n(gap)} km since your last fill. Check the odometer, or whether a fill is missing.`, fields: ['odometer'] });
  }
  if (v.date && today && v.date > today) out.push({ level: 'warn', code: 'future-date', message: 'The date is in the future. Check the receipt date.', fields: ['date'] });
  return out;
}

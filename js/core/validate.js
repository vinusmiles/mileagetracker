// Validation for vehicles and fuel entries. Returns plain objects so the UI can
// show a message next to each field. In Phase 2, Firestore security rules
// repeat the critical checks on the server.

import { FUEL_TYPES, VEHICLE_TYPES, LIMITS } from './model.js';
import { isValidDateStr } from './dates.js';
import { sortEntries, isPos, amountsMismatch } from './calc.js';

const same = (a, b) => (a == null && b == null) || (isPos(a) && isPos(b) && Math.abs(a - b) < 0.005);

export function validateVehicle(v) {
  const errors = {};
  const nick = (v.nickname || '').trim();
  if (!nick) errors.nickname = 'Give the vehicle a name, such as My bike.';
  else if (nick.length > LIMITS.nicknameMax) errors.nickname = `Keep the name under ${LIMITS.nicknameMax} characters.`;
  if (!VEHICLE_TYPES[v.type]) errors.type = 'Choose two-wheeler or four-wheeler.';
  const fuel = FUEL_TYPES[v.fuelType];
  if (!fuel) errors.fuelType = 'Choose a fuel type.';
  else if (!fuel.enabled) errors.fuelType = `${fuel.label} tracking is not available yet.`;
  if (v.initialOdometer === null || v.initialOdometer === undefined) errors.initialOdometer = 'Enter the current odometer reading.';
  else if (!Number.isFinite(v.initialOdometer) || v.initialOdometer < 0) errors.initialOdometer = 'Enter a reading of 0 km or more.';
  else if (v.initialOdometer > LIMITS.odometerMax) errors.initialOdometer = 'That reading is too large.';
  for (const f of ['make', 'model', 'registration']) {
    if ((v[f] || '').length > LIMITS.textMax) errors[f] = `Keep this under ${LIMITS.textMax} characters.`;
  }
  return errors;
}

/**
 * @param entry  the entry being saved (has an id when editing)
 * @param ctx    { vehicle, entries: that vehicle's saved entries, today: 'YYYY-MM-DD' }
 * @returns      { errors: { field: message }, warnings: [{ code, ... }] }
 */
export function validateEntry(entry, { vehicle, entries = [], today }) {
  const errors = {};
  const warnings = [];

  if (!entry.vehicleId || !vehicle) errors.vehicleId = 'Choose a vehicle.';

  if (!entry.date) errors.date = 'Enter the date of the fill.';
  else if (!isValidDateStr(entry.date)) errors.date = 'Enter a real date.';
  else if (entry.date > today) errors.date = 'The date cannot be in the future.';
  else if (entry.date < LIMITS.earliestDate) errors.date = 'That date is too far in the past.';

  const q = entry.quantity;
  if (q === null || q === undefined) errors.quantity = 'Enter how much fuel you filled.';
  else if (!isPos(q)) errors.quantity = 'Fuel quantity must be more than 0.';
  else if (q > LIMITS.quantityMax) errors.quantity = 'That quantity is too large.';

  const p = entry.pricePerUnit;
  if (p !== null && p !== undefined && !isPos(p)) errors.pricePerUnit = 'Price must be more than 0, or leave it empty.';

  const t = entry.totalAmount;
  if (t === null || t === undefined) errors.totalAmount = 'Enter the total amount paid.';
  else if (!isPos(t)) errors.totalAmount = 'Amount must be more than ₹0.';
  else if (t > LIMITS.amountMax) errors.totalAmount = 'That amount is too large.';

  const o = entry.odometer;
  if (o === null || o === undefined) errors.odometer = 'Enter the odometer reading.';
  else if (!isPos(o)) errors.odometer = 'Odometer reading must be more than 0 km.';
  else if (o > LIMITS.odometerMax) errors.odometer = 'That reading is too large.';

  if ((entry.station || '').length > LIMITS.textMax) errors.station = `Keep this under ${LIMITS.textMax} characters.`;
  if ((entry.notes || '').length > LIMITS.notesMax) errors.notes = `Keep notes under ${LIMITS.notesMax} characters.`;

  if (Object.keys(errors).length) return { errors, warnings };

  const others = sortEntries(entries.filter((e) => e.id !== entry.id && e.vehicleId === entry.vehicleId));

  const dup = others.find((e) => e.date === entry.date && e.odometer === o && same(e.quantity, q) && same(e.totalAmount, t));
  if (dup) {
    errors._form = 'This fill is already saved: same date, odometer, quantity and amount.';
    return { errors, warnings };
  }

  const before = others.filter((e) => e.date <= entry.date);
  const after = others.filter((e) => e.date > entry.date);
  const prev = before[before.length - 1];
  const next = after[0];
  if (prev && o < prev.odometer) {
    warnings.push({ code: 'odometer-lower', previous: prev });
  } else if (!prev && vehicle && Number.isFinite(vehicle.initialOdometer) && o < vehicle.initialOdometer) {
    warnings.push({ code: 'below-initial', initial: vehicle.initialOdometer });
  }
  if (next && o > next.odometer) warnings.push({ code: 'odometer-higher', next });
  if (amountsMismatch(q, p, t)) warnings.push({ code: 'amount-mismatch' });

  return { errors, warnings };
}

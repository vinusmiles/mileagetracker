import { test, assert } from './harness.js';
import {
  analyseVehicle, monthlyTotals, totals, inRange, deriveAmounts, amountsMismatch, toNum,
} from '../js/core/calc.js';
import { validateEntry, validateVehicle } from '../js/core/validate.js';
import { isValidDateStr, lastMonths, monthRange } from '../js/core/dates.js';

let n = 0;
const fill = (o) => ({
  id: `e${++n}`, vehicleId: 'bike', date: '2026-10-01', quantity: 5, pricePerUnit: null,
  totalAmount: 500, station: '', odometer: 10000, fullTank: false, notes: '', ...o,
});
const bike = { id: 'bike', initialOdometer: 9000, fuelType: 'petrol' };
const TODAY = '2026-10-22';

// ---- Mileage --------------------------------------------------------------

test('Spec example: 350 km on 15 litres = 23.33 km/L', () => {
  const { summary, intervals } = analyseVehicle([
    fill({ date: '2026-10-01', odometer: 10000, quantity: 8, fullTank: true }),
    fill({ date: '2026-10-05', odometer: 10200, quantity: 5 }),
    fill({ date: '2026-10-09', odometer: 10350, quantity: 10, fullTank: true }),
  ]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].distance, 350);
  assert.equal(intervals[0].fuel, 15, 'starting fill excluded;');
  assert.close(summary.latestMileage, 23.33);
  assert.equal(summary.status, 'ok');
});

test('First fuel entry gives no mileage', () => {
  const { summary } = analyseVehicle([fill({ fullTank: true })]);
  assert.equal(summary.latestMileage, null);
  assert.equal(summary.status, 'need-next-full');
});

test('Only partial fills: asks for a full tank', () => {
  const { summary } = analyseVehicle([fill({}), fill({ odometer: 10100, date: '2026-10-03' })]);
  assert.equal(summary.latestMileage, null);
  assert.equal(summary.status, 'need-full-tank');
});

test('No entries at all', () => {
  const { summary } = analyseVehicle([], bike);
  assert.equal(summary.status, 'no-entries');
  assert.equal(summary.latestOdometer, 9000, 'falls back to the vehicle odometer;');
});

test('Two full-tank entries', () => {
  const { summary } = analyseVehicle([
    fill({ date: '2026-09-01', odometer: 12000, fullTank: true }),
    fill({ date: '2026-09-10', odometer: 12240, quantity: 5, fullTank: true }),
  ]);
  assert.close(summary.latestMileage, 48);
});

test('Partial fill after the last full tank: mileage waits for the next full tank', () => {
  const { summary, intervals } = analyseVehicle([
    fill({ date: '2026-09-01', odometer: 12000, fullTank: true }),
    fill({ date: '2026-09-10', odometer: 12240, quantity: 5, fullTank: true }),
    fill({ date: '2026-09-15', odometer: 12400, quantity: 2 }),
  ]);
  assert.equal(intervals.length, 1);
  assert.close(summary.latestMileage, 48);
});

test('Several intervals: average is total km / total litres, not the mean of mileages', () => {
  const { summary } = analyseVehicle([
    fill({ date: '2026-08-01', odometer: 1000, fullTank: true }),
    fill({ date: '2026-08-10', odometer: 1100, quantity: 10, fullTank: true }), // 10 km/L
    fill({ date: '2026-08-20', odometer: 1400, quantity: 10, fullTank: true }), // 30 km/L
  ]);
  assert.close(summary.latestMileage, 30);
  assert.close(summary.averageMileage, 20, 0.01, '400 km / 20 L;');
});

test('Missing fuel price does not affect mileage or totals', () => {
  const { summary } = analyseVehicle([
    fill({ date: '2026-09-01', odometer: 5000, fullTank: true, pricePerUnit: null }),
    fill({ date: '2026-09-09', odometer: 5250, quantity: 5, totalAmount: 520, fullTank: true, pricePerUnit: null }),
  ]);
  assert.close(summary.latestMileage, 50);
  assert.close(summary.totalSpend, 1020);
  assert.close(summary.costPerKm, 2.08);
});

test('Missing optional station and notes are fine', () => {
  const e = fill({ station: undefined, notes: undefined, fullTank: true });
  const { summary } = analyseVehicle([e]);
  assert.equal(summary.entryCount, 1);
  const { errors } = validateEntry({ ...e, id: undefined }, { vehicle: bike, entries: [], today: TODAY });
  assert.equal(Object.keys(errors).length, 0);
});

test('Decreasing odometer: interval is flagged, no mileage shown', () => {
  const { summary, intervals, rows } = analyseVehicle([
    fill({ date: '2026-09-01', odometer: 5000, fullTank: true }),
    fill({ date: '2026-09-05', odometer: 4800, quantity: 3 }),
    fill({ date: '2026-09-09', odometer: 5300, quantity: 5, fullTank: true }),
  ]);
  assert.equal(rows[1].issue, 'odometer-decrease');
  assert.equal(intervals[0].valid, false);
  assert.equal(summary.latestMileage, null);
  assert.equal(summary.status, 'check-readings');
  assert.equal(summary.issueCount, 1);
});

test('A bad interval does not spoil the next good one', () => {
  const { summary } = analyseVehicle([
    fill({ date: '2026-09-01', odometer: 5000, fullTank: true }),
    fill({ date: '2026-09-05', odometer: 4800, quantity: 3, fullTank: true }),
    fill({ date: '2026-09-09', odometer: 5040, quantity: 5, fullTank: true }),
  ]);
  assert.close(summary.latestMileage, 48);
});

test('Entries out of order are sorted by date before calculating', () => {
  const { summary } = analyseVehicle([
    fill({ date: '2026-10-09', odometer: 10350, quantity: 10, fullTank: true }),
    fill({ date: '2026-10-01', odometer: 10000, quantity: 8, fullTank: true }),
    fill({ date: '2026-10-05', odometer: 10200, quantity: 5 }),
  ]);
  assert.close(summary.latestMileage, 23.33);
});

test('Multiple vehicles keep separate histories', () => {
  const all = [
    fill({ vehicleId: 'bike', date: '2026-09-01', odometer: 1000, fullTank: true }),
    fill({ vehicleId: 'car', date: '2026-09-01', odometer: 50000, fullTank: true }),
    fill({ vehicleId: 'bike', date: '2026-09-10', odometer: 1240, quantity: 5, fullTank: true }),
    fill({ vehicleId: 'car', date: '2026-09-12', odometer: 50600, quantity: 40, fullTank: true }),
  ];
  const bikeR = analyseVehicle(all.filter((e) => e.vehicleId === 'bike'));
  const carR = analyseVehicle(all.filter((e) => e.vehicleId === 'car'));
  assert.close(bikeR.summary.latestMileage, 48);
  assert.close(carR.summary.latestMileage, 15);
});

// ---- Expenses -------------------------------------------------------------

test('Monthly expense totals', () => {
  const m = monthlyTotals([
    fill({ date: '2026-09-03', totalAmount: 500.5, quantity: 5 }),
    fill({ date: '2026-09-28', totalAmount: 300.25, quantity: 3 }),
    fill({ date: '2026-10-02', totalAmount: 1000, quantity: 9.5 }),
  ]);
  assert.close(m['2026-09'].amount, 800.75);
  assert.close(m['2026-09'].quantity, 8);
  assert.equal(m['2026-09'].count, 2);
  assert.close(m['2026-10'].amount, 1000);
});

test('Date range filter is inclusive', () => {
  const list = [fill({ date: '2026-09-30' }), fill({ date: '2026-10-01' }), fill({ date: '2026-10-31' }), fill({ date: '2026-11-01' })];
  const { from, to } = monthRange('2026-10');
  assert.equal(inRange(list, from, to).length, 2);
  assert.equal(totals(inRange(list, from, to)).amount, 1000);
});

test('Month helpers', () => {
  assert.equal(lastMonths('2026-02-15', 3).join(','), '2025-12,2026-01,2026-02');
  assert.equal(monthRange('2028-02').to, '2028-02-29');
});

// ---- Form amounts ---------------------------------------------------------

test('Quantity + price -> total', () => {
  const r = deriveAmounts({ quantity: '5.2', pricePerUnit: '103.5' }, new Set(['quantity', 'pricePerUnit']));
  assert.equal(r.field, 'totalAmount');
  assert.close(r.value, 538.2);
});

test('Quantity + total -> price per litre', () => {
  const r = deriveAmounts({ quantity: '4.85', totalAmount: '500' }, new Set(['quantity', 'totalAmount']));
  assert.equal(r.field, 'pricePerUnit');
  assert.close(r.value, 103.09);
});

test('Total alone: nothing is calculated', () => {
  assert.equal(deriveAmounts({ totalAmount: '500' }, new Set(['totalAmount'])), null);
});

test('Number parsing accepts commas and rejects text', () => {
  assert.equal(toNum('1,234.5'), 1234.5);
  assert.equal(toNum(''), null);
  assert.ok(Number.isNaN(toNum('abc')));
});

test('Mismatch warning when quantity × price is far from total', () => {
  assert.ok(amountsMismatch(5, 100, 600));
  assert.ok(!amountsMismatch(5, 100, 500.4));
});

// ---- Validation -----------------------------------------------------------

const good = () => ({ vehicleId: 'bike', date: '2026-10-20', quantity: 5, pricePerUnit: null, totalAmount: 520, odometer: 10400, fullTank: true });

test('Zero or negative quantity is rejected', () => {
  assert.ok(validateEntry({ ...good(), quantity: 0 }, { vehicle: bike, today: TODAY }).errors.quantity);
  assert.ok(validateEntry({ ...good(), quantity: -2 }, { vehicle: bike, today: TODAY }).errors.quantity);
});

test('Missing required fields are rejected', () => {
  const { errors } = validateEntry({ vehicleId: 'bike' }, { vehicle: bike, today: TODAY });
  for (const f of ['date', 'quantity', 'totalAmount', 'odometer']) assert.ok(errors[f], `${f} should be required`);
});

test('Future and impossible dates are rejected', () => {
  assert.ok(validateEntry({ ...good(), date: '2026-10-23' }, { vehicle: bike, today: TODAY }).errors.date);
  assert.ok(validateEntry({ ...good(), date: '2026-02-30' }, { vehicle: bike, today: TODAY }).errors.date);
  assert.ok(!isValidDateStr('22-10-2026'));
});

test('Duplicate submission is blocked', () => {
  const saved = { ...good(), id: 'x1' };
  const { errors } = validateEntry(good(), { vehicle: bike, entries: [saved], today: TODAY });
  assert.ok(errors._form);
});

test('Editing an entry is not treated as its own duplicate', () => {
  const saved = { ...good(), id: 'x1' };
  const { errors } = validateEntry({ ...saved }, { vehicle: bike, entries: [saved], today: TODAY });
  assert.equal(Object.keys(errors).length, 0);
});

test('Lower odometer than previous fill gives a warning', () => {
  const prev = { ...good(), id: 'p', date: '2026-10-10', odometer: 10500 };
  const { errors, warnings } = validateEntry(good(), { vehicle: bike, entries: [prev], today: TODAY });
  assert.equal(Object.keys(errors).length, 0);
  assert.equal(warnings[0].code, 'odometer-lower');
});

test('Vehicle needs a name, type, fuel and odometer', () => {
  const e = validateVehicle({ nickname: ' ', type: 'x', fuelType: 'cng', initialOdometer: null });
  for (const f of ['nickname', 'type', 'fuelType', 'initialOdometer']) assert.ok(e[f], `${f} should fail`);
  const ok = validateVehicle({ nickname: 'My bike', type: 'two', fuelType: 'petrol', initialOdometer: 0 });
  assert.equal(Object.keys(ok).length, 0);
});

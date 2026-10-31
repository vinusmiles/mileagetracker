// Service record logic. Summary figures come from the sample Tata Nexon invoice
// (parts ₹6,940.99, labour ₹6,179.07, gross ₹13,120.06, adjustment −0.06, total ₹13,120.00).
// They live only in tests, never in the app.
import { test, assert } from './harness.js';
import { itemTotals, reconcile, serviceCost, partsLabourSplit, findServiceDuplicates, odometerTimeline, checkServiceOdometer, cleanItems } from '../js/core/service.js';

const nexonSummary = { partsTaxable: 5886.39, partsTotal: 6940.99, labourTotal: 6179.07, cgst: 998.58, sgst: 998.58, grossAmount: 13120.06, adjustments: -0.06, grandTotal: 13120.00 };
const codes = (l) => l.map((c) => c.code);
const item = (o) => ({ description: 'x', section: 'maintenance', kind: 'part', total: 0, ...o });

test('Service: Nexon summary reconciles (gross + adjustment = total, parts + labour = total)', () => {
  const c = reconcile({ financialSummary: nexonSummary, items: [] });
  assert.ok(codes(c).includes('gross-matches'));
  assert.ok(!codes(c).includes('split-mismatch'), 'parts + labour + adjustment should match');
  assert.equal(serviceCost({ financialSummary: nexonSummary }), 13120);
});

test('Service: line items checked against parts and labour totals (±₹1 rounding)', () => {
  const items = [item({ kind: 'part', total: 3069.50 }), item({ kind: 'part', total: 3871.48 }), item({ kind: 'labour', total: 6179.40 })];
  const c = reconcile({ financialSummary: nexonSummary, items });
  assert.ok(codes(c).includes('parts-match'), 'parts within ₹1');
  assert.ok(codes(c).includes('labour-match'), 'labour within ₹1');
});

test('Service: a repeated line (double counting) is flagged', () => {
  const items = [item({ kind: 'part', total: 3069.50 }), item({ kind: 'part', total: 3871.48 }), item({ kind: 'part', total: 3871.48 })];
  assert.ok(codes(reconcile({ financialSummary: nexonSummary, items })).includes('parts-mismatch'));
});

test('Service: without a summary, items are compared with the grand total', () => {
  const r = { financialSummary: { grandTotal: 1500 }, items: [item({ total: 1000 }), item({ kind: 'labour', total: 500 })] };
  assert.ok(codes(reconcile(r)).includes('items-match'));
  assert.ok(codes(reconcile({ ...r, financialSummary: { grandTotal: 1700 } })).includes('items-mismatch'));
});

test('Service: missing grand total asks for it and cost falls back to items', () => {
  const r = { financialSummary: {}, items: [item({ total: 700 }), item({ kind: 'labour', total: 300 })] };
  assert.ok(codes(reconcile(r)).includes('no-total'));
  assert.equal(serviceCost(r), 1000);
  const t = itemTotals(r.items);
  assert.equal(t.parts, 700); assert.equal(t.labour, 300); assert.equal(t.partsCount, 1);
});

test('Service: parts/labour split prefers the invoice summary', () => {
  assert.equal(partsLabourSplit({ financialSummary: nexonSummary, items: [] }).parts, 6940.99);
  assert.equal(partsLabourSplit({ financialSummary: {}, items: [item({ total: 50 })] }).parts, 50);
});

test('Service: duplicates by invoice number, job card, or date + total', () => {
  const saved = { id: 's1', vehicleId: 'car', invoiceNumber: 'IORAAG2627002614', jobCardNumber: 'JC-1', serviceDate: '2026-10-30', financialSummary: { grandTotal: 13120 }, items: [] };
  assert.ok(findServiceDuplicates({ vehicleId: 'car', invoiceNumber: 'ioraag 2627002614' }, [saved])[0].strong);
  assert.equal(findServiceDuplicates({ vehicleId: 'car', serviceDate: '2026-10-30', financialSummary: { grandTotal: 13120 }, items: [] }, [saved])[0].strong, false);
  assert.equal(findServiceDuplicates({ vehicleId: 'bike', invoiceNumber: 'IORAAG2627002614' }, [saved]).length, 0);
  assert.equal(findServiceDuplicates({ ...saved }, [saved]).length, 0, 'editing is not a duplicate;');
});

test('Service: odometer joins the fuel timeline; lower reading is flagged', () => {
  const fuel = [{ id: 'f1', date: '2026-10-18', odometer: 18885 }, { id: 'f2', date: '2026-11-05', odometer: 20150 }];
  const tl = odometerTimeline(fuel, [{ id: 's1', serviceDate: '2026-10-30', odometerKm: 19381 }]);
  assert.equal(tl.map((t) => t.km).join(), '18885,19381,20150');
  assert.equal(checkServiceOdometer({ id: 's1', serviceDate: '2026-10-30', odometerKm: 19381 }, tl).length, 0);
  assert.equal(checkServiceOdometer({ serviceDate: '2026-10-30', odometerKm: 18000 }, tl)[0].code, 'lower-than-before');
  assert.equal(checkServiceOdometer({ serviceDate: '2026-10-30', odometerKm: 21000 }, tl)[0].code, 'higher-than-after');
});

test('Service: blank lines are removed', () => {
  assert.equal(cleanItems([item({ description: '  ', total: null }), item({ description: 'Oil', total: 10 })]).length, 1);
});

import { normaliseInvoice } from '../js/smart/invoice-schema.js';
test('Invoice schema: cleans values, keeps only chassis last 4, never guesses', () => {
  const x = normaliseInvoice({
    serviceDate: '2026-10-30', jobCardDate: '29/10/2026', serviceType: 'Paid Service', vin: 'MAT627027PLD52055',
    odometerKm: '19,381', customerName: 'Someone', phone: '999', items: [{ description: 'Coolant', kind: 'part', total: '1,424.49' }, { description: '' }],
    financialSummary: { grandTotal: '13,120.00', adjustments: '-0.06' }, fieldsNeedingReview: ['odometerKm', 'bogus'],
  });
  assert.equal(x.serviceDate, '2026-10-30');
  assert.equal(x.jobCardDate, null); assert.ok(x.fieldsNeedingReview.includes('jobCardDate'));
  assert.equal(x.serviceType, 'paid'); assert.equal(x.vinLast4, '2055'); assert.equal(x.odometerKm, 19381);
  assert.equal(x.items.length, 1); assert.equal(x.items[0].total, 1424.49);
  assert.equal(x.financialSummary.grandTotal, 13120); assert.equal(x.financialSummary.adjustments, -0.06);
  assert.ok(!('customerName' in x) && !('phone' in x));
  assert.ok(!x.fieldsNeedingReview.includes('bogus'));
});

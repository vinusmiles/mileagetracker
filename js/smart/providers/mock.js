// DEMO READER for Stage 1. It does not look at the photos at all.
// It returns invented values so the capture and review screens can be built
// and tested before the real reader (Stage 2) exists. Every value it returns
// is labelled as demo data in the interface.

import { todayStr } from '../../core/dates.js';
import { round2 } from '../../core/calc.js';

export const info = {
  id: 'mock',
  label: 'Demo reader',
  isDemo: true,
  privacy: 'Demo mode: your photos stay on this device. Nothing is uploaded.',
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function extract({ receipt, odometer, vehicle, lastEntry, onProgress, signal }) {
  const step = async (id) => { onProgress?.(id); await wait(550); if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  await step('send');
  if (location.hash.includes('demo=fail')) { await step('read'); throw new Error('Demo reader: simulated failure (remove demo=fail from the address to stop this).'); }

  const two = vehicle?.type === 'two';
  const out = { fieldsNeedingReview: [] };
  await step('read');
  if (receipt) {
    const qty = two ? 4.5 : 25;
    const price = 105.5;
    Object.assign(out, {
      fuelCompany: 'Demo Petroleum', fuelStation: 'Demo Fuel Station', location: 'Sample Road',
      fuelType: vehicle?.fuelType || 'petrol', transactionDate: todayStr(), transactionTime: '09:30',
      quantityLitres: qty, pricePerLitre: price, totalAmount: round2(qty * price), receiptNumber: 'DEMO-0001',
      receiptIsFuel: true,
    });
    out.fieldsNeedingReview.push('fuelStation');
  }
  if (odometer) {
    const base = lastEntry?.odometer ?? vehicle?.initialOdometer ?? 10000;
    Object.assign(out, { odometerKm: base + (two ? 180 : 420), dashboardRangeKm: two ? 150 : 380, dashboardTime: '09:35', odometerReadable: true });
    out.fieldsNeedingReview.push('odometerKm');
  }
  return out;
}

/** DEMO invoice reader for Stage 1: ignores the pages and returns made-up values. */
export async function extractInvoice({ pages, vehicle, latestOdometer, onProgress }) {
  onProgress?.('send'); await wait(500);
  onProgress?.('read'); await wait(500 + pages.length * 300);
  const two = vehicle?.type === 'two';
  const items = two
    ? [
      { description: 'Demo engine oil', kind: 'part', section: 'maintenance', qty: 1, unit: 'Ltr', rate: 400, taxable: 400, cgst: 36, sgst: 36, total: 472 },
      { description: 'Demo general service labour', kind: 'labour', section: 'maintenance', qty: 1, rate: 350, taxable: 350, cgst: 31.5, sgst: 31.5, total: 413 },
      { description: 'Demo washing', kind: 'labour', section: 'optional', qty: 1, rate: 100, taxable: 100, cgst: 9, sgst: 9, total: 118, needsReview: true },
    ]
    : [
      { description: 'Demo engine oil 3.5 L', kind: 'part', section: 'maintenance', qty: 3.5, unit: 'Ltr', rate: 600, taxable: 2100, cgst: 189, sgst: 189, total: 2478 },
      { description: 'Demo oil filter', kind: 'part', section: 'maintenance', qty: 1, rate: 300, taxable: 300, cgst: 27, sgst: 27, total: 354 },
      { description: 'Demo periodic service labour', kind: 'labour', section: 'maintenance', qty: 1, rate: 1500, taxable: 1500, cgst: 135, sgst: 135, total: 1770 },
      { description: 'Demo car wash', kind: 'labour', section: 'optional', qty: 1, rate: 500, taxable: 500, cgst: 45, sgst: 45, total: 590, needsReview: true },
    ];
  const parts = items.filter((i) => i.kind === 'part').reduce((s, i) => s + i.total, 0);
  const labour = items.filter((i) => i.kind === 'labour').reduce((s, i) => s + i.total, 0);
  return {
    serviceCentre: 'Demo Service Centre', serviceCentreLocation: 'Sample Road', invoiceNumber: 'DEMO-INV-001',
    serviceDate: todayStr(), jobCardNumber: 'DEMO-JC-001', jobCardDate: todayStr(), serviceType: 'Paid Service',
    odometerKm: (latestOdometer || 10000) + (two ? 150 : 450), paymentMethod: 'Cash', warranty: null,
    items,
    financialSummary: { partsTotal: parts, labourTotal: labour, grossAmount: parts + labour, adjustments: 0, grandTotal: parts + labour },
    nextServiceDate: null, nextServiceKm: (latestOdometer || 10000) + (two ? 6150 : 15450), nextServiceNotes: 'Demo: next periodic service',
    fieldsNeedingReview: ['odometerKm', 'serviceCentre'],
  };
}

/** DEMO challan reader: made-up values, clearly labelled in the app. */
export async function extractChallan({ onProgress }) {
  onProgress?.('send'); await wait(400); onProgress?.('read'); await wait(600);
  return { date: todayStr(), amount: 1000, offence: 'Demo: riding without helmet', challanNumber: 'DEMO-CH-001', location: 'Demo junction', status: 'unpaid' };
}

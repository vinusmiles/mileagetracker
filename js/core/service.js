// Service and maintenance records: pure logic, no DOM or storage (tested in /tests).
//
// A record keeps every invoice line in one flexible list, items[], each tagged
//   section: 'maintenance' | 'optional'      (where it appears on the invoice)
//   kind:    'part' | 'labour' | 'other'     (what it is)
// so any garage's layout fits, and screens can group items however they need.

import { isPos, round2 } from './calc.js';

export const SERVICE_TYPES = {
  free: 'Free service',
  paid: 'Paid service',
  general: 'General service',
  periodic: 'Periodic maintenance',
  repair: 'Repair',
  breakdown: 'Breakdown repair',
  accident: 'Accidental repair',
  other: 'Other',
};

export const ITEM_KINDS = { part: 'Part', labour: 'Labour / service', other: 'Other' };
export const ITEM_SECTIONS = { maintenance: 'Maintenance & repair', optional: 'Optional service' };

export const SUMMARY_FIELDS = {
  partsTaxable: 'Parts taxable amount',
  partsTotal: 'Parts total (incl. tax)',
  labourTaxable: 'Labour taxable amount',
  labourTotal: 'Labour total (incl. tax)',
  discounts: 'Discounts',
  additionalCharges: 'Additional charges',
  taxableAmount: 'Taxable amount',
  cgst: 'CGST',
  sgst: 'SGST',
  otherTax: 'Other taxes',
  grossAmount: 'Gross amount',
  adjustments: 'Adjustments / round-off',
  grandTotal: 'Grand total',
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (list, f) => round2(list.reduce((s, x) => s + (num(f(x)) || 0), 0));

/** Totals worked out from the line items. */
export function itemTotals(items = []) {
  const parts = items.filter((i) => i.kind === 'part');
  const labour = items.filter((i) => i.kind === 'labour');
  return {
    count: items.length,
    partsCount: parts.length,
    parts: sum(parts, (i) => i.total),
    labour: sum(labour, (i) => i.total),
    other: sum(items.filter((i) => i.kind !== 'part' && i.kind !== 'labour'), (i) => i.total),
    optional: sum(items.filter((i) => i.section === 'optional'), (i) => i.total),
    all: sum(items, (i) => i.total),
    taxable: sum(items, (i) => i.taxable),
    cgst: sum(items, (i) => i.cgst),
    sgst: sum(items, (i) => i.sgst),
  };
}

/** The amount actually paid: the grand total, or the items' sum if no total was entered. */
export function serviceCost(record) {
  const g = num(record.financialSummary?.grandTotal);
  return g !== null ? g : itemTotals(record.items).all;
}

/** Parts and labour split for analytics; prefers the invoice summary, falls back to items. */
export function partsLabourSplit(record) {
  const s = record.financialSummary || {};
  const t = itemTotals(record.items);
  return { parts: num(s.partsTotal) ?? t.parts, labour: num(s.labourTotal) ?? t.labour };
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const fmt = (n) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

/**
 * Check the invoice adds up. Returns [{ level: 'ok'|'warn'|'info', code, message }].
 * Tolerance is ₹1, because invoices round each line.
 */
export function reconcile(record) {
  const out = [];
  const s = record.financialSummary || {};
  const t = itemTotals(record.items);
  const g = num(s.grandTotal);

  if (g === null) out.push({ level: 'info', code: 'no-total', message: t.count ? `Enter the grand total. The items add up to ${fmt(t.all)}.` : 'Enter the grand total paid.' });

  const gross = num(s.grossAmount);
  if (gross !== null && g !== null) {
    const adj = num(s.adjustments) || 0;
    if (near(gross + adj, g, 0.05)) out.push({ level: 'ok', code: 'gross-matches', message: `Gross ${fmt(gross)}${adj ? ` with adjustment ${fmt(adj)}` : ''} gives the grand total ${fmt(g)}.` });
    else out.push({ level: 'warn', code: 'gross-mismatch', message: `Gross ${fmt(gross)}${adj ? ` and adjustment ${fmt(adj)}` : ''} do not give the grand total ${fmt(g)}.` });
  }

  const pt = num(s.partsTotal);
  const lt = num(s.labourTotal);
  if (pt !== null && lt !== null && g !== null) {
    const both = pt + lt + (num(s.adjustments) || 0);
    if (!near(both, g)) out.push({ level: 'warn', code: 'split-mismatch', message: `Parts ${fmt(pt)} + labour ${fmt(lt)} do not add up to the grand total ${fmt(g)}.` });
  }

  if (t.count) {
    if (pt !== null && t.partsCount) {
      if (near(t.parts, pt)) out.push({ level: 'ok', code: 'parts-match', message: `Parts lines add up to the parts total (${fmt(pt)}).` });
      else out.push({ level: 'warn', code: 'parts-mismatch', message: `Parts lines add up to ${fmt(t.parts)}, but the parts total says ${fmt(pt)}. A line may be missing, repeated or in the wrong category.` });
    }
    if (lt !== null && t.labour) {
      if (near(t.labour, lt)) out.push({ level: 'ok', code: 'labour-match', message: `Labour lines add up to the labour total (${fmt(lt)}).` });
      else out.push({ level: 'warn', code: 'labour-mismatch', message: `Labour lines add up to ${fmt(t.labour)}, but the labour total says ${fmt(lt)}.` });
    }
    if (g !== null && pt === null && lt === null) {
      const target = g - (num(s.adjustments) || 0);
      if (near(t.all, target)) out.push({ level: 'ok', code: 'items-match', message: `All lines add up to the grand total (${fmt(g)}).` });
      else out.push({ level: 'warn', code: 'items-mismatch', message: `All lines add up to ${fmt(t.all)}, but the grand total is ${fmt(g)}.` });
    }
    const zeroLines = (record.items || []).filter((i) => !isPos(num(i.total)) && !(i.description || '').trim()).length;
    if (zeroLines) out.push({ level: 'info', code: 'empty-lines', message: `${zeroLines} empty line${zeroLines === 1 ? '' : 's'} will be removed when you save.` });
  }
  return out;
}

/**
 * Possible duplicate service records (warn only; the user decides).
 * Strong: same invoice number, or same job card number. Possible: same date and grand total.
 */
export function findServiceDuplicates(c, records) {
  const clean = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  const out = [];
  for (const r of records) {
    if (r.id === c.id || r.vehicleId !== c.vehicleId) continue;
    const reasons = [];
    let strong = false;
    if (c.invoiceNumber && clean(c.invoiceNumber) === clean(r.invoiceNumber)) { reasons.push('same invoice number'); strong = true; }
    if (c.jobCardNumber && clean(c.jobCardNumber) === clean(r.jobCardNumber)) { reasons.push('same job card number'); strong = true; }
    const cg = serviceCost(c);
    if (c.serviceDate && c.serviceDate === r.serviceDate && cg && near(cg, serviceCost(r))) reasons.push('same date and total');
    if (reasons.length) out.push({ record: r, reasons, strong });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong));
}

/**
 * The vehicle's odometer timeline from fuel entries and service records.
 * Returns readings sorted by date: [{ date, km, source: 'fuel' | 'service', id }].
 */
export function odometerTimeline(entries = [], services = []) {
  const list = [
    ...entries.filter((e) => isPos(e.odometer)).map((e) => ({ date: e.date, km: e.odometer, source: 'fuel', id: e.id })),
    ...services.filter((s) => isPos(s.odometerKm)).map((s) => ({ date: s.serviceDate, km: s.odometerKm, source: 'service', id: s.id })),
  ];
  return list.sort((a, b) => (a.date === b.date ? a.km - b.km : a.date < b.date ? -1 : 1));
}

/** Warnings for a service odometer reading against the timeline (excluding the record itself). */
export function checkServiceOdometer({ id, serviceDate, odometerKm }, timeline) {
  if (!isPos(odometerKm) || !serviceDate) return [];
  const others = timeline.filter((t) => !(t.source === 'service' && t.id === id));
  const before = others.filter((t) => t.date <= serviceDate);
  const after = others.filter((t) => t.date > serviceDate);
  const prev = before[before.length - 1];
  const next = after[0];
  const out = [];
  if (prev && odometerKm < prev.km) out.push({ code: 'lower-than-before', reading: prev });
  if (next && odometerKm > next.km) out.push({ code: 'higher-than-after', reading: next });
  return out;
}

/** Drop blank lines and coerce numbers. */
export function cleanItems(items = []) {
  return items
    .map((i) => ({ ...i, description: String(i.description || '').trim().slice(0, 160) }))
    .filter((i) => i.description || isPos(num(i.total)));
}

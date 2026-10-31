// Cleans whatever an invoice reader returns into the service-record shape.
// Rules as for fuel: unreadable values become null (never guessed); anything the
// reader was unsure about is listed in fieldsNeedingReview, and line items carry
// needsReview. Personal details (customer name, phone, address, insurance) are
// never accepted, and only the last 4 characters of a chassis number are kept.

import { toNum, round2 } from '../core/calc.js';
import { isValidDateStr } from '../core/dates.js';
import { SERVICE_TYPES, SUMMARY_FIELDS } from '../core/service.js';

export const INVOICE_FIELDS = ['serviceCentre', 'serviceCentreLocation', 'invoiceNumber', 'serviceDate', 'jobCardNumber', 'jobCardDate',
  'serviceType', 'vehicleMake', 'vehicleModel', 'registration', 'vinLast4', 'odometerKm', 'paymentMethod', 'warranty'];

const text = (v, max = 120) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const money = (v) => { const n = toNum(v); return n === null || Number.isNaN(n) ? null : round2(n); };

export function normaliseServiceType(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (SERVICE_TYPES[s]) return s;
  if (s.includes('free')) return 'free';
  if (s.includes('accident') || s.includes('insurance')) return 'accident';
  if (s.includes('breakdown')) return 'breakdown';
  if (s.includes('periodic') || s.includes('pms')) return 'periodic';
  if (s.includes('repair') || s.includes('running')) return 'repair';
  if (s.includes('general')) return 'general';
  if (s.includes('paid')) return 'paid';
  return 'other';
}

function cleanItem(i) {
  const kind = ['part', 'labour', 'other'].includes(i?.kind) ? i.kind : 'other';
  const section = i?.section === 'optional' ? 'optional' : 'maintenance';
  const out = {
    description: text(i?.description, 160) || '',
    kind, section,
    code: text(i?.code, 40),
    qty: money(i?.qty), unit: text(i?.unit, 20), rate: money(i?.rate), discount: money(i?.discount),
    taxable: money(i?.taxable), cgst: money(i?.cgst), sgst: money(i?.sgst), total: money(i?.total),
  };
  if (i?.needsReview) out.needsReview = true;
  return out;
}

export function normaliseInvoice(raw) {
  const r = raw || {};
  const review = new Set((r.fieldsNeedingReview || []).filter((f) => INVOICE_FIELDS.includes(f) || f.startsWith('summary.')));
  const out = { fieldsNeedingReview: [] };
  for (const f of ['serviceCentre', 'serviceCentreLocation', 'invoiceNumber', 'jobCardNumber', 'vehicleMake', 'vehicleModel', 'registration', 'paymentMethod', 'warranty']) out[f] = text(r[f]);
  for (const f of ['serviceDate', 'jobCardDate']) {
    out[f] = r[f] ? (isValidDateStr(r[f]) ? r[f] : null) : null;
    if (r[f] && !out[f]) review.add(f);
  }
  out.serviceType = normaliseServiceType(r.serviceType);
  const vin = text(r.vin || r.vinLast4, 40);
  out.vinLast4 = vin ? vin.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase() : null;
  const odo = toNum(r.odometerKm);
  out.odometerKm = odo === null || Number.isNaN(odo) || odo <= 0 ? null : Math.round(odo);
  if (r.odometerKm != null && out.odometerKm === null) review.add('odometerKm');
  out.items = (Array.isArray(r.items) ? r.items : []).slice(0, 200).map(cleanItem).filter((i) => i.description || i.total !== null);
  out.financialSummary = {};
  for (const k of Object.keys(SUMMARY_FIELDS)) out.financialSummary[k] = money(r.financialSummary?.[k]);
  out.fieldsNeedingReview = [...review];
  return out;
}

// Documents: RC, insurance, pollution, driving licence and others. Pure code: tested in /tests.
// A document belongs to a vehicle, or to the person when vehicleId is null.

import { addDays, isValidDateStr } from './dates.js';

export const DOC_TYPES = {
  rc: { label: 'RC', owner: 'vehicle' },
  insurance: { label: 'Insurance', owner: 'vehicle' },
  puc: { label: 'Pollution (PUC)', owner: 'vehicle' },
  licence: { label: 'Driving licence', owner: 'person' },
  other: { label: 'Other', owner: 'any' },
};

export const MAX_FILE_BYTES = 1000000; // 1 MB; also enforced in firestore.rules
export const MAX_DOCS_PER_OWNER = 10;
export const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const SOON_DAYS = 30;

export const typesFor = (vehicleId) => Object.entries(DOC_TYPES)
  .filter(([, t]) => t.owner === 'any' || t.owner === (vehicleId ? 'vehicle' : 'person'))
  .map(([value, t]) => ({ value, label: t.label }));

export const docLabel = (d) => (d.type === 'other' ? d.title || 'Other' : DOC_TYPES[d.type]?.label || 'Document');

export function validateDocument(d) {
  const errors = {};
  const type = DOC_TYPES[d.type];
  if (!type) errors.type = 'Choose the document type.';
  else if (type.owner === 'vehicle' && !d.vehicleId) errors.type = `${type.label} belongs to a vehicle. Choose one.`;
  else if (type.owner === 'person' && d.vehicleId) errors.type = `${type.label} belongs to you, not a vehicle.`;
  const title = (d.title || '').trim();
  if (d.type === 'other' && !title) errors.title = 'Enter a name for this document.';
  if (title.length > 60) errors.title = 'Use 60 characters or fewer.';
  if (d.expiryDate && !isValidDateStr(d.expiryDate)) errors.expiryDate = 'Enter a valid date.';
  return errors;
}

/** Returns a message when the file cannot be kept, or null. */
export function fileProblem({ size, mimeType }) {
  if (!FILE_TYPES.includes(mimeType)) return 'Use a photo (JPG, PNG, WEBP) or a PDF.';
  if (!(size > 0)) return 'This file is empty.';
  if (size > MAX_FILE_BYTES) {
    return mimeType === 'application/pdf'
      ? 'This PDF is over 1 MB. Upload a photo of the page instead.'
      : 'This photo is over 1 MB even after shrinking it. Try another photo.';
  }
  return null;
}

/** PDFs start with "%PDF". */
export const looksLikePdf = (bytes) => bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === '%PDF';

/** 'none' (no date) | 'ok' | 'soon' (within 30 days) | 'expired' (the day after expiry). */
export function expiryStatus(doc, today) {
  if (!doc.expiryDate) return 'none';
  if (doc.expiryDate < today) return 'expired';
  return doc.expiryDate <= addDays(today, SOON_DAYS) ? 'soon' : 'ok';
}

export function expiryText(doc, today) {
  const status = expiryStatus(doc, today);
  if (status === 'expired') return `${docLabel(doc)} expired`;
  if (status !== 'soon') return '';
  const days = Math.round((Date.parse(doc.expiryDate) - Date.parse(today)) / 864e5);
  if (days === 0) return `${docLabel(doc)} expires today`;
  return `${docLabel(doc)} expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Documents needing attention, soonest date first. */
export function expiryAlerts(docs, today) {
  return docs.filter((d) => ['expired', 'soon'].includes(expiryStatus(d, today)))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

/** One line per expected type, plus any others, for a vehicle or the person. */
export function documentSlots(docs, vehicleId) {
  const mine = docs.filter((d) => (d.vehicleId || null) === (vehicleId || null));
  const expected = typesFor(vehicleId).filter((t) => t.value !== 'other');
  return [
    ...expected.map((t) => ({ type: t.value, label: t.label, doc: mine.find((d) => d.type === t.value) || null })),
    ...mine.filter((d) => d.type === 'other').map((d) => ({ type: 'other', label: docLabel(d), doc: d })),
  ];
}

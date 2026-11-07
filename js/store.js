// Data layer. Keeps an in-memory copy of the user's vehicles and fuel entries
// and sends every change to the active backend:
//   - this device (localStorage), when Firebase is not set up
//   - Cloud Firestore, when the user is signed in
// Screens only use the functions below, so they never know which backend runs.
//
// Record shapes (also the Firestore documents):
//   vehicle: { id, nickname, type, make, model, registration, fuelType,
//              initialOdometer, demo, createdAt, updatedAt }
//   entry:   { id, vehicleId, date, quantity, unit, pricePerUnit, totalAmount,
//              station, odometer, fullTank, notes, calculated: [fieldNames],
//              demo, createdAt, updatedAt,
//              optional: time, fuelCompany, location, receiptNumber,
//              dashboardRangeKm, source ('manual' | 'smart' | 'smart-demo') }

import { buildDemoData } from './demo-data.js';
import { todayStr } from './core/dates.js';
import { fuelUnit } from './core/model.js';
import { docLabel, fileProblem, MAX_DOCS_PER_OWNER, sideFields, validateDocument } from './core/documents.js';
import { usageSummary } from './core/admin.js';
import { createLocalBackend } from './backends/local.js';

const PREFS_KEY = 'mileagemate:prefs';

// Optional entry fields: saved when given; kept unchanged when an edit leaves them out,
// so editing a smart entry in the manual form does not lose its receipt details.
const OPTIONAL_ENTRY_FIELDS = {
  time: (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null),
  fuelCompany: (v) => (v ? String(v).trim().slice(0, 120) : null),
  location: (v) => (v ? String(v).trim().slice(0, 200) : null),
  receiptNumber: (v) => (v ? String(v).trim().slice(0, 40) : null),
  dashboardRangeKm: (v) => (Number.isFinite(v) && v >= 0 ? v : null),
  source: (v) => (['manual', 'smart', 'smart-demo'].includes(v) ? v : 'manual'),
};

let backend = createLocalBackend();
let db = null;
let notify = () => {};

export class StoreError extends Error {}

const copy = (x) => JSON.parse(JSON.stringify(x));
const now = () => new Date().toISOString();
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

// ---- Backend management -------------------------------------------------------

/** Switch backend (for example after sign-in) and load its data. */
export async function useBackend(next) {
  backend = next;
  db = null;
  await ensureLoaded();
}

const withDefaults = (d) => ({ ...d, services: Array.isArray(d.services) ? d.services : [], recommendations: Array.isArray(d.recommendations) ? d.recommendations : [], challans: Array.isArray(d.challans) ? d.challans : [], documents: Array.isArray(d.documents) ? d.documents : [] });

export async function ensureLoaded() {
  if (!db) db = withDefaults(await backend.load());
  return db;
}

/** Reload from the backend, for example when another device may have changed data. */
export async function reload() {
  db = withDefaults(await backend.load());
}

/** Invoice images can only be kept in the cloud (they are too large for browser storage). */
export const canKeepImages = () => backend.kind === 'cloud';

export const backendKind = () => backend.kind;

/** Called with (message, kind) for background events such as an offline save. */
export function setNotifier(fn) { notify = fn; }

/** False when the browser blocks storage, so data will be lost on reload. */
export function isPersistent() { return backend.persistent; }

/**
 * Apply a change: save the new data through the backend first, and only then
 * make it the in-memory copy, so a failed save leaves the screen unchanged.
 */
async function apply(ops, next) {
  try {
    await backend.save(ops, next);
  } catch (err) {
    if (err?.message === 'pending') {
      notify('Saved. It will upload when you are back online.', 'ok');
    } else {
      throw new StoreError(friendlyWriteError(err));
    }
  }
  db = next;
}

function friendlyWriteError(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'The cloud refused this change. Sign out and in again, then retry.';
  if (code.includes('unavailable')) return 'Could not reach the cloud. Check your connection and try again.';
  return err?.message || 'Could not save. Please try again.';
}

// ---- Vehicles ---------------------------------------------------------------

export async function listVehicles() {
  const d = await ensureLoaded();
  return copy(d.vehicles).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getVehicle(id) {
  const v = (await ensureLoaded()).vehicles.find((x) => x.id === id);
  return v ? copy(v) : null;
}

export async function saveVehicle(data) {
  const d = await ensureLoaded();
  const fields = {
    nickname: data.nickname.trim(),
    type: data.type,
    make: (data.make || '').trim(),
    model: (data.model || '').trim(),
    registration: (data.registration || '').trim().toUpperCase(),
    fuelType: data.fuelType,
    initialOdometer: Number.isFinite(data.initialOdometer) ? data.initialOdometer : null,
  };
  if (data.reminderSettings) fields.reminderSettings = data.reminderSettings;
  let saved;
  if (data.id) {
    const old = d.vehicles.find((x) => x.id === data.id);
    if (!old) throw new StoreError('This vehicle no longer exists.');
    saved = { ...old, ...fields, updatedAt: now() };
  } else {
    saved = { id: newId(), ...fields, demo: false, createdAt: now(), updatedAt: now() };
  }
  const next = { ...d, vehicles: [...d.vehicles.filter((v) => v.id !== saved.id), saved] };
  await apply({ putVehicles: [saved] }, next);
  return copy(saved);
}

/** Deletes the vehicle and all of its fuel entries. */
export async function deleteVehicle(id) {
  const d = await ensureLoaded();
  const vehicle = d.vehicles.find((v) => v.id === id);
  if (!vehicle) return;
  const gone = d.entries.filter((e) => e.vehicleId === id);
  const goneServices = d.services.filter((x) => x.vehicleId === id);
  const goneRecs = d.recommendations.filter((x) => x.vehicleId === id);
  const goneChallans = d.challans.filter((x) => x.vehicleId === id);
  const goneDocs = d.documents.filter((x) => x.vehicleId === id);
  const next = { ...d, vehicles: d.vehicles.filter((v) => v.id !== id), entries: d.entries.filter((e) => e.vehicleId !== id), services: d.services.filter((x) => x.vehicleId !== id), recommendations: d.recommendations.filter((x) => x.vehicleId !== id), challans: d.challans.filter((x) => x.vehicleId !== id), documents: d.documents.filter((x) => x.vehicleId !== id) };
  await apply({ deleteEntries: gone, deleteServices: goneServices, deleteRecommendations: goneRecs, deleteChallans: goneChallans, deleteDocuments: goneDocs, deleteVehicles: [vehicle] }, next);
}

// ---- Fuel entries -------------------------------------------------------------

/** All entries, or only one vehicle's when vehicleId is given. */
export async function listEntries(vehicleId = null) {
  const d = await ensureLoaded();
  return copy(d.entries.filter((e) => !vehicleId || e.vehicleId === vehicleId));
}

export async function getEntry(id) {
  const e = (await ensureLoaded()).entries.find((x) => x.id === id);
  return e ? copy(e) : null;
}

export async function saveEntry(data) {
  const d = await ensureLoaded();
  const vehicle = d.vehicles.find((v) => v.id === data.vehicleId);
  if (!vehicle) throw new StoreError('Choose a vehicle that still exists.');
  const fields = {
    vehicleId: data.vehicleId,
    date: data.date,
    quantity: data.quantity,
    unit: fuelUnit(vehicle.fuelType),
    pricePerUnit: data.pricePerUnit ?? null,
    totalAmount: data.totalAmount,
    station: (data.station || '').trim(),
    odometer: data.odometer,
    fullTank: !!data.fullTank,
    notes: (data.notes || '').trim(),
    calculated: Array.isArray(data.calculated) ? data.calculated : [],
  };
  for (const [key, clean] of Object.entries(OPTIONAL_ENTRY_FIELDS)) {
    if (key in data) fields[key] = clean(data[key]);
  }
  let saved;
  const deletes = [];
  if (data.id) {
    const old = d.entries.find((x) => x.id === data.id);
    if (!old) throw new StoreError('This fuel entry no longer exists.');
    saved = { ...old, ...fields, updatedAt: now() };
    // In Firestore an entry lives under its vehicle, so moving it means delete + create.
    if (old.vehicleId !== saved.vehicleId) deletes.push(old);
  } else {
    saved = { id: newId(), source: 'manual', ...fields, demo: vehicle.demo, createdAt: now(), updatedAt: now() };
  }
  const next = { ...d, entries: [...d.entries.filter((e) => e.id !== saved.id), saved] };
  await apply({ putEntries: [saved], deleteEntries: deletes }, next);
  return copy(saved);
}

export async function deleteEntry(id) {
  const d = await ensureLoaded();
  const e = d.entries.find((x) => x.id === id);
  if (!e) return;
  await apply({ deleteEntries: [e] }, { ...d, entries: d.entries.filter((x) => x.id !== id) });
}

// ---- Service records --------------------------------------------------------------

const SERVICE_TEXT = ['jobCardDate', 'invoiceNumber', 'jobCardNumber', 'serviceCentre', 'serviceCentreLocation', 'paymentMethod', 'warranty', 'vinLast4', 'notes'];

/** All service records, or one vehicle's. Newest first. */
export async function listServices(vehicleId = null) {
  const d = await ensureLoaded();
  return copy(d.services.filter((x) => !vehicleId || x.vehicleId === vehicleId))
    .sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || '') || (b.odometerKm || 0) - (a.odometerKm || 0));
}

export async function getService(id) {
  const x = (await ensureLoaded()).services.find((r) => r.id === id);
  return x ? copy(x) : null;
}

/**
 * Save a service record. `pages` is an array of JPEG data URLs to keep (cloud only),
 * or null to leave stored pages unchanged.
 */
export async function saveService(data, pages = null) {
  const d = await ensureLoaded();
  const vehicle = d.vehicles.find((v) => v.id === data.vehicleId);
  if (!vehicle) throw new StoreError('Choose a vehicle that still exists.');
  const fields = {
    vehicleId: data.vehicleId,
    serviceDate: data.serviceDate,
    serviceType: data.serviceType || 'other',
    odometerKm: Number.isFinite(data.odometerKm) ? data.odometerKm : null,
    items: Array.isArray(data.items) ? data.items : [],
    financialSummary: data.financialSummary || {},
    source: ['manual', 'smart', 'smart-demo'].includes(data.source) ? data.source : 'manual',
    extractionMetadata: data.extractionMetadata || null,
  };
  for (const k of SERVICE_TEXT) fields[k] = data[k] ? String(data[k]).trim().slice(0, k === 'notes' ? 500 : 120) : null;
  const keep = pages && canKeepImages() ? pages : null;
  let saved;
  if (data.id) {
    const old = d.services.find((x) => x.id === data.id);
    if (!old) throw new StoreError('This service record no longer exists.');
    saved = { ...old, ...fields, updatedAt: now() };
    if (keep) saved.pageCount = keep.length;
  } else {
    saved = { id: newId(), ...fields, pageCount: keep ? keep.length : 0, demo: vehicle.demo, createdAt: now(), updatedAt: now() };
  }
  const old = d.services.find((x) => x.id === saved.id);
  const next = { ...d, services: [...d.services.filter((x) => x.id !== saved.id), saved] };
  await apply({ putServices: [saved], putPages: keep ? [{ record: saved, pages: keep, oldCount: old?.pageCount || 0 }] : [] }, next);
  return copy(saved);
}

export async function deleteService(id) {
  const d = await ensureLoaded();
  const x = d.services.find((r) => r.id === id);
  if (!x) return;
  await apply({ deleteServices: [x] }, { ...d, services: d.services.filter((r) => r.id !== id) });
}

/** The kept invoice pages (data URLs) for a record, in order. */
export async function getServicePages(record) {
  if (!record?.pageCount || !backend.loadPages) return [];
  return backend.loadPages(record);
}

// ---- Service-centre recommendations (next service) ------------------------------
// Own records, linked to the service they came from. Never deleted automatically:
// completing one only adds completedAt and completedByServiceId.

export async function listRecommendations(vehicleId = null) {
  const d = await ensureLoaded();
  return copy(d.recommendations.filter((r) => !vehicleId || r.vehicleId === vehicleId))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getRecommendation(id) {
  const r = (await ensureLoaded()).recommendations.find((x) => x.id === id);
  return r ? copy(r) : null;
}

export async function saveRecommendation(data) {
  const d = await ensureLoaded();
  if (!d.vehicles.some((v) => v.id === data.vehicleId)) throw new StoreError('Choose a vehicle that still exists.');
  const clean = (v, max) => (v ? String(v).trim().slice(0, max) : null);
  const fields = {
    vehicleId: data.vehicleId,
    serviceRecordId: data.serviceRecordId || null,
    status: ['recommended', 'not-recommended', 'not-mentioned'].includes(data.status) ? data.status : 'not-mentioned',
    dueDate: data.status === 'recommended' ? (data.dueDate || null) : null,
    dueKm: data.status === 'recommended' && Number.isFinite(data.dueKm) && data.dueKm > 0 ? Math.round(data.dueKm) : null,
    serviceCentre: clean(data.serviceCentre, 120),
    notes: clean(data.notes, 500),
    source: data.source === 'invoice' ? 'invoice' : 'manual',
    completedAt: data.completedAt || null,
    completedByServiceId: data.completedByServiceId || null,
  };
  let saved;
  if (data.id) {
    const old = d.recommendations.find((x) => x.id === data.id);
    if (!old) throw new StoreError('This recommendation no longer exists.');
    saved = { ...old, ...fields, updatedAt: now() };
  } else {
    saved = { id: newId(), ...fields, createdAt: now(), updatedAt: now() };
  }
  await apply({ putRecommendations: [saved] }, { ...d, recommendations: [...d.recommendations.filter((x) => x.id !== saved.id), saved] });
  return copy(saved);
}

// ---- Traffic challans ------------------------------------------------------------

export async function listChallans(vehicleId = null) {
  const d = await ensureLoaded();
  return copy(d.challans.filter((c) => !vehicleId || c.vehicleId === vehicleId)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function getChallan(id) {
  const c = (await ensureLoaded()).challans.find((x) => x.id === id);
  return c ? copy(c) : null;
}

export async function saveChallan(data) {
  const d = await ensureLoaded();
  if (!d.vehicles.some((v) => v.id === data.vehicleId)) throw new StoreError('Choose a vehicle that still exists.');
  const t = (v, max) => (v ? String(v).trim().slice(0, max) : null);
  const fields = {
    vehicleId: data.vehicleId, date: data.date, amount: data.amount,
    status: data.status === 'paid' ? 'paid' : 'unpaid',
    paidDate: data.status === 'paid' ? (data.paidDate || null) : null,
    offence: t(data.offence, 160), challanNumber: t(data.challanNumber, 60), location: t(data.location, 160), notes: t(data.notes, 500),
    source: ['manual', 'photo'].includes(data.source) ? data.source : 'manual',
  };
  const old = data.id ? d.challans.find((x) => x.id === data.id) : null;
  if (data.id && !old) throw new StoreError('This challan no longer exists.');
  const saved = old ? { ...old, ...fields, updatedAt: now() } : { id: newId(), ...fields, createdAt: now(), updatedAt: now() };
  await apply({ putChallans: [saved] }, { ...d, challans: [...d.challans.filter((x) => x.id !== saved.id), saved] });
  return copy(saved);
}

export async function deleteChallan(id) {
  const d = await ensureLoaded();
  const c = d.challans.find((x) => x.id === id);
  if (!c) return;
  await apply({ deleteChallans: [c] }, { ...d, challans: d.challans.filter((x) => x.id !== id) });
}

// ---- Documents ---------------------------------------------------------------------
// Details load with everything else; the file itself only when it is opened.

/** All documents, or one vehicle's. */
export async function listDocuments(vehicleId = null) {
  const d = await ensureLoaded();
  return copy(d.documents.filter((x) => !vehicleId || x.vehicleId === vehicleId));
}

export async function getDocument(id) {
  const x = (await ensureLoaded()).documents.find((r) => r.id === id);
  return x ? copy(x) : null;
}

/** `files` is { front, back, page3, page4 }, each { bytes, mimeType, fileName, size }; one left out keeps its stored file. */
export async function saveDocument(data, files = {}) {
  const d = await ensureLoaded();
  if (!canKeepImages()) throw new StoreError('Sign in to keep documents.');
  const old = data.id ? d.documents.find((x) => x.id === data.id) : null;
  if (data.id && !old) throw new StoreError('This document no longer exists.');
  const vehicleId = data.vehicleId || null;
  if (vehicleId && !d.vehicles.some((v) => v.id === vehicleId)) throw new StoreError('Choose a vehicle that still exists.');
  const errors = Object.values(validateDocument({ ...data, vehicleId }));
  if (errors.length) throw new StoreError(errors[0]);
  if (!old && !files.front) throw new StoreError('Add the front.');
  const sides = Object.entries(files).filter(([, f]) => f);
  for (const [, f] of sides) {
    const problem = fileProblem(f);
    if (problem) throw new StoreError(problem);
  }
  if (!old) {
    const siblings = d.documents.filter((x) => (x.vehicleId || null) === vehicleId);
    if (siblings.length >= MAX_DOCS_PER_OWNER) throw new StoreError(`You can keep up to ${MAX_DOCS_PER_OWNER} documents here. Delete one first.`);
    if (data.type !== 'other' && siblings.some((x) => x.type === data.type)) throw new StoreError(`${docLabel(data)} is already added. Open it and tap Replace.`);
  }
  const fields = {
    vehicleId,
    type: data.type,
    title: data.type === 'other' ? String(data.title).trim().slice(0, 60) : null,
    expiryDate: data.expiryDate || null,
    ...Object.assign({}, ...sides.map(([side, f]) => sideFields(side, f))),
  };
  const saved = old ? { ...old, ...fields, updatedAt: now() } : { id: newId(), ...fields, createdAt: now(), updatedAt: now() };
  await apply(
    { putDocuments: [saved], putDocumentFiles: sides.map(([side, f]) => ({ doc: saved, side, bytes: f.bytes, mimeType: f.mimeType })) },
    { ...d, documents: [...d.documents.filter((x) => x.id !== saved.id), saved] },
  );
  return copy(saved);
}

export async function deleteDocument(id) {
  const d = await ensureLoaded();
  const x = d.documents.find((r) => r.id === id);
  if (!x) return;
  await apply({ deleteDocuments: [x] }, { ...d, documents: d.documents.filter((r) => r.id !== id) });
}

/** The stored file: { bytes, mimeType }. */
export async function getDocumentFile(doc, side = 'front') {
  if (!backend.loadDocumentFile) throw new StoreError('Sign in to open documents.');
  const file = await backend.loadDocumentFile(doc, side);
  if (!file) throw new StoreError('This file could not be found.');
  return file;
}

// ---- Sample data, import and reset ------------------------------------------------

export async function hasDemoData() {
  return (await ensureLoaded()).vehicles.some((v) => v.demo);
}

export async function loadDemoData() {
  const d = await ensureLoaded();
  if (d.vehicles.some((v) => v.demo)) return;
  const { vehicles, entries } = buildDemoData(todayStr(), newId);
  await apply({ putVehicles: vehicles, putEntries: entries }, { ...d, vehicles: [...d.vehicles, ...vehicles], entries: [...d.entries, ...entries] });
}

export async function removeDemoData() {
  const d = await ensureLoaded();
  const demoIds = new Set(d.vehicles.filter((v) => v.demo).map((v) => v.id));
  const gone = d.entries.filter((e) => e.demo || demoIds.has(e.vehicleId));
  const goneServices = d.services.filter((x) => demoIds.has(x.vehicleId));
  await apply(
    { deleteEntries: gone, deleteServices: goneServices, deleteRecommendations: d.recommendations.filter((x) => demoIds.has(x.vehicleId)), deleteChallans: d.challans.filter((x) => demoIds.has(x.vehicleId)), deleteDocuments: d.documents.filter((x) => demoIds.has(x.vehicleId)), deleteVehicles: d.vehicles.filter((v) => v.demo) },
    { ...d, vehicles: d.vehicles.filter((v) => !v.demo), entries: d.entries.filter((e) => !gone.includes(e)), services: d.services.filter((x) => !demoIds.has(x.vehicleId)), recommendations: d.recommendations.filter((x) => !demoIds.has(x.vehicleId)), challans: d.challans.filter((x) => !demoIds.has(x.vehicleId)), documents: d.documents.filter((x) => !demoIds.has(x.vehicleId)) },
  );
}

/**
 * Copy vehicles and entries (for example this device's Phase 1 data) into the
 * active backend. Records keep their ids, so running it twice adds nothing twice.
 * Sample data is skipped.
 */
export async function importData({ vehicles, entries, services = [] }) {
  const d = await ensureLoaded();
  const vs = vehicles.filter((v) => !v.demo);
  const ids = new Set(vs.map((v) => v.id));
  const es = entries.filter((e) => ids.has(e.vehicleId) && !e.demo);
  const esIds = new Set(es.map((e) => e.id));
  const ss = services.filter((x) => ids.has(x.vehicleId));
  const ssIds = new Set(ss.map((x) => x.id));
  const next = {
    ...d,
    vehicles: [...d.vehicles.filter((v) => !ids.has(v.id)), ...vs],
    entries: [...d.entries.filter((e) => !esIds.has(e.id)), ...es],
    services: [...d.services.filter((x) => !ssIds.has(x.id)), ...ss],
  };
  await apply({ putVehicles: vs, putEntries: es, putServices: ss }, next);
  return { vehicles: vs.length, entries: es.length };
}

export async function deleteAllData() {
  const d = await ensureLoaded();
  await apply({ deleteEntries: d.entries, deleteServices: d.services, deleteRecommendations: d.recommendations, deleteChallans: d.challans, deleteDocuments: d.documents, deleteVehicles: d.vehicles }, { version: 1, vehicles: [], entries: [], services: [], recommendations: [], challans: [], documents: [] });
}

/** The vehicle with the most fuel fills (ties: the most recently filled). Used as the default pick. */
export async function busiestVehicleId() {
  const d = await ensureLoaded();
  const stats = new Map(d.vehicles.map((v) => [v.id, { n: 0, last: '' }]));
  for (const e of d.entries) {
    const s = stats.get(e.vehicleId);
    if (s) { s.n += 1; if (e.date > s.last) s.last = e.date; }
  }
  return [...stats.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))[0]?.[0] || null;
}

// ---- Usage summary and admin ---------------------------------------------------------

/** Keep this user's name, email and counts up to date for the owner. Never blocks the app. */
export async function publishUsage(profile) {
  if (!backend.saveUsage) return;
  try {
    await backend.saveUsage({ ...profile, ...usageSummary(await ensureLoaded()) });
  } catch { /* the app works without it */ }
}

/** Every user's profile and counts. Refused by the security rules unless this is the owner. */
export async function listAllUsers() {
  if (!backend.listUsers) throw new StoreError('Not available.');
  return backend.listUsers();
}

// ---- Small preferences (last used vehicle, and so on) ----------------------------

export function getPref(key, fallback = null) {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return key in p ? p[key] : fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    p[key] = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* preferences are optional */
  }
}

// Data layer. Phase 1 keeps everything in this browser's localStorage.
// Every function is async and returns copies, the same shape the Firestore
// version will have in Phase 2, so the screens will not need to change.
//
// Record shapes (also the planned Firestore documents):
//   vehicle: { id, nickname, type, make, model, registration, fuelType,
//              initialOdometer, demo, createdAt, updatedAt }
//   entry:   { id, vehicleId, date, quantity, unit, pricePerUnit, totalAmount,
//              station, odometer, fullTank, notes, calculated: [fieldNames],
//              demo, createdAt, updatedAt }

import { buildDemoData } from './demo-data.js';
import { todayStr } from './core/dates.js';
import { fuelUnit } from './core/model.js';

const KEY = 'mileagemate:v1';
const PREFS_KEY = 'mileagemate:prefs';

let db = null;
let persistent = true;

export class StoreError extends Error {}

const blank = () => ({ version: 1, vehicles: [], entries: [] });
const copy = (x) => JSON.parse(JSON.stringify(x));
const now = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      db = blank();
    } else {
      try {
        db = JSON.parse(raw);
        if (!db || !Array.isArray(db.vehicles) || !Array.isArray(db.entries)) throw new Error('bad shape');
      } catch {
        // Keep the unreadable data aside instead of overwriting it.
        localStorage.setItem(`${KEY}:unreadable:${Date.now()}`, raw);
        db = blank();
      }
    }
  } catch {
    persistent = false; // storage blocked (some private modes): work in memory only
    db = blank();
  }
  return db;
}

function persist() {
  if (!persistent) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new StoreError('Could not save on this device. Browser storage may be full or blocked.');
  }
}

/** False when the browser blocks storage, so data will be lost on reload. */
export function isPersistent() {
  load();
  return persistent;
}

// ---- Vehicles ---------------------------------------------------------------

export async function listVehicles() {
  return copy(load().vehicles).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getVehicle(id) {
  const v = load().vehicles.find((x) => x.id === id);
  return v ? copy(v) : null;
}

export async function saveVehicle(data) {
  const d = load();
  const fields = {
    nickname: data.nickname.trim(),
    type: data.type,
    make: (data.make || '').trim(),
    model: (data.model || '').trim(),
    registration: (data.registration || '').trim().toUpperCase(),
    fuelType: data.fuelType,
    initialOdometer: data.initialOdometer,
  };
  if (data.id) {
    const v = d.vehicles.find((x) => x.id === data.id);
    if (!v) throw new StoreError('This vehicle no longer exists.');
    Object.assign(v, fields, { updatedAt: now() });
    persist();
    return copy(v);
  }
  const v = { id: newId(), ...fields, demo: false, createdAt: now(), updatedAt: now() };
  d.vehicles.push(v);
  persist();
  return copy(v);
}

/** Deletes the vehicle and all of its fuel entries. */
export async function deleteVehicle(id) {
  const d = load();
  d.vehicles = d.vehicles.filter((v) => v.id !== id);
  d.entries = d.entries.filter((e) => e.vehicleId !== id);
  persist();
}

// ---- Fuel entries -------------------------------------------------------------

/** All entries, or only one vehicle's when vehicleId is given. */
export async function listEntries(vehicleId = null) {
  const list = load().entries.filter((e) => !vehicleId || e.vehicleId === vehicleId);
  return copy(list);
}

export async function getEntry(id) {
  const e = load().entries.find((x) => x.id === id);
  return e ? copy(e) : null;
}

export async function saveEntry(data) {
  const d = load();
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
  if (data.id) {
    const e = d.entries.find((x) => x.id === data.id);
    if (!e) throw new StoreError('This fuel entry no longer exists.');
    Object.assign(e, fields, { updatedAt: now() });
    persist();
    return copy(e);
  }
  const e = { id: newId(), ...fields, demo: vehicle.demo, createdAt: now(), updatedAt: now() };
  d.entries.push(e);
  persist();
  return copy(e);
}

export async function deleteEntry(id) {
  const d = load();
  d.entries = d.entries.filter((e) => e.id !== id);
  persist();
}

// ---- Sample data and reset ------------------------------------------------------

export async function hasDemoData() {
  return load().vehicles.some((v) => v.demo);
}

export async function loadDemoData() {
  const d = load();
  if (d.vehicles.some((v) => v.demo)) return;
  const { vehicles, entries } = buildDemoData(todayStr(), newId);
  d.vehicles.push(...vehicles);
  d.entries.push(...entries);
  persist();
}

export async function removeDemoData() {
  const d = load();
  const demoIds = new Set(d.vehicles.filter((v) => v.demo).map((v) => v.id));
  d.vehicles = d.vehicles.filter((v) => !v.demo);
  d.entries = d.entries.filter((e) => !e.demo && !demoIds.has(e.vehicleId));
  persist();
}

export async function deleteAllData() {
  db = blank();
  persist();
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

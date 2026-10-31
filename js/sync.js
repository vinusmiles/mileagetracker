// Copying data saved on this device (before sign-in) into the user's account.

import * as store from './store.js';
import * as auth from './auth.js';
import { toast } from './ui.js';
import { readLocalData } from './backends/local.js';

/** Vehicles saved on this device before signing in (Phase 1), not yet copied. */
export function localDataToImport({ includeSkipped = false } = {}) {
  const user = auth.currentUser();
  if (store.backendKind() !== 'cloud' || !user) return null;
  const done = store.getPref(`imported:${user.uid}`);
  if (done && !(includeSkipped && done === 'skipped')) return null;
  const { data } = readLocalData();
  const vehicles = data.vehicles.filter((v) => !v.demo);
  if (!vehicles.length) return null;
  const ids = new Set(vehicles.map((v) => v.id));
  return { vehicles, entries: data.entries.filter((e) => ids.has(e.vehicleId) && !e.demo), services: (data.services || []).filter((x) => ids.has(x.vehicleId)) };
}

export async function importLocalData() {
  const user = auth.currentUser();
  const local = localDataToImport({ includeSkipped: true });
  if (!local) return;
  const r = await store.importData(local);
  store.setPref(`imported:${user.uid}`, new Date().toISOString());
  toast(`Copied ${r.vehicles} vehicles and ${r.entries} fuel entries to your account`);
}


// Backend: Cloud Firestore, one private tree per signed-in user:
//   users/{uid}
//   users/{uid}/vehicles/{vehicleId}
//   users/{uid}/vehicles/{vehicleId}/fuelEntries/{entryId}
// Security rules (firestore.rules) make sure a user can only touch their own tree.

const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch; leave headroom
const PAGE_BATCH = 8;    // invoice pages are large; keep each batch well under the 10 MB request limit
const WRITE_WAIT_MS = 10000;

export class PendingWrite extends Error {}

/**
 * @param fb   { db, fs } from cloud/firebase.js (fs = Firestore module functions)
 * @param uid  signed-in user's id
 */
export function createFirestoreBackend(fb, uid) {
  const { db, fs } = fb;
  const userRef = fs.doc(db, 'users', uid);
  const vehicleRef = (id) => fs.doc(userRef, 'vehicles', id);
  const entryRef = (e) => fs.doc(userRef, 'vehicles', e.vehicleId, 'fuelEntries', e.id);
  const serviceRef = (x) => fs.doc(userRef, 'vehicles', x.vehicleId, 'serviceRecords', x.id);
  const pageRef = (x, i) => fs.doc(userRef, 'vehicles', x.vehicleId, 'serviceRecords', x.id, 'pages', String(i));
  const strip = (x) => JSON.parse(JSON.stringify(x)); // drops undefined values

  async function commit(writes) {
    const size = writes.some((w) => w.heavy) ? PAGE_BATCH : BATCH_LIMIT;
    for (let i = 0; i < writes.length; i += size) {
      const batch = fs.writeBatch(db);
      for (const w of writes.slice(i, i + size)) w(batch);
      const done = batch.commit();
      // Offline, Firestore keeps the write queued and the promise waits for the
      // server. Don't freeze the screen: report it as pending instead.
      const timer = new Promise((_, reject) => setTimeout(() => reject(new PendingWrite('pending')), WRITE_WAIT_MS));
      await Promise.race([done, timer]);
    }
  }

  return {
    kind: 'cloud',
    persistent: true,
    uid,

    async load() {
      const now = new Date().toISOString();
      const snap = await fs.getDoc(userRef);
      await fs.setDoc(userRef, snap.exists() ? { updatedAt: now } : { createdAt: now, updatedAt: now }, { merge: true });

      const vSnap = await fs.getDocs(fs.collection(userRef, 'vehicles'));
      const vehicles = vSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const entryLists = await Promise.all(vehicles.map((v) => fs.getDocs(fs.collection(userRef, 'vehicles', v.id, 'fuelEntries'))));
      const entries = entryLists.flatMap((s, i) => s.docs.map((d) => ({ ...d.data(), id: d.id, vehicleId: vehicles[i].id })));
      const serviceLists = await Promise.all(vehicles.map((v) => fs.getDocs(fs.collection(userRef, 'vehicles', v.id, 'serviceRecords'))));
      const services = serviceLists.flatMap((s, i) => s.docs.map((d) => ({ ...d.data(), id: d.id, vehicleId: vehicles[i].id })));
      return { version: 1, vehicles, entries, services };
    },

    /** Invoice pages are loaded only when a record is opened. */
    async loadPages(record) {
      const snap = await fs.getDocs(fs.collection(userRef, 'vehicles', record.vehicleId, 'serviceRecords', record.id, 'pages'));
      return snap.docs.map((d) => d.data()).sort((a, b) => a.index - b.index).map((p) => p.dataUrl);
    },

    /** ops: { putVehicles, putEntries, deleteVehicles, deleteEntries } (full records) */
    async save(ops) {
      const writes = [];
      for (const v of ops.putVehicles || []) writes.push((b) => b.set(vehicleRef(v.id), strip(v)));
      for (const e of ops.putEntries || []) writes.push((b) => b.set(entryRef(e), strip(e)));
      for (const x of ops.putServices || []) writes.push((b) => b.set(serviceRef(x), strip(x)));
      for (const { record, pages, oldCount } of ops.putPages || []) {
        pages.forEach((dataUrl, i) => writes.push(Object.assign((b) => b.set(pageRef(record, i), { index: i, dataUrl }), { heavy: true })));
        for (let i = pages.length; i < oldCount; i++) writes.push((b) => b.delete(pageRef(record, i)));
      }
      for (const x of ops.deleteServices || []) {
        for (let i = 0; i < (x.pageCount || 0); i++) writes.push((b) => b.delete(pageRef(x, i)));
        writes.push((b) => b.delete(serviceRef(x)));
      }
      for (const e of ops.deleteEntries || []) writes.push((b) => b.delete(entryRef(e)));
      for (const v of ops.deleteVehicles || []) writes.push((b) => b.delete(vehicleRef(v.id)));
      await commit(writes);
    },
  };
}

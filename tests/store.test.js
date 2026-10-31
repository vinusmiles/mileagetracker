// Tests for the data layer against a fake cloud backend (records every write).
import { test, assert } from './harness.js';
import * as store from '../js/store.js';

function fakeBackend({ failNext = null } = {}) {
  const b = {
    kind: 'cloud', persistent: true, data: { version: 1, vehicles: [], entries: [] }, ops: [], failNext,
    async load() { return JSON.parse(JSON.stringify(b.data)); },
    async save(ops, next) {
      if (b.failNext) { const e = b.failNext; b.failNext = null; throw e; }
      b.ops.push(ops);
      b.data = JSON.parse(JSON.stringify(next));
    },
  };
  return b;
}
const vehicleIn = { nickname: 'My car', type: 'four', fuelType: 'petrol', initialOdometer: 18000 };
const entryIn = (vehicleId, o = {}) => ({ vehicleId, date: '2026-10-18', quantity: 20, pricePerUnit: 116.64, totalAmount: 2332.8, odometer: 18885, fullTank: true, ...o });

test('Store: saving sends exactly the changed records to the backend', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const v = await store.saveVehicle(vehicleIn);
  const e = await store.saveEntry(entryIn(v.id));
  assert.equal(b.ops[0].putVehicles[0].id, v.id);
  assert.equal(b.ops[1].putEntries[0].id, e.id);
  assert.equal(b.ops[1].putEntries[0].source, 'manual');
});

test('Store: deleting a vehicle deletes its entries too', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const v = await store.saveVehicle(vehicleIn);
  await store.saveEntry(entryIn(v.id));
  await store.saveEntry(entryIn(v.id, { date: '2026-10-25', odometer: 19300 }));
  await store.deleteVehicle(v.id);
  const last = b.ops[b.ops.length - 1];
  assert.equal(last.deleteEntries.length, 2);
  assert.equal(last.deleteVehicles[0].id, v.id);
  assert.equal((await store.listEntries()).length, 0);
});

test('Store: a failed cloud save leaves the data unchanged', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const v = await store.saveVehicle(vehicleIn);
  b.failNext = Object.assign(new Error('denied'), { code: 'permission-denied' });
  let msg = '';
  try { await store.saveEntry(entryIn(v.id)); } catch (err) { msg = err.message; }
  assert.ok(msg.includes('refused'), 'friendly error expected');
  assert.equal((await store.listEntries()).length, 0);
});

test('Store: an offline save is kept and reported as pending', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const v = await store.saveVehicle(vehicleIn);
  let note = '';
  store.setNotifier((m) => { note = m; });
  b.failNext = new Error('pending');
  await store.saveEntry(entryIn(v.id));
  assert.equal((await store.listEntries()).length, 1);
  assert.ok(note.includes('back online'));
  store.setNotifier(() => {});
});

test('Store: importing device data keeps ids, skips samples, and is safe to repeat', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const local = {
    vehicles: [{ id: 'v1', nickname: 'Bike', type: 'two', fuelType: 'petrol', initialOdometer: 100, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'demo', nickname: 'Sample', type: 'two', fuelType: 'petrol', initialOdometer: 1, demo: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    entries: [{ id: 'e1', vehicleId: 'v1', date: '2026-02-01', quantity: 5, totalAmount: 500, odometer: 300, fullTank: true },
      { id: 'e2', vehicleId: 'demo', date: '2026-02-01', quantity: 5, totalAmount: 500, odometer: 300, fullTank: true, demo: true }],
  };
  const r = await store.importData(local);
  assert.equal(r.vehicles, 1);
  assert.equal(r.entries, 1);
  await store.importData(local);
  assert.equal((await store.listVehicles()).length, 1);
  assert.equal((await store.listEntries()).length, 1);
});

test('Store: moving an entry to another vehicle removes it from the old one', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const a = await store.saveVehicle(vehicleIn);
  const c = await store.saveVehicle({ ...vehicleIn, nickname: 'Second' });
  const e = await store.saveEntry(entryIn(a.id));
  await store.saveEntry({ ...e, vehicleId: c.id });
  const last = b.ops[b.ops.length - 1];
  assert.equal(last.deleteEntries[0].vehicleId, a.id);
  assert.equal(last.putEntries[0].vehicleId, c.id);
});

test('Store: service records save with pages (cloud), and vehicle delete removes them', async () => {
  const b = fakeBackend();
  await store.useBackend(b);
  const v = await store.saveVehicle(vehicleIn);
  const r = await store.saveService({ vehicleId: v.id, serviceDate: '2026-10-30', serviceType: 'paid', odometerKm: 19381, items: [{ description: 'Oil', kind: 'part', section: 'maintenance', total: 3069.5 }], financialSummary: { grandTotal: 13120 } }, ['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB']);
  let last = b.ops[b.ops.length - 1];
  assert.equal(last.putServices[0].pageCount, 2);
  assert.equal(last.putPages[0].pages.length, 2);
  await store.saveService({ ...r, notes: 'edited' }); // pages unchanged
  last = b.ops[b.ops.length - 1];
  assert.equal(last.putPages.length, 0);
  assert.equal(last.putServices[0].pageCount, 2);
  await store.deleteVehicle(v.id);
  last = b.ops[b.ops.length - 1];
  assert.equal(last.deleteServices.length, 1);
  assert.equal((await store.listServices()).length, 0);
});

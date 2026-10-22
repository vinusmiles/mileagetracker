// Settings: where data is stored, sample data, and reset.

import * as store from '../store.js';
import { toast, confirmDialog } from '../ui.js';

export async function render(main, { refresh }) {
  const [vehicles, entries, hasDemo] = await Promise.all([store.listVehicles(), store.listEntries(), store.hasDemoData()]);
  const persistent = store.isPersistent();

  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Settings</h1>

    <section class="block">
      <h2>Account</h2>
      <p>Sign-in with Google or a mobile OTP is not built yet. It arrives in the next phase, together with cloud storage, so your data can follow you to other devices.</p>
    </section>

    <section class="block">
      <h2>Your data</h2>
      <p>${persistent
        ? 'Everything is saved in this browser on this device. Clearing the browser’s site data removes it.'
        : '<strong>This browser is blocking storage</strong>, so changes will be lost when you close the page. Private or incognito mode usually causes this.'}</p>
      <p class="muted">${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}, ${entries.length} fuel ${entries.length === 1 ? 'entry' : 'entries'}.</p>
    </section>

    <section class="block">
      <h2>Sample data</h2>
      ${hasDemo
        ? `<p>Sample vehicles are marked Sample. Removing them leaves your own vehicles and fills untouched.</p>
           <button class="btn" type="button" data-action="remove-demo">Remove sample data</button>`
        : `<p>Add two sample vehicles with five months of fills to see how the dashboard and history work.</p>
           <button class="btn" type="button" data-action="load-demo">Add sample data</button>`}
    </section>

    <section class="danger">
      <h2>Delete all data</h2>
      <p>Removes every vehicle and fuel entry from this device. It cannot be undone.</p>
      <button class="btn btn-danger" type="button" data-action="delete-all"${vehicles.length ? '' : ' disabled'}>Delete all data</button>
    </section>

    <section class="block">
      <h2>About</h2>
      <p>MileageMate, version 0.1 (Phase 1: works on this device only). <a href="tests/">Run the calculation tests</a>.</p>
    </section>`;

  main.querySelector('[data-action="load-demo"]')?.addEventListener('click', async () => {
    await store.loadDemoData();
    toast('Sample data added');
    refresh();
  });

  main.querySelector('[data-action="remove-demo"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Remove sample data?', message: 'The sample vehicles and their fills will be removed. Your own data stays.', confirmLabel: 'Remove sample data' });
    if (!ok) return;
    await store.removeDemoData();
    toast('Sample data removed');
    refresh();
  });

  main.querySelector('[data-action="delete-all"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete all data?',
      message: `${vehicles.length} vehicles and ${entries.length} fuel entries will be removed from this device.`,
      confirmLabel: 'Delete everything',
      typeToConfirm: 'delete',
    });
    if (!ok) return;
    await store.deleteAllData();
    toast('All data deleted');
    refresh();
  });
}

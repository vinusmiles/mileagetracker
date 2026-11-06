// Settings: where data is stored, sample data, and reset.

import * as store from '../store.js';
import * as auth from '../auth.js';
import { toast, confirmDialog, esc, icon } from '../ui.js';
import { localDataToImport, importLocalData } from '../sync.js';

export async function render(main, { refresh }) {
  const [vehicles, entries, hasDemo] = await Promise.all([store.listVehicles(), store.listEntries(), store.hasDemoData()]);
  const persistent = store.isPersistent();
  const cloud = store.backendKind() === 'cloud';
  const user = auth.currentUser();
  const toImport = localDataToImport({ includeSkipped: true });

  main.innerHTML = `
    <a class="back" href="#/more">${icon('back')}More</a>
    <h1 class="page-title" tabindex="-1">Settings</h1>

    <section class="block">
      <h2>Account</h2>
      ${cloud
        ? `<p>Signed in as <strong>${esc(auth.describeUser(user))}</strong>.</p>
           <button class="btn" type="button" data-action="sign-out">Sign out</button>`
        : '<p>Sign-in is not set up for this website yet, so data stays on this device. See README.md, “Phase 2 setup”.</p>'}
    </section>

    <section class="block">
      <h2>Contact us</h2>
      <p>Questions, ideas or a bill that was read wrongly? Message us on Instagram.</p>
      <a class="btn btn-insta" href="https://www.instagram.com/gaadikhata/" target="_blank" rel="noopener">${icon('instagram')}Message @gaadikhata <span aria-hidden="true">›</span></a>
    </section>

    <section class="block">
      <h2>Your data</h2>
      <p>${cloud
        ? 'Saved to your private cloud account. Only you can read it. A copy is kept in this browser so the app opens quickly and works with a weak signal; signing out removes it.'
        : persistent
          ? 'Everything is saved in this browser on this device. Clearing the browser’s site data removes it.'
          : '<strong>This browser is blocking storage</strong>, so changes will be lost when you close the page. Private or incognito mode usually causes this.'}</p>
      <p class="muted">${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}, ${entries.length} fuel ${entries.length === 1 ? 'entry' : 'entries'}.</p>
      ${toImport ? `<p>This device also has ${toImport.vehicles.length} vehicles and ${toImport.entries.length} fuel entries from before you signed in.</p>
        <button class="btn" type="button" data-action="import">Copy them to my account</button>` : ''}
    </section>

    <section class="block">
      <h2>Sample data</h2>
      ${hasDemo
        ? `<p>Sample vehicles are marked Sample. Removing them leaves your own vehicles and fills untouched.</p>
           <button class="btn" type="button" data-action="remove-demo">Remove sample data</button>`
        : `<p>Add two sample vehicles with five months of fills to see how the dashboard and history work.</p>
           <button class="btn" type="button" data-action="load-demo">Add sample data</button>`}
    </section>

    <section class="block">
      <h2>About</h2>
      <p>GaadiKhata, version 2.5.</p>
      <p class="muted">© 2026 GaadiKhata. All rights reserved.</p>
    </section>

    <section class="danger">
      <h2>Delete all data</h2>
      <p>Removes every vehicle and fuel entry ${cloud ? 'from your account' : 'from this device'}. It cannot be undone.</p>
      <button class="btn btn-danger" type="button" data-action="delete-all"${vehicles.length ? '' : ' disabled'}>Delete all data</button>
    </section>`;

  main.querySelector('[data-action="sign-out"]')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    await auth.signOut();
  });

  main.querySelector('[data-action="import"]')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try { await importLocalData(); } catch (err) { toast(err.message, 'error'); }
    refresh();
  });

  main.querySelector('[data-action="load-demo"]')?.addEventListener('click', async () => {
    try { await store.loadDemoData(); } catch (err) { toast(err.message, 'error'); return; }
    toast('Sample data added');
    refresh();
  });

  main.querySelector('[data-action="remove-demo"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Remove sample data?', message: 'The sample vehicles and their fills will be removed. Your own data stays.', confirmLabel: 'Remove sample data' });
    if (!ok) return;
    try { await store.removeDemoData(); } catch (err) { toast(err.message, 'error'); return; }
    toast('Sample data removed');
    refresh();
  });

  main.querySelector('[data-action="delete-all"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete all data?',
      message: `${vehicles.length} vehicles and ${entries.length} fuel entries will be removed ${cloud ? 'from your account on every device' : 'from this device'}.`,
      confirmLabel: 'Delete everything',
      typeToConfirm: 'delete',
    });
    if (!ok) return;
    try { await store.deleteAllData(); } catch (err) { toast(err.message, 'error'); return; }
    toast('All data deleted');
    refresh();
  });
}

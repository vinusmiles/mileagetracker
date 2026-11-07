// Owner's admin page (#/admin). Not linked anywhere. Firestore rules decide who can read
// the list: everyone else is refused. Shows each user's profile and counts, never their records.

import * as store from '../store.js';
import { esc, fmt, icon } from '../ui.js';
import { adminTotals, sortUsers } from '../core/admin.js';

const day = (iso) => (iso ? fmt.date(iso.slice(0, 10)) : 'Not known');
const count = (n) => (Number.isFinite(n) ? n : '–');
const stat = (value, label) => `<div class="admin-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export async function render(main) {
  main.innerHTML = '<h1 class="page-title" tabindex="-1">Admin</h1><p class="loading" role="status">Loading…</p>';
  let users;
  try {
    users = await store.listAllUsers();
  } catch {
    main.innerHTML = `<a class="back" href="#/">${icon('back')}Home</a><h1 class="page-title" tabindex="-1">Page not found</h1>`;
    return;
  }
  const t = adminTotals(users, Date.now());
  const rows = sortUsers(users).map((u) => `
    <li class="admin-user">
      <strong>${esc(u.name || 'Name not known yet')}</strong>
      <small>${esc(u.email || 'Waiting for this user to open the app')}</small>
      <dl>
        <div><dt>Joined</dt><dd>${esc(day(u.createdAt))}</dd></div>
        <div><dt>Last opened</dt><dd>${esc(day(u.updatedAt))}</dd></div>
        <div><dt>Vehicles</dt><dd>${count(u.vehicleCount)}</dd></div>
        <div><dt>Fuel fills</dt><dd>${count(u.fuelCount)}</dd></div>
        <div><dt>Scans</dt><dd>${count(u.scanCount)}</dd></div>
        <div><dt>Services</dt><dd>${count(u.serviceCount)}</dd></div>
        <div><dt>Documents</dt><dd>${count(u.documentCount)}</dd></div>
        <div><dt>Device</dt><dd>${esc(u.device || '–')}${u.installed ? ', installed' : ''}</dd></div>
        <div><dt>Version</dt><dd>${esc(u.appVersion || '–')}</dd></div>
      </dl>
    </li>`).join('');

  main.innerHTML = `
    <a class="back" href="#/">${icon('back')}Home</a>
    <h1 class="page-title" tabindex="-1">Admin</h1>
    <section class="block"><h2>Users</h2><div class="admin-stats">
      ${stat(t.users, 'Total users')}${stat(t.active7, 'Opened in 7 days')}${stat(t.active30, 'Opened in 30 days')}
      ${stat(t.new7, 'New in 7 days')}${stat(t.noVehicle, 'No vehicle yet')}${stat(t.installed, 'Installed the app')}
    </div></section>
    <section class="block"><h2>Activity</h2><div class="admin-stats">
      ${stat(t.vehicles, 'Vehicles')}${stat(`${t.twoWheelers} / ${t.fourWheelers}`, 'Bikes / cars')}${stat(t.fills, 'Fuel fills')}
      ${stat(`${t.scanShare}%`, 'Fills from scan')}${stat(t.services, 'Service records')}${stat(t.documents, 'Documents')}
    </div>
    <p class="hint">Sample data is left out. Activity counts come from ${t.reported} of ${t.users} users; the rest appear after they next open the app.</p></section>
    <section class="block"><h2>All users</h2><ul class="admin-users">${rows}</ul></section>`;
}

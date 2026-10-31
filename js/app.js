// App entry: a small hash router (#/path?query). Hash URLs work on GitHub Pages
// project sites (username.github.io/repo/) without any server configuration.

import * as store from './store.js';
import * as auth from './auth.js';
import { errorPanel, icon, toast, esc } from './ui.js';
import { createFirestoreBackend } from './backends/firestore.js';
import { localDataToImport, importLocalData } from './sync.js';
import * as login from './views/login.js';
import * as dashboard from './views/dashboard.js';
import * as vehicles from './views/vehicles.js';
import * as fuelForm from './views/fuel-form.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';
import * as smart from './views/smart.js';
import * as maintenance from './views/maintenance.js';

const ROUTES = [
  { re: /^\/$/, view: dashboard.render, nav: 'dashboard', title: 'Dashboard' },
  { re: /^\/vehicles$/, view: vehicles.renderList, nav: 'vehicles', title: 'My vehicles' },
  { re: /^\/vehicles\/new$/, view: vehicles.renderForm, nav: 'vehicles', title: 'Add a vehicle' },
  { re: /^\/vehicles\/([^/]+)\/edit$/, view: vehicles.renderForm, nav: 'vehicles', title: 'Edit vehicle' },
  { re: /^\/fuel\/new$/, view: fuelForm.render, nav: 'fuel', title: 'Add fuel' },
  { re: /^\/smart$/, view: smart.render, nav: 'fuel', title: 'Smart fuel entry' },
  { re: /^\/fuel\/([^/]+)\/edit$/, view: fuelForm.render, nav: 'history', title: 'Edit fuel entry' },
  { re: /^\/history$/, view: history.render, nav: 'history', title: 'History' },
  { re: /^\/settings$/, view: settings.render, nav: 'settings', title: 'Settings' },
  { re: /^\/maintenance$/, view: maintenance.renderHistory, nav: 'maintenance', title: 'Maintenance' },
  { re: /^\/service\/add$/, view: maintenance.renderAddChooser, nav: 'vehicles', title: 'Add service' },
  { re: /^\/service\/scan$/, view: maintenance.renderScan, nav: 'maintenance', title: 'Scan service invoice' },
  { re: /^\/service\/new$/, view: maintenance.renderNew, nav: 'maintenance', title: 'Add service' },
  { re: /^\/service\/([^/]+)\/edit$/, view: maintenance.renderEdit, nav: 'maintenance', title: 'Edit service' },
  { re: /^\/service\/([^/]+)$/, view: maintenance.renderDetail, nav: 'maintenance', title: 'Service details' },
];

const main = document.getElementById('main');
let renderCount = 0;
let pendingFocusId = null;

function parseHash() {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(1) : '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path.replace(/\/+$/, '') || '/', query: new URLSearchParams(qs) };
}

/** Go to an app path such as '/history?v=abc'. */
function navigate(path, { replace = false, keepFocus = false } = {}) {
  pendingFocusId = keepFocus ? document.activeElement?.id || null : null;
  const target = `#${path}`;
  if (location.hash === target) { render(); return; }
  if (replace) location.replace(target);
  else location.hash = target;
}

async function renderBanner() {
  const box = document.getElementById('banner');
  const parts = [];
  if (!store.isPersistent()) parts.push('This browser is blocking storage, so your entries will be lost when you close the page.');
  const local = localDataToImport();
  if (local) {
    parts.push(`This device has ${local.vehicles.length} ${local.vehicles.length === 1 ? 'vehicle' : 'vehicles'} and ${local.entries.length} fuel entries saved before you signed in.
      <span class="banner-actions"><button type="button" class="btn btn-sm btn-primary" data-import>Copy to my account</button><button type="button" class="btn btn-sm btn-quiet" data-import-skip>Not now</button></span>`);
  }
  if (await store.hasDemoData()) parts.push('You are looking at sample data. <a href="#/settings">Remove it in Settings</a> when you are ready to add your own.');
  box.innerHTML = parts.map((p) => `<p>${p}</p>`).join('');
  box.hidden = !parts.length;
  box.querySelector('[data-import]')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try { await importLocalData(); } catch (err) { toast(err.message, 'error'); }
    render();
  });
  box.querySelector('[data-import-skip]')?.addEventListener('click', () => {
    store.setPref(`imported:${auth.currentUser().uid}`, 'skipped');
    renderBanner();
  });
}

async function render() {
  const id = ++renderCount;
  const { path, query } = parseHash();
  let route = null;
  let params = [];
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) { route = r; params = m.slice(1).map(decodeURIComponent); break; }
  }

  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = route && a.dataset.nav === route.nav;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  const focusId = pendingFocusId;
  pendingFocusId = null;

  if (auth.isConfigured() && !auth.currentUser()) {
    document.title = 'Sign in | GaadiKhata';
    document.getElementById('banner').hidden = true;
    await login.render(main);
    main.querySelector('.page-title')?.focus({ preventScroll: true });
    return;
  }
  try {
    await renderBanner();
    if (!route) {
      main.innerHTML = `<h1 class="page-title" tabindex="-1">Page not found</h1><p><a href="#/">Go to the dashboard</a></p>`;
    } else {
      document.title = `${route.title} | GaadiKhata`;
      await route.view(main, { params, query, navigate, refresh: render });
    }
  } catch (err) {
    console.error(err);
    if (id === renderCount) main.innerHTML = errorPanel(err);
  }
  if (id !== renderCount) return;

  const keep = focusId && document.getElementById(focusId);
  if (keep) {
    keep.focus();
  } else {
    window.scrollTo(0, 0);
    main.querySelector('.page-title')?.focus({ preventScroll: true });
  }
}

function setupChrome() {
  document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
  document.querySelector('.skip').addEventListener('click', () => main.querySelector('.page-title')?.focus() || main.focus());
}

function showMessage(html) {
  main.innerHTML = html;
  main.querySelector('.page-title')?.focus();
}

/** Point the data layer at the signed-in user's cloud data, or show sign-in. */
async function useAccount(user) {
  document.body.classList.toggle('signed-out', !user);
  if (!user) return true;
  showMessage('<p class="loading" role="status">Loading your data…</p>');
  try {
    await store.useBackend(createFirestoreBackend(auth.firebase(), user.uid));
    lastLoad = Date.now();
    return true;
  } catch (err) {
    console.error(err);
    showMessage(`<div class="panel panel-error" role="alert"><h1 class="page-title" tabindex="-1">Could not load your data</h1>
      <p>${esc(err?.code === 'permission-denied' ? 'The cloud refused access. The Firestore security rules may not be published yet.' : (err?.message || 'Check your connection.'))}</p>
      <p><button class="btn" type="button" onclick="location.reload()">Try again</button></p></div>`);
    return false;
  }
}

// Pick up changes made on another device when the app comes back to the front.
let lastLoad = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || store.backendKind() !== 'cloud' || Date.now() - lastLoad < 60000) return;
  try {
    await store.reload();
    lastLoad = Date.now();
    const { path } = parseHash();
    if (['/', '/vehicles', '/history'].includes(path)) render(); // never wipe a half-filled form
  } catch { /* keep showing what we have */ }
});

async function boot() {
  setupChrome();
  store.setNotifier((msg, kind) => toast(msg, kind));
  if (auth.isConfigured()) {
    showMessage('<p class="loading" role="status">Connecting…</p>');
    try {
      await auth.init();
    } catch (err) {
      console.error(err);
      showMessage(`<div class="panel panel-error" role="alert"><h1 class="page-title" tabindex="-1">Could not start sign-in</h1>
        <p>Check your internet connection and try again.</p><p><button class="btn" type="button" onclick="location.reload()">Try again</button></p></div>`);
      return;
    }
    if (!(await useAccount(auth.currentUser()))) return;
    auth.onChange(async (user) => { if (await useAccount(user)) render(); });
  } else {
    await store.ensureLoaded();
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();

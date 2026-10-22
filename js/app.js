// App entry: a small hash router (#/path?query). Hash URLs work on GitHub Pages
// project sites (username.github.io/repo/) without any server configuration.

import * as store from './store.js';
import { errorPanel, icon } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as vehicles from './views/vehicles.js';
import * as fuelForm from './views/fuel-form.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';

const ROUTES = [
  { re: /^\/$/, view: dashboard.render, nav: 'dashboard', title: 'Dashboard' },
  { re: /^\/vehicles$/, view: vehicles.renderList, nav: 'vehicles', title: 'My vehicles' },
  { re: /^\/vehicles\/new$/, view: vehicles.renderForm, nav: 'vehicles', title: 'Add a vehicle' },
  { re: /^\/vehicles\/([^/]+)\/edit$/, view: vehicles.renderForm, nav: 'vehicles', title: 'Edit vehicle' },
  { re: /^\/fuel\/new$/, view: fuelForm.render, nav: 'fuel', title: 'Add fuel' },
  { re: /^\/fuel\/([^/]+)\/edit$/, view: fuelForm.render, nav: 'history', title: 'Edit fuel entry' },
  { re: /^\/history$/, view: history.render, nav: 'history', title: 'History' },
  { re: /^\/settings$/, view: settings.render, nav: 'settings', title: 'Settings' },
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
  if (await store.hasDemoData()) parts.push('You are looking at sample data. <a href="#/settings">Remove it in Settings</a> when you are ready to add your own.');
  box.innerHTML = parts.map((p) => `<p>${p}</p>`).join('');
  box.hidden = !parts.length;
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
  try {
    await renderBanner();
    if (!route) {
      main.innerHTML = `<h1 class="page-title" tabindex="-1">Page not found</h1><p><a href="#/">Go to the dashboard</a></p>`;
    } else {
      document.title = `${route.title} | MileageMate`;
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

setupChrome();
window.addEventListener('hashchange', render);
render();

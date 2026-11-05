// Shared UI helpers: escaping, icons, toasts, confirm dialog, odometer display.

import * as fmt from './format.js';

/** Escape user text before putting it into HTML. Use for every user value. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICONS = {
  dashboard: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.4"/><path d="M4 17h16"/>',
  vehicles: '<path d="M5 16V11l2-4.5h10L19 11v5"/><path d="M3.5 16h17"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
  fuel: '<path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15"/><path d="M4 20h11"/><path d="M7 8h5"/><path d="M14 10h2a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8.5L18 6"/>',
  history: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scanfuel: '<path d="M3 8V4.8A1.8 1.8 0 0 1 4.8 3H8M16 3h3.2A1.8 1.8 0 0 1 21 4.8V8M21 16v3.2a1.8 1.8 0 0 1-1.8 1.8H16M8 21H4.8A1.8 1.8 0 0 1 3 19.2V16"/><path d="M8.2 17V8.6a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1V17M7.6 17h6.8M9.6 10h2.8"/><path d="M13.8 11h1.1a.9.9 0 0 1 .9.9v2.4a.9.9 0 0 0 1.8 0V9.6l-1.3-1.3"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-8.6 8.6a2.1 2.1 0 0 1-3-3l8.6-8.6a4 4 0 0 1-1.9-1.9z"/><path d="M15 3.5l2.2 2.2-1.7 1.7"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  receipt: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  tankFull: '<path d="M3.5 16.5a8.5 8.5 0 0 1 17 0"/><path d="M12 16.5l5.2-4.4"/><circle cx="12" cy="16.5" r="1.3"/><path d="M5.5 19.5h13"/>',
  tankHalf: '<path d="M3.5 16.5a8.5 8.5 0 0 1 17 0"/><path d="M12 16.5V9.6"/><circle cx="12" cy="16.5" r="1.3"/><path d="M5.5 19.5h13"/>',
  home: '<path d="M4 11.2 12 4.5l8 6.7V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z"/>',
  reports: '<path d="M5 20V12M10 20V8M15 20v-5M20 20V5"/>',
  menu: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/><path d="M4 5.5h16M4 18.5h16"/>',
  bellLine: '<path d="M12 4a6 6 0 0 0-6 6v4l-1.8 3h15.6L18 14v-4a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6"/>',
  two: '<circle cx="6" cy="16" r="3"/><circle cx="18" cy="16" r="3"/><path d="M6 16l4-7h4l4 7"/><path d="M13 9l-1-3h-2"/>',
  four: '<path d="M4 15v-3l2-4h12l2 4v3"/><path d="M3 15h18"/><circle cx="7.5" cy="16" r="1.8"/><circle cx="16.5" cy="16" r="1.8"/>',
};

export function icon(name, cls = 'icon') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/**
 * Odometer-style digits: whole part on dark wheels, decimals on amber wheels.
 * The visible digits are hidden from screen readers; `label` is read instead.
 */
export function odometer(value, { decimals = 2, unit = '', size = '', label = '' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const [whole, frac] = value.toFixed(decimals).split('.');
  const cells = [...whole].map((d) => `<span class="odo-cell">${d}</span>`).join('')
    + (frac ? [...frac].map((d) => `<span class="odo-cell odo-frac">${d}</span>`).join('') : '');
  const text = label || `${value.toFixed(decimals)} ${unit}`;
  return `<span class="odo ${size}" role="img" aria-label="${esc(text)}">${cells}${unit ? `<span class="odo-unit" aria-hidden="true">${esc(unit)}</span>` : ''}</span>`;
}

/** Plain-language hint for a vehicle that has no mileage yet. */
export function mileageHint(summary) {
  switch (summary.status) {
    case 'no-entries': return 'Add your first fuel entry to start tracking.';
    case 'need-full-tank': return 'Fill the tank to full and mark the entry as a full tank to start measuring mileage.';
    case 'need-next-full': return 'Add your next full-tank entry to calculate mileage.';
    case 'check-readings': return 'Mileage needs full-tank fills with odometer readings. Some are missing or go backwards; check History.';
    default: return '';
  }
}

// ---- Toasts ---------------------------------------------------------------------

export function toast(message, kind = 'ok', action = null) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}${action ? ' toast-action' : ''}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const a = document.createElement('a');
    a.href = action.href;
    a.textContent = action.label;
    a.addEventListener('click', () => el.remove());
    el.append(a);
  }
  box.append(el);
  const life = action ? 6500 : 3200; // time to tap Edit
  setTimeout(() => el.classList.add('toast-out'), life);
  setTimeout(() => el.remove(), life + 400);
}

// ---- Confirm dialog -------------------------------------------------------------

/**
 * Ask before something destructive. Resolves true when confirmed.
 * With `typeToConfirm`, the confirm button stays disabled until that text is typed.
 */
export function confirmDialog({ title, message, confirmLabel = 'Delete', typeToConfirm = '' }) {
  const dlg = document.getElementById('confirm');
  dlg.querySelector('h2').textContent = title;
  dlg.querySelector('.dlg-msg').textContent = message;
  const ok = dlg.querySelector('[value="ok"]');
  ok.textContent = confirmLabel;
  const typeWrap = dlg.querySelector('.dlg-type');
  const input = typeWrap.querySelector('input');
  input.value = '';
  if (typeToConfirm) {
    typeWrap.hidden = false;
    typeWrap.querySelector('label').textContent = `Type ${typeToConfirm} to confirm`;
    ok.disabled = true;
    input.oninput = () => { ok.disabled = input.value.trim().toLowerCase() !== typeToConfirm.toLowerCase(); };
  } else {
    typeWrap.hidden = true;
    ok.disabled = false;
    input.oninput = null;
  }
  return new Promise((resolve) => {
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

// ---- Misc -------------------------------------------------------------------

export function emptyState({ title, text, actions = '' }) {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions">${actions}</div></div>`;
}

export function errorPanel(err) {
  return `<div class="panel panel-error" role="alert"><h2>Something went wrong</h2><p>${esc(err?.message || err)}</p><p><a href="#/">Go to the dashboard</a></p></div>`;
}

export { fmt };

// ---- Form errors ----------------------------------------------------------------

/**
 * Show validation messages. Each field lives in <div class="field" data-field="name">
 * containing a <p class="field-error">. Focuses the first field with an error.
 */
export function showFieldErrors(form, errors) {
  let first = null;
  form.querySelectorAll('.field').forEach((wrap) => {
    const name = wrap.dataset.field;
    const msg = errors[name];
    const out = wrap.querySelector('.field-error');
    const controls = wrap.querySelectorAll('input, select, textarea');
    if (out) {
      out.textContent = msg || '';
      out.hidden = !msg;
    }
    controls.forEach((c) => (msg ? c.setAttribute('aria-invalid', 'true') : c.removeAttribute('aria-invalid')));
    if (msg && !first) first = controls[0];
  });
  const formMsg = form.querySelector('.form-error');
  if (formMsg) {
    formMsg.textContent = errors._form || '';
    formMsg.hidden = !errors._form;
    if (errors._form && !first) first = formMsg;
  }
  if (first) first.focus();
  return !first;
}

/** Markup for one labelled field. `input` is the control's HTML. */
export function field(name, label, input, hint = '') {
  const hintId = hint ? ` id="${name}-hint"` : '';
  const described = [hint ? `${name}-hint` : '', `${name}-error`].filter(Boolean).join(' ');
  input = input.replace(`id="${name}"`, `id="${name}" aria-describedby="${described}"`);
  return `
    <div class="field" data-field="${name}">
      <label for="${name}">${label}</label>
      ${hint ? `<p class="hint"${hintId}>${hint}</p>` : ''}
      ${input}
      <p class="field-error" id="${name}-error" hidden></p>
    </div>`;
}

/** Disable a submit button while an async save runs, so double taps save once. */
export async function busy(button, label, fn) {
  if (button.disabled) return;
  const old = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = old;
  }
}

/**
 * Large tap-friendly radio buttons in a fieldset.
 * options: [{ value, label, disabled, note }]
 */
export function choices(name, legend, options, selected) {
  const items = options.map((o) => `
    <label class="choice${o.disabled ? ' choice-off' : ''}">
      <input type="radio" name="${name}" value="${esc(o.value)}"${o.value === selected ? ' checked' : ''}${o.disabled ? ' disabled' : ''}>
      <span>${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</span>
    </label>`).join('');
  return `
    <fieldset class="field" data-field="${name}" aria-describedby="${name}-error">
      <legend>${legend}</legend>
      <div class="choice-row">${items}</div>
      <p class="field-error" id="${name}-error" hidden></p>
    </fieldset>`;
}

// ---- Image viewer ---------------------------------------------------------------
// Opens photos inside the app instead of a new tab. Large photos kept as data URLs
// crash or are blocked when opened as a page of their own, especially on phones.
// Markup: a container with data-gallery, holding <button data-view> elements that
// each contain the <img> to show.

let viewer = null;

function closeViewer() {
  if (!viewer) return;
  viewer.el.remove();
  document.body.classList.remove('viewer-open');
  viewer.returnFocus?.focus();
  viewer = null;
}

function showViewerImage(i) {
  const n = viewer.srcs.length;
  viewer.index = (i + n) % n;
  const img = viewer.el.querySelector('.viewer-img');
  img.src = viewer.srcs[viewer.index];
  img.alt = viewer.alts[viewer.index] || '';
  viewer.el.querySelector('.viewer-count').textContent = n > 1 ? `${viewer.index + 1} of ${n}` : '';
}

export function openImageViewer(srcs, alts = [], start = 0, returnFocus = null) {
  closeViewer();
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Photo viewer');
  el.innerHTML = `
    <div class="viewer-bar">
      <span class="viewer-count"></span>
      <button type="button" class="viewer-btn" data-close aria-label="Close">✕</button>
    </div>
    <div class="viewer-stage"><img class="viewer-img" alt=""></div>
    ${srcs.length > 1 ? '<button type="button" class="viewer-btn viewer-prev" data-prev aria-label="Previous">‹</button><button type="button" class="viewer-btn viewer-next" data-next aria-label="Next">›</button>' : ''}`;
  document.body.append(el);
  document.body.classList.add('viewer-open');
  viewer = { el, srcs, alts, index: 0, returnFocus };
  showViewerImage(start);
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]') || ev.target === el || ev.target.classList.contains('viewer-stage')) closeViewer();
    else if (ev.target.closest('[data-prev]')) showViewerImage(viewer.index - 1);
    else if (ev.target.closest('[data-next]')) showViewerImage(viewer.index + 1);
  });
  el.querySelector('[data-close]').focus();
}

document.addEventListener('keydown', (ev) => {
  if (!viewer) return;
  if (ev.key === 'Escape') closeViewer();
  if (ev.key === 'ArrowLeft') showViewerImage(viewer.index - 1);
  if (ev.key === 'ArrowRight') showViewerImage(viewer.index + 1);
});
window.addEventListener('hashchange', closeViewer);

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-view]');
  if (!btn) return;
  ev.preventDefault();
  const group = btn.closest('[data-gallery]') || btn.parentElement;
  const buttons = [...group.querySelectorAll('[data-view]')];
  const imgs = buttons.map((b) => b.querySelector('img'));
  openImageViewer(imgs.map((i) => i.currentSrc || i.src), imgs.map((i) => i.alt), buttons.indexOf(btn), btn);
});

/** Label text with a red asterisk for required fields. */
export const req = (label) => `${label}<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span>`;

/** Compact vehicle picker: one dropdown line instead of big tiles. */
export function vehicleSelect(vehicles, selectedId, label = 'Vehicle') {
  const opts = vehicles.map((v) => `<option value="${esc(v.id)}"${v.id === selectedId ? ' selected' : ''}>${esc(v.nickname)}</option>`).join('');
  return `
    <div class="field field-inline" data-field="vehicleId">
      <label for="vehicleId">${label}</label>
      <select id="vehicleId" name="vehicleId" class="vehicle-select">${opts}</select>
      <p class="field-error" id="vehicleId-error" hidden></p>
    </div>`;
}

// ---- Rich two-tone icons for tiles and menus ----------------------------------
// Each uses --c1 (main) and --c2 (light accent), set per tile in CSS.
const RICH = {
  scan: '<path d="M8 17V11a3 3 0 0 1 3-3h6M31 8h6a3 3 0 0 1 3 3v6M40 31v6a3 3 0 0 1-3 3h-6M17 40h-6a3 3 0 0 1-3-3v-6" fill="none" stroke="var(--c1)" stroke-width="3.4" stroke-linecap="round"/><rect x="15" y="13" width="18" height="22" rx="2.5" fill="var(--c2)"/><path d="M19 19h10M19 23.5h10M19 28h6" stroke="var(--c1)" stroke-width="2.4" stroke-linecap="round"/>',
  fuel: '<rect x="9" y="9" width="20" height="31" rx="3.5" fill="var(--c1)"/><rect x="13" y="13" width="12" height="8" rx="1.6" fill="var(--c2)"/><rect x="6" y="38" width="26" height="4" rx="2" fill="var(--c1)"/><path d="M29 18h3.5a2.5 2.5 0 0 1 2.5 2.5V31a2.5 2.5 0 0 0 5 0V17l-4-4.5" fill="none" stroke="var(--c1)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="29" r="3.2" fill="var(--c2)"/>',
  service: '<path d="M31.5 7.5a8.5 8.5 0 0 0-8.6 11.2L8.6 33a3.6 3.6 0 0 0 5.1 5.1L28 23.8A8.5 8.5 0 0 0 39.4 13.7l-5 5-4.6-1.2-1.2-4.6 5-5a8.6 8.6 0 0 0-2.1-.4z" fill="var(--c1)"/><circle cx="11.2" cy="35.6" r="1.8" fill="var(--c2)"/><path d="M33 31l6 6" stroke="var(--c2)" stroke-width="5.5" stroke-linecap="round"/><path d="M27 25l4.5 4.5" stroke="var(--c2)" stroke-width="3" stroke-linecap="round"/>',
  challan: '<rect x="15" y="5" width="18" height="34" rx="6" fill="var(--c1)"/><circle cx="24" cy="13" r="3.8" fill="#FF5A4E"/><circle cx="24" cy="22" r="3.8" fill="#FFC23D"/><circle cx="24" cy="31" r="3.8" fill="#43C26A"/><rect x="22" y="39" width="4" height="5" fill="var(--c1)"/><path d="M15 12h-4l4 4M33 12h4l-4 4M15 21h-4l4 4M33 21h4l-4 4" fill="var(--c2)"/>',
  reports: '<rect x="7" y="27" width="7" height="13" rx="2" fill="var(--c2)"/><rect x="17" y="19" width="7" height="21" rx="2" fill="var(--c2)"/><rect x="27" y="23" width="7" height="17" rx="2" fill="var(--c2)"/><rect x="37" y="10" width="7" height="30" rx="2" fill="var(--c1)"/><path d="M8 21l10-8 9 5 11-10" fill="none" stroke="var(--c1)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  reminders: '<rect x="7" y="10" width="34" height="31" rx="5" fill="var(--c2)"/><path d="M7 15a5 5 0 0 1 5-5h24a5 5 0 0 1 5 5v4H7z" fill="var(--c1)"/><rect x="14" y="6" width="4" height="8" rx="2" fill="var(--c1)"/><rect x="30" y="6" width="4" height="8" rx="2" fill="var(--c1)"/><circle cx="24" cy="30" r="7" fill="#fff"/><path d="M24 26.5V30l2.5 2" fill="none" stroke="var(--c1)" stroke-width="2.4" stroke-linecap="round"/>',
  history: '<rect x="9" y="6" width="30" height="36" rx="4" fill="var(--c2)"/><rect x="17" y="3.5" width="14" height="6" rx="2.5" fill="var(--c1)"/><path d="M15 18h18M15 25h18M15 32h11" stroke="var(--c1)" stroke-width="3" stroke-linecap="round"/>',
  settings: '<path d="M24 5l3.2 4.4 5.3-1.3 1.3 5.3L38.2 16l-1.3 5.3L41 24l-4.4 3.2 1.3 5.3-5.3 1.3-2.4 4.4-5.3-1.3L24 41l-3.2-4.4-5.3 1.3-1.3-5.3L9.8 30l1.3-5.3L7 21.6l4.4-3.2-1.3-5.3 5.3-1.3L18 7.4l5.3 1.3z" fill="var(--c1)"/><circle cx="24" cy="23" r="7" fill="var(--c2)"/>',
  contact: '<path d="M8 12a5 5 0 0 1 5-5h22a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H21l-8 7v-7a5 5 0 0 1-5-5z" fill="var(--c1)"/><circle cx="17" cy="19.5" r="2.6" fill="var(--c2)"/><circle cx="24" cy="19.5" r="2.6" fill="var(--c2)"/><circle cx="31" cy="19.5" r="2.6" fill="var(--c2)"/>',
  car: '<path d="M8 27l3.5-9.5A5 5 0 0 1 16.2 14h15.6a5 5 0 0 1 4.7 3.5L40 27v8a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-2H15v2a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z" fill="var(--c1)"/><path d="M14 25l2.4-6.4a2 2 0 0 1 1.9-1.3h11.4a2 2 0 0 1 1.9 1.3L34 25z" fill="var(--c2)"/><circle cx="15" cy="30" r="2.6" fill="var(--c2)"/><circle cx="33" cy="30" r="2.6" fill="var(--c2)"/>',
  bike: '<circle cx="11" cy="32" r="6.5" fill="none" stroke="var(--c1)" stroke-width="3.4"/><circle cx="37" cy="32" r="6.5" fill="none" stroke="var(--c1)" stroke-width="3.4"/><path d="M14 25h7l3 4h8l4-7" fill="none" stroke="var(--c1)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 22c1.5-4 4-5.5 8-5.5h4.5l1.5 4.5-6 3H19z" fill="var(--c1)"/><path d="M20 17.5c1.8-1.6 3.6-2.2 6-2.2h3l1 3h-9z" fill="var(--c2)"/><path d="M33 15h4l2 4M30.5 15H34" fill="none" stroke="var(--c1)" stroke-width="2.8" stroke-linecap="round"/><rect x="21" y="27" width="7" height="5" rx="1.5" fill="var(--c2)"/>',
  bell: '<path d="M24 6a12 12 0 0 0-12 12v8l-4 6h32l-4-6v-8A12 12 0 0 0 24 6z" fill="var(--c1)"/><path d="M19 36a5 5 0 0 0 10 0z" fill="var(--c2)"/>',
};

/** A rich two-tone icon. `tone` picks the colour pair (green, amber, purple, red, blue, teal, slate). */
export function ricon(name, tone = 'green') {
  return `<svg class="ricon tone-${tone}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${RICH[name] || ''}</svg>`;
}

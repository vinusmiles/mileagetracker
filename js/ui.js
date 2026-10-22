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
    case 'check-readings': return 'Some odometer readings go backwards. Check the flagged entries in History.';
    default: return '';
  }
}

// ---- Toasts ---------------------------------------------------------------------

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.classList.add('toast-out'), 3200);
  setTimeout(() => el.remove(), 3600);
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

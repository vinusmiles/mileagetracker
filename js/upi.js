// "Pay with UPI app": a button on the Saved message that opens a sheet of UPI apps.

import { appLink, orderApps } from './core/upi.js';
import { platform } from './install.js';
import { esc, fmt, icon } from './ui.js';

const LAST_KEY = 'gk:upiLast';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* the choice just isn't remembered */ }
}

function openSheet(amount) {
  const android = platform().startsWith('android-');
  const due = amount > 0 ? `<p>Amount: ${esc(fmt.moneyExact(amount))}</p>` : '';
  const body = android
    ? `<div class="upi-grid">${orderApps(read(LAST_KEY)).map((app) => `
        <a class="upi-app" href="${esc(appLink(app))}" data-upi="${esc(app.id)}">
          <img src="assets/upi/${esc(app.id)}.svg" alt="${esc(app.name)}" height="32">
        </a>`).join('')}</div>
      <p class="hint">This only opens the app. Scan the pump's QR code there.</p>`
    : '<p class="upi-note">Now pay in your UPI app.</p><button type="button" class="btn btn-primary btn-block" data-close>Got it</button>';

  const el = document.createElement('div');
  el.className = 'sheet-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'upi-h');
  el.innerHTML = `
    <div class="sheet-box">
      <div class="sheet-head">
        <div><h2 id="upi-h">Pay with UPI app</h2>${due}</div>
        <button type="button" class="sheet-x" data-close aria-label="Close">${icon('close')}</button>
      </div>
      ${body}
    </div>`;
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener('click', (ev) => {
    const app = ev.target.closest('[data-upi]');
    if (app) {
      write(LAST_KEY, app.dataset.upi);
      setTimeout(close, 300); // a link removed during its click would not open
      return;
    }
    if (ev.target === el || ev.target.closest('[data-close]')) close();
  });
  el.querySelector('.sheet-x').focus();
}

/** The toast action for a saved fuel entry. */
export function payAction(amount) {
  return { label: 'Pay with UPI app', onClick: () => openSheet(amount) };
}

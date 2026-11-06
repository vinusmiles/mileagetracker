// "Install GaadiKhata": uses the browser's own install prompt where it exists
// (Chrome, Edge, Samsung Internet on Android, and Chrome/Edge on computers).
// Elsewhere (iPhone Safari, Firefox…) it shows short steps for that browser.
// The browser always asks the person to confirm; we never skip that.

import { icon, toast } from './ui.js';

const DISMISS_KEY = 'gk:installDismissed';
const INSTALLED_KEY = 'gk:installed';

/** True when running as the installed app, or the browser told us it was installed. */
export function isInstalled() {
  if (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
  if (window.navigator.standalone === true) return true; // iPhone home-screen app
  try { return localStorage.getItem(INSTALLED_KEY) === '1' && !window.__gkInstall; } catch { return false; }
}

export const canPrompt = () => !!window.__gkInstall;

/** Which browser are we in? Used for the manual steps. */
export function platform() {
  const ua = navigator.userAgent || '';
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    if (/FxiOS/.test(ua)) return 'ios-firefox';
    if (/EdgiOS/.test(ua)) return 'ios-edge';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'android-samsung';
    if (/Firefox/.test(ua)) return 'android-firefox';
    if (/EdgA/.test(ua)) return 'android-edge';
    return 'android-chrome';
  }
  if (/Edg\//.test(ua)) return 'desktop-edge';
  if (/Firefox/.test(ua)) return 'desktop-firefox';
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return 'desktop-safari';
  return 'desktop-chrome';
}

const SHARE = '<svg class="icon share-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
const DOTS = '<b class="key">⋮</b>';

const STEPS = {
  'ios-safari': ['Tap the <b>Share</b> button ' + SHARE + ' at the bottom of Safari.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. GaadiKhata appears on your home screen.'],
  'ios-chrome': ['Tap the <b>Share</b> button ' + SHARE + ' in the address bar.', 'Tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'],
  'ios-edge': ['Tap the <b>Share</b> button ' + SHARE + '.', 'Tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'],
  'ios-firefox': ['Tap the menu <b>☰</b>, then <b>Share</b>.', 'Tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'],
  'android-chrome': ['Tap the menu ' + DOTS + ' at the top right of Chrome.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Tap <b>Install</b> to confirm.'],
  'android-edge': ['Tap the menu <b>…</b> at the bottom.', 'Tap <b>Add to phone</b>.', 'Tap <b>Install</b>.'],
  'android-samsung': ['Tap the menu <b>☰</b> at the bottom right.', 'Tap <b>Add page to</b>, then <b>Home screen</b>.', 'Tap <b>Add</b>.'],
  'android-firefox': ['Tap the menu ' + DOTS + '.', 'Tap <b>Install</b> (or <b>Add to Home screen</b>).', 'Tap <b>Add</b>.'],
  'desktop-chrome': ['Click the install icon <b>⊕</b> at the right end of the address bar.', 'Or open the menu ' + DOTS + ' → <b>Cast, save and share</b> → <b>Install page as app</b>.', 'Click <b>Install</b>.'],
  'desktop-edge': ['Click the app icon <b>⊕</b> in the address bar.', 'Or open the menu <b>…</b> → <b>Apps</b> → <b>Install this site as an app</b>.', 'Click <b>Install</b>.'],
  'desktop-safari': ['In the menu bar, choose <b>File → Add to Dock</b>.', 'Click <b>Add</b>.'],
  'desktop-firefox': ['Firefox on computers cannot install web apps.', 'Open gaadikhata.co.in in <b>Chrome</b> or <b>Edge</b> to install it, or use your phone.'],
};

const NAMES = {
  'ios-safari': 'Safari on iPhone', 'ios-chrome': 'Chrome on iPhone', 'ios-edge': 'Edge on iPhone', 'ios-firefox': 'Firefox on iPhone',
  'android-chrome': 'Chrome on Android', 'android-edge': 'Edge on Android', 'android-samsung': 'Samsung Internet', 'android-firefox': 'Firefox on Android',
  'desktop-chrome': 'Chrome', 'desktop-edge': 'Edge', 'desktop-safari': 'Safari on Mac', 'desktop-firefox': 'Firefox',
};

function manualSheet() {
  const p = platform();
  const el = document.createElement('div');
  el.className = 'sheet-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'install-h');
  el.innerHTML = `
    <div class="sheet-box">
      <div class="sheet-head">
        <img src="assets/icons/icon-192.png" alt="" width="48" height="48">
        <div><h2 id="install-h">Install GaadiKhata</h2><p>${NAMES[p]}</p></div>
        <button type="button" class="sheet-x" data-close aria-label="Close">${icon('close')}</button>
      </div>
      <ol class="install-steps">${STEPS[p].map((s) => `<li>${s}</li>`).join('')}</ol>
      <p class="hint">It opens full screen like an app, from your home screen. Your data stays the same.</p>
      <button type="button" class="btn btn-primary btn-block" data-close>Got it</button>
    </div>`;
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('[data-close]')) close(); });
  el.querySelector('.sheet-x').focus();
}

/** Called by the Install buttons. */
export async function startInstall() {
  const prompt = window.__gkInstall;
  if (!prompt) { manualSheet(); return; }
  try {
    await prompt.prompt(); // the browser shows its own "Install app?" confirmation
    const { outcome } = await prompt.userChoice;
    window.__gkInstall = null; // a prompt can be used only once
    if (outcome !== 'accepted') toast('No problem. You can install it any time from More.');
  } catch {
    manualSheet();
  }
}

/** Home card: prominent, but can be hidden for a week with "Not now". */
export function installCardHTML() {
  if (isInstalled()) return '';
  try { if (Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 7 * 864e5) return ''; } catch { /* ignore */ }
  return `
    <section class="install-card" data-install-card aria-label="Install GaadiKhata">
      <img src="assets/icons/icon-192.png" alt="" width="52" height="52">
      <div class="install-text"><strong>Install GaadiKhata</strong><span>Open it like an app, right from your home screen.</span></div>
      <div class="install-actions">
        <button type="button" class="btn btn-primary btn-sm" data-install>${icon('download')}Install</button>
        <button type="button" class="link-btn" data-install-later>Not now</button>
      </div>
    </section>`;
}

export function bindInstall(root) {
  root.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', startInstall));
  root.querySelector('[data-install-later]')?.addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    root.querySelector('[data-install-card]')?.remove();
  });
}

// Installed: say thank you once, remember it, and hide every install button.
window.addEventListener('appinstalled', () => {
  window.__gkInstall = null;
  try { localStorage.setItem(INSTALLED_KEY, '1'); localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
  document.querySelectorAll('[data-install-card], [data-install-item]').forEach((n) => n.remove());
  toast('GaadiKhata is installed 🎉 Open it from your home screen.');
});
// The browser offers install again → it is not installed (e.g. it was removed)
window.addEventListener('gk-installable', () => { try { localStorage.removeItem(INSTALLED_KEY); } catch { /* ignore */ } });

/** Register the service worker (needed for installing; also lets the app open offline). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

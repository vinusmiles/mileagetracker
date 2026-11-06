// Sign-in screen: Google, and (when enabled) mobile number with SMS OTP.

import * as auth from '../auth.js';
import { esc, icon } from '../ui.js';
import { isInstalled, bindInstall } from '../install.js';

const RESEND_SECONDS = 30;
let timer = null;

const google = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z"/></svg>';

export async function render(main) {
  clearInterval(timer);
  auth.resetPhone();
  const phoneOn = auth.authOptions.phone;
  const cc = auth.authOptions.phoneCountryCode || '+91';

  main.innerHTML = `
    <div class="login">
      <div class="logo-plate"><img src="assets/logo-full.webp" alt="GaadiKhata: fuel, maintenance, expenses and more" width="320" height="292"></div>
      <h1 class="page-title" tabindex="-1">Sign in</h1>
      <p class="lead">Your vehicles and fuel records are saved to your own private account and follow you to any device.</p>

      <p class="form-error" role="alert" tabindex="-1" hidden></p>

      <button class="btn btn-block btn-google" type="button" data-google>${google}Continue with Google</button>

      ${phoneOn ? `
        <div class="or"><span>or</span></div>
        <form class="form" data-phone novalidate>
          <div class="field" data-field="phone">
            <label for="phone">Mobile number</label>
            <div class="phone-row"><span class="cc">${esc(cc)}</span>
              <input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" aria-describedby="phone-error"></div>
            <p class="field-error" id="phone-error" hidden></p>
          </div>
          <button class="btn btn-primary btn-block" type="submit" data-send>Send OTP</button>
        </form>
        <form class="form" data-code novalidate hidden>
          <p data-sent-to></p>
          <div class="field" data-field="code">
            <label for="code">6-digit code</label>
            <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-describedby="code-error">
            <p class="field-error" id="code-error" hidden></p>
          </div>
          <button class="btn btn-primary btn-block" type="submit" data-verify>Verify and sign in</button>
          <div class="split">
            <button class="btn btn-quiet" type="button" data-resend disabled>Resend code</button>
            <button class="btn btn-quiet" type="button" data-change>Change number</button>
          </div>
        </form>
        <div id="recaptcha"></div>
        <p class="hint">Firebase runs a hidden security check to block automated sign-ups.</p>` : ''}

      <p class="hint login-note">GaadiKhata never sees your Google password and never stores SMS codes. Firebase handles sign-in.</p>
      <p class="login-note"><a class="btn btn-sm btn-insta" href="https://www.instagram.com/gaadikhata/" target="_blank" rel="noopener">${icon('instagram')}Need help? @gaadikhata</a></p>
      ${isInstalled() ? '' : `<p class="login-note"><button type="button" class="btn btn-sm login-install" data-install><img src="assets/icons/icon-192.png" alt="" width="22" height="22">Install the GaadiKhata app</button></p>`}
      <p class="hint login-note">© 2026 GaadiKhata. All rights reserved.</p>
    </div>`;
  bindInstall(main);

  const errBox = main.querySelector('.form-error');
  const showError = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; if (msg) errBox.focus(); };
  const setBusy = (btn, busy, label) => { btn.disabled = busy; if (label) btn.textContent = label; };

  const gBtn = main.querySelector('[data-google]');
  gBtn.addEventListener('click', async () => {
    showError('');
    gBtn.disabled = true;
    try {
      await auth.signInWithGoogle(); // the app re-renders when the session changes
    } catch (err) {
      showError(auth.friendlyAuthError(err));
    } finally {
      gBtn.disabled = false;
    }
  });

  if (!phoneOn) return;

  const phoneForm = main.querySelector('[data-phone]');
  const codeForm = main.querySelector('[data-code]');
  const sendBtn = main.querySelector('[data-send]');
  const verifyBtn = main.querySelector('[data-verify]');
  const resendBtn = main.querySelector('[data-resend]');
  const phoneErr = main.querySelector('#phone-error');
  const codeErr = main.querySelector('#code-error');
  let number = '';

  const fieldError = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

  function startCooldown() {
    let left = RESEND_SECONDS;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend code in ${left}s`;
    clearInterval(timer);
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) { clearInterval(timer); resendBtn.disabled = false; resendBtn.textContent = 'Resend code'; return; }
      resendBtn.textContent = `Resend code in ${left}s`;
    }, 1000);
  }

  async function send() {
    showError('');
    setBusy(sendBtn, true, 'Sending…');
    try {
      await auth.sendOtp(`${cc}${number}`, main.querySelector('#recaptcha'));
      phoneForm.hidden = true;
      codeForm.hidden = false;
      codeForm.querySelector('[data-sent-to]').textContent = `We sent a code to ${cc} ${number.slice(0, 5)} ${number.slice(5)}.`;
      codeForm.querySelector('#code').focus();
      startCooldown();
    } catch (err) {
      showError(auth.friendlyAuthError(err));
    } finally {
      setBusy(sendBtn, false, 'Send OTP');
    }
  }

  phoneForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    number = phoneForm.phone.value.replace(/\D/g, '');
    if (cc === '+91' && !/^[6-9]\d{9}$/.test(number)) {
      fieldError(phoneErr, 'Enter a 10-digit Indian mobile number.');
      phoneForm.phone.focus();
      return;
    }
    fieldError(phoneErr, '');
    if (!sendBtn.disabled) await send();
  });

  codeForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const code = codeForm.code.value.replace(/\D/g, '');
    if (code.length !== 6) { fieldError(codeErr, 'Enter the 6-digit code.'); return; }
    fieldError(codeErr, '');
    showError('');
    setBusy(verifyBtn, true, 'Checking…');
    try {
      await auth.verifyOtp(code);
      clearInterval(timer);
    } catch (err) {
      showError(auth.friendlyAuthError(err));
      setBusy(verifyBtn, false, 'Verify and sign in');
    }
  });

  resendBtn.addEventListener('click', async () => {
    if (!resendBtn.disabled) await send();
  });

  main.querySelector('[data-change]').addEventListener('click', () => {
    clearInterval(timer);
    auth.resetPhone();
    codeForm.hidden = true;
    phoneForm.hidden = false;
    phoneForm.phone.focus();
  });
}


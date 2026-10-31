// Sign-in with Firebase Authentication: Google, and phone number with SMS OTP.
// No passwords or OTP codes are ever stored by GaadiKhata; Firebase handles them.

import { isConfigured, loadFirebase } from './cloud/firebase.js';
import { authOptions } from './firebase-config.js';

const state = { user: null };
const listeners = new Set();
let fb = null;
let verifier = null;
let confirmation = null;

export { isConfigured, authOptions };
export const currentUser = () => state.user;
export const firebase = () => fb;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Load Firebase and wait for the saved session (if any) to be restored. */
export async function init() {
  if (!isConfigured()) return null;
  fb = await loadFirebase();
  await new Promise((resolve) => {
    let first = true;
    fb.a.onAuthStateChanged(fb.auth, (user) => {
      const changed = state.user?.uid !== user?.uid;
      state.user = user;
      if (first) { first = false; resolve(); return; }
      if (changed) listeners.forEach((fn) => fn(user));
    });
  });
  return state.user;
}

export async function signInWithGoogle() {
  const provider = new fb.a.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await fb.a.signInWithPopup(fb.auth, provider);
}

/**
 * Send an OTP by SMS. `container` is the element (or id) for the invisible
 * reCAPTCHA that Firebase uses to block automated abuse.
 */
export async function sendOtp(phoneE164, container) {
  // A fresh reCAPTCHA for every send, so "Resend code" never reuses a spent check.
  resetPhone();
  const holder = document.createElement('div');
  container.append(holder);
  verifier = new fb.a.RecaptchaVerifier(fb.auth, holder, { size: 'invisible' });
  try {
    confirmation = await fb.a.signInWithPhoneNumber(fb.auth, phoneE164, verifier);
  } finally {
    resetPhone();
    holder.remove();
  }
}

export async function verifyOtp(code) {
  if (!confirmation) throw Object.assign(new Error('Request a new code first.'), { code: 'auth/missing-verification-id' });
  await confirmation.confirm(code);
  confirmation = null;
  resetPhone();
}

export function resetPhone() {
  try { verifier?.clear(); } catch { /* already cleared */ }
  verifier = null;
}

/**
 * Sign out and remove this account's offline copy from the browser, so the
 * next person using the device cannot read it. Reloads the page afterwards.
 */
export async function signOut() {
  await fb.a.signOut(fb.auth);
  try {
    await fb.fs.terminate(fb.db);
    await fb.fs.clearIndexedDbPersistence(fb.db);
  } catch { /* nothing cached */ }
  location.reload();
}

export function describeUser(user = state.user) {
  if (!user) return '';
  return user.email || user.phoneNumber || 'your account';
}

/** Turn Firebase error codes into plain messages. */
export function friendlyAuthError(err) {
  const code = err?.code || '';
  const messages = {
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
    'auth/unauthorized-domain': 'This website address is not allowed to sign in yet. Add it under Firebase → Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method is not switched on in Firebase yet.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
    'auth/internal-error': 'Sign-in could not start. Check your connection and that pop-ups are allowed, then try again.',
    'auth/invalid-phone-number': 'That phone number does not look right. Enter the 10-digit mobile number.',
    'auth/missing-phone-number': 'Enter your mobile number.',
    'auth/invalid-verification-code': 'That code is not correct. Check the SMS and try again.',
    'auth/missing-verification-code': 'Enter the 6-digit code from the SMS.',
    'auth/code-expired': 'That code has expired. Request a new one.',
    'auth/missing-verification-id': 'Request a new code first.',
    'auth/too-many-requests': 'Too many attempts. Please wait a while before trying again.',
    'auth/quota-exceeded': 'SMS sign-in is temporarily unavailable. Try again later or use Google.',
    'auth/billing-not-enabled': 'SMS sign-in needs billing switched on in Firebase. Use Google for now.',
    'auth/captcha-check-failed': 'The security check failed. Reload the page and try again.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/account-exists-with-different-credential': 'This email already uses a different sign-in method.',
  };
  return messages[code] || err?.message || 'Sign-in failed. Please try again.';
}

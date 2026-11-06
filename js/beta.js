// Is this browser in beta? Read once when the app opens, and remembered.
import { betaState } from './core/beta.js';

const KEY = 'gk:beta';

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export const betaOn = betaState(location.search, stored());
try { localStorage.setItem(KEY, betaOn ? '1' : '0'); } catch { /* it just isn't remembered */ }

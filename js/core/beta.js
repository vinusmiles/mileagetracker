// Beta switch. ?beta=1 turns beta features on for this browser, ?beta=0 turns them off.
export function betaState(search, stored) {
  const value = new URLSearchParams(search).get('beta');
  if (value === '1') return true;
  if (value === '0') return false;
  return stored === '1';
}

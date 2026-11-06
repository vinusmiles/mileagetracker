// UPI apps offered after a fuel entry is saved. This only OPENS an app: there is no
// payee, amount or payment link, and GaadiKhata never sees or takes part in a payment.
//
// The phone's own UPI chooser (upi://pay) needs a real payee ID, so each app is opened
// through its own Android link instead. If the link does not work, or the app is not
// installed, Chrome goes to the app's Play Store page.
// The schemes are not an official list: check each app on a real phone before release.

export const UPI_APPS = [
  { id: 'phonepe', name: 'PhonePe', scheme: 'phonepe', pkg: 'com.phonepe.app' },
  { id: 'gpay', name: 'GPay', scheme: 'tez', pkg: 'com.google.android.apps.nbu.paisa.user' },
  { id: 'paytm', name: 'Paytm', scheme: 'paytmmp', pkg: 'net.one97.paytm' },
];

/** Android link that opens the app, or its Play Store page. */
export function appLink(app) {
  const store = `https://play.google.com/store/apps/details?id=${app.pkg}`;
  return `intent://open#Intent;scheme=${app.scheme};package=${app.pkg};S.browser_fallback_url=${encodeURIComponent(store)};end`;
}

/** The app used last comes first; the rest keep their order. */
export function orderApps(lastUsedId, apps = UPI_APPS) {
  const last = apps.find((a) => a.id === lastUsedId);
  return last ? [last, ...apps.filter((a) => a !== last)] : [...apps];
}

/** ?beta=1 turns beta features on for this browser, ?beta=0 turns them off. */
export function betaState(search, stored) {
  const value = new URLSearchParams(search).get('beta');
  if (value === '1') return true;
  if (value === '0') return false;
  return stored === '1';
}

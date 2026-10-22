// Date helpers. All dates are stored as local calendar dates in 'YYYY-MM-DD' form,
// so a fill made at 7 am in India is never shifted to the previous day by UTC.

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function addDays(s, days) {
  const [y, m, d] = s.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
}

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export const monthKey = (s) => s.slice(0, 7);

/** The last n month keys ending with the month of `s`, oldest first. */
export function lastMonths(s, n) {
  const [y, m] = s.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1 - i, 1);
    out.push(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`);
  }
  return out;
}

/** First and last day of a 'YYYY-MM' month. */
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return { from: `${key}-01`, to: toDateStr(new Date(y, m, 0)) };
}

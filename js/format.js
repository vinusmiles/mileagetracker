// Display formatting with Indian conventions: ₹, lakh grouping, km, DD-MM-YYYY.

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dash = '–';
const has = (n) => typeof n === 'number' && Number.isFinite(n);

/** Whole rupees, for summaries: ₹1,23,456 */
export const money = (n) => (has(n) ? inr0.format(n) : dash);
/** Rupees and paise, for single fills: ₹523.40 */
export const moneyExact = (n) => (has(n) ? inr2.format(n) : dash);
export const km = (n) => (has(n) ? `${int.format(n)} km` : dash);
export const kmNumber = (n) => (has(n) ? int.format(n) : dash);
export const qty = (n, unit = 'L') => (has(n) ? `${dec2.format(n)} ${unit}` : dash);
export const mileage = (n, unit = 'L') => (has(n) ? `${dec2.format(n)} km/${unit}` : dash);
export const perKm = (n) => (has(n) ? `${inr2.format(n)}/km` : dash);

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY' */
export function date(s) {
  if (!s) return dash;
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}

/** 'YYYY-MM' -> 'Oct 2026' (or 'October 2026' when long) */
export function month(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

/** 'YYYY-MM' -> 'Oct' */
export const monthShort = (key) => MONTHS[Number(key.slice(5, 7)) - 1];

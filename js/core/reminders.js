// Service reminders: pure logic, no DOM or storage (tested in /tests).
//
// Two independent sources, never mixed:
//   1. Service-centre recommendations: what the workshop said ("next service by
//      15-Mar-2027 or 25,000 km"). Stored as their own records, linked to the service.
//   2. GaadiKhata's generic suggestions: general intervals per vehicle type, which the
//      user can change per vehicle. They are a guide, not a manufacturer schedule.
// A reminder with both a date and a km is due when EITHER is reached.

import { isPos } from './calc.js';
import { addDays } from './dates.js';
import { odometerTimeline } from './service.js';

export const DEFAULT_INTERVALS = {
  two: { routine: { months: 6, km: 6000 }, oil: { months: 6, km: 6000 } },
  four: { routine: { months: 12, km: 15000 }, oil: { months: 12, km: 15000 } },
};

export const SOON = { days: 30, km: { two: 500, four: 1000 } };

const OIL_RE = /\b(engine|motor|synthetic|semi[- ]?synthetic|mineral)\s*oil\b|\boil\s*(change|replacement)\b/i;

/** Today's interval settings for a vehicle (user's own, else defaults). */
export function intervalSettings(vehicle) {
  const d = DEFAULT_INTERVALS[vehicle?.type] || DEFAULT_INTERVALS.four;
  const s = vehicle?.reminderSettings || {};
  const pick = (k) => ({
    enabled: s[k]?.enabled !== false,
    months: isPos(s[k]?.months) ? s[k].months : d[k].months,
    km: isPos(s[k]?.km) ? s[k].km : d[k].km,
  });
  return { routine: pick('routine'), oil: pick('oil') };
}

/** 'YYYY-MM-DD' + n months (end-of-month safe: 31-Jan + 1 month = 28/29-Feb). */
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  const p = (x) => String(x).padStart(2, '0');
  return `${target.getFullYear()}-${p(target.getMonth() + 1)}-${p(target.getDate())}`;
}

const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 86400000);

/**
 * Status of one reminder.
 * @returns { status: 'overdue' | 'due-soon' | 'upcoming' | 'unknown', daysLeft, kmLeft, by: 'date' | 'km' | null }
 */
export function evaluateDue({ dueDate, dueKm }, { today, currentKm, soonKm = 1000, soonDays = SOON.days }) {
  const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
  const kmLeft = isPos(dueKm) && isPos(currentKm) ? dueKm - currentKm : null;
  if (daysLeft === null && kmLeft === null) return { status: 'unknown', daysLeft, kmLeft, by: null };
  if ((daysLeft !== null && daysLeft <= 0) || (kmLeft !== null && kmLeft <= 0)) {
    return { status: 'overdue', daysLeft, kmLeft, by: daysLeft !== null && daysLeft <= 0 ? 'date' : 'km' };
  }
  if ((daysLeft !== null && daysLeft <= soonDays) || (kmLeft !== null && kmLeft <= soonKm)) {
    return { status: 'due-soon', daysLeft, kmLeft, by: daysLeft !== null && daysLeft <= soonDays ? 'date' : 'km' };
  }
  return { status: 'upcoming', daysLeft, kmLeft, by: null };
}

/** Latest known odometer from fuel fills and services. */
export function currentOdometer(vehicle, entries, services) {
  const t = odometerTimeline(entries, services);
  const km = t.length ? Math.max(...t.map((x) => x.km)) : null;
  return km ?? (isPos(vehicle?.initialOdometer) ? vehicle.initialOdometer : null);
}

/** The open (not completed) service-centre recommendation for a vehicle, newest first. */
export function openRecommendation(recommendations) {
  return recommendations
    .filter((r) => r.status === 'recommended' && !r.completedAt && (r.dueDate || isPos(r.dueKm)))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null;
}

/**
 * GaadiKhata's generic suggestions, counted from the last service (routine) and the
 * last service with an engine-oil line (oil). Without a service there is no base.
 */
export function genericReminders(vehicle, services, { today, currentKm }) {
  const cfg = intervalSettings(vehicle);
  const soonKm = SOON.km[vehicle?.type] || SOON.km.four;
  const sorted = [...services].sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
  const out = [];
  const make = (kind, label, base) => {
    const c = cfg[kind];
    if (!c.enabled || !base) return;
    const dueDate = addMonths(base.serviceDate, c.months);
    const dueKm = isPos(base.odometerKm) ? base.odometerKm + c.km : null;
    out.push({ kind, label, source: 'generic', baseServiceId: base.id, baseDate: base.serviceDate, baseKm: base.odometerKm ?? null, dueDate, dueKm, interval: c, ...evaluateDue({ dueDate, dueKm }, { today, currentKm, soonKm }) });
  };
  make('routine', 'Routine service', sorted[0]);
  make('oil', 'Engine oil change', sorted.find((s) => (s.items || []).some((i) => OIL_RE.test(i.description || ''))));
  return out;
}

const RANK = { overdue: 0, 'due-soon': 1, upcoming: 2, unknown: 3 };

/**
 * Everything the screens need for one vehicle.
 * `primary` is the single reminder used for dashboard alerts: the service-centre
 * recommendation when there is one (it is specific to this vehicle), otherwise the
 * most urgent generic suggestion. This avoids two alerts for the same service visit.
 */
export function vehicleReminders(vehicle, { services = [], entries = [], recommendations = [], today }) {
  const currentKm = currentOdometer(vehicle, entries, services);
  const soonKm = SOON.km[vehicle?.type] || SOON.km.four;
  const rec = openRecommendation(recommendations);
  const centre = rec ? { ...rec, source: 'centre', label: 'Recommended by service centre', ...evaluateDue(rec, { today, currentKm, soonKm }) } : null;
  const generic = genericReminders(vehicle, services, { today, currentKm });
  const primary = centre || [...generic].sort((a, b) => RANK[a.status] - RANK[b.status])[0] || null;
  return { currentKm, centre, generic, primary };
}

/** Short due text: "by 15-Mar-2027 or 25,000 km". `fmtDate` and `fmtKm` come from the screen. */
export function dueText({ dueDate, dueKm }, fmtDate, fmtKm) {
  return [dueDate ? `by ${fmtDate(dueDate)}` : '', isPos(dueKm) ? `${dueDate ? 'or ' : 'at '}${fmtKm(dueKm)}` : ''].filter(Boolean).join(' ');
}

export { addDays };

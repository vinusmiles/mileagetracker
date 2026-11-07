// Usage summary for the owner's admin page. Pure code: tested in /tests.
// Each app writes only counts about its own user; fuel, service and document records
// stay private. Sample data is never counted.

export const APP_VERSION = '2.8';

const dayMs = 864e5;

export function usageSummary({ vehicles = [], entries = [], services = [], documents = [] }) {
  const real = vehicles.filter((v) => !v.demo);
  const ids = new Set(real.map((v) => v.id));
  const fills = entries.filter((e) => ids.has(e.vehicleId) && !e.demo);
  return {
    vehicleCount: real.length,
    twoWheelers: real.filter((v) => v.type === 'two').length,
    fourWheelers: real.filter((v) => v.type === 'four').length,
    fuelCount: fills.length,
    scanCount: fills.filter((e) => e.source === 'smart').length,
    serviceCount: services.filter((s) => ids.has(s.vehicleId) && !s.demo).length,
    documentCount: documents.filter((d) => !d.vehicleId || ids.has(d.vehicleId)).length,
  };
}

export function deviceName(userAgent) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iPhone';
  return /Android/.test(userAgent) ? 'Android' : 'Computer';
}

const daysAgo = (iso, now) => (iso ? (now - Date.parse(iso)) / dayMs : Infinity);
const sum = (users, key) => users.reduce((n, u) => n + (Number.isFinite(u[key]) ? u[key] : 0), 0);

/** Totals for the top of the admin page. `now` is a time in milliseconds. */
export function adminTotals(users, now) {
  const reported = users.filter((u) => Number.isFinite(u.vehicleCount));
  const fills = sum(users, 'fuelCount');
  const scans = sum(users, 'scanCount');
  return {
    users: users.length,
    reported: reported.length,
    active7: users.filter((u) => daysAgo(u.updatedAt, now) <= 7).length,
    active30: users.filter((u) => daysAgo(u.updatedAt, now) <= 30).length,
    new7: users.filter((u) => daysAgo(u.createdAt, now) <= 7).length,
    vehicles: sum(users, 'vehicleCount'),
    twoWheelers: sum(users, 'twoWheelers'),
    fourWheelers: sum(users, 'fourWheelers'),
    fills,
    scans,
    scanShare: fills ? Math.round((scans / fills) * 100) : 0,
    services: sum(users, 'serviceCount'),
    documents: sum(users, 'documentCount'),
    noVehicle: reported.filter((u) => u.vehicleCount === 0).length,
    installed: users.filter((u) => u.installed === true).length,
  };
}

/** Most recently opened first. */
export const sortUsers = (users) => [...users].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

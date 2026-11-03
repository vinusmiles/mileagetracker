// Pieces used by more than one screen.

import { esc, fmt } from '../ui.js';
import { barChart, shortMoney } from '../charts.js';
import { monthlyTotals, analyseVehicle } from '../core/calc.js';
import { lastMonths } from '../core/dates.js';
import { VEHICLE_TYPES, FUEL_TYPES, fuelUnit } from '../core/model.js';

export const typeLabel = (v) => VEHICLE_TYPES[v.type]?.label || '';
export const fuelLabel = (v) => FUEL_TYPES[v.fuelType]?.label || '';

export function vehicleSubtitle(v) {
  return [typeLabel(v), fuelLabel(v), v.registration].filter(Boolean).map(esc).join(', ');
}

export const sampleTag = (v) => (v?.demo ? '<span class="tag tag-sample">Sample</span>' : '');

/** Analyse every vehicle once. Returns Map vehicleId -> analysis. */
export function analyseAll(vehicles, entries) {
  const map = new Map();
  for (const v of vehicles) map.set(v.id, analyseVehicle(entries.filter((e) => e.vehicleId === v.id), v));
  return map;
}

export function monthlySpendChart(entries, today, months = 6) {
  const keys = lastMonths(today, months);
  const m = monthlyTotals(entries);
  const bars = keys.map((k, i) => {
    const value = m[k]?.amount || 0;
    return { label: fmt.monthShort(k), value, short: shortMoney(value), valueLabel: fmt.money(value), current: i === keys.length - 1 };
  });
  return barChart(bars, `Fuel spend for the last ${months} months`);
}

const ISSUE_TEXT = {
  'odometer-decrease': 'Odometer is lower than the previous fill. Check this reading.',
};

/**
 * One fuel entry as a list row. `row` comes from analyseVehicle().rows.
 * Recorded values are plain; values GaadiKhata calculated carry class "calc".
 */
export function entryRow(row, vehicle, { showVehicle = false } = {}) {
  const e = row.entry;
  const unit = e.unit || fuelUnit(vehicle?.fuelType);
  const calc = new Set(e.calculated || []);
  const c = (field) => (calc.has(field) ? ' class="calc"' : '');
  const iv = row.interval;

  const derived = [];
  if (row.distance !== null && row.distance !== undefined) derived.push(`<span class="calc">${fmt.kmNumber(row.distance)} km since last fill</span>`);
  if (iv?.valid) derived.push(`<span class="calc">Mileage ${fmt.mileage(iv.mileage, unit)}</span>`);

  return `
  <li class="entry${row.issue ? ' entry-has-issue' : ''}">
    <a class="entry-link" href="#/fuel/${encodeURIComponent(e.id)}/edit" aria-label="Edit fill of ${esc(fmt.date(e.date))}${showVehicle && vehicle ? `, ${esc(vehicle.nickname)}` : ''}">
      <div class="entry-head">
        <span class="entry-date">${fmt.date(e.date)}</span>
        ${showVehicle && vehicle ? `<span class="entry-vehicle">${esc(vehicle.nickname)}</span>` : ''}
        ${e.fullTank ? '<span class="tag tag-full">Full tank</span>' : '<span class="tag">Partial</span>'}
        ${e.source === 'smart' ? '<span class="tag">From photo</span>' : ''}${e.source === 'smart-demo' ? '<span class="tag tag-sample">Demo reader</span>' : ''}
      </div>
      <dl class="entry-facts">
        <div><dt>Paid</dt><dd${c('totalAmount')}>${fmt.moneyExact(e.totalAmount)}</dd></div>
        <div><dt>Fuel</dt><dd${c('quantity')}>${fmt.qty(e.quantity, unit)}</dd></div>
        <div><dt>Price</dt><dd${c('pricePerUnit')}>${e.pricePerUnit ? `${fmt.moneyExact(e.pricePerUnit)}/${esc(unit)}` : 'Not recorded'}</dd></div>
        <div><dt>Odometer</dt><dd>${fmt.km(e.odometer)}</dd></div>
      </dl>
      ${derived.length ? `<p class="entry-derived">${derived.join('')}</p>` : ''}
      ${e.station || e.location ? `<p class="entry-station">${esc([e.station, e.location].filter(Boolean).join(', '))}</p>` : ''}
      ${e.notes ? `<p class="entry-notes">${esc(e.notes)}</p>` : ''}
      ${row.issue ? `<p class="entry-issue">${ISSUE_TEXT[row.issue] || 'Check this entry.'}</p>` : ''}
    </a>
  </li>`;
}

export const calcLegend = '<p class="legend"><span class="calc">Underlined values</span> are calculated by GaadiKhata. Everything else is what you recorded.</p>';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A compact, tappable fill row: date badge · vehicle and quantity · amount and mileage.
 * `row` comes from analyseVehicle().rows.
 */
export function compactRow(row, vehicle, { showVehicle = true } = {}) {
  const e = row.entry;
  const unit = e.unit || fuelUnit(vehicle?.fuelType);
  const [, m, d] = e.date.split('-');
  const iv = row.interval;
  const title = showVehicle && vehicle ? esc(vehicle.nickname) : `${fmt.qty(e.quantity, unit)}${e.fullTank ? ' · Full tank' : ''}`;
  const sub = [
    showVehicle ? `${fmt.qty(e.quantity, unit)}${e.fullTank ? ' · Full' : ''}` : '',
    e.odometer ? fmt.km(e.odometer) : 'No odometer',
    row.distance ? `+${fmt.kmNumber(row.distance)} km` : '',
  ].filter(Boolean).join(' · ');
  return `
    <li><a class="row-link" href="#/fuel/${encodeURIComponent(e.id)}/edit" aria-label="Fill on ${esc(fmt.date(e.date))}${vehicle ? `, ${esc(vehicle.nickname)}` : ''}, ${esc(fmt.moneyExact(e.totalAmount))}">
      <span class="row-date"><b>${d}</b><span>${MON[Number(m) - 1]}</span></span>
      <span class="row-title">${title}</span>
      <span class="row-amt"><b>${fmt.money(e.totalAmount)}</b>${iv?.valid ? `<span class="chip">${fmt.mileage(iv.mileage, unit).replace(' ', '\u00a0')}</span>` : ''}</span>
      <span class="row-sub">${row.issue ? '<span class="row-flag">Check odometer · </span>' : ''}${sub}</span>
    </a></li>`;
}

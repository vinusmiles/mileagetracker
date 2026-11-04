// History: every fill, filterable by vehicle and period, with totals,
// average mileage and cost per km for the chosen range.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState } from '../ui.js';
import { todayStr, monthKey, monthRange, isValidDateStr } from '../core/dates.js';
import { totals, averageMileage, costPerKm } from '../core/calc.js';
import { fuelUnit } from '../core/model.js';
import { analyseAll, compactRow, monthlySpendChart } from './shared.js';

export async function render(main, { query, navigate }) {
  const [vehicles, entries] = await Promise.all([store.listVehicles(), store.listEntries()]);
  if (!vehicles.length || !entries.length) {
    main.innerHTML = `
      <h1 class="page-title" tabindex="-1">History</h1>
      ${emptyState({
        title: 'No fuel entries yet',
        text: 'Each fill you record shows up here with the distance and mileage worked out for you.',
        actions: vehicles.length
          ? `<a class="btn btn-primary" href="#/fuel/new">${icon('fuel')}Add fuel</a>`
          : `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>`,
      })}`;
    return;
  }

  const today = todayStr();
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const vId = byId.has(query.get('v')) ? query.get('v') : '';
  const period = ['all', 'month', 'year', 'range'].includes(query.get('period')) ? query.get('period') : 'all';
  const months = [...new Set(entries.map((e) => monthKey(e.date)))].sort().reverse();
  const years = [...new Set(entries.map((e) => e.date.slice(0, 4)))].sort().reverse();
  const month = months.includes(query.get('month')) ? query.get('month') : months[0];
  const year = years.includes(query.get('year')) ? query.get('year') : years[0];
  let from = isValidDateStr(query.get('from')) ? query.get('from') : '';
  let to = isValidDateStr(query.get('to')) ? query.get('to') : '';

  let rangeError = '';
  let rFrom = null;
  let rTo = null;
  if (period === 'month') ({ from: rFrom, to: rTo } = monthRange(month));
  if (period === 'year') { rFrom = `${year}-01-01`; rTo = `${year}-12-31`; }
  if (period === 'range') {
    if (from && to && from > to) rangeError = 'The start date is after the end date.';
    else { rFrom = from || null; rTo = to || null; }
  }
  const inPeriod = (date) => (!rFrom || date >= rFrom) && (!rTo || date <= rTo);

  const scope = vId ? [byId.get(vId)] : vehicles;
  const analyses = analyseAll(scope, entries);
  const rows = rangeError ? [] : [...analyses.values()].flatMap((a) => a.rows)
    .filter((r) => inPeriod(r.entry.date))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.odometer - a.entry.odometer);
  const scopedEntries = rows.map((r) => r.entry);
  const t = totals(scopedEntries);

  const units = new Set(scope.map((v) => fuelUnit(v.fuelType)));
  const unit = units.size === 1 ? [...units][0] : '';

  let mileageBits = '';
  if (vId) {
    const intervals = analyses.get(vId).intervals.filter((iv) => iv.valid && inPeriod(iv.endDate));
    const avg = averageMileage(intervals);
    const cpk = costPerKm(intervals);
    if (avg !== null) mileageBits += `<div><b>${fmt.mileage(avg, unit)}</b> <span>average</span></div>`;
    if (cpk !== null) mileageBits += `<div><b>${fmt.perKm(cpk)}</b></div>`;
  }

  // Group the list by month, newest first, with a subtotal per month.
  const groups = [];
  for (const r of rows) {
    const k = monthKey(r.entry.date);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  const list = groups.map((g) => `
    <section class="month-group">
      <h3 class="month-head"><span>${fmt.month(g.key, true)}</span><span>${fmt.money(totals(g.rows.map((r) => r.entry)).amount)}</span></h3>
      <ul class="rows">${g.rows.map((r) => compactRow(r, byId.get(r.entry.vehicleId), { showVehicle: !vId })).join('')}</ul>
    </section>`).join('');

  const chartEnd = rTo && rTo < today ? rTo : today;
  const chartEntries = entries.filter((e) => !vId || e.vehicleId === vId);
  const opt = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;

  const filterLabel = [vId ? byId.get(vId).nickname : 'All vehicles', { all: 'All time', month: fmt.month(month, true), year, range: 'Date range' }[period]].join(' · ');
  const filtersOpen = [...query.keys()].some((k) => k !== 'v') || query.has('open');
  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">History</h1>
    <details class="filter-box"${filtersOpen ? ' open' : ''}>
      <summary>Filter <span>${esc(filterLabel)}</span></summary>
      <form class="filters" aria-label="Filter history">
        <div class="field"><label for="f-v">Vehicle</label>
          <select id="f-v" name="v">${opt('', 'All vehicles', vId)}${vehicles.map((v) => opt(v.id, v.nickname, vId)).join('')}</select></div>
        <div class="field"><label for="f-period">Period</label>
          <select id="f-period" name="period">${opt('all', 'All time', period)}${opt('month', 'Month', period)}${opt('year', 'Year', period)}${opt('range', 'Date range', period)}</select></div>
        ${period === 'month' ? `<div class="field"><label for="f-month">Month</label><select id="f-month" name="month">${months.map((m) => opt(m, fmt.month(m, true), month)).join('')}</select></div>` : ''}
        ${period === 'year' ? `<div class="field"><label for="f-year">Year</label><select id="f-year" name="year">${years.map((y) => opt(y, y, year)).join('')}</select></div>` : ''}
        ${period === 'range' ? `
          <div class="field"><label for="f-from">From</label><input id="f-from" name="from" type="date" max="${today}" value="${esc(from)}"></div>
          <div class="field"><label for="f-to">To</label><input id="f-to" name="to" type="date" max="${today}" value="${esc(to)}"></div>` : ''}
      </form>
    </details>
    ${rangeError ? `<p class="notice notice-warn" role="alert">${icon('warn')}${rangeError}</p>` : ''}

    <div class="summary-bar">
      <div><b>${fmt.money(t.amount)}</b> <span>spent</span></div>
      ${unit ? `<div><b>${fmt.qty(t.quantity, unit)}</b></div>` : ''}
      <div><b>${t.count}</b> <span>${t.count === 1 ? 'fill' : 'fills'}</span></div>
      ${mileageBits}
    </div>

    <section class="block">
      ${rows.length ? list : '<p class="muted">No fills in this period.</p>'}
    </section>

    <section class="block">
      <div class="section-head"><h2>Monthly fuel spend</h2></div>
      ${monthlySpendChart(chartEntries, chartEnd, 12, vid ? null : vehicles)}
    </section>`;

  const form = main.querySelector('.filters');
  form.addEventListener('change', () => {
    const fd = new FormData(form);
    const q = new URLSearchParams();
    for (const [k, val] of fd.entries()) if (val) q.set(k, val);
    q.set('open', '1');
    navigate(`/history?${q}`, { replace: true, keepFocus: true });
  });
}

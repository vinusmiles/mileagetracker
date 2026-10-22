// Dashboard: an overview of all vehicles, or one vehicle's details (?v=id).

import * as store from '../store.js';
import { esc, fmt, icon, odometer, mileageHint, emptyState } from '../ui.js';
import { todayStr, monthKey, monthRange } from '../core/dates.js';
import { inRange, totals } from '../core/calc.js';
import { fuelUnit } from '../core/model.js';
import { analyseAll, monthlySpendChart, entryRow, vehicleSubtitle, sampleTag, calcLegend } from './shared.js';

const newestFirst = (a, b) => b.entry.date.localeCompare(a.entry.date)
  || (b.entry.odometer - a.entry.odometer)
  || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt));

export async function render(main, { query, refresh }) {
  const [vehicles, entries] = await Promise.all([store.listVehicles(), store.listEntries()]);

  if (!vehicles.length) {
    main.innerHTML = `
      <h1 class="page-title" tabindex="-1">Welcome to MileageMate</h1>
      ${emptyState({
        title: 'Start with your vehicle',
        text: 'Add a bike or car, then record each fuel fill. MileageMate works out your mileage and fuel spend.',
        actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>
                  <button class="btn" type="button" data-action="demo">Try with sample data</button>`,
      })}`;
    main.querySelector('[data-action="demo"]').addEventListener('click', async () => {
      await store.loadDemoData();
      refresh();
    });
    return;
  }

  const analyses = analyseAll(vehicles, entries);
  const selected = vehicles.find((v) => v.id === query.get('v'));
  if (selected) return renderVehicle(main, selected, analyses.get(selected.id), entries.filter((e) => e.vehicleId === selected.id));
  return renderOverview(main, vehicles, entries, analyses);
}

function monthStats(entries) {
  const today = todayStr();
  const { from, to } = monthRange(monthKey(today));
  return { today, month: totals(inRange(entries, from, to)) };
}

function renderOverview(main, vehicles, entries, analyses) {
  const { today, month } = monthStats(entries);
  const units = new Set(vehicles.map((v) => fuelUnit(v.fuelType)));
  const unit = units.size === 1 ? [...units][0] : '';
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  const vehicleRows = vehicles.map((v) => {
    const s = analyses.get(v.id).summary;
    const u = fuelUnit(v.fuelType);
    const reading = s.latestMileage !== null
      ? `<div class="vrow-mileage">${odometer(s.latestMileage, { unit: `km/${u}`, label: `Latest mileage ${fmt.mileage(s.latestMileage, u)}` })}<span class="vrow-cap">Latest mileage</span></div>`
      : `<p class="vrow-hint">${esc(mileageHint(s))}</p>`;
    return `
      <li class="vrow">
        <a href="#/?v=${encodeURIComponent(v.id)}" class="vrow-link">
          <span class="vrow-icon">${icon(v.type)}</span>
          <span class="vrow-name">${esc(v.nickname)} ${sampleTag(v)}</span>
          <span class="vrow-sub">${vehicleSubtitle(v)}</span>
          ${reading}
          <span class="vrow-odo">Odometer ${fmt.km(s.latestOdometer)}</span>
        </a>
      </li>`;
  }).join('');

  const recentRows = [...analyses.values()].flatMap((a) => a.rows)
    .sort(newestFirst)
    .slice(0, 5)
    .map((r) => entryRow(r, byId.get(r.entry.vehicleId), { showVehicle: true }))
    .join('');

  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Dashboard</h1>
    <section class="stats" aria-label="This month">
      <div class="stat stat-lead"><span class="stat-label">Fuel spend in ${fmt.month(monthKey(today), true)}</span><span class="stat-value">${fmt.money(month.amount)}</span></div>
      <div class="stat"><span class="stat-label">Fuel bought this month</span><span class="stat-value">${unit ? fmt.qty(month.quantity, unit) : `${month.count} fills`}</span></div>
      <div class="stat"><span class="stat-label">Vehicles</span><span class="stat-value">${vehicles.length}</span></div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Your vehicles</h2><a href="#/vehicles/new" class="link-add">${icon('plus')}Add vehicle</a></div>
      <ul class="vlist">${vehicleRows}</ul>
    </section>

    <section class="block">
      <h2>Fuel spend by month</h2>
      ${monthlySpendChart(entries, today)}
    </section>

    <section class="block">
      <div class="block-head"><h2>Recent fills</h2><a href="#/history">All history</a></div>
      ${recentRows ? `${calcLegend}<ul class="entries">${recentRows}</ul>` : `<p class="muted">No fills yet. <a href="#/fuel/new">Add your first fuel entry</a>.</p>`}
    </section>`;
}

function renderVehicle(main, v, analysis, entries) {
  const { summary: s, rows } = analysis;
  const { today, month } = monthStats(entries);
  const u = fuelUnit(v.fuelType);
  const iv = s.latestInterval;

  const hero = s.latestMileage !== null
    ? `<div class="hero-odo">
         ${odometer(s.latestMileage, { unit: `km/${u}`, size: 'odo-lg', label: `Latest mileage ${fmt.mileage(s.latestMileage, u)}` })}
         <p class="hero-cap">Latest mileage, from the full tanks on <span class="nowrap">${fmt.date(iv.startDate)}</span> and <span class="nowrap">${fmt.date(iv.endDate)}</span>: ${fmt.kmNumber(iv.distance)} km on ${fmt.qty(iv.fuel, u)}.</p>
       </div>`
    : `<div class="hero-odo hero-empty"><p>${esc(mileageHint(s))}</p></div>`;

  const recent = [...rows].reverse().slice(0, 5).map((r) => entryRow(r, v)).join('');

  main.innerHTML = `
    <a class="back" href="#/">${icon('back')}All vehicles</a>
    <h1 class="page-title" tabindex="-1">${esc(v.nickname)} ${sampleTag(v)}</h1>
    <p class="subtitle">${vehicleSubtitle(v)}${v.make || v.model ? `<br>${esc([v.make, v.model].filter(Boolean).join(' '))}` : ''}</p>

    ${hero}
    ${s.issueCount ? `<p class="notice notice-warn">${icon('warn')}${s.issueCount} odometer ${s.issueCount === 1 ? 'reading needs' : 'readings need'} checking. Mileage skips those stretches. <a href="#/history?v=${encodeURIComponent(v.id)}">Review in History</a></p>` : ''}

    <dl class="facts">
      <div><dt>Average mileage</dt><dd class="calc">${fmt.mileage(s.averageMileage, u)}</dd></div>
      <div><dt>Fuel cost per km</dt><dd class="calc">${fmt.perKm(s.costPerKm)}</dd></div>
      <div><dt>Latest odometer</dt><dd>${fmt.km(s.latestOdometer)}</dd></div>
      <div><dt>Spent this month</dt><dd>${fmt.money(month.amount)}</dd></div>
    </dl>

    <div class="actions">
      <a class="btn btn-primary" href="#/fuel/new?v=${encodeURIComponent(v.id)}">${icon('fuel')}Add fuel</a>
      <a class="btn" href="#/history?v=${encodeURIComponent(v.id)}">Full history</a>
      <a class="btn btn-quiet" href="#/vehicles/${encodeURIComponent(v.id)}/edit">Edit vehicle</a>
    </div>

    <section class="block">
      <h2>Fuel spend by month</h2>
      ${monthlySpendChart(entries, today)}
    </section>

    <section class="block">
      <h2>Recent fills</h2>
      ${recent ? `${calcLegend}<ul class="entries">${recent}</ul>` : `<p class="muted">No fills yet. <a href="#/fuel/new?v=${encodeURIComponent(v.id)}">Add the first one</a>.</p>`}
    </section>`;
}

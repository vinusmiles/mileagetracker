// Dashboard: an overview of all vehicles, or one vehicle's details (?v=id).

import * as store from '../store.js';
import { esc, fmt, icon, odometer, mileageHint, emptyState, toast } from '../ui.js';
import { todayStr, monthKey, monthRange } from '../core/dates.js';
import { inRange, totals } from '../core/calc.js';
import { fuelUnit } from '../core/model.js';
import { analyseAll, monthlySpendChart, entryRow, compactRow, vehicleSubtitle, sampleTag, calcLegend } from './shared.js';

const newestFirst = (a, b) => b.entry.date.localeCompare(a.entry.date)
  || (b.entry.odometer - a.entry.odometer)
  || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt));

export async function render(main, { query, refresh }) {
  const [vehicles, entries] = await Promise.all([store.listVehicles(), store.listEntries()]);

  if (!vehicles.length) {
    main.innerHTML = `
      <div class="logo-plate logo-plate-sm"><img src="assets/logo-full.webp" alt="GaadiKhata: fuel, maintenance, expenses and more" width="320" height="292"></div>
      <h1 class="page-title" tabindex="-1">Welcome to GaadiKhata</h1>
      ${emptyState({
        title: 'Start with your vehicle',
        text: 'Add a bike or car, then record each fuel fill. GaadiKhata works out your mileage and fuel spend.',
        actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>
                  <button class="btn" type="button" data-action="demo">Try with sample data</button>`,
      })}`;
    main.querySelector('[data-action="demo"]').addEventListener('click', async () => {
      try { await store.loadDemoData(); } catch (err) { toast(err.message, 'error'); return; }
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

  // Last month, for comparison
  const [y, m] = today.split('-').map(Number);
  const prevKey = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const prev = totals(inRange(entries, monthRange(prevKey).from, monthRange(prevKey).to));
  let delta = '';
  if (prev.amount > 0 && month.amount > 0) {
    const diff = month.amount - prev.amount;
    delta = `<span class="delta">${diff >= 0 ? '▲' : '▼'} ${fmt.money(Math.abs(diff))} vs ${fmt.month(prevKey)}</span>`;
  } else if (prev.amount > 0) {
    delta = `<span class="delta">${fmt.month(prevKey)}: ${fmt.money(prev.amount)}</span>`;
  }
  const sub = month.count
    ? `${month.count} ${month.count === 1 ? 'fill' : 'fills'}${unit ? ` · ${fmt.qty(month.quantity, unit)}` : ''}`
    : 'No fills yet this month';

  const tiles = vehicles.map((v) => {
    const s = analyses.get(v.id).summary;
    const u = fuelUnit(v.fuelType);
    const last = s.lastEntry ? `Last fill ${fmt.date(s.lastEntry.date)}` : 'No fills yet';
    const right = s.latestMileage !== null
      ? `<span class="vtile-mileage"><b>${s.latestMileage.toFixed(1)}</b><small>km/${u}</small></span>`
      : `<span class="vtile-hint">Mileage after 2 full-tank fills</span>`;
    return `
      <li class="vtile">
        <a class="vtile-link" href="#/?v=${encodeURIComponent(v.id)}" aria-label="${esc(v.nickname)} details"></a>
        <span class="vrow-icon">${icon(v.type)}</span>
        <span class="vtile-name">${esc(v.nickname)} ${sampleTag(v)}</span>
        ${right}
        <span class="vtile-meta">${last}${s.latestOdometer ? ` · ${fmt.km(s.latestOdometer)}` : ''}</span>
      </li>`;
  }).join('');

  const recent = [...analyses.values()].flatMap((a) => a.rows)
    .sort(newestFirst)
    .slice(0, 3)
    .map((r) => compactRow(r, byId.get(r.entry.vehicleId)))
    .join('');

  main.innerHTML = `
    <section class="dash-band" aria-label="This month">
      <h1 class="page-title" tabindex="-1">${fmt.month(monthKey(today), true)}</h1>
      <span class="big">${fmt.money(month.amount)}</span>
      <span class="sub">Fuel spend · ${sub}</span>
      ${delta}
    </section>

    <section class="block">
      <div class="section-head"><h2>My vehicles</h2><a href="#/vehicles/new">${icon('plus')} Add</a></div>
      <ul class="vtiles">${tiles}</ul>
    </section>

    <section class="block">
      <div class="section-head"><h2>Recent fills</h2><a href="#/history">See all</a></div>
      ${recent ? `<ul class="rows">${recent}</ul>` : `<p class="muted">No fills yet. Tap <strong>Add fuel</strong> below to add your first.</p>`}
    </section>

    <section class="block">
      <div class="section-head"><h2>Monthly fuel spend</h2></div>
      ${monthlySpendChart(entries, today)}
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

  const recent = [...rows].reverse().slice(0, 5).map((r) => compactRow(r, v, { showVehicle: false })).join('');

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
      <a class="btn btn-primary" href="#/history?v=${encodeURIComponent(v.id)}">Fuel &amp; mileage history</a>
      <a class="btn" href="#/maintenance?v=${encodeURIComponent(v.id)}">${icon('wrench')}Service history</a>
      <a class="btn btn-quiet" href="#/vehicles/${encodeURIComponent(v.id)}/edit">Edit vehicle</a>
    </div>

    <section class="block">
      <h2>Fuel spend by month</h2>
      ${monthlySpendChart(entries, today)}
    </section>

    <section class="block">
      <div class="section-head"><h2>Recent fills</h2><a href="#/history?v=${encodeURIComponent(v.id)}">See all</a></div>
      ${recent ? `<ul class="rows">${recent}</ul>` : `<p class="muted">No fills yet. Tap <strong>Add fuel</strong> below to add the first.</p>`}
    </section>`;
}

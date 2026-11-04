// Dashboard: an overview of all vehicles, or one vehicle's details (?v=id).

import * as store from '../store.js';
import { esc, fmt, icon, odometer, mileageHint, emptyState, toast } from '../ui.js';
import { todayStr, monthKey, monthRange } from '../core/dates.js';
import { inRange, totals } from '../core/calc.js';
import { fuelUnit } from '../core/model.js';
import { analyseAll, monthlySpendChart, entryRow, compactRow, vehicleSubtitle, sampleTag, calcLegend, remindersHTML, dueLine } from './shared.js';
import { vehicleReminders } from '../core/reminders.js';
import { challanTotals } from '../core/challans.js';
import { challansSection, bindChallansSection } from './challans.js';

const newestFirst = (a, b) => b.entry.date.localeCompare(a.entry.date)
  || (b.entry.odometer - a.entry.odometer)
  || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt));

export async function render(main, { query, refresh }) {
  const [vehicles, entries, services, recommendations, challanList] = await Promise.all([store.listVehicles(), store.listEntries(), store.listServices(), store.listRecommendations(), store.listChallans()]);
  const reminders = new Map(vehicles.map((v) => [v.id, vehicleReminders(v, { services: services.filter((s) => s.vehicleId === v.id), entries: entries.filter((e) => e.vehicleId === v.id), recommendations: recommendations.filter((r) => r.vehicleId === v.id), today: todayStr() })]));

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
  if (selected) return renderVehicle(main, selected, analyses.get(selected.id), entries.filter((e) => e.vehicleId === selected.id), reminders.get(selected.id), challanList.filter((c) => c.vehicleId === selected.id));
  return renderOverview(main, vehicles, entries, analyses, reminders, challanList);
}

function monthStats(entries) {
  const today = todayStr();
  const { from, to } = monthRange(monthKey(today));
  return { today, month: totals(inRange(entries, from, to)) };
}

function renderOverview(main, vehicles, entries, analyses, reminders, challanList = []) {
  const { today, month } = monthStats(entries);
  const units = new Set(vehicles.map((v) => fuelUnit(v.fuelType)));
  const unit = units.size === 1 ? [...units][0] : '';
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  // Last month, for comparison
  const [y, m] = today.split('-').map(Number);
  const prevKey = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const prev = totals(inRange(entries, monthRange(prevKey).from, monthRange(prevKey).to));
  // Last month's full total as a plain reference (no up/down arrow: this month is
  // still running, so comparing it with a full month would mislead).
  const delta = prev.amount > 0 ? `<span class="delta">${fmt.month(prevKey)}: ${fmt.money(prev.amount)}</span>` : '';
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
      <span class="more" aria-hidden="true">Trend ›</span>
      <button type="button" class="band-link" data-scroll="spend-chart" aria-label="See monthly fuel spend chart"></button>
    </section>

    ${alertsHTML(vehicles, reminders, challanList)}
    <section class="block">
      <div class="section-head"><h2>My vehicles</h2><a href="#/vehicles/new">${icon('plus')} Add</a></div>
      <ul class="vtiles">${tiles}</ul>
    </section>

    <section class="block">
      <div class="section-head"><h2>Recent fills</h2><a href="#/history">See all</a></div>
      ${recent ? `<ul class="rows">${recent}</ul>` : `<p class="muted">No fills yet. Tap <strong>Add fuel</strong> below to add your first.</p>`}
    </section>

    <section class="block" id="spend-chart" tabindex="-1">
      <div class="section-head"><h2>Monthly fuel spend</h2></div>
      ${monthlySpendChart(entries, today, 6, vehicles)}
    </section>`;

  main.querySelector('[data-scroll]').addEventListener('click', () => {
    const chart = main.querySelector('#spend-chart');
    chart.scrollIntoView({ behavior: 'smooth', block: 'center' });
    chart.focus({ preventScroll: true });
  });
}

function renderVehicle(main, v, analysis, entries, rem, vChallans = []) {
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
      <div class="section-head"><h2>Upcoming service</h2><a href="#/maintenance?v=${encodeURIComponent(v.id)}">Service history</a></div>
      ${remindersHTML(v, rem)}
    </section>

    ${challansSection(v, vChallans)}

    <section class="block">
      <h2>Fuel spend by month</h2>
      ${monthlySpendChart(entries, today)}
    </section>

    <section class="block">
      <div class="section-head"><h2>Recent fills</h2><a href="#/history?v=${encodeURIComponent(v.id)}">See all</a></div>
      ${recent ? `<ul class="rows">${recent}</ul>` : `<p class="muted">No fills yet. Tap <strong>Add fuel</strong> below to add the first.</p>`}
    </section>`;
  bindChallansSection(main);
}

/** One alert per vehicle, only when its main reminder is due soon or overdue (no duplicates). */
function alertsHTML(vehicles, reminders, challanList = []) {
  const unpaid = vehicles.map((v) => ({ v, t: challanTotals(challanList.filter((c) => c.vehicleId === v.id)) })).filter(({ t }) => t.unpaidCount)
    .map(({ v, t }) => `
      <li><a class="al-overdue" href="#/?v=${encodeURIComponent(v.id)}">${icon('warn')}
        <span><strong>${esc(v.nickname)}: ${t.unpaidCount} unpaid ${t.unpaidCount === 1 ? 'challan' : 'challans'}</strong>
        <small>${fmt.money(t.unpaidAmount)} to pay</small></span></a></li>`);
  const items = vehicles.map((v) => ({ v, p: reminders.get(v.id)?.primary }))
    .filter(({ p }) => p && (p.status === 'overdue' || p.status === 'due-soon'))
    .map(({ v, p }) => `
      <li><a class="${p.status === 'overdue' ? 'al-overdue' : ''}" href="#/?v=${encodeURIComponent(v.id)}">${icon('wrench')}
        <span><strong>${esc(v.nickname)}: service ${p.status === 'overdue' ? 'overdue' : 'due soon'}</strong>
        <small>${esc(p.source === 'centre' ? 'Service centre: ' : 'Suggested: ')}${esc(dueLine(p))}</small></span></a></li>`);
  const all = [...unpaid, ...items];
  return all.length ? `<ul class="alerts" aria-label="Reminders">${all.join('')}</ul>` : '';
}

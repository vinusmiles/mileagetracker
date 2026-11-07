// "More" tab and the all-vehicle hubs it links to: Reminders and Challans.

import * as store from '../store.js';
import { esc, fmt, icon, ricon, emptyState } from '../ui.js';
import { vehicleReminders } from '../core/reminders.js';
import { challanTotals, portalsFor } from '../core/challans.js';
import { todayStr } from '../core/dates.js';
import { statusChip, dueLine } from './shared.js';
import { isInstalled, bindInstall } from '../install.js';
import { docLabel, expiryAlerts, expiryStatus, expiryText } from '../core/documents.js';

const enc = encodeURIComponent;

const menuItem = (href, name, tone, title, sub, extra = '') => `
  <li><a class="menu-item" href="${href}"${extra}>
    <span class="menu-icon tone-${tone}">${ricon(name, tone)}</span>
    <span class="menu-text"><strong>${title}</strong><small>${sub}</small></span>
    <span class="menu-chev" aria-hidden="true">›</span>
  </a></li>`;

export async function renderMore(main) {
  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">More</h1>
    <ul class="menu">
      ${menuItem('#/reminders', 'reminders', 'teal', 'Reminders', 'Upcoming services and oil changes')}
      ${menuItem('#/challans', 'challan', 'red', 'Challans', 'Check online and track fines')}
      ${menuItem('#/documents', 'document', 'blue', 'Documents', 'RC, insurance, pollution, licence')}
      ${menuItem('#/vehicles', 'car', 'green', 'My vehicles', 'Add or edit bikes and cars')}
    </ul>
    <ul class="menu">
      ${isInstalled() ? '' : `<li data-install-item><button type="button" class="menu-item" data-install>
        <span class="menu-icon tone-green"><img src="assets/icons/icon-192.png" alt="" width="34" height="34"></span>
        <span class="menu-text"><strong>Install GaadiKhata</strong><small>Add the app to your home screen</small></span>
        <span class="menu-chev" aria-hidden="true">›</span></button></li>`}
      ${menuItem('#/settings', 'settings', 'slate', 'Settings', 'Account, data, sample data')}
      ${menuItem('https://www.instagram.com/gaadikhata/', 'contact', 'pink', 'Contact us', 'Message @gaadikhata on Instagram', ' target="_blank" rel="noopener"')}
    </ul>
    <p class="muted center small">GaadiKhata · © 2026</p>`;
  bindInstall(main);
}

export async function renderReminders(main) {
  const [vehicles, entries, services, recs, challans, docs] = await Promise.all([store.listVehicles(), store.listEntries(), store.listServices(), store.listRecommendations(), store.listChallans(), store.listDocuments()]);
  if (!vehicles.length) { main.innerHTML = `<h1 class="page-title" tabindex="-1">Reminders</h1>${emptyState({ title: 'No vehicles yet', text: 'Add a vehicle to get service reminders.', actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>` })}`; return; }
  const today = todayStr();
  const now = [];
  const later = [];
  for (const v of vehicles) {
    const r = vehicleReminders(v, { services: services.filter((s) => s.vehicleId === v.id), entries: entries.filter((e) => e.vehicleId === v.id), recommendations: recs.filter((x) => x.vehicleId === v.id), today });
    const items = [...(r.centre ? [{ ...r.centre, label: 'Next service (service centre)' }] : []), ...r.generic.map((g) => ({ ...g, label: `${g.label} (suggested)` }))];
    for (const it of items) (it.status === 'overdue' || it.status === 'due-soon' ? now : later).push({ v, it });
    const t = challanTotals(challans.filter((c) => c.vehicleId === v.id));
    if (t.unpaidCount) now.push({ v, challan: t });
  }
  const nameOf = (d) => (d.vehicleId ? vehicles.find((v) => v.id === d.vehicleId)?.nickname : '') || 'Me';
  now.push(...expiryAlerts(docs, today).map((d) => ({ doc: d, who: nameOf(d) })));
  later.push(...docs.filter((d) => expiryStatus(d, today) === 'ok').map((d) => ({ doc: d, who: nameOf(d) })));
  const docRow = ({ doc, who }) => `<li><a class="remind-row" href="#/document/${enc(doc.id)}">${ricon('document', 'blue')}<span><strong>${esc(who)}: ${esc(expiryText(doc, today) || docLabel(doc))}</strong><small>Valid till ${esc(fmt.date(doc.expiryDate))}</small></span>${{ expired: '<span class="st st-overdue">Expired</span>', soon: '<span class="st st-soon">Expiring soon</span>' }[expiryStatus(doc, today)] || statusChip('upcoming')}</a></li>`;
  const row = ({ v, it, challan, doc, who }) => doc ? docRow({ doc, who }) : challan
    ? `<li><a class="remind-row" href="#/?v=${enc(v.id)}">${ricon('challan', 'red')}<span><strong>${esc(v.nickname)}: ${challan.unpaidCount} unpaid ${challan.unpaidCount === 1 ? 'challan' : 'challans'}</strong><small>${fmt.money(challan.unpaidAmount)} to pay</small></span><span class="st st-overdue">Pay</span></a></li>`
    : `<li><a class="remind-row" href="${it.source === 'centre' ? `#/recommendation/${enc(it.id)}/edit` : `#/maintenance?v=${enc(v.id)}`}">${ricon(it.kind === 'oil' ? 'fuel' : 'service', it.source === 'centre' ? 'purple' : 'teal')}<span><strong>${esc(v.nickname)}: ${esc(it.label)}</strong><small>${esc(dueLine(it))}</small></span>${statusChip(it.status)}</a></li>`;
  main.innerHTML = `
    <a class="back" href="#/more">${icon('back')}More</a>
    <h1 class="page-title" tabindex="-1">Reminders</h1>
    <section class="block"><h2>Needs attention</h2>
      ${now.length ? `<ul class="remind-list">${now.map(row).join('')}</ul>` : '<p class="muted">All good. Nothing is due in the next month.</p>'}
    </section>
    <section class="block"><h2>Later</h2>
      ${later.length ? `<ul class="remind-list">${later.map(row).join('')}</ul>` : '<p class="muted">Add a service record to start reminders.</p>'}
    </section>
    <p class="hint">Service-centre reminders come from your invoices. Suggested ones are GaadiKhata's general guide; change them in Edit vehicle.</p>`;
}

export async function renderChallans(main) {
  const [vehicles, challans] = await Promise.all([store.listVehicles(), store.listChallans()]);
  if (!vehicles.length) { main.innerHTML = `<h1 class="page-title" tabindex="-1">Challans</h1>${emptyState({ title: 'No vehicles yet', text: 'Add a vehicle first.', actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>` })}`; return; }
  const t = challanTotals(challans);
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const rows = challans.map((c) => `
    <li><a class="row-link" href="#/challan/${enc(c.id)}/edit">
      <span class="row-date"><b>${c.date.slice(8, 10)}</b><span>${fmt.monthShort(c.date.slice(0, 7))}</span></span>
      <span class="row-title">${esc(c.offence || 'Traffic challan')}</span>
      <span class="row-amt"><b>${fmt.money(c.amount)}</b><span class="st ${c.status === 'paid' ? 'st-ok' : 'st-overdue'}">${c.status === 'paid' ? 'Paid' : 'Unpaid'}</span></span>
      <span class="row-sub">${esc(byId.get(c.vehicleId)?.nickname || '')}${c.location ? ` · ${esc(c.location)}` : ''}</span>
    </a></li>`).join('');
  main.innerHTML = `
    <a class="back" href="#/more">${icon('back')}More</a>
    <h1 class="page-title" tabindex="-1">Challans</h1>
    <div class="summary-bar">
      ${t.unpaidCount ? `<div><b class="txt-red">${fmt.money(t.unpaidAmount)}</b> <span>unpaid (${t.unpaidCount})</span></div>` : '<div><b>Nothing unpaid</b></div>'}
      ${t.paidCount ? `<div><b>${fmt.money(t.paidAmount)}</b> <span>paid</span></div>` : ''}
    </div>
    <section class="block"><h2>Check online</h2>
      <ul class="menu">${vehicles.map((v) => `<li><a class="menu-item" href="${portalsFor(v.registration)[0].url}" target="_blank" rel="noopener" data-copy-open="${esc(v.registration || '')}">
        <span class="menu-icon tone-${v.type === 'two' ? 'teal' : 'green'}">${ricon(v.type === 'two' ? 'bike' : 'car', v.type === 'two' ? 'teal' : 'green')}</span>
        <span class="menu-text"><strong>${esc(v.nickname)}</strong><small>${esc(v.registration || 'Add the number in Edit vehicle')} · ${esc(portalsFor(v.registration)[0].name)}</small></span>
        <span class="menu-chev" aria-hidden="true">↗</span></a></li>`).join('')}</ul>
    </section>
    <section class="block"><div class="section-head"><h2>Your challans</h2><a href="#/challan/new?v=${enc(vehicles[0].id)}">${icon('plus')} Add</a></div>
      ${challans.length ? `<ul class="rows">${rows}</ul>` : '<p class="muted">No challans recorded. Good driving!</p>'}
    </section>`;
}


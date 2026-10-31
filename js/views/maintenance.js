// Vehicle maintenance: service history, invoice scanning (several pages = one
// invoice), review/edit form, and record details. Service records never take part
// in fuel mileage calculations; their odometer readings only join the timeline.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState, field, choices, showFieldErrors, busy, toast, confirmDialog } from '../ui.js';
import { SERVICE_TYPES, ITEM_KINDS, SUMMARY_FIELDS, itemTotals, reconcile, serviceCost, findServiceDuplicates, odometerTimeline, checkServiceOdometer, cleanItems } from '../core/service.js';
import { toNum } from '../core/calc.js';
import { todayStr, isValidDateStr } from '../core/dates.js';
import { INVOICE_CONFIG } from '../smart/config.js';
import { preparePhoto, release, blobToDataUrl, ImageError } from '../smart/images.js';
import { extractInvoice, invoiceReaderIsDemo } from '../smart/invoice-extractor.js';
import { typeLabel, sampleTag } from './shared.js';

const enc = encodeURIComponent;
const typeName = (t) => SERVICE_TYPES[t] || SERVICE_TYPES.other;
const vehicleLine = (v) => [v.make && v.model ? `${v.make} ${v.model}` : v.make || v.model, v.registration].filter(Boolean).map(esc).join(', ');

async function pickVehicle(vehicles, query) {
  const asked = vehicles.find((v) => v.id === query.get('v'));
  const pref = vehicles.find((v) => v.id === store.getPref('lastVehicle'));
  return asked || pref || vehicles[0];
}

function noVehicles(main, title) {
  main.innerHTML = `<h1 class="page-title" tabindex="-1">${title}</h1>
    ${emptyState({ title: 'Add a vehicle first', text: 'Service records belong to a vehicle.', actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>` })}`;
}

// ---------------------------------------------------------------------------
// Service history (#/maintenance?v=id&year=&type=&centre=)
// ---------------------------------------------------------------------------

export async function renderHistory(main, { query, navigate }) {
  const vehicles = await store.listVehicles();
  if (!vehicles.length) return noVehicles(main, 'Maintenance');
  const v = await pickVehicle(vehicles, query);
  const all = await store.listServices(v.id);
  const years = [...new Set(all.map((r) => r.serviceDate.slice(0, 4)))].sort().reverse();
  const centres = [...new Set(all.map((r) => r.serviceCentre).filter(Boolean))].sort();
  const f = { year: query.get('year') || '', type: query.get('type') || '', centre: query.get('centre') || '' };
  const list = all.filter((r) => (!f.year || r.serviceDate.startsWith(f.year)) && (!f.type || r.serviceType === f.type) && (!f.centre || r.serviceCentre === f.centre));
  const total = list.reduce((s, r) => s + serviceCost(r), 0);
  const opt = (val, label, cur) => `<option value="${esc(val)}"${val === cur ? ' selected' : ''}>${esc(label)}</option>`;

  const cards = list.map((r) => {
    const t = itemTotals(r.items);
    const desc = (r.items || []).slice(0, 3).map((i) => i.description).filter(Boolean).join(', ');
    return `
      <li class="svc">
        <a class="svc-link" href="#/service/${enc(r.id)}">
          <div class="svc-head"><span class="svc-date">${fmt.date(r.serviceDate)}</span><span class="tag">${esc(typeName(r.serviceType))}</span>${r.source === 'smart' ? '<span class="tag">From invoice</span>' : ''}${r.source === 'smart-demo' ? '<span class="tag tag-sample">Demo reader</span>' : ''}</div>
          <div class="svc-amount">${fmt.moneyExact(serviceCost(r))}</div>
          <p class="svc-meta">${[r.serviceCentre && esc(r.serviceCentre), r.odometerKm ? fmt.km(r.odometerKm) : 'Odometer not recorded', `${t.partsCount} ${t.partsCount === 1 ? 'part' : 'parts'} replaced`].filter(Boolean).join(' · ')}</p>
          ${desc ? `<p class="svc-desc">${esc(desc)}${t.count > 3 ? ` and ${t.count - 3} more` : ''}</p>` : ''}
        </a>
      </li>`;
  }).join('');

  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Maintenance</h1>
    ${vehicles.length > 1 ? `<div class="chip-row" role="group" aria-label="Vehicle">${vehicles.map((x) => `<a class="chip${x.id === v.id ? ' chip-on' : ''}" href="#/maintenance?v=${enc(x.id)}"${x.id === v.id ? ' aria-current="true"' : ''}>${esc(x.nickname)}</a>`).join('')}</div>` : ''}
    <h2 class="svc-title">${esc(v.nickname)}: service history ${sampleTag(v)}</h2>
    <p class="subtitle">${[typeLabel(v), vehicleLine(v)].filter(Boolean).join(', ')}</p>
    <div class="actions">
      <a class="btn btn-primary" href="#/service/scan?v=${enc(v.id)}">${icon('camera')}Scan service invoice</a>
      <a class="btn" href="#/service/new?v=${enc(v.id)}">${icon('plus')}Add manually</a>
    </div>
    ${all.length ? `
      <form class="filters" aria-label="Filter services">
        <div class="field"><label for="f-year">Year</label><select id="f-year" name="year">${opt('', 'All years', f.year)}${years.map((y) => opt(y, y, f.year)).join('')}</select></div>
        <div class="field"><label for="f-type">Service type</label><select id="f-type" name="type">${opt('', 'All types', f.type)}${Object.entries(SERVICE_TYPES).map(([k, l]) => opt(k, l, f.type)).join('')}</select></div>
        ${centres.length > 1 ? `<div class="field"><label for="f-centre">Service centre</label><select id="f-centre" name="centre">${opt('', 'All centres', f.centre)}${centres.map((c) => opt(c, c, f.centre)).join('')}</select></div>` : ''}
      </form>
      <p class="muted">${list.length} ${list.length === 1 ? 'service' : 'services'}, ${fmt.money(total)} in total.</p>
      ${list.length ? `<ul class="svc-list">${cards}</ul>` : '<p class="muted">No services match these filters.</p>'}`
    : emptyState({ title: 'No service records yet', text: 'Scan a service invoice (all its pages together) or add a service manually. Records stay separate from fuel and mileage.' })}`;

  main.querySelector('.filters')?.addEventListener('change', (ev) => {
    const q = new URLSearchParams({ v: v.id });
    for (const [k, val] of new FormData(ev.currentTarget).entries()) if (val) q.set(k, val);
    navigate(`/maintenance?${q}`, { replace: true, keepFocus: true });
  });
}

// ---------------------------------------------------------------------------
// Service details (#/service/:id)
// ---------------------------------------------------------------------------

function itemsTable(items) {
  if (!items.length) return '';
  return `<ul class="item-list">${items.map((i) => `
    <li><span class="item-desc">${esc(i.description || 'Item')}${i.code ? `<small>${esc(i.code)}</small>` : ''}${i.qty ? `<small>${esc(i.qty)} ${esc(i.unit || '')}${i.rate ? ` × ${fmt.moneyExact(i.rate)}` : ''}</small>` : ''}</span>
    <span class="item-amt">${fmt.moneyExact(i.total)}</span></li>`).join('')}</ul>`;
}

export async function renderDetail(main, { params, navigate }) {
  const r = await store.getService(params[0]);
  if (!r) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Service not found</h1><p><a href="#/maintenance">Back to Maintenance</a></p>'; return; }
  const v = await store.getVehicle(r.vehicleId);
  const items = r.items || [];
  const parts = items.filter((i) => i.kind === 'part' && i.section !== 'optional');
  const labour = items.filter((i) => i.kind !== 'part' && i.section !== 'optional');
  const optional = items.filter((i) => i.section === 'optional');
  const s = r.financialSummary || {};
  const summaryRows = Object.entries(SUMMARY_FIELDS).filter(([k]) => typeof s[k] === 'number').map(([k, l]) => `<div${k === 'grandTotal' ? ' class="sum-total"' : ''}><dt>${l}</dt><dd>${fmt.moneyExact(s[k])}</dd></div>`).join('');
  const checks = reconcile(r).filter((c) => c.level !== 'info');

  main.innerHTML = `
    <a class="back" href="#/maintenance?v=${enc(r.vehicleId)}">${icon('back')}Service history</a>
    <h1 class="page-title" tabindex="-1">${esc(typeName(r.serviceType))}, ${fmt.date(r.serviceDate)}</h1>
    <p class="subtitle">${esc(v?.nickname || '')}${v ? `, ${vehicleLine(v)}` : ''}</p>
    <div class="hero-odo svc-hero"><span class="stat-label">Total paid</span><span class="svc-total">${fmt.moneyExact(serviceCost(r))}</span></div>
    <dl class="facts">
      <div><dt>Odometer</dt><dd>${r.odometerKm ? fmt.km(r.odometerKm) : 'Not recorded'}</dd></div>
      <div><dt>Service centre</dt><dd>${esc(r.serviceCentre || '–')}</dd></div>
      <div><dt>Invoice no.</dt><dd>${esc(r.invoiceNumber || '–')}</dd></div>
      <div><dt>Job card</dt><dd>${esc([r.jobCardNumber, r.jobCardDate && fmt.date(r.jobCardDate)].filter(Boolean).join(', ') || '–')}</dd></div>
      <div><dt>Payment</dt><dd>${esc(r.paymentMethod || '–')}</dd></div>
      <div><dt>Location</dt><dd>${esc(r.serviceCentreLocation || '–')}</dd></div>
    </dl>
    ${checks.length ? `<section class="checks"><ul>${checks.map((c) => `<li class="check check-${c.level}">${icon(c.level === 'ok' ? 'check' : 'warn')}<span>${esc(c.message)}</span></li>`).join('')}</ul></section>` : ''}
    ${parts.length ? `<section class="block"><h2>Parts replaced (${parts.length})</h2>${itemsTable(parts)}</section>` : ''}
    ${labour.length ? `<section class="block"><h2>Labour and services</h2>${itemsTable(labour)}</section>` : ''}
    ${optional.length ? `<section class="block"><h2>Optional services</h2>${itemsTable(optional)}</section>` : ''}
    ${summaryRows ? `<section class="block"><h2>Financial breakdown</h2><dl class="sum-list">${summaryRows}</dl></section>` : ''}
    ${r.notes ? `<section class="block"><h2>Notes</h2><p>${esc(r.notes)}</p></section>` : ''}
    ${r.pageCount ? `<section class="block"><h2>Invoice pages</h2><div class="thumbs page-thumbs" data-pages><p class="muted">Loading ${r.pageCount} ${r.pageCount === 1 ? 'page' : 'pages'}…</p></div></section>` : ''}
    <div class="actions">
      <a class="btn btn-primary" href="#/service/${enc(r.id)}/edit">Edit service</a>
    </div>
    <section class="danger"><h2>Delete this service</h2><p>Removes the record${r.pageCount ? ' and its invoice pages' : ''}. It cannot be undone.</p>
      <button class="btn btn-danger" type="button" data-delete>Delete service</button></section>`;

  if (r.pageCount) {
    store.getServicePages(r).then((pages) => {
      const box = main.querySelector('[data-pages]');
      if (!box) return;
      box.innerHTML = pages.length
        ? pages.map((url, i) => `<a class="thumb thumb-page" href="${url}" target="_blank" rel="noopener" aria-label="Open page ${i + 1}"><img src="${url}" alt="Invoice page ${i + 1}"><span>${i + 1}</span></a>`).join('')
        : '<p class="muted">The pages could not be loaded.</p>';
    }).catch(() => { const box = main.querySelector('[data-pages]'); if (box) box.innerHTML = '<p class="muted">The pages could not be loaded. Check your connection.</p>'; });
  }

  main.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete this service record?', message: `${typeName(r.serviceType)} on ${fmt.date(r.serviceDate)}, ${fmt.moneyExact(serviceCost(r))}.`, confirmLabel: 'Delete service' });
    if (!ok) return;
    try { await store.deleteService(r.id); } catch (err) { toast(err.message, 'error'); return; }
    toast('Service record deleted');
    navigate(`/maintenance?v=${enc(r.vehicleId)}`);
  });
}

// ---------------------------------------------------------------------------
// Invoice scan (#/service/scan?v=id): pages → read → review
// ---------------------------------------------------------------------------

const scan = { vehicleId: null, pages: [], result: null, step: 'capture' };

function resetScan() {
  scan.pages.forEach(release);
  Object.assign(scan, { pages: [], result: null, step: 'capture' });
}

export async function renderScan(main, ctx) {
  const vehicles = await store.listVehicles();
  if (!vehicles.length) return noVehicles(main, 'Scan service invoice');
  if (ctx.query.get('v') && scan.step === 'capture') scan.vehicleId = ctx.query.get('v');
  if (!vehicles.some((v) => v.id === scan.vehicleId)) scan.vehicleId = (await pickVehicle(vehicles, ctx.query)).id;
  const vehicle = vehicles.find((v) => v.id === scan.vehicleId);
  if (scan.step === 'review' && scan.result) {
    return renderForm(main, ctx, { mode: 'review', vehicle, vehicles, record: { ...scan.result, vehicleId: vehicle.id }, pages: scan.pages });
  }
  scan.step = 'capture';
  const demo = invoiceReaderIsDemo();
  const max = INVOICE_CONFIG.maxPages;

  const pagesHTML = () => scan.pages.length
    ? `<ol class="page-list">${scan.pages.map((p, i) => `
        <li class="page-item">
          <img src="${p.url}" alt="Page ${i + 1} preview">
          <span class="page-no">Page ${i + 1}</span>
          <span class="page-tools">
            <button type="button" class="btn btn-sm" data-move="${i}" data-dir="-1" aria-label="Move page ${i + 1} up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn btn-sm" data-move="${i}" data-dir="1" aria-label="Move page ${i + 1} down"${i === scan.pages.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="btn btn-sm btn-quiet" data-remove="${i}">Remove</button>
          </span>
        </li>`).join('')}</ol>`
    : `<div class="photo-empty page-empty">${icon('receipt')}<span>No pages yet. Add every page of the invoice, in any order.</span></div>`;

  main.innerHTML = `
    <a class="back" href="#/maintenance?v=${enc(vehicle.id)}">${icon('back')}Service history</a>
    <h1 class="page-title" tabindex="-1">Scan service invoice</h1>
    <p class="lead">Add all pages of one invoice. They are read together as a single service visit; you check everything before saving.</p>
    ${demo ? `<div class="notice notice-demo" role="note">${icon('warn')}<div><p><strong>Demo reader.</strong> Invoice reading needs the photo reader (set readerUrl). Read invoice fills the review screen with made-up sample values, not values from your pages.</p></div></div>` : ''}
    <form class="form" novalidate>
      ${choices('vehicleId', 'Vehicle', vehicles.map((v) => ({ value: v.id, label: v.nickname, note: [v.make && v.model ? `${v.make} ${v.model}` : '', v.registration].filter(Boolean).join(', ') })), vehicle.id)}
      <section class="photo-slot${scan.pages.length ? ' has-photo' : ''}" aria-labelledby="pages-h">
        <h2 id="pages-h">Invoice pages <span class="muted">(${scan.pages.length} of ${max})</span></h2>
        <div data-pages>${pagesHTML()}</div>
        <div class="photo-actions">
          <label class="btn btn-sm file-btn">${icon('camera')}Take photo<input type="file" accept="image/*" capture="environment" data-add></label>
          <label class="btn btn-sm file-btn">${icon('plus')}Upload pages<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-add></label>
        </div>
        <p class="field-error" data-page-error hidden></p>
      </section>
      <p class="hint">${store.canKeepImages() ? 'Pages are shrunk, their hidden location data is removed, and a compressed copy is kept with the record in your private account.' : 'Sign in to keep invoice pages with the record; in this-device mode only the details are saved.'}</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="progress" data-progress hidden></div>
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit" data-read>${icon('scan')}Read invoice</button>
        <a class="btn btn-quiet btn-block" href="#/service/new?v=${enc(vehicle.id)}">Enter manually instead</a>
      </div>
    </form>`;

  const form = main.querySelector('form');
  const readBtn = form.querySelector('[data-read]');
  const errBox = form.querySelector('[data-page-error]');
  const repaint = () => renderScan(main, { ...ctx, query: new URLSearchParams() });
  readBtn.disabled = !scan.pages.length;

  form.querySelectorAll('[name="vehicleId"]').forEach((el) => el.addEventListener('change', () => { scan.vehicleId = el.value; }));
  form.addEventListener('change', async (ev) => {
    if (!ev.target.hasAttribute('data-add')) return;
    const files = [...(ev.target.files || [])];
    ev.target.value = '';
    errBox.hidden = true;
    const room = max - scan.pages.length;
    if (files.length > room) { errBox.textContent = `An invoice can have up to ${max} pages. Only the first ${room} were added.`; errBox.hidden = false; }
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        scan.pages.push(await preparePhoto(file, { maxEdgePx: INVOICE_CONFIG.maxEdgePx, quality: INVOICE_CONFIG.jpegQuality }));
      } catch (e) {
        errBox.textContent = e instanceof ImageError ? e.message : 'A page could not be used.';
        errBox.hidden = false;
      }
    }
    const msg = errBox.hidden ? '' : errBox.textContent;
    await repaint();
    if (msg) { const b = main.querySelector('[data-page-error]'); b.textContent = msg; b.hidden = false; }
  });
  form.addEventListener('click', (ev) => {
    const mv = ev.target.closest('[data-move]');
    const rm = ev.target.closest('[data-remove]');
    if (mv) {
      const i = Number(mv.dataset.move);
      const j = i + Number(mv.dataset.dir);
      [scan.pages[i], scan.pages[j]] = [scan.pages[j], scan.pages[i]];
      repaint();
    } else if (rm) {
      const [gone] = scan.pages.splice(Number(rm.dataset.remove), 1);
      release(gone);
      repaint();
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!scan.pages.length) return;
    const v = vehicles.find((x) => x.id === scan.vehicleId);
    const timeline = odometerTimeline(await store.listEntries(v.id), await store.listServices(v.id));
    const progress = form.querySelector('[data-progress]');
    const steps = [['prepare', 'Preparing pages'], ['send', demo ? 'Starting the demo reader' : 'Sending pages securely'], ['read', `Reading ${scan.pages.length} ${scan.pages.length === 1 ? 'page' : 'pages'} as one invoice`], ['validate', 'Checking totals'], ['ready', 'Ready for review']];
    let current = 'prepare';
    const paint = () => {
      const at = steps.findIndex(([id]) => id === current);
      progress.innerHTML = `<ol>${steps.map(([id, label], i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${i < at ? icon('check') : '<span class="dot"></span>'}${label}</li>`).join('')}</ol>`;
    };
    progress.hidden = false;
    form.querySelector('.form-error').hidden = true;
    form.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
    paint();
    try {
      const result = await extractInvoice({ pages: scan.pages, vehicle: v, latestOdometer: timeline.length ? timeline[timeline.length - 1].km : v.initialOdometer, onProgress: (id) => { current = id; paint(); } });
      current = 'validate'; paint();
      await new Promise((r) => setTimeout(r, 200));
      scan.result = { ...result, source: demo ? 'smart-demo' : 'smart' };
      scan.step = 'review';
      await renderScan(main, { ...ctx, query: new URLSearchParams() });
      window.scrollTo(0, 0);
      main.querySelector('.page-title')?.focus();
    } catch (e) {
      console.error(e);
      progress.hidden = true;
      form.querySelectorAll('input, button').forEach((el) => { el.disabled = false; });
      const msg = form.querySelector('.form-error');
      msg.innerHTML = `The invoice could not be read: ${esc((e.message || 'unknown error').replace(/\.+$/, ''))}. Your pages are still here. Tap Read invoice to try again, or <a href="#/service/new?v=${enc(v.id)}">enter the service manually</a>.`;
      msg.hidden = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Manual entry and editing (#/service/new?v=id, #/service/:id/edit)
// ---------------------------------------------------------------------------

export async function renderNew(main, ctx) {
  const vehicles = await store.listVehicles();
  if (!vehicles.length) return noVehicles(main, 'Add service');
  const vehicle = await pickVehicle(vehicles, ctx.query);
  return renderForm(main, ctx, { mode: 'manual', vehicle, vehicles, record: { vehicleId: vehicle.id, serviceDate: todayStr(), serviceType: 'general', items: [], financialSummary: {} } });
}

export async function renderEdit(main, ctx) {
  const record = await store.getService(ctx.params[0]);
  if (!record) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Service not found</h1><p><a href="#/maintenance">Back to Maintenance</a></p>'; return; }
  const vehicles = await store.listVehicles();
  const vehicle = vehicles.find((v) => v.id === record.vehicleId);
  return renderForm(main, ctx, { mode: 'edit', vehicle, vehicles, record });
}

// ---------------------------------------------------------------------------
// The shared form (manual, edit, and review after reading an invoice)
// ---------------------------------------------------------------------------

const DETAIL_LABELS = { serviceDate: 'Invoice / service date', jobCardDate: 'Job card date', invoiceNumber: 'Invoice number', jobCardNumber: 'Job card number', serviceCentre: 'Service centre', serviceCentreLocation: 'Location', paymentMethod: 'Payment method', warranty: 'Warranty status', serviceType: 'Service type', odometerKm: 'Odometer (km)' };
const ITEM_NUMS = [['qty', 'Qty'], ['rate', 'Rate (₹)']];
// Shown on the entry form. Taxes and other summary values that were read are kept with the
// record (and shown on the details page) but not edited here, to keep the form short.
const FORM_SUMMARY = ['partsTotal', 'labourTotal', 'discounts', 'adjustments', 'grandTotal'];

async function renderForm(main, ctx, { mode, vehicle, vehicles, record, pages = null }) {
  const review = mode === 'review';
  const demo = review && record.source === 'smart-demo';
  const flags = new Set(); // no 'check this value' prompts: the user simply edits anything wrong
  const confirmed = new Set();
  const items = (record.items || []).map(({ needsReview, ...i }) => ({ ...i })); // no per-line prompts
  const val = (x) => (x === null || x === undefined ? '' : esc(x));
  const entries = await store.listEntries(vehicle.id);
  const services = await store.listServices(vehicle.id);
  const timeline = odometerTimeline(entries, services);
  const latest = timeline.filter((t) => !(t.source === 'service' && t.id === record.id)).slice(-1)[0];

  const flagged = (name) => flags.has(name) && !confirmed.has(name);
  const hint = (name, base = '') => [flagged(name) ? `<span class="review-flag">${icon('warn')}Check this value</span><button type="button" class="link-btn" data-confirm="${name}">Looks right</button>` : '', base].filter(Boolean).join(' ');
  const f = (name, input, base) => {
    let html = field(name, DETAIL_LABELS[name] || name, input, hint(name, base));
    if (flagged(name)) html = html.replace(`class="field" data-field="${name}"`, `class="field needs-review" data-field="${name}"`);
    return html;
  };
  const textIn = (name, max = 120) => `<input id="${name}" name="${name}" type="text" maxlength="${max}" autocomplete="off" value="${val(record[name])}">`;
  const s = record.financialSummary || {};

  const itemRow = (it, idx) => `
    <li class="item-row" data-idx="${idx}">
      <div class="item-main">
        <label class="sr-only" for="it-d-${idx}">Description</label>
        <input id="it-d-${idx}" data-k="description" type="text" maxlength="160" placeholder="Description" value="${val(it.description)}">
        <label class="sr-only" for="it-t-${idx}">Total including tax</label>
        <input id="it-t-${idx}" data-k="total" type="text" inputmode="decimal" placeholder="₹ total" value="${val(it.total)}">
      </div>
      <div class="item-meta">
        <select data-k="kind" aria-label="Kind">${Object.entries(ITEM_KINDS).map(([k, l]) => `<option value="${k}"${it.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="link-btn" data-remove-item="${idx}">Remove</button>
      </div>
      <details class="item-more"><summary>Code, qty, rate</summary>
        <div class="item-grid">
          <label class="item-opt item-opt-wide"><input type="checkbox" data-k="optional"${it.section === 'optional' ? ' checked' : ''}> Listed under “Optional services” on the invoice</label>
          <label>HSN/SAC or part no.<input data-k="code" type="text" maxlength="40" value="${val(it.code)}"></label>
          ${ITEM_NUMS.map(([k, l]) => `<label>${l}<input data-k="${k}" type="text" inputmode="decimal" value="${val(it[k])}"></label>`).join('')}
        </div>
      </details>
    </li>`;

  const groupHTML = () => {
    const rows = items.map((it, idx) => ({ it, idx }));
    const parts = rows.filter(({ it }) => it.kind === 'part');
    const rest = rows.filter(({ it }) => it.kind !== 'part');
    const t = itemTotals(items);
    return `
      <h2 class="form-section">Parts replaced <span class="muted">(${parts.length}, ${fmt.moneyExact(t.parts)})</span></h2>
      <ul class="item-rows">${parts.map(({ it, idx }) => itemRow(it, idx)).join('')}</ul>
      <button type="button" class="btn btn-sm" data-add-item="part">${icon('plus')}Add part</button>
      <h2 class="form-section">Labour and services <span class="muted">(${rest.length}, ${fmt.moneyExact(t.labour + t.other)})</span></h2>
      <ul class="item-rows">${rest.map(({ it, idx }) => itemRow(it, idx)).join('')}</ul>
      <button type="button" class="btn btn-sm" data-add-item="labour">${icon('plus')}Add labour or service</button>`;
  };

  const thumbs = pages?.length ? `<div class="thumbs page-thumbs">${pages.map((p, i) => `<a class="thumb thumb-page" href="${p.url}" target="_blank" rel="noopener"><img src="${p.url}" alt="Invoice page ${i + 1}, opens full size"><span>${i + 1}</span></a>`).join('')}</div>` : '';
  const title = { manual: 'Add service', edit: 'Edit service', review: 'Check the invoice details' }[mode];

  main.innerHTML = `
    ${mode !== 'review' ? `<a class="back" href="${mode === 'edit' ? `#/service/${enc(record.id)}` : `#/maintenance?v=${enc(vehicle.id)}`}">${icon('back')}${mode === 'edit' ? 'Service details' : 'Service history'}</a>` : ''}
    <h1 class="page-title" tabindex="-1">${title}</h1>
    ${demo ? `<div class="notice notice-demo" role="note">${icon('warn')}<div><p><strong>Demo values.</strong> Made up by the demo reader, not read from your pages. Replace them with the real values before saving, or cancel.</p></div></div>` : ''}
    ${review ? '<p class="hint">Check the values against your invoice and change anything that is wrong. Blank means it could not be read.</p>' : ''}
    <section class="checks" data-checks aria-live="polite"></section>
    <form class="form svc-form" novalidate>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      <h2 class="form-section">Vehicle</h2>
      ${mode === 'manual' && vehicles.length > 1
        ? choices('vehicleId', 'Vehicle', vehicles.map((v) => ({ value: v.id, label: v.nickname })), vehicle.id)
        : `<p><strong>${esc(vehicle.nickname)}</strong><br><span class="muted">${[typeLabel(vehicle), vehicleLine(vehicle)].filter(Boolean).join(', ')}</span></p>`}
      ${review && (record.vehicleModel || record.registration) ? `<p class="hint">Invoice says: ${esc([record.vehicleMake, record.vehicleModel, record.registration].filter(Boolean).join(' '))}${record.vinLast4 ? `, chassis …${esc(record.vinLast4)}` : ''}</p>` : ''}

      <h2 class="form-section">Service details</h2>
      <div class="grid-2">
        ${f('serviceDate', `<input id="serviceDate" name="serviceDate" type="date" max="${todayStr()}" value="${val(record.serviceDate)}">`, review ? 'The invoice date, not the job card date.' : '')}
        ${f('serviceType', `<select id="serviceType" name="serviceType">${Object.entries(SERVICE_TYPES).map(([k, l]) => `<option value="${k}"${(record.serviceType || 'other') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${f('serviceCentre', textIn('serviceCentre'))}
        ${f('serviceCentreLocation', textIn('serviceCentreLocation'))}
      </div>

      <h2 class="form-section">Odometer</h2>
      ${f('odometerKm', `<input id="odometerKm" name="odometerKm" type="text" inputmode="numeric" autocomplete="off" value="${val(record.odometerKm)}">`, latest ? `Latest known: ${fmt.km(latest.km)} on ${fmt.date(latest.date)} (${latest.source === 'fuel' ? 'fuel fill' : 'service'}). Optional.` : 'Optional.')}

      <div data-items>${groupHTML()}</div>

      <h2 class="form-section">Financial breakdown</h2>
      <div class="grid-2">
        ${FORM_SUMMARY.map((k) => [k, SUMMARY_FIELDS[k]]).map(([k, l]) => {
          const name = `summary.${k}`;
          let html = field(`sum-${k}`, `${l}${k === 'grandTotal' ? '' : ' (optional)'}`, `<input id="sum-${k}" name="sum-${k}" type="text" inputmode="decimal" autocomplete="off" value="${val(s[k])}">`, hint(name));
          if (flagged(name)) html = html.replace(`class="field" data-field="sum-${k}"`, `class="field needs-review" data-field="sum-${k}"`);
          return html;
        }).join('')}
      </div>
      ${field('notes', 'Notes', `<textarea id="notes" name="notes" rows="2" maxlength="500">${val(record.notes)}</textarea>`)}

      ${thumbs ? `<h2 class="form-section">Invoice pages</h2>${thumbs}<p class="hint">${store.canKeepImages() ? 'These pages will be kept with the record in your private account.' : 'Pages are not kept in this-device mode.'}</p>` : ''}

      <div class="notice notice-warn" data-warnings role="alert" hidden></div>
      <div class="form-actions form-actions-stack">
        <button class="btn btn-primary btn-block" type="submit" data-save>${icon('check')}${review ? 'Confirm and save' : 'Save service'}</button>
        ${review ? `<div class="split">
          <button class="btn" type="button" data-retake>${icon('camera')}Replace images</button>
          <button class="btn" type="button" data-retry>${icon('scan')}Retry extraction</button>
          <button class="btn btn-quiet" type="button" data-cancel>Cancel</button></div>` : ''}
      </div>
    </form>`;

  const form = main.querySelector('form');
  const checksBox = main.querySelector('[data-checks]');
  const warnBox = form.querySelector('[data-warnings]');
  const saveBtn = form.querySelector('[data-save]');
  const saveLabel = saveBtn.innerHTML;
  let accepted = false;
  let currentVehicle = vehicle;

  const n = (name) => toNum(form.elements[name]?.value);
  const collect = () => {
    const fd = new FormData(form);
    const str = (k) => (fd.get(k) || '').toString().trim();
    const summary = {};
    for (const k of Object.keys(SUMMARY_FIELDS)) summary[k] = FORM_SUMMARY.includes(k) ? n(`sum-${k}`) : (record.financialSummary?.[k] ?? null);
    return {
      id: record.id, vehicleId: fd.get('vehicleId') || currentVehicle.id,
      serviceDate: str('serviceDate'), serviceType: str('serviceType'), serviceCentre: str('serviceCentre'), serviceCentreLocation: str('serviceCentreLocation'),
      // Not on the form, but kept when read from the invoice (used to spot duplicate uploads).
      invoiceNumber: record.invoiceNumber || null, paymentMethod: record.paymentMethod || null, jobCardNumber: record.jobCardNumber || null, jobCardDate: record.jobCardDate || null,
      warranty: record.warranty || null, vinLast4: record.vinLast4 || null,
      odometerKm: n('odometerKm'), notes: str('notes'),
      items: items.map(({ needsReview, confirmed: c, ...rest }) => rest), financialSummary: summary,
      source: record.source || 'manual', extractionMetadata: record.extractionMetadata || null,
    };
  };

  const paintChecks = () => {
    const d = collect();
    const list = reconcile({ ...d, items: cleanItems(d.items) });
    for (const w of checkServiceOdometer(d, timeline)) {
      list.push({ level: 'warn', message: w.code === 'lower-than-before'
        ? `The odometer is lower than an earlier reading (${fmt.km(w.reading.km)} on ${fmt.date(w.reading.date)}, ${w.reading.source === 'fuel' ? 'fuel fill' : 'service'}).`
        : `The odometer is higher than a later reading (${fmt.km(w.reading.km)} on ${fmt.date(w.reading.date)}).` });
    }
    if (!d.odometerKm) list.push({ level: 'info', message: 'No odometer reading. Add it if the invoice shows one (often “Kms”).' });
    checksBox.innerHTML = list.length ? `<ul>${list.map((c) => `<li class="check check-${c.level}">${icon(c.level === 'ok' ? 'check' : c.level === 'warn' ? 'warn' : 'info')}<span>${esc(c.message)}</span></li>`).join('')}</ul>` : '';
    return list;
  };

  const repaintItems = () => { form.querySelector('[data-items]').innerHTML = groupHTML(); paintChecks(); };
  const resetWarn = () => { accepted = false; warnBox.hidden = true; saveBtn.innerHTML = saveLabel; };

  form.addEventListener('input', (ev) => {
    const row = ev.target.closest('.item-row');
    if (row && ev.target.dataset.k) {
      const it = items[Number(row.dataset.idx)];
      const k = ev.target.dataset.k;
      if (k === 'description' || k === 'code') it[k] = ev.target.value;
      else if (k !== 'kind' && k !== 'optional') it[k] = toNum(ev.target.value);
      if (it.needsReview) it.confirmed = true;
    }
    const name = ev.target.name?.startsWith('sum-') ? `summary.${ev.target.name.slice(4)}` : ev.target.name;
    if (name && flags.has(name)) {
      confirmed.add(name);
      const wrap = ev.target.closest('.field');
      wrap?.classList.remove('needs-review');
      wrap?.querySelector('.review-flag')?.remove();
      wrap?.querySelector('[data-confirm]')?.remove();
    }
    resetWarn();
    paintChecks();
  });
  form.addEventListener('change', (ev) => {
    const row = ev.target.closest('.item-row');
    if (row && (ev.target.dataset.k === 'kind' || ev.target.dataset.k === 'optional')) {
      const it = items[Number(row.dataset.idx)];
      if (ev.target.dataset.k === 'kind') it.kind = ev.target.value;
      else it.section = ev.target.checked ? 'optional' : 'maintenance';
      repaintItems();
    }
    if (ev.target.name === 'vehicleId') currentVehicle = vehicles.find((v) => v.id === ev.target.value) || vehicle;
    paintChecks();
  });
  form.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.addItem) { items.push({ description: '', kind: t.dataset.addItem, section: 'maintenance', total: null }); repaintItems(); form.querySelector(`#it-d-${items.length - 1}`)?.focus(); }
    if (t.dataset.removeItem) { items.splice(Number(t.dataset.removeItem), 1); repaintItems(); }
    if (t.dataset.confirmItem) { items[Number(t.dataset.confirmItem)].confirmed = true; repaintItems(); }
    if (t.dataset.confirm) {
      confirmed.add(t.dataset.confirm);
      const wrap = t.closest('.field');
      wrap?.classList.remove('needs-review');
      wrap?.querySelector('.review-flag')?.remove();
      t.remove();
    }
  });
  form.querySelector('[data-retake]')?.addEventListener('click', () => { scan.step = 'capture'; renderScan(main, { ...ctx, query: new URLSearchParams() }); });
  form.querySelector('[data-retry]')?.addEventListener('click', () => { scan.step = 'capture'; renderScan(main, { ...ctx, query: new URLSearchParams() }).then(() => main.querySelector('[data-read]')?.click()); });
  form.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Discard this invoice?', message: 'The pages and the details read from them will be cleared. Nothing has been saved.', confirmLabel: 'Discard' }))) return;
    resetScan();
    ctx.navigate(`/maintenance?v=${enc(vehicle.id)}`);
  });
  paintChecks();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saveBtn.disabled) return;
    const d = collect();
    d.items = cleanItems(d.items);
    const errors = {};
    if (!d.serviceDate || !isValidDateStr(d.serviceDate)) errors.serviceDate = 'Enter the service or invoice date.';
    else if (d.serviceDate > todayStr()) errors.serviceDate = 'The date cannot be in the future.';
    if (Number.isNaN(d.odometerKm) || (d.odometerKm !== null && d.odometerKm <= 0)) errors.odometerKm = 'Enter the reading in km, or leave it empty.';
    for (const k of FORM_SUMMARY) if (Number.isNaN(d.financialSummary[k])) errors[`sum-${k}`] = 'Numbers only, like 1234.50.';
    if (!(d.financialSummary.grandTotal > 0) && !(itemTotals(d.items).all > 0)) errors['sum-grandTotal'] = 'Enter the grand total paid.';
    if (d.items.some((i) => Number.isNaN(i.total))) errors._form = 'Some line totals are not numbers.';
    const pending = [...flags].filter((x) => !confirmed.has(x));
    const pendingItems = items.filter((i) => i.needsReview && !i.confirmed).length;
    if (pending.length || pendingItems) {
      for (const p of pending) errors[p.startsWith('summary.') ? `sum-${p.slice(8)}` : p] = 'Check this value, then edit it or tap Looks right.';
      errors._form = `Please check ${[...pending.map((p) => DETAIL_LABELS[p] || SUMMARY_FIELDS[p.slice(8)] || p), pendingItems ? `${pendingItems} line${pendingItems === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}.`;
    }
    if (!showFieldErrors(form, errors)) return;

    const dups = findServiceDuplicates(d, await store.listServices(d.vehicleId));
    const warns = paintChecks().filter((c) => c.level === 'warn');
    if ((dups.length || warns.length) && !accepted) {
      const lines = [];
      if (dups.length) {
        lines.push('<p><strong>This service may already be saved.</strong> Review the existing record, or save anyway.</p>');
        for (const x of dups.slice(0, 3)) lines.push(`<p>${fmt.date(x.record.serviceDate)}, ${fmt.moneyExact(serviceCost(x.record))} (${esc(x.reasons.join('; '))}). <a href="#/service/${enc(x.record.id)}">Review existing record</a></p>`);
      }
      for (const w of warns) lines.push(`<p>${esc(w.message)}</p>`);
      warnBox.innerHTML = `${icon('warn')}<div><p><strong>Check before saving</strong></p>${lines.join('')}<p>Fix the values, or tap Save anyway.</p></div>`;
      warnBox.hidden = false;
      accepted = true;
      saveBtn.textContent = 'Save anyway';
      warnBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    await busy(saveBtn, 'Saving…', async () => {
      try {
        let keep = null;
        if (pages?.length && store.canKeepImages()) keep = await Promise.all(pages.map((p) => blobToDataUrl(p.blob)));
        if (review) d.extractionMetadata = { reader: d.source === 'smart-demo' ? 'demo' : 'cloud', model: record.readerModel || null, pages: pages?.length || 0, fieldsNeedingReview: [...flags], readAt: new Date().toISOString() };
        const saved = await store.saveService(d, keep);
        store.setPref('lastVehicle', saved.vehicleId);
        if (review) resetScan();
        toast(mode === 'edit' ? 'Service updated' : 'Service saved');
        ctx.navigate(`/service/${enc(saved.id)}`);
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });
}

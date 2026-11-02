// Smart fuel entry: pick vehicle → add receipt and/or odometer photo → read →
// review every value → save. Nothing is saved without the user's confirmation.
// Photos are kept in memory for this browser tab only, so the user can retry or
// go back without re-taking them; they are released on save or cancel.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState, field, choices, showFieldErrors, busy, toast, confirmDialog, mileageHint } from '../ui.js';
import { FUEL_TYPES, LIMITS, fuelUnitName, perUnitWord } from '../core/model.js';
import { validateEntry } from '../core/validate.js';
import { toNum, sortEntries, analyseVehicle } from '../core/calc.js';
import { todayStr } from '../core/dates.js';
import { extract, providerInfo } from '../smart/extractor.js';
import { preparePhoto, release, ImageError } from '../smart/images.js';
import { reviewChecks } from '../smart/checks.js';
import { findPossibleDuplicates } from '../smart/duplicates.js';
import { vehicleSubtitle, typeLabel } from './shared.js';

// extraction field -> review form field
const FORM_NAME = {
  transactionDate: 'date', transactionTime: 'time', fuelType: 'fuelType', quantityLitres: 'quantity',
  pricePerLitre: 'pricePerUnit', totalAmount: 'totalAmount', fuelCompany: 'fuelCompany', fuelStation: 'station',
  location: 'location', receiptNumber: 'receiptNumber', odometerKm: 'odometer', dashboardRangeKm: 'dashboardRangeKm',
};
const LABELS = {
  date: 'Date', time: 'Time', fuelType: 'Fuel type', quantity: 'Fuel quantity', pricePerUnit: 'Price per unit (₹)',
  totalAmount: 'Total paid (₹)', fuelCompany: 'Fuel company', station: 'Fuel station', location: 'Location',
  receiptNumber: 'Receipt number', odometer: 'Odometer (km)', dashboardRangeKm: 'Range shown on dashboard (km)', fullTank: 'Full tank',
};
// Shown on the review screen. Time, location and receipt number may still be read
// by a provider, but they are not shown or saved.
const RECEIPT_NAMES = ['date', 'fuelType', 'quantity', 'pricePerUnit', 'totalAmount', 'fuelCompany', 'station'];
const ODO_NAMES = ['odometer', 'dashboardRangeKm'];

const session = { vehicleId: null, receipt: null, odometer: null, step: 'capture', result: null, needsReview: new Set(), confirmed: new Set(), values: null };

function resetSession() {
  release(session.receipt);
  release(session.odometer);
  Object.assign(session, { receipt: null, odometer: null, step: 'capture', result: null, needsReview: new Set(), confirmed: new Set(), values: null });
}

export async function render(main, ctx) {
  const vehicles = await store.listVehicles();
  if (!vehicles.length) {
    main.innerHTML = `
      <h1 class="page-title" tabindex="-1">Smart fuel entry</h1>
      ${emptyState({ title: 'Add a vehicle first', text: 'Fuel entries belong to a vehicle, so start by adding your bike or car.', actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>` })}`;
    return;
  }
  const asked = ctx.query.get('v');
  if (asked && vehicles.some((v) => v.id === asked) && session.step === 'capture') session.vehicleId = asked;
  if (!vehicles.some((v) => v.id === session.vehicleId)) {
    const pref = store.getPref('lastVehicle');
    session.vehicleId = vehicles.some((v) => v.id === pref) ? pref : vehicles[0].id;
  }
  if (session.step === 'review' && session.result) return renderReview(main, vehicles, ctx);
  session.step = 'capture';
  return renderCapture(main, vehicles, ctx);
}

// ---------------------------------------------------------------------------
// Step 1–4: vehicle, photos, read
// ---------------------------------------------------------------------------

function demoNotice() {
  const p = providerInfo();
  return p.isDemo
    ? `<div class="notice notice-demo" role="note">${icon('warn')}<div><p><strong>Demo reader.</strong> Photo reading is not built yet (Stage 2). After you tap Read details you will see made-up sample values, not values from your photos, so you can try the review screen.</p></div></div>`
    : '';
}

let slotFuel = 'petrol'; // fuel type of the selected vehicle, for the example photos

function slotHTML(kind) {
  const photo = session[kind];
  const isReceipt = kind === 'receipt';
  const title = isReceipt ? 'Fuel bill or pump reading' : 'Odometer';
  const help = isReceipt ? 'The printed bill, or a photo of the pump display showing amount, quantity and rate.' : 'The dashboard with the ODO reading clearly visible.';
  const examples = isReceipt
    ? (slotFuel === 'cng'
      ? [['cng-reading.webp', 'Example: CNG dispenser display (total, kg, rate per kg)']]
      : [['fuel-bill.webp', 'Example: printed fuel bill'], ['pump-reading.webp', 'Example: pump display']])
    : [['odometer.webp', 'Example: dashboard with ODO reading']];
  const preview = photo
    ? `<img src="${photo.url}" alt="${title} photo preview">`
    : `<div class="photo-examples" data-gallery>${examples.map(([f, alt]) => `<button type="button" data-view aria-label="${alt}, view larger"><img src="assets/samples/${f}" alt="${alt}" loading="lazy"></button>`).join('')}<span class="example-tag">Example${examples.length > 1 ? 's' : ''}</span></div>`;
  return `
    <section class="photo-slot${photo ? ' has-photo' : ''}" data-slot="${kind}" aria-labelledby="slot-${kind}">
      <div class="photo-text">
        <h2 id="slot-${kind}">${title}</h2>
        <p class="hint">${help}</p>
        ${photo ? `<p class="hint">Ready: ${photo.width}×${photo.height}, ${(photo.bytes / 1024).toFixed(0)} KB</p>` : ''}
      </div>
      <div class="photo-preview">${preview}</div>
      <div class="photo-actions">
        <label class="btn btn-sm file-btn">${icon('camera')}${photo ? 'Retake' : 'Take photo'}
          <input type="file" accept="image/*" capture="environment" data-pick="${kind}"></label>
        <label class="btn btn-sm file-btn">${photo ? 'Replace' : 'Upload'}
          <input type="file" accept="image/jpeg,image/png,image/webp" data-pick="${kind}"></label>
        ${photo ? `<button class="btn btn-sm btn-quiet" type="button" data-remove="${kind}">Remove</button>` : ''}
      </div>
      <p class="field-error" data-slot-error hidden></p>
    </section>`;
}

function renderCapture(main, vehicles, ctx) {
  slotFuel = vehicles.find((v) => v.id === session.vehicleId)?.fuelType || 'petrol';
  const vehicleOpts = vehicles.map((v) => ({ value: v.id, label: v.nickname, note: [typeLabel(v), v.registration].filter(Boolean).join(', ') }));
  main.innerHTML = `
    <a class="back" href="#/fuel/new?manual=1&v=${encodeURIComponent(session.vehicleId)}">${icon('back')}Manual entry</a>
    <h1 class="page-title" tabindex="-1">Smart fuel entry</h1>
    <p class="lead">Add a photo of the fuel receipt, the odometer, or both. You check every value before anything is saved.</p>
    ${demoNotice()}
    <form class="form smart-capture" novalidate>
      ${choices('vehicleId', 'Vehicle', vehicleOpts, session.vehicleId)}
      <div class="photo-slots">${slotHTML('receipt')}${slotHTML('odometer')}</div>
      <p class="hint">${esc(providerInfo().privacy)} Photos are shrunk and their hidden location data is removed when you add them.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="progress" data-progress hidden></div>
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit" data-read>${icon('scan')}Read details</button>
        <a class="btn btn-quiet btn-block" href="#/fuel/new?manual=1&v=${encodeURIComponent(session.vehicleId)}">Enter manually instead</a>
      </div>
    </form>`;

  const form = main.querySelector('form');
  const readBtn = form.querySelector('[data-read]');
  const syncRead = () => { readBtn.disabled = !(session.receipt || session.odometer); };
  syncRead();

  form.querySelectorAll('[name="vehicleId"]').forEach((el) => el.addEventListener('change', () => {
    session.vehicleId = el.value;
    slotFuel = vehicles.find((v) => v.id === el.value)?.fuelType || 'petrol';
    if (!session.receipt) form.querySelector('[data-slot="receipt"]').outerHTML = slotHTML('receipt');
  }));

  form.addEventListener('change', async (ev) => {
    const kind = ev.target.dataset.pick;
    if (!kind) return;
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const slot = form.querySelector(`[data-slot="${kind}"]`);
    const err = slot.querySelector('[data-slot-error]');
    err.hidden = true;
    slot.classList.add('is-busy');
    try {
      const photo = await preparePhoto(file);
      release(session[kind]);
      session[kind] = photo;
      slot.outerHTML = slotHTML(kind);
    } catch (e) {
      slot.classList.remove('is-busy');
      err.textContent = e instanceof ImageError ? e.message : 'This photo could not be used. Try another one.';
      err.hidden = false;
    }
    syncRead();
  });

  form.addEventListener('click', (ev) => {
    const kind = ev.target.closest('[data-remove]')?.dataset.remove;
    if (!kind) return;
    release(session[kind]);
    session[kind] = null;
    form.querySelector(`[data-slot="${kind}"]`).outerHTML = slotHTML(kind);
    syncRead();
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!(session.receipt || session.odometer)) return;
    const vehicle = vehicles.find((v) => v.id === session.vehicleId);
    const entries = sortEntries(await store.listEntries(vehicle.id));
    const progress = form.querySelector('[data-progress]');
    const what = session.receipt && session.odometer ? 'fuel bill and odometer' : session.receipt ? 'fuel bill' : 'odometer';
    const steps = [
      ['prepare', 'Preparing photos'],
      ['send', providerInfo().isDemo ? 'Starting the demo reader' : 'Sending photos securely'],
      ['read', `Reading ${what}`],
      ['validate', 'Checking the details'],
      ['ready', 'Ready for review'],
    ];
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
      const result = await extract({
        receipt: session.receipt, odometer: session.odometer, vehicle, lastEntry: entries[entries.length - 1] || null,
        onProgress: (id) => { current = id; paint(); },
      });
      current = 'validate'; paint();
      await new Promise((r) => setTimeout(r, 250));
      current = 'ready'; paint();
      startReview(result);
      await render(main, { ...ctx, query: new URLSearchParams() });
      main.querySelector('.page-title')?.focus();
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      progress.hidden = true;
      form.querySelectorAll('input, button').forEach((el) => { el.disabled = false; });
      syncRead();
      const msg = form.querySelector('.form-error');
      const manual = `<a href="#/fuel/new?manual=1&v=${encodeURIComponent(vehicle.id)}">enter the fill manually</a>`;
      const reason = esc((e.message || 'unknown error').replace(/\.+$/, ''));
      msg.innerHTML = e.retry === false
        ? `${reason}. You can still ${manual}.`
        : `The details could not be read: ${reason}. Your photos are still here. Tap Read details to try again, or ${manual}.`;
      msg.hidden = false;
      msg.focus?.();
    }
  });
}

function startReview(result) {
  session.result = result;
  session.step = 'review';
  session.needsReview = new Set(); // no 'check this value' prompts: the user simply edits anything wrong
  session.confirmed = new Set();
  session.values = {
    date: result.transactionDate, time: result.transactionTime, fuelType: result.fuelType, quantity: result.quantityLitres,
    pricePerUnit: result.pricePerLitre, totalAmount: result.totalAmount, fuelCompany: result.fuelCompany, station: result.fuelStation,
    location: result.location, receiptNumber: result.receiptNumber, odometer: result.odometerKm, dashboardRangeKm: result.dashboardRangeKm,
    // A pump display has no date; people photograph it while filling, so default to today.
    ...(result.billKind === 'pump-display' && !result.transactionDate ? { date: todayStr() } : {}),
    fullTank: null, notes: '',
  };
}

// ---------------------------------------------------------------------------
// Step 5–6: review and save
// ---------------------------------------------------------------------------

async function renderReview(main, vehicles, ctx) {
  const vehicle = vehicles.find((v) => v.id === session.vehicleId);
  const entries = await store.listEntries(vehicle.id);
  const r = session.result;
  const v = session.values;
  const demo = providerInfo().isDemo;
  // Litres for petrol/diesel, kg for CNG.
  const labels = { ...LABELS, quantity: `Fuel (${fuelUnitName(vehicle.fuelType)})`, pricePerUnit: `Price per ${perUnitWord(vehicle.fuelType)} (₹)` };
  const val = (x) => (x === null || x === undefined ? '' : esc(x));

  const notFound = (name) => {
    const fromReceipt = RECEIPT_NAMES.includes(name) && r.sourceImages.receiptProvided;
    const fromOdo = ODO_NAMES.includes(name) && r.sourceImages.odometerProvided;
    return (fromReceipt || fromOdo) && (v[name] === null || v[name] === undefined || v[name] === '');
  };
  const hintFor = (name, base = '') => {
    const parts = [];
    if (notFound(name)) {
      parts.push('<span class="not-found">Not found on the photo</span>');
    }
    if (base) parts.push(base);
    return parts.join(' ');
  };
  const f = (name, input, base) => {
    let html = field(name, labels[name], input, hintFor(name, base));
    if (session.needsReview.has(name) && !session.confirmed.has(name)) html = html.replace(`class="field" data-field="${name}"`, `class="field needs-review" data-field="${name}"`);
    return html;
  };
  const textIn = (name, max = LIMITS.textMax, mode = 'text') => `<input id="${name}" name="${name}" type="text" inputmode="${mode}" maxlength="${max}" autocomplete="off" value="${val(v[name])}">`;
  const fuelOpts = [['', 'Not shown'], ...Object.entries(FUEL_TYPES).map(([k, t]) => [k, t.label])];
  const thumbs = ['receipt', 'odometer'].filter((k) => session[k]).map((k) => `<button type="button" class="thumb" data-view aria-label="${k === 'receipt' ? 'Fuel bill' : 'Odometer'} photo, view larger"><img src="${session[k].url}" alt="${k === 'receipt' ? 'Fuel bill' : 'Odometer'} photo"></button>`).join('');

  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Check the details</h1>
    ${demo ? `<div class="notice notice-demo" role="note">${icon('warn')}<div><p><strong>Demo values.</strong> These were made up by the demo reader, not read from your photos. Replace them with the real values before saving, or cancel.</p></div></div>` : ''}
    <div class="review-top">
      <p>For <strong>${esc(vehicle.nickname)}</strong><br><span class="muted">${vehicleSubtitle(vehicle)}</span></p>
      <div class="thumbs" data-gallery>${thumbs}</div>
    </div>
    <p class="hint">Check the values against your photos and change anything that is wrong.</p>
    <section class="checks" data-checks aria-live="polite"></section>
    <form class="form" novalidate>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      <h2 class="form-section">Fill</h2>
      ${f('date', `<input id="date" name="date" type="date" max="${todayStr()}" value="${val(v.date)}">`, r.billKind === 'pump-display' && !r.transactionDate ? 'A pump display shows no date, so today is filled in. Change it if you filled on another day.' : 'From the bill, not the day you took the photo.')}
      <div class="grid-3">
        ${f('quantity', textIn('quantity', 12, 'decimal'))}
        ${f('pricePerUnit', textIn('pricePerUnit', 12, 'decimal'))}
        ${f('totalAmount', textIn('totalAmount', 12, 'decimal'))}
      </div>
      ${choices('fullTank', 'Did you fill the tank to full?', [{ value: 'yes', label: 'Yes, full tank' }, { value: 'no', label: 'No, partial' }], v.fullTank === null ? null : (v.fullTank ? 'yes' : 'no'))}
      <p class="hint">A receipt cannot show this, so choose one. Mileage is measured between full tanks.</p>

      <h2 class="form-section">Odometer</h2>
      <div class="grid-2">
        ${f('odometer', textIn('odometer', 10, 'numeric'), 'The ODO number, not the range.')}
        ${f('dashboardRangeKm', textIn('dashboardRangeKm', 6, 'numeric'), 'Optional. Saved for reference; never used as the odometer.')}
      </div>

      <h2 class="form-section">Receipt details</h2>
      <div class="grid-2">
        ${f('fuelType', `<select id="fuelType" name="fuelType">${fuelOpts.map(([k, l]) => `<option value="${k}"${(v.fuelType || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${f('fuelCompany', textIn('fuelCompany'))}
      </div>
      ${f('station', textIn('station'))}
      ${field('notes', 'Notes', `<textarea id="notes" name="notes" rows="2" maxlength="${LIMITS.notesMax}">${val(v.notes)}</textarea>`)}

      <div class="notice notice-warn" data-warnings role="alert" hidden></div>
      <div class="form-actions form-actions-stack">
        <button class="btn btn-primary btn-block" type="submit" data-save>${icon('check')}Confirm and save</button>
        <div class="split">
          <button class="btn" type="button" data-retake>${icon('camera')}Retake or replace photos</button>
          <button class="btn btn-quiet" type="button" data-cancel>Cancel</button>
        </div>
      </div>
    </form>`;

  const form = main.querySelector('form');
  const checksBox = main.querySelector('[data-checks]');
  const warnBox = form.querySelector('[data-warnings]');
  const saveBtn = form.querySelector('[data-save]');
  const saveLabel = saveBtn.innerHTML;
  let accepted = false;

  const collect = () => {
    const fd = new FormData(form);
    const s = (k) => (fd.get(k) || '').trim();
    return {
      vehicleId: vehicle.id, date: s('date'), fuelType: s('fuelType') || null,
      quantity: toNum(s('quantity')), pricePerUnit: toNum(s('pricePerUnit')), totalAmount: toNum(s('totalAmount')),
      odometer: toNum(s('odometer')), dashboardRangeKm: toNum(s('dashboardRangeKm')),
      fullTank: fd.get('fullTank') === null ? null : fd.get('fullTank') === 'yes',
      fuelCompany: s('fuelCompany'), station: s('station'), notes: s('notes'),
    };
  };

  const paintChecks = () => {
    const d = collect();
    session.values = { ...d };
    const list = reviewChecks({ ...d, receiptIsFuel: r.receiptIsFuel, odometerReadable: r.odometerReadable, sourceImages: r.sourceImages }, { vehicle, entries, today: todayStr() });
    checksBox.innerHTML = list.length
      ? `<ul>${list.map((c) => `<li class="check check-${c.level}">${icon(c.level === 'ok' ? 'check' : c.level === 'warn' ? 'warn' : 'info')}<span>${esc(c.message)}</span></li>`).join('')}</ul>`
      : '';
    return list;
  };
  paintChecks();

  const confirmField = (name) => {
    if (!session.needsReview.has(name) || session.confirmed.has(name)) return;
    session.confirmed.add(name);
    const wrap = form.querySelector(`[data-field="${name}"]`);
    wrap.classList.remove('needs-review');
    wrap.querySelector('.review-flag')?.remove();
    wrap.querySelector(`[data-confirm="${name}"]`)?.remove();
  };

  form.addEventListener('input', (ev) => {
    if (ev.target.name) confirmField(ev.target.name);
    accepted = false;
    warnBox.hidden = true;
    saveBtn.innerHTML = saveLabel;
    paintChecks();
  });
  form.addEventListener('change', () => paintChecks());
  form.addEventListener('click', (ev) => {
    const name = ev.target.closest('[data-confirm]')?.dataset.confirm;
    if (name) { confirmField(name); form.elements[name]?.focus(); }
  });

  form.querySelector('[data-retake]').addEventListener('click', () => {
    session.step = 'capture';
    render(main, { ...ctx, query: new URLSearchParams() }).then(() => main.querySelector('.page-title')?.focus());
  });
  form.querySelector('[data-cancel]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Discard this entry?', message: 'The photos and the details read from them will be cleared. Nothing has been saved.', confirmLabel: 'Discard' });
    if (!ok) return;
    resetSession();
    ctx.navigate(`/?v=${encodeURIComponent(vehicle.id)}`);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saveBtn.disabled) return;
    const d = collect();
    const errors = {};
    for (const k of ['quantity', 'pricePerUnit', 'totalAmount', 'odometer', 'dashboardRangeKm']) {
      if (Number.isNaN(d[k])) errors[k] = 'Enter numbers only, like 20.50.';
    }
    if (d.fullTank === null) errors.fullTank = 'Choose whether the tank was filled to full.';
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }

    const entry = { ...d, fullTank: d.fullTank, calculated: [], source: demo ? 'smart-demo' : 'smart' };
    const { errors: vErrors, warnings } = validateEntry(entry, { vehicle, entries, today: todayStr(), checkDuplicates: false });
    if (!showFieldErrors(form, vErrors)) return;

    const dups = findPossibleDuplicates(entry, entries);
    const softChecks = paintChecks().filter((c) => c.level === 'warn');
    if ((warnings.length || dups.length || softChecks.length) && !accepted) {
      const lines = [];
      if (dups.length) {
        lines.push(`<p><strong>This fuel entry may already exist.</strong> Do you want to review the existing entry or continue?</p>`);
        for (const x of dups.slice(0, 3)) {
          lines.push(`<p>${fmt.date(x.entry.date)}, ${fmt.moneyExact(x.entry.totalAmount)}, ${fmt.km(x.entry.odometer)} (${esc(x.reasons.join('; '))}). <a href="#/fuel/${encodeURIComponent(x.entry.id)}/edit">Review existing entry</a></p>`);
        }
      }
      for (const w of warnings) {
        if (w.code === 'odometer-lower') lines.push(`<p>The odometer is lower than the previous fill (${fmt.km(w.previous.odometer)} on ${fmt.date(w.previous.date)}).</p>`);
        if (w.code === 'odometer-higher') lines.push(`<p>The odometer is higher than a later fill (${fmt.km(w.next.odometer)} on ${fmt.date(w.next.date)}).</p>`);
        if (w.code === 'below-initial') lines.push(`<p>The odometer is lower than the vehicle's starting reading (${fmt.km(w.initial)}).</p>`);
      }
      for (const c of softChecks) lines.push(`<p>${esc(c.message)}</p>`);
      warnBox.innerHTML = `${icon('warn')}<div><p><strong>Check before saving</strong></p>${[...new Set(lines)].join('')}<p>Fix the values, or tap Save anyway.</p></div>`;
      warnBox.hidden = false;
      accepted = true;
      saveBtn.textContent = 'Save anyway';
      warnBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    await busy(saveBtn, 'Saving…', async () => {
      try {
        await store.saveEntry(entry);
        store.setPref('lastVehicle', vehicle.id);
        const { summary } = analyseVehicle(await store.listEntries(vehicle.id), vehicle);
        resetSession();
        toast(summary.status === 'ok' ? 'Fuel entry saved' : `Fuel entry saved. ${mileageHint(summary)}`);
        ctx.navigate(`/?v=${encodeURIComponent(vehicle.id)}`);
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });
}

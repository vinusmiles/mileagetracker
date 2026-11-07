// Smart fuel entry: pick vehicle → add receipt and/or odometer photo → read →
// review every value → save. Nothing is saved without the user's confirmation.
// Photos are kept in memory for this browser tab only, so the user can retry or
// go back without re-taking them; they are released on save or cancel.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState, field, choices, showFieldErrors, busy, toast, confirmDialog, mileageHint, req, vehicleSelect } from '../ui.js';
import { payAction } from '../upi.js';
import { FUEL_TYPES, LIMITS, fuelUnit, fuelUnitName, perUnitWord } from '../core/model.js';
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
// One-line versions of the review checks (the full sentence is in the tooltip)
const SHORT_CHECK = {
  'amount-match': 'Amounts match',
  'odometer-missing': 'No odometer: mileage skipped',
  'quantity-missing': 'Litres missing',
  'amount-missing': 'Total missing',
  'date-missing': 'Date missing',
  'odometer-unreadable': 'Odometer not readable',
};

// A corrected reading is always shown for checking, never saved in one tap.
function repairNote({ field, from, to }) {
  const show = (x) => (field === 'quantityLitres' ? String(x) : fmt.moneyExact(x));
  const name = { totalAmount: 'Total', quantityLitres: 'Quantity', pricePerLitre: 'Rate' }[field];
  return `${name} corrected from ${show(from)} to ${show(to)} so that quantity × rate matches the total. Check it against the photo.`;
}

const LABELS = {
  date: 'Date', time: 'Time', fuelType: 'Fuel type', quantity: 'Fuel quantity', pricePerUnit: 'Price per unit (₹)',
  totalAmount: 'Total paid (₹)', fuelCompany: 'Fuel company', station: 'Fuel station', location: 'Location',
  receiptNumber: 'Receipt number', odometer: 'Odometer (km)', dashboardRangeKm: 'Range on dashboard (km)', fullTank: 'Full tank',
};
// Shown on the review screen. Time, location and receipt number may still be read
// by a provider, but they are not shown or saved.
const RECEIPT_NAMES = ['date', 'fuelType', 'quantity', 'pricePerUnit', 'totalAmount', 'fuelCompany', 'station'];
const ODO_NAMES = ['odometer', 'dashboardRangeKm'];

const session = { vehicleId: null, receipt: null, odometer: null, step: 'capture', result: null, needsReview: new Set(), confirmed: new Set(), values: null };

function resetSession() {
  session.quickReason = '';
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
    const busiest = await store.busiestVehicleId();
    session.vehicleId = busiest || (vehicles.some((v) => v.id === pref) ? pref : vehicles[0].id);
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
  const title = isReceipt ? 'Fuel bill' : 'Odometer';
  const help = isReceipt ? 'Printed bill or pump screen' : 'Dashboard showing ODO';
  const examples = isReceipt
    ? (slotFuel === 'cng'
      ? [['cng-reading.webp', 'Example: CNG pump screen']]
      : [['fuel-bill.webp', 'Example: printed fuel bill'], ['pump-reading.webp', 'Example: pump screen']])
    : [['odometer.webp', 'Example: dashboard with ODO reading']];
  const exampleThumbs = examples.map(([f, alt]) => `<button type="button" data-view aria-label="${alt}, view larger"><img src="assets/samples/${f}" alt="${alt}" loading="lazy"></button>`).join('');
  return `
    <section class="photo-slot${photo ? ' has-photo' : ''}" data-slot="${kind}" aria-labelledby="slot-${kind}">
      <div class="slot-head">
        <div>
          <h2 id="slot-${kind}">${photo ? `${icon('check')} ` : ''}${title}</h2>
          <p class="hint">${help}</p>
        </div>
        ${photo ? '' : `<div class="slot-examples" data-gallery><span>e.g.</span>${exampleThumbs}</div>`}
      </div>
      ${photo ? `<div class="photo-preview"><img src="${photo.url}" alt="${title} photo preview"></div>` : ''}
      <div class="photo-actions">
        <label class="btn btn-sm file-btn btn-camera">${icon('camera')}${photo ? 'Retake' : 'Take photo'}
          <input type="file" accept="image/*" capture="environment" data-pick="${kind}"></label>
        <label class="btn btn-sm file-btn">${icon('image')}${photo ? 'Replace' : 'Upload'}
          <input type="file" accept="image/jpeg,image/png,image/webp" data-pick="${kind}"></label>
        ${photo ? `<button class="btn btn-sm btn-quiet" type="button" data-remove="${kind}">Remove</button>` : ''}
      </div>
      <p class="field-error" data-slot-error hidden></p>
    </section>`;
}

function renderCapture(main, vehicles, ctx) {
  slotFuel = vehicles.find((v) => v.id === session.vehicleId)?.fuelType || 'petrol';
  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Smart fuel entry</h1>
    <p class="lead">Snap your fuel bill and odometer. We fill in the details.</p>
    ${demoNotice()}
    <form class="form smart-capture" novalidate>
      ${vehicleSelect(vehicles, session.vehicleId)}
      <div class="photo-slots">${slotHTML('receipt')}${slotHTML('odometer')}</div>
      <p class="hint">${providerInfo().isDemo ? 'Demo mode: photos stay on this phone.' : 'Photos are read securely and not stored.'}</p>
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
  const unitShort = fuelUnitName(vehicle.fuelType) === 'litres' ? 'Litres' : 'Kg';
  const labels = { ...LABELS, date: r.billKind === 'pump-display' && !r.transactionDate ? `${req('Date')} <small class="muted">(today)</small>` : req('Date'), odometer: 'Odometer km', totalAmount: req('Total ₹'), quantity: req(unitShort), pricePerUnit: `₹ / ${perUnitWord(vehicle.fuelType)}` };
  const val = (x) => (x === null || x === undefined ? '' : esc(x));

  const notFound = (name) => {
    const fromReceipt = RECEIPT_NAMES.includes(name) && r.sourceImages.receiptProvided;
    const fromOdo = ODO_NAMES.includes(name) && r.sourceImages.odometerProvided;
    return (fromReceipt || fromOdo) && (v[name] === null || v[name] === undefined || v[name] === '');
  };
  const hintFor = (name, base = '') => {
    const parts = [];
    // "Not found" is shown inside the empty box instead (keeps side-by-side fields aligned)
    if (base) parts.push(base);
    return parts.join(' ');
  };
  const f = (name, input, base) => {
    if (notFound(name)) input = input.replace('<input ', '<input placeholder="Not found" ').replace('<select ', '<select data-nf ');
    let html = field(name, labels[name], input, hintFor(name, base));
    if (notFound(name)) html = html.replace(`class="field" data-field="${name}"`, `class="field not-found-field" data-field="${name}"`);
    if (session.needsReview.has(name) && !session.confirmed.has(name)) html = html.replace(`class="field" data-field="${name}"`, `class="field needs-review" data-field="${name}"`);
    return html;
  };
  const textIn = (name, max = LIMITS.textMax, mode = 'text') => `<input id="${name}" name="${name}" type="text" inputmode="${mode}" maxlength="${max}" autocomplete="off" value="${val(v[name])}">`;
  const fuelOpts = [['', 'Not shown'], ...Object.entries(FUEL_TYPES).map(([k, t]) => [k, t.label])];
  const thumbs = ['receipt', 'odometer'].filter((k) => session[k]).map((k) => `<button type="button" class="thumb" data-view aria-label="${k === 'receipt' ? 'Fuel bill' : 'Odometer'} photo, view larger"><img src="${session[k].url}" alt="${k === 'receipt' ? 'Fuel bill' : 'Odometer'} photo"></button>`).join('');

  main.innerHTML = `
    <a class="back" href="#/">${icon('back')}Home</a>
    <h1 class="page-title" tabindex="-1">Check the details</h1>
    ${demo ? `<div class="notice notice-demo" role="note">${icon('warn')}<span><strong>Demo values</strong>: replace them with the real ones.</span></div>` : ''}
    <div class="review-head">
      <div class="thumbs" data-gallery>${thumbs}</div>
      <p><strong>${esc(vehicle.nickname)}</strong>${vehicle.registration ? ` <span class="muted">· ${esc(vehicle.registration)}</span>` : ''}</p>
    </div>
    ${r.repair ? `<p class="notice notice-warn notice-slim" role="status">${icon('warn')}<span>${esc(repairNote(r.repair))}</span></p>` : ''}
    ${session.quickReason ? `<p class="notice notice-warn notice-slim" role="status">${icon('warn')}<span>${esc(session.quickReason)}</span></p>` : ''}
    <section class="checks checks-slim" data-checks aria-live="polite"></section>
    <form class="form" novalidate>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      <div class="grid-2">
        ${f('date', `<input id="date" name="date" type="date" max="${todayStr()}" value="${val(v.date)}">`)}
        ${f('odometer', textIn('odometer', 10, 'numeric'))}
      </div>
      <div class="grid-3">
        ${f('quantity', textIn('quantity', 12, 'decimal'))}
        ${f('pricePerUnit', textIn('pricePerUnit', 12, 'decimal'))}
        ${f('totalAmount', textIn('totalAmount', 12, 'decimal'))}
      </div>
      <div class="inline-choice">${choices('fullTank', req('Tank full?'), [{ value: 'yes', label: 'Yes, full' }, { value: 'no', label: 'Partial' }], v.fullTank === null ? null : (v.fullTank ? 'yes' : 'no'))}</div>

      <details class="optional"${v.fuelCompany || v.station || v.notes ? '' : ''}>
        <summary>More details (optional)</summary>
        <div class="grid-2">
          ${f('fuelType', `<select id="fuelType" name="fuelType">${fuelOpts.map(([k, l]) => `<option value="${k}"${(v.fuelType || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
          ${f('dashboardRangeKm', textIn('dashboardRangeKm', 6, 'numeric'), 'Distance-to-empty shown on the dashboard.')}
          ${f('fuelCompany', textIn('fuelCompany'))}
          ${f('station', textIn('station'))}
        </div>
        ${field('notes', 'Notes', `<textarea id="notes" name="notes" rows="2" maxlength="${LIMITS.notesMax}">${val(v.notes)}</textarea>`)}
      </details>

      <div class="notice notice-warn" data-warnings role="alert" hidden></div>
      <div class="form-actions form-actions-stack review-footer">
        <button class="btn btn-primary btn-block sticky-save" type="submit" data-save>${icon('check')}Confirm and save</button>
        <div class="split">
          <button class="btn" type="button" data-retake>${icon('camera')}Change photos</button>
          <button class="btn btn-cancel" type="button" data-cancel>${icon('close')}Cancel</button>
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
    const list = reviewChecks({ ...d, receiptIsFuel: r.receiptIsFuel, odometerReadable: r.odometerReadable, sourceImages: r.sourceImages }, { vehicle, entries, today: todayStr() })
      .filter((c) => c.message !== session.quickReason); // already shown in full above
    checksBox.innerHTML = list.length
      ? `<ul>${list.map((c) => `<li class="check check-${c.level}" title="${esc(c.message)}">${icon(c.level === 'ok' ? 'check' : c.level === 'warn' ? 'warn' : 'info')}<span>${esc(SHORT_CHECK[c.code] || c.message)}</span></li>`).join('')}</ul>`
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
    const { errors: vErrors, warnings } = validateEntry(entry, { vehicle, entries, today: todayStr(), checkDuplicates: false, odometerOptional: true });
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
        const saved = await store.saveEntry(entry);
        store.setPref('lastVehicle', vehicle.id);
        const { summary } = analyseVehicle(await store.listEntries(vehicle.id), vehicle);
        resetSession();
        toast(summary.status === 'ok' ? 'Fuel entry saved' : `Fuel entry saved. ${mileageHint(summary)}`, 'ok', payAction(saved.totalAmount));
        ctx.navigate(`/?v=${encodeURIComponent(vehicle.id)}`);
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Scan (#/scan): camera opens straight away, PhonePe-style.
//   1. Snap the bill or pump screen (or Upload / Enter manually).
//      Reading starts immediately in the background: the pump screen resets fast
//      and the rider is busy paying, so no waiting here.
//   2. One small sheet: which vehicle (most-used pre-selected) + odometer
//      (type it, photo, or skip). Continue → the review screen, usually ready.
// ---------------------------------------------------------------------------

let cam = null; // { stream, video }

function stopCamera() {
  if (cam?.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam = null;
}
window.addEventListener('hashchange', stopCamera);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

async function startCamera(video) {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  cam = { stream, video };
  return stream;
}

function snapshot(video, digitalZoom = 1) {
  const c = document.createElement('canvas');
  const w = video.videoWidth;
  const h = video.videoHeight;
  const z = Math.max(1, digitalZoom || 1);
  const sw = w / z;
  const sh = h / z;
  c.width = Math.round(sw);
  c.height = Math.round(sh);
  c.getContext('2d').drawImage(video, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.92));
}

/** Full-screen camera. Resolves with a prepared photo, or 'manual', or null (closed). */
export function cameraOverlay(main, { title, hint, allowManual, prepare = preparePhoto, uploadAccept = 'image/jpeg,image/png,image/webp' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'cam';
    el.innerHTML = `
      <div class="cam-top">
        <button type="button" class="cam-btn" data-close aria-label="Close">${icon('back')}</button>
        <div><strong>${esc(title)}</strong><span>${esc(hint)}</span></div>
      </div>
      <div class="cam-stage">
        <video playsinline muted autoplay></video>
        <div class="cam-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="cam-zoom" role="group" aria-label="Zoom"><button type="button" data-z="1" class="on">1×</button><button type="button" data-z="2">2×</button><button type="button" data-z="3">3×</button></div>
        <p class="cam-msg" hidden></p>
      </div>
      <div class="cam-bottom">
        <label class="cam-side">${icon('image')}<span>Upload</span><input type="file" accept="${uploadAccept}" data-upload></label>
        <button type="button" class="cam-shutter" data-shoot aria-label="Take photo"><svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><defs><linearGradient id="shg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0C6B32"/><stop offset="1" stop-color="#4BA707"/></linearGradient></defs><circle cx="48" cy="48" r="44" fill="url(#shg)"/><path d="M26 40a5.5 5.5 0 0 1 5.5-5.5h5.5l3.3-4.5h15.4l3.3 4.5h5.5A5.5 5.5 0 0 1 70 40v19.5a5.5 5.5 0 0 1-5.5 5.5h-33A5.5 5.5 0 0 1 26 59.5z" fill="#fff"/><circle cx="48" cy="50" r="11.5" fill="#0C6B32"/><rect x="43" y="43.5" width="7" height="12" rx="1.4" fill="#fff"/><rect x="44.4" y="45.2" width="4.2" height="3" rx=".6" fill="#0C6B32"/><path d="M50 47.5h1.3a1.1 1.1 0 0 1 1.1 1.1v3.7a1.1 1.1 0 0 0 2.2 0v-5.6l-1.5-1.7" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        ${allowManual
          ? `<button type="button" class="cam-side" data-manual>${icon('keyboard')}<span>Type it</span></button>`
          : `<button type="button" class="cam-side" data-torch hidden>${icon('bulb')}<span>Torch</span></button>`}
      </div>
      ${allowManual ? `<button type="button" class="cam-torch" data-torch hidden aria-label="Torch">${icon('bulb')}</button>` : ''}
      <label class="cam-fallback" hidden>${icon('camera')}<span>Open camera</span><input type="file" accept="image/*" capture="environment" data-fallback></label>`;
    document.body.append(el);
    document.body.classList.add('cam-open');
    const video = el.querySelector('video');
    const msg = el.querySelector('.cam-msg');
    let done = false;
    const finish = (val) => { if (done) return; done = true; stopCamera(); el.remove(); document.body.classList.remove('cam-open'); resolve(val); };
    const useFile = async (file) => {
      if (!file) return;
      msg.hidden = false; msg.textContent = 'Preparing photo…';
      try { finish(await prepare(file)); } catch (e) { msg.textContent = e instanceof ImageError ? e.message : 'This photo could not be used.'; }
    };

    let zoom = 1;
    let applyZoom = () => {};
    const zoomBtns = el.querySelectorAll('[data-z]');
    const showZoom = () => zoomBtns.forEach((b) => b.classList.toggle('on', Math.abs(Number(b.dataset.z) - zoom) < 0.25));
    startCamera(video).then((stream) => {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      // Zoom: the phone's own camera zoom if offered (sharper), else a digital zoom
      const hw = caps.zoom && caps.zoom.max > caps.zoom.min;
      const maxZ = hw ? Math.min(caps.zoom.max, 5) : 4;
      const minZ = hw ? Math.max(caps.zoom.min, 1) : 1;
      applyZoom = (z) => {
        zoom = Math.max(minZ, Math.min(maxZ, z));
        if (hw) track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
        else video.style.transform = `scale(${zoom})`;
        cam.digitalZoom = hw ? 1 : zoom;
        showZoom();
      };
      zoomBtns.forEach((b) => { if (Number(b.dataset.z) > maxZ) b.hidden = true; b.addEventListener('click', () => applyZoom(Number(b.dataset.z))); });
      // Pinch to zoom, like UPI scanners
      const stage = el.querySelector('.cam-stage');
      const pts = new Map();
      let startDist = 0;
      let startZoom = 1;
      const dist = () => { const [a, b2] = [...pts.values()]; return Math.hypot(a.x - b2.x, a.y - b2.y); };
      stage.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { startDist = dist(); startZoom = zoom; } });
      stage.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2 && startDist > 0) applyZoom(startZoom * (dist() / startDist));
      });
      const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) startDist = 0; };
      stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('pointerleave', up);
      if (caps.torch) {
        let on = false;
        el.querySelectorAll('[data-torch]').forEach((b) => {
          b.hidden = false;
          b.addEventListener('click', async () => { on = !on; b.classList.toggle('on', on); try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* not supported */ } });
        });
      }
    }).catch(() => {
      // No live camera (permission denied or unsupported): fall back to the phone's camera app.
      el.querySelector('[data-shoot]').hidden = true;
      el.querySelector('.cam-frame').hidden = true;
      el.querySelector('.cam-fallback').hidden = false;
      msg.hidden = false;
      msg.textContent = 'Camera not available here. Use “Open camera” or Upload.';
    });

    el.querySelector('[data-shoot]').addEventListener('click', async () => {
      if (!cam) return;
      el.classList.add('flash');
      const blob = await snapshot(video, cam?.digitalZoom || 1);
      await useFile(new File([blob], 'scan.jpg', { type: 'image/jpeg' }));
    });
    el.querySelector('[data-upload]').addEventListener('change', (ev) => useFile(ev.target.files?.[0]));
    el.querySelector('[data-fallback]').addEventListener('change', (ev) => useFile(ev.target.files?.[0]));
    el.querySelector('[data-close]').addEventListener('click', () => finish(null));
    el.querySelector('[data-manual]')?.addEventListener('click', () => finish('manual'));
    window.addEventListener('hashchange', () => finish(null), { once: true });
  });
}

export async function renderCamera(main, ctx) {
  const vehicles = await store.listVehicles();
  if (!vehicles.length) {
    main.innerHTML = `<h1 class="page-title" tabindex="-1">Scan</h1>
      ${emptyState({ title: 'Add a vehicle first', text: 'Fills are saved to a vehicle, so start by adding your bike or car.', actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>` })}`;
    return;
  }
  resetSession();
  main.innerHTML = '<p class="loading" role="status">Opening camera…</p>';
  const first = await cameraOverlay(main, { title: 'Scan fuel bill', hint: 'Bill or pump screen inside the frame', allowManual: true });
  if (first === 'manual') { ctx.navigate('/fuel/new?manual=1&from=scan'); return; }
  if (!first) { ctx.navigate('/'); return; }
  session.receipt = first;

  // Start reading the bill straight away, while the rider pays.
  const busiest = await store.busiestVehicleId();
  session.vehicleId = vehicles.some((v) => v.id === ctx.query.get('v')) ? ctx.query.get('v') : (busiest || vehicles[0].id);
  const vehicleOf = () => vehicles.find((v) => v.id === session.vehicleId);
  const entriesOf = async () => sortEntries(await store.listEntries(session.vehicleId));
  const billRead = (async () => {
    try {
      return await extract({ receipt: session.receipt, odometer: null, vehicle: vehicleOf(), lastEntry: (await entriesOf()).slice(-1)[0] || null });
    } catch (e) { return { error: e }; }
  })();
  let billDone = false;
  billRead.then(() => { billDone = true; const s = main.querySelector('[data-read-state]'); if (s) { s.textContent = 'Bill read ✓'; s.classList.add('ok'); } });

  const chips = vehicles.map((v) => `<button type="button" class="vchip${v.id === session.vehicleId ? ' on' : ''}" data-veh="${esc(v.id)}">${icon(v.type)}${esc(v.nickname)}</button>`).join('');
  main.innerHTML = `
    <a class="back" href="#/" data-cancel-scan>${icon('back')}Home</a>
    <h1 class="page-title" tabindex="-1">Almost done</h1>
    <div class="scan-sheet">
      <div class="scan-thumb"><img src="${first.url}" alt="Fuel bill photo"><span class="read-state" data-read-state>Reading bill…</span></div>
      ${vehicles.length > 2
        ? vehicleSelect(vehicles, session.vehicleId, 'Which vehicle?')
        : `<h2>Which vehicle?</h2><div class="vchips" role="group" aria-label="Vehicle">${chips}</div>`}
      <h2>Odometer <span class="muted">(optional)</span></h2>
      <div class="odo-row">
        <input id="odoKm" type="text" inputmode="numeric" autocomplete="off" placeholder="km on the ODO">
        <button type="button" class="btn" data-odo-photo>${icon('camera')}Photo</button>
      </div>
      <p class="hint" data-odo-hint>In a hurry? Skip it and add it later.</p>
      <div class="sheet-links"><button type="button" class="link-btn" data-review>Check details first</button></div>
      <div class="quick-save" role="group" aria-label="Save">
        <button type="button" class="btn qs-btn qs-full" data-save-full>${icon('tankFull')}<span>Save<small>Full tank</small></span></button>
        <button type="button" class="btn qs-btn qs-partial" data-save-partial>${icon('tankHalf')}<span>Save<small>Partial fill</small></span></button>
        <button type="button" class="btn btn-cancel qs-cancel" data-cancel-scan>${icon('close')}Cancel</button>
      </div>
    </div>`;
  const sheet = main.querySelector('.scan-sheet');
  if (billDone) { const s = sheet.querySelector('[data-read-state]'); s.textContent = 'Bill read ✓'; s.classList.add('ok'); }
  sheet.querySelector('#vehicleId')?.addEventListener('change', (ev) => { session.vehicleId = ev.target.value; });
  sheet.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-veh]');
    if (!b) return;
    session.vehicleId = b.dataset.veh;
    sheet.querySelectorAll('[data-veh]').forEach((x) => x.classList.toggle('on', x === b));
  });

  let odoRead = null;
  sheet.querySelector('[data-odo-photo]').addEventListener('click', async () => {
    const shot = await cameraOverlay(main, { title: 'Odometer', hint: 'The ODO number on the dashboard', allowManual: false });
    if (!shot) return;
    session.odometer = shot;
    const hint = sheet.querySelector('[data-odo-hint]');
    hint.textContent = 'Reading odometer…';
    odoRead = extract({ receipt: null, odometer: shot, vehicle: vehicleOf(), lastEntry: (await entriesOf()).slice(-1)[0] || null })
      .then((r) => { if (r.odometerKm && !sheet.querySelector('#odoKm').value) sheet.querySelector('#odoKm').value = r.odometerKm; hint.textContent = r.odometerKm ? 'Odometer read ✓ Check the number.' : 'Could not read the ODO. Type it, or skip.'; return r; })
      .catch(() => { hint.textContent = 'Could not read the ODO. Type it, or skip.'; return null; });
  });

  // One tap: Save · Full tank / Save · Partial. Saves straight away when the reading is
  // clean; opens the review screen (Confirm pinned at the bottom) only when it is not.
  const go = async (fullTank, forceReview, btn) => {
    sheet.querySelectorAll('.qs-btn, [data-review]').forEach((b) => { b.disabled = true; });
    const label = btn.innerHTML;
    if (!billDone) btn.innerHTML = `${icon('scan')}<span>Reading…</span>`;
    const bill = await billRead;
    const odo = odoRead ? await odoRead : null;
    let result;
    if (bill?.error) {
      result = { ...(await import('../smart/schema.js')).emptyExtraction({ receiptProvided: true, odometerProvided: !!session.odometer }) };
      toast(`Could not read the bill (${(bill.error.message || 'error').replace(/\.+$/, '')}). Fill in the details.`, 'error');
    } else {
      result = { ...bill };
    }
    if (odo && !odo.error) Object.assign(result, { odometerKm: odo.odometerKm, dashboardRangeKm: odo.dashboardRangeKm, dashboardTime: odo.dashboardTime, odometerReadable: odo.odometerReadable });
    result.sourceImages = { receiptProvided: true, odometerProvided: !!session.odometer };
    startReview(result);
    const typed = toNum(sheet.querySelector('#odoKm').value);
    if (typed > 0) session.values.odometer = Math.round(typed);
    if (fullTank !== null) session.values.fullTank = fullTank;
    store.setPref('lastVehicle', session.vehicleId);

    const vehicle = vehicleOf();
    const entries = await store.listEntries(vehicle.id);
    const v = session.values;
    const entry = {
      vehicleId: vehicle.id, date: v.date || '', fuelType: v.fuelType || null, quantity: v.quantity ?? null, pricePerUnit: v.pricePerUnit ?? null,
      totalAmount: v.totalAmount ?? null, odometer: v.odometer ?? null, dashboardRangeKm: v.dashboardRangeKm ?? null, fullTank: v.fullTank,
      fuelCompany: v.fuelCompany || '', station: v.station || '', notes: '', calculated: [], source: 'smart',
    };
    const reasons = quickSaveBlockers({ entry, result, vehicle, entries, demo: providerInfo().isDemo, forceReview, readFailed: !!bill?.error });
    if (reasons.length) {
      session.quickReason = reasons[0];
      ctx.navigate('/smart');
      return;
    }
    try {
      const saved = await store.saveEntry(entry);
      resetSession();
      ctx.navigate('/');
      toast(`Saved ${fmt.moneyExact(saved.totalAmount)} · ${fmt.qty(saved.quantity, saved.unit || fuelUnit(vehicle.fuelType))} · ${vehicle.nickname}`, 'ok', [{ label: 'Edit', href: `#/fuel/${encodeURIComponent(saved.id)}/edit` }, payAction(saved.totalAmount)]);
    } catch (err) {
      session.quickReason = err.message;
      btn.innerHTML = label;
      ctx.navigate('/smart');
    }
  };
  sheet.querySelector('[data-save-full]').addEventListener('click', (ev) => go(true, false, ev.currentTarget));
  sheet.querySelector('[data-save-partial]').addEventListener('click', (ev) => go(false, false, ev.currentTarget));
  sheet.querySelector('[data-review]').addEventListener('click', (ev) => go(null, true, ev.currentTarget));
  // Cancel: drop the photos and the reading, back to Home (also the ‹ in the top bar)
  const cancelScan = (ev) => { ev?.preventDefault(); resetSession(); ctx.navigate('/'); toast('Scan cancelled'); };
  sheet.querySelector('[data-cancel-scan]').addEventListener('click', cancelScan);
  document.querySelector('.appbar-back')?.addEventListener('click', function once(ev) { if (main.querySelector('.scan-sheet')) cancelScan(ev); this.removeEventListener('click', once); });
}

/** Why a scan cannot be saved in one tap (empty list = safe to save straight away). */
export function quickSaveBlockers({ entry, result, vehicle, entries, demo, forceReview, readFailed }) {
  const out = [];
  if (forceReview || result.repair) out.push('');
  if (demo) out.push('Demo reader: check the made-up values.');
  if (readFailed) out.push('The bill could not be read. Fill in the details.');
  if (!(entry.quantity > 0) || !(entry.totalAmount > 0)) out.push('Some amounts could not be read. Please check them.');
  if (!entry.date) out.push('The date could not be read. Please check it.');
  if (entry.fullTank === null) out.push('');
  const checks = reviewChecks({ ...entry, receiptIsFuel: result.receiptIsFuel, odometerReadable: result.odometerReadable, sourceImages: result.sourceImages }, { vehicle, entries, today: todayStr() });
  for (const c of checks.filter((x) => x.level === 'warn')) out.push(c.message);
  const { errors, warnings } = validateEntry(entry, { vehicle, entries, today: todayStr(), checkDuplicates: false, odometerOptional: true });
  if (Object.keys(errors).length) out.push(Object.values(errors)[0]);
  if (warnings.length) out.push('Please check the odometer reading.');
  if (findPossibleDuplicates(entry, entries).length) out.push('This fill may already be saved. Please check.');
  return out;
}

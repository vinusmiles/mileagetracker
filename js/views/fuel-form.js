// Add or edit a fuel fill. Built for one-handed use: big targets, number
// keyboards, today's date filled in, last vehicle remembered.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState, field, choices, showFieldErrors, busy, toast, confirmDialog, req, vehicleSelect } from '../ui.js';
import { payAction } from '../upi.js';
import { fuelUnit, LIMITS, perUnitWord } from '../core/model.js';
import { validateEntry } from '../core/validate.js';
import { toNum, deriveAmounts, sortEntries } from '../core/calc.js';
import { todayStr } from '../core/dates.js';

const AMOUNT_FIELDS = ['quantity', 'pricePerUnit', 'totalAmount'];

export async function render(main, { params, query, navigate }) {
  const vehicles = await store.listVehicles();
  const editing = params[0] ? await store.getEntry(params[0]) : null;

  if (params[0] && !editing) {
    main.innerHTML = `<h1 class="page-title" tabindex="-1">Fuel entry not found</h1><p>It may have been deleted. <a href="#/history">Back to History</a></p>`;
    return;
  }
  if (!vehicles.length) {
    main.innerHTML = `
      <h1 class="page-title" tabindex="-1">Add fuel</h1>
      ${emptyState({
        title: 'Add a vehicle first',
        text: 'Fuel entries belong to a vehicle, so start by adding your bike or car.',
        actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>`,
      })}`;
    return;
  }

  const today = todayStr();
  const remembered = store.getPref('lastVehicle');
  const pick = (id) => vehicles.find((v) => v.id === id);
  const vehicle0 = pick(editing?.vehicleId) || pick(query.get('v')) || pick(await store.busiestVehicleId()) || pick(remembered) || vehicles[0];
  if (!editing && query.get('manual') !== '1') {
    const v = encodeURIComponent(vehicle0.id);
    main.innerHTML = `
      <h1 class="page-title" tabindex="-1">Add fuel</h1>
      <div class="choose">
        <a class="choose-main" href="#/smart?v=${v}">
          <span class="choose-icon">${icon('scanfuel')}</span>
          <span><strong>Smart fuel entry</strong><span>Snap the fuel bill and odometer. We fill in the details.</span></span>
        </a>
        <div class="or-divider">OR</div>
        <a class="choose-alt" href="#/fuel/new?manual=1&v=${v}">${icon('fuel')}Add details manually</a>
      </div>`;
    return;
  }

  const e = editing || { vehicleId: vehicle0.id, date: today, quantity: '', pricePerUnit: '', totalAmount: '', odometer: '', fullTank: null, station: '', notes: '', calculated: [] };
  const val = (x) => (x === null || x === undefined ? '' : esc(x));

  const vehicleField = vehicleSelect(vehicles, vehicle0.id);

  // Back: to the scanner when you came from "Type it", else to where fills are listed
  const backHref = query.get('from') === 'scan' ? '#/scan' : (editing ? '#/history' : '#/');
  const backText = query.get('from') === 'scan' ? 'Scan' : (editing ? 'Reports' : 'Home');
  main.innerHTML = `
    <a class="back" href="${backHref}">${icon('back')}${backText}</a>
    <h1 class="page-title" tabindex="-1">${editing ? 'Edit fuel entry' : 'Add fuel'}</h1>
    <form class="form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${vehicleField}
      <div class="grid-2">
        ${field('date', req('Date'), `<input id="date" name="date" type="date" required max="${today}" value="${val(e.date)}">`)}
        ${field('odometer', 'Odometer km', `<input id="odometer" name="odometer" type="text" inputmode="numeric" autocomplete="off" value="${val(e.odometer)}">`)}
      </div>
      <div class="grid-3" data-amounts>
        ${field('quantity', req('<span data-unit></span>'), `<input id="quantity" name="quantity" type="text" inputmode="decimal" autocomplete="off" required value="${val(e.quantity)}">`)}
        ${field('pricePerUnit', '₹ / <span data-unit-name></span>', `<input id="pricePerUnit" name="pricePerUnit" type="text" inputmode="decimal" autocomplete="off" value="${val(e.pricePerUnit)}">`)}
        ${field('totalAmount', req('Total ₹'), `<input id="totalAmount" name="totalAmount" type="text" inputmode="decimal" autocomplete="off" required value="${val(e.totalAmount)}">`)}
      </div>
      <p class="hint hint-calc" data-calc-note hidden></p>
      <div class="inline-choice">${choices('fullTank', req('Tank full?'), [{ value: 'yes', label: 'Yes, full' }, { value: 'no', label: 'Partial' }], e.fullTank === null || e.fullTank === undefined ? null : (e.fullTank ? 'yes' : 'no'))}</div>
      <p class="hint">Needed for mileage.</p>
      <details class="optional"${e.station || e.notes ? ' open' : ''}>
        <summary>Fuel station and notes (optional)</summary>
        ${field('station', 'Fuel station or place', `<input id="station" name="station" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" value="${val(e.station)}">`)}
        ${field('notes', 'Notes', `<textarea id="notes" name="notes" rows="2" maxlength="${LIMITS.notesMax}">${val(e.notes)}</textarea>`)}
      </details>
      <div class="notice notice-warn" data-warnings role="alert" hidden></div>
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">${icon('fuel')}${editing ? 'Save changes' : 'Save fuel entry'}</button>
      </div>
    </form>
    ${editing ? `
      <section class="danger">
        <h2>Delete this entry</h2>
        <p>Mileage for the surrounding fills will be recalculated.</p>
        <button class="btn btn-danger" type="button" data-action="delete">Delete fuel entry</button>
      </section>` : ''}`;

  const form = main.querySelector('form');
  const input = (name) => form.elements[name];
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.innerHTML;
  const warnBox = form.querySelector('[data-warnings]');
  const calcNote = form.querySelector('[data-calc-note]');

  // ---- warnings need a second, deliberate tap (see submit) ----
  let warningsAccepted = false;
  function resetWarnings() {
    warningsAccepted = false;
    warnBox.hidden = true;
    submit.innerHTML = submitLabel;
  }

  // ---- vehicle-dependent labels and the last odometer hint ----
  let currentVehicle = vehicle0;
  let vehicleEntries = [];
  async function onVehicleChange() {
    const id = form.elements.vehicleId.value;
    currentVehicle = pick(id) || vehicle0;
    vehicleEntries = await store.listEntries(currentVehicle.id);
    const unit = fuelUnit(currentVehicle.fuelType);
    form.querySelectorAll('[data-unit]').forEach((s) => { s.textContent = unit === 'L' ? 'Litres' : 'Kg'; });
    form.querySelectorAll('[data-unit-name]').forEach((s) => { s.textContent = perUnitWord(currentVehicle.fuelType); });
    const others = sortEntries(vehicleEntries.filter((x) => x.id !== editing?.id));
    const last = others[others.length - 1];
    // Show the last reading inside the empty box (saves a line on small screens)
    form.elements.odometer.placeholder = last?.odometer ? `Last ${fmt.kmNumber(last.odometer)}` : (Number.isFinite(currentVehicle.initialOdometer) ? `Start ${fmt.kmNumber(currentVehicle.initialOdometer)}` : 'km');
    resetWarnings();
  }
  form.querySelectorAll('[name="vehicleId"]').forEach((el) => el.addEventListener('change', onVehicleChange));
  await onVehicleChange();

  // ---- quantity / price / total: fill in the third from the other two ----
  const typed = new Set(AMOUNT_FIELDS.filter((f) => e[f] !== '' && e[f] !== null && e[f] !== undefined && !(e.calculated || []).includes(f)));
  let computed = (e.calculated || []).find((f) => AMOUNT_FIELDS.includes(f)) || null;
  markComputed();

  function markComputed() {
    AMOUNT_FIELDS.forEach((f) => input(f).classList.toggle('is-calc', f === computed));
    const names = { quantity: 'Fuel quantity', pricePerUnit: 'Price', totalAmount: 'Total' };
    calcNote.hidden = !computed;
    calcNote.textContent = computed ? `${names[computed]} is calculated from the other two values. Type over it to change it.` : '';
  }

  for (const f of AMOUNT_FIELDS) {
    input(f).addEventListener('input', () => {
      if (f === computed) computed = null;
      if (input(f).value.trim()) typed.add(f); else typed.delete(f);
      const values = Object.fromEntries(AMOUNT_FIELDS.map((k) => [k, input(k).value]));
      const r = deriveAmounts(values, typed);
      if (r) {
        input(r.field).value = r.value.toFixed(2);
        computed = r.field;
      } else if (computed && !typed.has(computed)) {
        input(computed).value = '';
        computed = null;
      }
      markComputed();
    });
  }

  form.addEventListener('input', (ev) => { if (ev.target.name !== 'vehicleId') resetWarnings(); });

  function warningText(w) {
    switch (w.code) {
      case 'odometer-lower': return `This reading is lower than the previous fill (${fmt.km(w.previous.odometer)} on ${fmt.date(w.previous.date)}).`;
      case 'odometer-higher': return `This reading is higher than a later fill (${fmt.km(w.next.odometer)} on ${fmt.date(w.next.date)}).`;
      case 'below-initial': return `This reading is lower than the vehicle's starting odometer (${fmt.km(w.initial)}).`;
      case 'amount-mismatch': return 'Fuel × price does not match the total paid.';
      default: return 'Please check this entry.';
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const num = (name) => toNum(fd.get(name));
    const data = {
      id: editing?.id,
      vehicleId: fd.get('vehicleId'),
      date: fd.get('date'),
      quantity: num('quantity'),
      pricePerUnit: num('pricePerUnit'),
      totalAmount: num('totalAmount'),
      odometer: num('odometer'),
      fullTank: fd.get('fullTank') === null ? null : fd.get('fullTank') === 'yes',
      station: fd.get('station') || '',
      notes: fd.get('notes') || '',
      calculated: computed ? [computed] : [],
    };
    // Text that is not a number becomes a clear field error rather than a silent zero.
    const notNumber = {};
    for (const f of ['quantity', 'pricePerUnit', 'totalAmount', 'odometer']) {
      if (Number.isNaN(data[f])) notNumber[f] = 'Enter numbers only, like 5.25.';
    }
    if (Object.keys(notNumber).length) { showFieldErrors(form, notNumber); return; }

    const vehicle = pick(data.vehicleId);
    const { errors, warnings } = validateEntry(data, { vehicle, entries: vehicleEntries, today: todayStr(), odometerOptional: true });
    if (data.fullTank === null) errors.fullTank = 'Choose Yes or No.';
    if (errors.station || errors.notes) form.querySelector('details').open = true;
    if (!showFieldErrors(form, errors)) return;

    if (warnings.length && !warningsAccepted) {
      warnBox.innerHTML = `${icon('warn')}<div><p><strong>Check before saving</strong></p>${warnings.map((w) => `<p>${esc(warningText(w))}</p>`).join('')}<p>Fix the values, or tap Save anyway. Mileage skips stretches with odometer problems.</p></div>`;
      warnBox.hidden = false;
      warningsAccepted = true;
      submit.textContent = 'Save anyway';
      warnBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    await busy(submit, 'Saving…', async () => {
      try {
        const saved = await store.saveEntry(data);
        store.setPref('lastVehicle', data.vehicleId);
        toast(editing ? 'Fuel entry updated' : 'Fuel entry saved', 'ok', editing ? null : payAction(saved.totalAmount));
        navigate(`/?v=${encodeURIComponent(data.vehicleId)}`);
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });

  main.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this fuel entry?',
      message: `${fmt.date(editing.date)}: ${fmt.moneyExact(editing.totalAmount)} at ${fmt.km(editing.odometer)}.`,
      confirmLabel: 'Delete entry',
    });
    if (!ok) return;
    try { await store.deleteEntry(editing.id); } catch (err) { toast(err.message, 'error'); return; }
    toast('Fuel entry deleted');
    navigate(`/history?v=${encodeURIComponent(editing.vehicleId)}`);
  });
}

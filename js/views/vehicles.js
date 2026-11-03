// My vehicles: list, add, edit, delete.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState, field, choices, showFieldErrors, busy, toast, confirmDialog, req } from '../ui.js';
import { VEHICLE_TYPES, FUEL_TYPES, LIMITS } from '../core/model.js';
import { intervalSettings, DEFAULT_INTERVALS } from '../core/reminders.js';
import { validateVehicle } from '../core/validate.js';
import { toNum } from '../core/calc.js';
import { analyseAll, vehicleSubtitle, sampleTag } from './shared.js';

export async function renderList(main) {
  const [vehicles, entries] = await Promise.all([store.listVehicles(), store.listEntries()]);
  if (!vehicles.length) {
    main.innerHTML = `
      <h1 class="page-title" tabindex="-1">My vehicles</h1>
      ${emptyState({
        title: 'No vehicles yet',
        text: 'Add each bike or car you want to track. Every vehicle keeps its own fuel history.',
        actions: `<a class="btn btn-primary" href="#/vehicles/new">${icon('plus')}Add a vehicle</a>`,
      })}`;
    return;
  }
  const analyses = analyseAll(vehicles, entries);
  const items = vehicles.map((v) => {
    const s = analyses.get(v.id).summary;
    const id = encodeURIComponent(v.id);
    return `
      <li class="vcard vcard-tap">
        <a class="vtile-link" href="#/?v=${id}" aria-label="${esc(v.nickname)} details"></a>
        <div class="vcard-head">
          <span class="vrow-icon">${icon(v.type)}</span>
          <div>
            <h2 class="vcard-name">${esc(v.nickname)} ${sampleTag(v)}</h2>
            <p class="vrow-sub">${vehicleSubtitle(v)}</p>
          </div>
        </div>
        <p class="vcard-meta">${fmt.km(s.latestOdometer)} · ${s.entryCount} ${s.entryCount === 1 ? 'fill' : 'fills'}</p>
        <div class="actions actions-tight vcard-actions">
          <a class="btn btn-primary btn-sm" href="#/fuel/new?v=${id}">${icon('plus')}Fuel</a>
          <a class="btn btn-sm" href="#/service/add?v=${id}">${icon('plus')}Service</a>
        </div>
      </li>`;
  }).join('');

  main.innerHTML = `
    <div class="title-row">
      <h1 class="page-title" tabindex="-1">My vehicles</h1>
      <a class="btn btn-sm" href="#/vehicles/new">${icon('plus')}Add vehicle</a>
    </div>
    <ul class="vcards">${items}</ul>`;
}

export async function renderForm(main, { params, query, navigate }) {
  const editing = params[0] ? await store.getVehicle(params[0]) : null;
  if (params[0] && !editing) {
    main.innerHTML = `<h1 class="page-title" tabindex="-1">Vehicle not found</h1><p>It may have been deleted. <a href="#/vehicles">Back to My vehicles</a></p>`;
    return;
  }
  const v = editing || { nickname: '', type: 'two', fuelType: 'petrol', make: '', model: '', registration: '', initialOdometer: '' };
  const entryCount = editing ? (await store.listEntries(editing.id)).length : 0;

  const typeOptions = Object.entries(VEHICLE_TYPES).map(([value, t]) => ({ value, label: t.label }));
  const fuelOptions = Object.entries(FUEL_TYPES).map(([value, f]) => ({ value, label: f.label, disabled: !f.enabled, note: f.enabled ? '' : 'Coming later' }));

  main.innerHTML = `
    <a class="back" href="${editing ? `#/?v=${encodeURIComponent(editing.id)}` : '#/vehicles'}">${icon('back')}${editing ? esc(editing.nickname) : 'My vehicles'}</a>
    <h1 class="page-title" tabindex="-1">${editing ? 'Edit vehicle' : 'Add a vehicle'}</h1>
    <form class="form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${field('nickname', req('Name'), `<input id="nickname" name="nickname" type="text" maxlength="${LIMITS.nicknameMax}" autocomplete="off" required value="${esc(v.nickname)}" placeholder="My bike">`)}
      ${choices('type', req('Vehicle type'), typeOptions, v.type)}
      ${choices('fuelType', req('Fuel'), fuelOptions, v.fuelType)}
      ${field('initialOdometer', 'Odometer reading (km, optional)', `<input id="initialOdometer" name="initialOdometer" type="text" inputmode="numeric" autocomplete="off" value="${esc(v.initialOdometer ?? '')}" placeholder="12500">`, 'Optional. Your first fuel or service entry records the odometer anyway.')}
      <details class="optional"${v.make || v.model || v.registration ? ' open' : ''}>
        <summary>Make, model and registration (optional)</summary>
        ${field('make', 'Make', `<input id="make" name="make" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" value="${esc(v.make)}" placeholder="Honda">`)}
        ${field('model', 'Model', `<input id="model" name="model" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" value="${esc(v.model)}" placeholder="Activa 6G">`)}
        ${field('registration', 'Registration number', `<input id="registration" name="registration" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" autocapitalize="characters" value="${esc(v.registration)}">`, 'Only if you find it useful. It stays private.')}
      </details>
      <details class="optional" id="intervals"${query?.get('section') === 'intervals' ? ' open' : ''}>
        <summary>Service reminder intervals (optional)</summary>
        <p class="hint">GaadiKhata's general guide, counted from your last service. Change them to suit your vehicle. A service centre's own recommendation is kept separately.</p>
        ${['routine', 'oil'].map((k) => {
          const c = intervalSettings({ ...v, type: v.type || 'two' })[k];
          const label = k === 'routine' ? 'Routine service' : 'Engine oil change';
          return `<fieldset class="interval" data-kind="${k}">
            <legend>${label}</legend>
            <label class="item-opt"><input type="checkbox" name="${k}-on"${c.enabled ? ' checked' : ''}> Remind me</label>
            <div class="grid-2">
              ${field(`${k}-months`, 'Every (months)', `<input id="${k}-months" name="${k}-months" type="text" inputmode="numeric" value="${c.months}">`)}
              ${field(`${k}-km`, 'Or every (km)', `<input id="${k}-km" name="${k}-km" type="text" inputmode="numeric" value="${c.km}">`)}
            </div>
          </fieldset>`;
        }).join('')}
      </details>
      ${editing ? `<p class="muted">Added on ${fmt.date(editing.createdAt.slice(0, 10))}</p>` : ''}
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">${editing ? 'Save changes' : 'Add vehicle'}</button>
      </div>
    </form>
    ${editing ? `
      <section class="danger">
        <h2>Delete this vehicle</h2>
        <p>This also deletes its ${entryCount} fuel ${entryCount === 1 ? 'entry' : 'entries'}. It cannot be undone.</p>
        <button class="btn btn-danger" type="button" data-action="delete">Delete vehicle</button>
      </section>` : ''}`;

  const form = main.querySelector('form');
  if (query?.get('section') === 'intervals') setTimeout(() => main.querySelector('#intervals')?.scrollIntoView({ block: 'start' }), 50);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const data = {
      id: editing?.id,
      nickname: (fd.get('nickname') || '').trim(),
      type: fd.get('type'),
      fuelType: fd.get('fuelType'),
      initialOdometer: toNum(fd.get('initialOdometer')),
      make: fd.get('make') || '',
      model: fd.get('model') || '',
      registration: fd.get('registration') || '',
    };
    if (Number.isNaN(data.initialOdometer)) data.initialOdometer = -1;
    // Reminder intervals: saved only when they differ from the defaults for this vehicle type
    const defaults = DEFAULT_INTERVALS[data.type] || DEFAULT_INTERVALS.four;
    const reminderSettings = {};
    for (const k of ['routine', 'oil']) {
      const months = toNum(fd.get(`${k}-months`));
      const km = toNum(fd.get(`${k}-km`));
      const on = fd.get(`${k}-on`) === 'on';
      const clean = { enabled: on, months: months > 0 && months <= 60 ? Math.round(months) : defaults[k].months, km: km > 0 && km <= 100000 ? Math.round(km) : defaults[k].km };
      if (!on || clean.months !== defaults[k].months || clean.km !== defaults[k].km) reminderSettings[k] = clean;
    }
    data.reminderSettings = Object.keys(reminderSettings).length ? reminderSettings : (editing?.reminderSettings ? {} : null);
    const errors = validateVehicle(data);
    if (errors.make || errors.model || errors.registration) form.querySelector('details').open = true;
    if (!showFieldErrors(form, errors)) return;
    await busy(form.querySelector('[type="submit"]'), 'Saving…', async () => {
      try {
        const saved = await store.saveVehicle(data);
        toast(editing ? 'Vehicle updated' : 'Vehicle added');
        navigate(editing ? `/?v=${encodeURIComponent(saved.id)}` : '/vehicles');
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });

  main.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Delete ${editing.nickname}?`,
      message: `The vehicle and its ${entryCount} fuel ${entryCount === 1 ? 'entry' : 'entries'} will be removed from this device.`,
      confirmLabel: 'Delete vehicle',
      typeToConfirm: entryCount ? 'delete' : '',
    });
    if (!ok) return;
    try { await store.deleteVehicle(editing.id); } catch (err) { toast(err.message, 'error'); return; }
    toast('Vehicle deleted');
    navigate('/vehicles');
  });
}

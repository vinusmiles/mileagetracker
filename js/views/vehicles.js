// My vehicles: list, add, edit, delete.

import * as store from '../store.js';
import { esc, fmt, icon, emptyState, field, choices, showFieldErrors, busy, toast, confirmDialog } from '../ui.js';
import { VEHICLE_TYPES, FUEL_TYPES, LIMITS } from '../core/model.js';
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
      <li class="vcard">
        <div class="vcard-head">
          <span class="vrow-icon">${icon(v.type)}</span>
          <div>
            <h2 class="vcard-name">${esc(v.nickname)} ${sampleTag(v)}</h2>
            <p class="vrow-sub">${vehicleSubtitle(v)}</p>
          </div>
        </div>
        <dl class="facts facts-tight">
          <div><dt>Odometer</dt><dd>${fmt.km(s.latestOdometer)}</dd></div>
          <div><dt>Fuel fills</dt><dd>${s.entryCount}</dd></div>
          <div><dt>Added on</dt><dd>${fmt.date(v.createdAt.slice(0, 10))}</dd></div>
        </dl>
        <div class="actions actions-tight">
          <a class="btn btn-primary btn-sm" href="#/fuel/new?v=${id}">${icon('fuel')}Add fuel</a>
          <a class="btn btn-sm" href="#/?v=${id}">Details</a>
          <a class="btn btn-quiet btn-sm" href="#/vehicles/${id}/edit">Edit</a>
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

export async function renderForm(main, { params, navigate }) {
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
      ${field('nickname', 'Name', `<input id="nickname" name="nickname" type="text" maxlength="${LIMITS.nicknameMax}" autocomplete="off" required value="${esc(v.nickname)}" placeholder="My bike">`)}
      ${choices('type', 'Vehicle type', typeOptions, v.type)}
      ${choices('fuelType', 'Fuel', fuelOptions, v.fuelType)}
      ${field('initialOdometer', 'Odometer reading (km)', `<input id="initialOdometer" name="initialOdometer" type="text" inputmode="numeric" autocomplete="off" required value="${esc(v.initialOdometer)}" placeholder="12500">`, editing ? 'The reading when you added this vehicle.' : 'The reading on the vehicle today.')}
      <details class="optional"${v.make || v.model || v.registration ? ' open' : ''}>
        <summary>Make, model and registration (optional)</summary>
        ${field('make', 'Make', `<input id="make" name="make" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" value="${esc(v.make)}" placeholder="Honda">`)}
        ${field('model', 'Model', `<input id="model" name="model" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" value="${esc(v.model)}" placeholder="Activa 6G">`)}
        ${field('registration', 'Registration number', `<input id="registration" name="registration" type="text" maxlength="${LIMITS.textMax}" autocomplete="off" autocapitalize="characters" value="${esc(v.registration)}">`, 'Only if you find it useful. It stays private.')}
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
    await store.deleteVehicle(editing.id);
    toast('Vehicle deleted');
    navigate('/vehicles');
  });
}

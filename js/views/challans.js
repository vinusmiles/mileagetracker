// Traffic challans: a section on each vehicle page (check online + your records),
// and an add/edit form that can read a photo of the challan notice or SMS.

import * as store from '../store.js';
import { esc, fmt, icon, field, choices, showFieldErrors, busy, toast, confirmDialog, req } from '../ui.js';
import { portalsFor, challanTotals, validateChallan, findChallanDuplicate } from '../core/challans.js';
import { toNum } from '../core/calc.js';
import { todayStr } from '../core/dates.js';
import { preparePhoto, release, ImageError } from '../smart/images.js';
import { extractChallan, invoiceReaderIsDemo } from '../smart/invoice-extractor.js';

const enc = encodeURIComponent;

/** Section for the vehicle page. */
export function challansSection(vehicle, challans) {
  const t = challanTotals(challans);
  const portals = portalsFor(vehicle.registration);
  const rows = challans.slice(0, 3).map((c) => `
    <li><a class="row-link" href="#/challan/${enc(c.id)}/edit">
      <span class="row-date"><b>${c.date.slice(8, 10)}</b><span>${fmt.monthShort(c.date.slice(0, 7))}</span></span>
      <span class="row-title">${esc(c.offence || 'Traffic challan')}</span>
      <span class="row-amt"><b>${fmt.money(c.amount)}</b><span class="st ${c.status === 'paid' ? 'st-ok' : 'st-overdue'}">${c.status === 'paid' ? 'Paid' : 'Unpaid'}</span></span>
      <span class="row-sub">${esc([c.location, c.challanNumber].filter(Boolean).join(' · ') || fmt.date(c.date))}</span>
    </a></li>`).join('');
  return `
    <section class="block" id="challans">
      <div class="section-head"><h2>Challans</h2><a href="#/challan/new?v=${enc(vehicle.id)}">${icon('plus')} Add</a></div>
      ${t.count ? `<div class="summary-bar">
          ${t.unpaidCount ? `<div><b class="txt-red">${fmt.money(t.unpaidAmount)}</b> <span>unpaid (${t.unpaidCount})</span></div>` : '<div><b>All paid</b></div>'}
          ${t.paidCount ? `<div><b>${fmt.money(t.paidAmount)}</b> <span>paid</span></div>` : ''}
        </div>
        <ul class="rows">${rows}</ul>` : '<p class="muted">No challans recorded. Good driving!</p>'}
      <details class="filter-box challan-check">
        <summary>Check for new challans online <span>Official sites ›</span></summary>
        <div class="challan-check-body">
          ${vehicle.registration
            ? `<p>Your number: <strong data-reg>${esc(vehicle.registration)}</strong> <button type="button" class="link-btn" data-copy-reg>Copy</button></p>`
            : `<p class="muted">Add the registration number in <a href="#/vehicles/${enc(vehicle.id)}/edit">Edit vehicle</a> to copy it here.</p>`}
          <p class="hint">The official site asks for the number and a captcha, then shows any challans. Add what you find here.</p>
          <div class="portal-links">${portals.map((p, i) => `<a class="btn btn-sm${i === 0 ? ' btn-primary' : ''}" href="${p.url}" target="_blank" rel="noopener">${esc(p.name)} ↗</a>`).join('')}</div>
        </div>
      </details>
    </section>`;
}

/** Wire the copy button inside the section. */
export function bindChallansSection(main) {
  main.querySelector('[data-copy-reg]')?.addEventListener('click', async (ev) => {
    const reg = main.querySelector('[data-reg]')?.textContent || '';
    try { await navigator.clipboard.writeText(reg.replace(/\s+/g, '')); toast('Number copied. Paste it on the challan site.'); } catch { toast(`Your number: ${reg}`); }
    ev.target.textContent = 'Copied';
  });
}

// ---------------------------------------------------------------------------
// Add / edit (#/challan/new?v=id, #/challan/:id/edit)
// ---------------------------------------------------------------------------

export async function renderForm(main, { params, query, navigate }) {
  const editing = params[0] ? await store.getChallan(params[0]) : null;
  if (params[0] && !editing) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Challan not found</h1><p><a href="#/">Back to Dashboard</a></p>'; return; }
  const vehicles = await store.listVehicles();
  const vehicle = vehicles.find((v) => v.id === (editing?.vehicleId || query.get('v'))) || vehicles[0];
  if (!vehicle) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Add a vehicle first</h1><p><a href="#/vehicles/new">Add a vehicle</a></p>'; return; }
  const c = editing || { vehicleId: vehicle.id, date: todayStr(), amount: null, status: null, offence: '', challanNumber: '', location: '', paidDate: null, notes: '' };
  const val = (x) => (x === null || x === undefined ? '' : esc(x));
  let photo = null;
  let source = editing?.source || 'manual';
  const demo = invoiceReaderIsDemo();

  main.innerHTML = `
    <a class="back" href="#/?v=${enc(vehicle.id)}">${icon('back')}${esc(vehicle.nickname)}</a>
    <h1 class="page-title" tabindex="-1">${editing ? 'Edit challan' : 'Add challan'}</h1>
    ${editing ? '' : `
      <section class="photo-slot" data-slot="challan">
        <div class="slot-head"><div><h2>${icon('scan')} Scan the challan</h2><p class="hint">Photo of the notice, or a screenshot of the SMS or challan page${demo ? ' (demo reader: values are made up)' : ''}</p></div></div>
        <div class="photo-actions">
          <label class="btn btn-sm file-btn btn-camera">${icon('camera')}Take photo<input type="file" accept="image/*" capture="environment" data-pick></label>
          <label class="btn btn-sm file-btn btn-upload">${icon('image')}Upload<input type="file" accept="image/jpeg,image/png,image/webp" data-pick></label>
        </div>
        <p class="hint" data-scan-status hidden></p>
        <p class="field-error" data-scan-error hidden></p>
      </section>
      <div class="or-divider">OR TYPE IT</div>`}
    <form class="form" novalidate>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      <div class="grid-2">
        ${field('date', req('Challan date'), `<input id="date" name="date" type="date" max="${todayStr()}" value="${val(c.date)}">`)}
        ${field('amount', req('Fine amount (₹)'), `<input id="amount" name="amount" type="text" inputmode="decimal" autocomplete="off" value="${val(c.amount)}">`)}
      </div>
      ${field('offence', 'Offence', `<input id="offence" name="offence" type="text" maxlength="160" placeholder="e.g. Riding without helmet" value="${val(c.offence)}">`)}
      ${choices('status', req('Status'), [{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }], c.status)}
      <div data-paid${c.status === 'paid' ? '' : ' hidden'}>${field('paidDate', 'Paid on', `<input id="paidDate" name="paidDate" type="date" max="${todayStr()}" value="${val(c.paidDate)}">`)}</div>
      <details class="optional"${c.challanNumber || c.location || c.notes ? ' open' : ''}>
        <summary>More details (optional)</summary>
        ${field('challanNumber', 'Challan number', `<input id="challanNumber" name="challanNumber" type="text" maxlength="60" value="${val(c.challanNumber)}">`)}
        ${field('location', 'Location', `<input id="location" name="location" type="text" maxlength="160" value="${val(c.location)}">`)}
        ${field('notes', 'Notes', `<textarea id="notes" name="notes" rows="2" maxlength="500">${val(c.notes)}</textarea>`)}
      </details>
      <div class="notice notice-warn" data-warnings role="alert" hidden></div>
      <div class="form-actions"><button class="btn btn-primary btn-block" type="submit">${icon('check')}${editing ? 'Save changes' : 'Save challan'}</button></div>
    </form>
    ${editing ? `<section class="danger"><h2>Delete this challan</h2><button class="btn btn-danger" type="button" data-delete>Delete challan</button></section>` : ''}`;

  const form = main.querySelector('form');
  const set = (name, v) => { if (v !== null && v !== undefined && form.elements[name]) form.elements[name].value = v; };
  form.addEventListener('change', (ev) => { if (ev.target.name === 'status') form.querySelector('[data-paid]').hidden = ev.target.value !== 'paid'; });

  main.querySelector('[data-slot="challan"]')?.addEventListener('change', async (ev) => {
    if (!ev.target.hasAttribute('data-pick')) return;
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const status = main.querySelector('[data-scan-status]');
    const err = main.querySelector('[data-scan-error]');
    err.hidden = true; status.hidden = false; status.textContent = 'Reading the challan…';
    try {
      release(photo);
      photo = await preparePhoto(file, { maxEdgePx: 1600, quality: 0.8 });
      const r = await extractChallan({ pages: [photo] });
      set('date', r.date); set('amount', r.amount); set('offence', r.offence); set('challanNumber', r.challanNumber); set('location', r.location);
      if (r.status) { form.querySelector(`input[name="status"][value="${r.status}"]`).checked = true; form.querySelector('[data-paid]').hidden = r.status !== 'paid'; }
      if (r.challanNumber || r.location) form.querySelector('details.optional').open = true;
      source = 'photo';
      status.textContent = demo ? 'Demo values filled in. Replace them with the real ones.' : 'Details filled in from the photo. Check them, then save.';
    } catch (e) {
      status.hidden = true;
      err.textContent = e instanceof ImageError ? e.message : `Could not read it: ${(e.message || 'error').replace(/\.+$/, '')}. Type the details below.`;
      err.hidden = false;
    } finally {
      release(photo); photo = null;
    }
  });

  let accepted = false;
  form.addEventListener('input', () => { accepted = false; form.querySelector('[data-warnings]').hidden = true; });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const d = {
      id: editing?.id, vehicleId: vehicle.id, date: fd.get('date'), amount: toNum(fd.get('amount')), status: fd.get('status'),
      paidDate: fd.get('paidDate') || null, offence: fd.get('offence'), challanNumber: fd.get('challanNumber'), location: fd.get('location'), notes: fd.get('notes'), source,
    };
    const errors = validateChallan({ ...d, amount: Number.isNaN(d.amount) ? -1 : d.amount }, todayStr());
    if (!showFieldErrors(form, errors)) return;
    const dup = findChallanDuplicate(d, await store.listChallans(vehicle.id));
    if (dup && !accepted) {
      const w = form.querySelector('[data-warnings]');
      w.innerHTML = `${icon('warn')}<div><p><strong>This challan may already be saved</strong> (${fmt.date(dup.date)}, ${fmt.money(dup.amount)}). <a href="#/challan/${enc(dup.id)}/edit">Review it</a>, or tap Save again.</p></div>`;
      w.hidden = false; accepted = true; return;
    }
    await busy(form.querySelector('[type="submit"]'), 'Saving…', async () => {
      try { await store.saveChallan(d); } catch (err) { showFieldErrors(form, { _form: err.message }); return; }
      toast(editing ? 'Challan updated' : 'Challan saved');
      navigate(`/?v=${enc(vehicle.id)}`);
    });
  });

  main.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Delete this challan?', message: `${fmt.date(editing.date)}, ${fmt.money(editing.amount)}.`, confirmLabel: 'Delete challan' }))) return;
    try { await store.deleteChallan(editing.id); } catch (err) { toast(err.message, 'error'); return; }
    toast('Challan deleted'); navigate(`/?v=${enc(vehicle.id)}`);
  });
}

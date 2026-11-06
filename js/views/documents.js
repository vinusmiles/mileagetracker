// Documents: copies of RC, insurance, pollution, driving licence and others, with
// expiry reminders. Beta. Files are loaded only when opened.

import * as store from '../store.js';
import { betaOn } from '../beta.js';
import { esc, fmt, icon, ricon, field, showFieldErrors, busy, toast, confirmDialog, req, openImageViewer } from '../ui.js';
import { docLabel, documentSlots, expiryStatus, fileProblem, looksLikePdf, MAX_FILE_BYTES, typesFor, validateDocument } from '../core/documents.js';
import { todayStr } from '../core/dates.js';
import { preparePhoto, release, ImageError } from '../smart/images.js';

const enc = encodeURIComponent;
const CHIP = { expired: ['Expired', 'st-overdue'], soon: ['Expiring soon', 'st-soon'] };

function chip(doc, today) {
  if (!doc) return '<span class="st st-soon">Missing</span>';
  const [label, cls] = CHIP[expiryStatus(doc, today)] || ['Added', 'st-ok'];
  return `<span class="st ${cls}">${label}</span>`;
}

function slotRow({ type, label, doc }, vehicleId, today) {
  const href = doc ? `#/document/${enc(doc.id)}` : `#/document/new?type=${type}${vehicleId ? `&v=${enc(vehicleId)}` : ''}`;
  const sub = doc?.expiryDate ? `Valid till ${fmt.date(doc.expiryDate)}` : doc ? 'No expiry date' : 'Tap to add';
  return `<li><a class="remind-row" href="${href}">${ricon('document', 'blue')}<span><strong>${esc(label)}</strong><small>${esc(sub)}</small></span>${chip(doc, today)}</a></li>`;
}

const slotList = (docs, vehicleId, today) => `<ul class="remind-list">${documentSlots(docs, vehicleId).map((s) => slotRow(s, vehicleId, today)).join('')}</ul>`;

/** Section for the vehicle page. */
export function documentsSection(vehicle, docs) {
  if (!betaOn) return '';
  return `
    <section class="block" id="documents">
      <div class="section-head"><h2>Documents</h2><a href="#/document/new?v=${enc(vehicle.id)}">${icon('plus')} Add</a></div>
      ${slotList(docs, vehicle.id, todayStr())}
    </section>`;
}

export async function renderList(main, { navigate }) {
  if (!betaOn) { navigate('/', { replace: true }); return; }
  const [vehicles, docs] = await Promise.all([store.listVehicles(), store.listDocuments()]);
  const today = todayStr();
  main.innerHTML = `
    <a class="back" href="#/more">${icon('back')}More</a>
    <h1 class="page-title" tabindex="-1">Documents</h1>
    ${store.canKeepImages() ? '' : '<p class="notice notice-warn notice-slim" role="status">Sign in to keep documents.</p>'}
    <a class="btn btn-primary btn-block doc-add" href="#/document/new">${icon('plus')}Add document</a>
    <section class="block"><h2>My documents</h2>${slotList(docs, null, today)}</section>
    ${vehicles.map((v) => `<section class="block"><h2>${esc(v.nickname)}</h2>${slotList(docs, v.id, today)}</section>`).join('')}
    <p class="hint">Only you can open these files. Keep a copy handy, but carry your original documents too.</p>`;
}

/** Shrink a photo, or read a PDF. Returns { bytes, mimeType, fileName, size }. */
async function readFile(file) {
  const wrongType = fileProblem({ size: 1, mimeType: file.type });
  if (wrongType) throw new ImageError(wrongType);
  if (file.type === 'application/pdf') {
    const problem = fileProblem({ size: file.size, mimeType: file.type });
    if (problem) throw new ImageError(problem);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) throw new ImageError('This file does not look like a PDF.');
    return { bytes, mimeType: file.type, fileName: file.name, size: bytes.length };
  }
  let photo = null;
  for (const [maxEdgePx, quality] of [[1800, 0.8], [1400, 0.65], [1000, 0.55]]) {
    release(photo);
    photo = await preparePhoto(file, { maxEdgePx, quality });
    if (photo.bytes <= MAX_FILE_BYTES) break;
  }
  try {
    const problem = fileProblem({ size: photo.bytes, mimeType: 'image/jpeg' });
    if (problem) throw new ImageError(problem);
    return { bytes: new Uint8Array(await photo.blob.arrayBuffer()), mimeType: 'image/jpeg', fileName: file.name || 'photo.jpg', size: photo.bytes };
  } finally {
    release(photo);
  }
}

const sizeText = (n) => (n >= 100000 ? `${(n / 1000000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export async function renderForm(main, { params, query, navigate }) {
  if (!betaOn) { navigate('/', { replace: true }); return; }
  const editing = params[0] ? await store.getDocument(params[0]) : null;
  if (params[0] && !editing) { navigate('/documents', { replace: true }); return; }
  const vehicles = await store.listVehicles();
  const asked = vehicles.some((v) => v.id === query.get('v')) ? query.get('v') : '';
  const owner = editing ? editing.vehicleId || '' : asked;
  const type = editing?.type || query.get('type') || '';
  const back = editing ? `#/document/${enc(editing.id)}` : '#/documents';
  const typeOptions = (vid, chosen) => `<option value="">Choose</option>${typesFor(vid).map((t) => `<option value="${t.value}"${t.value === chosen ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}`;
  const ownerName = owner ? vehicles.find((v) => v.id === owner)?.nickname : 'Me';

  main.innerHTML = `
    <a class="back" href="${back}">${icon('back')}${editing ? esc(docLabel(editing)) : 'Documents'}</a>
    <h1 class="page-title" tabindex="-1">${editing ? 'Replace document' : 'Add document'}</h1>
    <form class="form" novalidate>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      ${editing ? `<p class="muted">${esc(ownerName || '')}</p>` : `
        ${field('vehicleId', req('Belongs to'), `<select id="vehicleId" name="vehicleId"><option value="">Me</option>${vehicles.map((v) => `<option value="${esc(v.id)}"${v.id === owner ? ' selected' : ''}>${esc(v.nickname)}</option>`).join('')}</select>`)}
        ${field('type', req('Document'), `<select id="type" name="type">${typeOptions(owner, type)}</select>`)}`}
      <div data-title${type === 'other' ? '' : ' hidden'}>${field('title', req('Name'), `<input id="title" name="title" type="text" maxlength="60" autocomplete="off" value="${esc(editing?.title || '')}">`)}</div>
      ${field('expiryDate', 'Expiry date', `<input id="expiryDate" name="expiryDate" type="date" value="${esc(editing?.expiryDate || '')}">`, 'We remind you 30 days before.')}
      <div class="field" data-field="file">
        <p class="doc-label">${editing ? 'New file (optional)' : req('File')}</p>
        <div class="doc-pick">
          <label class="btn">${icon('camera')}Take photo<input type="file" accept="image/*" capture="environment" data-file></label>
          <label class="btn">${icon('image')}Upload file<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-file></label>
        </div>
        <p class="hint" data-file-name>Photo or PDF, up to 1 MB.</p>
        <p class="field-error" id="file-error" hidden></p>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Save</button>
    </form>`;

  const form = main.querySelector('form');
  const submit = form.querySelector('[type="submit"]');
  const nameLine = form.querySelector('[data-file-name]');
  let picked = null;

  const showTitle = () => { form.querySelector('[data-title]').hidden = (editing?.type || form.elements.type.value) !== 'other'; };
  form.elements.vehicleId?.addEventListener('change', () => { form.elements.type.innerHTML = typeOptions(form.elements.vehicleId.value, ''); showTitle(); });
  form.elements.type?.addEventListener('change', showTitle);

  form.querySelectorAll('[data-file]').forEach((input) => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    picked = null;
    showFieldErrors(form, {});
    nameLine.textContent = 'Preparing…';
    submit.disabled = true;
    try {
      picked = await readFile(file);
      nameLine.textContent = `${picked.fileName} · ${sizeText(picked.size)}`;
    } catch (err) {
      nameLine.textContent = 'Photo or PDF, up to 1 MB.';
      showFieldErrors(form, { file: err instanceof ImageError ? err.message : 'This file could not be opened. Try another one.' });
    } finally {
      submit.disabled = false;
      input.value = '';
    }
  }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const d = {
      id: editing?.id,
      vehicleId: editing ? editing.vehicleId : fd.get('vehicleId') || null,
      type: editing?.type || fd.get('type'),
      title: fd.get('title'),
      expiryDate: fd.get('expiryDate') || null,
    };
    const errors = validateDocument(d);
    if (!editing && !picked) errors.file = 'Add a photo or PDF.';
    if (!showFieldErrors(form, errors)) return;
    await busy(submit, 'Saving…', async () => {
      try {
        const saved = await store.saveDocument(d, picked);
        toast(editing ? 'Document updated' : 'Document saved');
        navigate(`/document/${enc(saved.id)}`);
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });
}

export async function renderDetail(main, { params, navigate }) {
  if (!betaOn) { navigate('/', { replace: true }); return; }
  const doc = await store.getDocument(params[0]);
  if (!doc) { navigate('/documents', { replace: true }); return; }
  const vehicle = doc.vehicleId ? await store.getVehicle(doc.vehicleId) : null;
  const today = todayStr();
  main.innerHTML = `
    <a class="back" href="#/documents">${icon('back')}Documents</a>
    <h1 class="page-title" tabindex="-1">${esc(docLabel(doc))}</h1>
    <section class="block doc-facts">
      <p>${esc(vehicle?.nickname || 'Me')} ${chip(doc, today)}</p>
      <p class="muted">${doc.expiryDate ? `Valid till ${esc(fmt.date(doc.expiryDate))}` : 'No expiry date'}</p>
      <p class="muted">${esc(doc.fileName)} · ${esc(sizeText(doc.fileSize))}</p>
    </section>
    <p class="form-error" role="alert" hidden></p>
    <div class="doc-actions">
      <button type="button" class="btn btn-primary" data-open>View</button>
      <a class="btn" href="#/document/${enc(doc.id)}/edit">Replace</a>
      <button type="button" class="btn doc-delete" data-delete>Delete</button>
    </div>`;

  const problem = main.querySelector('.form-error');
  const openBtn = main.querySelector('[data-open]');
  let url = null;
  openBtn.addEventListener('click', () => busy(openBtn, 'Opening…', async () => {
    problem.hidden = true;
    try {
      if (!url) {
        const file = await store.getDocumentFile(doc);
        url = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }));
        window.addEventListener('hashchange', () => URL.revokeObjectURL(url), { once: true });
      }
      if (doc.mimeType !== 'application/pdf') { openImageViewer([url], [docLabel(doc)], 0, openBtn); return; }
      if (!window.open(url, '_blank')) {
        const a = document.createElement('a');
        a.href = url; a.download = doc.fileName; a.click();
      }
    } catch (err) {
      problem.textContent = err.message || 'This file could not be opened.';
      problem.hidden = false;
    }
  }));

  main.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Delete ${docLabel(doc)}?`, message: 'The file is removed for good.' });
    if (!ok) return;
    try { await store.deleteDocument(doc.id); } catch (err) { toast(err.message, 'error'); return; }
    toast('Document deleted');
    navigate('/documents');
  });
}

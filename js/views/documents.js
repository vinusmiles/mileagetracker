// Documents: copies of RC, insurance, pollution, driving licence and medical certificate,
// front and back, with expiry reminders. Files are loaded only when opened.

import * as store from '../store.js';
import { esc, fmt, icon, field, showFieldErrors, busy, toast, confirmDialog, req, openImageViewer } from '../ui.js';
import { DOC_TYPES, docLabel, documentSlots, expiryStatus, fileProblem, looksLikePdf, MAX_FILE_BYTES, sideInfo, sideName, sidesFor, typesFor, validateDocument } from '../core/documents.js';
import { todayStr } from '../core/dates.js';
import { preparePhoto, release, ImageError } from '../smart/images.js';
import { cameraOverlay } from './smart.js';

const enc = encodeURIComponent;

function chip(doc, today) {
  const status = expiryStatus(doc, today);
  if (status === 'expired') return '<span class="st st-overdue">Expired</span>';
  if (status === 'soon') return '<span class="st st-soon">Expiring soon</span>';
  return '<span class="st st-ok">Added</span>';
}

/** Green when added, yellow when missing, red when expired. */
function slotTile({ type, label, doc }, vehicleId, today) {
  if (!doc) {
    return `<a class="doc-tile doc-missing" href="#/document/new?type=${type}${vehicleId ? `&v=${enc(vehicleId)}` : ''}" aria-label="${esc(label)}: missing, add it">${esc(label)}</a>`;
  }
  const status = expiryStatus(doc, today);
  return `<a class="doc-tile ${status === 'expired' ? 'doc-expired' : 'doc-added'}" href="#/document/${enc(doc.id)}" aria-label="${esc(label)}: ${status === 'expired' ? 'expired' : 'added'}">${esc(label)}</a>`;
}

const slotTiles = (slots, vehicleId, today) => `<div class="doc-tiles">${slots.map((s) => slotTile(s, vehicleId, today)).join('')}</div>`;

function group(title, docs, vehicleId, today, open) {
  const slots = documentSlots(docs, vehicleId);
  const added = slots.filter((s) => s.doc).length;
  return `
    <details class="doc-group"${open ? ' open' : ''}>
      <summary><strong>${esc(title)}</strong><span>${added} of ${slots.length} added</span></summary>
      ${slotTiles(slots, vehicleId, today)}
    </details>`;
}

/** Section for the vehicle page. */
export function documentsSection(vehicle, docs) {
  return `
    <section class="block" id="documents">
      <div class="section-head"><h2>Documents</h2><a href="#/documents?v=${enc(vehicle.id)}">See all</a></div>
      ${slotTiles(documentSlots(docs, vehicle.id), vehicle.id, todayStr())}
    </section>`;
}

export async function renderList(main, { query, navigate }) {
  const [vehicles, docs] = await Promise.all([store.listVehicles(), store.listDocuments()]);
  const today = todayStr();
  const asked = query.get('v');
  main.innerHTML = `
    <a class="back" href="#/more">${icon('back')}More</a>
    <h1 class="page-title" tabindex="-1">Documents</h1>
    ${store.canKeepImages() ? '' : '<p class="notice notice-warn notice-slim" role="status">Sign in to keep documents.</p>'}
    <a class="btn btn-primary btn-block doc-add" href="#/document/new${asked ? `?v=${enc(asked)}` : ''}">${icon('plus')}Add document</a>
    ${group('My documents', docs, null, today, false)}
    ${vehicles.map((v) => group(v.nickname, docs, v.id, today, v.id === asked || vehicles.length === 1)).join('')}
    <p class="hint">Only you can open these files. Keep a copy handy, but carry your original documents too.</p>`;
  main.querySelector('.doc-group[open]')?.scrollIntoView({ block: 'nearest' });
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
  const editing = params[0] ? await store.getDocument(params[0]) : null;
  if (params[0] && !editing) { navigate('/documents', { replace: true }); return; }
  const vehicles = await store.listVehicles();
  const asked = vehicles.some((v) => v.id === query.get('v')) ? query.get('v') : '';
  const owner = editing ? editing.vehicleId || '' : asked;
  const type = editing?.type || query.get('type') || '';
  const back = editing ? `#/document/${enc(editing.id)}` : '#/documents';
  const typeOptions = (vid, chosen) => `<option value="">Choose</option>${typesFor(vid).map((t) => `<option value="${t.value}"${t.value === chosen ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}`;
  const ownerName = owner ? vehicles.find((v) => v.id === owner)?.nickname : 'Me';
  const sideTile = (side) => `<button type="button" class="doc-side" data-side="${side}">${icon('camera')}<strong data-side-name></strong><small data-side-note></small></button>`;

  main.innerHTML = `
    <a class="back" href="${back}">${icon('back')}${editing ? esc(docLabel(editing)) : 'Documents'}</a>
    <h1 class="page-title" tabindex="-1">${editing ? `Replace ${esc(docLabel(editing))}` : 'Add document'}</h1>
    <form class="form" novalidate>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      ${editing ? `<p class="muted">${esc(ownerName || '')}</p>` : `
        ${field('vehicleId', req('Belongs to'), `<select id="vehicleId" name="vehicleId"><option value="">Me</option>${vehicles.map((v) => `<option value="${esc(v.id)}"${v.id === owner ? ' selected' : ''}>${esc(v.nickname)}</option>`).join('')}</select>`)}
        ${field('type', req('Document'), `<select id="type" name="type">${typeOptions(owner, type)}</select>`)}`}
      <div data-title${type === 'other' ? '' : ' hidden'}>${field('title', req('Name'), `<input id="title" name="title" type="text" maxlength="60" autocomplete="off" value="${esc(editing?.title || '')}">`)}</div>
      ${field('expiryDate', 'Expiry date', `<input id="expiryDate" name="expiryDate" type="date" value="${esc(editing?.expiryDate || '')}">`, 'We remind you 30 days before.')}
      <div class="field" data-field="file">
        <div class="doc-sides">${['front', 'back', 'page3', 'page4'].map(sideTile).join('')}</div>
        <p class="hint">Tap to open the camera. Use Upload there for a photo or PDF, up to 1 MB each.</p>
        <p class="field-error" id="file-error" hidden></p>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Save</button>
    </form>`;

  const form = main.querySelector('form');
  const submit = form.querySelector('[type="submit"]');
  const picked = {};
  const currentType = () => editing?.type || form.elements.type.value;

  const paint = () => {
    const sides = sidesFor(currentType());
    form.querySelector('[data-title]').hidden = currentType() !== 'other';
    form.querySelectorAll('[data-side]').forEach((tile) => {
      const side = tile.dataset.side;
      tile.hidden = !sides.includes(side);
      const stored = editing ? sideInfo(editing, side) : null;
      tile.querySelector('[data-side-name]').textContent = sideName(currentType(), side) || (side === 'front' ? 'Front' : 'Back');
      tile.querySelector('[data-side-note]').textContent = picked[side] ? `${picked[side].fileName} · ${sizeText(picked[side].size)}` : stored ? 'Saved · Tap to replace' : '';
      tile.classList.toggle('doc-side-done', !!picked[side] || !!stored);
    });
  };
  paint();

  form.elements.vehicleId?.addEventListener('change', () => { form.elements.type.innerHTML = typeOptions(form.elements.vehicleId.value, ''); paint(); });
  form.elements.type?.addEventListener('change', paint);

  form.querySelectorAll('[data-side]').forEach((tile) => tile.addEventListener('click', async () => {
    const side = tile.dataset.side;
    const result = await cameraOverlay(main, {
      title: `${editing ? docLabel(editing) : DOC_TYPES[currentType()]?.label || 'Document'}: ${(sideName(currentType(), side) || 'front').toLowerCase()}`,
      hint: 'Fit the document inside the frame',
      allowManual: false,
      prepare: readFile,
      uploadAccept: 'image/jpeg,image/png,image/webp,application/pdf',
    });
    if (result?.bytes) { picked[side] = result; showFieldErrors(form, {}); paint(); }
  }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const d = {
      id: editing?.id,
      vehicleId: editing ? editing.vehicleId : fd.get('vehicleId') || null,
      type: currentType(),
      title: fd.get('title'),
      expiryDate: fd.get('expiryDate') || null,
    };
    const errors = validateDocument(d);
    if (!editing && !picked.front) errors.file = `Add ${(sideName(d.type, 'front') || 'the front').toLowerCase()}.`;
    if (!showFieldErrors(form, errors)) return;
    const files = Object.fromEntries(sidesFor(d.type).map((side) => [side, picked[side]]).filter(([, f]) => f));
    await busy(submit, 'Saving…', async () => {
      try {
        const saved = await store.saveDocument(d, files);
        toast(editing ? 'Document updated' : 'Document saved');
        navigate(`/document/${enc(saved.id)}`);
      } catch (err) {
        showFieldErrors(form, { _form: err.message });
      }
    });
  });
}

export async function renderDetail(main, { params, navigate }) {
  const doc = await store.getDocument(params[0]);
  if (!doc) { navigate('/documents', { replace: true }); return; }
  const vehicle = doc.vehicleId ? await store.getVehicle(doc.vehicleId) : null;
  const today = todayStr();
  const stored = sidesFor(doc.type).filter((side) => sideInfo(doc, side));
  main.innerHTML = `
    <a class="back" href="#/documents${doc.vehicleId ? `?v=${enc(doc.vehicleId)}` : ''}">${icon('back')}Documents</a>
    <h1 class="page-title" tabindex="-1">${esc(docLabel(doc))}</h1>
    <section class="block doc-facts">
      <p>${esc(vehicle?.nickname || 'Me')} ${chip(doc, today)}</p>
      <p class="muted">${doc.expiryDate ? `Valid till ${esc(fmt.date(doc.expiryDate))}` : 'No expiry date'}</p>
    </section>
    <p class="form-error" role="alert" hidden></p>
    <div class="doc-actions">
      ${stored.map((side) => `<button type="button" class="btn btn-primary" data-open="${side}">${stored.length > 1 ? `View ${esc((sideName(doc.type, side) || side).toLowerCase())}` : 'View'}</button>`).join('')}
      <a class="btn" href="#/document/${enc(doc.id)}/edit">Replace</a>
      <button type="button" class="btn btn-danger" data-delete>Delete</button>
    </div>`;

  const problem = main.querySelector('.form-error');
  const urls = {};
  window.addEventListener('hashchange', () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), { once: true });
  main.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => busy(btn, 'Opening…', async () => {
    const side = btn.dataset.open;
    const { mimeType, fileName } = sideInfo(doc, side);
    problem.hidden = true;
    try {
      if (!urls[side]) {
        const file = await store.getDocumentFile(doc, side);
        urls[side] = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }));
      }
      if (mimeType !== 'application/pdf') { openImageViewer([urls[side]], [`${docLabel(doc)} ${side}`], 0, btn); return; }
      if (!window.open(urls[side], '_blank')) {
        const a = document.createElement('a');
        a.href = urls[side]; a.download = fileName; a.click();
      }
    } catch (err) {
      problem.textContent = err.message || 'This file could not be opened.';
      problem.hidden = false;
    }
  })));

  main.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Delete ${docLabel(doc)}?`, message: 'The file is removed for good.' });
    if (!ok) return;
    try { await store.deleteDocument(doc.id); } catch (err) { toast(err.message, 'error'); return; }
    toast('Document deleted');
    navigate('/documents');
  });
}

// Real photo reader: sends the resized photos to the GaadiKhata Worker,
// which checks the sign-in, applies a daily limit, asks the AI provider to
// read them and returns only the extracted fields. Photos are not stored.

import { SMART_CONFIG } from '../config.js';
import * as auth from '../../auth.js';

export const info = {
  id: 'cloud',
  label: 'Photo reader',
  isDemo: false,
  privacy: 'Your photos are sent securely to the GaadiKhata reader, which uses an AI service to read them. Photos are not stored.',
};

export class ReaderError extends Error {
  constructor(message, { retry = true } = {}) { super(message); this.retry = retry; }
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new ReaderError('A photo could not be prepared for sending.'));
    r.readAsDataURL(blob);
  });
}

export async function extract({ receipt, odometer, onProgress, signal }) {
  const user = auth.currentUser();
  if (!user) throw new ReaderError('Sign in to use photo reading.', { retry: false });

  onProgress?.('send');
  const token = await user.getIdToken();
  const body = {};
  if (receipt) body.receipt = { mediaType: 'image/jpeg', data: await toBase64(receipt.blob) };
  if (odometer) body.odometer = { mediaType: 'image/jpeg', data: await toBase64(odometer.blob) };

  let res;
  try {
    const request = fetch(`${SMART_CONFIG.readerUrl.replace(/\/$/, '')}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
    onProgress?.('read');
    res = await request;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ReaderError('Could not reach the photo reader. Check your connection and try again.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new ReaderError(data?.message || `The photo reader failed (error ${res.status}).`, { retry: res.status !== 429 && res.status !== 401 });
  if (!data?.result) throw new ReaderError('The photo reader gave no answer. Try again.');
  return data.result;
}

/**
 * Service invoice: all pages go in one request and are read as one invoice.
 * Plain-text body (header line + one base64 page per line) keeps the Worker's CPU use low.
 */
export async function extractInvoice({ pages, onProgress, signal, docType = 'service-invoice' }) {
  const user = auth.currentUser();
  if (!user) throw new ReaderError('Sign in to use invoice reading.', { retry: false });
  onProgress?.('send');
  const token = await user.getIdToken();
  const data = await Promise.all(pages.map((p) => toBase64(p.blob)));
  const body = `${JSON.stringify({ docType, pages: pages.map(() => ({ mediaType: 'image/jpeg' })) })}\n${data.join('\n')}`;

  let res;
  try {
    const request = fetch(`${SMART_CONFIG.readerUrl.replace(/\/$/, '')}/extract-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${token}` },
      body,
      signal,
    });
    onProgress?.('read');
    res = await request;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ReaderError(`Could not reach the photo reader. Check your connection and try again${pages.length > 3 ? ', or try with fewer pages' : ''}.`);
  }
  let out = null;
  try { out = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new ReaderError(out?.message || `The photo reader failed (error ${res.status}).`, { retry: res.status !== 429 && res.status !== 401 });
  if (!out?.result) throw new ReaderError('The photo reader gave no answer. Try again.');
  return { ...out.result, readerModel: out.model || null };
}

/** Traffic challan: one or two photos (notice, SMS screenshot), same secure route. */
export const extractChallan = (opts) => extractInvoice({ ...opts, docType: 'challan' });

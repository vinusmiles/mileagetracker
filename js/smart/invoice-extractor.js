// One entry point for reading service invoices (any number of pages, as one invoice).
// The reader is chosen in config.js (INVOICE_CONFIG.reader) and its result is always
// cleaned by normaliseInvoice().

import { activeProvider } from './config.js';
import { normaliseInvoice } from './invoice-schema.js';
import * as mock from './providers/mock.js';
import * as cloud from './providers/cloud.js';

const READERS = { mock, cloud };
const reader = () => READERS[activeProvider()] || mock;

export const invoiceReaderIsDemo = () => activeProvider() !== 'cloud';

/** @param opts { pages: prepared photos in order, vehicle, latestOdometer, onProgress } */
export async function extractInvoice(opts) {
  const r = reader();
  if (!r.extractInvoice) throw new Error('This reader cannot read invoices yet.');
  const raw = await r.extractInvoice(opts);
  return { ...normaliseInvoice(raw), readerModel: raw?.readerModel || null };
}

import { normaliseChallan } from './challan-schema.js';

/** Read a traffic challan photo (notice or SMS screenshot). */
export async function extractChallan(opts) {
  const r = reader();
  return normaliseChallan(await r.extractChallan(opts));
}

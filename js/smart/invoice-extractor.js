// One entry point for reading service invoices (any number of pages, as one invoice).
// The reader is chosen in config.js (INVOICE_CONFIG.reader) and its result is always
// cleaned by normaliseInvoice().

import { INVOICE_CONFIG } from './config.js';
import { normaliseInvoice } from './invoice-schema.js';
import * as mock from './providers/mock.js';
import * as cloud from './providers/cloud.js';

const READERS = { mock, cloud };
const reader = () => READERS[INVOICE_CONFIG.reader] || mock;

export const invoiceReaderIsDemo = () => INVOICE_CONFIG.reader !== 'cloud';

/** @param opts { pages: prepared photos in order, vehicle, latestOdometer, onProgress } */
export async function extractInvoice(opts) {
  const r = reader();
  if (!r.extractInvoice) throw new Error('This reader cannot read invoices yet.');
  return normaliseInvoice(await r.extractInvoice(opts));
}

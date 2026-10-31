// Photo handling in the browser: check the file, then resize and re-encode it.
// Resizing keeps uploads small for Stage 2 and also drops the photo's hidden
// metadata (EXIF location, camera details), because only pixels are re-encoded.
// Nothing here stores photos; they live in memory until the flow ends.

import { SMART_CONFIG } from './config.js';

export class ImageError extends Error {}

export function checkImageFile(file) {
  if (!file) throw new ImageError('No photo was selected.');
  if (!SMART_CONFIG.acceptedTypes.includes(file.type)) {
    throw new ImageError('Use a JPG, PNG or WEBP photo. If your phone saved it as HEIC, take a screenshot or change the camera format to JPG.');
  }
  if (file.size > SMART_CONFIG.maxFileBytes) {
    throw new ImageError(`This photo is ${(file.size / 1048576).toFixed(1)} MB. Use one under ${SMART_CONFIG.maxFileBytes / 1048576} MB.`);
  }
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Returns { blob, url, width, height, originalBytes, bytes, name }. Call release() when done. */
export async function preparePhoto(file, { maxEdgePx = SMART_CONFIG.maxEdgePx, quality = SMART_CONFIG.jpegQuality } = {}) {
  checkImageFile(file);
  let src;
  try {
    src = await decode(file);
  } catch {
    throw new ImageError('This photo could not be opened. Try another one.');
  }
  const w0 = src.width;
  const h0 = src.height;
  const scale = Math.min(1, maxEdgePx / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new ImageError('This photo could not be processed. Try another one.');
  return { blob, url: URL.createObjectURL(blob), width: w, height: h, originalBytes: file.size, bytes: blob.size, name: file.name };
}

export function release(photo) {
  if (photo?.url) URL.revokeObjectURL(photo.url);
}

/** JPEG blob -> data URL (for keeping invoice pages in Firestore). */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new ImageError('A page could not be prepared.'));
    r.readAsDataURL(blob);
  });
}

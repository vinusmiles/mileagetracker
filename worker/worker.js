// MileageMate photo reader: a Cloudflare Worker.
//
// The website sends a signed-in user's receipt and/or odometer photo here.
// This Worker:
//   1. accepts requests only from the allowed website (CORS),
//   2. checks the Firebase sign-in token (only signed-in users),
//   3. limits scans per user per day (Cloudflare KV),
//   4. asks the AI provider to read the photos, using a secret API key,
//   5. returns only the extracted fields. Photos are never stored or logged.
//
// Settings (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY   Secret. Your Claude API key. Never put it anywhere else.
//   FIREBASE_PROJECT_ID Text, e.g. mileagemate-1311
//   ALLOWED_ORIGINS     Text, comma separated, e.g. https://vinusmiles.github.io
//   DAILY_LIMIT         Text, optional, scans per user per day (default 30)
//   MODEL               Text, optional (default claude-haiku-5-5)
// Binding: a KV namespace bound as SCANS (for the daily limit).
//
// The AI provider sits behind one function (readWithAnthropic). To switch
// provider later, add another function with the same input and output.

const WORKER_VERSION = '0.4.2';
const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_BODY_BYTES = 3_000_000;
const MAX_IMAGE_B64 = 1_400_000; // about 1 MB per photo; the app sends ~150 KB
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      if (!cors) console.log('origin not allowed:', request.headers.get('Origin'), '| allowed list has', allowedOrigins(env).length, 'entries');
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }
    if (!cors) {
      // Not secret: helps check the ALLOWED_ORIGINS setting.
      return json({ error: 'origin-not-allowed', yourOrigin: request.headers.get('Origin') || null, allowedCount: allowedOrigins(env).length, version: WORKER_VERSION }, 403);
    }
    try {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/extract') return json({ error: 'not-found' }, 404, cors);
      return await handleExtract(request, env, cors);
    } catch (err) {
      // Log the kind of failure only: never images, tokens or personal data.
      console.log('extract failed:', err?.code || err?.name || 'error');
      const status = err?.status || 500;
      return json({ error: err?.code || 'server-error', message: status === 500 ? 'Something went wrong. Try again.' : err.message }, status, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// Tolerates stray spaces, quotes, invisible characters and a trailing slash in the setting.
const cleanOrigin = (o) => String(o || '').replace(/[\u0000-\u0020\u007f-\u00a0\u200b-\u200f\u2060\ufeff'"`]/g, '').replace(/\/+$/, '').toLowerCase();
const allowedOrigins = (env) => String(env.ALLOWED_ORIGINS || '').split(/[,\n]/).map(cleanOrigin).filter(Boolean);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!allowedOrigins(env).includes(cleanOrigin(origin))) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

async function handleExtract(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY || !env.FIREBASE_PROJECT_ID || !env.SCANS) throw new HttpError(500, 'not-configured', 'The photo reader is not set up yet.');

  // 1. Who is asking?
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const uid = await verifyFirebaseToken(token, env);

  // 2. Is the request sensible?
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > MAX_BODY_BYTES) throw new HttpError(413, 'too-large', 'The photos are too large.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'too-large', 'The photos are too large.');
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, 'bad-request', 'The request could not be read.'); }
  const receipt = checkImage(body.receipt, 'receipt');
  const odometer = checkImage(body.odometer, 'odometer');
  if (!receipt && !odometer) throw new HttpError(400, 'no-photos', 'Add at least one photo.');

  // 3. Daily limit per user.
  const limit = Number(env.DAILY_LIMIT || 30);
  const day = new Date().toISOString().slice(0, 10);
  const key = `scans:${day}:${uid}`;
  const used = Number((await env.SCANS.get(key)) || 0);
  if (used >= limit) throw new HttpError(429, 'daily-limit', `You have used today's ${limit} photo scans. Try again tomorrow, or enter the fill manually.`);
  await env.SCANS.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });

  // 4. Read the photos.
  const result = await readWithAnthropic({ receipt, odometer }, env);
  return json({ result, provider: 'anthropic', model: env.MODEL || DEFAULT_MODEL, scansLeftToday: Math.max(0, limit - used - 1) }, 200, cors);
}

function checkImage(img, name) {
  if (img == null) return null;
  if (typeof img !== 'object' || !IMAGE_TYPES.includes(img.mediaType) || typeof img.data !== 'string') {
    throw new HttpError(400, 'bad-image', `The ${name} photo is not a JPG, PNG or WEBP image.`);
  }
  if (img.data.length > MAX_IMAGE_B64) throw new HttpError(413, 'too-large', `The ${name} photo is too large.`);
  if (!/^[A-Za-z0-9+/]+=*$/.test(img.data.slice(0, 200))) throw new HttpError(400, 'bad-image', `The ${name} photo could not be read.`);
  return { mediaType: img.mediaType, data: img.data };
}

// ---------------------------------------------------------------------------
// Firebase ID token check (RS256 JWT signed by Google)
// ---------------------------------------------------------------------------

let jwksCache = { keys: null, expires: 0 };

async function googleKeys(env) {
  if (jwksCache.keys && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(env.JWKS_URL || GOOGLE_JWKS); // JWKS_URL is only for local tests
  if (!res.ok) throw new HttpError(503, 'auth-unavailable', 'Could not check your sign-in. Try again.');
  const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: (await res.json()).keys, expires: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

function b64urlBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifyFirebaseToken(token, env) {
  const fail = () => new HttpError(401, 'not-signed-in', 'Please sign in again.');
  const parts = token.split('.');
  if (parts.length !== 3) throw fail();
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  } catch { throw fail(); }
  if (header.alg !== 'RS256' || !header.kid) throw fail();

  const jwk = (await googleKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache.expires = 0; throw fail(); } // keys may have rotated; refetch next time
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw fail();

  const now = Math.floor(Date.now() / 1000);
  const project = env.FIREBASE_PROJECT_ID;
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) throw fail();
  if (!(claims.exp > now) || !(claims.iat <= now + 60) || !(claims.auth_time <= now + 60)) throw fail();
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw fail();
  return claims.sub;
}

// ---------------------------------------------------------------------------
// AI provider: Claude (Anthropic API).
// Model default claude-haiku-5-5: forced tool_choice is supported on it (it skips
// thinking, which keeps scans fast and cheap). Check the docs before changing MODEL.
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You read Indian fuel-pump receipts and vehicle dashboard photos for a mileage tracking app.
Return the details by calling the record_fuel_details tool exactly once.

Golden rule: never guess. If a value is not clearly visible, use null. If you can read it but are not sure (blur, glare, a digit that could be two things), give your best reading AND list the field in fieldsNeedingReview.

Receipt photo:
- quantityLitres: the volume dispensed (often "Volume(L)" or "Qty"). Strip leading zeros: "00020.00" is 20.
- pricePerLitre: the rate ("Rate(Rs/L)"). totalAmount: the amount paid for this sale ("Amount(Rs)", "Sale").
- Ignore "Atot", "Vtot", "Totalizer" or other running totals: they are the pump's lifetime counters, not this sale.
- transactionDate: the sale date printed on the receipt, as YYYY-MM-DD. Indian receipts use day/month/year: "18/10/26" is 2026-10-18.
- transactionTime: the sale time (HH:MM, 24-hour). Not a "Printed on" time if a separate sale time exists.
- fuelCompany: the oil company brand (e.g. Bharat Petroleum, Indian Oil, HP, Shell, Nayara). fuelStation: the outlet name.
- fuelType: Petrol, Diesel, CNG or null.
- receiptNumber: copy exactly as printed, letters included.
- receiptIsFuel: false if the image is not a fuel-sale receipt.

Dashboard photo:
- odometerKm: ONLY the total distance labelled ODO (or the odometer display). Not the speed, clock, trip meter (TRIP A/B), gear, temperature, or the distance-to-empty / range figure.
- dashboardRangeKm: the distance-to-empty / range figure if shown (often next to a fuel-pump icon), else null.
- dashboardTime: the clock on the dashboard (HH:MM), else null.
- odometerReadable: false if no odometer reading can be found.

Both photos: ignore phone camera watermarks (for example "OPPO ... 2026.10.22 19:06"). They are when the photo was taken, not when fuel was bought.
Leave fields for a photo that was not provided as null.`;

const FIELD_NAMES = ['fuelCompany', 'fuelStation', 'location', 'fuelType', 'transactionDate', 'transactionTime', 'quantityLitres',
  'pricePerLitre', 'totalAmount', 'receiptNumber', 'odometerKm', 'dashboardRangeKm', 'dashboardTime'];

const TOOL = {
  name: 'record_fuel_details',
  description: 'Record the details read from the fuel receipt and/or dashboard photo.',
  input_schema: {
    type: 'object',
    properties: {
      fuelCompany: { type: ['string', 'null'] },
      fuelStation: { type: ['string', 'null'] },
      location: { type: ['string', 'null'], description: 'Station address or town if printed' },
      fuelType: { type: ['string', 'null'], enum: ['Petrol', 'Diesel', 'CNG', null] },
      transactionDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      transactionTime: { type: ['string', 'null'], description: 'HH:MM 24-hour' },
      quantityLitres: { type: ['number', 'null'] },
      pricePerLitre: { type: ['number', 'null'] },
      totalAmount: { type: ['number', 'null'] },
      receiptNumber: { type: ['string', 'null'] },
      receiptIsFuel: { type: ['boolean', 'null'] },
      odometerKm: { type: ['number', 'null'] },
      dashboardRangeKm: { type: ['number', 'null'] },
      dashboardTime: { type: ['string', 'null'] },
      odometerReadable: { type: ['boolean', 'null'] },
      fieldsNeedingReview: { type: 'array', items: { type: 'string', enum: FIELD_NAMES } },
    },
    required: ['fieldsNeedingReview'],
  },
};

async function readWithAnthropic({ receipt, odometer }, env) {
  const content = [];
  if (receipt) {
    content.push({ type: 'text', text: 'Photo 1: fuel receipt.' });
    content.push({ type: 'image', source: { type: 'base64', media_type: receipt.mediaType, data: receipt.data } });
  } else {
    content.push({ type: 'text', text: 'No receipt photo was provided.' });
  }
  if (odometer) {
    content.push({ type: 'text', text: `Photo ${receipt ? 2 : 1}: vehicle dashboard / odometer.` });
    content.push({ type: 'image', source: { type: 'base64', media_type: odometer.mediaType, data: odometer.data } });
  } else {
    content.push({ type: 'text', text: 'No dashboard photo was provided.' });
  }
  content.push({ type: 'text', text: 'Read the photos and call record_fuel_details.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(`${env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.MODEL || DEFAULT_MODEL,
        max_tokens: 1500,
        system: INSTRUCTIONS,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (err) {
    throw new HttpError(504, 'reader-timeout', 'The photo reader took too long. Try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 || res.status === 529) throw new HttpError(503, 'reader-busy', 'The photo reader is busy. Try again in a minute.');
  if (!res.ok) {
    // Claude's error type and message say why (e.g. permission_error). They never contain the key or photos.
    let detail = '';
    try { const e = (await res.json())?.error; detail = `${e?.type || ''}: ${e?.message || ''}`.slice(0, 300); } catch { /* not JSON */ }
    console.log('provider status', res.status, detail);
    const err = new HttpError(502, 'reader-failed', `The photo reader could not read these photos (provider ${res.status}${detail ? `, ${detail}` : ''}).`);
    throw err;
  }
  const data = await res.json();
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call || typeof call.input !== 'object') throw new HttpError(502, 'reader-failed', 'The photo reader gave no answer. Try again.');
  // Return only known fields; the app cleans and checks them again.
  const out = {};
  for (const k of [...FIELD_NAMES, 'receiptIsFuel', 'odometerReadable', 'fieldsNeedingReview']) out[k] = call.input[k] ?? null;
  return out;
}

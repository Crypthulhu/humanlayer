import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

export function jsonResponse(statusCode, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

export async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function verifyPassword(password, saltHex, hashHex) {
  if (!password || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(password, salt, expected.length);
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

export function signJwt(payload, secret, expiresInSeconds = 60 * 60 * 8) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const bodyPart = base64UrlEncode(JSON.stringify(body));
  const data = `${headerPart}.${bodyPart}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64UrlEncode(signature)}`;
}

export function verifyJwt(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, bodyPart, signaturePart] = parts;
  const data = `${headerPart}.${bodyPart}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const provided = base64UrlDecode(signaturePart);
  if (expected.length !== provided.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(bodyPart).toString('utf-8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getBearer(request) {
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// ─── TOTP (RFC 6238) ────────────────────────────────────────

function base32Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, idx = 0;
  const out = Buffer.alloc(Math.floor(input.length * 5 / 8));
  for (const c of input.toUpperCase().replace(/=+$/, '')) {
    val = (val << 5) | chars.indexOf(c);
    bits += 5;
    if (bits >= 8) { bits -= 8; out[idx++] = (val >> bits) & 0xff; }
  }
  return out.subarray(0, idx);
}

function generateTotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { buf[i] = c & 0xff; c = Math.floor(c / 256); }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return code.toString().padStart(6, '0');
}

export function verifyTotp(secretBase32, token) {
  if (!secretBase32 || !token || token.length !== 6) return false;
  const counter = Math.floor(Date.now() / 30000);
  // Allow ±1 step for clock drift
  for (let i = -1; i <= 1; i++) {
    if (generateTotp(secretBase32, counter + i) === token) return true;
  }
  return false;
}

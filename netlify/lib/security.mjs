// Primitives cryptographiques : mots de passe, jetons, TOTP, chiffrement au repos,
// signature des décisions (Ed25519) et des webhooks (HMAC), clés d'API hachées.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ConfigError } from './http.mjs';

const scrypt = promisify(crypto.scrypt);

export const sha256hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

/* ---------------------------------------------------------------
   Mots de passe (scrypt, paramètres stockés avec l'empreinte)
   --------------------------------------------------------------- */
const SCRYPT = { N: 65536, r: 8, p: 1, keylen: 64 };
const maxmem = (N, r) => 256 * N * r;

export const PASSWORD_MIN_LENGTH = 12;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p, maxmem: maxmem(N, r) });
  return { salt: salt.toString('hex'), hash: `scrypt$${N}$${r}$${p}$${hash.toString('hex')}` };
}

/**
 * Vérifie un mot de passe. Accepte l'ancien format (empreinte hexadécimale seule,
 * paramètres scrypt par défaut) et signale quand l'empreinte doit être régénérée.
 */
export async function verifyPassword(password, saltHex, stored) {
  if (typeof password !== 'string' || !password || !saltHex || !stored) return { ok: false, needsRehash: false };
  let N = 16384;
  let r = 8;
  let p = 1;
  let hashHex = stored;
  let legacy = true;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    N = Number(parts[1]);
    r = Number(parts[2]);
    p = Number(parts[3]);
    hashHex = parts[4];
    legacy = false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const attempt = async (salt) => {
    const derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: maxmem(N, r) });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  };
  let ok = await attempt(Buffer.from(saltHex, 'hex'));
  // L'ancien script d'administration utilisait le sel hexadécimal comme texte brut.
  if (!ok && legacy) ok = await attempt(Buffer.from(saltHex, 'utf8'));
  return { ok, needsRehash: ok && (legacy || N < SCRYPT.N) };
}

/* ---------------------------------------------------------------
   Jetons JWT (HS256) avec émetteur, audience, sujet et portée
   --------------------------------------------------------------- */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

export const ISSUER = 'humanlayer';

export function signToken(claims, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...claims, iss: ISSUER, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() }));
  const sig = b64u(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token, secret, audience) {
  if (!token || !secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let head;
  try {
    head = JSON.parse(fromB64u(header).toString('utf8'));
  } catch {
    return null;
  }
  if (!head || head.alg !== 'HS256') return null;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const provided = fromB64u(sig);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64u(body).toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ISSUER || payload.aud !== audience) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 60) return null;
  return payload;
}

/* ---------------------------------------------------------------
   TOTP (RFC 6238) avec protection contre le rejeu
   --------------------------------------------------------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of String(input).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(out);
}

export function totpAt(secretBase32, step) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

export const currentStep = (ms = Date.now()) => Math.floor(ms / 30000);

/** Renvoie le pas de temps accepté, ou null. Refuse tout pas déjà utilisé (rejeu). */
export function verifyTotp(secretBase32, code, lastStep = null) {
  if (!secretBase32 || typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const now = currentStep();
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep !== null && lastStep !== undefined && step <= Number(lastStep)) continue;
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpUri(secret, account) {
  const issuer = 'HumanLayer';
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

/* ---------------------------------------------------------------
   Chiffrement au repos (AES-256-GCM) des secrets sensibles
   --------------------------------------------------------------- */
function dataKey() {
  const raw = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  let key = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else if (raw) key = Buffer.from(raw, 'base64');
  if (!key || key.length !== 32) throw new ConfigError('DATA_ENCRYPTION_KEY manquante ou invalide (32 octets attendus)');
  return key;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url')}`;
}

/** Déchiffre ; une valeur héritée en clair est renvoyée telle quelle avec legacy=true. */
export function decryptSecret(stored) {
  if (!stored) return { value: null, legacy: false };
  if (!String(stored).startsWith('enc:v1:')) return { value: String(stored), legacy: true };
  const raw = Buffer.from(String(stored).slice(7), 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const value = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  return { value, legacy: false };
}

/* ---------------------------------------------------------------
   Signature des décisions (Ed25519, vérifiable avec la clé publique)
   --------------------------------------------------------------- */
let cachedSigning = null;

function signingKeys() {
  const raw = (process.env.DECISION_SIGNING_KEY || '').trim();
  if (!raw) throw new ConfigError('DECISION_SIGNING_KEY manquante (clé privée Ed25519)');
  if (cachedSigning && cachedSigning.raw === raw) return cachedSigning;
  let privateKey;
  try {
    privateKey = raw.includes('BEGIN')
      ? crypto.createPrivateKey(raw.replace(/\\n/g, '\n'))
      : crypto.createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new ConfigError('DECISION_SIGNING_KEY illisible (PEM ou DER PKCS#8 en base64 attendu)');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new ConfigError('DECISION_SIGNING_KEY doit être une clé Ed25519');
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  cachedSigning = {
    raw,
    privateKey,
    publicKey,
    keyId: sha256hex(der).slice(0, 16),
    pem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
  return cachedSigning;
}

// JSON canonique : clés triées, pour une signature reproductible.
export function canonicalJson(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

export function signDecision(payload) {
  const { privateKey, keyId } = signingKeys();
  const canonical = canonicalJson({ ...payload, key_id: keyId });
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
  return { canonical, signature, keyId };
}

export function verifyDecisionSignature(canonical, signature) {
  const { publicKey } = signingKeys();
  return crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signature, 'base64'));
}

export function decisionPublicKey() {
  const { keyId, pem } = signingKeys();
  return { algorithm: 'Ed25519', key_id: keyId, public_key_pem: pem };
}

/* ---------------------------------------------------------------
   Webhooks signés (HMAC-SHA256, secret propre à chaque clé d'API)
   --------------------------------------------------------------- */
function webhookMaster() {
  const master = process.env.WEBHOOK_SIGNING_SECRET || '';
  if (master.length < 32) throw new ConfigError('WEBHOOK_SIGNING_SECRET manquant ou trop court (32 caractères minimum)');
  return master;
}

export function webhookSecretFor(keyId) {
  return `whsec_${crypto.createHmac('sha256', webhookMaster()).update(`webhook:${keyId}`).digest('base64url')}`;
}

export function signWebhook(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/* ---------------------------------------------------------------
   Clés d'API : seule l'empreinte est stockée
   --------------------------------------------------------------- */
export function newApiKey(env = 'live') {
  const raw = `hl_${env === 'test' ? 'test' : 'live'}_${crypto.randomBytes(24).toString('hex')}`;
  return { raw, stored: `sha256:${sha256hex(raw)}`, prefix: `${raw.slice(0, 12)}…` };
}

export const storedKeyFor = (raw) => `sha256:${sha256hex(raw)}`;
export const keyPrefix = (raw) => `${String(raw).slice(0, 12)}…`;

/* ---------------------------------------------------------------
   Pseudonyme public d'un Sentinel (l'identité réelle reste interne)
   --------------------------------------------------------------- */
export function sentinelRef(id) {
  return `S-${sha256hex(`sentinel:${id}`).slice(0, 6).toUpperCase()}`;
}

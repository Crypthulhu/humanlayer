#!/usr/bin/env node
// Génère les variables d'environnement de sécurité à saisir dans Netlify
// (Site settings → Environment variables). Rien n'est écrit sur le disque.
//
// Usage :
//   node scripts/generate-secrets.mjs                     → tous les secrets, sauf le mot de passe admin
//   node scripts/generate-secrets.mjs --admin-password "…" → ajoute ADMIN_PASSWORD_SALT / ADMIN_PASSWORD_HASH
//   node scripts/generate-secrets.mjs --only admin-password --admin-password "…"
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
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

const lines = [];
const only = opt('only');

if (!only) {
  lines.push(['ADMIN_JWT_SECRET', crypto.randomBytes(48).toString('base64url')]);
  lines.push(['SENTINEL_JWT_SECRET', crypto.randomBytes(48).toString('base64url')]);
  lines.push(['CLIENT_JWT_SECRET', crypto.randomBytes(48).toString('base64url')]);
  lines.push(['DATA_ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex')]);
  lines.push(['WEBHOOK_SIGNING_SECRET', crypto.randomBytes(48).toString('base64url')]);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  lines.push(['DECISION_SIGNING_KEY', privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')]);
  lines.push(['ADMIN_TOTP_SECRET', base32(crypto.randomBytes(20))]);
  console.error(`# Clé publique de vérification (publiée par /.netlify/functions/decision-key) :\n${publicKey.export({ type: 'spki', format: 'pem' })}`);
}

const password = opt('admin-password');
if (password) {
  if (password.length < 12) {
    console.error('Le mot de passe administrateur doit faire au moins 12 caractères.');
    process.exit(1);
  }
  const N = 65536;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N, r, p, maxmem: 256 * N * r });
  lines.push(['ADMIN_PASSWORD_SALT', salt.toString('hex')]);
  lines.push(['ADMIN_PASSWORD_HASH', `scrypt$${N}$${r}$${p}$${hash.toString('hex')}`]);
}

if (!lines.length) {
  console.error('Rien à générer. Voir l’usage en tête du fichier.');
  process.exit(1);
}
for (const [name, value] of lines) console.log(`${name}=${value}`);
if (!only) {
  console.error('\n# ADMIN_TOTP_SECRET : ajoutez-le à votre application d’authentification (saisie manuelle, 6 chiffres, 30 s).');
}

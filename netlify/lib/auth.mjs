// Authentification par rôle : un secret JWT dédié et obligatoire par rôle,
// sessions de 12 h, statut du compte revérifié en base à chaque requête.
import { HttpError, ConfigError, getBearer } from './http.mjs';
import { signToken, verifyToken } from './security.mjs';

const SECRET_ENV = { admin: 'ADMIN_JWT_SECRET', sentinel: 'SENTINEL_JWT_SECRET', client: 'CLIENT_JWT_SECRET' };

export const SESSION_TTL = 12 * 60 * 60;
export const ENROLLMENT_TTL = 15 * 60;

export function roleSecret(role) {
  const values = Object.fromEntries(Object.entries(SECRET_ENV).map(([r, name]) => [r, process.env[name] || '']));
  const secret = values[role];
  if (!secret || secret.length < 32) throw new ConfigError(`${SECRET_ENV[role]} manquant ou trop court (32 caractères minimum)`);
  for (const [other, value] of Object.entries(values)) {
    if (other !== role && value && value === secret) {
      throw new ConfigError(`${SECRET_ENV[role]} doit être distinct de ${SECRET_ENV[other]}`);
    }
  }
  return secret;
}

export function issueToken(role, sub, extra = {}, ttl = SESSION_TTL) {
  return signToken({ aud: role, sub, scope: 'full', ...extra }, roleSecret(role), ttl);
}

export const unauthorized = () =>
  new HttpError(401, { fr: 'Session expirée ou invalide', en: 'Session expired or invalid' }, { code: 'unauthorized' });

const mfaRequired = () =>
  new HttpError(403, { fr: 'Double authentification requise', en: 'Two-factor authentication required' }, { code: 'mfa_required' });

function readToken(request, role) {
  const payload = verifyToken(getBearer(request), roleSecret(role), role);
  if (!payload || !payload.sub) throw unauthorized();
  return payload;
}

export function requireAdmin(request) {
  const payload = readToken(request, 'admin');
  if (payload.scope !== 'full') throw unauthorized();
  return payload;
}

/**
 * Sentinel authentifié et actif. La double authentification est obligatoire :
 * seule l'inscription TOTP accepte un jeton d'enrôlement.
 */
export async function requireSentinel(conn, request, { allowEnrollment = false } = {}) {
  const payload = readToken(request, 'sentinel');
  const allowed = allowEnrollment ? ['full', 'mfa_enroll'] : ['full'];
  if (!allowed.includes(payload.scope)) throw mfaRequired();
  const res = await conn.execute({
    sql: `SELECT id, first_name, last_name, email, expertise, status, totp_secret, totp_pending_secret, totp_last_step
          FROM applications WHERE id = ?`,
    args: [payload.sub],
  });
  const sentinel = res.rows[0];
  if (!sentinel || sentinel.status !== 'activated') throw unauthorized();
  // MFA réinitialisée par l'administration : la session complète n'est plus valable.
  if (payload.scope === 'full' && !sentinel.totp_secret) throw mfaRequired();
  return { token: payload, sentinel };
}

export async function requireClient(conn, request) {
  const payload = readToken(request, 'client');
  const res = await conn.execute({
    sql: 'SELECT id, company_name, email, tier, status, created_at FROM clients WHERE id = ?',
    args: [payload.sub],
  });
  const client = res.rows[0];
  if (!client || client.status !== 'active') throw unauthorized();
  return { token: payload, client };
}

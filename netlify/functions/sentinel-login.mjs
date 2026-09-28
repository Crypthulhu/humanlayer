// Connexion Sentinel : mot de passe puis code TOTP obligatoire. Sans MFA configurée,
// seul un jeton d'enrôlement (15 min) est délivré. Tentatives limitées par IP et par compte.
import { db } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, text } from '../lib/http.mjs';
import { verifyPassword, hashPassword, verifyTotp, decryptSecret, encryptSecret } from '../lib/security.mjs';
import { issueToken, SESSION_TTL, ENROLLMENT_TTL } from '../lib/auth.mjs';
import { enforce, peek, consume, reset, tooMany, LIMITS } from '../lib/ratelimit.mjs';
import { audit } from '../lib/audit.mjs';

const invalid = () => new HttpError(401, { fr: 'Identifiants invalides', en: 'Invalid credentials' }, { code: 'invalid_credentials' });

export default handler(async (request, context) => {
  allowMethods(request, 'POST');
  const conn = await db();
  const ip = clientIp(request, context);
  await enforce(conn, `login:sentinel:ip:${ip}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window);

  const body = await readJson(request, 4 * 1024);
  const email = text(body.email, 254)?.toLowerCase();
  if (!email || typeof body.password !== 'string') {
    throw new HttpError(400, { fr: 'Courriel et mot de passe requis', en: 'Email and password required' }, { code: 'missing_fields' });
  }

  const failKey = `login:sentinel:fail:${email}`;
  const { limit, window } = LIMITS.loginFailuresPerAccount;
  const failures = await peek(conn, failKey, window);
  if (failures.count >= limit) throw tooMany(failures.retryAfter);

  // lower(email) : les anciennes candidatures ont pu être enregistrées avec des majuscules.
  const res = await conn.execute({
    sql: `SELECT id, first_name, last_name, email, expertise, status, password_hash, password_salt, totp_secret, totp_last_step
          FROM applications WHERE lower(email) = ?`,
    args: [email],
  });
  const sentinel = res.rows[0];
  const check = sentinel ? await verifyPassword(body.password, sentinel.password_salt, sentinel.password_hash) : { ok: false };
  if (!check.ok) {
    await consume(conn, failKey, limit, window);
    await audit(conn, { actor_type: 'sentinel', actor_id: sentinel ? sentinel.id : null, action: 'sentinel.login.failed', ip });
    throw invalid();
  }
  if (sentinel.status !== 'activated') {
    await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: 'sentinel.login.blocked', ip, details: { status: sentinel.status } });
    throw new HttpError(403, { fr: 'Compte non activé', en: 'Account not activated' }, { code: 'account_inactive' });
  }
  if (check.needsRehash) {
    const { salt, hash } = await hashPassword(body.password);
    await conn.execute({ sql: 'UPDATE applications SET password_salt = ?, password_hash = ? WHERE id = ?', args: [salt, hash, sentinel.id] });
  }

  const profile = { id: sentinel.id, firstName: sentinel.first_name, lastName: sentinel.last_name, email: sentinel.email, expertise: sentinel.expertise };

  // MFA obligatoire : sans secret, on délivre seulement de quoi l'enrôler.
  if (!sentinel.totp_secret) {
    await reset(conn, failKey);
    await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: 'sentinel.login.enrollment_required', ip });
    return json(200, {
      mfa_enrollment_required: true,
      enrollment_token: issueToken('sentinel', sentinel.id, { scope: 'mfa_enroll' }, ENROLLMENT_TTL),
      sentinel: profile,
    });
  }

  const code = String(body.totp || '').trim();
  if (!code) {
    throw new HttpError(401, { fr: 'Code 2FA requis (6 chiffres)', en: '2FA code required (6 digits)' }, { code: 'mfa_required', mfa_required: true });
  }
  const { value: secret, legacy } = decryptSecret(sentinel.totp_secret);
  const step = verifyTotp(secret, code, sentinel.totp_last_step);
  if (step === null) {
    await consume(conn, failKey, limit, window);
    await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: 'sentinel.login.mfa_failed', ip });
    throw new HttpError(401, { fr: 'Code 2FA invalide ou déjà utilisé', en: 'Invalid or already used 2FA code' }, { code: 'invalid_mfa', mfa_required: true });
  }
  // Pas de temps consommé (anti-rejeu) ; un secret hérité en clair est chiffré au passage.
  await conn.execute({
    sql: 'UPDATE applications SET totp_last_step = ?, totp_secret = ? WHERE id = ?',
    args: [step, legacy ? encryptSecret(secret) : sentinel.totp_secret, sentinel.id],
  });
  await reset(conn, failKey);
  await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: 'sentinel.login.success', ip });
  return json(200, { token: issueToken('sentinel', sentinel.id), expires_in: SESSION_TTL, sentinel: profile });
});

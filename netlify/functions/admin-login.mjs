// Connexion administrateur : mot de passe + code 2FA vérifiés ensemble, tentatives limitées.
import { db } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, ConfigError } from '../lib/http.mjs';
import { verifyPassword, verifyTotp } from '../lib/security.mjs';
import { issueToken, SESSION_TTL } from '../lib/auth.mjs';
import { enforce, peek, consume, tooMany, LIMITS } from '../lib/ratelimit.mjs';
import { audit } from '../lib/audit.mjs';

export default handler(async (request, context) => {
  allowMethods(request, 'POST');
  const conn = await db();
  const ip = clientIp(request, context);
  const salt = process.env.ADMIN_PASSWORD_SALT;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const totpSecret = process.env.ADMIN_TOTP_SECRET;
  if (!salt || !hash) throw new ConfigError('ADMIN_PASSWORD_SALT / ADMIN_PASSWORD_HASH manquants');
  // Second facteur obligatoire pour l'administration (voir la page Sécurité).
  if (!totpSecret) throw new ConfigError('ADMIN_TOTP_SECRET manquant : la double authentification administrateur est obligatoire');

  const { limit: ipLimit, window } = LIMITS.adminFailuresPerIp;
  const ipKey = `login:admin:fail:${ip}`;
  const globalKey = 'login:admin:fail:all';
  const byIp = await peek(conn, ipKey, window);
  if (byIp.count >= ipLimit) throw tooMany(byIp.retryAfter);
  const global = await peek(conn, globalKey, LIMITS.adminFailuresGlobal.window);
  if (global.count >= LIMITS.adminFailuresGlobal.limit) throw tooMany(global.retryAfter);

  const body = await readJson(request, 4 * 1024);
  const { ok } = await verifyPassword(body.password, salt, hash);
  // Le code 2FA est vérifié même si le mot de passe est faux : la réponse ne dit pas lequel a échoué.
  // Un code déjà accepté ne peut pas resservir (dernier pas de temps mémorisé).
  const last = await conn.execute({ sql: "SELECT window_start FROM rate_limits WHERE key = 'admin:totp:last_step'", args: [] });
  const lastStep = last.rows.length ? Number(last.rows[0].window_start) : null;
  const step = verifyTotp(totpSecret, String(body.totp || ''), lastStep);
  const totpOk = step !== null;

  if (!ok || !totpOk) {
    await consume(conn, ipKey, ipLimit, window);
    await consume(conn, globalKey, LIMITS.adminFailuresGlobal.limit, LIMITS.adminFailuresGlobal.window);
    await audit(conn, { actor_type: 'admin', action: 'admin.login.failed', ip });
    throw new HttpError(
      401,
      { fr: 'Mot de passe ou code 2FA invalide', en: 'Invalid password or 2FA code' },
      { code: 'invalid_credentials', mfa_required: true }
    );
  }

  await conn.execute({
    sql: `INSERT INTO rate_limits (key, window_start, count) VALUES ('admin:totp:last_step', ?, 0)
          ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start`,
    args: [step],
  });
  await enforce(conn, `login:admin:ok:${ip}`, 30, 15 * 60);
  await audit(conn, { actor_type: 'admin', actor_id: 'admin', action: 'admin.login.success', ip });
  return json(200, { token: issueToken('admin', 'admin'), expires_in: SESSION_TTL, mfa: true });
});

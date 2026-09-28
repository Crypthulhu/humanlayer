// Connexion client : tentatives limitées (IP et compte), session de 12 h, réponse uniforme.
import { db } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, text } from '../lib/http.mjs';
import { verifyPassword, hashPassword } from '../lib/security.mjs';
import { issueToken, SESSION_TTL } from '../lib/auth.mjs';
import { enforce, peek, consume, reset, tooMany, LIMITS } from '../lib/ratelimit.mjs';
import { audit } from '../lib/audit.mjs';

const invalid = () => new HttpError(401, { fr: 'Identifiants invalides', en: 'Invalid credentials' }, { code: 'invalid_credentials' });

export default handler(async (request, context) => {
  allowMethods(request, 'POST');
  const conn = await db();
  const ip = clientIp(request, context);
  await enforce(conn, `login:client:ip:${ip}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window);

  const body = await readJson(request, 4 * 1024);
  const email = text(body.email, 254)?.toLowerCase();
  if (!email || typeof body.password !== 'string') {
    throw new HttpError(400, { fr: 'Courriel et mot de passe requis', en: 'Email and password required' }, { code: 'missing_fields' });
  }

  const failKey = `login:client:fail:${email}`;
  const { limit, window } = LIMITS.loginFailuresPerAccount;
  const failures = await peek(conn, failKey, window);
  if (failures.count >= limit) throw tooMany(failures.retryAfter);

  const res = await conn.execute({
    sql: 'SELECT id, company_name, email, tier, status, password_hash, password_salt FROM clients WHERE lower(email) = ?',
    args: [email],
  });
  const client = res.rows[0];
  const check = client ? await verifyPassword(body.password, client.password_salt, client.password_hash) : { ok: false };
  // Le statut n'est révélé qu'après un mot de passe correct.
  if (!check.ok) {
    await consume(conn, failKey, limit, window);
    await audit(conn, { actor_type: 'client', actor_id: client ? client.id : null, action: 'client.login.failed', ip });
    throw invalid();
  }
  if (client.status !== 'active') {
    await audit(conn, { actor_type: 'client', actor_id: client.id, action: 'client.login.blocked', ip, details: { status: client.status } });
    throw new HttpError(403, { fr: 'Compte suspendu : contactez le support', en: 'Account suspended: contact support' }, { code: 'account_suspended' });
  }
  if (check.needsRehash) {
    const { salt, hash } = await hashPassword(body.password);
    await conn.execute({ sql: 'UPDATE clients SET password_salt = ?, password_hash = ? WHERE id = ?', args: [salt, hash, client.id] });
  }
  await reset(conn, failKey);
  await audit(conn, { actor_type: 'client', actor_id: client.id, action: 'client.login.success', ip });

  return json(200, {
    token: issueToken('client', client.id),
    expires_in: SESSION_TTL,
    client: { id: client.id, company_name: client.company_name, email: client.email, tier: client.tier },
  });
});

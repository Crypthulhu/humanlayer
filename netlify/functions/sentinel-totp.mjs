// Enrôlement TOTP des Sentinels. Le secret est généré et conservé côté serveur (chiffré) ;
// la MFA ne peut pas être désactivée par le Sentinel, seulement renouvelée.
import { db, nowIso } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError } from '../lib/http.mjs';
import { requireSentinel, issueToken, SESSION_TTL } from '../lib/auth.mjs';
import { newTotpSecret, totpUri, verifyTotp, encryptSecret, decryptSecret } from '../lib/security.mjs';
import { enforce, LIMITS } from '../lib/ratelimit.mjs';
import { audit } from '../lib/audit.mjs';

export default handler(async (request, context) => {
  allowMethods(request, 'GET', 'POST', 'DELETE');
  const conn = await db();
  const { token, sentinel } = await requireSentinel(conn, request, { allowEnrollment: true });
  const ip = clientIp(request, context);
  const enrolled = Boolean(sentinel.totp_secret);

  if (request.method === 'DELETE') {
    throw new HttpError(
      403,
      { fr: 'La double authentification est obligatoire pour les Sentinels. Pour changer d’appareil, générez un nouveau code.', en: 'Two-factor authentication is mandatory for Sentinels. To change device, generate a new code.' },
      { code: 'mfa_mandatory' }
    );
  }

  if (request.method === 'GET') {
    const rotate = new URL(request.url).searchParams.get('rotate') === '1';
    // Statut seul : Sentinel déjà enrôlé qui ne demande pas de renouvellement.
    if (enrolled && !rotate) return json(200, { enrolled: true, mandatory: true });
    // Renouveler un appareil exige une session complète (MFA déjà vérifiée).
    if (enrolled && token.scope !== 'full') throw new HttpError(403, { fr: 'Session complète requise', en: 'Full session required' }, { code: 'mfa_required' });
    const secret = newTotpSecret();
    await conn.execute({ sql: 'UPDATE applications SET totp_pending_secret = ? WHERE id = ?', args: [encryptSecret(secret), sentinel.id] });
    return json(200, { enrolled, mandatory: true, secret, uri: totpUri(secret, sentinel.email) });
  }

  // POST : confirme le secret en attente avec un code valide.
  await enforce(conn, `totp:sentinel:${sentinel.id}`, LIMITS.totpAttemptsPerSentinel.limit, LIMITS.totpAttemptsPerSentinel.window);
  const body = await readJson(request, 2 * 1024);
  const code = String(body.code || '').trim();
  if (!sentinel.totp_pending_secret) {
    throw new HttpError(400, { fr: 'Aucun enrôlement en cours : générez d’abord un code', en: 'No enrollment in progress: generate a code first' }, { code: 'no_pending_enrollment' });
  }
  const { value: pending } = decryptSecret(sentinel.totp_pending_secret);
  const step = verifyTotp(pending, code);
  if (step === null) {
    await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: 'mfa.enrollment_failed', ip });
    throw new HttpError(401, { fr: 'Code 2FA invalide : réessayez', en: 'Invalid 2FA code: try again' }, { code: 'invalid_mfa' });
  }
  await conn.execute({
    sql: 'UPDATE applications SET totp_secret = ?, totp_pending_secret = NULL, totp_last_step = ?, mfa_enrolled_at = ? WHERE id = ?',
    args: [encryptSecret(pending), step, nowIso(), sentinel.id],
  });
  await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: enrolled ? 'mfa.rotated' : 'mfa.enrolled', ip });
  return json(200, {
    success: true,
    message: 'Double authentification activée',
    token: issueToken('sentinel', sentinel.id),
    expires_in: SESSION_TTL,
    sentinel: { id: sentinel.id, firstName: sentinel.first_name, lastName: sentinel.last_name, email: sentinel.email, expertise: sentinel.expertise },
  });
});

// Administration des candidatures et des Sentinels : colonnes explicites (jamais de secret),
// activation avec mot de passe robuste, suspension, réinitialisation MFA, journalisation.
import { db, nowIso } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, text } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../lib/security.mjs';
import { audit } from '../lib/audit.mjs';

const COLUMNS = `id, first_name, last_name, email, phone, expertise, qualifications, experience, capacity,
  linkedin, motivation, habilitation, jurisdictions, status, score, notes, submitted_at, reviewed_at,
  activated_at, mfa_enrolled_at, (totp_secret IS NOT NULL) AS mfa_enrolled`;

const STATUSES = ['pending', 'qualified', 'activated', 'suspended', 'rejected'];

export default handler(async (request, context) => {
  allowMethods(request, 'GET', 'PATCH', 'DELETE');
  requireAdmin(request);
  const conn = await db();
  const ip = clientIp(request, context);
  const params = new URL(request.url).searchParams;

  if (request.method === 'GET') {
    if (params.get('id')) {
      const res = await conn.execute({ sql: `SELECT ${COLUMNS} FROM applications WHERE id = ?`, args: [params.get('id')] });
      if (!res.rows.length) throw new HttpError(404, { fr: 'Introuvable', en: 'Not found' }, { code: 'not_found' });
      return json(200, { application: res.rows[0] });
    }
    const where = [];
    const args = [];
    if (params.get('status')) {
      where.push('status = ?');
      args.push(params.get('status'));
    }
    if (params.get('expertise')) {
      where.push('expertise = ?');
      args.push(params.get('expertise'));
    }
    const res = await conn.execute({
      sql: `SELECT ${COLUMNS} FROM applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY submitted_at DESC LIMIT 500`,
      args,
    });
    const stats = await conn.execute(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified,
        SUM(CASE WHEN status = 'activated' THEN 1 ELSE 0 END) AS activated,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM applications`);
    return json(200, { entries: res.rows, stats: stats.rows[0] || {} });
  }

  const body = await readJson(request, 16 * 1024);
  const id = text(body.id, 64);
  if (!id) throw new HttpError(400, { fr: 'id manquant', en: 'Missing id' }, { code: 'missing_fields' });

  if (request.method === 'PATCH') {
    const sets = [];
    const args = [];
    const changes = {};
    const now = nowIso();

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        throw new HttpError(400, { fr: `Statut invalide (${STATUSES.join(', ')})`, en: `Invalid status (${STATUSES.join(', ')})` }, { code: 'invalid_status' });
      }
      sets.push('status = ?', 'reviewed_at = ?');
      args.push(body.status, now);
      changes.status = body.status;
      if (body.status === 'activated') {
        const current = await conn.execute({ sql: 'SELECT password_hash, habilitation FROM applications WHERE id = ?', args: [id] });
        if (!current.rows.length) throw new HttpError(404, { fr: 'Introuvable', en: 'Not found' }, { code: 'not_found' });
        // Seuls les professionnels disposant d'une habilitation active sont activés (voir la page Devenir Sentinel).
        if (current.rows[0].habilitation !== 'oui') {
          throw new HttpError(
            409,
            { fr: 'Activation impossible : le candidat n’a pas déclaré d’habilitation professionnelle active', en: 'Cannot activate: the applicant did not declare an active professional authorization' },
            { code: 'habilitation_required' }
          );
        }
        const hasPassword = Boolean(current.rows[0].password_hash);
        if (body.password || !hasPassword) {
          if (typeof body.password !== 'string' || body.password.length < PASSWORD_MIN_LENGTH) {
            throw new HttpError(
              400,
              { fr: `Mot de passe requis : ${PASSWORD_MIN_LENGTH} caractères minimum`, en: `Password required: at least ${PASSWORD_MIN_LENGTH} characters` },
              { code: 'weak_password' }
            );
          }
          const { salt, hash } = await hashPassword(body.password);
          sets.push('password_salt = ?', 'password_hash = ?');
          args.push(salt, hash);
          changes.password = 'set';
        }
        sets.push('activated_at = COALESCE(activated_at, ?)');
        args.push(now);
      }
    }
    if (body.notes !== undefined) {
      sets.push('notes = ?');
      args.push(text(body.notes, 4000));
      changes.notes = true;
    }
    // La MFA est obligatoire : l'administration peut seulement la réinitialiser (nouvel enrôlement exigé).
    if (body.reset_mfa === true) {
      sets.push('totp_secret = NULL', 'totp_pending_secret = NULL', 'totp_last_step = NULL', 'mfa_enrolled_at = NULL');
      changes.mfa = 'reset';
    }
    if (!sets.length) throw new HttpError(400, { fr: 'Rien à mettre à jour', en: 'Nothing to update' }, { code: 'nothing_to_update' });

    args.push(id);
    const res = await conn.execute({ sql: `UPDATE applications SET ${sets.join(', ')} WHERE id = ?`, args });
    if (!res.rowsAffected) throw new HttpError(404, { fr: 'Introuvable', en: 'Not found' }, { code: 'not_found' });
    await audit(conn, { actor_type: 'admin', actor_id: 'admin', action: 'application.updated', target_type: 'application', target_id: id, ip, details: changes });
    return json(200, { ok: true });
  }

  // DELETE : impossible si le Sentinel a déjà rendu des décisions (piste d'audit à conserver).
  const decisions = await conn.execute({ sql: 'SELECT COUNT(*) AS n FROM decisions WHERE sentinel_id = ?', args: [id] });
  if (Number(decisions.rows[0].n) > 0) {
    throw new HttpError(
      409,
      { fr: 'Ce Sentinel a rendu des décisions : suspendez-le plutôt que de le supprimer.', en: 'This Sentinel has decisions on record: suspend instead of deleting.' },
      { code: 'has_decisions' }
    );
  }
  await conn.execute({ sql: "UPDATE ai_requests SET assigned_to = NULL, status = 'pending' WHERE assigned_to = ? AND status IN ('assigned', 'sla_breached')", args: [id] });
  const res = await conn.execute({ sql: 'DELETE FROM applications WHERE id = ?', args: [id] });
  if (!res.rowsAffected) throw new HttpError(404, { fr: 'Introuvable', en: 'Not found' }, { code: 'not_found' });
  await audit(conn, { actor_type: 'admin', actor_id: 'admin', action: 'application.deleted', target_type: 'application', target_id: id, ip });
  return json(200, { ok: true });
});

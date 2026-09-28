// Profil et statistiques du Sentinel connecté ; mise à jour limitée au téléphone et à LinkedIn.
import { db } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, text } from '../lib/http.mjs';
import { requireSentinel } from '../lib/auth.mjs';
import { audit } from '../lib/audit.mjs';

export default handler(async (request, context) => {
  allowMethods(request, 'GET', 'PATCH');
  const conn = await db();
  const { sentinel } = await requireSentinel(conn, request);

  if (request.method === 'GET') {
    const [profile, stats, pending] = await Promise.all([
      conn.execute({
        sql: `SELECT id, first_name, last_name, email, phone, expertise, qualifications, experience, linkedin,
                jurisdictions, score, activated_at, mfa_enrolled_at FROM applications WHERE id = ?`,
        args: [sentinel.id],
      }),
      conn.execute({
        sql: `SELECT COUNT(*) AS total,
                SUM(CASE WHEN verdict = 'approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN verdict = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN verdict = 'escalated' THEN 1 ELSE 0 END) AS escalated
              FROM decisions WHERE sentinel_id = ?`,
        args: [sentinel.id],
      }),
      conn.execute({
        sql: "SELECT COUNT(*) AS n FROM ai_requests WHERE assigned_to = ? AND status IN ('assigned', 'sla_breached')",
        args: [sentinel.id],
      }),
    ]);
    const p = profile.rows[0];
    const s = stats.rows[0] || {};
    const total = Number(s.total || 0);
    const approved = Number(s.approved || 0);
    const rejected = Number(s.rejected || 0);
    const finals = approved + rejected;
    return json(200, {
      profile: {
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        email: p.email,
        phone: p.phone,
        expertise: p.expertise,
        qualifications: p.qualifications,
        experience: p.experience,
        linkedin: p.linkedin,
        jurisdictions: p.jurisdictions,
        score: p.score,
        activatedAt: p.activated_at,
        mfaEnrolledAt: p.mfa_enrolled_at,
      },
      stats: {
        totalDecisions: total,
        approvedCount: approved,
        rejectedCount: rejected,
        escalatedCount: Number(s.escalated || 0),
        approvalRate: finals > 0 ? Math.round((approved / finals) * 100) : 0,
        pendingRequests: Number(pending.rows[0].n || 0),
      },
    });
  }

  const body = await readJson(request, 4 * 1024);
  const sets = [];
  const args = [];
  if (body.phone !== undefined) {
    sets.push('phone = ?');
    args.push(text(body.phone, 40));
  }
  if (body.linkedin !== undefined) {
    const linkedin = text(body.linkedin, 300);
    if (linkedin && !/^https:\/\//i.test(linkedin)) {
      throw new HttpError(400, { fr: 'Le profil LinkedIn doit être une URL https', en: 'LinkedIn profile must be an https URL' }, { code: 'invalid_field' });
    }
    sets.push('linkedin = ?');
    args.push(linkedin);
  }
  if (!sets.length) throw new HttpError(400, { fr: 'Aucun champ modifiable fourni', en: 'No updatable field provided' }, { code: 'nothing_to_update' });
  args.push(sentinel.id);
  await conn.execute({ sql: `UPDATE applications SET ${sets.join(', ')} WHERE id = ?`, args });
  await audit(conn, { actor_type: 'sentinel', actor_id: sentinel.id, action: 'sentinel.profile_updated', ip: clientIp(request, context) });
  return json(200, { ok: true });
});

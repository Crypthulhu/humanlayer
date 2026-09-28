// Routage vers un Sentinel qualifié, suivi des SLA et escalade automatique.
import { LEVELS, normalizeType } from './plans.mjs';
import { audit } from './audit.mjs';
import { deliverWebhook } from './webhooks.mjs';

const escapeLike = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

export const OPEN_STATUSES = ['pending', 'assigned', 'sla_breached'];
export const MAX_ESCALATIONS = 3;

export const slaFor = (requestType) => LEVELS[normalizeType(requestType) || 'compliance'].sla_minutes;
export const expiryAfter = (minutes, from = Date.now()) => new Date(from + minutes * 60000).toISOString();

/**
 * Sentinel actif, MFA configurée, du bon domaine (et de la bonne juridiction),
 * le moins chargé d'abord puis le mieux noté.
 */
export async function findSentinel(conn, { domain, jurisdiction = null, exclude = [] }) {
  const where = ["a.status = 'activated'", 'a.totp_secret IS NOT NULL', 'a.expertise = ?'];
  const args = [domain];
  if (jurisdiction) {
    where.push("a.jurisdictions LIKE ? ESCAPE '\\'");
    args.push(`%${escapeLike(jurisdiction)}%`);
  }
  const excluded = exclude.filter(Boolean);
  if (excluded.length) {
    where.push(`a.id NOT IN (${excluded.map(() => '?').join(', ')})`);
    args.push(...excluded);
  }
  const res = await conn.execute({
    sql: `SELECT a.id,
            (SELECT COUNT(*) FROM ai_requests r WHERE r.assigned_to = a.id AND r.status IN ('assigned', 'sla_breached')) AS open_count
          FROM applications a
          WHERE ${where.join(' AND ')}
          ORDER BY open_count ASC, a.score DESC
          LIMIT 1`,
    args,
  });
  return res.rows.length ? res.rows[0].id : null;
}

/**
 * Sentinels ayant déjà traité la demande, ou la demande d'origine s'il s'agit
 * d'un second avis : ils sont exclus du routage, des escalades et des réassignations.
 */
export async function previousDeciders(conn, requestId) {
  const res = await conn.execute({
    sql: `SELECT DISTINCT sentinel_id FROM decisions
          WHERE request_id = ?
             OR request_id = (SELECT second_opinion_of FROM ai_requests WHERE id = ?)`,
    args: [requestId, requestId],
  });
  return res.rows.map((r) => r.sentinel_id);
}

/**
 * Contrôle des SLA : signale chaque dépassement (webhook sla.breached, une fois),
 * réassigne à un autre Sentinel (escalade, trois fois au plus), puis route les
 * demandes encore sans Sentinel.
 */
export async function sweep(conn, { ids = null, limit = 50 } = {}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const scoped = Array.isArray(ids) && ids.length;
  const idFilter = scoped ? ` AND id IN (${ids.map(() => '?').join(', ')})` : '';
  const stats = { breached: 0, escalated: 0, routed: 0 };

  const overdue = await conn.execute({
    sql: `SELECT * FROM ai_requests
          WHERE status IN ('pending', 'assigned', 'sla_breached') AND expires_at IS NOT NULL AND expires_at < ?${idFilter}
          ORDER BY expires_at ASC LIMIT ${Number(limit)}`,
    args: scoped ? [nowIso, ...ids] : [nowIso],
  });

  for (const r of overdue.rows) {
    if (!r.sla_breached_at) {
      const marked = await conn.execute({
        sql: 'UPDATE ai_requests SET sla_breached_at = ? WHERE id = ? AND sla_breached_at IS NULL',
        args: [nowIso, r.id],
      });
      if (marked.rowsAffected) {
        stats.breached++;
        await audit(conn, { actor_type: 'system', action: 'request.sla_breached', target_type: 'request', target_id: r.id, details: { expires_at: r.expires_at } });
        if (r.callback_url) {
          await deliverWebhook(conn, {
            url: r.callback_url,
            keyId: r.api_key_id,
            requestId: r.id,
            event: 'sla.breached',
            data: { request_id: r.id, status: r.status, expires_at: r.expires_at, breached_at: nowIso },
          });
        }
      }
    }

    if (Number(r.escalation_count || 0) >= MAX_ESCALATIONS) {
      if (r.status !== 'sla_breached') {
        await conn.execute({ sql: "UPDATE ai_requests SET status = 'sla_breached' WHERE id = ? AND status IN ('pending', 'assigned')", args: [r.id] });
      }
      continue;
    }

    const exclude = [r.assigned_to, ...(await previousDeciders(conn, r.id))];
    const next = await findSentinel(conn, { domain: r.domain, jurisdiction: r.jurisdiction, exclude });
    if (next) {
      const moved = await conn.execute({
        sql: `UPDATE ai_requests
              SET assigned_to = ?, assigned_at = ?, status = 'assigned', expires_at = ?,
                  escalation_count = COALESCE(escalation_count, 0) + 1
              WHERE id = ? AND status IN ('pending', 'assigned', 'sla_breached') AND expires_at < ?`,
        args: [next, nowIso, expiryAfter(slaFor(r.request_type), now), r.id, nowIso],
      });
      if (moved.rowsAffected) {
        stats.escalated++;
        await audit(conn, {
          actor_type: 'system',
          action: 'request.escalated',
          target_type: 'request',
          target_id: r.id,
          details: { reason: 'sla_breached', from: r.assigned_to, to: next },
        });
      }
    } else if (r.status !== 'sla_breached') {
      await conn.execute({ sql: "UPDATE ai_requests SET status = 'sla_breached' WHERE id = ? AND status IN ('pending', 'assigned')", args: [r.id] });
    }
  }

  // Demandes sans Sentinel encore dans les délais : nouvel essai de routage.
  const waiting = await conn.execute({
    sql: `SELECT * FROM ai_requests WHERE status = 'pending' AND assigned_to IS NULL${idFilter} ORDER BY created_at ASC LIMIT ${Number(limit)}`,
    args: scoped ? [...ids] : [],
  });
  for (const r of waiting.rows) {
    const next = await findSentinel(conn, { domain: r.domain, jurisdiction: r.jurisdiction, exclude: await previousDeciders(conn, r.id) });
    if (!next) continue;
    const assigned = await conn.execute({
      sql: "UPDATE ai_requests SET assigned_to = ?, assigned_at = ?, status = 'assigned' WHERE id = ? AND status = 'pending' AND assigned_to IS NULL",
      args: [next, nowIso, r.id],
    });
    if (assigned.rowsAffected) {
      stats.routed++;
      await audit(conn, { actor_type: 'system', action: 'request.routed', target_type: 'request', target_id: r.id, details: { to: next } });
    }
  }

  return stats;
}

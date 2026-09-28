// Vue administrateur des demandes : une ligne par demande, dernière décision et signature.
import { db, LATEST_DECISION_JOIN } from '../lib/db.mjs';
import { handler, allowMethods, json } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { sweep } from '../lib/routing.mjs';

export default handler(async (request) => {
  allowMethods(request, 'GET');
  requireAdmin(request);
  const conn = await db();
  await sweep(conn, { limit: 25 });
  const res = await conn.execute(`
    SELECT r.id, r.agent_id, r.agent_name, r.request_type, r.domain, r.jurisdiction, r.summary, r.priority,
           r.status, r.created_at, r.assigned_at, r.decided_at, r.expires_at, r.sla_breached_at,
           r.escalation_count, r.webhook_status, r.api_key_id,
           a.first_name AS sentinel_first_name, a.last_name AS sentinel_last_name,
           d.verdict, d.reasoning, d.signed_at AS decision_signed_at, d.signature, d.key_id
    FROM ai_requests r
    LEFT JOIN applications a ON a.id = r.assigned_to
    ${LATEST_DECISION_JOIN}
    ORDER BY r.created_at DESC
    LIMIT 200`);
  return json(200, { requests: res.rows });
});

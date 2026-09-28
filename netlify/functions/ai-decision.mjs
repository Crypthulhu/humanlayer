// Décisions des Sentinels : file d'attente et verdicts signés (Ed25519), enregistrés de
// façon atomique ; l'escalade confie la demande à un autre Sentinel (second avis).
import crypto from 'node:crypto';
import { db, nowIso, LATEST_DECISION_JOIN } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, text } from '../lib/http.mjs';
import { requireSentinel } from '../lib/auth.mjs';
import { signDecision, sentinelRef, sha256hex } from '../lib/security.mjs';
import { findSentinel, previousDeciders, sweep, slaFor, expiryAfter, MAX_ESCALATIONS } from '../lib/routing.mjs';
import { deliverWebhook } from '../lib/webhooks.mjs';
import { audit } from '../lib/audit.mjs';

const VERDICTS = ['approved', 'rejected', 'escalated'];
const EVENTS = { approved: 'decision.completed', rejected: 'decision.rejected', escalated: 'decision.escalated' };

export default handler(async (request, context) => {
  allowMethods(request, 'GET', 'POST');
  const conn = await db();
  const { sentinel } = await requireSentinel(conn, request);
  const ip = clientIp(request, context);

  if (request.method === 'GET') {
    await sweep(conn, { limit: 25 });
    // Demandes en cours assignées au Sentinel, plus celles qu'il a déjà tranchées.
    const res = await conn.execute({
      sql: `SELECT r.id, r.agent_id, r.agent_name, r.request_type, r.domain, r.jurisdiction, r.summary, r.context_json,
              r.priority, r.status, r.created_at, r.assigned_at, r.decided_at, r.expires_at, r.sla_breached_at,
              r.escalation_count, (r.second_opinion_of IS NOT NULL) AS second_opinion,
              d.verdict, d.reasoning, d.signed_at AS decision_signed_at, d.signature
            FROM ai_requests r
            ${LATEST_DECISION_JOIN}
            WHERE r.assigned_to = ?
               OR r.id IN (SELECT request_id FROM decisions WHERE sentinel_id = ?)
            ORDER BY r.created_at DESC LIMIT 100`,
      args: [sentinel.id, sentinel.id],
    });
    // Une demande escaladée par ce Sentinel apparaît dans son historique, pas dans sa file.
    const requests = res.rows.map((r) => (r.status !== 'decided' && r.verdict === 'escalated' ? { ...r, status: 'escalated' } : r));
    return json(200, { requests });
  }

  const body = await readJson(request, 32 * 1024);
  const requestId = text(body.request_id, 64);
  const verdict = body.verdict;
  const reasoning = text(body.reasoning, 5000);
  if (!requestId || !VERDICTS.includes(verdict)) {
    throw new HttpError(400, { fr: 'request_id et verdict (approved, rejected, escalated) requis', en: 'request_id and verdict (approved, rejected, escalated) required' }, { code: 'missing_fields' });
  }
  if (!reasoning || reasoning.length < 10) {
    throw new HttpError(400, { fr: 'La justification est obligatoire (10 caractères minimum)', en: 'A justification is required (at least 10 characters)' }, { code: 'reasoning_required' });
  }

  const decisionId = crypto.randomUUID();
  const signedAt = nowIso();
  const signed = signDecision({
    v: 1,
    decision_id: decisionId,
    request_id: requestId,
    verdict,
    reasoning_sha256: sha256hex(reasoning),
    sentinel_ref: sentinelRef(sentinel.id),
    signed_at: signedAt,
  });

  let row;
  let nextSentinel = null;
  const tx = await conn.transaction('write');
  try {
    const found = await tx.execute({
      sql: "SELECT * FROM ai_requests WHERE id = ? AND assigned_to = ? AND status IN ('assigned', 'sla_breached')",
      args: [requestId, sentinel.id],
    });
    if (!found.rows.length) {
      const exists = await tx.execute({ sql: 'SELECT status, assigned_to FROM ai_requests WHERE id = ?', args: [requestId] });
      await tx.rollback();
      if (exists.rows.length && exists.rows[0].status === 'decided') {
        throw new HttpError(409, { fr: 'Cette demande a déjà été tranchée', en: 'This request has already been decided' }, { code: 'already_decided' });
      }
      throw new HttpError(404, { fr: 'Demande introuvable ou non assignée à ce Sentinel', en: 'Request not found or not assigned to this Sentinel' }, { code: 'not_found' });
    }
    row = found.rows[0];

    await tx.execute({
      sql: `INSERT INTO decisions (id, request_id, sentinel_id, verdict, reasoning, signed_at, ip_address, signature, signed_payload, key_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [decisionId, requestId, sentinel.id, verdict, reasoning, signedAt, ip, signed.signature, signed.canonical, signed.keyId],
    });

    if (verdict === 'escalated') {
      const exclude = [sentinel.id, ...(await previousDeciders(tx, requestId))];
      nextSentinel = Number(row.escalation_count || 0) < MAX_ESCALATIONS
        ? await findSentinel(tx, { domain: row.domain, jurisdiction: row.jurisdiction, exclude })
        : null;
      await tx.execute({
        sql: `UPDATE ai_requests SET assigned_to = ?, assigned_at = ?, status = ?, expires_at = ?,
                escalation_count = COALESCE(escalation_count, 0) + 1
              WHERE id = ?`,
        args: [nextSentinel, nextSentinel ? signedAt : null, nextSentinel ? 'assigned' : 'pending', expiryAfter(slaFor(row.request_type)), requestId],
      });
    } else {
      await tx.execute({ sql: "UPDATE ai_requests SET status = 'decided', decided_at = ? WHERE id = ?", args: [signedAt, requestId] });
    }
    await tx.commit();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    try {
      await tx.rollback();
    } catch {
      /* déjà annulée */
    }
    // Décision concurrente : l'index unique refuse la seconde.
    if (/UNIQUE/i.test(String(err && err.message))) {
      throw new HttpError(409, { fr: 'Cette demande a déjà été tranchée', en: 'This request has already been decided' }, { code: 'already_decided' });
    }
    throw err;
  }

  await audit(conn, {
    actor_type: 'sentinel',
    actor_id: sentinel.id,
    action: `decision.${verdict}`,
    target_type: 'request',
    target_id: requestId,
    ip,
    details: { decision_id: decisionId, next: nextSentinel ? sentinelRef(nextSentinel) : null },
  });

  if (row.callback_url) {
    await deliverWebhook(conn, {
      url: row.callback_url,
      keyId: row.api_key_id,
      requestId,
      event: EVENTS[verdict],
      data: {
        request_id: requestId,
        decision_id: decisionId,
        status: verdict === 'escalated' ? (nextSentinel ? 'assigned' : 'pending') : 'decided',
        verdict,
        reasoning,
        sentinel_ref: sentinelRef(sentinel.id),
        signed_at: signedAt,
        signature: signed.signature,
        signed_payload: signed.canonical,
        key_id: signed.keyId,
      },
    });
  }

  return json(200, {
    ok: true,
    decision_id: decisionId,
    verdict,
    signed_at: signedAt,
    signature: signed.signature,
    key_id: signed.keyId,
    escalated_to: nextSentinel ? sentinelRef(nextSentinel) : null,
  });
});

// Gestion administrateur des clés d'API : la clé complète n'est montrée qu'à la création,
// seule son empreinte est stockée ; forfaits et quotas proviennent de lib/plans.mjs.
import crypto from 'node:crypto';
import { db, nowIso, startOfTodayIso } from '../lib/db.mjs';
import { handler, allowMethods, readJson, clientIp, json, HttpError, text, isEmail } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { newApiKey, webhookSecretFor } from '../lib/security.mjs';
import { PLANS, publicPlans } from '../lib/plans.mjs';
import { audit } from '../lib/audit.mjs';

const KEY_COLUMNS = `k.id, k.client_name, k.client_email, k.key_prefix, k.tier, k.status, k.daily_limit,
  k.total_used, k.created_at, k.expires_at, k.notes, k.client_id`;

export default handler(async (request, context) => {
  allowMethods(request, 'GET', 'POST', 'PATCH', 'DELETE');
  requireAdmin(request);
  const conn = await db();
  const ip = clientIp(request, context);
  const params = new URL(request.url).searchParams;

  if (request.method === 'GET') {
    const res = await conn.execute({
      sql: `SELECT ${KEY_COLUMNS},
              (SELECT COUNT(*) FROM ai_requests r WHERE r.api_key_id = k.id) AS total_requests,
              (SELECT COUNT(*) FROM ai_requests r WHERE r.api_key_id = k.id AND r.created_at >= ?) AS today_requests
            FROM api_keys k ORDER BY k.created_at DESC`,
      args: [startOfTodayIso()],
    });
    return json(200, { keys: res.rows.map((k) => ({ ...k, key_prefix: k.key_prefix || 'hl_live_…' })), tiers: publicPlans() });
  }

  if (request.method === 'DELETE') {
    const id = text(params.get('id'), 64);
    if (!id) throw new HttpError(400, { fr: 'id manquant', en: 'Missing id' }, { code: 'missing_fields' });
    const res = await conn.execute({ sql: "UPDATE api_keys SET status = 'revoked' WHERE id = ?", args: [id] });
    if (!res.rowsAffected) throw new HttpError(404, { fr: 'Clé introuvable', en: 'Key not found' }, { code: 'not_found' });
    await audit(conn, { actor_type: 'admin', actor_id: 'admin', action: 'api_key.revoked', target_type: 'api_key', target_id: id, ip });
    return json(200, { ok: true, status: 'revoked' });
  }

  const body = await readJson(request, 8 * 1024);

  if (request.method === 'POST') {
    const clientName = text(body.client_name, 120);
    const clientEmail = text(body.client_email, 254)?.toLowerCase();
    if (!clientName || !isEmail(clientEmail)) {
      throw new HttpError(400, { fr: 'client_name et client_email valides requis', en: 'Valid client_name and client_email required' }, { code: 'missing_fields' });
    }
    const tier = PLANS[body.tier] ? body.tier : 'compliance';
    const key = newApiKey(body.env === 'test' ? 'test' : 'live');
    const id = crypto.randomUUID();
    const now = nowIso();
    await conn.execute({
      sql: `INSERT INTO api_keys (id, client_name, client_email, api_key, key_prefix, tier, status, daily_limit, total_used, created_at, notes, client_id)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)`,
      args: [id, clientName, clientEmail, key.stored, key.prefix, tier, PLANS[tier].daily_limit, now, text(body.notes, 1000), text(body.client_id, 64)],
    });
    await audit(conn, { actor_type: 'admin', actor_id: 'admin', action: 'api_key.created', target_type: 'api_key', target_id: id, ip, details: { tier } });
    return json(200, {
      ok: true,
      key: {
        id,
        client_name: clientName,
        client_email: clientEmail,
        api_key: key.raw,
        key_prefix: key.prefix,
        webhook_secret: webhookSecretFor(id),
        tier,
        tier_label: PLANS[tier].label,
        daily_limit: PLANS[tier].daily_limit,
        status: 'active',
        created_at: now,
      },
    });
  }

  // PATCH : forfait, quota, statut, notes, expiration
  const id = text(body.id, 64);
  if (!id) throw new HttpError(400, { fr: 'id manquant', en: 'Missing id' }, { code: 'missing_fields' });
  const sets = [];
  const args = [];
  if (body.tier !== undefined) {
    if (!PLANS[body.tier]) throw new HttpError(400, { fr: 'Forfait inconnu', en: 'Unknown plan' }, { code: 'invalid_tier' });
    sets.push('tier = ?');
    args.push(body.tier);
    if (body.daily_limit === undefined) {
      sets.push('daily_limit = ?');
      args.push(PLANS[body.tier].daily_limit);
    }
  }
  if (body.daily_limit !== undefined) {
    const n = Number(body.daily_limit);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new HttpError(400, { fr: 'Quota invalide', en: 'Invalid daily limit' }, { code: 'invalid_limit' });
    sets.push('daily_limit = ?');
    args.push(n);
  }
  if (body.status !== undefined) {
    if (!['active', 'suspended', 'revoked'].includes(body.status)) throw new HttpError(400, { fr: 'Statut invalide', en: 'Invalid status' }, { code: 'invalid_status' });
    sets.push('status = ?');
    args.push(body.status);
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?');
    args.push(text(body.notes, 1000));
  }
  if (body.expires_at !== undefined) {
    const d = body.expires_at ? new Date(body.expires_at) : null;
    if (d && Number.isNaN(d.getTime())) throw new HttpError(400, { fr: 'Date invalide', en: 'Invalid date' }, { code: 'invalid_date' });
    sets.push('expires_at = ?');
    args.push(d ? d.toISOString() : null);
  }
  if (!sets.length) throw new HttpError(400, { fr: 'Rien à mettre à jour', en: 'Nothing to update' }, { code: 'nothing_to_update' });
  args.push(id);
  const res = await conn.execute({ sql: `UPDATE api_keys SET ${sets.join(', ')} WHERE id = ?`, args });
  if (!res.rowsAffected) throw new HttpError(404, { fr: 'Clé introuvable', en: 'Key not found' }, { code: 'not_found' });
  await audit(conn, { actor_type: 'admin', actor_id: 'admin', action: 'api_key.updated', target_type: 'api_key', target_id: id, ip, details: { tier: body.tier, status: body.status, daily_limit: body.daily_limit } });
  return json(200, { ok: true });
});

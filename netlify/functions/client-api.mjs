// Espace client : inscription (forfaits publics uniquement), clés d'API hachées,
// suivi des demandes et export signé du journal des décisions.
import crypto from 'node:crypto';
import { db, nowIso, startOfTodayIso, LATEST_DECISION_JOIN } from '../lib/db.mjs';
import { handler, readJson, clientIp, json, HttpError, text, isEmail } from '../lib/http.mjs';
import { requireClient } from '../lib/auth.mjs';
import { hashPassword, newApiKey, webhookSecretFor, PASSWORD_MIN_LENGTH } from '../lib/security.mjs';
import { PLANS, publicPlans, selfServicePlan } from '../lib/plans.mjs';
import { enforce, LIMITS } from '../lib/ratelimit.mjs';
import { audit } from '../lib/audit.mjs';

const MAX_KEYS = 5;
const notFound = () => new HttpError(404, { fr: 'Clé introuvable', en: 'Key not found' }, { code: 'not_found' });

async function register(request, context) {
  const conn = await db();
  const ip = clientIp(request, context);
  await enforce(conn, `register:ip:${ip}`, LIMITS.registerPerIp.limit, LIMITS.registerPerIp.window);
  const body = await readJson(request, 8 * 1024);
  const company = text(body.company_name, 120);
  const email = text(body.email, 254)?.toLowerCase();
  if (!company || !isEmail(email) || typeof body.password !== 'string') {
    throw new HttpError(400, { fr: 'Entreprise, courriel valide et mot de passe requis', en: 'Company, valid email and password required' }, { code: 'missing_fields' });
  }
  if (body.password.length < PASSWORD_MIN_LENGTH) {
    throw new HttpError(
      400,
      { fr: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères`, en: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` },
      { code: 'weak_password' }
    );
  }
  // Seuls les forfaits publics sont accessibles en libre-service ; Enterprise passe par l'équipe.
  const tier = selfServicePlan(body.tier);
  const clientId = crypto.randomUUID();
  const keyId = crypto.randomUUID();
  const key = newApiKey('live');
  const now = nowIso();
  const { salt, hash } = await hashPassword(body.password);
  try {
    await conn.batch(
      [
        {
          sql: `INSERT INTO clients (id, company_name, email, password_hash, password_salt, tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
          args: [clientId, company, email, hash, salt, tier, now],
        },
        {
          sql: `INSERT INTO api_keys (id, client_name, client_email, api_key, key_prefix, tier, status, daily_limit, total_used, created_at, client_id)
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
          args: [keyId, company, email, key.stored, key.prefix, tier, PLANS[tier].daily_limit, now, clientId],
        },
      ],
      'write'
    );
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) {
      throw new HttpError(409, { fr: 'Un compte existe déjà avec ce courriel', en: 'An account already exists for this email' }, { code: 'email_taken' });
    }
    throw err;
  }
  await audit(conn, { actor_type: 'client', actor_id: clientId, action: 'client.registered', ip, details: { tier } });
  return json(200, {
    ok: true,
    client_id: clientId,
    api_key: key.raw,
    key_prefix: key.prefix,
    webhook_secret: webhookSecretFor(keyId),
    tier,
    tier_label: PLANS[tier].label,
  });
}

export default handler(async (request, context) => {
  const action = new URL(request.url).searchParams.get('action');
  if (request.method === 'POST' && action === 'register') return register(request, context);

  const conn = await db();
  const { client } = await requireClient(conn, request);
  const ip = clientIp(request, context);
  const params = new URL(request.url).searchParams;

  if (request.method === 'GET' && action === 'dashboard') {
    const [keys, stats] = await Promise.all([
      conn.execute({ sql: "SELECT COUNT(*) AS n FROM api_keys WHERE client_id = ? AND status = 'active'", args: [client.id] }),
      conn.execute({
        sql: `SELECT COUNT(*) AS total,
                SUM(CASE WHEN r.created_at >= ? THEN 1 ELSE 0 END) AS today,
                SUM(CASE WHEN r.status IN ('pending', 'assigned', 'sla_breached') THEN 1 ELSE 0 END) AS in_progress,
                SUM(CASE WHEN r.status = 'decided' THEN 1 ELSE 0 END) AS decided
              FROM ai_requests r JOIN api_keys k ON r.api_key_id = k.id WHERE k.client_id = ?`,
        args: [startOfTodayIso(), client.id],
      }),
    ]);
    const s = stats.rows[0] || {};
    return json(200, {
      client: { company_name: client.company_name, email: client.email, tier: client.tier, tier_label: PLANS[client.tier]?.label || client.tier, created_at: client.created_at },
      stats: {
        active_keys: Number(keys.rows[0]?.n || 0),
        total_requests: Number(s.total || 0),
        today_requests: Number(s.today || 0),
        in_progress: Number(s.in_progress || 0),
        decided: Number(s.decided || 0),
      },
      tiers: publicPlans(),
    });
  }

  if (request.method === 'GET' && action === 'keys') {
    const res = await conn.execute({
      sql: `SELECT k.id, k.key_prefix, k.tier, k.status, k.daily_limit, k.total_used, k.created_at, k.expires_at,
              (SELECT COUNT(*) FROM ai_requests r WHERE r.api_key_id = k.id AND r.created_at >= ?) AS today_requests
            FROM api_keys k WHERE k.client_id = ? ORDER BY k.created_at DESC`,
      args: [startOfTodayIso(), client.id],
    });
    return json(200, { keys: res.rows.map((k) => ({ ...k, key_prefix: k.key_prefix || 'hl_live_…' })) });
  }

  if (request.method === 'POST' && action === 'create-key') {
    const existing = await conn.execute({
      sql: `SELECT SUM(CASE WHEN status != 'revoked' THEN 1 ELSE 0 END) AS open,
                   SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
            FROM api_keys WHERE client_id = ?`,
      args: [client.id],
    });
    const row = existing.rows[0] || {};
    // Une suspension décidée par l'administration ne se contourne pas en recréant une clé.
    if (Number(row.suspended || 0) > 0) {
      throw new HttpError(403, { fr: 'Une clé est suspendue : contactez le support', en: 'A key is suspended: contact support' }, { code: 'key_suspended' });
    }
    if (Number(row.open || 0) >= MAX_KEYS) {
      throw new HttpError(400, { fr: `Maximum de ${MAX_KEYS} clés actives atteint`, en: `Maximum of ${MAX_KEYS} active keys reached` }, { code: 'too_many_keys' });
    }
    const plan = PLANS[client.tier] || PLANS.compliance;
    const keyId = crypto.randomUUID();
    const key = newApiKey('live');
    const now = nowIso();
    await conn.execute({
      sql: `INSERT INTO api_keys (id, client_name, client_email, api_key, key_prefix, tier, status, daily_limit, total_used, created_at, client_id)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
      args: [keyId, client.company_name, client.email, key.stored, key.prefix, client.tier, plan.daily_limit, now, client.id],
    });
    await audit(conn, { actor_type: 'client', actor_id: client.id, action: 'api_key.created', target_type: 'api_key', target_id: keyId, ip });
    return json(200, {
      ok: true,
      key: { id: keyId, api_key: key.raw, key_prefix: key.prefix, webhook_secret: webhookSecretFor(keyId), tier: client.tier, daily_limit: plan.daily_limit, created_at: now },
    });
  }

  if (request.method === 'PATCH' && action === 'revoke-key') {
    const body = await readJson(request, 2 * 1024);
    const keyId = text(body.key_id, 64);
    if (!keyId) throw new HttpError(400, { fr: 'key_id requis', en: 'key_id required' }, { code: 'missing_fields' });
    const res = await conn.execute({ sql: 'SELECT status FROM api_keys WHERE id = ? AND client_id = ?', args: [keyId, client.id] });
    if (!res.rows.length) throw notFound();
    if (res.rows[0].status === 'suspended') {
      throw new HttpError(403, { fr: 'Clé suspendue par l’administration : contactez le support', en: 'Key suspended by administration: contact support' }, { code: 'key_suspended' });
    }
    await conn.execute({ sql: "UPDATE api_keys SET status = 'revoked' WHERE id = ? AND client_id = ? AND status = 'active'", args: [keyId, client.id] });
    await audit(conn, { actor_type: 'client', actor_id: client.id, action: 'api_key.revoked', target_type: 'api_key', target_id: keyId, ip });
    return json(200, { ok: true });
  }

  if (request.method === 'GET' && action === 'webhook-secret') {
    const keyId = text(params.get('key_id'), 64);
    const res = await conn.execute({ sql: "SELECT id FROM api_keys WHERE id = ? AND client_id = ? AND status != 'revoked'", args: [keyId, client.id] });
    if (!res.rows.length) throw notFound();
    await audit(conn, { actor_type: 'client', actor_id: client.id, action: 'webhook_secret.viewed', target_type: 'api_key', target_id: keyId, ip });
    return json(200, { key_id: keyId, webhook_secret: webhookSecretFor(keyId) });
  }

  if (request.method === 'GET' && (action === 'requests' || action === 'export')) {
    const exporting = action === 'export';
    const res = await conn.execute({
      sql: `SELECT r.id, r.agent_id, r.agent_name, r.request_type, r.domain, r.summary, r.priority, r.status,
              r.created_at, r.assigned_at, r.decided_at, r.expires_at, r.sla_breached_at, r.escalation_count,
              r.second_opinion_of,
              d.id AS decision_id, d.verdict, d.reasoning, d.signed_at AS decision_signed_at,
              d.signature, d.signed_payload, d.key_id
            FROM ai_requests r
            ${LATEST_DECISION_JOIN}
            JOIN api_keys k ON r.api_key_id = k.id
            WHERE k.client_id = ?
            ORDER BY r.created_at DESC
            LIMIT ${exporting ? 5000 : 200}`,
      args: [client.id],
    });
    if (!exporting) return json(200, { requests: res.rows });
    await audit(conn, { actor_type: 'client', actor_id: client.id, action: 'decisions.exported', ip, details: { count: res.rows.length } });
    return json(
      200,
      {
        exported_at: nowIso(),
        company: client.company_name,
        verification: { algorithm: 'Ed25519', public_key_url: '/api/v1/decision-key', signed_field: 'signed_payload' },
        requests: res.rows,
      },
      { 'Content-Disposition': 'attachment; filename="humanlayer-decisions.json"' }
    );
  }

  throw new HttpError(
    400,
    { fr: 'Action invalide', en: 'Invalid action' },
    { code: 'invalid_action', actions: ['register', 'dashboard', 'keys', 'create-key', 'revoke-key', 'webhook-secret', 'requests', 'export'] }
  );
});

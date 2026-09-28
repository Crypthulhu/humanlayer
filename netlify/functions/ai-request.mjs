// API des agents IA : soumission et suivi des demandes de décision, second avis.
// Authentification par clé d'API (x-api-key), quotas du forfait, SLA par niveau.
import crypto from 'node:crypto';
import { db, nowIso, startOfTodayIso, LATEST_DECISION_JOIN } from '../lib/db.mjs';
import { handler, allowMethods, readJson, requireFields, clientIp, json, HttpError, text } from '../lib/http.mjs';
import { storedKeyFor, keyPrefix, sentinelRef } from '../lib/security.mjs';
import { PLANS, LEVELS, DOMAINS, normalizeType, normalizePriority, slaMinutesFor } from '../lib/plans.mjs';
import { enforce, LIMITS } from '../lib/ratelimit.mjs';
import { checkCallbackUrl } from '../lib/webhooks.mjs';
import { findSentinel, previousDeciders, sweep, expiryAfter } from '../lib/routing.mjs';
import { audit } from '../lib/audit.mjs';

const unauthorized = (fr, en, code) => new HttpError(401, { fr, en }, { code });

async function authorizeAgent(conn, request) {
  const raw = (request.headers.get('x-api-key') || '').trim();
  if (!raw) throw unauthorized('Clé d’API manquante', 'Missing API key', 'missing_api_key');

  // Clé héritée (variable d'environnement) : limitée à ses propres demandes.
  const legacy = process.env.AI_API_KEY || '';
  if (legacy && raw.length === legacy.length && crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(legacy))) {
    return { id: null, tier: 'enterprise', daily_limit: null, legacy: true };
  }

  const res = await conn.execute({
    sql: 'SELECT id, tier, status, daily_limit, expires_at, api_key FROM api_keys WHERE api_key IN (?, ?)',
    args: [storedKeyFor(raw), raw],
  });
  const key = res.rows[0];
  if (!key) throw unauthorized('Clé d’API invalide', 'Invalid API key', 'invalid_api_key');
  // Migration transparente : une clé stockée en clair est remplacée par son empreinte.
  if (key.api_key === raw) {
    await conn.execute({
      sql: 'UPDATE api_keys SET api_key = ?, key_prefix = COALESCE(key_prefix, ?) WHERE id = ?',
      args: [storedKeyFor(raw), keyPrefix(raw), key.id],
    });
  }
  if (key.status !== 'active') {
    throw new HttpError(403, { fr: `Clé d’API ${key.status}`, en: `API key ${key.status}` }, { code: 'api_key_inactive' });
  }
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    throw new HttpError(403, { fr: 'Clé d’API expirée', en: 'API key expired' }, { code: 'api_key_expired' });
  }
  return { id: key.id, tier: key.tier, daily_limit: key.daily_limit, legacy: false };
}

const scopeSql = (key) => (key.legacy ? 'r.api_key_id IS NULL' : 'r.api_key_id = ?');
const scopeArgs = (key) => (key.legacy ? [] : [key.id]);

const REQUEST_COLUMNS = `r.id, r.agent_id, r.agent_name, r.request_type, r.domain, r.jurisdiction, r.summary, r.context_json,
  r.priority, r.status, r.assigned_to, r.created_at, r.assigned_at, r.decided_at, r.expires_at, r.sla_breached_at,
  r.escalation_count, r.callback_url, r.webhook_status, r.second_opinion_of,
  (SELECT s.id FROM ai_requests s WHERE s.second_opinion_of = r.id) AS second_opinion_id,
  d.id AS decision_id, d.verdict, d.reasoning, d.signed_at AS decision_signed_at, d.signature, d.signed_payload, d.key_id`;

function present(row) {
  const type = normalizeType(row.request_type);
  let context = null;
  try {
    context = row.context_json ? JSON.parse(row.context_json) : null;
  } catch {
    context = row.context_json;
  }
  return {
    id: row.id,
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    request_type: row.request_type,
    level: type ? LEVELS[type].level : null,
    domain: row.domain,
    jurisdiction: row.jurisdiction,
    summary: row.summary,
    context,
    priority: row.priority,
    status: row.status,
    sentinel_ref: row.assigned_to ? sentinelRef(row.assigned_to) : null,
    created_at: row.created_at,
    assigned_at: row.assigned_at,
    expires_at: row.expires_at,
    sla_breached_at: row.sla_breached_at,
    escalation_count: Number(row.escalation_count || 0),
    decided_at: row.decided_at,
    callback_url: row.callback_url,
    webhook_status: row.webhook_status,
    second_opinion_of: row.second_opinion_of || null,
    second_opinion_id: row.second_opinion_id || null,
    verdict: row.verdict || null,
    reasoning: row.reasoning || null,
    decision_signed_at: row.decision_signed_at || null,
    decision: row.decision_id
      ? { id: row.decision_id, verdict: row.verdict, reasoning: row.reasoning, signed_at: row.decision_signed_at, signature: row.signature, signed_payload: row.signed_payload, key_id: row.key_id }
      : null,
  };
}

const bad = (fr, en, code = 'invalid_field') => new HttpError(400, { fr, en }, { code });

function fromBody(data) {
  requireFields(data, ['agent_id', 'request_type', 'domain', 'summary']);
  const type = normalizeType(data.request_type);
  if (!type) throw bad('request_type invalide (compliance, judgment, signature)', 'Invalid request_type (compliance, judgment, signature)', 'invalid_request_type');
  if (!DOMAINS.includes(data.domain)) throw bad(`domain invalide (${DOMAINS.join(', ')})`, `Invalid domain (${DOMAINS.join(', ')})`, 'invalid_domain');
  let context = null;
  if (data.context_json !== undefined && data.context_json !== null) {
    context = typeof data.context_json === 'string' ? data.context_json : JSON.stringify(data.context_json);
    if (context.length > 50 * 1024) throw bad('context_json trop volumineux (50 Ko max.)', 'context_json too large (50 KB max)', 'context_too_large');
  }
  return {
    agent_id: text(data.agent_id, 120),
    agent_name: text(data.agent_name, 120),
    type,
    domain: data.domain,
    jurisdiction: text(data.jurisdiction, 120),
    summary: text(data.summary, 5000),
    context,
    priority: data.priority,
    callback_url: data.callback_url,
  };
}

const secondOpinionExists = () =>
  new HttpError(409, { fr: 'Un second avis a déjà été demandé pour cette demande', en: 'A second opinion has already been requested for this request' }, { code: 'second_opinion_exists' });

/**
 * Second avis : même dossier, confié à l'aveugle à un autre Sentinel (le premier verdict
 * ne lui est pas montré) et facturé comme une nouvelle décision. Un seul par demande tranchée.
 */
async function loadOrigin(conn, key, rawId) {
  const res = await conn.execute({
    sql: `SELECT r.* FROM ai_requests r WHERE r.id = ? AND ${scopeSql(key)}`,
    args: [text(rawId, 64), ...scopeArgs(key)],
  });
  const origin = res.rows[0];
  if (!origin) throw new HttpError(404, { fr: 'Demande d’origine introuvable', en: 'Original request not found' }, { code: 'not_found' });
  if (origin.second_opinion_of) {
    throw bad('Un second avis ne peut pas porter sur un autre second avis', 'A second opinion cannot target another second opinion', 'invalid_second_opinion');
  }
  if (origin.status !== 'decided') {
    throw new HttpError(409, { fr: 'Un second avis ne peut porter que sur une demande déjà tranchée', en: 'A second opinion can only target a decided request' }, { code: 'not_decided' });
  }
  const existing = await conn.execute({ sql: 'SELECT id FROM ai_requests WHERE second_opinion_of = ?', args: [origin.id] });
  if (existing.rows.length) throw secondOpinionExists();
  return origin;
}

function fromOrigin(origin, data) {
  const type = normalizeType(origin.request_type);
  if (!type) throw bad('Type de la demande d’origine non pris en charge', 'Unsupported request_type on the original request', 'invalid_request_type');
  return {
    agent_id: origin.agent_id,
    agent_name: origin.agent_name,
    type,
    domain: origin.domain,
    jurisdiction: origin.jurisdiction,
    summary: origin.summary,
    context: origin.context_json,
    priority: data.priority ?? origin.priority,
    callback_url: data.callback_url ?? origin.callback_url,
  };
}

async function create(conn, request, key, ip) {
  await enforce(conn, `agent:key:${key.id || 'legacy'}`, LIMITS.requestsPerKeyPerMinute.limit, LIMITS.requestsPerKeyPerMinute.window);
  if (key.daily_limit !== null && key.daily_limit !== undefined) {
    const usage = await conn.execute({
      sql: 'SELECT COUNT(*) AS n FROM ai_requests WHERE api_key_id = ? AND created_at >= ?',
      args: [key.id, startOfTodayIso()],
    });
    if (Number(usage.rows[0].n) >= Number(key.daily_limit)) {
      throw new HttpError(
        429,
        { fr: `Quota quotidien atteint (${key.daily_limit} demandes/jour). Passez à un forfait supérieur.`, en: `Daily limit reached (${key.daily_limit} requests/day). Upgrade your plan.` },
        { code: 'daily_limit_reached' }
      );
    }
  }

  const data = await readJson(request, 64 * 1024);
  const origin = data.second_opinion_of ? await loadOrigin(conn, key, data.second_opinion_of) : null;
  const fields = origin ? fromOrigin(origin, data) : fromBody(data);
  const type = fields.type;
  const plan = PLANS[key.tier] || PLANS.compliance;
  if (!plan.types.includes(type)) {
    throw new HttpError(
      403,
      { fr: `Votre forfait (${key.tier}) n’autorise pas le type « ${type} ». Passez à un forfait supérieur.`, en: `Your plan (${key.tier}) does not allow request_type "${type}". Upgrade your plan.` },
      { code: 'plan_restriction' }
    );
  }
  const priority = normalizePriority(fields.priority);
  if (!priority) throw bad('priority invalide (low, normal, high, urgent)', 'Invalid priority (low, normal, high, urgent)', 'invalid_priority');
  const callbackUrl = fields.callback_url ? await checkCallbackUrl(fields.callback_url) : null;
  const slaMinutes = slaMinutesFor(type, data.sla_minutes);

  const id = crypto.randomUUID();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = expiryAfter(slaMinutes, now);
  await conn.execute({
    sql: `INSERT INTO ai_requests (id, agent_id, agent_name, request_type, domain, jurisdiction, summary, context_json, priority, status, created_at, expires_at, callback_url, api_key_id, escalation_count, second_opinion_of)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?)`,
    args: [
      id,
      fields.agent_id,
      fields.agent_name,
      type,
      fields.domain,
      fields.jurisdiction,
      fields.summary,
      fields.context,
      priority,
      createdAt,
      expiresAt,
      callbackUrl,
      key.id,
      origin ? origin.id : null,
    ],
  }).catch((err) => {
    // Deux seconds avis simultanés sur la même demande : l'index unique refuse le second.
    if (origin && /UNIQUE/i.test(String(err && err.message))) throw secondOpinionExists();
    throw err;
  });
  if (key.id) await conn.execute({ sql: 'UPDATE api_keys SET total_used = total_used + 1 WHERE id = ?', args: [key.id] });

  // Un second avis ne revient jamais à un Sentinel qui a déjà vu le dossier d'origine.
  const exclude = origin ? await previousDeciders(conn, id) : [];
  const sentinel = await findSentinel(conn, { domain: fields.domain, jurisdiction: fields.jurisdiction, exclude });
  if (sentinel) {
    await conn.execute({
      sql: "UPDATE ai_requests SET status = 'assigned', assigned_to = ?, assigned_at = ? WHERE id = ? AND status = 'pending'",
      args: [sentinel, nowIso(), id],
    });
  }
  await audit(conn, { actor_type: 'agent', actor_id: key.id || 'legacy', action: 'request.created', target_type: 'request', target_id: id, ip, details: { type, domain: fields.domain, priority, assigned: Boolean(sentinel), second_opinion_of: origin ? origin.id : undefined } });

  const ref = sentinel ? sentinelRef(sentinel) : null;
  return json(200, {
    ok: true,
    request_id: id,
    status: sentinel ? 'assigned' : 'pending',
    level: LEVELS[type].level,
    sla_minutes: slaMinutes,
    expires_at: expiresAt,
    sentinel_ref: ref,
    assigned_to: ref,
    second_opinion_of: origin ? origin.id : null,
  });
}

export default handler(async (request, context) => {
  allowMethods(request, 'GET', 'POST');
  const conn = await db();
  const key = await authorizeAgent(conn, request);
  const ip = clientIp(request, context);

  if (request.method === 'POST') return create(conn, request, key, ip);

  const params = new URL(request.url).searchParams;
  const id = text(params.get('id'), 64);
  if (id) {
    await sweep(conn, { ids: [id], limit: 1 });
    const res = await conn.execute({
      sql: `SELECT ${REQUEST_COLUMNS} FROM ai_requests r ${LATEST_DECISION_JOIN} WHERE r.id = ? AND ${scopeSql(key)}`,
      args: [id, ...scopeArgs(key)],
    });
    if (!res.rows.length) throw new HttpError(404, { fr: 'Demande introuvable', en: 'Request not found' }, { code: 'not_found' });
    return json(200, { request: present(res.rows[0]) });
  }

  const agentId = text(params.get('agent_id'), 120);
  if (!agentId) throw bad('id ou agent_id requis', 'id or agent_id required', 'missing_fields');
  const res = await conn.execute({
    sql: `SELECT ${REQUEST_COLUMNS} FROM ai_requests r ${LATEST_DECISION_JOIN}
          WHERE r.agent_id = ? AND ${scopeSql(key)} ORDER BY r.created_at DESC LIMIT 100`,
    args: [agentId, ...scopeArgs(key)],
  });
  return json(200, { requests: res.rows.map(present) });
});

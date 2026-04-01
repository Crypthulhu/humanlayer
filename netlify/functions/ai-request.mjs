import crypto from 'node:crypto';
import { initSchema, getDb } from './db.mjs';
import { jsonResponse, parseBody } from './_utils.mjs';

// Tier → allowed request_types
const TIER_TYPES = {
    compliance: ['conformité', 'compliance'],
    expert: ['conformité', 'compliance', 'jugement', 'judgment'],
    authority: ['conformité', 'compliance', 'jugement', 'judgment', 'signature'],
    enterprise: ['conformité', 'compliance', 'jugement', 'judgment', 'signature']
};

async function authorizeAgent(request, db) {
    const apiKey = request.headers.get('x-api-key') || '';
    if (!apiKey) return { ok: false, error: 'Missing API key' };

    // 1. Legacy fallback: static env var (no tier/rate limiting)
    const legacy = process.env.AI_API_KEY;
    if (legacy && apiKey === legacy) {
        return { ok: true, keyRecord: null }; // legacy mode — no tracking
    }

    // 2. DB lookup
    const result = await db.execute({
        sql: 'SELECT * FROM api_keys WHERE api_key = ?',
        args: [apiKey]
    });
    if (!result.rows.length) {
        return { ok: false, error: 'Invalid API key' };
    }

    const key = result.rows[0];

    // 3. Status check
    if (key.status !== 'active') {
        return { ok: false, error: `API key ${key.status}` };
    }

    // 4. Expiry check
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
        return { ok: false, error: 'API key expired' };
    }

    // 5. Return key record (rate-limit checked at POST time, not here)
    return { ok: true, keyRecord: key };
}

export default async function (request) {
    await initSchema();
    const db = getDb();

    const auth = await authorizeAgent(request, db);
    if (!auth.ok) {
        return jsonResponse(401, { error: auth.error });
    }
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);

    // ──────────────────────────────────────────────
    // POST — submit a new decision request
    // ──────────────────────────────────────────────
    if (request.method === 'POST') {
        // Daily rate limit — only on POST (creating new requests)
        if (auth.keyRecord) {
            const today = new Date().toISOString().slice(0, 10);
            const usage = await db.execute({
                sql: `SELECT COUNT(*) as cnt FROM ai_requests WHERE api_key_id = ? AND created_at >= ?`,
                args: [auth.keyRecord.id, `${today}T00:00:00.000Z`]
            });
            const todayCount = usage.rows[0]?.cnt || 0;
            if (todayCount >= auth.keyRecord.daily_limit) {
                return jsonResponse(429, { error: `Daily limit reached (${auth.keyRecord.daily_limit} requests/day). Upgrade your plan.` });
            }
        }

        const data = await parseBody(request);
        if (!data) return jsonResponse(400, { error: 'Invalid JSON' });

        const required = ['agent_id', 'request_type', 'domain', 'summary'];
        const missing = required.filter(f => !data[f]);
        if (missing.length) {
            return jsonResponse(400, { error: `Missing fields: ${missing.join(', ')}` });
        }

        const validTypes = ['conformité', 'jugement', 'signature', 'compliance', 'judgment'];
        if (!validTypes.includes(data.request_type)) {
            return jsonResponse(400, { error: `Invalid request_type. Must be: ${validTypes.join(', ')}` });
        }

        // Tier-based type restriction
        const keyRecord = auth.keyRecord;
        if (keyRecord) {
            const allowed = TIER_TYPES[keyRecord.tier] || TIER_TYPES.compliance;
            if (!allowed.includes(data.request_type)) {
                return jsonResponse(403, { error: `Your plan (${keyRecord.tier}) does not allow request_type "${data.request_type}". Upgrade your plan.` });
            }
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const expiresAt = data.expires_at || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

        try {
            const keyId = keyRecord ? keyRecord.id : null;

            await db.execute({
                sql: `INSERT INTO ai_requests (id, agent_id, agent_name, request_type, domain, jurisdiction, summary, context_json, priority, status, created_at, expires_at, callback_url, api_key_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
                args: [
                    id,
                    data.agent_id,
                    data.agent_name || null,
                    data.request_type,
                    data.domain,
                    data.jurisdiction || null,
                    data.summary,
                    data.context_json ? JSON.stringify(data.context_json) : null,
                    data.priority || 'normal',
                    now,
                    expiresAt,
                    data.callback_url || null,
                    keyId
                ]
            });

            // Increment total_used on the key
            if (keyId) {
                await db.execute({
                    sql: 'UPDATE api_keys SET total_used = total_used + 1 WHERE id = ?',
                    args: [keyId]
                });
            }

            // Auto-match: find an activated sentinel with matching expertise
            let assigned = null;
            const matchQuery = data.jurisdiction
                ? {
                    sql: `SELECT id, first_name, last_name FROM applications 
                  WHERE status = 'activated' AND expertise = ? AND jurisdictions LIKE ?
                  ORDER BY score DESC LIMIT 1`,
                    args: [data.domain, `%${data.jurisdiction}%`]
                }
                : {
                    sql: `SELECT id, first_name, last_name FROM applications 
                  WHERE status = 'activated' AND expertise = ?
                  ORDER BY score DESC LIMIT 1`,
                    args: [data.domain]
                };

            const match = await db.execute(matchQuery);

            if (match.rows.length) {
                assigned = match.rows[0];
                await db.execute({
                    sql: `UPDATE ai_requests SET status = 'assigned', assigned_to = ?, assigned_at = ? WHERE id = ?`,
                    args: [assigned.id, now, id]
                });
            }

            return jsonResponse(200, {
                ok: true,
                request_id: id,
                status: assigned ? 'assigned' : 'pending',
                assigned_to: assigned ? `${assigned.first_name} ${assigned.last_name}` : null
            });
        } catch (err) {
            console.error('ai-request POST error:', err);
            return jsonResponse(500, { error: 'Request creation failed' });
        }
    }

    // ──────────────────────────────────────────────
    // GET — check status of a request (polling)
    // ──────────────────────────────────────────────
    if (request.method === 'GET') {
        const keyRecord = auth.keyRecord;

        if (!params.id) {
            const agentId = params.agent_id;
            if (!agentId) return jsonResponse(400, { error: 'Missing id or agent_id' });

            try {
                // Scope by api_key_id when using a DB-managed key
                const sql = keyRecord
                    ? `SELECT r.*, d.verdict, d.reasoning, d.signed_at as decision_signed_at
                       FROM ai_requests r
                       LEFT JOIN decisions d ON d.request_id = r.id
                       WHERE r.agent_id = ? AND r.api_key_id = ?
                       ORDER BY r.created_at DESC LIMIT 100`
                    : `SELECT r.*, d.verdict, d.reasoning, d.signed_at as decision_signed_at
                       FROM ai_requests r
                       LEFT JOIN decisions d ON d.request_id = r.id
                       WHERE r.agent_id = ?
                       ORDER BY r.created_at DESC LIMIT 100`;
                const args = keyRecord ? [agentId, keyRecord.id] : [agentId];

                const result = await db.execute({ sql, args });
                return jsonResponse(200, { requests: result.rows });
            } catch (err) {
                console.error('ai-request GET list error:', err);
                return jsonResponse(500, { error: 'Read failed' });
            }
        }

        try {
            // Scope by api_key_id when using a DB-managed key
            const sql = keyRecord
                ? `SELECT r.*, d.verdict, d.reasoning, d.signed_at as decision_signed_at
                   FROM ai_requests r
                   LEFT JOIN decisions d ON d.request_id = r.id
                   WHERE r.id = ? AND r.api_key_id = ?`
                : `SELECT r.*, d.verdict, d.reasoning, d.signed_at as decision_signed_at
                   FROM ai_requests r
                   LEFT JOIN decisions d ON d.request_id = r.id
                   WHERE r.id = ?`;
            const args = keyRecord ? [params.id, keyRecord.id] : [params.id];

            const result = await db.execute({ sql, args });

            if (!result.rows.length) return jsonResponse(404, { error: 'Request not found' });
            return jsonResponse(200, { request: result.rows[0] });
        } catch (err) {
            console.error('ai-request GET detail error:', err);
            return jsonResponse(500, { error: 'Read failed' });
        }
    }

    return jsonResponse(405, { error: 'Method not allowed' });
}

import crypto from 'node:crypto';
import { initSchema, getDb } from './db.mjs';
import { jsonResponse, parseBody, verifyJwt, getBearer } from './_utils.mjs';

function authorizeSentinel(request) {
    const token = getBearer(request);
    const secret = process.env.SENTINEL_JWT_SECRET || process.env.ADMIN_JWT_SECRET;
    if (!token || !secret) return null;
    const payload = verifyJwt(token, secret);
    if (!payload || payload.role !== 'sentinel') return null;
    return payload;
}

export default async function (request) {
    const auth = authorizeSentinel(request);
    if (!auth) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    // sentinel_id is ALWAYS derived from the authenticated token — never from user input
    const sentinelId = auth.sentinel_id;
    if (!sentinelId) {
        return jsonResponse(403, { error: 'Invalid token: missing sentinel_id' });
    }

    await initSchema();
    const db = getDb();
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);

    // ──────────────────────────────────────────────
    // GET — list assigned requests for this sentinel
    // ──────────────────────────────────────────────
    if (request.method === 'GET') {
        try {
            const result = await db.execute({
                sql: `SELECT r.*, d.verdict, d.reasoning
              FROM ai_requests r
              LEFT JOIN decisions d ON d.request_id = r.id
              WHERE r.assigned_to = ?
              ORDER BY r.created_at DESC LIMIT 100`,
                args: [sentinelId]
            });

            return jsonResponse(200, { requests: result.rows });
        } catch (err) {
            console.error('ai-decision GET error:', err);
            return jsonResponse(500, { error: 'Read failed' });
        }
    }

    // ──────────────────────────────────────────────
    // POST — submit a decision (verdict)
    // ──────────────────────────────────────────────
    if (request.method === 'POST') {
        const data = await parseBody(request);
        if (!data) return jsonResponse(400, { error: 'Invalid JSON' });

        const { request_id, verdict, reasoning } = data;

        if (!request_id || !verdict) {
            return jsonResponse(400, { error: 'Missing required fields: request_id, verdict' });
        }

        const validVerdicts = ['approved', 'rejected', 'escalated'];
        if (!validVerdicts.includes(verdict)) {
            return jsonResponse(400, { error: `Invalid verdict. Must be: ${validVerdicts.join(', ')}` });
        }

        try {
            const reqCheck = await db.execute({
                sql: 'SELECT * FROM ai_requests WHERE id = ? AND assigned_to = ?',
                args: [request_id, sentinelId]
            });

            if (!reqCheck.rows.length) {
                return jsonResponse(404, { error: 'Request not found or not assigned to this sentinel' });
            }

            if (reqCheck.rows[0].status === 'decided') {
                return jsonResponse(409, { error: 'This request has already been decided' });
            }

            const now = new Date().toISOString();
            const decisionId = crypto.randomUUID();
            const ip = request.headers.get('x-forwarded-for') || request.headers.get('client-ip') || '';

            await db.execute({
                sql: `INSERT INTO decisions (id, request_id, sentinel_id, verdict, reasoning, signed_at, ip_address)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [decisionId, request_id, sentinelId, verdict, reasoning || null, now, ip]
            });

            await db.execute({
                sql: `UPDATE ai_requests SET status = 'decided', decided_at = ? WHERE id = ?`,
                args: [now, request_id]
            });

            // ── Webhook callback (fire-and-forget) ──
            const callbackUrl = reqCheck.rows[0].callback_url;
            if (callbackUrl) {
                try {
                    const sentinelInfo = await db.execute({
                        sql: 'SELECT first_name, last_name FROM applications WHERE id = ?',
                        args: [sentinelId]
                    });
                    const sName = sentinelInfo.rows.length
                        ? `${sentinelInfo.rows[0].first_name} ${sentinelInfo.rows[0].last_name}`
                        : null;

                    fetch(callbackUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event: 'decision.rendered',
                            request_id,
                            verdict,
                            reasoning: reasoning || null,
                            signed_at: now,
                            sentinel_name: sName
                        })
                    }).catch(e => console.error('Webhook callback failed:', e));
                } catch (e) {
                    console.error('Webhook prep error:', e);
                }
            }

            return jsonResponse(200, {
                ok: true,
                decision_id: decisionId,
                verdict,
                signed_at: now
            });
        } catch (err) {
            console.error('ai-decision POST error:', err);
            return jsonResponse(500, { error: 'Decision recording failed' });
        }
    }

    return jsonResponse(405, { error: 'Method not allowed' });
}

import crypto from 'node:crypto';
import { initSchema, getDb, generateApiKey } from './db.mjs';
import { jsonResponse, parseBody, verifyJwt, getBearer } from './_utils.mjs';

// ─── Admin auth (same JWT as admin panel) ───
function authorizeAdmin(request) {
    const token = getBearer(request);
    if (!token) return null;
    const secret = process.env.ADMIN_JWT_SECRET;
    if (!secret) return null;
    const payload = verifyJwt(token, secret);
    if (!payload || payload.role !== 'admin') return null;
    return payload;
}

// Tier configs
const TIER_CONFIG = {
    compliance: { daily_limit: 100, label: 'Conformité' },
    expert: { daily_limit: 50, label: 'Jugement expert' },
    authority: { daily_limit: 20, label: 'Autorité habilitée' },
    enterprise: { daily_limit: 999999, label: 'Enterprise' }
};

export default async function (request) {
    const admin = authorizeAdmin(request);
    if (!admin) {
        return jsonResponse(401, { error: 'Admin authentication required' });
    }

    await initSchema();
    const db = getDb();
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);

    // ──────────────────────────────────────────────
    // GET — list all API keys (with today's usage)
    // ──────────────────────────────────────────────
    if (request.method === 'GET') {
        try {
            const today = new Date().toISOString().slice(0, 10);

            const result = await db.execute(`
                SELECT k.*,
                    (SELECT COUNT(*) FROM ai_requests r WHERE r.api_key_id = k.id) as total_requests,
                    (SELECT COUNT(*) FROM ai_requests r WHERE r.api_key_id = k.id AND r.created_at >= '${today}T00:00:00.000Z') as today_requests
                FROM api_keys k
                ORDER BY k.created_at DESC
            `);

            return jsonResponse(200, {
                keys: result.rows,
                tiers: TIER_CONFIG
            });
        } catch (err) {
            console.error('api-keys GET error:', err);
            return jsonResponse(500, { error: 'Failed to list keys' });
        }
    }

    // ──────────────────────────────────────────────
    // POST — create a new API key
    // ──────────────────────────────────────────────
    if (request.method === 'POST') {
        const data = await parseBody(request);
        if (!data) return jsonResponse(400, { error: 'Invalid JSON' });

        const { client_name, client_email, tier, notes, env } = data;
        if (!client_name || !client_email) {
            return jsonResponse(400, { error: 'Missing fields: client_name, client_email' });
        }

        const selectedTier = tier && TIER_CONFIG[tier] ? tier : 'compliance';
        const config = TIER_CONFIG[selectedTier];

        const id = crypto.randomUUID();
        const apiKey = generateApiKey(env || 'live');
        const now = new Date().toISOString();

        try {
            await db.execute({
                sql: `INSERT INTO api_keys (id, client_name, client_email, api_key, tier, status, daily_limit, total_used, created_at, notes)
                      VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
                args: [id, client_name, client_email, apiKey, selectedTier, config.daily_limit, now, notes || null]
            });

            return jsonResponse(200, {
                ok: true,
                key: {
                    id,
                    client_name,
                    client_email,
                    api_key: apiKey,
                    tier: selectedTier,
                    tier_label: config.label,
                    daily_limit: config.daily_limit,
                    status: 'active',
                    created_at: now
                }
            });
        } catch (err) {
            console.error('api-keys POST error:', err);
            if (err.message && err.message.includes('UNIQUE')) {
                return jsonResponse(409, { error: 'A key for this client already exists or key collision — retry' });
            }
            return jsonResponse(500, { error: 'Key creation failed' });
        }
    }

    // ──────────────────────────────────────────────
    // PATCH — update key (tier, status, daily_limit, notes)
    // ──────────────────────────────────────────────
    if (request.method === 'PATCH') {
        const data = await parseBody(request);
        if (!data || !data.id) return jsonResponse(400, { error: 'Missing key id' });

        const updates = [];
        const args = [];

        if (data.tier && TIER_CONFIG[data.tier]) {
            updates.push('tier = ?');
            args.push(data.tier);
            // Also update daily_limit to match tier default unless explicitly overridden
            if (data.daily_limit === undefined) {
                updates.push('daily_limit = ?');
                args.push(TIER_CONFIG[data.tier].daily_limit);
            }
        }
        if (data.daily_limit !== undefined) {
            updates.push('daily_limit = ?');
            args.push(data.daily_limit);
        }
        if (data.status && ['active', 'suspended', 'revoked'].includes(data.status)) {
            updates.push('status = ?');
            args.push(data.status);
        }
        if (data.notes !== undefined) {
            updates.push('notes = ?');
            args.push(data.notes);
        }
        if (data.expires_at !== undefined) {
            updates.push('expires_at = ?');
            args.push(data.expires_at);
        }

        if (!updates.length) {
            return jsonResponse(400, { error: 'No valid fields to update' });
        }

        args.push(data.id);
        try {
            const result = await db.execute({
                sql: `UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`,
                args
            });
            if (result.rowsAffected === 0) {
                return jsonResponse(404, { error: 'Key not found' });
            }
            return jsonResponse(200, { ok: true });
        } catch (err) {
            console.error('api-keys PATCH error:', err);
            return jsonResponse(500, { error: 'Update failed' });
        }
    }

    // ──────────────────────────────────────────────
    // DELETE — revoke a key (soft delete)
    // ──────────────────────────────────────────────
    if (request.method === 'DELETE') {
        const keyId = params.id;
        if (!keyId) return jsonResponse(400, { error: 'Missing id parameter' });

        try {
            const result = await db.execute({
                sql: `UPDATE api_keys SET status = 'revoked' WHERE id = ?`,
                args: [keyId]
            });
            if (result.rowsAffected === 0) {
                return jsonResponse(404, { error: 'Key not found' });
            }
            return jsonResponse(200, { ok: true, status: 'revoked' });
        } catch (err) {
            console.error('api-keys DELETE error:', err);
            return jsonResponse(500, { error: 'Revocation failed' });
        }
    }

    return jsonResponse(405, { error: 'Method not allowed' });
}

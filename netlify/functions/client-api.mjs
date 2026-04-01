import crypto from 'node:crypto';
import { initSchema, getDb, generateApiKey, hashPassword } from './db.mjs';
import { jsonResponse, parseBody, verifyJwt, getBearer } from './_utils.mjs';

const TIER_CONFIG = {
    compliance: { daily_limit: 100, label: 'Conformité', price: '15' },
    expert: { daily_limit: 50, label: 'Jugement expert', price: '80' },
    authority: { daily_limit: 20, label: 'Autorité habilitée', price: '200' },
    enterprise: { daily_limit: 999999, label: 'Enterprise', price: 'custom' }
};

// Verify client JWT
function authorizeClient(request) {
    const token = getBearer(request);
    if (!token) return null;
    const secret = process.env.CLIENT_JWT_SECRET || process.env.ADMIN_JWT_SECRET;
    if (!secret) return null;
    const payload = verifyJwt(token, secret);
    if (!payload || payload.role !== 'client') return null;
    return payload;
}

export default async function (request) {
    await initSchema();
    const db = getDb();
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // ──────────────────────────────────────────────
    // REGISTER — public (no auth required)
    // ──────────────────────────────────────────────
    if (request.method === 'POST' && action === 'register') {
        const data = await parseBody(request);
        if (!data) return jsonResponse(400, { error: 'Invalid JSON' });

        const { company_name, email, password, tier } = data;
        if (!company_name || !email || !password) {
            return jsonResponse(400, { error: 'Champs requis : company_name, email, password' });
        }
        if (password.length < 8) {
            return jsonResponse(400, { error: 'Le mot de passe doit faire au moins 8 caractères' });
        }

        const selectedTier = tier && TIER_CONFIG[tier] ? tier : 'compliance';
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        try {
            const { saltHex, hashHex } = await hashPassword(password);

            await db.execute({
                sql: `INSERT INTO clients (id, company_name, email, password_hash, password_salt, tier, status, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
                args: [id, company_name, email.toLowerCase().trim(), hashHex, saltHex, selectedTier, now]
            });

            // Auto-generate a first API key for the client
            const keyId = crypto.randomUUID();
            const apiKey = generateApiKey('live');
            const config = TIER_CONFIG[selectedTier];

            await db.execute({
                sql: `INSERT INTO api_keys (id, client_name, client_email, api_key, tier, status, daily_limit, total_used, created_at, client_id)
                      VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
                args: [keyId, company_name, email.toLowerCase().trim(), apiKey, selectedTier, config.daily_limit, now, id]
            });

            return jsonResponse(200, {
                ok: true,
                client_id: id,
                api_key: apiKey,
                tier: selectedTier,
                tier_label: config.label
            });
        } catch (err) {
            console.error('client register error:', err);
            if (err.message && err.message.includes('UNIQUE')) {
                return jsonResponse(409, { error: 'Un compte avec cet email existe déjà' });
            }
            return jsonResponse(500, { error: 'Échec de l\'inscription' });
        }
    }

    // ── All other actions require client auth ──
    const auth = authorizeClient(request);
    if (!auth) {
        return jsonResponse(401, { error: 'Authentification requise' });
    }
    const clientId = auth.client_id;

    // ──────────────────────────────────────────────
    // DASHBOARD — client stats
    // ──────────────────────────────────────────────
    if (request.method === 'GET' && action === 'dashboard') {
        try {
            const today = new Date().toISOString().slice(0, 10);

            const [clientRow, keysData, statsData] = await Promise.all([
                db.execute({ sql: 'SELECT * FROM clients WHERE id = ?', args: [clientId] }),
                db.execute({ sql: 'SELECT COUNT(*) as cnt FROM api_keys WHERE client_id = ? AND status = ?', args: [clientId, 'active'] }),
                db.execute({
                    sql: `SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN r.created_at >= ? THEN 1 ELSE 0 END) as today,
                        SUM(CASE WHEN r.status = 'pending' OR r.status = 'assigned' THEN 1 ELSE 0 END) as in_progress,
                        SUM(CASE WHEN r.status = 'decided' THEN 1 ELSE 0 END) as decided
                    FROM ai_requests r
                    JOIN api_keys k ON r.api_key_id = k.id
                    WHERE k.client_id = ?`,
                    args: [`${today}T00:00:00.000Z`, clientId]
                })
            ]);

            const client = clientRow.rows[0];
            const stats = statsData.rows[0] || {};

            return jsonResponse(200, {
                client: {
                    company_name: client?.company_name,
                    email: client?.email,
                    tier: client?.tier,
                    tier_label: TIER_CONFIG[client?.tier]?.label || client?.tier,
                    created_at: client?.created_at
                },
                stats: {
                    active_keys: keysData.rows[0]?.cnt || 0,
                    total_requests: stats.total || 0,
                    today_requests: stats.today || 0,
                    in_progress: stats.in_progress || 0,
                    decided: stats.decided || 0
                },
                tiers: TIER_CONFIG
            });
        } catch (err) {
            console.error('client dashboard error:', err);
            return jsonResponse(500, { error: 'Erreur serveur' });
        }
    }

    // ──────────────────────────────────────────────
    // KEYS — list client's API keys
    // ──────────────────────────────────────────────
    if (request.method === 'GET' && action === 'keys') {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const result = await db.execute({
                sql: `SELECT k.*,
                    (SELECT COUNT(*) FROM ai_requests r WHERE r.api_key_id = k.id AND r.created_at >= ?) as today_requests
                FROM api_keys k
                WHERE k.client_id = ?
                ORDER BY k.created_at DESC`,
                args: [`${today}T00:00:00.000Z`, clientId]
            });

            return jsonResponse(200, { keys: result.rows });
        } catch (err) {
            console.error('client keys error:', err);
            return jsonResponse(500, { error: 'Erreur serveur' });
        }
    }

    // ──────────────────────────────────────────────
    // CREATE KEY — generate a new API key
    // ──────────────────────────────────────────────
    if (request.method === 'POST' && action === 'create-key') {
        try {
            // Get client info for tier
            const clientRow = await db.execute({ sql: 'SELECT * FROM clients WHERE id = ?', args: [clientId] });
            const client = clientRow.rows[0];
            if (!client) return jsonResponse(404, { error: 'Client non trouvé' });

            // Limit keys per client (max 5)
            const existing = await db.execute({
                sql: `SELECT COUNT(*) as cnt FROM api_keys WHERE client_id = ? AND status != 'revoked'`,
                args: [clientId]
            });
            if ((existing.rows[0]?.cnt || 0) >= 5) {
                return jsonResponse(400, { error: 'Maximum de 5 clés actives atteint' });
            }

            const keyId = crypto.randomUUID();
            const apiKey = generateApiKey('live');
            const config = TIER_CONFIG[client.tier] || TIER_CONFIG.compliance;
            const now = new Date().toISOString();

            await db.execute({
                sql: `INSERT INTO api_keys (id, client_name, client_email, api_key, tier, status, daily_limit, total_used, created_at, client_id)
                      VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
                args: [keyId, client.company_name, client.email, apiKey, client.tier, config.daily_limit, now, clientId]
            });

            return jsonResponse(200, {
                ok: true,
                key: { id: keyId, api_key: apiKey, tier: client.tier, daily_limit: config.daily_limit, created_at: now }
            });
        } catch (err) {
            console.error('client create-key error:', err);
            return jsonResponse(500, { error: 'Échec de la création de clé' });
        }
    }

    // ──────────────────────────────────────────────
    // REVOKE KEY — soft-delete a key
    // ──────────────────────────────────────────────
    if (request.method === 'PATCH' && action === 'revoke-key') {
        const data = await parseBody(request);
        if (!data?.key_id) return jsonResponse(400, { error: 'key_id requis' });

        try {
            const result = await db.execute({
                sql: `UPDATE api_keys SET status = 'revoked' WHERE id = ? AND client_id = ?`,
                args: [data.key_id, clientId]
            });
            if (result.rowsAffected === 0) return jsonResponse(404, { error: 'Clé non trouvée' });
            return jsonResponse(200, { ok: true });
        } catch (err) {
            console.error('client revoke-key error:', err);
            return jsonResponse(500, { error: 'Échec de la révocation' });
        }
    }

    // ──────────────────────────────────────────────
    // REQUESTS — list client's AI requests
    // ──────────────────────────────────────────────
    if (request.method === 'GET' && action === 'requests') {
        try {
            const result = await db.execute({
                sql: `SELECT r.id, r.agent_id, r.agent_name, r.request_type, r.domain, r.summary,
                        r.priority, r.status, r.created_at, r.assigned_at, r.decided_at,
                        d.verdict, d.reasoning, d.signed_at as decision_signed_at
                FROM ai_requests r
                LEFT JOIN decisions d ON d.request_id = r.id
                JOIN api_keys k ON r.api_key_id = k.id
                WHERE k.client_id = ?
                ORDER BY r.created_at DESC
                LIMIT 200`,
                args: [clientId]
            });

            return jsonResponse(200, { requests: result.rows });
        } catch (err) {
            console.error('client requests error:', err);
            return jsonResponse(500, { error: 'Erreur serveur' });
        }
    }

    return jsonResponse(400, { error: 'Action invalide. Actions: register, dashboard, keys, create-key, revoke-key, requests' });
}

import { initSchema, getDb } from './db.mjs';
import { jsonResponse, verifyJwt, getBearer } from './_utils.mjs';

function authorize(request) {
    const token = getBearer(request);
    const secret = process.env.ADMIN_JWT_SECRET;
    if (!token || !secret) return false;
    const payload = verifyJwt(token, secret);
    if (!payload || payload.role !== 'admin') return false;
    return payload;
}

export default async function (request) {
    if (request.method !== 'GET') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    if (!authorize(request)) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    await initSchema();
    const db = getDb();

    try {
        const result = await db.execute(
            `SELECT r.*,
        a.first_name as sentinel_first_name,
        a.last_name as sentinel_last_name,
        d.verdict,
        d.reasoning,
        d.signed_at as decision_signed_at
      FROM ai_requests r
      LEFT JOIN applications a ON a.id = r.assigned_to
      LEFT JOIN decisions d ON d.request_id = r.id
      ORDER BY r.created_at DESC
      LIMIT 200`
        );

        return jsonResponse(200, { requests: result.rows });
    } catch (err) {
        console.error('admin-requests error:', err);
        return jsonResponse(500, { error: 'Read failed' });
    }
}

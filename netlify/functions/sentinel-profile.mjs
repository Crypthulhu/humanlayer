import { initSchema, getDb } from './db.mjs';
import { jsonResponse, parseBody, verifyJwt, getBearer } from './_utils.mjs';

function authSentinel(request) {
    const token = getBearer(request);
    const secret = process.env.SENTINEL_JWT_SECRET || process.env.ADMIN_JWT_SECRET;
    if (!token || !secret) return null;
    const payload = verifyJwt(token, secret);
    if (!payload || payload.role !== 'sentinel') return null;
    return payload;
}

export default async function (request) {
    const auth = authSentinel(request);
    if (!auth) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    await initSchema();
    const db = getDb();

    // ──────────────────────────────────────────────
    // GET — sentinel profile + stats
    // ──────────────────────────────────────────────
    if (request.method === 'GET') {
        try {
            const profile = await db.execute({
                sql: `SELECT id, first_name, last_name, email, phone, expertise,
              qualifications, experience, linkedin, jurisdictions,
              score, status, submitted_at, activated_at
              FROM applications WHERE id = ?`,
                args: [auth.sentinel_id]
            });

            if (!profile.rows.length) {
                return jsonResponse(404, { error: 'Profile not found' });
            }

            // Stats
            const totalDecisions = await db.execute({
                sql: 'SELECT COUNT(*) as count FROM decisions WHERE sentinel_id = ?',
                args: [auth.sentinel_id]
            });

            const approvedCount = await db.execute({
                sql: `SELECT COUNT(*) as count FROM decisions WHERE sentinel_id = ? AND verdict = 'approved'`,
                args: [auth.sentinel_id]
            });

            const pendingRequests = await db.execute({
                sql: `SELECT COUNT(*) as count FROM ai_requests WHERE assigned_to = ? AND status = 'assigned'`,
                args: [auth.sentinel_id]
            });

            const p = profile.rows[0];
            const total = Number(totalDecisions.rows[0].count);
            const approved = Number(approvedCount.rows[0].count);

            return jsonResponse(200, {
                profile: {
                    id: p.id,
                    firstName: p.first_name,
                    lastName: p.last_name,
                    email: p.email,
                    phone: p.phone,
                    expertise: p.expertise,
                    qualifications: p.qualifications,
                    experience: p.experience,
                    linkedin: p.linkedin,
                    jurisdictions: p.jurisdictions,
                    score: p.score,
                    activatedAt: p.activated_at
                },
                stats: {
                    totalDecisions: total,
                    approvedCount: approved,
                    rejectedCount: total - approved,
                    approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
                    pendingRequests: Number(pendingRequests.rows[0].count)
                }
            });
        } catch (err) {
            console.error('sentinel-profile GET error:', err);
            return jsonResponse(500, { error: 'Profile read failed' });
        }
    }

    // ──────────────────────────────────────────────
    // PATCH — update profile fields
    // ──────────────────────────────────────────────
    if (request.method === 'PATCH') {
        const data = await parseBody(request);
        if (!data) return jsonResponse(400, { error: 'Invalid JSON' });

        const allowed = ['phone', 'linkedin'];
        const updates = [];
        const args = [];

        for (const field of allowed) {
            if (data[field] !== undefined) {
                updates.push(`${field} = ?`);
                args.push(data[field]);
            }
        }

        if (!updates.length) {
            return jsonResponse(400, { error: 'No updatable fields provided' });
        }

        args.push(auth.sentinel_id);

        try {
            await db.execute({
                sql: `UPDATE applications SET ${updates.join(', ')} WHERE id = ?`,
                args
            });
            return jsonResponse(200, { ok: true });
        } catch (err) {
            console.error('sentinel-profile PATCH error:', err);
            return jsonResponse(500, { error: 'Update failed' });
        }
    }

    return jsonResponse(405, { error: 'Method not allowed' });
}

import { initSchema, getDb } from './db.mjs';
import { jsonResponse, parseBody, signJwt, verifyPassword, verifyTotp } from './_utils.mjs';

export default async function (request) {
    if (request.method !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const body = await parseBody(request);
    if (!body?.email || !body?.password) {
        return jsonResponse(400, { error: 'Missing email or password' });
    }

    await initSchema();
    const db = getDb();
    const secret = process.env.SENTINEL_JWT_SECRET || process.env.ADMIN_JWT_SECRET;

    if (!secret) {
        return jsonResponse(500, { error: 'Server not configured' });
    }

    try {
        const result = await db.execute({
            sql: `SELECT id, first_name, last_name, email, expertise, status, password_hash, password_salt, totp_secret
            FROM applications WHERE email = ?`,
            args: [body.email.toLowerCase().trim()]
        });

        if (!result.rows.length) {
            return jsonResponse(401, { error: 'Invalid credentials' });
        }

        const sentinel = result.rows[0];

        if (sentinel.status !== 'activated') {
            return jsonResponse(403, { error: 'Account not yet activated' });
        }

        if (!sentinel.password_hash || !sentinel.password_salt) {
            return jsonResponse(403, { error: 'Account not configured — contact admin' });
        }

        const ok = await verifyPassword(body.password, sentinel.password_salt, sentinel.password_hash);
        if (!ok) {
            return jsonResponse(401, { error: 'Invalid credentials' });
        }

        // 2FA: verify TOTP code if sentinel has enrolled
        if (sentinel.totp_secret) {
            if (!body.totp || body.totp.length !== 6) {
                return jsonResponse(401, { error: 'Code 2FA requis (6 chiffres)', mfa_required: true });
            }
            if (!verifyTotp(sentinel.totp_secret, body.totp)) {
                return jsonResponse(401, { error: 'Code 2FA invalide', mfa_required: true });
            }
        }

        const token = signJwt({
            role: 'sentinel',
            sentinel_id: sentinel.id,
            email: sentinel.email,
            name: `${sentinel.first_name} ${sentinel.last_name}`
        }, secret, 60 * 60 * 12);

        return jsonResponse(200, {
            token,
            sentinel: {
                id: sentinel.id,
                firstName: sentinel.first_name,
                lastName: sentinel.last_name,
                email: sentinel.email,
                expertise: sentinel.expertise
            }
        });
    } catch (err) {
        console.error('sentinel-login error:', err);
        return jsonResponse(500, { error: 'Login failed' });
    }
}

import { initSchema, getDb } from './db.mjs';
import { jsonResponse, parseBody, verifyJwt, verifyTotp } from './_utils.mjs';
import crypto from 'node:crypto';

// ─── Base32 encode for TOTP secrets ───
function base32Encode(buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0, output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            output += alphabet[(value >>> bits) & 0x1f];
        }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 0x1f];
    return output;
}

export default async function (request) {
    const secret = process.env.SENTINEL_JWT_SECRET || process.env.ADMIN_JWT_SECRET;
    if (!secret) return jsonResponse(500, { error: 'Server not configured' });

    // Authenticate sentinel
    const authHeader = request.headers.get?.('authorization') || request.headers['authorization'];
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return jsonResponse(401, { error: 'Missing token' });

    const payload = verifyJwt(token, secret);
    if (!payload || payload.role !== 'sentinel') {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    await initSchema();
    const db = getDb();

    // ─── GET: Generate a new TOTP secret ───
    if (request.method === 'GET') {
        // Check if already enrolled
        const existing = await db.execute({
            sql: 'SELECT totp_secret FROM applications WHERE id = ?',
            args: [payload.sentinel_id]
        });
        const row = existing.rows[0];
        const enrolled = !!(row && row.totp_secret);

        // Generate a fresh secret
        const secretBytes = crypto.randomBytes(20);
        const totpSecret = base32Encode(secretBytes);

        // Build otpauth URI for QR code
        const issuer = 'HumanLayer';
        const label = encodeURIComponent(`${issuer}:${payload.email}`);
        const uri = `otpauth://totp/${label}?secret=${totpSecret}&issuer=${issuer}&digits=6&period=30`;

        return jsonResponse(200, { secret: totpSecret, uri, enrolled });
    }

    // ─── POST: Verify code and save secret ───
    if (request.method === 'POST') {
        const body = await parseBody(request);
        if (!body?.secret || !body?.code) {
            return jsonResponse(400, { error: 'Missing secret or code' });
        }

        if (body.code.length !== 6) {
            return jsonResponse(400, { error: 'Code must be 6 digits' });
        }

        // Verify the code matches the provided secret
        if (!verifyTotp(body.secret, body.code)) {
            return jsonResponse(401, { error: 'Code 2FA invalide — réessayez' });
        }

        // Save the TOTP secret to the sentinel's profile
        await db.execute({
            sql: 'UPDATE applications SET totp_secret = ? WHERE id = ?',
            args: [body.secret, payload.sentinel_id]
        });

        return jsonResponse(200, { success: true, message: '2FA activé avec succès' });
    }

    // ─── DELETE: Remove TOTP (disable 2FA) ───
    if (request.method === 'DELETE') {
        await db.execute({
            sql: 'UPDATE applications SET totp_secret = NULL WHERE id = ?',
            args: [payload.sentinel_id]
        });
        return jsonResponse(200, { success: true, message: '2FA désactivé' });
    }

    return jsonResponse(405, { error: 'Method not allowed' });
}

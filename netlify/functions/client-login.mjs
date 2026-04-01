import { initSchema, getDb } from './db.mjs';
import { jsonResponse, parseBody, signJwt, verifyPassword } from './_utils.mjs';

export default async function (request) {
    if (request.method !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const body = await parseBody(request);
    if (!body?.email || !body?.password) {
        return jsonResponse(400, { error: 'Email et mot de passe requis' });
    }

    await initSchema();
    const db = getDb();
    const secret = process.env.CLIENT_JWT_SECRET || process.env.ADMIN_JWT_SECRET;

    if (!secret) {
        return jsonResponse(500, { error: 'Server not configured' });
    }

    try {
        const result = await db.execute({
            sql: 'SELECT * FROM clients WHERE email = ?',
            args: [body.email.toLowerCase().trim()]
        });

        if (!result.rows.length) {
            return jsonResponse(401, { error: 'Identifiants invalides' });
        }

        const client = result.rows[0];

        if (client.status !== 'active') {
            return jsonResponse(403, { error: 'Compte suspendu' });
        }

        if (!client.password_hash || !client.password_salt) {
            return jsonResponse(403, { error: 'Compte non configuré — contactez le support' });
        }

        const ok = await verifyPassword(body.password, client.password_salt, client.password_hash);
        if (!ok) {
            return jsonResponse(401, { error: 'Identifiants invalides' });
        }

        const token = signJwt({
            role: 'client',
            client_id: client.id,
            email: client.email,
            company: client.company_name,
            tier: client.tier
        }, secret, 60 * 60 * 24); // 24h

        return jsonResponse(200, {
            token,
            client: {
                id: client.id,
                company_name: client.company_name,
                email: client.email,
                tier: client.tier
            }
        });
    } catch (err) {
        console.error('client-login error:', err);
        return jsonResponse(500, { error: 'Échec de la connexion' });
    }
}

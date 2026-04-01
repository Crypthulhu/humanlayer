import { jsonResponse, parseBody, signJwt, verifyPassword, verifyTotp } from './_utils.mjs';

export default async function (request) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const body = await parseBody(request);
  if (!body?.password) {
    return jsonResponse(400, { error: 'Missing password' });
  }

  const salt = process.env.ADMIN_PASSWORD_SALT;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.ADMIN_JWT_SECRET;
  const totpSecret = process.env.ADMIN_TOTP_SECRET;

  if (!salt || !hash || !secret) {
    return jsonResponse(500, { error: 'Server not configured' });
  }

  const ok = await verifyPassword(body.password, salt, hash);
  if (!ok) {
    return jsonResponse(401, { error: 'Invalid password' });
  }

  // 2FA: verify TOTP code if configured
  if (totpSecret) {
    if (!body.totp || body.totp.length !== 6) {
      return jsonResponse(401, { error: 'Code 2FA requis (6 chiffres)' });
    }
    if (!verifyTotp(totpSecret, body.totp)) {
      return jsonResponse(401, { error: 'Code 2FA invalide' });
    }
  }

  const token = signJwt({ role: 'admin' }, secret, 60 * 60 * 12);
  return jsonResponse(200, { token });
}

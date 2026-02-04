import { json, parseBody, signJwt, verifyPassword } from './_utils.mjs';

export default async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }

  const body = parseBody(event);
  if (!body?.password) {
    return json(400, { error: 'Missing password' });
  }

  const salt = process.env.ADMIN_PASSWORD_SALT;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.ADMIN_JWT_SECRET;

  if (!salt || !hash || !secret) {
    return json(500, { error: 'Server not configured' });
  }

  const ok = await verifyPassword(body.password, salt, hash);
  if (!ok) {
    return json(401, { error: 'Invalid password' });
  }

  const token = signJwt({ role: 'admin' }, secret, 60 * 60 * 12);
  return json(200, { token });
}

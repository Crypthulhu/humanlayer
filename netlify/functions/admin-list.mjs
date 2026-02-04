import { getStore } from '@netlify/blobs';
import { json, verifyJwt } from './_utils.mjs';

export default async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'GET' });
  }

  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const secret = process.env.ADMIN_JWT_SECRET;

  if (!token || !secret || !verifyJwt(token, secret)) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    const store = getStore('applications');
    const entriesRaw = await store.get('entries');
    const entries = entriesRaw ? JSON.parse(entriesRaw) : [];
    return json(200, { entries });
  } catch (err) {
    return json(500, { error: 'Storage read failed' });
  }
}

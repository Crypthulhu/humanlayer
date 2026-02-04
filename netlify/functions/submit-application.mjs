import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { json, parseBody } from './_utils.mjs';

export default async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }

  const data = parseBody(event);
  if (!data) {
    return json(400, { error: 'Invalid JSON' });
  }

  const record = {
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    ...data,
  };

  try {
    const store = getStore('applications');
    const existingRaw = await store.get('entries');
    const entries = existingRaw ? JSON.parse(existingRaw) : [];
    entries.unshift(record);
    await store.set('entries', JSON.stringify(entries.slice(0, 1000)));
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: 'Storage failed' });
  }
}

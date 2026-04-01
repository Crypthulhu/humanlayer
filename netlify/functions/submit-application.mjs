import crypto from 'node:crypto';
import { initSchema, getDb, computeScore } from './db.mjs';
import { jsonResponse, parseBody } from './_utils.mjs';

export default async function (request) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const data = await parseBody(request);
  if (!data) {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  // Validate required fields
  const required = ['firstName', 'lastName', 'email', 'expertise', 'qualifications', 'experience', 'habilitation', 'jurisdictions', 'linkedin'];
  const missing = required.filter(f => !data[f]);
  if (missing.length) {
    return jsonResponse(400, { error: `Missing fields: ${missing.join(', ')}` });
  }

  await initSchema();
  const db = getDb();

  const id = crypto.randomUUID();
  const score = computeScore(data);
  const now = new Date().toISOString();

  try {
    await db.execute({
      sql: `INSERT INTO applications (id, first_name, last_name, email, phone, expertise, qualifications, experience, capacity, linkedin, motivation, habilitation, jurisdictions, status, score, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      args: [
        id,
        data.firstName,
        data.lastName,
        data.email,
        data.phone || null,
        data.expertise,
        data.qualifications,
        data.experience,
        data.capacity || null,
        data.linkedin,
        data.motivation || null,
        data.habilitation,
        data.jurisdictions,
        score,
        now
      ]
    });

    return jsonResponse(200, { ok: true, id, score });
  } catch (err) {
    // Duplicate email
    if (err.message?.includes('UNIQUE constraint')) {
      return jsonResponse(409, { error: 'An application with this email already exists' });
    }
    console.error('submit-application error:', err);
    return jsonResponse(500, { error: 'Storage failed' });
  }
}

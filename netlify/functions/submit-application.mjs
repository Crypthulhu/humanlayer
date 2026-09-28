// Candidature Sentinel (public) : validée, bornée, limitée par IP, journalisée.
import crypto from 'node:crypto';
import { db, nowIso } from '../lib/db.mjs';
import { handler, allowMethods, readJson, requireFields, text, isEmail, clientIp, json, HttpError } from '../lib/http.mjs';
import { enforce, LIMITS } from '../lib/ratelimit.mjs';
import { audit } from '../lib/audit.mjs';
import { DOMAINS, EXPERIENCE, CAPACITY } from '../lib/plans.mjs';

function computeScore(data) {
  let score = 0;
  if (data.habilitation === 'oui') score += 30;
  score += { '15+': 25, '10-15': 20, '5-10': 15, '2-5': 10 }[data.experience] || 0;
  if (/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(data.linkedin || '')) score += 10;
  const q = (data.qualifications || '').length;
  score += q > 200 ? 15 : q > 100 ? 10 : q > 30 ? 5 : 0;
  score += { prioritaire: 10, soutenue: 7, limitee: 4 }[data.capacity] || 0;
  if ((data.motivation || '').length > 20) score += 5;
  if ((data.jurisdictions || '').length > 3) score += 5;
  return Math.min(score, 100);
}

const bad = (fr, en) => new HttpError(400, { fr, en }, { code: 'invalid_field' });

export default handler(async (request, context) => {
  allowMethods(request, 'POST');
  const conn = await db();
  const ip = clientIp(request, context);
  await enforce(conn, `apply:ip:${ip}`, LIMITS.applicationPerIp.limit, LIMITS.applicationPerIp.window);

  const body = await readJson(request, 32 * 1024);
  requireFields(body, ['firstName', 'lastName', 'email', 'expertise', 'qualifications', 'experience', 'habilitation', 'jurisdictions', 'linkedin']);

  const data = {
    firstName: text(body.firstName, 80),
    lastName: text(body.lastName, 80),
    email: text(body.email, 254)?.toLowerCase(),
    phone: text(body.phone, 40),
    expertise: text(body.expertise, 40),
    qualifications: text(body.qualifications, 4000),
    experience: text(body.experience, 10),
    capacity: text(body.capacity, 20),
    linkedin: text(body.linkedin, 300),
    motivation: text(body.motivation, 4000),
    habilitation: text(body.habilitation, 5),
    jurisdictions: text(body.jurisdictions, 300),
  };

  if (!isEmail(data.email)) throw bad('Adresse courriel invalide', 'Invalid email address');
  if (!DOMAINS.includes(data.expertise)) throw bad('Domaine d’expertise invalide', 'Invalid area of expertise');
  if (!EXPERIENCE.includes(data.experience)) throw bad('Expérience invalide', 'Invalid experience');
  if (data.capacity && !CAPACITY.includes(data.capacity)) throw bad('Capacité invalide', 'Invalid capacity');
  if (!['oui', 'non'].includes(data.habilitation)) throw bad('Réponse d’habilitation invalide', 'Invalid authorization answer');
  if (!/^https:\/\//i.test(data.linkedin)) throw bad('Le profil LinkedIn doit être une URL https', 'LinkedIn profile must be an https URL');

  const id = crypto.randomUUID();
  const score = computeScore(data);
  try {
    await conn.execute({
      sql: `INSERT INTO applications (id, first_name, last_name, email, phone, expertise, qualifications, experience, capacity, linkedin, motivation, habilitation, jurisdictions, status, score, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      args: [id, data.firstName, data.lastName, data.email, data.phone, data.expertise, data.qualifications, data.experience, data.capacity, data.linkedin, data.motivation, data.habilitation, data.jurisdictions, score, nowIso()],
    });
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) {
      // Même réponse qu'un succès : on ne révèle pas si une adresse a déjà postulé.
      await audit(conn, { actor_type: 'public', action: 'application.duplicate', ip });
      return json(200, { ok: true });
    }
    throw err;
  }
  await audit(conn, { actor_type: 'public', action: 'application.submitted', target_type: 'application', target_id: id, ip, details: { expertise: data.expertise, score } });
  return json(200, { ok: true });
});

// Tests de bout en bout des fonctions Netlify sur une base libSQL locale jetable.
// Lancer : npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';

import { setDbClient } from '../netlify/lib/db.mjs';
import { totpAt, currentStep } from '../netlify/lib/security.mjs';

import submitApplication from '../netlify/functions/submit-application.mjs';
import adminLogin from '../netlify/functions/admin-login.mjs';
import adminList from '../netlify/functions/admin-list.mjs';
import adminAudit from '../netlify/functions/admin-audit.mjs';
import apiKeys from '../netlify/functions/api-keys.mjs';
import clientApi from '../netlify/functions/client-api.mjs';
import clientLogin from '../netlify/functions/client-login.mjs';
import aiRequest from '../netlify/functions/ai-request.mjs';
import aiDecision from '../netlify/functions/ai-decision.mjs';
import sentinelLogin from '../netlify/functions/sentinel-login.mjs';
import sentinelTotp from '../netlify/functions/sentinel-totp.mjs';
import sentinelProfile from '../netlify/functions/sentinel-profile.mjs';
import decisionKey from '../netlify/functions/decision-key.mjs';
import { purgeTechnicalData } from '../netlify/lib/retention.mjs';

const ADMIN_PASSWORD = 'correct horse battery staple';
let conn;
let ipCounter = 1;
const freshIp = () => `203.0.113.${ipCounter++}`;

async function call(fn, { method = 'GET', query = '', body, token, apiKey, ip = '198.51.100.7', headers = {} } = {}) {
  const h = new Headers(headers);
  if (body !== undefined) h.set('content-type', 'application/json');
  if (token) h.set('authorization', `Bearer ${token}`);
  if (apiKey) h.set('x-api-key', apiKey);
  const req = new Request(`https://humanlayer.test/.netlify/functions/x${query}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await fn(req, { ip });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

// Anti-rejeu : un code admin ne sert qu'une fois ; on garde donc un seul jeton (valable 12 h).
const adminTotp = (offset = 0) => totpAt(process.env.ADMIN_TOTP_SECRET, currentStep() + offset);
let cachedAdmin = null;

async function adminToken() {
  if (cachedAdmin) return cachedAdmin;
  const r = await call(adminLogin, { method: 'POST', body: { password: ADMIN_PASSWORD, totp: adminTotp() }, ip: freshIp() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  cachedAdmin = r.json.token;
  return cachedAdmin;
}

async function newSentinel(email, domain = 'legal') {
  const apply = await call(submitApplication, {
    method: 'POST',
    ip: freshIp(),
    body: {
      firstName: 'Ada',
      lastName: 'Tremblay',
      email,
      expertise: domain,
      qualifications: 'Avocate au Barreau du Québec depuis 2012, droit des affaires et conformité.',
      experience: '10-15',
      capacity: 'soutenue',
      linkedin: 'https://linkedin.com/in/ada',
      habilitation: 'oui',
      jurisdictions: 'Québec, Canada',
    },
  });
  assert.equal(apply.status, 200, JSON.stringify(apply.json));
  const row = await conn.execute({ sql: 'SELECT id FROM applications WHERE email = ?', args: [email.toLowerCase()] });
  const id = row.rows[0].id;
  const admin = await adminToken();
  const activate = await call(adminList, { method: 'PATCH', token: admin, body: { id, status: 'activated', password: 'Sentinel-password-2026' } });
  assert.equal(activate.status, 200, JSON.stringify(activate.json));
  // Enrôlement MFA complet
  const login = await call(sentinelLogin, { method: 'POST', ip: freshIp(), body: { email, password: 'Sentinel-password-2026' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.mfa_enrollment_required, true);
  const setup = await call(sentinelTotp, { token: login.json.enrollment_token });
  assert.equal(setup.status, 200);
  const enroll = await call(sentinelTotp, { method: 'POST', token: login.json.enrollment_token, body: { code: totpAt(setup.json.secret, currentStep()) } });
  assert.equal(enroll.status, 200, JSON.stringify(enroll.json));
  return { id, secret: setup.json.secret, token: enroll.json.token };
}

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-test-'));
  conn = createClient({ url: `file:${path.join(dir, 'test.db')}` });
  setDbClient(conn);

  const salt = crypto.randomBytes(16);
  const N = 65536;
  const hash = crypto.scryptSync(ADMIN_PASSWORD, salt, 64, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  Object.assign(process.env, {
    ADMIN_PASSWORD_SALT: salt.toString('hex'),
    ADMIN_PASSWORD_HASH: `scrypt$${N}$8$1$${hash.toString('hex')}`,
    ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    ADMIN_JWT_SECRET: 'a'.repeat(40),
    SENTINEL_JWT_SECRET: 's'.repeat(40),
    CLIENT_JWT_SECRET: 'c'.repeat(40),
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    WEBHOOK_SIGNING_SECRET: 'w'.repeat(40),
    DECISION_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  });
  delete process.env.AI_API_KEY;
});

test('configuration : secrets par rôle obligatoires et distincts', async () => {
  const saved = process.env.SENTINEL_JWT_SECRET;
  delete process.env.SENTINEL_JWT_SECRET;
  let r = await call(sentinelProfile, { token: 'x.y.z' });
  assert.equal(r.status, 500);
  assert.equal(r.json.code, 'server_misconfigured');
  process.env.SENTINEL_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
  r = await call(sentinelProfile, { token: 'x.y.z' });
  assert.equal(r.status, 500);
  process.env.SENTINEL_JWT_SECRET = saved;
});

test('candidature : validation et limite par IP', async () => {
  const ip = freshIp();
  const bad = await call(submitApplication, { method: 'POST', ip, body: { firstName: 'A', lastName: 'B', email: 'x@y.co', expertise: 'astrologie', qualifications: 'q', experience: '2-5', habilitation: 'oui', jurisdictions: 'QC', linkedin: 'https://linkedin.com/in/x' } });
  assert.equal(bad.status, 400);
  for (let i = 0; i < 4; i++) await call(submitApplication, { method: 'POST', ip, body: {} });
  const limited = await call(submitApplication, { method: 'POST', ip, body: {} });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});

test('activation : réservée aux candidats disposant d’une habilitation', async () => {
  const email = 'sans.habilitation@example.com';
  const apply = await call(submitApplication, {
    method: 'POST',
    ip: freshIp(),
    body: { firstName: 'Léa', lastName: 'Roy', email, expertise: 'finance', qualifications: 'Analyste financière depuis 2015, crédit aux entreprises.', experience: '5-10', linkedin: 'https://linkedin.com/in/lea', habilitation: 'non', jurisdictions: 'France' },
  });
  assert.equal(apply.status, 200, JSON.stringify(apply.json));
  const row = await conn.execute({ sql: 'SELECT id FROM applications WHERE email = ?', args: [email] });
  const r = await call(adminList, { method: 'PATCH', token: await adminToken(), body: { id: row.rows[0].id, status: 'activated', password: 'Sentinel-password-2026' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'habilitation_required');
  const after = await conn.execute({ sql: 'SELECT status, password_hash FROM applications WHERE id = ?', args: [row.rows[0].id] });
  assert.equal(after.rows[0].status, 'pending');
  assert.equal(after.rows[0].password_hash, null);
});

test('admin : mot de passe + 2FA, blocage après 5 échecs', async () => {
  const ip = freshIp();
  const wrongTotp = await call(adminLogin, { method: 'POST', ip, body: { password: ADMIN_PASSWORD, totp: '000000' } });
  assert.equal(wrongTotp.status, 401);
  for (let i = 0; i < 4; i++) await call(adminLogin, { method: 'POST', ip, body: { password: 'nope', totp: '000000' } });
  const blocked = await call(adminLogin, { method: 'POST', ip, body: { password: ADMIN_PASSWORD, totp: adminTotp() } });
  assert.equal(blocked.status, 429);
  assert.ok(await adminToken());
});

test('admin : ancien format d’empreinte (sel utilisé comme texte) accepté', async () => {
  const saved = [process.env.ADMIN_PASSWORD_SALT, process.env.ADMIN_PASSWORD_HASH];
  const saltHex = crypto.randomBytes(16).toString('hex');
  process.env.ADMIN_PASSWORD_SALT = saltHex;
  process.env.ADMIN_PASSWORD_HASH = crypto.scryptSync(ADMIN_PASSWORD, saltHex, 64).toString('hex');
  // Le même code ne passe pas deux fois ; le pas suivant, oui.
  const replay = await call(adminLogin, { method: 'POST', ip: freshIp(), body: { password: ADMIN_PASSWORD, totp: adminTotp() } });
  assert.equal(replay.status, 401);
  const r = await call(adminLogin, { method: 'POST', ip: freshIp(), body: { password: ADMIN_PASSWORD, totp: adminTotp(1) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  [process.env.ADMIN_PASSWORD_SALT, process.env.ADMIN_PASSWORD_HASH] = saved;
});

test('parcours complet : MFA obligatoire, demande, décision signée, export', async () => {
  const admin = await adminToken();
  const s = await newSentinel('Ada.Legal@Example.com');

  // La liste admin n'expose aucun secret
  const list = await call(adminList, { token: admin });
  const entry = list.json.entries.find((e) => e.id === s.id);
  assert.ok(entry);
  assert.equal(entry.password_hash, undefined);
  assert.equal(entry.totp_secret, undefined);
  assert.equal(Number(entry.mfa_enrolled), 1);

  // Secret TOTP chiffré au repos
  const stored = await conn.execute({ sql: 'SELECT totp_secret FROM applications WHERE id = ?', args: [s.id] });
  assert.match(stored.rows[0].totp_secret, /^enc:v1:/);

  // Connexion : code requis, rejeu refusé, pas suivant accepté (courriel en majuscules toléré)
  const noCode = await call(sentinelLogin, { method: 'POST', ip: freshIp(), body: { email: 'ADA.LEGAL@EXAMPLE.COM', password: 'Sentinel-password-2026' } });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.json.mfa_required, true);
  const replay = await call(sentinelLogin, { method: 'POST', ip: freshIp(), body: { email: 'ada.legal@example.com', password: 'Sentinel-password-2026', totp: totpAt(s.secret, currentStep()) } });
  assert.equal(replay.status, 401);
  const ok = await call(sentinelLogin, { method: 'POST', ip: freshIp(), body: { email: 'ada.legal@example.com', password: 'Sentinel-password-2026', totp: totpAt(s.secret, currentStep() + 1) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const sentinelToken = ok.json.token;

  // La MFA ne peut pas être désactivée
  const disable = await call(sentinelTotp, { method: 'DELETE', token: sentinelToken });
  assert.equal(disable.status, 403);

  // Client : Enterprise refusé en libre-service, mot de passe robuste exigé
  const weak = await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Acme', email: 'ops@acme.test', password: 'short', tier: 'enterprise' } });
  assert.equal(weak.status, 400);
  const reg = await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Acme', email: 'ops@acme.test', password: 'Acme-strong-password', tier: 'enterprise' } });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  assert.equal(reg.json.tier, 'compliance');
  assert.match(reg.json.webhook_secret, /^whsec_/);
  const apiKey = reg.json.api_key;
  const keyRow = await conn.execute({ sql: 'SELECT api_key FROM api_keys WHERE client_id = ?', args: [reg.json.client_id] });
  assert.match(keyRow.rows[0].api_key, /^sha256:/);

  const clientSession = await call(clientLogin, { method: 'POST', ip: freshIp(), body: { email: 'OPS@acme.test', password: 'Acme-strong-password' } });
  assert.equal(clientSession.status, 200);
  const clientToken = clientSession.json.token;
  // Un jeton client ne vaut rien côté Sentinel (audience)
  assert.equal((await call(aiDecision, { token: clientToken })).status, 401);
  const keys = await call(clientApi, { query: '?action=keys', token: clientToken });
  assert.equal(keys.json.keys[0].api_key, undefined);
  assert.ok(keys.json.keys[0].key_prefix.startsWith('hl_live_'));

  // Demande d'agent : validations
  assert.equal((await call(aiRequest, { method: 'POST', apiKey, body: { agent_id: 'a1', request_type: 'compliance', domain: 'legal', summary: 'x', priority: 'yolo' } })).status, 400);
  assert.equal((await call(aiRequest, { method: 'POST', apiKey, body: { agent_id: 'a1', request_type: 'judgment', domain: 'legal', summary: 'x' } })).status, 403);
  assert.equal((await call(aiRequest, { method: 'POST', apiKey, body: { agent_id: 'a1', request_type: 'compliance', domain: 'legal', summary: 'x', callback_url: 'https://127.0.0.1/hook' } })).status, 400);
  assert.equal((await call(aiRequest, { method: 'POST', apiKey, body: { agent_id: 'a1', request_type: 'compliance', domain: 'legal', summary: 'x', callback_url: 'http://example.com/hook' } })).status, 400);

  const created = await call(aiRequest, {
    method: 'POST',
    apiKey,
    body: { agent_id: 'agent-legal', request_type: 'conformité', domain: 'legal', jurisdiction: 'Québec', summary: 'Clause 4.2.b acceptable ?', priority: 'critical', context_json: { contracts: 12 } },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(created.json.status, 'assigned');
  assert.equal(created.json.sla_minutes, 30);
  assert.match(created.json.sentinel_ref, /^S-[0-9A-F]{6}$/);
  const requestId = created.json.request_id;

  // Le Sentinel voit la demande, la justification est obligatoire
  const queue = await call(aiDecision, { token: sentinelToken });
  assert.ok(queue.json.requests.some((r) => r.id === requestId));
  assert.equal((await call(aiDecision, { method: 'POST', token: sentinelToken, body: { request_id: requestId, verdict: 'approved', reasoning: '' } })).status, 400);
  const decided = await call(aiDecision, { method: 'POST', token: sentinelToken, body: { request_id: requestId, verdict: 'approved', reasoning: 'Clause conforme à la politique interne du client.' } });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  const again = await call(aiDecision, { method: 'POST', token: sentinelToken, body: { request_id: requestId, verdict: 'rejected', reasoning: 'Deuxième tentative de décision.' } });
  assert.equal(again.status, 409);

  // Signature vérifiable avec la clé publique
  const pub = await call(decisionKey);
  const detail = await call(aiRequest, { query: `?id=${requestId}`, apiKey });
  assert.equal(detail.json.request.status, 'decided');
  assert.equal(detail.json.request.priority, 'urgent');
  const { signed_payload: payload, signature } = detail.json.request.decision;
  assert.ok(crypto.verify(null, Buffer.from(payload), crypto.createPublicKey(pub.json.public_key_pem), Buffer.from(signature, 'base64')));
  assert.equal(JSON.parse(payload).verdict, 'approved');

  // Export client signé
  const exported = await call(clientApi, { query: '?action=export', token: clientToken });
  assert.equal(exported.status, 200);
  assert.ok(exported.json.requests.find((r) => r.id === requestId).signature);

  // Journal d'audit
  const log = await call(adminAudit, { token: admin, query: `?target_id=${requestId}` });
  const actions = log.json.entries.map((e) => e.action);
  assert.ok(actions.includes('request.created'));
  assert.ok(actions.includes('decision.approved'));
});

test('SLA dépassé puis escalade vers un autre Sentinel', async () => {
  const first = await newSentinel('first.fin@example.com', 'finance');
  const reg = await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Bank', email: 'risk@bank.test', password: 'Bank-strong-password', tier: 'expert' } });
  const created = await call(aiRequest, { method: 'POST', apiKey: reg.json.api_key, body: { agent_id: 'credit', request_type: 'judgment', domain: 'finance', summary: 'Prêt de 50 000 €, score 480' } });
  assert.equal(created.json.sla_minutes, 120);
  const id = created.json.request_id;
  const second = await newSentinel('second.fin@example.com', 'finance');
  await conn.execute({ sql: 'UPDATE ai_requests SET expires_at = ? WHERE id = ?', args: [new Date(Date.now() - 60000).toISOString(), id] });

  const detail = await call(aiRequest, { query: `?id=${id}`, apiKey: reg.json.api_key });
  const row = await conn.execute({ sql: 'SELECT assigned_to, escalation_count, sla_breached_at, status FROM ai_requests WHERE id = ?', args: [id] });
  assert.ok(row.rows[0].sla_breached_at);
  assert.equal(Number(row.rows[0].escalation_count), 1);
  assert.equal(row.rows[0].status, 'assigned');
  assert.equal(detail.json.request.escalation_count, 1);
  // Créée quand seul le premier existait, la demande passe au second après le dépassement.
  assert.equal(row.rows[0].assigned_to, second.id);

  // L'ancien titulaire ne peut plus trancher
  const late = await call(aiDecision, { method: 'POST', token: first.token, body: { request_id: id, verdict: 'approved', reasoning: 'Décision hors délai, refusée.' } });
  assert.equal(late.status, 404);

  // Escalade manuelle (second avis) : la demande repart vers l'autre Sentinel
  const esc = await call(aiDecision, { method: 'POST', token: second.token, body: { request_id: id, verdict: 'escalated', reasoning: 'Second avis requis : exposition réglementaire élevée.' } });
  assert.equal(esc.status, 200, JSON.stringify(esc.json));
  const after = await conn.execute({ sql: 'SELECT assigned_to, status FROM ai_requests WHERE id = ?', args: [id] });
  assert.equal(after.rows[0].assigned_to, first.id);
  assert.equal(after.rows[0].status, 'assigned');
});

test('second avis : demandé par le client, à l’aveugle, jamais au premier Sentinel', async () => {
  const one = await newSentinel('med.one@example.com', 'medical');
  const reg = await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Clinic', email: 'ops@clinic.test', password: 'Clinic-strong-password', tier: 'expert' } });
  const apiKey = reg.json.api_key;
  const created = await call(aiRequest, { method: 'POST', apiKey, body: { agent_id: 'triage', request_type: 'judgment', domain: 'medical', summary: 'Protocole hors AMM acceptable ?', context_json: { patient: 'p-12' } } });
  const originId = created.json.request_id;

  // Pas de second avis avant la première décision
  const early = await call(aiRequest, { method: 'POST', apiKey, body: { second_opinion_of: originId } });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, 'not_decided');

  const decided = await call(aiDecision, { method: 'POST', token: one.token, body: { request_id: originId, verdict: 'approved', reasoning: 'Protocole documenté, rapport bénéfice/risque favorable.' } });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  const two = await newSentinel('med.two@example.com', 'medical');

  // Une autre clé ne peut pas viser cette demande
  const other = await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Other', email: 'ops@other.test', password: 'Other-strong-password', tier: 'expert' } });
  assert.equal((await call(aiRequest, { method: 'POST', apiKey: other.json.api_key, body: { second_opinion_of: originId } })).status, 404);

  const second = await call(aiRequest, { method: 'POST', apiKey, body: { second_opinion_of: originId } });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.second_opinion_of, originId);
  assert.equal(second.json.status, 'assigned');
  const secondId = second.json.request_id;
  const row = await conn.execute({ sql: 'SELECT assigned_to, summary, context_json, request_type FROM ai_requests WHERE id = ?', args: [secondId] });
  assert.equal(row.rows[0].assigned_to, two.id);
  assert.equal(row.rows[0].request_type, 'judgment');
  assert.deepEqual(JSON.parse(row.rows[0].context_json), { patient: 'p-12' });

  // Un seul second avis, et pas de second avis sur un second avis
  const dup = await call(aiRequest, { method: 'POST', apiKey, body: { second_opinion_of: originId } });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'second_opinion_exists');
  assert.equal((await call(aiRequest, { method: 'POST', apiKey, body: { second_opinion_of: secondId } })).status, 400);

  // Lien visible dans les deux sens
  assert.equal((await call(aiRequest, { query: `?id=${originId}`, apiKey })).json.request.second_opinion_id, secondId);
  assert.equal((await call(aiRequest, { query: `?id=${secondId}`, apiKey })).json.request.second_opinion_of, originId);

  // Le second Sentinel ne voit pas le premier verdict
  const queue = await call(aiDecision, { token: two.token });
  const item = queue.json.requests.find((r) => r.id === secondId);
  assert.ok(Number(item.second_opinion));
  assert.equal(item.verdict, null);
  assert.ok(!queue.json.requests.some((r) => r.id === originId));

  // Dépassement du SLA : jamais réassigné au premier Sentinel
  await conn.execute({ sql: 'UPDATE ai_requests SET expires_at = ? WHERE id = ?', args: [new Date(Date.now() - 60000).toISOString(), secondId] });
  await call(aiRequest, { query: `?id=${secondId}`, apiKey });
  const after = await conn.execute({ sql: 'SELECT assigned_to, status FROM ai_requests WHERE id = ?', args: [secondId] });
  assert.equal(after.rows[0].assigned_to, two.id);
  assert.equal(after.rows[0].status, 'sla_breached');
});

test('clé suspendue : ni révocation ni recréation côté client', async () => {
  const admin = await adminToken();
  const reg = await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Susp', email: 'susp@corp.test', password: 'Susp-strong-password' } });
  const keyId = (await conn.execute({ sql: 'SELECT id FROM api_keys WHERE client_id = ?', args: [reg.json.client_id] })).rows[0].id;
  assert.equal((await call(apiKeys, { method: 'PATCH', token: admin, body: { id: keyId, status: 'suspended' } })).status, 200);
  const login = await call(clientLogin, { method: 'POST', ip: freshIp(), body: { email: 'susp@corp.test', password: 'Susp-strong-password' } });
  const token = login.json.token;
  assert.equal((await call(clientApi, { method: 'PATCH', query: '?action=revoke-key', token, body: { key_id: keyId } })).status, 403);
  assert.equal((await call(clientApi, { method: 'POST', query: '?action=create-key', token })).status, 403);
  assert.equal((await call(aiRequest, { method: 'POST', apiKey: reg.json.api_key, body: { agent_id: 'a', request_type: 'compliance', domain: 'legal', summary: 's' } })).status, 403);
});

test('ancienne clé stockée en clair : acceptée puis migrée vers son empreinte', async () => {
  const raw = `hl_live_${crypto.randomBytes(16).toString('hex')}`;
  await conn.execute({
    sql: "INSERT INTO api_keys (id, client_name, client_email, api_key, tier, status, daily_limit, total_used, created_at) VALUES (?, 'Old', 'old@corp.test', ?, 'compliance', 'active', 100, 0, ?)",
    args: [crypto.randomUUID(), raw, new Date().toISOString()],
  });
  const r = await call(aiRequest, { query: '?agent_id=none', apiKey: raw });
  assert.equal(r.status, 200);
  const row = await conn.execute({ sql: 'SELECT api_key, key_prefix FROM api_keys WHERE client_email = ?', args: ['old@corp.test'] });
  assert.match(row.rows[0].api_key, /^sha256:/);
  assert.ok(row.rows[0].key_prefix);
});

test('connexion client : blocage du compte après 5 échecs', async () => {
  await call(clientApi, { method: 'POST', query: '?action=register', ip: freshIp(), body: { company_name: 'Lock', email: 'lock@corp.test', password: 'Lock-strong-password' } });
  for (let i = 0; i < 5; i++) {
    const r = await call(clientLogin, { method: 'POST', ip: freshIp(), body: { email: 'lock@corp.test', password: 'wrong-password' } });
    assert.equal(r.status, 401);
  }
  const blocked = await call(clientLogin, { method: 'POST', ip: freshIp(), body: { email: 'lock@corp.test', password: 'Lock-strong-password' } });
  assert.equal(blocked.status, 429);
});

test('webhooks : URL de rappel filtrée et signature HMAC vérifiable', async () => {
  const { checkCallbackUrl, isPrivateAddress } = await import('../netlify/lib/webhooks.mjs');
  const { webhookSecretFor, signWebhook } = await import('../netlify/lib/security.mjs');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  await assert.rejects(checkCallbackUrl('https://localhost/hook', { resolve: false }));
  await assert.rejects(checkCallbackUrl('https://169.254.169.254/latest', { resolve: false }));
  await assert.rejects(checkCallbackUrl('https://user:pw@example.com/hook', { resolve: false }));
  await assert.rejects(checkCallbackUrl('https://example.com:22/hook', { resolve: false }));
  assert.equal(await checkCallbackUrl('https://hooks.example.com/hl', { resolve: false }), 'https://hooks.example.com/hl');

  // Secret propre à chaque clé, signature reproductible par le client
  const a = webhookSecretFor('key-a');
  assert.notEqual(a, webhookSecretFor('key-b'));
  const body = JSON.stringify({ type: 'decision.completed' });
  const expected = crypto.createHmac('sha256', a).update(`1700000000.${body}`).digest('hex');
  assert.equal(signWebhook(a, 1700000000, body), expected);
});

test('conservation : adresses IP effacées après 12 mois, compteurs expirés supprimés', async () => {
  const old = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
  const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  await conn.batch([
    { sql: "INSERT INTO audit_log (id, created_at, actor_type, action, ip) VALUES ('audit-old', ?, 'system', 'test', '203.0.113.200')", args: [old] },
    { sql: "INSERT INTO audit_log (id, created_at, actor_type, action, ip) VALUES ('audit-new', ?, 'system', 'test', '203.0.113.201')", args: [recent] },
    { sql: "INSERT INTO decisions (id, request_id, sentinel_id, verdict, reasoning, signed_at, ip_address) VALUES ('dec-old', 'req-old', 's', 'escalated', 'x', ?, '203.0.113.202')", args: [old] },
    { sql: "INSERT INTO decisions (id, request_id, sentinel_id, verdict, reasoning, signed_at, ip_address) VALUES ('dec-new', 'req-new', 's', 'escalated', 'x', ?, '203.0.113.203')", args: [recent] },
    { sql: "INSERT INTO rate_limits (key, window_start, count) VALUES ('login:client:fail:old@corp.test', ?, 3)", args: [nowSec - 2 * 86400] },
    { sql: "INSERT INTO rate_limits (key, window_start, count) VALUES ('login:client:fail:new@corp.test', ?, 1)", args: [nowSec - 60] },
    { sql: "INSERT INTO rate_limits (key, window_start, count) VALUES ('admin:totp:last_step', ?, 0) ON CONFLICT(key) DO NOTHING", args: [currentStep() - 10] },
  ], 'write');

  const stats = await purgeTechnicalData(conn);
  assert.ok(stats.audit_ips >= 1 && stats.decision_ips >= 1 && stats.counters >= 1, JSON.stringify(stats));
  const ip = async (sql, id) => (await conn.execute({ sql, args: [id] })).rows[0];
  assert.equal((await ip('SELECT ip FROM audit_log WHERE id = ?', 'audit-old')).ip, null);
  assert.equal((await ip('SELECT ip FROM audit_log WHERE id = ?', 'audit-new')).ip, '203.0.113.201');
  assert.equal((await ip('SELECT ip_address FROM decisions WHERE id = ?', 'dec-old')).ip_address, null);
  assert.equal((await ip('SELECT ip_address FROM decisions WHERE id = ?', 'dec-new')).ip_address, '203.0.113.203');
  // L'entrée du journal et la décision restent : seule l'adresse disparaît.
  assert.ok(await ip('SELECT id FROM audit_log WHERE id = ?', 'audit-old'));
  const keys = (await conn.execute("SELECT key FROM rate_limits WHERE key LIKE 'login:client:fail:%' OR key = 'admin:totp:last_step'")).rows.map((r) => r.key);
  assert.ok(!keys.includes('login:client:fail:old@corp.test'));
  assert.ok(keys.includes('login:client:fail:new@corp.test'));
  assert.ok(keys.includes('admin:totp:last_step'));
});

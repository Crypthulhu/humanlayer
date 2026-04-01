import { createClient } from '@libsql/client/web';
import crypto from 'node:crypto';

let _client = null;

export function getDb() {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error('TURSO_DATABASE_URL is not set');

  _client = createClient({ url, authToken });
  return _client;
}

export async function initSchema() {
  const db = getDb();

  await db.batch([
    `CREATE TABLE IF NOT EXISTS applications (
      id            TEXT PRIMARY KEY,
      first_name    TEXT NOT NULL,
      last_name     TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      phone         TEXT,
      expertise     TEXT NOT NULL,
      qualifications TEXT NOT NULL,
      experience    TEXT NOT NULL,
      capacity      TEXT,
      linkedin      TEXT NOT NULL,
      motivation    TEXT,
      habilitation  TEXT NOT NULL,
      jurisdictions TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      score         INTEGER DEFAULT 0,
      notes         TEXT,
      password_hash TEXT,
      password_salt TEXT,
      submitted_at  TEXT NOT NULL,
      reviewed_at   TEXT,
      activated_at  TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ai_requests (
      id              TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      agent_name      TEXT,
      request_type    TEXT NOT NULL,
      domain          TEXT NOT NULL,
      jurisdiction    TEXT,
      summary         TEXT NOT NULL,
      context_json    TEXT,
      priority        TEXT DEFAULT 'normal',
      status          TEXT DEFAULT 'pending',
      assigned_to     TEXT,
      created_at      TEXT NOT NULL,
      assigned_at     TEXT,
      decided_at      TEXT,
      expires_at      TEXT,
      callback_url    TEXT,
      FOREIGN KEY (assigned_to) REFERENCES applications(id)
    )`,
    `CREATE TABLE IF NOT EXISTS decisions (
      id            TEXT PRIMARY KEY,
      request_id    TEXT NOT NULL,
      sentinel_id   TEXT NOT NULL,
      verdict       TEXT NOT NULL,
      reasoning     TEXT,
      signed_at     TEXT NOT NULL,
      ip_address    TEXT,
      FOREIGN KEY (request_id)  REFERENCES ai_requests(id),
      FOREIGN KEY (sentinel_id) REFERENCES applications(id)
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id            TEXT PRIMARY KEY,
      client_name   TEXT NOT NULL,
      client_email  TEXT NOT NULL,
      api_key       TEXT NOT NULL UNIQUE,
      tier          TEXT NOT NULL DEFAULT 'compliance',
      status        TEXT NOT NULL DEFAULT 'active',
      daily_limit   INTEGER DEFAULT 100,
      total_used    INTEGER DEFAULT 0,
      created_at    TEXT NOT NULL,
      expires_at    TEXT,
      notes         TEXT,
      client_id     TEXT REFERENCES clients(id)
    )`,
    `CREATE TABLE IF NOT EXISTS clients (
      id             TEXT PRIMARY KEY,
      company_name   TEXT NOT NULL,
      email          TEXT NOT NULL UNIQUE,
      password_hash  TEXT,
      password_salt  TEXT,
      tier           TEXT NOT NULL DEFAULT 'compliance',
      status         TEXT NOT NULL DEFAULT 'active',
      created_at     TEXT NOT NULL
    )`
  ]);

  // Migrations (safe to fail if columns already exist)
  const migrations = [
    'ALTER TABLE ai_requests ADD COLUMN callback_url TEXT',
    'ALTER TABLE ai_requests ADD COLUMN api_key_id TEXT REFERENCES api_keys(id)',
    'ALTER TABLE api_keys ADD COLUMN client_id TEXT REFERENCES clients(id)',
    'ALTER TABLE applications ADD COLUMN totp_secret TEXT'
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch (_) { /* already exists */ }
  }
}

// Auto-scoring for applications
export function computeScore(data) {
  let score = 0;

  // Habilitation active = critical requirement
  if (data.habilitation === 'oui') score += 30;

  // Experience
  const exp = data.experience;
  if (exp === '15+') score += 25;
  else if (exp === '10-15') score += 20;
  else if (exp === '5-10') score += 15;
  else if (exp === '2-5') score += 10;

  // LinkedIn provided and looks real
  if (data.linkedin && data.linkedin.includes('linkedin.com/in/')) score += 10;

  // Qualifications length (more detail = better)
  const qualLen = (data.qualifications || '').length;
  if (qualLen > 200) score += 15;
  else if (qualLen > 100) score += 10;
  else if (qualLen > 30) score += 5;

  // Capacity
  if (data.capacity === 'prioritaire') score += 10;
  else if (data.capacity === 'soutenue') score += 7;
  else if (data.capacity === 'limitee') score += 4;

  // Motivation provided
  if (data.motivation && data.motivation.length > 20) score += 5;

  // Jurisdictions provided
  if (data.jurisdictions && data.jurisdictions.length > 3) score += 5;

  return Math.min(score, 100);
}

// Generate a prefixed API key
export function generateApiKey(env = 'live') {
  const prefix = env === 'test' ? 'hl_test_' : 'hl_live_';
  return prefix + crypto.randomBytes(16).toString('hex');
}

// Hash a password with a random salt
export async function hashPassword(password) {
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(crypto.scrypt);
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return { saltHex: salt.toString('hex'), hashHex: hash.toString('hex') };
}

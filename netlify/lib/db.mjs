// Accès à la base libSQL (Turso) et migrations, exécutées une fois par démarrage à froid.
import { createClient } from '@libsql/client/web';
import { ConfigError } from './http.mjs';

let client = null;
let ready = null;

// Réservé aux tests : injecte un client (ex. base fichier locale).
export function setDbClient(c) {
  client = c;
  ready = null;
}

function getClient() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new ConfigError('TURSO_DATABASE_URL manquante');
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

/** Client prêt à l'emploi (schéma à jour). */
export async function db() {
  const c = getClient();
  if (!ready) {
    ready = migrate(c).catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
  return c;
}

const TABLES = [
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
    callback_url    TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id            TEXT PRIMARY KEY,
    request_id    TEXT NOT NULL,
    sentinel_id   TEXT NOT NULL,
    verdict       TEXT NOT NULL,
    reasoning     TEXT,
    signed_at     TEXT NOT NULL,
    ip_address    TEXT
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
    client_id     TEXT
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
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    actor_type  TEXT NOT NULL,
    actor_id    TEXT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    ip          TEXT,
    details     TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count        INTEGER NOT NULL
  )`,
];

// Colonnes ajoutées au fil des versions (ignorées si déjà présentes).
const COLUMNS = [
  'ALTER TABLE ai_requests ADD COLUMN callback_url TEXT',
  'ALTER TABLE ai_requests ADD COLUMN api_key_id TEXT',
  'ALTER TABLE ai_requests ADD COLUMN sla_breached_at TEXT',
  'ALTER TABLE ai_requests ADD COLUMN escalation_count INTEGER DEFAULT 0',
  'ALTER TABLE ai_requests ADD COLUMN webhook_status TEXT',
  'ALTER TABLE ai_requests ADD COLUMN second_opinion_of TEXT',
  'ALTER TABLE api_keys ADD COLUMN client_id TEXT',
  'ALTER TABLE api_keys ADD COLUMN key_prefix TEXT',
  'ALTER TABLE applications ADD COLUMN totp_secret TEXT',
  'ALTER TABLE applications ADD COLUMN totp_pending_secret TEXT',
  'ALTER TABLE applications ADD COLUMN totp_last_step INTEGER',
  'ALTER TABLE applications ADD COLUMN mfa_enrolled_at TEXT',
  'ALTER TABLE decisions ADD COLUMN signature TEXT',
  'ALTER TABLE decisions ADD COLUMN signed_payload TEXT',
  'ALTER TABLE decisions ADD COLUMN key_id TEXT',
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_requests_key_created ON ai_requests(api_key_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_requests_assigned ON ai_requests(assigned_to, status)',
  'CREATE INDEX IF NOT EXISTS idx_requests_status_expires ON ai_requests(status, expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_decisions_request ON decisions(request_id, signed_at)',
  'CREATE INDEX IF NOT EXISTS idx_keys_client ON api_keys(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_type, actor_id)',
  // Une seule décision finale par demande : empêche les doubles décisions concurrentes.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_final ON decisions(request_id) WHERE verdict IN ('approved', 'rejected')",
  // Un seul second avis par demande tranchée.
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_second_opinion ON ai_requests(second_opinion_of) WHERE second_opinion_of IS NOT NULL',
];

async function migrate(c) {
  await c.batch(TABLES, 'write');
  for (const sql of COLUMNS) {
    try {
      await c.execute(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err && err.message))) console.warn('[migration]', sql, err.message);
    }
  }
  for (const sql of INDEXES) {
    try {
      await c.execute(sql);
    } catch (err) {
      // Ex. doublons hérités qui empêchent l'index unique : on journalise sans bloquer.
      console.warn('[index]', sql, err.message);
    }
  }
}

// Dernière décision d'une demande, sans dupliquer les lignes dans les listes.
export const LATEST_DECISION_JOIN = `LEFT JOIN decisions d ON d.id = (
  SELECT d2.id FROM decisions d2 WHERE d2.request_id = r.id ORDER BY d2.signed_at DESC LIMIT 1
)`;

export const nowIso = () => new Date().toISOString();
export const startOfTodayIso = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

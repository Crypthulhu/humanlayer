// Limites de tentatives stockées en base (fenêtre fixe), valables sur toutes les instances.
import { HttpError } from './http.mjs';

const nowSec = () => Math.floor(Date.now() / 1000);

/** Compte une tentative et indique si la limite est dépassée. */
export async function consume(db, key, limit, windowSec) {
  const now = nowSec();
  const expired = now - windowSec;
  const res = await db.execute({
    sql: `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
            window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
          RETURNING count, window_start`,
    args: [key, now, expired, expired],
  });
  const row = res.rows[0];
  const count = Number(row.count);
  const retryAfter = Math.max(1, Number(row.window_start) + windowSec - now);
  return { allowed: count <= limit, count, retryAfter };
}

/** Lit un compteur sans l'incrémenter. */
export async function peek(db, key, windowSec) {
  const res = await db.execute({ sql: 'SELECT count, window_start FROM rate_limits WHERE key = ?', args: [key] });
  if (!res.rows.length) return { count: 0, retryAfter: 0 };
  const now = nowSec();
  const start = Number(res.rows[0].window_start);
  if (start <= now - windowSec) return { count: 0, retryAfter: 0 };
  return { count: Number(res.rows[0].count), retryAfter: Math.max(1, start + windowSec - now) };
}

export async function reset(db, key) {
  await db.execute({ sql: 'DELETE FROM rate_limits WHERE key = ?', args: [key] });
}

export function tooMany(retryAfter) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return new HttpError(
    429,
    {
      fr: `Trop de tentatives. Réessayez dans ${minutes} min.`,
      en: `Too many attempts. Try again in ${minutes} min.`,
    },
    { code: 'rate_limited', retry_after: retryAfter },
    { 'Retry-After': String(retryAfter) }
  );
}

/** Refuse la requête si la limite est dépassée. */
export async function enforce(db, key, limit, windowSec) {
  const r = await consume(db, key, limit, windowSec);
  if (!r.allowed) throw tooMany(r.retryAfter);
  return r;
}

// Réglages centralisés (fenêtres en secondes).
export const LIMITS = {
  loginPerIp: { limit: 30, window: 15 * 60 },
  loginFailuresPerAccount: { limit: 5, window: 15 * 60 },
  adminFailuresPerIp: { limit: 5, window: 15 * 60 },
  adminFailuresGlobal: { limit: 20, window: 15 * 60 },
  registerPerIp: { limit: 5, window: 60 * 60 },
  applicationPerIp: { limit: 5, window: 60 * 60 },
  totpAttemptsPerSentinel: { limit: 10, window: 15 * 60 },
  requestsPerKeyPerMinute: { limit: 60, window: 60 },
};

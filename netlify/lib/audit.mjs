// Journal d'audit : connexions et actions sensibles. N'interrompt jamais l'action principale.
import crypto from 'node:crypto';

export async function audit(db, { actor_type, actor_id = null, action, target_type = null, target_id = null, ip = null, details = null }) {
  try {
    await db.execute({
      sql: `INSERT INTO audit_log (id, created_at, actor_type, actor_id, action, target_type, target_id, ip, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        new Date().toISOString(),
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        ip,
        details ? JSON.stringify(details).slice(0, 4000) : null,
      ],
    });
  } catch (err) {
    console.error('[audit]', action, err.message);
  }
}

// Tâche planifiée (chaque jour) : applique les durées de conservation de la politique de confidentialité.
import { db } from '../lib/db.mjs';
import { purgeTechnicalData } from '../lib/retention.mjs';

export default async function () {
  try {
    const conn = await db();
    const stats = await purgeTechnicalData(conn);
    if (stats.audit_ips || stats.decision_ips || stats.counters) console.log('[data-retention]', JSON.stringify(stats));
  } catch (err) {
    console.error('[data-retention]', err);
  }
  return new Response('ok');
}

export const config = { schedule: '@daily' };

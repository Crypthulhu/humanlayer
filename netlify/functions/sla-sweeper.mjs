// Tâche planifiée (toutes les 5 minutes) : dépassements de SLA, escalades, routage en attente.
import { db } from '../lib/db.mjs';
import { sweep } from '../lib/routing.mjs';

export default async function () {
  try {
    const conn = await db();
    const stats = await sweep(conn, { limit: 200 });
    if (stats.breached || stats.escalated || stats.routed) console.log('[sla-sweeper]', JSON.stringify(stats));
  } catch (err) {
    console.error('[sla-sweeper]', err);
  }
  return new Response('ok');
}

export const config = { schedule: '*/5 * * * *' };

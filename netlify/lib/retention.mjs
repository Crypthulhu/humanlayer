// Durées de conservation annoncées dans la politique de confidentialité (section 5) :
// les données techniques, c'est-à-dire les adresses IP, sont effacées au bout de 12 mois.
export const TECHNICAL_DATA_MONTHS = 12;

// Aucune limite de tentatives ne dépasse une heure : un compteur plus vieux qu'un jour est mort.
const COUNTER_MAX_AGE_SEC = 24 * 60 * 60;

export function technicalDataCutoff(now = new Date()) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - TECHNICAL_DATA_MONTHS);
  return d.toISOString();
}

/**
 * Efface les adresses IP de plus de 12 mois (journal d'audit, décisions) et supprime les
 * compteurs de tentatives expirés, dont les clés contiennent des adresses IP ou des courriels.
 * Les décisions et les entrées du journal sont conservées : seule l'adresse disparaît.
 */
export async function purgeTechnicalData(conn, now = new Date()) {
  const cutoff = technicalDataCutoff(now);
  const staleBefore = Math.floor(now.getTime() / 1000) - COUNTER_MAX_AGE_SEC;
  const [audit, decisions, counters] = await conn.batch(
    [
      { sql: 'UPDATE audit_log SET ip = NULL WHERE ip IS NOT NULL AND created_at < ?', args: [cutoff] },
      { sql: 'UPDATE decisions SET ip_address = NULL WHERE ip_address IS NOT NULL AND signed_at < ?', args: [cutoff] },
      // Le dernier pas TOTP administrateur (anti-rejeu) n'est pas un compteur : il reste.
      { sql: "DELETE FROM rate_limits WHERE window_start < ? AND key <> 'admin:totp:last_step'", args: [staleBefore] },
    ],
    'write'
  );
  return { audit_ips: audit.rowsAffected, decision_ips: decisions.rowsAffected, counters: counters.rowsAffected };
}

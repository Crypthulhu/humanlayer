// Source unique des niveaux de décision, forfaits, prix et SLA.
// Toute modification ici doit être reportée sur les pages Tarifs et Devenir Sentinel.

// Niveaux de décision : prix client, rémunération du Sentinel et SLA (en minutes).
export const LEVELS = {
  compliance: { level: 1, price_eur: 20, payout_eur: [10, 12], sla_minutes: 30 },
  judgment: { level: 2, price_eur: 100, payout_eur: [50, 60], sla_minutes: 120 },
  signature: { level: 3, price_eur: 250, payout_eur: [125, 150], sla_minutes: 240 },
};

// Part maximale reversée au Sentinel : l'économie reste positive à chaque niveau.
export const SENTINEL_SHARE_MAX = 0.6;
for (const [name, lvl] of Object.entries(LEVELS)) {
  if (lvl.payout_eur[1] > lvl.price_eur * SENTINEL_SHARE_MAX) {
    throw new Error(`Rémunération du niveau ${name} supérieure à ${SENTINEL_SHARE_MAX * 100} % du prix`);
  }
}

// Types acceptés par l'API (alias français conservés pour compatibilité).
export const TYPE_ALIASES = {
  compliance: 'compliance',
  'conformité': 'compliance',
  conformite: 'compliance',
  judgment: 'judgment',
  jugement: 'judgment',
  signature: 'signature',
};

export function normalizeType(value) {
  return TYPE_ALIASES[String(value || '').toLowerCase()] || null;
}

// Forfaits : accès aux niveaux et quota quotidien. « enterprise » est réservé à l'administration.
export const PLANS = {
  compliance: { label: 'Conformité', label_en: 'Compliance', price_eur: 20, daily_limit: 100, types: ['compliance'], self_service: true },
  expert: { label: 'Jugement expert', label_en: 'Expert judgment', price_eur: 100, daily_limit: 50, types: ['compliance', 'judgment'], self_service: true },
  authority: { label: 'Autorité habilitée', label_en: 'Authorized authority', price_eur: 250, daily_limit: 20, types: ['compliance', 'judgment', 'signature'], self_service: true },
  enterprise: { label: 'Enterprise', label_en: 'Enterprise', price_eur: null, daily_limit: 5000, types: ['compliance', 'judgment', 'signature'], self_service: false },
};

export const DEFAULT_PLAN = 'compliance';

export const selfServicePlan = (value) => (PLANS[value] && PLANS[value].self_service ? value : DEFAULT_PLAN);

// Vue publique des forfaits (sans champ interne).
export function publicPlans() {
  return Object.fromEntries(
    Object.entries(PLANS).map(([id, p]) => [id, { label: p.label, label_en: p.label_en, price_eur: p.price_eur, daily_limit: p.daily_limit, types: p.types }])
  );
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_ALIASES = { critical: 'urgent', critique: 'urgent', haute: 'high', basse: 'low' };

export function normalizePriority(value) {
  if (value === undefined || value === null || value === '') return 'normal';
  const v = String(value).toLowerCase();
  const p = PRIORITY_ALIASES[v] || v;
  return PRIORITIES.includes(p) ? p : null;
}

// Domaines d'expertise (identiques au formulaire de candidature).
export const DOMAINS = ['legal', 'finance', 'compliance', 'medical', 'accounting', 'hr', 'insurance', 'quality', 'security', 'other'];
export const EXPERIENCE = ['2-5', '5-10', '10-15', '15+'];
export const CAPACITY = ['ponctuelle', 'limitee', 'soutenue', 'prioritaire'];

// SLA d'une demande : jamais plus court que l'engagement du niveau, au plus 7 jours.
export function slaMinutesFor(type, requested) {
  const base = LEVELS[type].sla_minutes;
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return base;
  return Math.min(Math.max(Math.round(n), base), 7 * 24 * 60);
}

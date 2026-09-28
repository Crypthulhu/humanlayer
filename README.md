# HumanLayer

Site vitrine et API de décision humaine pour agents IA, hébergés sur Netlify.
Les demandes des agents sont routées vers des experts vérifiés (Sentinels),
qui rendent des décisions signées (Ed25519) sous SLA.

## Structure

| Dossier | Contenu |
| --- | --- |
| `public/` | Site servi tel quel (seul dossier publié) : pages FR/EN, portails client, Sentinel et admin |
| `netlify/functions/` | Points d'entrée de l'API (Netlify Functions v2) |
| `netlify/lib/` | Code partagé : base de données, authentification, signatures, limites de tentatives, routage et SLA |
| `scripts/` | `generate-secrets.mjs` (secrets de déploiement), `sync-layout.py` (en-tête et pied de page communs) |
| `tests/` | Tests de bout en bout des fonctions sur une base libSQL locale |

## Développement

```bash
npm install
npm test          # tests de l'API sur une base jetable
npm run layout    # régénère l'en-tête et le pied de page des pages publiques
```

L'API publique répond sur `/api/v1/decisions` et `/api/v1/decision-key`
(redirections déclarées dans `netlify.toml`). La documentation développeurs est
dans `public/developers/`.

## Déploiement

Toutes les variables ci-dessous sont obligatoires, sauf `AI_API_KEY`. Si l'une
manque, les fonctions concernées refusent de servir (`500 server_misconfigured`)
au lieu de fonctionner en mode dégradé.

Générez les secrets avec la commande suivante, puis saisissez-les dans Netlify
(Site settings → Environment variables). Rien n'est écrit sur le disque.

```bash
npm run secrets -- --admin-password "mot de passe administrateur"
```

| Variable | Rôle |
| --- | --- |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Base de données libSQL (Turso) |
| `ADMIN_JWT_SECRET`, `SENTINEL_JWT_SECRET`, `CLIENT_JWT_SECRET` | Signature des sessions, un secret par rôle : 32 caractères minimum, tous différents |
| `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_HASH` | Mot de passe administrateur (scrypt) |
| `ADMIN_TOTP_SECRET` | Second facteur administrateur, obligatoire : à enregistrer dans une application d'authentification |
| `DATA_ENCRYPTION_KEY` | Chiffrement AES-256-GCM des secrets de double authentification (32 octets, hex ou base64) |
| `DECISION_SIGNING_KEY` | Clé privée Ed25519 qui signe les décisions ; la clé publique est servie par `/api/v1/decision-key` |
| `WEBHOOK_SIGNING_SECRET` | Secret maître dont dérive le secret HMAC propre à chaque clé d'API (32 caractères minimum) |
| `AI_API_KEY` | Facultatif : ancienne clé d'API unique, limitée à ses propres demandes |

Ne changez pas `DECISION_SIGNING_KEY` sans raison : les décisions déjà signées
ne se vérifient qu'avec l'ancienne clé publique.

La fonction planifiée `sla-sweeper` s'exécute toutes les 5 minutes. Elle signale
les SLA dépassés et réassigne les demandes à un autre Sentinel.

### Au premier déploiement de cette version

- Les sessions en cours sont invalidées : chacun se reconnecte une fois.
- Chaque Sentinel doit activer la double authentification à sa prochaine connexion. Tant qu'elle n'est pas activée, aucune demande ne lui est routée.
- Les clés d'API stockées en clair sont remplacées par leur empreinte SHA-256 à leur première utilisation, sans action des clients.
- Un Sentinel ne peut être activé que s'il a déclaré une habilitation professionnelle active.

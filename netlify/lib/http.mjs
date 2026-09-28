// Réponses HTTP, erreurs typées et petits utilitaires communs aux fonctions.

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string|{fr: string, en: string}} message  message simple ou bilingue
   * @param {object} [extra]    champs ajoutés au corps JSON (ex. { code })
   * @param {object} [headers]  en-têtes ajoutés (ex. Retry-After)
   */
  constructor(status, message, extra = {}, headers = {}) {
    super(typeof message === 'string' ? message : message.fr);
    this.status = status;
    this.messages = message;
    this.extra = extra;
    this.headers = headers;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

// Langue des messages d'erreur : en-tête explicite, puis page d'origine, puis navigateur.
export function langOf(request) {
  const explicit = (request.headers.get('x-hl-lang') || '').toLowerCase();
  if (explicit === 'en' || explicit === 'fr') return explicit;
  const referer = request.headers.get('referer') || '';
  if (/-en\.html|registration\.html|\/en\//.test(referer)) return 'en';
  const accept = (request.headers.get('accept-language') || '').toLowerCase();
  return accept.startsWith('en') ? 'en' : 'fr';
}

function pick(message, lang) {
  if (typeof message === 'string') return message;
  return message[lang] || message.fr || message.en;
}

// Enveloppe chaque fonction : erreurs HTTP propres, configuration manquante, erreurs imprévues.
export function handler(fn) {
  return async (request, context = {}) => {
    try {
      return await fn(request, context);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.status, { error: pick(err.messages, langOf(request)), ...err.extra }, err.headers);
      }
      if (err && err.name === 'ConfigError') {
        console.error('[config]', err.message);
        return json(500, {
          error: pick({ fr: 'Configuration serveur incomplète', en: 'Server configuration incomplete' }, langOf(request)),
          code: 'server_misconfigured',
        });
      }
      console.error('[unhandled]', err);
      return json(500, { error: pick({ fr: 'Erreur serveur', en: 'Server error' }, langOf(request)), code: 'server_error' });
    }
  };
}

export function allowMethods(request, ...methods) {
  if (!methods.includes(request.method)) {
    throw new HttpError(405, { fr: 'Méthode non autorisée', en: 'Method not allowed' }, { code: 'method_not_allowed' }, { Allow: methods.join(', ') });
  }
}

// Corps JSON borné en taille ; refuse tout ce qui n'est pas un objet.
export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text().catch(() => '');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new HttpError(413, { fr: 'Requête trop volumineuse', en: 'Payload too large' }, { code: 'payload_too_large' });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, { fr: 'JSON invalide', en: 'Invalid JSON' }, { code: 'invalid_json' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, { fr: 'JSON invalide', en: 'Invalid JSON' }, { code: 'invalid_json' });
  }
  return data;
}

export function getBearer(request) {
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

// Netlify fournit l'IP réelle dans context.ip ; X-Forwarded-For peut être forgé.
export function clientIp(request, context) {
  return (context && context.ip) || request.headers.get('x-nf-client-connection-ip') || 'unknown';
}

// Chaîne bornée et nettoyée ; renvoie null si vide.
export function text(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\u0000/g, '').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function requireFields(data, fields) {
  const missing = fields.filter((f) => data[f] === undefined || data[f] === null || String(data[f]).trim() === '');
  if (missing.length) {
    throw new HttpError(400, { fr: `Champs manquants : ${missing.join(', ')}`, en: `Missing fields: ${missing.join(', ')}` }, { code: 'missing_fields', fields: missing });
  }
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

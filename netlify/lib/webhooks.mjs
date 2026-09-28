// Webhooks : URL de rappel validée (HTTPS, hôte public), charge utile signée, livraison attendue.
import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import { HttpError } from './http.mjs';
import { audit } from './audit.mjs';
import { signWebhook, webhookSecretFor } from './security.mjs';

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

const invalidUrl = (reason) =>
  new HttpError(400, { fr: `callback_url invalide : ${reason.fr}`, en: `Invalid callback_url: ${reason.en}` }, { code: 'invalid_callback_url' });

/** Valide une URL de rappel ; résout le DNS pour écarter les adresses internes. */
export async function checkCallbackUrl(raw, { resolve = true } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw invalidUrl({ fr: 'URL illisible', en: 'unparseable URL' });
  }
  if (url.protocol !== 'https:') throw invalidUrl({ fr: 'HTTPS obligatoire', en: 'HTTPS required' });
  if (url.username || url.password) throw invalidUrl({ fr: 'identifiants interdits dans l’URL', en: 'credentials not allowed in URL' });
  if (url.port && !['443', '8443'].includes(url.port)) throw invalidUrl({ fr: 'port non autorisé', en: 'port not allowed' });
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(host)) {
    throw invalidUrl({ fr: 'hôte interne', en: 'internal host' });
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw invalidUrl({ fr: 'adresse privée', en: 'private address' });
  } else if (resolve) {
    let addresses = [];
    try {
      addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
    } catch {
      throw invalidUrl({ fr: 'hôte introuvable', en: 'host not found' });
    }
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      throw invalidUrl({ fr: 'l’hôte pointe vers une adresse privée', en: 'host resolves to a private address' });
    }
  }
  return url.toString();
}

/**
 * Livre un événement signé. En-têtes : X-HumanLayer-Event, X-HumanLayer-Delivery,
 * X-HumanLayer-Signature: t=<horodatage>,v1=<HMAC-SHA256 hex de "t.corps">.
 * Ne lève jamais d'erreur : le résultat est journalisé.
 */
export async function deliverWebhook(conn, { url, keyId, requestId, event, data }) {
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({ id: `evt_${deliveryId}`, type: event, created_at: new Date().toISOString(), data });
  let status;
  try {
    await checkCallbackUrl(url);
    const secret = webhookSecretFor(keyId || 'legacy');
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HumanLayer-Webhooks/1.0',
        'X-HumanLayer-Event': event,
        'X-HumanLayer-Delivery': deliveryId,
        'X-HumanLayer-Signature': `t=${ts},v1=${signWebhook(secret, ts, body)}`,
      },
      body,
    });
    status = res.ok ? `delivered:${res.status}` : `failed:${res.status}`;
  } catch (err) {
    status = `failed:${(err && (err.code || err.name)) || 'error'}`;
  }
  try {
    await conn.execute({ sql: 'UPDATE ai_requests SET webhook_status = ? WHERE id = ?', args: [`${event}:${status}`, requestId] });
  } catch (err) {
    console.error('[webhook status]', err.message);
  }
  await audit(conn, {
    actor_type: 'system',
    action: status.startsWith('delivered') ? 'webhook.delivered' : 'webhook.failed',
    target_type: 'request',
    target_id: requestId,
    details: { event, status, delivery: deliveryId },
  });
  return status;
}

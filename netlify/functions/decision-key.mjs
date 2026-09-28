// Clé publique de vérification des décisions (Ed25519). Publique et mise en cache.
import { handler, allowMethods, json } from '../lib/http.mjs';
import { decisionPublicKey } from '../lib/security.mjs';

export default handler(async (request) => {
  allowMethods(request, 'GET');
  const key = decisionPublicKey();
  return json(
    200,
    {
      ...key,
      signed_field: 'signed_payload',
      how_to_verify:
        'Vérifiez la signature (base64) du champ signed_payload, tel quel, avec cette clé publique Ed25519. / Verify the base64 signature over signed_payload, byte for byte, with this Ed25519 public key.',
    },
    { 'Cache-Control': 'public, max-age=3600' }
  );
});

// Journal d'audit (administrateur) : filtrable et exportable en JSON.
import { db } from '../lib/db.mjs';
import { handler, allowMethods, json } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';

export default handler(async (request) => {
  allowMethods(request, 'GET');
  requireAdmin(request);
  const conn = await db();
  const params = new URL(request.url).searchParams;
  const where = [];
  const args = [];
  for (const field of ['actor_type', 'actor_id', 'action', 'target_id']) {
    const value = params.get(field);
    if (value) {
      where.push(`${field} = ?`);
      args.push(value);
    }
  }
  if (params.get('since')) {
    where.push('created_at >= ?');
    args.push(params.get('since'));
  }
  const limit = Math.min(Math.max(Number(params.get('limit')) || 200, 1), 2000);
  const res = await conn.execute({
    sql: `SELECT id, created_at, actor_type, actor_id, action, target_type, target_id, ip, details
          FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY created_at DESC LIMIT ${limit}`,
    args,
  });
  const entries = res.rows.map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
  const headers = params.get('download') ? { 'Content-Disposition': 'attachment; filename="humanlayer-audit.json"' } : {};
  return json(200, { entries, exported_at: new Date().toISOString() }, headers);
});

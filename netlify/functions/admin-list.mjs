import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { initSchema, getDb } from './db.mjs';
import { jsonResponse, verifyJwt, getBearer } from './_utils.mjs';

const scryptAsync = promisify(crypto.scrypt);

function authorize(request) {
  const token = getBearer(request);
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!token || !secret) return false;
  const payload = verifyJwt(token, secret);
  if (!payload || payload.role !== 'admin') return false;
  return payload;
}

export default async function (request) {
  if (!authorize(request)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  await initSchema();
  const db = getDb();
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);

  // ──────────────────────────────────────────────
  // GET — list or detail
  // ──────────────────────────────────────────────
  if (request.method === 'GET') {
    try {
      // Single application detail
      if (params.id) {
        const result = await db.execute({
          sql: 'SELECT * FROM applications WHERE id = ?',
          args: [params.id]
        });
        if (!result.rows.length) return jsonResponse(404, { error: 'Not found' });
        return jsonResponse(200, { application: result.rows[0] });
      }

      // List with optional filters
      let where = [];
      let args = [];

      if (params.status) {
        where.push('status = ?');
        args.push(params.status);
      }
      if (params.expertise) {
        where.push('expertise = ?');
        args.push(params.expertise);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const result = await db.execute({
        sql: `SELECT * FROM applications ${whereClause} ORDER BY submitted_at DESC LIMIT 500`,
        args
      });

      // Stats
      const stats = await db.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) as qualified,
          SUM(CASE WHEN status = 'activated' THEN 1 ELSE 0 END) as activated,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
        FROM applications`
      );

      return jsonResponse(200, {
        entries: result.rows,
        stats: stats.rows[0] || {}
      });
    } catch (err) {
      console.error('admin-list GET error:', err);
      return jsonResponse(500, { error: 'Read failed' });
    }
  }

  // ──────────────────────────────────────────────
  // PATCH — update status or notes
  // ──────────────────────────────────────────────
  if (request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const { id, status, notes, password } = body;

    if (!id) return jsonResponse(400, { error: 'Missing id' });

    const validStatuses = ['pending', 'qualified', 'activated', 'rejected'];
    if (status && !validStatuses.includes(status)) {
      return jsonResponse(400, { error: `Invalid status. Must be: ${validStatuses.join(', ')}` });
    }

    // Require password when activating
    if (status === 'activated' && !password) {
      return jsonResponse(400, { error: 'Password required when activating a sentinel' });
    }

    try {
      const sets = [];
      const args = [];
      const now = new Date().toISOString();

      if (status) {
        sets.push('status = ?');
        args.push(status);
        sets.push('reviewed_at = ?');
        args.push(now);
        if (status === 'activated') {
          sets.push('activated_at = ?');
          args.push(now);

          // Hash the password for sentinel login
          const salt = crypto.randomBytes(32);
          const hash = await scryptAsync(password, salt, 64);
          sets.push('password_salt = ?');
          args.push(salt.toString('hex'));
          sets.push('password_hash = ?');
          args.push(hash.toString('hex'));
        }
      }
      if (notes !== undefined) {
        sets.push('notes = ?');
        args.push(notes);
      }

      if (!sets.length) return jsonResponse(400, { error: 'Nothing to update' });

      args.push(id);
      await db.execute({
        sql: `UPDATE applications SET ${sets.join(', ')} WHERE id = ?`,
        args
      });

      return jsonResponse(200, { ok: true });
    } catch (err) {
      console.error('admin-list PATCH error:', err);
      return jsonResponse(500, { error: 'Update failed' });
    }
  }

  // ──────────────────────────────────────────────
  // DELETE — remove application
  // ──────────────────────────────────────────────
  if (request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    if (!body.id) return jsonResponse(400, { error: 'Missing id' });

    try {
      await db.execute({
        sql: 'DELETE FROM applications WHERE id = ?',
        args: [body.id]
      });
      return jsonResponse(200, { ok: true });
    } catch (err) {
      console.error('admin-list DELETE error:', err);
      return jsonResponse(500, { error: 'Delete failed' });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
}

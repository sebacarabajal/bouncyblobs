// Conexión a PostgreSQL + migraciones (archivos server/migrations/NNN_nombre.sql, se aplican en orden y una vez).
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function createPool(url) {
  const pool = new pg.Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30000, connectionTimeoutMillis: 4000 });
  pool.on('error', (e) => console.error('[db]', e.message)); // una conexión que se cae no tumba el servidor
  return pool;
}

export async function migrate(pool) {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into schema_migrations (name) values ($1)', [f]);
      await c.query('commit');
      console.log('[db] migración aplicada:', f);
    } catch (e) {
      await c.query('rollback');
      throw new Error(`migración ${f}: ${e.message}`);
    } finally {
      c.release();
    }
  }
}

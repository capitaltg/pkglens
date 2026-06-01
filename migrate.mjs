/**
 * In-process database migrations, run at web-server startup.
 *
 * Uses drizzle-orm's runtime migrator (no drizzle-kit needed) against the
 * committed `drizzle/` folder. A session-level Postgres advisory lock
 * serializes concurrent boots (e.g. 2+ web replicas starting together) so
 * migrations apply exactly once. Idempotent: a pod that loses the race just
 * finds nothing pending.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('./drizzle', import.meta.url))
// Arbitrary constant identifying the DepLens migration lock.
const LOCK_KEY = 4915623

export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  // max: 1 — the advisory lock is session-scoped, so the lock and the
  // migration must run on the same connection.
  const pool = new pg.Pool({ connectionString, max: 1 })
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    const db = drizzle(client)
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    console.log('[migrate] schema up to date')
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
      .catch(() => {})
    client.release()
    await pool.end()
  }
}

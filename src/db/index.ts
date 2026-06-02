import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from './schema.ts'

let instance: NodePgDatabase<typeof schema> | null = null

function getDb(): NodePgDatabase<typeof schema> {
  if (instance) return instance
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is not set')
  instance = drizzle(url, { schema })
  return instance
}

/**
 * Lazy database handle. Importing this module never requires DATABASE_URL — so
 * build, tests, and type-checking work without a database — and the connection
 * is created (and the env validated) only on first actual use.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>
    const value = real[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value
  },
})

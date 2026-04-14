import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from './schema.ts'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL)
  throw new Error('DATABASE_URL environment variable is not set')

export const db = drizzle(DATABASE_URL, { schema })

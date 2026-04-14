import { db } from '#/db/index'
import { analysisResults, packages } from '#/db/schema'
import { eq, sql } from 'drizzle-orm'

/**
 * Score a package's gzip size as a percentile among all analyzed packages
 * in the same ecosystem. A *smaller* package scores *higher*.
 *
 * Returns 0–100 where 100 = smallest (best), 0 = largest (worst).
 */
export async function scoreSizePercentile(
  ecosystem: string,
  gzipBytes: number,
): Promise<number> {
  // Count packages in same ecosystem with gzip size > this one (i.e., larger)
  const result = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(analysisResults)
    .innerJoin(packages, eq(analysisResults.packageId, packages.id))
    .where(
      sql`${packages.ecosystem} = ${ecosystem} AND (${analysisResults.sizeData}->>'gzipBytes')::int > ${gzipBytes}`,
    )

  const largerCount = result[0]?.total ?? 0

  const totalResult = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(analysisResults)
    .innerJoin(packages, eq(analysisResults.packageId, packages.id))
    .where(eq(packages.ecosystem, ecosystem as 'npm' | 'pypi' | 'maven'))

  const total = totalResult[0]?.total ?? 0

  if (total === 0) return 50 // no baseline yet — neutral score

  // Percentile of packages that are larger (i.e., we beat them)
  return Math.round((largerCount / total) * 100)
}

/**
 * Heuristic fallback when the DB has no baseline yet.
 * Uses logarithmic bands that roughly map to npm ecosystem norms.
 */
export function scoreSizeHeuristic(gzipBytes: number): number {
  if (gzipBytes < 5_000) return 95
  if (gzipBytes < 15_000) return 80
  if (gzipBytes < 40_000) return 65
  if (gzipBytes < 80_000) return 50
  if (gzipBytes < 200_000) return 35
  if (gzipBytes < 400_000) return 20
  return 5
}

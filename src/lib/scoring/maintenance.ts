import type { MaintenanceData } from '#/db/schema'

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000

/**
 * Score 0–100 based on how recently the package was published.
 *
 * - Deprecated packages score 0.
 * - Published < 6 months ago: 100
 * - Each additional 6-month window: −20
 * - Older than 3.5 years: 0
 */
export function scoreMaintenance(data: MaintenanceData): number {
  if (data.isDeprecated) return 0

  const lastPublished = new Date(data.lastPublishedAt)
  const ageMs = Date.now() - lastPublished.getTime()

  if (ageMs < 0) return 100 // future date — treat as fresh
  const periods = Math.floor(ageMs / SIX_MONTHS_MS)
  return Math.max(0, 100 - periods * 20)
}

import type { Vulnerability } from '#/db/schema'

const SEVERITY_WEIGHTS: Record<
  NonNullable<Vulnerability['severity']>,
  number
> = {
  critical: 50,
  high: 30,
  medium: 10,
  low: 2,
  unknown: 5,
}

/** Penalty table for total historical CVE count */
function scoreHistoricalFrequency(count: number): number {
  if (count === 0) return 100
  if (count <= 2) return 85
  if (count <= 5) return 70
  if (count <= 10) return 50
  if (count <= 20) return 30
  return 10
}

function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function scorePatchVelocity(vulns: Vulnerability[]): {
  score: number
  medianDays?: number
} {
  if (vulns.length === 0) return { score: 100 } // no CVEs ever: perfect

  const patchedVulns = vulns.filter((v) => v.fixedAt && v.publishedAt)
  if (patchedVulns.length === 0) return { score: 5 } // CVEs exist but none patched

  const patchDays = patchedVulns.map((v) => {
    const published = new Date(v.publishedAt ?? '').getTime()
    const fixed = new Date(v.fixedAt ?? '').getTime()
    return Math.max(0, (fixed - published) / (1000 * 60 * 60 * 24))
  })

  const medianDays = medianOf(patchDays) ?? 0
  let score: number
  if (medianDays < 7) score = 95
  else if (medianDays < 30) score = 80
  else if (medianDays < 90) score = 65
  else if (medianDays < 180) score = 45
  else if (medianDays < 365) score = 25
  else score = 5

  return { score, medianDays: Math.round(medianDays) }
}

export interface SecurityScoreResult {
  score: number
  detail: {
    activeCves: number
    historicalCveCount: number
    medianPatchDays?: number
  }
}

/**
 * Three-sub-component security score:
 * - Active CVE penalty (50%): current-version exposure
 * - Historical CVE frequency (25%): track record of being targeted
 * - Patch velocity (25%): how quickly fixes land
 */
export function scoreSecurity(vulns: Vulnerability[]): SecurityScoreResult {
  // Backward compat: isActive === undefined (old records) treated as active
  const activeVulns = vulns.filter((v) => v.isActive !== false)
  const totalCves = vulns.length

  // Sub-component 1: active CVE penalty (50%)
  const activeDeduction = activeVulns.reduce(
    (acc, v) => acc + (SEVERITY_WEIGHTS[v.severity] ?? 5),
    0,
  )
  const activeCveScore = Math.max(0, 100 - activeDeduction)

  // Sub-component 2: historical frequency (25%)
  const historicalScore = scoreHistoricalFrequency(totalCves)

  // Sub-component 3: patch velocity (25%)
  const { score: patchScore, medianDays } = scorePatchVelocity(vulns)

  const score = Math.round(
    0.5 * activeCveScore + 0.25 * historicalScore + 0.25 * patchScore,
  )

  return {
    score,
    detail: {
      activeCves: activeVulns.length,
      historicalCveCount: totalCves,
      medianPatchDays: medianDays,
    },
  }
}

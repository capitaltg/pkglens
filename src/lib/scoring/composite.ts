import type {
  ScoreData,
  Vulnerability,
  MaintenanceData,
  SizeData,
} from '#/db/schema'
import { scoreSecurity } from './security'
import { scoreMaintenance } from './maintenance'
import { scoreSizeHeuristic, scoreSizePercentile } from './size'

const WEIGHTS = {
  size: 0.4,
  security: 0.4,
  maintenance: 0.2,
} as const

function gradeFromScore(score: number): ScoreData['grade'] {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

export async function computeScoreData(
  ecosystem: string,
  sizeData: SizeData,
  vulns: Vulnerability[],
  maintenanceData: MaintenanceData,
): Promise<ScoreData> {
  // Try DB percentile first; fall back to heuristic for cold-start
  let sizeScore: number
  try {
    const percentile = await scoreSizePercentile(ecosystem, sizeData.gzipBytes)
    // Heuristic wins if DB has no baseline (returns 50 as sentinel)
    sizeScore =
      percentile === 50 ? scoreSizeHeuristic(sizeData.gzipBytes) : percentile
  } catch {
    sizeScore = scoreSizeHeuristic(sizeData.gzipBytes)
  }

  const securityScore = scoreSecurity(vulns)
  const maintenanceScore = scoreMaintenance(maintenanceData)

  const composite = Math.round(
    sizeScore * WEIGHTS.size +
      securityScore * WEIGHTS.security +
      maintenanceScore * WEIGHTS.maintenance,
  )

  return {
    composite,
    grade: gradeFromScore(composite),
    size: sizeScore,
    security: securityScore,
    maintenance: maintenanceScore,
  }
}

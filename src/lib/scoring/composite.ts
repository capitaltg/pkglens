import type {
  ScoreData,
  Vulnerability,
  MaintenanceData,
  SizeData,
  DepNode,
} from '#/db/schema'
import { scoreSecurity } from './security'
import { scoreMaintenance } from './maintenance'
import { scoreSizeHeuristic, scoreSizePercentile } from './size'
import { scorePopularity } from './popularity'
import { scoreTypescript } from './typescript'
import { scoreDepHealth } from './deps'

type Grade = ScoreData['grade']

interface WeightProfile {
  security: number
  maintenance: number
  popularity: number
  size: number
  typescript: number
  depHealth: number
}

/**
 * Ecosystem-specific weight profiles.
 * Size matters for frontend bundles; security/maintenance matter most for backend/server.
 * Maven has no popularity data, so that weight is redistributed.
 */
const WEIGHT_PROFILES: Record<string, WeightProfile> = {
  'npm-frontend': {
    security: 0.2,
    maintenance: 0.15,
    popularity: 0.2,
    size: 0.25,
    typescript: 0.1,
    depHealth: 0.1,
  },
  'npm-backend': {
    security: 0.3,
    maintenance: 0.3,
    popularity: 0.2,
    size: 0.05,
    typescript: 0.05,
    depHealth: 0.1,
  },
  pypi: {
    security: 0.35,
    maintenance: 0.3,
    popularity: 0.2,
    size: 0.05,
    typescript: 0,
    depHealth: 0.1,
  },
  maven: {
    security: 0.4,
    maintenance: 0.35,
    popularity: 0,
    size: 0.1,
    typescript: 0,
    depHealth: 0.15,
  },
}

function gradeFromScore(score: number): Grade {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

interface DimensionScores {
  security: number
  maintenance: number
  popularity: number
  size: number
  typescript: number
  depHealth: number
}

function computeWeighted(
  profile: WeightProfile,
  scores: DimensionScores,
): number {
  return Math.round(
    profile.security * scores.security +
      profile.maintenance * scores.maintenance +
      profile.popularity * scores.popularity +
      profile.size * scores.size +
      profile.typescript * scores.typescript +
      profile.depHealth * scores.depHealth,
  )
}

export async function computeScoreData(
  ecosystem: string,
  sizeData: SizeData,
  vulns: Vulnerability[],
  maintenanceData: MaintenanceData,
  depTree: DepNode[],
): Promise<ScoreData> {
  // Size score (percentile vs. same ecosystem; heuristic fallback)
  let sizeScore: number
  try {
    const percentile = await scoreSizePercentile(ecosystem, sizeData.gzipBytes)
    sizeScore =
      percentile === 50 ? scoreSizeHeuristic(sizeData.gzipBytes) : percentile
  } catch {
    sizeScore = scoreSizeHeuristic(sizeData.gzipBytes)
  }

  // Security score (3-sub-component)
  const { score: securityScore, detail: securityDetail } = scoreSecurity(vulns)

  // Maintenance score
  const maintenanceScore = scoreMaintenance(maintenanceData)

  // Popularity score (0 when no download data)
  const popularityScore =
    maintenanceData.weeklyDownloads !== undefined
      ? scorePopularity(maintenanceData.weeklyDownloads)
      : 0

  // TypeScript score (npm only)
  const typescriptScore =
    ecosystem === 'npm'
      ? scoreTypescript(maintenanceData.typescriptSupport)
      : undefined

  // Dependency health score
  const depHealthScore = scoreDepHealth(depTree)

  const scores: DimensionScores = {
    security: securityScore,
    maintenance: maintenanceScore,
    popularity: popularityScore,
    size: sizeScore,
    typescript: typescriptScore ?? 0,
    depHealth: depHealthScore,
  }

  // Primary composite: backend profile for npm, ecosystem-specific otherwise
  const profile =
    WEIGHT_PROFILES[ecosystem === 'npm' ? 'npm-backend' : ecosystem] ??
    WEIGHT_PROFILES['npm-backend']
  const composite = computeWeighted(profile, scores)

  // For npm: also compute frontend-weighted composite
  const frontend =
    ecosystem === 'npm'
      ? (() => {
          const frontendComposite = computeWeighted(
            WEIGHT_PROFILES['npm-frontend'],
            scores,
          )
          return {
            composite: frontendComposite,
            grade: gradeFromScore(frontendComposite),
          }
        })()
      : undefined

  return {
    composite,
    grade: gradeFromScore(composite),
    size: sizeScore,
    security: securityScore,
    maintenance: maintenanceScore,
    popularity: popularityScore,
    depHealth: depHealthScore,
    typescript: typescriptScore,
    securityDetail,
    frontend,
  }
}

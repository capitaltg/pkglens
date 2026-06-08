import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import {
  analysisJobs,
  analysisResults,
  packages,
  type ScoreData,
  type SizeData,
  type DepNode,
  type Vulnerability,
  type MaintenanceData,
} from '#/db/schema'
import { enqueueAnalysis, enqueueSecurityRefresh } from './queue'
import { resolveLatestVersion } from '#/lib/resolve-version'

// Immutable data (size/tree/bundle) is cached forever; vulnerabilities are
// re-queried in the background when a cached hit is older than this.
const SECURITY_TTL_MS = 24 * 60 * 60 * 1000

export interface AnalysisResponse {
  status: 'complete' | 'pending' | 'running' | 'failed'
  jobId?: number
  data?: {
    packageName: string
    ecosystem: string
    version: string
    analyzedAt: string
    sizeData: SizeData
    depTree: DepNode[]
    scoreData: ScoreData
    vulnerabilities: Vulnerability[]
    maintenanceData: MaintenanceData
  }
  error?: string
}

const ecosystemSchema = z.enum(['npm', 'pypi', 'maven'])

type JoinedRow = {
  packages: typeof packages.$inferSelect
  analysis_results: typeof analysisResults.$inferSelect
}

function buildData(row: JoinedRow): NonNullable<AnalysisResponse['data']> {
  return {
    packageName: row.packages.name,
    ecosystem: row.packages.ecosystem,
    version: row.packages.version,
    analyzedAt: row.analysis_results.createdAt.toISOString(),
    sizeData: row.analysis_results.sizeData,
    depTree: row.analysis_results.depTree,
    scoreData: row.analysis_results.scoreData,
    vulnerabilities: row.analysis_results.vulnerabilities,
    maintenanceData: row.analysis_results.maintenanceData,
  }
}

/** Cached analysis for an exact version. Immutable, so a hit never expires. */
async function loadCachedByVersion(
  ecosystem: 'npm' | 'pypi' | 'maven',
  name: string,
  version: string,
): Promise<JoinedRow | null> {
  const rows = await db
    .select()
    .from(analysisResults)
    .innerJoin(packages, eq(analysisResults.packageId, packages.id))
    .where(
      and(
        eq(packages.ecosystem, ecosystem),
        eq(packages.name, name),
        eq(packages.version, version),
      ),
    )
    .orderBy(desc(analysisResults.createdAt))
    .limit(1)
  return rows[0] ?? null
}

/** Kick off a background OSV refresh if the cached security data is stale. */
function maybeRefreshSecurity(row: JoinedRow): void {
  const ageMs =
    Date.now() - new Date(row.analysis_results.securityRefreshedAt).getTime()
  if (ageMs > SECURITY_TTL_MS) {
    enqueueSecurityRefresh({
      ecosystem: row.packages.ecosystem,
      name: row.packages.name,
      version: row.packages.version,
    }).catch(() => {
      // Background refresh — never fail the request on it.
    })
  }
}

/** Most recently analyzed result for a package, regardless of version. */
async function loadLatestResult(
  ecosystem: 'npm' | 'pypi' | 'maven',
  name: string,
): Promise<JoinedRow | null> {
  const rows = await db
    .select()
    .from(analysisResults)
    .innerJoin(packages, eq(analysisResults.packageId, packages.id))
    .where(and(eq(packages.ecosystem, ecosystem), eq(packages.name, name)))
    .orderBy(desc(analysisResults.createdAt))
    .limit(1)
  return rows[0] ?? null
}

export const getPackageAnalysis = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      ecosystem: ecosystemSchema,
      name: z.string().min(1),
    }).parse,
  )
  .handler(async (ctx): Promise<AnalysisResponse> => {
    const { ecosystem, name } = ctx.data

    // Resolve the latest published version, then check the per-version cache.
    // A published version is immutable, so a hit is served permanently — no TTL.
    const version = await resolveLatestVersion(ecosystem, name)
    if (version) {
      const row = await loadCachedByVersion(ecosystem, name, version)
      if (row) {
        maybeRefreshSecurity(row)
        return { status: 'complete', data: buildData(row) }
      }
    } else {
      // Couldn't resolve (registry down / unknown package) — serve any cached
      // result rather than forcing a recompute.
      const row = await loadLatestResult(ecosystem, name)
      if (row) {
        maybeRefreshSecurity(row)
        return { status: 'complete', data: buildData(row) }
      }
    }

    // Cache miss — enqueue an analysis and report pending.
    const job = await enqueueAnalysis({ ecosystem, name })
    return { status: 'pending', jobId: job.id }
  })

export const getJobStatus = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ jobId: z.coerce.number() }).parse)
  .handler(async (ctx): Promise<AnalysisResponse> => {
    const { jobId } = ctx.data

    const [job] = await db
      .select()
      .from(analysisJobs)
      .where(eq(analysisJobs.id, jobId))
      .limit(1)

    if (!job) return { status: 'failed', error: 'Job not found' }

    if (job.status === 'failed') {
      return { status: 'failed', error: job.errorMessage ?? 'Analysis failed' }
    }

    if (job.status === 'complete') {
      // The worker just wrote this version's row; return it directly without
      // re-resolving "latest" on every poll.
      const row = await loadLatestResult(job.ecosystem, job.name)
      if (row) return { status: 'complete', data: buildData(row) }
      return { status: 'failed', error: 'Result not found' }
    }

    return { status: job.status }
  })

export const searchPackages = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      ecosystem: ecosystemSchema,
      query: z.string().min(1),
    }).parse,
  )
  .handler(async (ctx) => {
    const { ecosystem, query } = ctx.data

    const results = await db
      .select({
        name: packages.name,
        version: packages.version,
        ecosystem: packages.ecosystem,
        analyzedAt: packages.analyzedAt,
      })
      .from(packages)
      .where(
        and(
          eq(packages.ecosystem, ecosystem),
          sql`${packages.name} ILIKE ${`%${query}%`}`,
        ),
      )
      .orderBy(desc(packages.analyzedAt))
      .limit(10)

    return results
  })

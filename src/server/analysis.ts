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
import { enqueueAnalysis } from './queue'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

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

export const getPackageAnalysis = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      ecosystem: ecosystemSchema,
      name: z.string().min(1),
    }).parse,
  )
  .handler(async (ctx): Promise<AnalysisResponse> => {
    const { ecosystem, name } = ctx.data

    // Check for a fresh cached result
    const cached = await db
      .select()
      .from(analysisResults)
      .innerJoin(packages, eq(analysisResults.packageId, packages.id))
      .where(
        and(
          eq(packages.ecosystem, ecosystem),
          eq(packages.name, name),
        ),
      )
      .orderBy(desc(analysisResults.createdAt))
      .limit(1)

    const row = cached[0]
    if (row) {
      const ageMs =
        Date.now() - new Date(row.analysis_results.createdAt).getTime()

      const response: AnalysisResponse = {
        status: 'complete',
        data: {
          packageName: row.packages.name,
          ecosystem: row.packages.ecosystem,
          version: row.packages.version,
          analyzedAt: row.analysis_results.createdAt.toISOString(),
          sizeData: row.analysis_results.sizeData,
          depTree: row.analysis_results.depTree,
          scoreData: row.analysis_results.scoreData,
          vulnerabilities: row.analysis_results.vulnerabilities,
          maintenanceData: row.analysis_results.maintenanceData,
        },
      }

      // Trigger background refresh if stale but still serve cached data
      if (ageMs > SIX_HOURS_MS) {
        enqueueAnalysis({ ecosystem, name }).catch(() => {
          // Background refresh — ignore errors
        })
      }

      return response
    }

    // No cache — enqueue and return pending
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
      return getPackageAnalysis({
        data: { ecosystem: job.ecosystem, name: job.name },
      })
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

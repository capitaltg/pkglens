/**
 * BullMQ worker — run as a separate process:
 *   node --import tsx/esm worker/index.ts
 *   (or `npm run worker` once that script is added)
 *
 * The worker picks up analysis jobs from Redis, runs the appropriate
 * ecosystem analyzer, computes scores, and persists results to the DB.
 */

import { Worker } from 'bullmq'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/index.ts'
import {
  analysisJobs,
  analysisResults,
  packages,
} from '../src/db/schema.ts'
import { analyzeNpmPackage } from '../src/lib/analyzers/npm.ts'
import { analyzePypiPackage } from '../src/lib/analyzers/pypi.ts'
import { analyzeMavenPackage } from '../src/lib/analyzers/maven.ts'
import { computeScoreData } from '../src/lib/scoring/composite.ts'

const QUEUE_NAME = 'analysis'

function fullError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts = [err.message]
  if (err.cause instanceof Error) parts.push(`cause: ${err.cause.message}`)
  return parts.join(' | ')
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { ecosystem, name, dbJobId } = job.data as {
      ecosystem: 'npm' | 'pypi' | 'maven'
      name: string
      dbJobId: number
    }

    try {
      await db
        .update(analysisJobs)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(analysisJobs.id, dbJobId))
    } catch (err) {
      // Log the full error chain before BullMQ serializes it
      console.error(`[worker] Failed to mark job ${dbJobId} as running: ${fullError(err)}`)
      // Don't abort — status tracking is secondary to the analysis itself
    }

    try {
      let version: string
      let sizeData: Awaited<ReturnType<typeof analyzeNpmPackage>>['sizeData']
      let depTree: Awaited<ReturnType<typeof analyzeNpmPackage>>['depTree']
      let vulnerabilities: Awaited<ReturnType<typeof analyzeNpmPackage>>['vulnerabilities']
      let maintenanceData: Awaited<ReturnType<typeof analyzeNpmPackage>>['maintenanceData']

      if (ecosystem === 'npm') {
        const result = await analyzeNpmPackage(name)
        ;({ version, sizeData, depTree, vulnerabilities, maintenanceData } = result)
      } else if (ecosystem === 'pypi') {
        const result = await analyzePypiPackage(name)
        ;({ version, sizeData, depTree, vulnerabilities, maintenanceData } = result)
      } else {
        const result = await analyzeMavenPackage(name)
        ;({ version, sizeData, depTree, vulnerabilities, maintenanceData } = result)
      }

      const scoreData = await computeScoreData(
        ecosystem,
        sizeData,
        vulnerabilities,
        maintenanceData,
      )

      const [pkg] = await db
        .insert(packages)
        .values({ ecosystem, name, version, analyzedAt: new Date() })
        .onConflictDoUpdate({
          target: [packages.ecosystem, packages.name],
          set: { version, analyzedAt: new Date() },
        })
        .returning()

      await db.insert(analysisResults).values({
        packageId: pkg.id,
        sizeData,
        depTree,
        scoreData,
        vulnerabilities,
        maintenanceData,
      })

      await db
        .update(analysisJobs)
        .set({ status: 'complete', updatedAt: new Date() })
        .where(eq(analysisJobs.id, dbJobId))
        .catch((err) => {
          console.error(`[worker] Failed to mark job ${dbJobId} as complete: ${fullError(err)}`)
        })

      console.log(`[worker] ✓ ${ecosystem}/${name}@${version}`)
    } catch (err) {
      const message = fullError(err)
      console.error(`[worker] ✗ ${ecosystem}/${name}: ${message}`)

      await db
        .update(analysisJobs)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(analysisJobs.id, dbJobId))
        .catch((updateErr) => {
          console.error(`[worker] Failed to mark job ${dbJobId} as failed: ${fullError(updateErr)}`)
        })

      throw err
    }
  },
  {
    connection: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
    concurrency: 3,
    // Analysis jobs (esbuild bundling, recursive dep resolution) can take
    // several minutes for large packages. Default lock duration is 30s, which
    // is too short and causes BullMQ to mark running jobs as stalled.
    lockDuration: 300_000, // 5 minutes
  },
)

worker.on('ready', () => {
  console.log('[worker] Ready — listening for analysis jobs')
})

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed after all retries: ${fullError(err)}`)
})

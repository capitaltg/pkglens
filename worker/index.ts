/**
 * BullMQ worker — run as a separate process:
 *   node --import tsx/esm worker/index.ts
 *   (or `npm run worker` once that script is added)
 *
 * The worker picks up analysis jobs from Redis, runs the appropriate
 * ecosystem analyzer, computes scores, and persists results to the DB.
 */

import { Worker, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { and, desc, eq } from 'drizzle-orm'
import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '../src/db/index.ts'
import { analysisJobs, analysisResults, packages } from '../src/db/schema.ts'
import { analyzeNpmPackage } from '../src/lib/analyzers/npm.ts'
import { analyzePypiPackage } from '../src/lib/analyzers/pypi.ts'
import { analyzeMavenPackage } from '../src/lib/analyzers/maven.ts'
import { computeScoreData } from '../src/lib/scoring/composite.ts'
import { getVulnerabilities } from '../src/lib/security-refresh.ts'
import type { SecurityRefreshJobData } from '../src/server/queue.ts'

const QUEUE_NAME = 'analysis'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 3)

function fullError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts = [err.message]
  if (err.cause instanceof Error) parts.push(`cause: ${err.cause.message}`)
  // execFile errors (npm install / esbuild) carry the real reason in stderr —
  // surface it instead of the useless "Command failed: npm install".
  const stderr = (err as { stderr?: unknown }).stderr
  if (stderr) parts.push(`stderr: ${String(stderr).trim().slice(-700)}`)
  return parts.join(' | ')
}

// Remove temp dirs left behind by analyses that were killed before their
// cleanup ran (e.g. an OOM mid-bundle). Runs once at startup.
async function sweepOrphanTempDirs(): Promise<void> {
  try {
    const dir = tmpdir()
    const stale = (await readdir(dir)).filter((e) =>
      e.startsWith('deplens-npm-'),
    )
    await Promise.all(
      stale.map((e) =>
        rm(join(dir, e), { recursive: true, force: true }).catch(() => {}),
      ),
    )
    if (stale.length) {
      console.log(`[worker] swept ${stale.length} orphaned temp dir(s)`)
    }
  } catch {
    // best effort — never block startup on cleanup
  }
}

await sweepOrphanTempDirs()

// Explicit Redis connection so we can log its lifecycle. Repeated reconnects
// here (visible as "[redis] reconnecting") are the usual cause of the worker
// re-printing "Ready" and of jobs stalling/retrying. maxRetriesPerRequest:null
// is required by BullMQ.
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
connection.on('ready', () => console.log('[redis] connected'))
connection.on('reconnecting', () => console.warn('[redis] reconnecting…'))
connection.on('close', () => console.warn('[redis] connection closed'))
connection.on('error', (err) => console.error(`[redis] error: ${err.message}`))

// Cheap, metadata-only security refresh: re-query OSV for an already-cached
// version and recompute the score in place. No install, no esbuild.
async function refreshSecurity(data: SecurityRefreshJobData): Promise<void> {
  const { ecosystem, name, version } = data
  const [row] = await db
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

  if (!row) {
    console.warn(
      `[worker] ↻ security: no cached row for ${ecosystem}/${name}@${version}, skipping`,
    )
    return
  }

  const vulnerabilities = await getVulnerabilities(ecosystem, name, version)
  const scoreData = await computeScoreData(
    ecosystem,
    row.analysis_results.sizeData,
    vulnerabilities,
    row.analysis_results.maintenanceData,
    row.analysis_results.depTree,
  )

  await db
    .update(analysisResults)
    .set({ vulnerabilities, scoreData, securityRefreshedAt: new Date() })
    .where(eq(analysisResults.id, row.analysis_results.id))

  console.log(
    `[worker] ↻ security ${ecosystem}/${name}@${version} (${vulnerabilities.length} vulns, no rebuild)`,
  )
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if ((job.data as { kind?: string }).kind === 'refresh-security') {
      await refreshSecurity(job.data as SecurityRefreshJobData)
      return
    }

    const { ecosystem, name, dbJobId } = job.data as {
      ecosystem: 'npm' | 'pypi' | 'maven'
      name: string
      dbJobId: number
    }

    const startedAt = Date.now()
    console.log(
      `[worker] → analyzing ${ecosystem}/${name} (job ${dbJobId}, attempt ${job.attemptsMade + 1})`,
    )

    try {
      await db
        .update(analysisJobs)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(analysisJobs.id, dbJobId))
    } catch (err) {
      // Log the full error chain before BullMQ serializes it
      console.error(
        `[worker] Failed to mark job ${dbJobId} as running: ${fullError(err)}`,
      )
      // Don't abort — status tracking is secondary to the analysis itself
    }

    try {
      let version: string
      let sizeData: Awaited<ReturnType<typeof analyzeNpmPackage>>['sizeData']
      let depTree: Awaited<ReturnType<typeof analyzeNpmPackage>>['depTree']
      let vulnerabilities: Awaited<
        ReturnType<typeof analyzeNpmPackage>
      >['vulnerabilities']
      let maintenanceData: Awaited<
        ReturnType<typeof analyzeNpmPackage>
      >['maintenanceData']

      if (ecosystem === 'npm') {
        const result = await analyzeNpmPackage(name)
        ;({ version, sizeData, depTree, vulnerabilities, maintenanceData } =
          result)
      } else if (ecosystem === 'pypi') {
        const result = await analyzePypiPackage(name)
        ;({ version, sizeData, depTree, vulnerabilities, maintenanceData } =
          result)
      } else {
        const result = await analyzeMavenPackage(name)
        ;({ version, sizeData, depTree, vulnerabilities, maintenanceData } =
          result)
      }

      const scoreData = await computeScoreData(
        ecosystem,
        sizeData,
        vulnerabilities,
        maintenanceData,
        depTree,
      )

      const [pkg] = await db
        .insert(packages)
        .values({ ecosystem, name, version, analyzedAt: new Date() })
        .onConflictDoUpdate({
          target: [packages.ecosystem, packages.name, packages.version],
          set: { analyzedAt: new Date() },
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
          console.error(
            `[worker] Failed to mark job ${dbJobId} as complete: ${fullError(err)}`,
          )
        })

      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      console.log(`[worker] ✓ ${ecosystem}/${name}@${version} (${secs}s)`)
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
          console.error(
            `[worker] Failed to mark job ${dbJobId} as failed: ${fullError(updateErr)}`,
          )
        })

      throw err
    }
  },
  {
    // BullMQ bundles its own ioredis; cast bridges the dual-package type clash.
    connection: connection as unknown as ConnectionOptions,
    concurrency: CONCURRENCY,
    // Analysis jobs (esbuild bundling, recursive dep resolution) can take
    // several minutes for large packages. Default lock duration is 30s, which
    // is too short and causes BullMQ to mark running jobs as stalled.
    lockDuration: 300_000, // 5 minutes
  },
)

let readyCount = 0
worker.on('ready', () => {
  readyCount += 1
  if (readyCount === 1) {
    console.log(
      `[worker] Ready — listening for analysis jobs (concurrency=${CONCURRENCY})`,
    )
  } else {
    // Re-readying means the Redis connection dropped and came back. Repeated
    // lines here indicate a flapping connection, not normal startup.
    console.warn(
      `[worker] Redis re-ready (#${readyCount}) — connection flapped`,
    )
  }
})

worker.on('error', (err) => console.error(`[worker] error: ${fullError(err)}`))
worker.on('stalled', (jobId) =>
  console.warn(`[worker] job ${jobId} stalled (lock lost / worker too slow)`),
)

worker.on('failed', (job, err) => {
  console.error(
    `[worker] Job ${job?.id} failed after all retries: ${fullError(err)}`,
  )
})

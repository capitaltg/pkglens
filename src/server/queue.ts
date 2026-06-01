import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { analysisJobs } from '#/db/schema'

const QUEUE_NAME = 'analysis'

let _queue: Queue | null = null

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    })
  }
  return _queue
}

export interface AnalysisJobData {
  ecosystem: 'npm' | 'pypi' | 'maven'
  name: string
}

export interface SecurityRefreshJobData {
  kind: 'refresh-security'
  ecosystem: 'npm' | 'pypi' | 'maven'
  name: string
  version: string
}

export async function enqueueAnalysis(
  data: AnalysisJobData,
): Promise<{ id: number }> {
  // Record the job in DB first so we can track it
  const [dbJob] = await db
    .insert(analysisJobs)
    .values({
      ecosystem: data.ecosystem,
      name: data.name,
      status: 'pending',
    })
    .returning({ id: analysisJobs.id })

  const queue = getQueue()
  const bullJob = await queue.add(QUEUE_NAME, { ...data, dbJobId: dbJob.id })

  // Store the BullMQ job id for status polling
  await db
    .update(analysisJobs)
    .set({ bullJobId: bullJob.id ?? null })
    .where(eq(analysisJobs.id, dbJob.id))

  return { id: dbJob.id }
}

/**
 * Enqueue a lightweight, metadata-only security refresh for a cached version.
 * No analysis_jobs row — it's a background update, not user-polled. The
 * deterministic jobId dedupes concurrent refreshes for the same version.
 */
export async function enqueueSecurityRefresh(data: {
  ecosystem: 'npm' | 'pypi' | 'maven'
  name: string
  version: string
}): Promise<void> {
  const payload: SecurityRefreshJobData = { kind: 'refresh-security', ...data }
  // BullMQ forbids ':' in custom job ids, and Maven names contain colons.
  const jobId = `sec_${data.ecosystem}_${data.name}_${data.version}`.replace(
    /:/g,
    '_',
  )
  await getQueue().add(QUEUE_NAME, payload, { jobId, attempts: 2 })
}

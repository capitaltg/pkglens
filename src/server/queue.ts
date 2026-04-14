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

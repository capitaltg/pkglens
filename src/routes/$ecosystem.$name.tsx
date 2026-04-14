import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ScoreBadge, ScoreBreakdown } from '#/components/ScoreBadge'
import { SizeMetrics } from '#/components/SizeMetrics'
import { SecurityPanel } from '#/components/SecurityPanel'
import { MaintenancePanel } from '#/components/MaintenancePanel'
import { DepTree } from '#/components/DepTree'
import {
  getPackageAnalysis,
  getJobStatus,
  type AnalysisResponse,
} from '#/server/analysis'

export const Route = createFileRoute('/$ecosystem/$name')({
  component: PackageDetailPage,
  validateSearch: () => ({}),
  loader: async ({ params }) => {
    const { ecosystem, name } = params
    if (!['npm', 'pypi', 'maven'].includes(ecosystem)) {
      throw notFound()
    }
    return getPackageAnalysis({
      data: { ecosystem: ecosystem as 'npm' | 'pypi' | 'maven', name },
    })
  },
})

const ECOSYSTEM_LABELS: Record<string, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  maven: 'Maven',
}

function SectionCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const id = `section-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section
      aria-labelledby={id}
      className="island-shell rounded-2xl p-5 sm:p-6"
    >
      <h2
        id={id}
        className="mb-4 text-sm font-bold uppercase tracking-widest text-[var(--sea-ink-soft)]"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function PendingState({ jobId }: { jobId: number }) {
  const [status, setStatus] = useState<AnalysisResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 3000))
        if (cancelled) break
        const res = await getJobStatus({ data: { jobId } })
        setStatus(res)
        if (res.status === 'complete' || res.status === 'failed') break
      }
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (status?.status === 'complete' && status.data) {
    return <AnalysisResult data={status.data} />
  }

  if (status?.status === 'failed') {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      >
        Analysis failed: {status.error}
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Analyzing package"
      className="island-shell rounded-2xl p-8 text-center"
    >
      <div
        aria-hidden="true"
        className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[var(--lagoon-deep)] border-t-transparent"
      />
      <p className="text-sm font-medium text-[var(--sea-ink)]">
        Analyzing package…
      </p>
      <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
        This may take up to a minute for large packages
      </p>
    </div>
  )
}

function AnalysisResult({
  data,
}: {
  data: NonNullable<AnalysisResponse['data']>
}) {
  const totalBytes = data.depTree.reduce((s, n) => s + n.totalBytes, 0)

  return (
    <div className="grid gap-4">
      {/* Hero row: score + size */}
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <SectionCard title="Health Score">
          <div className="flex flex-col items-center gap-4">
            <ScoreBadge score={data.scoreData} size="lg" />
            <ScoreBreakdown score={data.scoreData} />
          </div>
        </SectionCard>

        <SectionCard title="Bundle Size">
          <SizeMetrics sizeData={data.sizeData} />
          <p className="mt-3 text-xs text-[var(--sea-ink-soft)]">
            Analyzed at{' '}
            {new Date(data.analyzedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        </SectionCard>
      </div>

      {/* Dependency tree */}
      <SectionCard title="Dependency Tree">
        <DepTree nodes={data.depTree} totalBytes={totalBytes} />
      </SectionCard>

      {/* Security */}
      <SectionCard title="Security">
        <SecurityPanel vulnerabilities={data.vulnerabilities} />
      </SectionCard>

      {/* Maintenance */}
      <SectionCard title="Maintenance">
        <MaintenancePanel data={data.maintenanceData} />
      </SectionCard>
    </div>
  )
}

function PackageDetailPage() {
  const { ecosystem, name } = Route.useParams()
  const initial = Route.useLoaderData()

  const ecosystemLabel = ECOSYSTEM_LABELS[ecosystem] ?? ecosystem

  return (
    <main className="page-wrap px-4 pb-16 pt-8">
      {/* Page header */}
      <header className="rise-in mb-6">
        <p className="island-kicker mb-1">{ecosystemLabel}</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          {name}
        </h1>
        {initial.data?.maintenanceData.description && (
          <p className="mt-2 text-base text-[var(--sea-ink-soft)]">
            {initial.data.maintenanceData.description}
          </p>
        )}
        {initial.data && (
          <p className="mt-1 font-mono text-sm text-[var(--sea-ink-soft)]">
            v{initial.data.version}
          </p>
        )}
      </header>

      {/* Content */}
      {initial.status === 'complete' && initial.data ? (
        <AnalysisResult data={initial.data} />
      ) : initial.status === 'pending' || initial.status === 'running' ? (
        <PendingState jobId={initial.jobId!} />
      ) : initial.status === 'failed' ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          Analysis failed: {initial.error}
        </div>
      ) : null}
    </main>
  )
}

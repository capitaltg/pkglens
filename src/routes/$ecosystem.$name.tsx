import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { cn } from '#/lib/utils'
import { ScoreBreakdown, gradeStyles } from '#/components/ScoreBadge'
import { SizeMetrics, formatBytes } from '#/components/SizeMetrics'
import { SecurityPanel } from '#/components/SecurityPanel'
import {
  MaintenancePanel,
  timeAgo,
  formatDownloads,
  normalizeRepoUrl,
} from '#/components/MaintenancePanel'
import { DepTree } from '#/components/DepTree'
import { BundleTreemap } from '#/components/BundleTreemap'
import type { DepNode } from '#/db/schema'
import {
  getPackageAnalysis,
  getJobStatus,
  type AnalysisResponse,
} from '#/server/analysis'

function countAllNodes(nodes: DepNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countAllNodes(n.children), 0)
}

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

const SIZE_CARD_TITLE: Record<string, string> = {
  npm: 'Bundle Size',
  pypi: 'Package Size',
  maven: 'Artifact Size',
}

// ─── Key stats strip ─────────────────────────────────────────────────────────

function KeyStats({
  data,
  ecosystem,
}: {
  data: NonNullable<AnalysisResponse['data']>
  ecosystem: string
}) {
  const { scoreData, sizeData, maintenanceData } = data
  const grade = scoreData.grade
  const composite = scoreData.composite
  const activeCves = scoreData.securityDetail.activeCves
  const sizeDisplay =
    sizeData.gzipBytes > 0 ? formatBytes(sizeData.gzipBytes) : '—'
  const sizeLabel =
    ecosystem === 'npm'
      ? 'Bundle size'
      : ecosystem === 'pypi'
        ? 'Package size'
        : 'Artifact size'

  return (
    <div
      aria-label="Package at a glance"
      className="island-shell overflow-hidden rounded-xl"
    >
      <div className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">
        {/* Quality grade */}
        <div className="flex flex-col items-center bg-[var(--surface)] px-5 py-6 text-center">
          <div className="flex flex-1 items-center justify-center">
            {scoreData.frontend ? (
              <div
                className="flex items-end gap-8"
                aria-label={`Quality grades — Frontend: ${scoreData.frontend.grade} (${scoreData.frontend.composite}/100), Backend: ${grade} (${composite}/100)`}
              >
                <div className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="text-xs font-semibold text-[var(--sea-ink-soft)]"
                  >
                    Frontend
                  </span>
                  <div
                    aria-hidden="true"
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-xl border-2 font-black font-mono text-3xl',
                      gradeStyles[scoreData.frontend.grade],
                    )}
                  >
                    {scoreData.frontend.grade}
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-xs text-[var(--sea-ink-soft)]"
                  >
                    {scoreData.frontend.composite}/100
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="text-xs font-semibold text-[var(--sea-ink-soft)]"
                  >
                    Backend
                  </span>
                  <div
                    aria-hidden="true"
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-xl border-2 font-black font-mono text-3xl',
                      gradeStyles[grade],
                    )}
                  >
                    {grade}
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-xs text-[var(--sea-ink-soft)]"
                  >
                    {composite}/100
                  </span>
                </div>
              </div>
            ) : (
              <div
                aria-label={`Quality grade: ${grade}, ${composite} out of 100`}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    'flex h-20 w-20 items-center justify-center rounded-2xl border-2 font-black font-mono text-5xl',
                    gradeStyles[grade],
                  )}
                >
                  {grade}
                </div>
                <span
                  aria-hidden="true"
                  className="text-sm text-[var(--sea-ink-soft)]"
                >
                  {composite}/100
                </span>
              </div>
            )}
          </div>
          <span
            aria-hidden="true"
            className="mt-3 text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]"
          >
            Quality
          </span>
        </div>

        {/* Size */}
        <div className="flex flex-col items-center bg-[var(--surface)] px-5 py-6 text-center">
          <div className="flex flex-1 items-center justify-center">
            <span
              aria-label={`${sizeLabel}: ${sizeDisplay}`}
              className="text-4xl font-black leading-none tracking-tight text-[var(--sea-ink)]"
            >
              {sizeDisplay}
            </span>
          </div>
          <span
            aria-hidden="true"
            className="mt-3 text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]"
          >
            {sizeLabel}
          </span>
        </div>

        {/* Active CVEs */}
        <div className="flex flex-col items-center bg-[var(--surface)] px-5 py-6 text-center">
          <div className="flex flex-1 items-center justify-center">
            <span
              aria-label={`Active CVEs: ${activeCves}`}
              className={cn(
                'text-4xl font-black leading-none',
                activeCves === 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400',
              )}
            >
              {activeCves}
            </span>
          </div>
          <span
            aria-hidden="true"
            className="mt-3 text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]"
          >
            Active CVEs
          </span>
        </div>

        {/* Last published */}
        <div className="flex flex-col items-center bg-[var(--surface)] px-5 py-6 text-center">
          <div className="flex flex-1 items-center justify-center">
            <span
              aria-label={`Last published: ${timeAgo(maintenanceData.lastPublishedAt)}`}
              className="text-4xl font-black leading-tight tracking-tight text-[var(--sea-ink)]"
            >
              {timeAgo(maintenanceData.lastPublishedAt)}
            </span>
          </div>
          <span
            aria-hidden="true"
            className="mt-3 text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]"
          >
            Last Published
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  titleAction,
  meta,
  children,
}: {
  title: string
  titleAction?: React.ReactNode
  meta?: React.ReactNode
  children: React.ReactNode
}) {
  const id = `section-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section
      aria-labelledby={id}
      className="island-shell flex flex-col rounded-xl p-5 sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2
            id={id}
            className="text-sm font-bold uppercase tracking-widest text-[var(--sea-ink-soft)]"
          >
            {title}
          </h2>
          {titleAction}
        </div>
        {meta && <div className="flex items-center gap-2 text-sm">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

// ─── Pending / error states ───────────────────────────────────────────────────

function PendingState({
  jobId,
  ecosystem,
}: {
  jobId: number
  ecosystem: string
}) {
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
    return <AnalysisResult data={status.data} ecosystem={ecosystem} />
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
      className="island-shell rounded-xl p-8 text-center"
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

// ─── Analysis result layout ───────────────────────────────────────────────────

function AnalysisResult({
  data,
  ecosystem,
}: {
  data: NonNullable<AnalysisResponse['data']>
  ecosystem: string
}) {
  const totalBytes = data.depTree.reduce((s, n) => s + n.totalBytes, 0)
  const directCount = data.depTree.length
  const totalCount = countAllNodes(data.depTree)
  const [treeExpanded, setTreeExpanded] = useState<boolean | undefined>(
    undefined,
  )
  const [treeForceVersion, setTreeForceVersion] = useState(0)
  const allExpanded = treeExpanded === true

  function expandAll() {
    setTreeExpanded(true)
    setTreeForceVersion((v) => v + 1)
  }
  function collapseAll() {
    setTreeExpanded(false)
    setTreeForceVersion((v) => v + 1)
  }

  const sizeTitle = SIZE_CARD_TITLE[ecosystem] ?? 'Size'

  return (
    <div className="grid gap-4">
      {/* At-a-glance stats strip */}
      <KeyStats data={data} ecosystem={ecosystem} />

      {/* Score breakdown */}
      <SectionCard title="Score Breakdown">
        <ScoreBreakdown score={data.scoreData} />
      </SectionCard>

      {/* Bundle / package size */}
      <SectionCard title={sizeTitle}>
        <SizeMetrics sizeData={data.sizeData} />
        <p className="mt-auto pt-4 text-xs text-[var(--sea-ink-soft)]">
          Analyzed{' '}
          {new Date(data.analyzedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      </SectionCard>

      {/* Security */}
      <SectionCard title="Security">
        <SecurityPanel vulnerabilities={data.vulnerabilities} />
      </SectionCard>

      {/* Dependency tree */}
      <SectionCard
        title="Dependency Tree"
        titleAction={
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="text-xs font-semibold text-[var(--lagoon-deep)] hover:underline"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        }
        meta={
          <>
            <span className="font-semibold text-[var(--sea-ink)]">
              {directCount} direct
            </span>
            <span className="text-[var(--line)]">·</span>
            <span className="text-[var(--sea-ink-soft)]">
              {totalCount} total
            </span>
          </>
        }
      >
        <DepTree
          nodes={data.depTree}
          totalBytes={totalBytes}
          forceExpanded={treeExpanded}
          forceVersion={treeForceVersion}
        />
      </SectionCard>

      {/* Maintenance */}
      <SectionCard title="Maintenance">
        <MaintenancePanel data={data.maintenanceData} />
      </SectionCard>

      {/* Bundle map — npm only, least critical so placed last */}
      {ecosystem === 'npm' && (
        <SectionCard title="Bundle Map">
          <BundleTreemap nodes={data.depTree} />
        </SectionCard>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PackageDetailPage() {
  const { ecosystem, name } = Route.useParams()
  const initial = Route.useLoaderData()

  const ecosystemLabel = ECOSYSTEM_LABELS[ecosystem] ?? ecosystem
  const meta = initial.data?.maintenanceData

  return (
    <main className="page-wrap px-4 pb-16 pt-8">
      {/* Page header */}
      <header className="rise-in mb-6">
        <p className="island-kicker mb-2">{ecosystemLabel}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
          {name}
        </h1>

        {meta?.description && (
          <p className="mt-2 max-w-2xl text-base text-[var(--sea-ink-soft)]">
            {meta.description}
          </p>
        )}

        {/* Metadata row */}
        {initial.data && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="font-mono text-[var(--sea-ink-soft)]">
              v{initial.data.version}
            </span>
            {meta?.license && (
              <span className="text-[var(--sea-ink-soft)]">{meta.license}</span>
            )}
            {meta?.weeklyDownloads !== undefined &&
              meta.weeklyDownloads > 0 && (
                <span className="text-[var(--sea-ink-soft)]">
                  {formatDownloads(meta.weeklyDownloads)} downloads/wk
                </span>
              )}
            {meta?.homepage && (
              <a
                href={meta.homepage}
                target="_blank"
                rel="noreferrer"
                aria-label="Homepage (opens in new tab)"
                className="font-medium"
              >
                Homepage ↗
              </a>
            )}
            {meta?.repositoryUrl && (
              <a
                href={normalizeRepoUrl(meta.repositoryUrl)}
                target="_blank"
                rel="noreferrer"
                aria-label="Repository (opens in new tab)"
                className="font-medium"
              >
                Repository ↗
              </a>
            )}
            {ecosystem === 'npm' && (
              <a
                href={`https://www.npmjs.com/package/${encodeURIComponent(name)}`}
                target="_blank"
                rel="noreferrer"
                aria-label="View on npm (opens in new tab)"
                className="font-medium"
              >
                npm ↗
              </a>
            )}
          </div>
        )}

        {/* Deprecation warning in header so it's always above the fold */}
        {meta?.isDeprecated && (
          <div
            role="alert"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
          >
            ⚠ This package is deprecated
          </div>
        )}
      </header>

      {/* Content */}
      {initial.status === 'complete' && initial.data ? (
        <AnalysisResult data={initial.data} ecosystem={ecosystem} />
      ) : initial.status === 'pending' || initial.status === 'running' ? (
        <PendingState jobId={initial.jobId!} ecosystem={ecosystem} />
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

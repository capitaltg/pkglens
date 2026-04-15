import { useState } from 'react'
import type { Vulnerability } from '#/db/schema'
import { cn } from '#/lib/utils'

interface SecurityPanelProps {
  vulnerabilities: Vulnerability[]
}

const severityOrder: Vulnerability['severity'][] = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
]

const severityLabel: Record<Vulnerability['severity'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
}

const severityStyles: Record<Vulnerability['severity'], string> = {
  critical:
    'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  high: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  medium:
    'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800',
  low: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
  unknown:
    'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function patchDaysCount(v: Vulnerability): number | undefined {
  if (!v.publishedAt || !v.fixedAt) return undefined
  const ms = new Date(v.fixedAt).getTime() - new Date(v.publishedAt).getTime()
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

function formatPatchDuration(v: Vulnerability): string | undefined {
  if (!v.publishedAt || !v.fixedAt) return undefined
  const ms = new Date(v.fixedAt).getTime() - new Date(v.publishedAt).getTime()

  // Fix was available before or simultaneous with public disclosure —
  // coordinated/responsible disclosure where the patch shipped first.
  if (ms <= 0) return 'Patched before disclosure'

  const totalMinutes = Math.round(ms / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days >= 1) {
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (hours >= 1) {
    const minPart =
      minutes > 0 ? ` ${minutes} ${minutes === 1 ? 'min' : 'mins'}` : ''
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}${minPart}`
  }
  return `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`
}

function medianOf(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ─── Shared card ──────────────────────────────────────────────────────────────

function VulnCard({
  v,
  showStatus,
}: {
  v: Vulnerability
  showStatus: boolean
}) {
  const duration = formatPatchDuration(v)
  const isActive = v.isActive !== false

  const cveId = v.aliases.find((a) => a.startsWith('CVE-'))
  const displayId = cveId ?? v.id

  return (
    <li className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={`https://osv.dev/vulnerability/${v.id}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Vulnerability ${displayId} (opens in new tab)`}
            className="mb-0.5 block text-sm font-bold text-[var(--lagoon-deep)] hover:underline"
          >
            {displayId}
          </a>
          <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{v.summary}</p>
          {showStatus && (
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {v.publishedAt && (
                <span className="text-[var(--sea-ink-soft)]">
                  Published {formatDate(v.publishedAt)}
                </span>
              )}
              {v.publishedAt && (
                <span
                  aria-hidden="true"
                  className="text-[var(--sea-ink-soft)]"
                  style={{ fontSize: '15px' }}
                >
                  ·
                </span>
              )}
              {!isActive && v.fixedVersion && (
                <>
                  <span className="text-[var(--sea-ink-soft)]">
                    Fixed in{' '}
                    <span className="font-semibold text-[var(--sea-ink)]">
                      v{v.fixedVersion}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-[var(--sea-ink-soft)]"
                    style={{ fontSize: '15px' }}
                  >
                    ·
                  </span>
                </>
              )}
              {isActive ? (
                <span className="font-semibold text-red-600 dark:text-red-400">
                  Active
                </span>
              ) : duration !== undefined ? (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {duration === 'Patched before disclosure'
                    ? duration
                    : `Patched in ${duration}`}
                </span>
              ) : (
                <span className="text-[var(--sea-ink-soft)]">Resolved</span>
              )}
            </div>
          )}
        </div>
        <span
          aria-label={`Severity: ${severityLabel[v.severity]}`}
          className={cn(
            'flex-shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
            severityStyles[v.severity],
          )}
        >
          <span aria-hidden="true">{severityLabel[v.severity]}</span>
        </span>
      </div>
    </li>
  )
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-1 pb-2.5 pt-0.5 text-sm font-semibold transition',
        active
          ? 'border-[var(--lagoon-deep)] text-[var(--lagoon-deep)]'
          : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]',
      )}
    >
      {label}
      <span
        className={cn(
          'ml-2 rounded-full px-1.5 py-0.5 text-xs',
          active
            ? 'bg-[var(--lagoon)]/20 text-[var(--lagoon-deep)]'
            : 'bg-[var(--surface-strong)] text-[var(--sea-ink-soft)]',
        )}
      >
        {count}
      </span>
    </button>
  )
}

// ─── Active tab ───────────────────────────────────────────────────────────────

function ActiveTab({ vulns }: { vulns: Vulnerability[] }) {
  if (vulns.length === 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
      >
        <span aria-hidden="true" className="text-base">
          ✓
        </span>
        No active vulnerabilities
      </div>
    )
  }

  const sorted = [...vulns].sort(
    (a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  )
  const counts = sorted.reduce(
    (acc, v) => {
      acc[v.severity] = (acc[v.severity] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  return (
    <div>
      <ul
        aria-label="Vulnerability summary by severity"
        className="flex flex-wrap gap-2 list-none p-0 m-0"
      >
        {severityOrder
          .filter((s) => counts[s])
          .map((s) => (
            <li key={s}>
              <span
                className={cn(
                  'rounded-full border px-3 py-0.5 text-xs font-semibold',
                  severityStyles[s],
                )}
              >
                {counts[s]} {severityLabel[s]}
              </span>
            </li>
          ))}
      </ul>
      <ul
        aria-label="Active vulnerabilities"
        className="mt-4 space-y-3 list-none p-0 m-0"
      >
        {sorted.map((v) => (
          <VulnCard key={v.id} v={v} showStatus={false} />
        ))}
      </ul>
    </div>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({
  vulns,
  medianPatchDays,
}: {
  vulns: Vulnerability[]
  medianPatchDays?: number
}) {
  const patchedCount = vulns.filter((v) => v.fixedAt).length

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
        <span className="font-semibold text-[var(--sea-ink)]">
          {vulns.length}
        </span>{' '}
        {vulns.length === 1 ? 'vulnerability' : 'vulnerabilities'} total
        {patchedCount > 0 && (
          <>
            <span className="mx-1 text-[var(--sea-ink-soft)]">•</span>
            <span className="font-semibold text-[var(--sea-ink)]">
              {patchedCount}
            </span>{' '}
            patched
          </>
        )}
        {medianPatchDays !== undefined && (
          <>
            <span className="mx-1 text-[var(--sea-ink-soft)]">•</span>
            {medianPatchDays === 0 ? (
              'Typically patched same-day'
            ) : (
              <>
                <span className="font-semibold text-[var(--sea-ink)]">
                  {medianPatchDays} {medianPatchDays === 1 ? 'day' : 'days'}
                </span>{' '}
                median fix time
              </>
            )}
          </>
        )}
      </p>
      <ul
        aria-label="Vulnerability history"
        className="space-y-3 list-none p-0 m-0"
      >
        {vulns.map((v) => (
          <VulnCard key={v.id} v={v} showStatus={true} />
        ))}
      </ul>
    </div>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────

export function SecurityPanel({ vulnerabilities }: SecurityPanelProps) {
  const [tab, setTab] = useState<'active' | 'history'>('active')

  if (vulnerabilities.length === 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
      >
        <span aria-hidden="true" className="text-base">
          ✓
        </span>
        No known vulnerabilities found via OSV
      </div>
    )
  }

  const activeVulns = vulnerabilities.filter((v) => v.isActive !== false)

  // History: newest published first; active vulns float to top within same date
  const historySorted = [...vulnerabilities].sort((a, b) => {
    const aDate = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const bDate = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    if (bDate !== aDate) return bDate - aDate
    // active before resolved when dates are equal
    return (a.isActive !== false ? 0 : 1) - (b.isActive !== false ? 0 : 1)
  })

  const patchDays = vulnerabilities
    .map(patchDaysCount)
    .filter((d): d is number => d !== undefined)
  const medianPatchDays = medianOf(patchDays)

  return (
    <div>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Security views"
        className="mb-5 flex gap-5 border-b border-[var(--line)]"
      >
        <TabButton
          label="Active"
          count={activeVulns.length}
          active={tab === 'active'}
          onClick={() => setTab('active')}
        />
        <TabButton
          label="History"
          count={vulnerabilities.length}
          active={tab === 'history'}
          onClick={() => setTab('history')}
        />
      </div>

      {tab === 'active' ? (
        <ActiveTab vulns={activeVulns} />
      ) : (
        <HistoryTab vulns={historySorted} medianPatchDays={medianPatchDays} />
      )}
    </div>
  )
}

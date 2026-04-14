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

export function SecurityPanel({ vulnerabilities }: SecurityPanelProps) {
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

  const sorted = [...vulnerabilities].sort(
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
    <div className="space-y-4">
      {/* Summary chips */}
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

      {/* Vuln list */}
      <ul
        aria-label="Vulnerabilities"
        className="mt-4 space-y-3 list-none p-0 m-0"
      >
        {sorted.map((v) => (
          <li
            key={v.id}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p
                  className="mb-0.5 text-sm font-semibold text-[var(--sea-ink)]"
                  aria-label={`Vulnerability ID: ${v.id}`}
                >
                  {v.id}
                </p>
                <p className="m-0 text-sm text-[var(--sea-ink-soft)]">
                  {v.summary}
                </p>
                {v.aliases.length > 0 && (
                  <p className="mt-1 m-0 text-xs text-[var(--sea-ink-soft)]">
                    <span className="sr-only">Also known as: </span>
                    <span aria-hidden="true">Also known as: </span>
                    {v.aliases.join(', ')}
                  </p>
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
        ))}
      </ul>
    </div>
  )
}

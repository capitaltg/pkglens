import { useState } from 'react'
import type { MaintenanceData } from '#/db/schema'

interface MaintenancePanelProps {
  data: MaintenanceData
}

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days < 1) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`
  const years = Math.floor(days / 365)
  return `${years} year${years > 1 ? 's' : ''} ago`
}

export function normalizeRepoUrl(url: string): string {
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
}

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 80

  if (!isLong) return <span>{text}</span>

  return (
    <span>
      <span className={expanded ? '' : 'line-clamp-2'}>{text}</span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-0.5 block text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
        aria-expanded={expanded}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  )
}

export function MaintenancePanel({ data }: MaintenancePanelProps) {
  return (
    <div className="space-y-4">
      {data.isDeprecated && (
        <div
          role="alert"
          className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
        >
          ⚠ This package is deprecated
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-[var(--sea-ink-soft)]">Last published</dt>
          <dd className="m-0 text-sm font-semibold text-[var(--sea-ink)]">
            {new Date(data.lastPublishedAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </dd>
        </div>
        {data.weeklyDownloads !== undefined && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-[var(--sea-ink-soft)]">
              Weekly downloads
            </dt>
            <dd className="m-0 text-sm font-semibold text-[var(--sea-ink)]">
              {formatDownloads(data.weeklyDownloads)}
            </dd>
          </div>
        )}
        {data.typescriptSupport && data.typescriptSupport !== 'none' && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-[var(--sea-ink-soft)]">TypeScript</dt>
            <dd className="m-0 text-sm font-semibold text-[var(--sea-ink)]">
              <ExpandableText
                text={
                  data.typescriptSupport === 'bundled'
                    ? 'Bundled types'
                    : 'DefinitelyTyped'
                }
              />
            </dd>
          </div>
        )}
      </dl>

      {data.keywords && data.keywords.length > 0 && (
        <ul
          aria-label="Keywords"
          className="flex flex-wrap gap-1.5 list-none p-0 m-0"
        >
          {data.keywords.slice(0, 12).map((kw) => (
            <li
              key={kw}
              className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-0.5 text-xs text-[var(--sea-ink-soft)]"
            >
              {kw}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

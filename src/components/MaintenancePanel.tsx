import type { MaintenanceData } from '#/db/schema'

interface MaintenancePanelProps {
  data: MaintenanceData
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function timeAgo(iso: string): string {
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

interface StatProps {
  label: string
  value: React.ReactNode
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--sea-ink-soft)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--sea-ink)]">{value}</span>
    </div>
  )
}

export function MaintenancePanel({ data }: MaintenancePanelProps) {
  return (
    <div className="space-y-4">
      {data.isDeprecated && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
          ⚠ This package is deprecated
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Last published"
          value={timeAgo(data.lastPublishedAt)}
        />
        {data.weeklyDownloads !== undefined && (
          <Stat
            label="Weekly downloads"
            value={formatDownloads(data.weeklyDownloads)}
          />
        )}
        {data.license && <Stat label="License" value={data.license} />}
      </div>

      {data.description && (
        <p className="m-0 text-sm text-[var(--sea-ink-soft)]">
          {data.description}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        {data.homepage && (
          <a href={data.homepage} target="_blank" rel="noreferrer">
            Homepage ↗
          </a>
        )}
        {data.repositoryUrl && (
          <a
            href={normalizeRepoUrl(data.repositoryUrl)}
            target="_blank"
            rel="noreferrer"
          >
            Repository ↗
          </a>
        )}
      </div>

      {data.keywords && data.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.keywords.slice(0, 12).map((kw) => (
            <span
              key={kw}
              className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-0.5 text-xs text-[var(--sea-ink-soft)]"
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function normalizeRepoUrl(url: string): string {
  // Convert git+https:// or git:// to https://
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
}

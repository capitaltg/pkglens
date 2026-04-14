import type { SizeData } from '#/db/schema'

interface SizeMetricsProps {
  sizeData: SizeData
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const SLOW_3G_KBPS = 40 // ~40 KB/s on slow 3G

function loadTime(gzipBytes: number): string {
  const seconds = gzipBytes / (SLOW_3G_KBPS * 1024)
  if (seconds < 0.01) return '< 10ms'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  return `${seconds.toFixed(1)}s`
}

export function SizeMetrics({ sizeData }: SizeMetricsProps) {
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-8">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]">
            Minified
          </dt>
          <dd className="m-0 mt-1.5 text-4xl font-black leading-none tracking-tight text-[var(--sea-ink)]">
            {formatBytes(sizeData.minifiedBytes)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]">
            Minified + Gzip
          </dt>
          <dd className="m-0 mt-1.5 text-4xl font-black leading-none tracking-tight text-[var(--sea-ink)]">
            {formatBytes(sizeData.gzipBytes)}
          </dd>
        </div>
      </dl>

      {sizeData.treeShakedBytes !== undefined && (
        <dl>
          <dt className="text-xs font-semibold uppercase tracking-widest text-[var(--sea-ink-soft)]">
            Tree-shaked + Gzip
          </dt>
          <dd className="m-0 mt-1.5 text-2xl font-bold leading-none text-[var(--sea-ink)]">
            {formatBytes(sizeData.treeShakedBytes)}
          </dd>
        </dl>
      )}

      <div className="border-t border-[var(--line)] pt-4 text-sm text-[var(--sea-ink-soft)]">
        ⚡ {loadTime(sizeData.gzipBytes)} to download on a slow 3G connection
      </div>
    </div>
  )
}

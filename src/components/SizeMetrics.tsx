import type { SizeData } from '#/db/schema'

interface SizeMetricsProps {
  sizeData: SizeData
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-[var(--sea-ink-soft)]">{label}</dt>
      <dd className="m-0 text-lg font-bold text-[var(--sea-ink)]">{value}</dd>
      {note && (
        <span className="text-xs text-[var(--sea-ink-soft)]">{note}</span>
      )}
    </div>
  )
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
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Metric
        label="Minified"
        value={formatBytes(sizeData.minifiedBytes)}
        note="Before gzip"
      />
      <Metric
        label="Minified + Gzip"
        value={formatBytes(sizeData.gzipBytes)}
        note="Transfer size"
      />
      <Metric
        label="Download on slow 3G"
        value={loadTime(sizeData.gzipBytes)}
        note="~40 KB/s connection"
      />
      {sizeData.treeShakedBytes !== undefined && (
        <Metric
          label="Tree-shaked"
          value={formatBytes(sizeData.treeShakedBytes)}
          note="With unused exports removed"
        />
      )}
    </dl>
  )
}

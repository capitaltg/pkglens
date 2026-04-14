import { useState } from 'react'
import type { DepNode } from '#/db/schema'
import { cn } from '#/lib/utils'

interface DepTreeProps {
  nodes: DepNode[]
  totalBytes: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function DepNodeRow({
  node,
  rootBytes,
  depth,
}: {
  node: DepNode
  rootBytes: number
  depth: number
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const pct = rootBytes > 0 ? (node.totalBytes / rootBytes) * 100 : 0
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
          hasChildren && 'cursor-pointer hover:bg-[var(--surface)]',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setExpanded((e) => !e)}
      >
        {/* Expand/collapse toggle */}
        <span className="w-3 flex-shrink-0 text-[var(--sea-ink-soft)]">
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>

        {/* Name */}
        <span className="flex-1 truncate font-medium text-[var(--sea-ink)]">
          {node.name}
        </span>

        {/* Version */}
        <span className="flex-shrink-0 font-mono text-xs text-[var(--sea-ink-soft)]">
          {node.version}
        </span>

        {/* Size bar */}
        <div className="relative hidden h-1 w-16 rounded-full bg-[var(--line)] sm:block">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-[var(--lagoon-deep)]"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>

        {/* Size label */}
        <span className="w-14 flex-shrink-0 text-right font-mono text-xs text-[var(--sea-ink-soft)]">
          {formatBytes(node.totalBytes)}
        </span>
      </div>

      {expanded && hasChildren && (
        <ul className="list-none p-0 m-0">
          {node.children.map((child) => (
            <DepNodeRow
              key={`${child.name}@${child.version}`}
              node={child}
              rootBytes={rootBytes}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function DepTree({ nodes, totalBytes }: DepTreeProps) {
  if (nodes.length === 0) {
    return (
      <p className="text-sm text-[var(--sea-ink-soft)]">
        No dependencies found.
      </p>
    )
  }

  const sorted = [...nodes].sort((a, b) => b.totalBytes - a.totalBytes)

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)]">
      {/* Column headers */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
        <span className="w-3 flex-shrink-0" />
        <span className="flex-1">Package</span>
        <span className="flex-shrink-0">Version</span>
        <span className="hidden w-16 sm:block" />
        <span className="w-14 text-right">Size (gzip)</span>
      </div>

      <ul className="list-none divide-y divide-[var(--line)] p-0 m-0">
        {sorted.map((node) => (
          <DepNodeRow
            key={`${node.name}@${node.version}`}
            node={node}
            rootBytes={totalBytes}
            depth={0}
          />
        ))}
      </ul>
    </div>
  )
}

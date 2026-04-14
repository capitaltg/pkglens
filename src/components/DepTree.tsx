import { useEffect, useState } from 'react'
import type { DepNode } from '#/db/schema'
import { cn } from '#/lib/utils'

interface DepTreeProps {
  nodes: DepNode[]
  totalBytes: number
  forceExpanded?: boolean
  forceVersion?: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function barColor(pct: number): string {
  if (pct > 40) return 'bg-rose-400 dark:bg-rose-500'
  if (pct > 15) return 'bg-amber-400 dark:bg-amber-500'
  return 'bg-[var(--lagoon-deep)]'
}

function labelColor(pct: number): string {
  if (pct > 40) return 'text-rose-500 dark:text-rose-400'
  if (pct > 15) return 'text-amber-500 dark:text-amber-400'
  return 'text-[var(--sea-ink-soft)]'
}

function DepNodeRow({
  node,
  rootBytes,
  depth,
  setSize,
  posInSet,
  forceExpanded,
  forceVersion,
}: {
  node: DepNode
  rootBytes: number
  depth: number
  setSize: number
  posInSet: number
  forceExpanded: boolean | undefined
  forceVersion: number
}) {
  const [expanded, setExpanded] = useState(false)
  const pct = rootBytes > 0 ? (node.totalBytes / rootBytes) * 100 : 0
  const hasChildren = node.children.length > 0

  useEffect(() => {
    if (forceExpanded !== undefined) setExpanded(forceExpanded)
  }, [forceVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const all = Array.from(
          document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
        )
        const idx = all.findIndex((el) => el === e.currentTarget)
        all[idx + 1]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const all = Array.from(
          document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
        )
        const idx = all.findIndex((el) => el === e.currentTarget)
        all[idx - 1]?.focus()
        break
      }
      case 'ArrowRight':
        e.preventDefault()
        if (hasChildren) {
          if (!expanded) {
            setExpanded(true)
          } else {
            const all = Array.from(
              document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
            )
            const idx = all.findIndex((el) => el === e.currentTarget)
            all[idx + 1]?.focus()
          }
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (hasChildren && expanded) setExpanded(false)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (hasChildren) setExpanded((v) => !v)
        break
    }
  }

  const sizeLabel = formatBytes(node.totalBytes)
  const ariaLabel = `${node.name} version ${node.version}, size ${sizeLabel === '—' ? 'unknown' : sizeLabel}`

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-label={ariaLabel}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        aria-setsize={setSize}
        aria-posinset={posInSet}
        tabIndex={0}
        className={cn(
          'group flex items-center gap-3 py-2 pl-3 pr-3 text-sm outline-none',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lagoon-deep)]',
          hasChildren
            ? 'cursor-pointer hover:bg-[var(--surface-strong)]'
            : 'hover:bg-[var(--surface-strong)]/60',
        )}
        onClick={() => hasChildren && setExpanded((v) => !v)}
        onKeyDown={handleKeyDown}
      >
        {/* Chevron */}
        <span
          aria-hidden="true"
          className="flex w-3 flex-shrink-0 items-center justify-center"
        >
          {hasChildren && (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(
                'h-3 w-3 text-[var(--sea-ink-soft)] transition-transform duration-150',
                expanded && 'rotate-90',
              )}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          )}
        </span>

        {/* Name */}
        <span
          aria-hidden="true"
          className="flex-1 truncate font-medium text-[var(--sea-ink)]"
        >
          {node.name}
        </span>

        {/* Version chip */}
        <span
          aria-hidden="true"
          className="flex-shrink-0 rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--sea-ink-soft)]"
        >
          {node.version}
        </span>

        {/* Size bar + percentage */}
        <div
          aria-hidden="true"
          className="hidden w-20 flex-shrink-0 flex-col items-center gap-0.5 sm:flex ml-4"
        >
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                barColor(pct),
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          {pct > 0 && (
            <span className={cn('text-xs tabular-nums', labelColor(pct))}>
              {pct < 1 ? '<1' : Math.round(pct)}%
            </span>
          )}
        </div>

        {/* Size label */}
        <span
          aria-hidden="true"
          className={cn(
            'w-20 flex-shrink-0 text-right font-mono text-xs tabular-nums',
            labelColor(pct),
          )}
        >
          {sizeLabel}
        </span>
      </div>

      {expanded && hasChildren && (
        <ul
          role="group"
          className="m-0 list-none border-l border-[var(--line)] p-0"
          style={{ marginLeft: `${depth * 16 + 18}px` }}
        >
          {node.children.map((child, i) => (
            <DepNodeRow
              key={`${child.name}@${child.version}`}
              node={child}
              rootBytes={rootBytes}
              depth={depth + 1}
              setSize={node.children.length}
              posInSet={i + 1}
              forceExpanded={forceExpanded}
              forceVersion={forceVersion}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function DepTree({
  nodes,
  totalBytes,
  forceExpanded,
  forceVersion = 0,
}: DepTreeProps) {
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
      <div
        aria-hidden="true"
        className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]"
      >
        <span className="w-3 flex-shrink-0" />
        <span className="flex-1">Package</span>
        <span className="flex-shrink-0">Version</span>
        <span className="hidden w-20 flex-shrink-0 text-center sm:block ml-4">
          Share
        </span>
        <span className="w-20 text-right">Size</span>
      </div>

      <ul
        role="tree"
        aria-label="Dependency tree"
        className="m-0 list-none divide-y divide-[var(--line)] p-0"
      >
        {sorted.map((node, i) => (
          <DepNodeRow
            key={`${node.name}@${node.version}`}
            node={node}
            rootBytes={totalBytes}
            depth={0}
            setSize={sorted.length}
            posInSet={i + 1}
            forceExpanded={forceExpanded}
            forceVersion={forceVersion}
          />
        ))}
      </ul>
    </div>
  )
}

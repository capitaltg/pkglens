import { useEffect, useRef, useState } from 'react'
import type { DepNode } from '#/db/schema'

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const PALETTE = [
  '#6366f1',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#3b82f6',
  '#84cc16',
  '#f97316',
  '#a855f7',
]

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++)
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

// ── Layout algorithm (binary-split treemap, pixel coordinates) ────────────────

interface LayoutInput {
  name: string
  version: string
  bytes: number
  [key: string]: unknown
}

interface LayoutRect extends LayoutInput {
  x: number
  y: number
  w: number
  h: number
}

function buildLayout(
  items: LayoutInput[],
  x: number,
  y: number,
  w: number,
  h: number,
  horizontal = true,
): LayoutRect[] {
  if (items.length === 0 || w <= 0 || h <= 0) return []
  if (items.length === 1) return [{ ...items[0], x, y, w, h }]

  const total = items.reduce((s, i) => s + i.bytes, 0)
  let cumulative = 0
  let splitIdx = 0
  for (let i = 0; i < items.length; i++) {
    cumulative += items[i].bytes
    splitIdx = i
    if (cumulative >= total / 2) break
  }

  const first = items.slice(0, splitIdx + 1)
  const second = items.slice(splitIdx + 1)
  const ratio = first.reduce((s, i) => s + i.bytes, 0) / total

  if (horizontal) {
    const w1 = Math.round(w * ratio)
    return [
      ...buildLayout(first, x, y, w1, h, !horizontal),
      ...buildLayout(second, x + w1, y, w - w1, h, !horizontal),
    ]
  } else {
    const h1 = Math.round(h * ratio)
    return [
      ...buildLayout(first, x, y, w, h1, !horizontal),
      ...buildLayout(second, x, y + h1, w, h - h1, !horizontal),
    ]
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const GAP = 2 // px gap between child tiles inside a root tile
const ROOT_GAP = 2 // px gap between root-level tiles
const HEADER_H = 22 // px height of the root-tile name header
const INNER_PAD = 3 // px padding inside root tile around children
const BREADCRUMB_H = 28 // px height of the breadcrumb bar when zoomed in

interface TooltipInfo {
  name: string
  version: string
  bytes: number
  pct: number
  parentName?: string
  canDrillIn?: boolean
}

interface BundleTreemapProps {
  nodes: DepNode[]
}

export function BundleTreemap({ nodes }: BundleTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)
  const [selectedPath, setSelectedPath] = useState<DepNode[]>([])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setDims({
        w: Math.floor(entry.contentRect.width),
        h: Math.floor(entry.contentRect.height),
      })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const isZoomed = selectedPath.length > 0
  const totalBytes = nodes.reduce((s, n) => s + n.totalBytes, 0)

  function zoomInto(node: DepNode) {
    if (node.children.length > 0) {
      setSelectedPath((prev) => [...prev, node])
      setTooltip(null)
    }
  }

  function zoomTo(depth: number) {
    setSelectedPath((prev) => prev.slice(0, depth))
    setTooltip(null)
  }

  const currentNodes = isZoomed
    ? selectedPath[selectedPath.length - 1].children
    : nodes

  const layoutTop = isZoomed ? BREADCRUMB_H + GAP : GAP
  const layoutH = dims.h - layoutTop - GAP

  const rootItems: Array<LayoutInput & { children: DepNode[] }> = currentNodes
    .filter((n) => n.totalBytes > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .map((n) => ({
      name: n.name,
      version: n.version,
      bytes: n.totalBytes,
      children: n.children,
    }))

  const rootTiles =
    dims.w > 0 && layoutH > 0
      ? buildLayout(rootItems, GAP, layoutTop, dims.w - GAP * 2, layoutH)
      : []

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl bg-[var(--surface-strong)]"
      style={{ aspectRatio: '2 / 1' }}
      onMouseLeave={() => setTooltip(null)}
    >
      {/* Breadcrumb navigation (shown when zoomed in) */}
      {isZoomed && (
        <nav
          aria-label="Treemap zoom path"
          className="absolute left-0 right-0 top-0 z-20 flex items-center gap-0.5 border-b border-[var(--line)] bg-[var(--surface-strong)] px-2"
          style={{ height: BREADCRUMB_H }}
        >
          <button
            type="button"
            onClick={() => zoomTo(0)}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
          >
            All packages
          </button>
          {selectedPath.map((node, i) => (
            <span key={node.name} className="flex items-center gap-0.5">
              <span
                className="select-none text-[var(--sea-ink-soft)]"
                aria-hidden="true"
              >
                ›
              </span>
              <button
                type="button"
                onClick={() => zoomTo(i + 1)}
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  i === selectedPath.length - 1
                    ? 'cursor-default text-[var(--sea-ink)]'
                    : 'text-[var(--lagoon-deep)] hover:underline'
                }`}
              >
                {node.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {(rootTiles as Array<LayoutRect & { children: DepNode[] }>).map(
        (tile) => {
          const color = colorFor(tile.name)
          // Visual tile dimensions (shrunk by ROOT_GAP on all sides for gap between tiles)
          const tx = tile.x + ROOT_GAP
          const ty = tile.y + ROOT_GAP
          const tw = tile.w - ROOT_GAP * 2
          const th = tile.h - ROOT_GAP * 2
          const showLabel = tw > 40 && th > 18

          // Children are packed below the header band
          const innerX = tx + INNER_PAD
          const innerY = ty + HEADER_H
          const innerW = tw - INNER_PAD * 2
          const innerH = th - HEADER_H - INNER_PAD

          const childItems: LayoutInput[] = (tile.children ?? [])
            .filter((c) => c.totalBytes > 0)
            .sort((a, b) => b.totalBytes - a.totalBytes)
            .map((c) => ({
              name: c.name,
              version: c.version,
              bytes: c.totalBytes,
            }))

          const childTiles =
            childItems.length > 0 && innerW > 20 && innerH > 12
              ? buildLayout(childItems, innerX, innerY, innerW, innerH)
              : []

          // Find the actual DepNode for this root tile (for zoom navigation)
          const tileNode = currentNodes.find(
            (n) => n.name === tile.name && n.version === tile.version,
          )

          return (
            <div key={tile.name}>
              {/* Root tile */}
              <div
                role={
                  tileNode && tileNode.children.length > 0
                    ? 'button'
                    : undefined
                }
                tabIndex={
                  tileNode && tileNode.children.length > 0 ? 0 : undefined
                }
                aria-label={
                  tileNode && tileNode.children.length > 0
                    ? `${tile.name} — click to zoom in`
                    : undefined
                }
                className="absolute overflow-hidden"
                style={{
                  left: tx,
                  top: ty,
                  width: tw,
                  height: th,
                  backgroundColor: color,
                  borderRadius: 5,
                  cursor:
                    tileNode && tileNode.children.length > 0
                      ? 'pointer'
                      : 'default',
                }}
                onMouseEnter={() =>
                  setTooltip({
                    name: tile.name,
                    version: tile.version,
                    bytes: tile.bytes,
                    pct: (tile.bytes / totalBytes) * 100,
                    canDrillIn: tileNode && tileNode.children.length > 0,
                  })
                }
                onClick={() => tileNode && zoomInto(tileNode)}
                onKeyDown={(e) => {
                  if (tileNode && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    zoomInto(tileNode)
                  }
                }}
              >
                {/* Header band */}
                {showLabel && (
                  <div
                    className="flex items-center gap-1.5 overflow-hidden px-2"
                    style={{ height: HEADER_H }}
                  >
                    <span
                      className="truncate font-bold text-white"
                      style={{ fontSize: 11, lineHeight: 1 }}
                    >
                      {tile.name}
                    </span>
                    {tw > 120 && (
                      <span
                        className="flex-shrink-0 text-white/60"
                        style={{ fontSize: 10 }}
                      >
                        {formatBytes(tile.bytes)}
                      </span>
                    )}
                  </div>
                )}

                {/* Separator between header and children */}
                {childTiles.length > 0 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      top: HEADER_H - 1,
                      height: 1,
                      backgroundColor: 'rgba(0,0,0,0.15)',
                    }}
                  />
                )}
              </div>

              {/* Child tiles — rendered on top of root, semi-transparent white */}
              {childTiles.map((child) => {
                const childKey = `${tile.name}::${child.name}`
                const showChildLabel = child.w > 28 && child.h > 14
                const childNode = (tile.children ?? []).find(
                  (c) => c.name === child.name && c.version === child.version,
                )
                const childCanDrillIn = (childNode?.children?.length ?? 0) > 0

                return (
                  <div
                    key={childKey}
                    role={childCanDrillIn ? 'button' : undefined}
                    tabIndex={childCanDrillIn ? 0 : undefined}
                    aria-label={
                      childCanDrillIn
                        ? `${child.name} — click to zoom in`
                        : undefined
                    }
                    className="absolute overflow-hidden"
                    style={{
                      left: child.x + GAP,
                      top: child.y + GAP,
                      width: Math.max(0, child.w - GAP * 2),
                      height: Math.max(0, child.h - GAP * 2),
                      backgroundColor: 'rgba(255,255,255,0.18)',
                      borderRadius: 3,
                      border: '1px solid rgba(255,255,255,0.25)',
                      cursor: childCanDrillIn ? 'pointer' : 'default',
                    }}
                    onMouseEnter={() =>
                      setTooltip({
                        name: child.name,
                        version: child.version,
                        bytes: child.bytes,
                        pct: (child.bytes / totalBytes) * 100,
                        parentName: tile.name,
                        canDrillIn: childCanDrillIn,
                      })
                    }
                    onClick={() =>
                      childNode && childCanDrillIn && zoomInto(childNode)
                    }
                    onKeyDown={(e) => {
                      if (
                        childNode &&
                        childCanDrillIn &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault()
                        zoomInto(childNode)
                      }
                    }}
                  >
                    {showChildLabel && (
                      <div className="flex h-full flex-col justify-end overflow-hidden p-1">
                        <span
                          className="truncate font-semibold text-white"
                          style={{
                            fontSize: 10,
                            lineHeight: 1.2,
                            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                          }}
                        >
                          {child.name.replace(/^@[^/]+\//, '')}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        },
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 rounded-lg px-3 py-2 text-xs shadow-xl"
          style={{
            background: 'rgba(15,23,42,0.93)',
            backdropFilter: 'blur(6px)',
          }}
        >
          {tooltip.parentName && (
            <p
              className="mb-1"
              style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}
            >
              inside {tooltip.parentName}
            </p>
          )}
          <p className="font-bold text-white">{tooltip.name}</p>
          <p className="mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {tooltip.version}
            <span
              className="mx-1.5"
              style={{ color: 'rgba(255,255,255,0.25)' }}
            >
              ·
            </span>
            {formatBytes(tooltip.bytes)}
            <span
              className="mx-1.5"
              style={{ color: 'rgba(255,255,255,0.25)' }}
            >
              ·
            </span>
            {tooltip.pct < 1 ? '<1' : Math.round(tooltip.pct)}% of bundle
          </p>
          {tooltip.canDrillIn && (
            <p
              className="mt-1.5"
              style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}
            >
              Click to zoom in
            </p>
          )}
        </div>
      )}
    </div>
  )
}

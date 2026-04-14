import type { DepNode } from '#/db/schema'

function countAllDeps(nodes: DepNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countAllDeps(n.children), 0)
}

/**
 * Score 0–100 based on dependency tree health.
 *
 * Two sub-components:
 * - Dep count (60%): logarithmic penalty — max(0, 100 - log2(total+1) * 14)
 * - Dep freshness (40%): fraction of direct deps that have size data (proxy for activeness)
 */
export function scoreDepHealth(depTree: DepNode[]): number {
  const totalDeps = countAllDeps(depTree)

  // Sub-component 1: total dep count penalty
  const countScore = Math.max(0, 100 - Math.log2(totalDeps + 1) * 14)

  // Sub-component 2: freshness — direct deps with resolved size data
  const directCount = depTree.length
  const withSize = depTree.filter((d) => d.totalBytes > 0).length
  const freshnessScore =
    directCount === 0 ? 100 : (withSize / directCount) * 100

  return Math.round(0.6 * countScore + 0.4 * freshnessScore)
}

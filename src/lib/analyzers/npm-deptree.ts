/**
 * Dependency tree resolution from registry metadata.
 *
 * This replaces the previous approach of running a full `npm install` plus an
 * esbuild bundle for every node in the tree. That cost one install per
 * dependency, recursively — for a package with 23 direct dependencies it meant
 * well over a hundred installs, which in practice never finished.
 *
 * Sizes here come from `dist.unpackedSize` in the packument, which is the
 * unpacked tarball size. That is a different quantity from the minified+gzip
 * bundle size measured for the root package: it includes docs, source maps and
 * any extra module formats the package ships. It is used for *relative*
 * attribution within the tree, not as a bundle-size figure.
 */

import type { DepNode } from '#/db/schema'
import {
  fetchPackument,
  mapWithConcurrency,
  resolveVersion,
} from './npm-registry'

/** How deep to walk. Matches the previous analyzer's limit. */
const MAX_DEPTH = 5

/** Upper bound on resolved nodes, so a pathological tree cannot run away. */
const MAX_NODES = 750

/** Concurrent registry requests. */
const CONCURRENCY = 12

interface ResolveContext {
  /**
   * Every `name@version` already expanded somewhere in the tree. The first
   * occurrence carries the bytes; later occurrences become zero-weight
   * references so a shared dependency is not counted twice — mirroring how
   * npm dedupes a real install.
   */
  seen: Set<string>
  nodeCount: number
}

function leaf(name: string, version: string): DepNode {
  return {
    name,
    version,
    ecosystem: 'npm',
    selfBytes: 0,
    totalBytes: 0,
    children: [],
  }
}

async function resolveNode(
  name: string,
  range: string,
  depth: number,
  ctx: ResolveContext,
): Promise<DepNode> {
  if (ctx.nodeCount >= MAX_NODES) return leaf(name, range)

  const packument = await fetchPackument(name)
  if (!packument) return leaf(name, range)

  const version = resolveVersion(packument, range)
  if (!version) return leaf(name, range)

  const key = `${name}@${version}`

  // Already counted elsewhere in the tree — reference it without re-expanding
  // or re-counting its bytes.
  if (ctx.seen.has(key)) return leaf(name, version)
  ctx.seen.add(key)
  ctx.nodeCount++

  const meta = packument.versions?.[version]
  const selfBytes = meta?.dist?.unpackedSize ?? 0

  if (depth >= MAX_DEPTH) {
    return {
      name,
      version,
      ecosystem: 'npm',
      selfBytes,
      totalBytes: selfBytes,
      children: [],
    }
  }

  const deps = Object.entries(meta?.dependencies ?? {})
  const children =
    deps.length === 0
      ? []
      : await mapWithConcurrency(deps, CONCURRENCY, ([depName, depRange]) =>
          resolveNode(depName, depRange, depth + 1, ctx),
        )

  const childTotal = children.reduce((sum, c) => sum + c.totalBytes, 0)

  return {
    name,
    version,
    ecosystem: 'npm',
    selfBytes,
    totalBytes: selfBytes + childTotal,
    children,
  }
}

/**
 * Resolve the dependency tree of `directDeps` (the root package's own
 * dependencies) using registry metadata only.
 *
 * Ranges are resolved with semver against published versions, so the tree
 * reports the versions npm would actually install rather than whatever
 * `latest` happens to be.
 */
export async function resolveDepTreeFromRegistry(
  directDeps: Record<string, string>,
): Promise<DepNode[]> {
  const entries = Object.entries(directDeps)
  if (entries.length === 0) return []

  const ctx: ResolveContext = { seen: new Set(), nodeCount: 0 }

  return mapWithConcurrency(entries, CONCURRENCY, ([name, range]) =>
    resolveNode(name, range, 1, ctx),
  )
}

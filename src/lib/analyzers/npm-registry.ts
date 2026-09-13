/**
 * Shared npm registry client.
 *
 * Everything here works from registry metadata alone — no installs, no disk.
 * The abbreviated packument (`application/vnd.npm.install-v1+json`) is far
 * smaller than the full document and still carries `dependencies`,
 * `peerDependencies`, and `dist.unpackedSize`, which is all the dependency
 * tree needs.
 */

import { maxSatisfying, valid, validRange } from 'semver'

export const NPM_REGISTRY = 'https://registry.npmjs.org'
export const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week'

const ABBREVIATED = 'application/vnd.npm.install-v1+json'

export interface PackumentVersion {
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  deprecated?: string | boolean
  types?: string
  typings?: string
  dist?: { unpackedSize?: number; tarball?: string }
}

export interface Packument {
  name: string
  'dist-tags': Record<string, string>
  versions: Record<string, PackumentVersion>
  time?: Record<string, string>
}

/**
 * Scoped names must keep their `@` and encode only the slash, so
 * `@scope/pkg` becomes `@scope%2Fpkg`. Previously duplicated in three places.
 */
export function encodeNpmName(name: string): string {
  return name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)
}

// Packuments are immutable enough over the life of one analysis, and a large
// tree asks for the same popular packages repeatedly. Memoize the in-flight
// promise so concurrent branches share a single request.
const packumentCache = new Map<string, Promise<Packument | null>>()

export function clearPackumentCache(): void {
  packumentCache.clear()
}

export function fetchPackument(name: string): Promise<Packument | null> {
  const cached = packumentCache.get(name)
  if (cached) return cached

  const inflight = (async (): Promise<Packument | null> => {
    try {
      const res = await fetch(`${NPM_REGISTRY}/${encodeNpmName(name)}`, {
        headers: { Accept: ABBREVIATED },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return null
      return (await res.json()) as Packument
    } catch {
      return null
    }
  })()

  packumentCache.set(name, inflight)
  return inflight
}

/**
 * Full (non-abbreviated) packument — only needed when we want `time`, which
 * the abbreviated document omits. Used for publish dates and CVE fix dates.
 */
export async function fetchFullPackument(
  name: string,
): Promise<Packument | null> {
  try {
    const res = await fetch(`${NPM_REGISTRY}/${encodeNpmName(name)}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return (await res.json()) as Packument
  } catch {
    return null
  }
}

export async function fetchWeeklyDownloads(name: string): Promise<number> {
  try {
    const res = await fetch(`${NPM_DOWNLOADS}/${name}`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return 0
    const data = (await res.json()) as { downloads?: number }
    return data.downloads ?? 0
  } catch {
    return 0
  }
}

/**
 * Resolve a dependency range to the concrete version npm would install:
 * the highest published version satisfying the range.
 *
 * Falls back to `dist-tags.latest` for ranges semver cannot handle — tags
 * (`"latest"`), URLs, git specs, and `workspace:`/`npm:` aliases.
 */
export function resolveVersion(
  packument: Packument,
  range: string,
): string | null {
  const latest = packument['dist-tags']?.latest ?? null
  const versions = Object.keys(packument.versions ?? {})
  if (versions.length === 0) return latest

  if (valid(range)) return versions.includes(range) ? range : latest

  const tagged = packument['dist-tags']?.[range]
  if (tagged) return tagged

  if (!validRange(range)) return latest

  return maxSatisfying(versions, range) ?? latest
}

/**
 * Run async tasks with a bounded concurrency so a wide tree cannot open
 * hundreds of sockets against the registry at once.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let next = 0

  async function run(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

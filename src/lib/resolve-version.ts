/**
 * Resolve the latest published version of a package from registry metadata.
 *
 * Cheap, single HTTP call per ecosystem — no install, no bundling. Used on the
 * request path so the server can compute the per-version cache key before
 * deciding whether to enqueue an analysis. Returns null if the package can't be
 * resolved (unknown package or registry unreachable); callers fall back to
 * serving whatever is already cached.
 */

const NPM_REGISTRY = 'https://registry.npmjs.org'
const PYPI_API = 'https://pypi.org/pypi'
const MAVEN_SEARCH = 'https://search.maven.org/solrsearch/select'

export type Ecosystem = 'npm' | 'pypi' | 'maven'

export async function resolveLatestVersion(
  ecosystem: Ecosystem,
  name: string,
): Promise<string | null> {
  try {
    if (ecosystem === 'npm') return await resolveNpm(name)
    if (ecosystem === 'pypi') return await resolvePypi(name)
    return await resolveMaven(name)
  } catch {
    return null
  }
}

async function resolveNpm(name: string): Promise<string | null> {
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)
  const res = await fetch(`${NPM_REGISTRY}/${encoded}`, {
    // Abbreviated metadata — much smaller than the full packument.
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const meta = (await res.json()) as { 'dist-tags'?: Record<string, string> }
  return meta['dist-tags']?.latest ?? null
}

async function resolvePypi(name: string): Promise<string | null> {
  const res = await fetch(`${PYPI_API}/${encodeURIComponent(name)}/json`, {
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const meta = (await res.json()) as { info?: { version?: string } }
  return meta.info?.version ?? null
}

async function resolveMaven(name: string): Promise<string | null> {
  const [groupId, artifactId] = name.split(':')
  if (!groupId || !artifactId) return null
  const q = encodeURIComponent(`g:${groupId} AND a:${artifactId}`)
  const res = await fetch(`${MAVEN_SEARCH}?q=${q}&core=gav&rows=1&wt=json`, {
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    response?: { docs?: Array<{ latestVersion?: string; v?: string }> }
  }
  const doc = data.response?.docs?.[0]
  return doc?.latestVersion ?? doc?.v ?? null
}

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const ecosystemSchema = z.enum(['npm', 'pypi', 'maven'])

export interface RegistryResult {
  name: string
  description: string
  version: string
}

export const searchRegistry = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({ ecosystem: ecosystemSchema, query: z.string().min(2) }).parse,
  )
  .handler(async (ctx): Promise<RegistryResult[]> => {
    const { ecosystem, query } = ctx.data

    try {
      if (ecosystem === 'npm') return await searchNpm(query)
      if (ecosystem === 'pypi') return await searchPypi(query)
      if (ecosystem === 'maven') return await searchMaven(query)
      return []
    } catch {
      return []
    }
  })

async function searchNpm(query: string): Promise<RegistryResult[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) return []

  const data = (await res.json()) as {
    objects: Array<{
      package: {
        name: string
        description?: string
        version: string
      }
    }>
  }

  const q = query.toLowerCase()
  return data.objects
    .filter(({ package: pkg }) => pkg.name.toLowerCase().includes(q))
    .slice(0, 8)
    .map(({ package: pkg }) => ({
      name: pkg.name,
      description: pkg.description ?? '',
      version: pkg.version,
    }))
}

// ── PyPI simple index cache ───────────────────────────────────────────────────
// PyPI's search page blocks server-side requests. Instead we fetch the full
// package name list from the simple index API (~500K names, ~10MB JSON) once,
// cache it in memory for 24 h, and filter locally for instant prefix matching.

let pypiIndexCache: string[] | null = null
let pypiIndexFetchedAt = 0
let pypiIndexInflight: Promise<string[]> | null = null
const PYPI_INDEX_TTL = 24 * 3600_000

function warmPypiIndex(): Promise<string[]> {
  const now = Date.now()
  if (pypiIndexCache && now - pypiIndexFetchedAt < PYPI_INDEX_TTL) {
    return Promise.resolve(pypiIndexCache)
  }
  if (pypiIndexInflight) return pypiIndexInflight

  pypiIndexInflight = (async () => {
    try {
      const res = await fetch('https://pypi.org/simple/', {
        headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) return pypiIndexCache ?? []
      const data = (await res.json()) as { projects: Array<{ name: string }> }
      pypiIndexCache = data.projects.map((p) => p.name)
      pypiIndexFetchedAt = Date.now()
      return pypiIndexCache
    } catch {
      return pypiIndexCache ?? []
    } finally {
      pypiIndexInflight = null
    }
  })()

  return pypiIndexInflight
}

async function searchPypi(query: string): Promise<RegistryResult[]> {
  const q = query.toLowerCase().trim()

  // If the index is already cached, filter it immediately
  if (pypiIndexCache) {
    const now = Date.now()
    if (now - pypiIndexFetchedAt < PYPI_INDEX_TTL) {
      // Prefix matches first, then substring matches to fill up to 8
      const prefix = pypiIndexCache.filter((n) => n.toLowerCase().startsWith(q))
      const extra =
        prefix.length < 8
          ? pypiIndexCache
              .filter(
                (n) =>
                  !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q),
              )
              .slice(0, 8 - prefix.length)
          : []
      return [...prefix.slice(0, 8), ...extra].map((name) => ({
        name,
        version: '',
        description: '',
      }))
    }
  }

  // Index not ready yet — kick off a background fetch and fall back to
  // an exact-name lookup so the user gets at least one result immediately
  warmPypiIndex()

  try {
    const res = await fetch(
      `https://pypi.org/pypi/${encodeURIComponent(q)}/json`,
      { signal: AbortSignal.timeout(5_000) },
    )
    if (!res.ok) return []
    const data = (await res.json()) as {
      info: { name: string; version: string; summary?: string }
    }
    return [
      {
        name: data.info.name,
        version: data.info.version,
        description: data.info.summary ?? '',
      },
    ]
  } catch {
    return []
  }
}

async function searchMaven(query: string): Promise<RegistryResult[]> {
  // Solr interprets bare colons as field:value syntax, which breaks groupId:artifactId queries.
  // When the query contains a colon, use explicit g: and a: field selectors instead.
  let solrQuery: string
  if (query.includes(':')) {
    const colonIdx = query.indexOf(':')
    const groupId = query.slice(0, colonIdx)
    const artifactId = query.slice(colonIdx + 1)
    solrQuery = artifactId
      ? `g:${groupId} AND a:${artifactId}*`
      : `g:${groupId}`
  } else {
    solrQuery = query
  }
  const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(solrQuery)}&rows=8&wt=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) return []

  const data = (await res.json()) as {
    response: {
      docs: Array<{
        id: string
        g: string
        a: string
        latestVersion: string
      }>
    }
  }

  const q = query.toLowerCase()
  const filtered = data.response.docs.filter((doc) =>
    doc.id.toLowerCase().includes(q),
  )
  return Promise.all(
    filtered.map(async (doc) => ({
      name: doc.id,
      description: await fetchPomDescription(doc.g, doc.a, doc.latestVersion),
      version: doc.latestVersion,
    })),
  )
}

async function fetchPomDescription(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<string> {
  try {
    const groupPath = groupId.replace(/\./g, '/')
    const url = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) return ''
    const xml = await res.text()
    const match = xml.match(/<description[^>]*>([\s\S]*?)<\/description>/)
    return match ? match[1].trim().replace(/\s+/g, ' ') : ''
  } catch {
    return ''
  }
}

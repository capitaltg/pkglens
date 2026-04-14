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
      if (ecosystem === 'maven') return await searchMaven(query)
      // PyPI has no usable search API — degrade gracefully
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

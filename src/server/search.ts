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
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=8`
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

  return data.objects.map(({ package: pkg }) => ({
    name: pkg.name,
    description: pkg.description ?? '',
    version: pkg.version,
  }))
}

async function searchMaven(query: string): Promise<RegistryResult[]> {
  const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=8&wt=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) return []

  const data = (await res.json()) as {
    response: {
      docs: Array<{
        id: string
        latestVersion: string
      }>
    }
  }

  return data.response.docs.map((doc) => ({
    name: doc.id,
    description: '',
    version: doc.latestVersion,
  }))
}

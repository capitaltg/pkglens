import type { Vulnerability } from '#/db/schema'

const OSV_URL = 'https://api.osv.dev/v1/query'

type OsvEcosystem = 'npm' | 'PyPI' | 'Maven'

const ecosystemMap: Record<string, OsvEcosystem> = {
  npm: 'npm',
  pypi: 'PyPI',
  maven: 'Maven',
}

interface OsvResponse {
  vulns?: OsvVuln[]
}

interface OsvVuln {
  id: string
  summary?: string
  aliases?: string[]
  published?: string
  severity?: Array<{ type: string; score: string }>
  database_specific?: { severity?: string }
}

function parseSeverity(
  vuln: OsvVuln,
): Vulnerability['severity'] {
  const raw =
    vuln.database_specific?.severity?.toLowerCase() ??
    vuln.severity?.[0]?.type?.toLowerCase() ??
    ''

  if (raw.includes('critical')) return 'critical'
  if (raw.includes('high')) return 'high'
  if (raw.includes('medium') || raw.includes('moderate')) return 'medium'
  if (raw.includes('low')) return 'low'
  return 'unknown'
}

export async function queryOsv(
  ecosystem: string,
  name: string,
  version?: string,
): Promise<Vulnerability[]> {
  const osvEcosystem = ecosystemMap[ecosystem]
  if (!osvEcosystem) return []

  const body: Record<string, unknown> = {
    package: {
      name,
      ecosystem: osvEcosystem,
    },
  }
  if (version) body.version = version

  let res: Response
  try {
    res = await fetch(OSV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return []
  }

  if (!res.ok) return []

  const data: OsvResponse = await res.json()
  return (data.vulns ?? []).map((v) => ({
    id: v.id,
    summary: v.summary ?? 'No summary available',
    severity: parseSeverity(v),
    aliases: v.aliases ?? [],
    publishedAt: v.published,
  }))
}

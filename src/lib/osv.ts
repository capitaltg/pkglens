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
  affected?: Array<{
    ranges?: Array<{
      type: string
      events: Array<Record<string, string>>
    }>
  }>
}

function parseSeverity(vuln: OsvVuln): Vulnerability['severity'] {
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

function extractFixedVersions(vuln: OsvVuln): string[] {
  const fixed: string[] = []
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixed.push(event.fixed)
      }
    }
  }
  return fixed
}

async function fetchOsvVulns(
  ecosystem: string,
  name: string,
  version?: string,
): Promise<OsvVuln[]> {
  const osvEcosystem = ecosystemMap[ecosystem]
  if (!osvEcosystem) return []

  const body: Record<string, unknown> = {
    package: { name, ecosystem: osvEcosystem },
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
  return data.vulns ?? []
}

/** Query OSV for vulnerabilities affecting a specific version (or all if no version). */
export async function queryOsv(
  ecosystem: string,
  name: string,
  version?: string,
): Promise<Vulnerability[]> {
  const vulns = await fetchOsvVulns(ecosystem, name, version)
  return vulns.map((v) => ({
    id: v.id,
    summary: v.summary ?? 'No summary available',
    severity: parseSeverity(v),
    aliases: v.aliases ?? [],
    publishedAt: v.published,
    isActive: true, // when querying with version, all results are active
    fixedAt: undefined,
  }))
}

/** Extended result returned by queryOsvHistorical, includes fixed versions for date lookup. */
export interface OsvHistoricalResult {
  id: string
  summary: string
  severity: Vulnerability['severity']
  aliases: string[]
  publishedAt?: string
  isActive: boolean
  fixedVersions: string[] // extracted from OSV affected.ranges; use to look up fix dates
}

/**
 * Query OSV for all historical CVEs for a package (no version filter).
 * If currentVersion is provided, also determines which CVEs are still active.
 */
export async function queryOsvHistorical(
  ecosystem: string,
  name: string,
  currentVersion?: string,
): Promise<OsvHistoricalResult[]> {
  const [allVulns, activeVulns] = await Promise.all([
    fetchOsvVulns(ecosystem, name),
    currentVersion
      ? fetchOsvVulns(ecosystem, name, currentVersion)
      : Promise.resolve([]),
  ])

  const activeIds = new Set(activeVulns.map((v) => v.id))

  return allVulns.map((v) => ({
    id: v.id,
    summary: v.summary ?? 'No summary available',
    severity: parseSeverity(v),
    aliases: v.aliases ?? [],
    publishedAt: v.published,
    isActive: currentVersion ? activeIds.has(v.id) : true,
    fixedVersions: extractFixedVersions(v),
  }))
}

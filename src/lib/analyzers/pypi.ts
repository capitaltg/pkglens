import { queryOsvHistorical } from '#/lib/osv'
import type {
  DepNode,
  MaintenanceData,
  SizeData,
  Vulnerability,
} from '#/db/schema'

const PYPI_API = 'https://pypi.org/pypi'
const PYPISTATS_API = 'https://pypistats.org/api/packages'

export interface PypiAnalysisResult {
  version: string
  sizeData: SizeData
  depTree: DepNode[]
  vulnerabilities: Vulnerability[]
  maintenanceData: MaintenanceData
}

export async function analyzePypiPackage(
  name: string,
): Promise<PypiAnalysisResult> {
  const [meta, weeklyDownloads] = await Promise.all([
    fetchPypiMeta(name),
    fetchPypiWeeklyDownloads(name),
  ])

  const info = meta.info as Record<string, unknown>
  const version = (info.version as string) ?? 'unknown'
  const releases = (meta.releases as Record<string, PypiBuildFile[]>) ?? {}
  const urlList = (meta.urls as PypiBuildFile[]) ?? []

  const maintenanceData: MaintenanceData = {
    lastPublishedAt: extractLastPublished(releases, urlList),
    weeklyDownloads,
    isDeprecated: typeof info.yanked === 'boolean' ? info.yanked : false,
    description: (info.summary as string) ?? undefined,
    license: normalizePypiLicense(info),
    homepage: (info.home_page as string) ?? undefined,
    keywords: parseKeywords(info.keywords as string | undefined),
    repositoryUrl:
      (info.project_urls as Record<string, string> | undefined)?.Repository ??
      (info.project_urls as Record<string, string> | undefined)?.Source,
  }

  const [sizeData, osvResults] = await Promise.all([
    measureWheelSize(urlList),
    queryOsvHistorical('pypi', name.toLowerCase(), version),
  ])

  // Convert OSV results to Vulnerability, looking up fixedAt from PyPI releases
  const vulnerabilities: Vulnerability[] = osvResults.map((r) => {
    const earliestFix =
      r.fixedVersions.length > 0
        ? findEarliestPypiFix(r.fixedVersions, releases)
        : undefined
    return {
      id: r.id,
      summary: r.summary,
      severity: r.severity,
      aliases: r.aliases,
      publishedAt: r.publishedAt,
      isActive: r.isActive,
      fixedAt: earliestFix?.date,
      fixedVersion: earliestFix?.version,
    }
  })

  // Build a shallow dep tree from install_requires
  const requiresDist = (info.requires_dist as string[] | null) ?? []
  const depTree = requiresDist.slice(0, 20).map(
    (req): DepNode => ({
      name: parseRequireName(req),
      version: parseRequireVersion(req),
      ecosystem: 'pypi',
      selfBytes: 0,
      totalBytes: 0,
      children: [],
    }),
  )

  return { version, sizeData, depTree, vulnerabilities, maintenanceData }
}

// ─── PyPI helpers ─────────────────────────────────────────────────────────

async function fetchPypiMeta(name: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${PYPI_API}/${encodeURIComponent(name)}/json`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`PyPI error ${res.status} for "${name}"`)
  return res.json()
}

async function fetchPypiWeeklyDownloads(name: string): Promise<number> {
  try {
    const encoded = encodeURIComponent(name.toLowerCase())
    const res = await fetch(`${PYPISTATS_API}/${encoded}/recent?period=week`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return 0
    const data = (await res.json()) as {
      data?: { last_week?: number }
    }
    return data.data?.last_week ?? 0
  } catch {
    return 0
  }
}

interface PypiBuildFile {
  packagetype: string
  url: string
  size: number
  upload_time: string
}

async function measureWheelSize(files: PypiBuildFile[]): Promise<SizeData> {
  // Prefer the wheel (.whl) file; fall back to sdist (.tar.gz)
  const wheel = files.find((f) => f.packagetype === 'bdist_wheel')
  const sdist = files.find((f) => f.packagetype === 'sdist')
  const target = wheel ?? sdist

  if (!target) return { minifiedBytes: 0, gzipBytes: 0 }

  // Use the reported file size as the compressed (gzip) size
  const gzipBytes = target.size

  // Estimate uncompressed size: wheels are zip files, typically ~2.5x compressed
  const estimatedUncompressed = Math.round(gzipBytes * 2.5)

  return {
    minifiedBytes: estimatedUncompressed,
    gzipBytes,
  }
}

function findEarliestPypiFix(
  fixedVersions: string[],
  releases: Record<string, PypiBuildFile[]>,
): { date: string; version: string } | undefined {
  let earliest: { date: string; version: string } | undefined
  for (const v of fixedVersions) {
    const uploadTime = releases[v]?.[0]?.upload_time
    if (!uploadTime) continue
    const t = new Date(uploadTime).getTime()
    if (!earliest || t < new Date(earliest.date).getTime()) {
      earliest = { date: new Date(uploadTime).toISOString(), version: v }
    }
  }
  return earliest
}

function extractLastPublished(
  releases: Record<string, PypiBuildFile[]>,
  urls: PypiBuildFile[],
): string {
  if (urls.length > 0 && urls[0].upload_time) {
    return new Date(urls[0].upload_time).toISOString()
  }
  // Fall back: find the latest release date
  const dates = Object.values(releases)
    .flat()
    .map((f) => (f as { upload_time?: string }).upload_time)
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())

  if (dates.length === 0) return new Date().toISOString()
  return new Date(Math.max(...dates)).toISOString()
}

function parseKeywords(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  return raw
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean)
}

/** Parse package name from PEP 508 requirement string, e.g. "requests>=2.0" → "requests" */
function parseRequireName(req: string): string {
  return req.split(/[>=<!;[\s]/)[0].trim()
}

/** Parse version specifier from PEP 508 requirement string, e.g. "requests>=2.0,<3; extra=='x'" → ">=2.0,<3" */
function parseRequireVersion(req: string): string {
  // Strip environment markers (everything after ;)
  const withoutMarker = req.split(';')[0].trim()
  // Extract version operator onwards (>=, <=, ==, !=, ~=, >)
  const match = withoutMarker.match(/[><=!~].+/)
  return match ? match[0].trim() : ''
}

/**
 * Extract a short license identifier from PyPI metadata.
 * Prefers `license_expression` (SPDX), then the License classifier,
 * then falls back to `license` if it looks like an identifier (≤ 50 chars).
 */
function normalizePypiLicense(
  info: Record<string, unknown>,
): string | undefined {
  // 1. license_expression is a proper SPDX string (e.g. "MIT", "BSD-3-Clause")
  const expr = info.license_expression as string | undefined
  if (expr && expr.trim().length > 0) return expr.trim()

  // 2. Classifiers like "License :: OSI Approved :: MIT License" → extract last segment
  const classifiers = (info.classifiers as string[] | undefined) ?? []
  const licenseCls = classifiers.find((c) => c.startsWith('License ::'))
  if (licenseCls) {
    const parts = licenseCls.split(' :: ')
    const label = parts[parts.length - 1].trim()
    if (label && label !== 'OSI Approved') return label
  }

  // 3. Raw license field — only use if it looks like an identifier, not full text
  const raw = (info.license as string | undefined)?.trim()
  if (raw && raw.length <= 50 && !raw.includes('\n')) return raw

  return undefined
}

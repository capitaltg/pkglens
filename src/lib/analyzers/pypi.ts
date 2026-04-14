import { queryOsv } from '#/lib/osv'
import type { DepNode, MaintenanceData, SizeData } from '#/db/schema'

const PYPI_API = 'https://pypi.org/pypi'

export interface PypiAnalysisResult {
  version: string
  sizeData: SizeData
  depTree: DepNode[]
  vulnerabilities: Awaited<ReturnType<typeof queryOsv>>
  maintenanceData: MaintenanceData
}

export async function analyzePypiPackage(
  name: string,
): Promise<PypiAnalysisResult> {
  const meta = await fetchPypiMeta(name)

  const info = meta.info as Record<string, unknown>
  const version = (info.version as string) ?? 'unknown'
  const releases = (meta.releases as Record<string, unknown[]>) ?? {}
  const urlList = (meta.urls as PypiBuildFile[]) ?? []

  const maintenanceData: MaintenanceData = {
    lastPublishedAt: extractLastPublished(releases, urlList),
    isDeprecated: typeof info.yanked === 'boolean' ? info.yanked : false,
    description: (info.summary as string) ?? undefined,
    license: (info.license as string) ?? undefined,
    homepage: (info.home_page as string) ?? undefined,
    keywords: parseKeywords(info.keywords as string | undefined),
    repositoryUrl:
      (info.project_urls as Record<string, string> | undefined)?.Repository ??
      (info.project_urls as Record<string, string> | undefined)?.Source,
  }

  const [sizeData, vulnerabilities] = await Promise.all([
    measureWheelSize(urlList),
    queryOsv('pypi', name, version),
  ])

  // Build a shallow dep tree from install_requires
  const requiresDist = (info.requires_dist as string[] | null) ?? []
  const depTree = requiresDist.slice(0, 20).map(
    (req): DepNode => ({
      name: parseRequireName(req),
      version: req,
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

function extractLastPublished(
  releases: Record<string, unknown[]>,
  urls: PypiBuildFile[],
): string {
  if (urls.length > 0 && urls[0].upload_time) {
    return new Date(urls[0].upload_time).toISOString()
  }
  // Fall back: find the latest release date
  const dates = Object.values(releases)
    .flat()
    .map((f) => (f as { upload_time?: string }).upload_time)
    .filter(Boolean)
    .map((d) => new Date(d!).getTime())

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

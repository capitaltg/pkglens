import { queryOsv } from '#/lib/osv'
import type { DepNode, MaintenanceData, SizeData } from '#/db/schema'

const MAVEN_SEARCH = 'https://search.maven.org/solrsearch/select'
const MAVEN_REPO = 'https://repo1.maven.org/maven2'

export interface MavenAnalysisResult {
  version: string
  sizeData: SizeData
  depTree: DepNode[]
  vulnerabilities: Awaited<ReturnType<typeof queryOsv>>
  maintenanceData: MaintenanceData
}

/**
 * @param name  Maven artifact in "groupId:artifactId" format, e.g. "org.springframework:spring-core"
 */
export async function analyzeMavenPackage(
  name: string,
): Promise<MavenAnalysisResult> {
  const [groupId, artifactId] = splitMavenName(name)

  const searchResult = await searchMavenCentral(groupId, artifactId)
  const doc = searchResult.response?.docs?.[0]

  if (!doc) throw new Error(`Maven artifact not found: "${name}"`)

  const version: string = doc.latestVersion ?? doc.v ?? 'unknown'
  const jarUrl = buildJarUrl(groupId, artifactId, version)

  const [sizeData, vulnerabilities, depTree] = await Promise.all([
    measureJarSize(jarUrl),
    queryOsv('maven', name, version),
    fetchPomDeps(groupId, artifactId, version),
  ])

  const maintenanceData: MaintenanceData = {
    lastPublishedAt: doc.timestamp
      ? new Date(doc.timestamp).toISOString()
      : new Date().toISOString(),
    isDeprecated: false,
    description: undefined,
    license: undefined,
    homepage: `https://search.maven.org/artifact/${groupId}/${artifactId}`,
  }

  return { version, sizeData, depTree, vulnerabilities, maintenanceData }
}

// ─── Maven helpers ────────────────────────────────────────────────────────

interface SearchDoc {
  id: string
  latestVersion?: string
  v?: string
  timestamp?: number
}

async function searchMavenCentral(
  groupId: string,
  artifactId: string,
): Promise<{ response?: { docs?: SearchDoc[] } }> {
  const q = encodeURIComponent(`g:${groupId} AND a:${artifactId}`)
  const url = `${MAVEN_SEARCH}?q=${q}&core=gav&rows=1&wt=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Maven search error ${res.status}`)
  return res.json()
}

function buildJarUrl(
  groupId: string,
  artifactId: string,
  version: string,
): string {
  const groupPath = groupId.replace(/\./g, '/')
  return `${MAVEN_REPO}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.jar`
}

async function measureJarSize(jarUrl: string): Promise<SizeData> {
  // Use HEAD request to get Content-Length without downloading the full JAR
  try {
    const res = await fetch(jarUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { minifiedBytes: 0, gzipBytes: 0 }

    const contentLength = res.headers.get('content-length')
    const jarBytes = contentLength ? parseInt(contentLength, 10) : 0

    // JARs are ZIP-compressed; estimate gzip as ~90% of jar size (already compressed)
    return {
      minifiedBytes: jarBytes,
      gzipBytes: Math.round(jarBytes * 0.9),
    }
  } catch {
    return { minifiedBytes: 0, gzipBytes: 0 }
  }
}

async function fetchPomDeps(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<DepNode[]> {
  const groupPath = groupId.replace(/\./g, '/')
  const pomUrl = `${MAVEN_REPO}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`

  try {
    const res = await fetch(pomUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []

    const xml = await res.text()
    return parsePomDeps(xml)
  } catch {
    return []
  }
}

function parsePomDeps(xml: string): DepNode[] {
  const depPattern =
    /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?(?:\s*<scope>([^<]+)<\/scope>)?/g

  const deps: DepNode[] = []
  let match: RegExpExecArray | null

  while ((match = depPattern.exec(xml)) !== null) {
    const [, gId, aId, ver, scope] = match
    // Skip test/provided scope deps
    if (scope === 'test' || scope === 'provided') continue

    deps.push({
      name: `${gId.trim()}:${aId.trim()}`,
      version: ver?.trim() ?? 'unknown',
      ecosystem: 'maven',
      selfBytes: 0,
      totalBytes: 0,
      children: [],
    })
  }

  return deps
}

function splitMavenName(name: string): [string, string] {
  const parts = name.split(':')
  if (parts.length !== 2) {
    throw new Error(
      `Invalid Maven artifact name "${name}". Expected "groupId:artifactId".`,
    )
  }
  return [parts[0], parts[1]]
}

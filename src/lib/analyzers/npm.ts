import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { queryOsvHistorical, type OsvHistoricalResult } from '#/lib/osv'
import type {
  DepNode,
  MaintenanceData,
  SizeData,
  Vulnerability,
} from '#/db/schema'

const execFileAsync = promisify(execFile)

const NPM_REGISTRY = 'https://registry.npmjs.org'
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week'

// Shared, pod-lifetime install dir + npm cache, reused across all analyses
// instead of a throwaway dir per job. Each `npm install` reconciles
// node_modules to the current package (extraneous deps are pruned), and the
// cache makes repeat installs warm and avoids re-hitting the registry. Both
// live under tmpdir(), so in k8s they sit in the pod's existing emptyDir and
// reset when the pod restarts.
const WORK_DIR = process.env.DEPLENS_WORK_DIR ?? join(tmpdir(), 'deplens-work')
const NPM_CACHE_DIR =
  process.env.NPM_CACHE_DIR ?? join(tmpdir(), 'deplens-cache')

// One shared dir isn't safe for concurrent installs, so serialize the
// install+bundle section. Other per-job work (dep tree, OSV) still overlaps.
//
// IMPORTANT: this lock is per-process, so it assumes a single worker process
// writes WORK_DIR. That holds in k8s (one worker process per pod, each with its
// own /tmp emptyDir). Do NOT run multiple worker processes against a shared
// WORK_DIR filesystem; give each its own via DEPLENS_WORK_DIR if you must.
let installChain: Promise<unknown> = Promise.resolve()
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = installChain.then(task, task)
  installChain = run.then(
    () => {},
    () => {},
  )
  return run
}

// ─── Public entry point ──────────────────────────────────────────────────────

export interface NpmAnalysisResult {
  version: string
  sizeData: SizeData
  depTree: DepNode[]
  vulnerabilities: Vulnerability[]
  maintenanceData: MaintenanceData
}

export async function analyzeNpmPackage(
  name: string,
): Promise<NpmAnalysisResult> {
  const [meta, downloads] = await Promise.all([
    fetchNpmMeta(name),
    fetchWeeklyDownloads(name),
  ])

  const distTags = meta['dist-tags'] as Record<string, string> | undefined
  const version: string = distTags?.latest ?? 'unknown'
  const versions = meta.versions as
    | Record<string, Record<string, unknown>>
    | undefined
  const versionMeta: Record<string, unknown> = versions?.[version] ?? {}
  const timeMap = meta.time as Record<string, string> | undefined
  const licenseField = meta.license as string | { type?: string } | undefined

  const typescriptSupport = await detectTypescriptSupport(name, versionMeta)

  const maintenanceData: MaintenanceData = {
    lastPublishedAt: timeMap?.[version] ?? new Date().toISOString(),
    weeklyDownloads: downloads,
    isDeprecated:
      typeof versionMeta.deprecated === 'string' ||
      versionMeta.deprecated === true,
    repositoryUrl: extractRepoUrl(meta.repository),
    description: meta.description as string | undefined,
    license:
      typeof licenseField === 'string' ? licenseField : licenseField?.type,
    homepage: meta.homepage as string | undefined,
    keywords: meta.keywords as string[] | undefined,
    typescriptSupport,
  }

  const directDeps: Record<string, string> =
    (versionMeta.dependencies as Record<string, string> | undefined) ?? {}
  const peerDeps: string[] = Object.keys(
    (versionMeta.peerDependencies as Record<string, string> | undefined) ?? {},
  )

  const [sizeData, depTree, osvResults] = await Promise.all([
    bundlePackage(name, version, peerDeps),
    buildDepTree(name, version, directDeps, new Set(), 0),
    queryOsvHistorical('npm', name, version),
  ])

  const vulnerabilities = mapNpmVulns(osvResults, timeMap)

  return { version, sizeData, depTree, vulnerabilities, maintenanceData }
}

/** Map OSV results to Vulnerability, enriching fixedAt from the registry time map. */
function mapNpmVulns(
  osvResults: OsvHistoricalResult[],
  timeMap?: Record<string, string>,
): Vulnerability[] {
  return osvResults.map((r) => {
    const earliestFix =
      r.fixedVersions.length > 0 && timeMap
        ? findEarliestFix(r.fixedVersions, timeMap)
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
}

/**
 * Re-query just the vulnerabilities for a version — registry metadata + OSV
 * only, no install or bundling. Used by the periodic security refresh so the
 * permanent per-version cache still picks up newly-disclosed CVEs.
 */
export async function getNpmVulnerabilities(
  name: string,
  version: string,
): Promise<Vulnerability[]> {
  const [meta, osvResults] = await Promise.all([
    fetchNpmMeta(name),
    queryOsvHistorical('npm', name, version),
  ])
  return mapNpmVulns(
    osvResults,
    meta.time as Record<string, string> | undefined,
  )
}

// ─── npm registry helpers ────────────────────────────────────────────────────

async function fetchNpmMeta(name: string): Promise<Record<string, unknown>> {
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)

  const res = await fetch(`${NPM_REGISTRY}/${encoded}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`npm registry error ${res.status} for "${name}"`)
  return res.json()
}

async function fetchVersionMeta(
  name: string,
  version: string,
): Promise<Record<string, unknown>> {
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)
  const res = await fetch(`${NPM_REGISTRY}/${encoded}/${version}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return {}
  return res.json()
}

async function fetchWeeklyDownloads(name: string): Promise<number> {
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

// ─── TypeScript support detection ────────────────────────────────────────────

async function detectTypescriptSupport(
  name: string,
  versionMeta: Record<string, unknown>,
): Promise<MaintenanceData['typescriptSupport']> {
  // Check for bundled types in package.json
  if (versionMeta.types || versionMeta.typings) return 'bundled'

  // Check for @types/* package on npm registry
  try {
    const typesSlug = name.startsWith('@')
      ? name.slice(1).replace('/', '__')
      : name
    const encoded = `@${encodeURIComponent(`types/${typesSlug}`)}`
    const res = await fetch(`${NPM_REGISTRY}/${encoded}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) return 'definitely-typed'
  } catch {
    // ignore — no @types package
  }

  return 'none'
}

// ─── Fix date lookup ──────────────────────────────────────────────────────────

function findEarliestFix(
  fixedVersions: string[],
  timeMap: Record<string, string>,
): { date: string; version: string } | undefined {
  let earliest: { date: string; version: string } | undefined
  for (const v of fixedVersions) {
    const d = timeMap[v]
    if (!d) continue
    const t = new Date(d).getTime()
    if (!earliest || t < new Date(earliest.date).getTime()) {
      earliest = { date: new Date(d).toISOString(), version: v }
    }
  }
  return earliest
}

// ─── Bundle size via esbuild ─────────────────────────────────────────────────

// Packages that are universally treated as peer/host dependencies and should
// never be bundled. esbuild will leave them as unresolved imports rather than
// erroring when it can't find them in node_modules.
const ALWAYS_EXTERNAL = [
  'react',
  'react-dom',
  'react-native',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'vue',
  '@vue/runtime-core',
  '@vue/composition-api',
  '@angular/core',
  '@angular/common',
  'svelte',
  'preact',
  'preact/compat',
  'solid-js',
  'next',
  'gatsby',
  '@remix-run/react',
]

/** True when esbuild failed only because the package imports Node built-ins. */
function isNodeBuiltinBundleError(err: unknown): boolean {
  const stderr = (err as { stderr?: unknown }).stderr
  if (typeof stderr !== 'string') return false
  return (
    stderr.includes('is built into node') ||
    stderr.includes('Are you trying to bundle for node')
  )
}

function bundlePackage(
  name: string,
  version: string,
  peerDeps: string[] = [],
): Promise<SizeData> {
  // Serialized: the shared WORK_DIR holds one package's node_modules at a time.
  return runExclusive(async () => {
    await mkdir(WORK_DIR, { recursive: true })

    // Overwrite the manifest with just this package; `npm install` reconciles
    // node_modules to match (installing this package, pruning the previous one).
    await writeFile(
      join(WORK_DIR, 'package.json'),
      JSON.stringify({ private: true, dependencies: { [name]: version } }),
    )

    // Install (no scripts for safety) against the shared, pod-lifetime cache so
    // repeat/overlapping deps are warm. Generous timeout: a cold-cache install
    // of a large tree (e.g. many @radix-ui packages) on a slow container
    // filesystem can take minutes.
    await execFileAsync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--cache', NPM_CACHE_DIR],
      { cwd: WORK_DIR, timeout: 150_000 },
    )

    // Write an entry point that just re-exports the package
    const entry = join(WORK_DIR, 'entry.js')
    await writeFile(entry, `export * from ${JSON.stringify(name)};\n`)

    // Merge always-external list with this package's declared peer dependencies
    const externals = [...new Set([...ALWAYS_EXTERNAL, ...peerDeps])]

    // Bundle with esbuild
    const bundleOut = join(WORK_DIR, 'bundle.js')
    try {
      await execFileAsync(
        'npx',
        [
          'esbuild',
          entry,
          '--bundle',
          '--minify',
          '--platform=browser',
          '--format=esm',
          `--outfile=${bundleOut}`,
          ...externals.map((e) => `--external:${e}`),
        ],
        { cwd: WORK_DIR, timeout: 90_000 },
      )
    } catch (err) {
      // A package that imports Node built-ins (fs, crypto, …) has no browser
      // bundle. Report it as server-side rather than failing the whole analysis
      // (and retrying a deterministic failure 3×). Other esbuild errors are real.
      if (isNodeBuiltinBundleError(err)) {
        return { minifiedBytes: 0, gzipBytes: 0, serverOnly: true }
      }
      throw err
    }

    const bundleBytes = await readFile(bundleOut)
    const minifiedBytes = bundleBytes.length
    const gzipBytes = await gzipSize(bundleBytes)

    return { minifiedBytes, gzipBytes }
  })
}

async function gzipSize(buf: Buffer): Promise<number> {
  const chunks: Buffer[] = []
  const gzip = createGzip({ level: 9 })
  await pipeline(Readable.from(buf), gzip, async (source) => {
    for await (const chunk of source) {
      chunks.push(Buffer.from(chunk))
    }
  })
  return Buffer.concat(chunks).length
}

// ─── Dependency tree ─────────────────────────────────────────────────────────

const MAX_DEPTH = 5

async function buildDepTree(
  _name: string,
  _version: string,
  deps: Record<string, string>,
  visited: Set<string>,
  depth: number,
): Promise<DepNode[]> {
  if (depth >= MAX_DEPTH) return []

  const entries = Object.entries(deps)
  const nodes = await Promise.all(
    entries.map(async ([depName, depRange]) => {
      const key = `${depName}@${depRange}`
      if (visited.has(key)) {
        return {
          name: depName,
          version: depRange,
          ecosystem: 'npm' as const,
          selfBytes: 0,
          totalBytes: 0,
          children: [],
        } satisfies DepNode
      }
      visited.add(key)

      try {
        const meta = await fetchVersionMeta(depName, 'latest')
        const resolvedVersion = (meta.version as string | undefined) ?? depRange
        const transitiveDeps =
          (meta.dependencies as Record<string, string>) ?? {}
        const depPeerDeps = Object.keys(
          (meta.peerDependencies as Record<string, string> | undefined) ?? {},
        )

        const sizeData = await bundlePackage(
          depName,
          resolvedVersion,
          depPeerDeps,
        ).catch(() => ({ minifiedBytes: 0, gzipBytes: 0 }))
        const children = await buildDepTree(
          depName,
          resolvedVersion,
          transitiveDeps,
          new Set(visited),
          depth + 1,
        )

        const childTotal = children.reduce((s, c) => s + c.totalBytes, 0)
        const selfBytes = sizeData.gzipBytes
        const totalBytes = selfBytes + childTotal

        return {
          name: depName,
          version: resolvedVersion,
          ecosystem: 'npm' as const,
          selfBytes,
          totalBytes,
          children,
        } satisfies DepNode
      } catch {
        return {
          name: depName,
          version: depRange,
          ecosystem: 'npm' as const,
          selfBytes: 0,
          totalBytes: 0,
          children: [],
        } satisfies DepNode
      }
    }),
  )

  return nodes
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function extractRepoUrl(repo: unknown): string | undefined {
  if (typeof repo === 'string') return repo
  if (repo && typeof repo === 'object' && 'url' in repo) {
    return (repo as { url?: string }).url
  }
  return undefined
}

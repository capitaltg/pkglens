import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
import { encodeNpmName } from './npm-registry'
import { resolveDepTreeFromRegistry } from './npm-deptree'

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
  const meta = await fetchNpmMeta(name)

  const distTags = meta['dist-tags'] as Record<string, string> | undefined
  const version: string = distTags?.latest ?? 'unknown'
  const versions = meta.versions as
    | Record<string, Record<string, unknown>>
    | undefined
  const versionMeta: Record<string, unknown> = versions?.[version] ?? {}

  const directDeps: Record<string, string> =
    (versionMeta.dependencies as Record<string, string> | undefined) ?? {}
  const peerDeps: string[] = Object.keys(
    (versionMeta.peerDependencies as Record<string, string> | undefined) ?? {},
  )

  const [quick, depTree, sizeData] = await Promise.all([
    quickFromMeta(name, meta),
    // Resolved from registry metadata — no install per dependency.
    // See npm-deptree.ts for why.
    resolveDepTreeFromRegistry(directDeps),
    bundlePackage(name, version, peerDeps),
  ])

  return {
    version: quick.version,
    sizeData,
    depTree,
    vulnerabilities: quick.vulnerabilities,
    maintenanceData: quick.maintenanceData,
  }
}

/**
 * Metadata-only analysis: everything a package page needs *except* bundle size
 * and the dependency tree.
 *
 * No install and no bundling, so this resolves in a couple of seconds rather
 * than the minutes a cold install can take. That lets maintenance, security
 * and popularity render while the queued job is still measuring size.
 */
export interface NpmQuickAnalysis {
  version: string
  maintenanceData: MaintenanceData
  vulnerabilities: Vulnerability[]
}

export async function fetchNpmQuickAnalysis(
  name: string,
): Promise<NpmQuickAnalysis> {
  return quickFromMeta(name, await fetchNpmMeta(name))
}

async function quickFromMeta(
  name: string,
  meta: Record<string, unknown>,
): Promise<NpmQuickAnalysis> {
  const distTags = meta['dist-tags'] as Record<string, string> | undefined
  const version: string = distTags?.latest ?? 'unknown'
  const versions = meta.versions as
    | Record<string, Record<string, unknown>>
    | undefined
  const versionMeta: Record<string, unknown> = versions?.[version] ?? {}
  const timeMap = meta.time as Record<string, string> | undefined
  const licenseField = meta.license as string | { type?: string } | undefined

  const [downloads, typescriptSupport, osvResults] = await Promise.all([
    fetchWeeklyDownloads(name),
    detectTypescriptSupport(name, versionMeta),
    queryOsvHistorical('npm', name, version),
  ])

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

  return {
    version,
    maintenanceData,
    vulnerabilities: mapNpmVulns(osvResults, timeMap),
  }
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
  const res = await fetch(`${NPM_REGISTRY}/${encodeNpmName(name)}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`npm registry error ${res.status} for "${name}"`)
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
    const res = await fetch(
      `${NPM_REGISTRY}/${encodeNpmName(`@types/${typesSlug}`)}`,
      {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      },
    )
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

/**
 * Path to our own esbuild binary.
 *
 * esbuild is a declared dependency, but bundling shelled out to `npx esbuild`.
 * WORK_DIR has no esbuild in its node_modules, so npx fetched its own copy into
 * the shared npx cache on every analysis — needless work inside the bundle
 * timeout, and a real failure mode when that cache races with itself:
 *
 *   npm error ENOTEMPTY: directory not empty, rename
 *   '.../_npx/beb367dfa21eb3f5/node_modules/esbuild' -> '...'
 *
 * Resolve the installed binary once instead, falling back to npx if it is
 * somehow absent.
 */
const esbuildBinary = (() => {
  try {
    const require = createRequire(import.meta.url)
    return join(
      dirname(require.resolve('esbuild/package.json')),
      'bin',
      'esbuild',
    )
  } catch {
    return null
  }
})()

/**
 * Entry point used to measure a package's full public surface.
 *
 * This was `export * from "<pkg>"`, which does NOT re-export a default export.
 * A package whose only export is default — mitt, tiny-invariant — therefore
 * bundled to nothing and measured ~20 bytes, the size of an empty ESM stub.
 * Measured against bundlephobia, mitt scored 0.07x and tiny-invariant 0.10x.
 *
 * Importing the namespace and re-exporting it keeps every export, default
 * included, live through tree-shaking. The same packages then scored 1.00x and
 * 1.23x.
 */
export function buildEntrySource(name: string): string {
  return `import * as pkg from ${JSON.stringify(name)};\nexport default pkg;\n`
}

/**
 * esbuild `--external` list for measuring `name`.
 *
 * ALWAYS_EXTERNAL names host frameworks a *dependent* should not bundle. When
 * one of them is itself the subject of the analysis, externalizing it makes
 * esbuild emit nothing but a re-export stub, and the reported size is the size
 * of that stub — react measured 20 B, next 19 B, gatsby 21 B. So the package
 * under measurement is always dropped, along with its own subpaths
 * (react/jsx-runtime), which would otherwise keep deep imports external.
 */
export function buildExternals(
  name: string,
  peerDeps: string[] = [],
): string[] {
  return [...new Set([...ALWAYS_EXTERNAL, ...peerDeps])].filter(
    (e) => e !== name && !e.startsWith(`${name}/`),
  )
}

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

    const entry = join(WORK_DIR, 'entry.js')
    await writeFile(entry, buildEntrySource(name))

    const externals = buildExternals(name, peerDeps)

    // Bundle with esbuild
    const bundleOut = join(WORK_DIR, 'bundle.js')
    const [esbuildCmd, esbuildLeadingArgs] = esbuildBinary
      ? [esbuildBinary, [] as string[]]
      : ['npx', ['esbuild']]
    try {
      await execFileAsync(
        esbuildCmd,
        [
          ...esbuildLeadingArgs,
          entry,
          '--bundle',
          '--minify',
          '--platform=browser',
          '--format=esm',
          // Some packages publish untranspiled JSX in .js files (gatsby does).
          // esbuild only enables the JSX extension for .jsx/.tsx by default, so
          // without this they fail to parse — masking the real reason a package
          // cannot be bundled for the browser.
          '--loader:.js=jsx',
          // Do not count license banners toward bundle size. esbuild preserves
          // `/*! ... */` comments by default, but real toolchains (webpack and
          // terser) extract them to a separate .LICENSE.txt, so they are not in
          // the bundle a user downloads. Including them overstated size by a
          // roughly fixed ~130-230 B gzip — 16% of a small package like
          // classnames, 0.07% of three. The bundle here is measured and
          // discarded, never distributed, so nothing is being stripped from
          // shipped code.
          '--legal-comments=none',
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

// ─── Utilities ───────────────────────────────────────────────────────────────

function extractRepoUrl(repo: unknown): string | undefined {
  if (typeof repo === 'string') return repo
  if (repo && typeof repo === 'object' && 'url' in repo) {
    return (repo as { url?: string }).url
  }
  return undefined
}

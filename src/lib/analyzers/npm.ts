import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { queryOsv } from '#/lib/osv'
import type { DepNode, MaintenanceData, SizeData } from '#/db/schema'

const execFileAsync = promisify(execFile)

const NPM_REGISTRY = 'https://registry.npmjs.org'
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week'

// ─── Public entry point ──────────────────────────────────────────────────────

export interface NpmAnalysisResult {
  version: string
  sizeData: SizeData
  depTree: DepNode[]
  vulnerabilities: Awaited<ReturnType<typeof queryOsv>>
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
  }

  const directDeps: Record<string, string> =
    (versionMeta.dependencies as Record<string, string> | undefined) ?? {}
  const peerDeps: string[] = Object.keys(
    (versionMeta.peerDependencies as Record<string, string> | undefined) ?? {},
  )

  const [sizeData, depTree, vulnerabilities] = await Promise.all([
    bundlePackage(name, version, peerDeps),
    buildDepTree(name, version, directDeps, new Set(), 0),
    queryOsv('npm', name, version),
  ])

  return { version, sizeData, depTree, vulnerabilities, maintenanceData }
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

async function bundlePackage(
  name: string,
  version: string,
  peerDeps: string[] = [],
): Promise<SizeData> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'deplens-npm-'))

  try {
    // Write a minimal package.json so npm install works
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ private: true, dependencies: { [name]: version } }),
    )

    // Install the package (no scripts for safety)
    await execFileAsync('npm', ['install', '--ignore-scripts', '--no-audit'], {
      cwd: tmpDir,
      timeout: 60_000,
    })

    // Write an entry point that just re-exports the package
    const entry = join(tmpDir, 'entry.js')
    await writeFile(entry, `export * from ${JSON.stringify(name)};\n`)

    // Merge always-external list with this package's declared peer dependencies
    const externals = [...new Set([...ALWAYS_EXTERNAL, ...peerDeps])]

    // Bundle with esbuild
    const bundleOut = join(tmpDir, 'bundle.js')
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
      { cwd: tmpDir, timeout: 30_000 },
    )

    const { readFile } = await import('node:fs/promises')
    const bundleBytes = await readFile(bundleOut)

    const minifiedBytes = bundleBytes.length
    const gzipBytes = await gzipSize(bundleBytes)

    return { minifiedBytes, gzipBytes }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

async function gzipSize(buf: Buffer): Promise<number> {
  const chunks: Buffer[] = []
  const gzip = createGzip({ level: 9 })
  await pipeline(Readable.from(buf), gzip, async function* (source) {
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

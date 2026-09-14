/**
 * Bundle-size benchmark: compare our measurements against bundlephobia.
 *
 *   npm run benchmark                 measure the corpus, print a report
 *   npm run benchmark -- --update     also rewrite benchmark/snapshot.json
 *   npm run benchmark -- --diff       compare against the snapshot, fail on drift
 *   npm run benchmark -- --tag ui     restrict to tagged entries (repeatable)
 *   npm run benchmark -- --limit 10   stop after N packages
 *
 * NOT part of `npm test`. It performs real installs and calls an external
 * service, so it is slow and cannot be allowed to gate CI.
 *
 * Exact agreement is not the goal and would be the wrong target: bundlephobia
 * bundles with webpack against a package's default entry, while we bundle with
 * esbuild against `export * from "<pkg>"`. Differences of a few percent are
 * expected. What this catches is *outliers* and *drift* — see README.md.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeNpmPackage } from '#/lib/analyzers/npm'
import { fetchPackument, resolveVersion } from '#/lib/analyzers/npm-registry'
import { filterCorpus, type CorpusEntry } from './corpus.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = join(HERE, 'snapshot.json')
const CACHE_DIR = join(HERE, '.cache')

/** Be a good citizen: bundlephobia is a free service run by volunteers. */
const BUNDLEPHOBIA_DELAY_MS = 1500
const BUNDLEPHOBIA_TIMEOUT_MS = 45_000

/**
 * Gzip ratio band treated as agreement. Measured median across an initial
 * sample was ~1.05x (we run slightly higher), with legitimate spread on very
 * small packages where fixed overhead dominates.
 */
const RATIO_MIN = 0.75
const RATIO_MAX = 1.35

/** Relative gzip change against the snapshot that counts as drift. */
const DRIFT_TOLERANCE = 0.05

type Outcome =
  /** Both tools produced a size — the only case where a ratio is meaningful. */
  | 'compared'
  /** We report serverOnly; bundlephobia polyfilled and produced a number. */
  | 'divergent-serveronly'
  /** Neither tool could bundle it. Agreement, just not a numeric one. */
  | 'both-failed'
  /** One side failed. Usually worth a look. */
  | 'ours-failed'
  | 'theirs-failed'

interface Result {
  name: string
  version: string | null
  tags: readonly string[]
  outcome: Outcome
  ourMin: number | null
  ourGzip: number | null
  theirMin: number | null
  theirGzip: number | null
  gzipRatio: number | null
  minRatio: number | null
  ourError?: string
  theirError?: string
  seconds: number
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface Options {
  update: boolean
  diff: boolean
  tags: string[]
  limit: number | null
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { update: false, diff: false, tags: [], limit: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--update') opts.update = true
    else if (a === '--diff') opts.diff = true
    else if (a === '--tag') opts.tags.push(argv[++i])
    else if (a === '--limit') opts.limit = Number(argv[++i])
  }
  return opts
}

// ─── bundlephobia ────────────────────────────────────────────────────────────

interface BundlephobiaSize {
  size: number
  gzip: number
}

/**
 * Responses are cached by name@version. A published version is immutable, so a
 * cached answer stays correct — and it keeps repeat runs from hammering a free
 * service.
 */
async function fetchBundlephobia(
  spec: string,
): Promise<{ data?: BundlephobiaSize; error?: string; cached: boolean }> {
  const cacheFile = join(CACHE_DIR, `${spec.replace(/[/@]/g, '_')}.json`)
  if (existsSync(cacheFile)) {
    try {
      return { ...JSON.parse(await readFile(cacheFile, 'utf8')), cached: true }
    } catch {
      // fall through and refetch
    }
  }

  let payload: { data?: BundlephobiaSize; error?: string }
  try {
    const res = await fetch(
      `https://bundlephobia.com/api/size?package=${encodeURIComponent(spec)}`,
      {
        headers: {
          'User-Agent': 'deplens-benchmark (github.com/capitaltg/pkglens)',
        },
        signal: AbortSignal.timeout(BUNDLEPHOBIA_TIMEOUT_MS),
      },
    )
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!res.ok || !body) {
      payload = { error: `HTTP ${res.status}` }
    } else if (body.error) {
      const err = body.error as { code?: string; message?: string }
      payload = { error: err.code ?? err.message ?? 'unknown error' }
    } else {
      payload = {
        data: { size: body.size as number, gzip: body.gzip as number },
      }
    }
  } catch (err) {
    payload = {
      error: err instanceof Error ? err.message : 'request failed',
    }
  }

  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile, JSON.stringify(payload))
  return { ...payload, cached: false }
}

// ─── Measurement ─────────────────────────────────────────────────────────────

async function measure(entry: CorpusEntry): Promise<Result> {
  const started = Date.now()
  const base = {
    name: entry.name,
    tags: entry.tags,
    ourMin: null,
    ourGzip: null,
    theirMin: null,
    theirGzip: null,
    gzipRatio: null,
    minRatio: null,
  }

  // Resolve the version first so both tools measure the same thing.
  const packument = await fetchPackument(entry.name)
  const version = packument ? resolveVersion(packument, 'latest') : null
  if (!version) {
    return {
      ...base,
      version: null,
      outcome: 'ours-failed',
      ourError: 'could not resolve latest version',
      seconds: (Date.now() - started) / 1000,
    }
  }

  const spec = `${entry.name}@${version}`
  const theirs = await fetchBundlephobia(spec)
  if (!theirs.cached) await sleep(BUNDLEPHOBIA_DELAY_MS)

  let ourMin: number | null = null
  let ourGzip: number | null = null
  let serverOnly = false
  let ourError: string | undefined

  try {
    const result = await analyzeNpmPackage(entry.name)
    serverOnly = result.sizeData.serverOnly === true
    ourMin = result.sizeData.minifiedBytes
    ourGzip = result.sizeData.gzipBytes
  } catch (err) {
    ourError = err instanceof Error ? err.message.slice(0, 160) : String(err)
  }

  const theirMin = theirs.data?.size ?? null
  const theirGzip = theirs.data?.gzip ?? null
  const seconds = (Date.now() - started) / 1000

  let outcome: Outcome
  if (ourError && theirs.error) outcome = 'both-failed'
  else if (ourError) outcome = 'ours-failed'
  else if (serverOnly && theirs.data) outcome = 'divergent-serveronly'
  else if (serverOnly && theirs.error) outcome = 'both-failed'
  else if (theirs.error) outcome = 'theirs-failed'
  else outcome = 'compared'

  return {
    ...base,
    version,
    outcome,
    ourMin,
    ourGzip,
    theirMin,
    theirGzip,
    gzipRatio:
      outcome === 'compared' && ourGzip && theirGzip
        ? round(ourGzip / theirGzip)
        : null,
    minRatio:
      outcome === 'compared' && ourMin && theirMin
        ? round(ourMin / theirMin)
        : null,
    ourError,
    theirError: theirs.error,
    seconds: round(seconds),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const round = (n: number) => Math.round(n * 100) / 100

// ─── Reporting ───────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : round((s[mid - 1] + s[mid]) / 2)
}

function report(results: Result[]): { outliers: Result[] } {
  // Narrow once so the rest of the function needs no assertions.
  const compared = results.filter(
    (r): r is Result & { gzipRatio: number } =>
      r.outcome === 'compared' && typeof r.gzipRatio === 'number',
  )
  const ratios = compared.map((r) => r.gzipRatio)
  const outliers = compared.filter(
    (r) => r.gzipRatio < RATIO_MIN || r.gzipRatio > RATIO_MAX,
  )

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
    return acc
  }, {})

  console.log('\n─── Summary ───────────────────────────────────────────────')
  console.log(`  packages measured      ${results.length}`)
  for (const [k, v] of Object.entries(counts).sort()) {
    console.log(`  ${k.padEnd(22)} ${v}`)
  }
  if (ratios.length) {
    console.log(`\n  gzip ratio (ours / bundlephobia)`)
    console.log(`    median               ${median(ratios)}x`)
    console.log(`    min                  ${Math.min(...ratios)}x`)
    console.log(`    max                  ${Math.max(...ratios)}x`)
    console.log(
      `    within ${RATIO_MIN}–${RATIO_MAX}x        ${ratios.length - outliers.length}/${ratios.length}`,
    )
  }

  if (outliers.length) {
    console.log(
      `\n─── Outliers (gzip ratio outside ${RATIO_MIN}–${RATIO_MAX}x) ───`,
    )
    // Show the minified ratio alongside gzip. When the two disagree sharply
    // that is itself the finding: pino's minified sizes matched within 9%
    // while its gzip differed 2.5x, which points at what is being compressed
    // rather than at what is being bundled.
    for (const r of [...outliers].sort((a, b) => b.gzipRatio - a.gzipRatio)) {
      const min =
        r.minRatio === null ? '     —' : `${String(r.minRatio).padStart(5)}x`
      console.log(
        `  ${r.name.padEnd(24)} gzip ${String(r.ourGzip).padStart(9)}/${String(r.theirGzip).padStart(9)} = ${String(r.gzipRatio).padStart(5)}x   minified ${min}`,
      )
    }
  }

  const failures = results.filter((r) => r.outcome === 'ours-failed')
  if (failures.length) {
    console.log('\n─── We failed where bundlephobia did not ──────────────────')
    for (const r of failures) {
      console.log(`  ${r.name.padEnd(26)} ${r.ourError}`)
    }
  }

  return { outliers }
}

// ─── Snapshot diffing ────────────────────────────────────────────────────────

interface Snapshot {
  generatedAt: string
  results: Record<
    string,
    { version: string; gzip: number | null; outcome: Outcome }
  >
}

async function loadSnapshot(): Promise<Snapshot | null> {
  if (!existsSync(SNAPSHOT_PATH)) return null
  return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as Snapshot
}

async function writeSnapshot(results: Result[]): Promise<void> {
  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    results: Object.fromEntries(
      results.map((r) => [
        r.name,
        {
          version: r.version ?? 'unknown',
          gzip: r.ourGzip,
          outcome: r.outcome,
        },
      ]),
    ),
  }
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`\nSnapshot written to benchmark/snapshot.json`)
}

/** Compare this run against the committed snapshot. Returns true on drift. */
function diffSnapshot(results: Result[], snapshot: Snapshot): boolean {
  const drifted: string[] = []

  for (const r of results) {
    const prev = snapshot.results[r.name]
    if (!prev) continue

    if (prev.outcome !== r.outcome) {
      drifted.push(
        `  ${r.name.padEnd(26)} outcome ${prev.outcome} → ${r.outcome}`,
      )
      continue
    }
    if (prev.gzip && r.ourGzip) {
      const change = (r.ourGzip - prev.gzip) / prev.gzip
      if (Math.abs(change) > DRIFT_TOLERANCE) {
        drifted.push(
          `  ${r.name.padEnd(26)} gzip ${prev.gzip} → ${r.ourGzip} (${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%)`,
        )
      }
    }
  }

  if (drifted.length === 0) {
    console.log('\nNo drift against snapshot.')
    return false
  }
  console.log(
    `\n─── Drift vs snapshot (>${DRIFT_TOLERANCE * 100}%) ─────────────────────`,
  )
  drifted.forEach((d) => console.log(d))
  console.log(
    '\nIf these changes are intended, re-record with: npm run benchmark -- --update',
  )
  return true
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let entries = filterCorpus(opts.tags)
  if (opts.limit) entries = entries.slice(0, opts.limit)

  console.log(
    `Measuring ${entries.length} packages${opts.tags.length ? ` (tags: ${opts.tags.join(', ')})` : ''}.`,
  )
  console.log('Each uncached package needs a real install — this is slow.\n')

  const results: Result[] = []
  for (const [i, entry] of entries.entries()) {
    process.stdout.write(
      `[${String(i + 1).padStart(3)}/${entries.length}] ${entry.name.padEnd(28)}`,
    )
    const r = await measure(entry)
    results.push(r)

    const detail =
      r.outcome === 'compared'
        ? `${r.gzipRatio}x  (ours ${r.ourGzip} / bp ${r.theirGzip})`
        : r.outcome === 'divergent-serveronly'
          ? `serverOnly; bp reported ${r.theirGzip}`
          : r.outcome === 'both-failed'
            ? `both unbundleable`
            : r.outcome === 'ours-failed'
              ? `OURS FAILED: ${r.ourError}`
              : `bp failed: ${r.theirError}`
    console.log(`${r.outcome.padEnd(22)} ${detail}  ${r.seconds}s`)
  }

  const { outliers } = report(results)

  const snapshot = await loadSnapshot()
  let drifted = false
  if (opts.diff) {
    if (!snapshot) {
      console.error(
        '\nNo snapshot to diff against. Record one with: npm run benchmark -- --update',
      )
      process.exitCode = 1
      return
    }
    drifted = diffSnapshot(results, snapshot)
  }

  if (opts.update) await writeSnapshot(results)

  await writeFile(
    join(HERE, 'last-run.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), results },
      null,
      2,
    ) + '\n',
  )
  console.log('Full results written to benchmark/last-run.json')

  // --diff is the gating mode; a plain run reports without failing.
  if (opts.diff && drifted) process.exitCode = 1
  else if (opts.diff && outliers.length) {
    console.log(
      `\n(${outliers.length} ratio outliers — informational, not a failure)`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

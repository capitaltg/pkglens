#!/usr/bin/env node
/**
 * One command to run DepLens locally.
 *
 *   npm run dev:all
 *
 * Brings up everything the app needs, in order:
 *
 *   1. Checks .env.local and that Postgres + Redis are reachable.
 *      If they are not, and Docker is available, starts them from
 *      docker-compose.dev.yml and waits until they are healthy.
 *   2. Applies pending database migrations.
 *   3. Runs the Vite dev server AND the BullMQ worker together, with
 *      interleaved, prefixed output. Ctrl-C stops both.
 *
 * Running the worker is the point. `npm run dev` alone starts only the web
 * server, so analysis jobs queue up with nothing to consume them and the UI
 * spins forever on a package that will never resolve.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import net from 'node:net'

const COMPOSE_FILE = 'docker-compose.dev.yml'
const WEB_PORT = process.env.PORT ?? '3000'

// ─── Output helpers ──────────────────────────────────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, s) => (useColor ? `[${code}m${s}[0m` : s)
const dim = (s) => paint('2', s)
const bold = (s) => paint('1', s)
const red = (s) => paint('31', s)
const green = (s) => paint('32', s)
const yellow = (s) => paint('33', s)

const step = (s) => console.log(`\n${bold('▶')} ${bold(s)}`)
const ok = (s) => console.log(`  ${green('✓')} ${s}`)
const warn = (s) => console.log(`  ${yellow('!')} ${s}`)
const fail = (s) => console.error(`  ${red('✗')} ${s}`)

function die(message, hint) {
  fail(message)
  if (hint) console.error(`\n${hint}\n`)
  process.exit(1)
}

// ─── Preflight ───────────────────────────────────────────────────────────────

const ENV_TEMPLATE = `${dim('# .env.local')}
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/deplens
REDIS_URL=redis://localhost:6379`

function readEnv() {
  // Loaded here rather than via `--env-file-if-exists` so a missing file is
  // silent instead of printing Node's "… not found. Continuing without it."
  // on every run. First file wins; .env.local takes precedence.
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file)
      } catch {
        die(`Could not read ${file}.`)
      }
    }
  }

  if (!existsSync('.env.local') && !existsSync('.env')) {
    die(
      'No .env.local found.',
      `Create one with:\n\n${ENV_TEMPLATE}\n\n(a matching Postgres and Redis can be started for you — see below)`,
    )
  }

  const { DATABASE_URL, REDIS_URL } = process.env
  if (!DATABASE_URL || !REDIS_URL) {
    const missing = [
      !DATABASE_URL && 'DATABASE_URL',
      !REDIS_URL && 'REDIS_URL',
    ].filter(Boolean)
    die(
      `Missing in .env.local: ${missing.join(', ')}`,
      `Expected:\n\n${ENV_TEMPLATE}`,
    )
  }

  return { DATABASE_URL, REDIS_URL }
}

/** Resolve a connection URL to { host, port }, applying the scheme default. */
function endpoint(url, defaultPort) {
  const u = new URL(url)
  return { host: u.hostname, port: Number(u.port) || defaultPort }
}

function canConnect({ host, port }, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function waitFor(target, label, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (await canConnect(target)) return true
    await new Promise((r) => setTimeout(r, 500))
    if (i === 4) console.log(`  ${dim(`still waiting for ${label}…`)}`)
  }
  return false
}

function hasDocker() {
  return new Promise((resolve) => {
    const p = spawn('docker', ['compose', 'version'], { stdio: 'ignore' })
    p.once('error', () => resolve(false))
    p.once('exit', (code) => resolve(code === 0))
  })
}

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...opts })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    )
  })
}

/**
 * Start Postgres/Redis from the dev compose file.
 *
 * The container is configured from DATABASE_URL so it matches whatever the
 * developer already has in .env.local, rather than forcing a fixed set of
 * credentials.
 */
async function startServices(dbUrl, redisUrl) {
  if (!existsSync(COMPOSE_FILE)) {
    die(
      `Postgres or Redis is not reachable, and ${COMPOSE_FILE} is missing.`,
      'Start them yourself, or restore the compose file.',
    )
  }
  if (!(await hasDocker())) {
    die(
      'Postgres or Redis is not reachable, and Docker is not available.',
      'Start Postgres and Redis yourself, then re-run `npm run dev:all`.',
    )
  }

  const u = new URL(dbUrl)
  const r = new URL(redisUrl)
  const env = {
    ...process.env,
    POSTGRES_USER: decodeURIComponent(u.username) || 'postgres',
    POSTGRES_PASSWORD: decodeURIComponent(u.password) || 'postgres',
    POSTGRES_DB: u.pathname.replace(/^\//, '') || 'deplens',
    POSTGRES_PORT: u.port || '5432',
    // Must be derived too, or Redis binds the compose default and the wait
    // below times out against the port the app actually uses.
    REDIS_PORT: r.port || '6379',
  }

  warn('Postgres/Redis not reachable — starting them with Docker')
  // `--wait` blocks on the compose healthchecks. A plain TCP probe is not
  // enough: Postgres opens its port partway through initdb and then restarts,
  // so a connect() can succeed seconds before the server will accept queries.
  await run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait'], {
    env,
  })
}

// ─── Long-running processes ──────────────────────────────────────────────────

const children = []
let shuttingDown = false

function start(label, color, command, args) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  const tag = paint(color, `[${label}]`)
  const ownPrefix = `[${label}] `
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      // The worker already prefixes its own log lines; don't print [worker]
      // twice.
      const body = line.startsWith(ownPrefix)
        ? line.slice(ownPrefix.length)
        : line
      console.log(`${tag} ${body}`)
    })
  }

  child.once('exit', (code, signal) => {
    if (shuttingDown) return
    // One process dying on its own means the stack is broken — take the rest
    // down rather than leaving a half-running system that looks healthy.
    fail(`${label} exited unexpectedly (${signal ?? `code ${code}`})`)
    shutdown(code ?? 1)
  })

  children.push({ label, child })
  return child
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n${dim('Shutting down…')}`)
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  // Give them a moment to exit cleanly, then force it.
  setTimeout(() => {
    for (const { child } of children) if (!child.killed) child.kill('SIGKILL')
    process.exit(exitCode)
  }, 3000).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { DATABASE_URL, REDIS_URL } = readEnv()
  const pg = endpoint(DATABASE_URL, 5432)
  const redis = endpoint(REDIS_URL, 6379)

  step('Checking services')
  const [pgUp, redisUp] = await Promise.all([canConnect(pg), canConnect(redis)])

  if (pgUp) ok(`Postgres at ${pg.host}:${pg.port}`)
  if (redisUp) ok(`Redis at ${redis.host}:${redis.port}`)

  if (!pgUp || !redisUp) {
    await startServices(DATABASE_URL, REDIS_URL)
    const [pgReady, redisReady] = await Promise.all([
      waitFor(pg, 'Postgres'),
      waitFor(redis, 'Redis'),
    ])
    if (!pgReady)
      die(`Postgres never became reachable at ${pg.host}:${pg.port}`)
    if (!redisReady)
      die(`Redis never became reachable at ${redis.host}:${redis.port}`)
    ok('Postgres and Redis are up')
  }

  step('Applying migrations')
  try {
    await run('npx', ['drizzle-kit', 'migrate'])
    ok('Database schema is current')
  } catch {
    die(
      'Migrations failed.',
      `Check that ${pg.host}:${pg.port} has the database from DATABASE_URL, then re-run.`,
    )
  }

  step('Starting web server and worker')
  console.log(dim('  Both run here. Ctrl-C stops them together.\n'))

  start('web', '36', 'npx', ['vite', 'dev', '--port', WEB_PORT])
  start('worker', '35', 'node', ['--import', 'tsx/esm', 'worker/index.ts'])
}

main().catch((err) => {
  fail(err.message)
  shutdown(1)
})

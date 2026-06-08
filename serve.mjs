/**
 * Production web server for DepLens.
 *
 * The Vite build emits a web-standard `fetch` handler at
 * `dist/server/server.js` (it does SSR + server functions) but does NOT
 * listen on a port or serve static client assets. This thin Node wrapper:
 *   1. serves built client assets from dist/client (hashed → immutable cache)
 *   2. falls through to the SSR/server-function fetch handler for everything else
 *
 * Run: node serve.mjs   (honors PORT, defaults to 3000)
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

import handler from './dist/server/server.js'
import { runMigrations } from './migrate.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT_DIR = join(ROOT, 'dist', 'client')
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

async function tryStatic(req, res, pathname) {
  // Prevent path traversal; only serve real files under dist/client.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(CLIENT_DIR, safe)
  if (!filePath.startsWith(CLIENT_DIR)) return false
  let info
  try {
    info = await stat(filePath)
  } catch {
    return false
  }
  if (!info.isFile()) return false

  const type =
    MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  // Vite emits content-hashed filenames under /assets → safe to cache forever.
  const cache = pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate'
  res.writeHead(200, { 'content-type': type, 'cache-control': cache })
  createReadStream(filePath).pipe(res)
  return true
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

    // Health check for k8s probes — never touches the app or DB.
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await tryStatic(req, res, url.pathname)) return
    }

    // Hand off to the TanStack Start fetch handler (SSR + server functions).
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv))
      else if (v !== undefined) headers.set(k, v)
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined,
    })

    const response = await handler.fetch(request)

    res.writeHead(
      response.status,
      Object.fromEntries(response.headers.entries()),
    )
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res)
    } else {
      res.end()
    }
  } catch (err) {
    console.error('[web] request failed:', err)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('Internal Server Error')
  }
})

// Apply pending migrations before accepting traffic. A failure here is fatal —
// we don't want to serve against an out-of-date schema.
await runMigrations()

server.listen(PORT, HOST, () => {
  console.log(`[web] DepLens listening on http://${HOST}:${PORT}`)
})

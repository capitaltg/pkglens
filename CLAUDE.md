# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**DepLens** — analyze the true cost of any dependency across ecosystems. A free, open-source alternative to bundlephobia.com that adds contextual scoring, dependency tree attribution, security analysis, and multi-ecosystem support (npm, PyPI, Maven).

## Commands

```bash
npm run dev          # Start dev server on http://localhost:3000
npm run build        # Build for production (vite build)
npm run preview      # Preview production build
npm run test         # Run test suite (vitest)
npm run lint         # ESLint
npm run check        # Prettier write + ESLint fix

# Database
npm run db:generate  # Generate Drizzle migration files
npm run db:migrate   # Run migrations against DATABASE_URL
npm run db:push      # Push schema directly (dev only)
npm run db:studio    # Open Drizzle Studio

# Worker (separate process)
npm run worker       # Start BullMQ worker (analysis jobs)
```

Run a single test file:

```bash
npx vitest run src/lib/scoring/composite.test.ts
```

## Architecture

```
src/
  routes/              # File-based routing (TanStack Router)
    __root.tsx         # Root layout (HTML shell, Header, Footer)
    index.tsx          # Homepage with search bar + ecosystem selector
    $ecosystem.$name.tsx  # Package detail page
    compare.tsx        # Side-by-side comparison
  components/          # Shared UI components (shadcn + custom)
    ScoreBadge.tsx     # A–F letter grade from composite score
    SizeMetrics.tsx    # Minified/gzip size breakdown
    DepTree.tsx        # Interactive dependency tree with size attribution
    SecurityPanel.tsx  # CVE list from OSV
    MaintenancePanel.tsx
    AlternativesTable.tsx
  lib/
    analyzers/         # Per-ecosystem analysis engines
      npm.ts           # npm registry + esbuild bundling
      pypi.ts          # PyPI JSON API + wheel/sdist sizing
      maven.ts         # Maven Central + JAR sizing
    scoring/           # Rule-based composite scoring
      size.ts          # Percentile-based (0–100)
      security.ts      # OSV CVE severity scoring
      maintenance.ts   # Publish recency scoring
      composite.ts     # Weighted aggregate → A/B/C/D/F
    osv.ts             # Shared OSV vulnerability API client
  server/
    analysis.ts        # createServerFn: cache check + job enqueue
    search.ts          # createServerFn: package search
  db/
    schema.ts          # Drizzle schema (packages, analysis_results)
    index.ts           # db client (drizzle + node-postgres)

worker/
  index.ts             # BullMQ worker: runs analyzers, persists results
```

## Key external APIs

| Purpose              | URL                                                      |
| -------------------- | -------------------------------------------------------- |
| npm registry         | `https://registry.npmjs.org/{name}`                      |
| npm downloads        | `https://api.npmjs.org/downloads/point/last-week/{name}` |
| OSV vulnerabilities  | `https://api.osv.dev/v1/query`                           |
| PyPI metadata        | `https://pypi.org/pypi/{name}/json`                      |
| Maven Central search | `https://search.maven.org/solrsearch/select`             |

## Environment variables

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
```

## Data flow

1. User searches a package → server function checks DB cache (< 6h → return immediately)
2. Cache miss/stale → enqueue BullMQ job → return `{ status: "pending", jobId }`
3. Worker picks up job → runs ecosystem analyzer → scores results → persists to DB
4. Client polls `/api/job/:jobId` until `status === "complete"`, then renders detail page

## Scoring model (rule-based)

- **Size** (40%): percentile rank among all analyzed packages in the same ecosystem
- **Security** (40%): `100 - (50×critical + 30×high + 10×medium)` CVEs from OSV, floor 0
- **Maintenance** (20%): 100 if published < 6 months ago; −20 per additional 6-month window; 0 if deprecated
- **Letter grade**: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F < 40

import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

export const ecosystemEnum = pgEnum('ecosystem', ['npm', 'pypi', 'maven'])

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'running',
  'complete',
  'failed',
])

// One row per ecosystem+name+version. A published version is immutable, so its
// analysis is cached permanently and keyed by exact version (not just name).
export const packages = pgTable(
  'packages',
  {
    id: serial().primaryKey(),
    ecosystem: ecosystemEnum().notNull(),
    name: text().notNull(),
    version: text().notNull(),
    analyzedAt: timestamp('analyzed_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.ecosystem, t.name, t.version)],
)

// Full analysis result stored as JSON blobs for flexibility
export const analysisResults = pgTable('analysis_results', {
  id: serial().primaryKey(),
  packageId: integer('package_id')
    .notNull()
    .references(() => packages.id, { onDelete: 'cascade' }),
  // Size data: { minifiedBytes, gzipBytes, treeShakedBytes? }
  sizeData: jsonb('size_data').notNull().$type<SizeData>(),
  // Dependency tree: recursive DepNode[]
  depTree: jsonb('dep_tree').notNull().$type<DepNode[]>(),
  // Score breakdown
  scoreData: jsonb('score_data').notNull().$type<ScoreData>(),
  // Raw vulnerability list from OSV
  vulnerabilities: jsonb('vulnerabilities')
    .notNull()
    .$type<Vulnerability[]>()
    .default([]),
  // Maintenance metadata
  maintenanceData: jsonb('maintenance_data').notNull().$type<MaintenanceData>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // When the vulnerability data was last refreshed from OSV. The size/tree/bundle
  // are immutable per version, but new CVEs get filed against old versions, so
  // security is re-queried on a TTL independently of the rest.
  securityRefreshedAt: timestamp('security_refreshed_at')
    .defaultNow()
    .notNull(),
})

// Background job tracking
export const analysisJobs = pgTable('analysis_jobs', {
  id: serial().primaryKey(),
  ecosystem: ecosystemEnum().notNull(),
  name: text().notNull(),
  bullJobId: text('bull_job_id'),
  status: jobStatusEnum().notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ─── JSON shape types ────────────────────────────────────────────────────────

export interface SizeData {
  minifiedBytes: number
  gzipBytes: number
  /** Only set for npm packages that support tree-shaking */
  treeShakedBytes?: number
  /**
   * True when the package can't be bundled for the browser because it depends
   * on Node built-ins (fs, crypto, …). There is no browser bundle, so the size
   * dimension is omitted from scoring rather than reported as 0.
   */
  serverOnly?: boolean
}

export interface DepNode {
  name: string
  version: string
  ecosystem: 'npm' | 'pypi' | 'maven'
  /** Uncompressed size contribution of this node only (not subtree) */
  selfBytes: number
  /** Cumulative size including all transitive children */
  totalBytes: number
  children: DepNode[]
}

export interface ScoreData {
  composite: number // 0–100 (backend/server weighted composite for npm; only composite for others)
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  size: number // 0–100
  security: number // 0–100
  maintenance: number // 0–100
  popularity: number // 0–100 (0 if unavailable)
  depHealth: number // 0–100
  typescript?: number // 0–100 (npm only)
  securityDetail: {
    activeCves: number
    historicalCveCount: number
    medianPatchDays?: number
  }
  frontend?: {
    // npm only: frontend-weighted composite
    composite: number
    grade: 'A' | 'B' | 'C' | 'D' | 'F'
  }
}

export interface Vulnerability {
  id: string // e.g. "CVE-2023-1234" or OSV id
  summary: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown'
  aliases: string[]
  publishedAt?: string
  isActive?: boolean // true = current version still affected; undefined = unknown (treated as active)
  fixedAt?: string // ISO date when the first fixed version was released
  fixedVersion?: string // version string of the first fix (e.g. "1.2.3")
}

export interface MaintenanceData {
  lastPublishedAt: string // ISO date
  weeklyDownloads?: number
  releaseCount?: number
  isDeprecated: boolean
  repositoryUrl?: string
  description?: string
  license?: string
  homepage?: string
  keywords?: string[]
  typescriptSupport?: 'bundled' | 'definitely-typed' | 'none' // npm only
}

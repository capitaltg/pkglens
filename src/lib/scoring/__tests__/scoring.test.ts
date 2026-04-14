import { describe, expect, it } from 'vitest'
import { scoreSecurity } from '../security'
import { scorePopularity } from '../popularity'
import { scoreMaintenance } from '../maintenance'
import { scoreSizeHeuristic } from '../size'
import { scoreDepHealth } from '../deps'
import type { DepNode, MaintenanceData, Vulnerability } from '#/db/schema'

// ─── Security ────────────────────────────────────────────────────────────────

function makeVuln(
  overrides: Partial<Vulnerability> & Pick<Vulnerability, 'severity'>,
): Vulnerability {
  return {
    id: 'CVE-2023-0001',
    summary: 'test',
    aliases: [],
    isActive: true,
    ...overrides,
  }
}

describe('scoreSecurity', () => {
  it('returns score 100 with no vulnerabilities', () => {
    expect(scoreSecurity([]).score).toBe(100)
  })

  it('has no active CVEs in detail when list is empty', () => {
    const { detail } = scoreSecurity([])
    expect(detail.activeCves).toBe(0)
    expect(detail.historicalCveCount).toBe(0)
    expect(detail.medianPatchDays).toBeUndefined()
  })

  it('penalizes active critical CVEs', () => {
    const vulns = [makeVuln({ id: 'a', severity: 'critical', isActive: true })]
    const { score, detail } = scoreSecurity(vulns)
    expect(detail.activeCves).toBe(1)
    expect(detail.historicalCveCount).toBe(1)
    // active score: max(0, 100-50)=50; historical: 85 (1 CVE); patch: 5 (no fixedAt)
    // 0.5*50 + 0.25*85 + 0.25*5 = 25 + 21.25 + 1.25 = 47.5 → 48
    expect(score).toBe(48)
  })

  it('inactive CVEs do not penalize active score', () => {
    const vulns = [makeVuln({ id: 'a', severity: 'critical', isActive: false })]
    const { score, detail } = scoreSecurity(vulns)
    expect(detail.activeCves).toBe(0)
    expect(detail.historicalCveCount).toBe(1)
    // active score: 100 (no active vulns); historical: 85 (1 CVE); patch: 5 (no fixedAt)
    // 0.5*100 + 0.25*85 + 0.25*5 = 50 + 21.25 + 1.25 = 72.5 → 73
    expect(score).toBe(73)
  })

  it('gives a very low score for many active critical CVEs', () => {
    const vulns = Array.from({ length: 10 }, (_, i) =>
      makeVuln({ id: `CVE-${i}`, severity: 'critical', isActive: true }),
    )
    const { score } = scoreSecurity(vulns)
    expect(score).toBeLessThan(20)
  })

  it('rewards patched CVEs in patch velocity', () => {
    const publishedAt = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000,
    ).toISOString()
    const fixedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const vulns = [
      makeVuln({
        id: 'a',
        severity: 'medium',
        isActive: false,
        publishedAt,
        fixedAt,
      }),
    ]
    const { detail } = scoreSecurity(vulns)
    expect(detail.medianPatchDays).toBeDefined()
    expect(detail.medianPatchDays ?? 0).toBeGreaterThan(0)
    expect(detail.medianPatchDays ?? 999).toBeLessThan(20)
  })

  it('treats undefined isActive as active (backward compat)', () => {
    const vulns: Vulnerability[] = [
      { id: 'a', summary: '', severity: 'critical', aliases: [] },
    ]
    const { detail } = scoreSecurity(vulns)
    expect(detail.activeCves).toBe(1)
  })
})

// ─── Popularity ───────────────────────────────────────────────────────────────

describe('scorePopularity', () => {
  it('returns minimum score for 0 downloads', () => {
    expect(scorePopularity(0)).toBe(5)
  })

  it('returns maximum score for 10M+ downloads', () => {
    expect(scorePopularity(10_000_000)).toBe(100)
    expect(scorePopularity(50_000_000)).toBe(100)
  })

  it('returns a mid-range score for 10K weekly downloads', () => {
    const score = scorePopularity(10_000)
    expect(score).toBe(50)
  })

  it('increases monotonically with downloads', () => {
    const downloads = [0, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]
    const scores = downloads.map(scorePopularity)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
    }
  })
})

// ─── Maintenance ─────────────────────────────────────────────────────────────

function makeMaintenanceData(
  overrides: Partial<MaintenanceData> = {},
): MaintenanceData {
  return {
    lastPublishedAt: new Date().toISOString(),
    isDeprecated: false,
    ...overrides,
  }
}

describe('scoreMaintenance', () => {
  it('returns 0 for deprecated packages', () => {
    expect(scoreMaintenance(makeMaintenanceData({ isDeprecated: true }))).toBe(
      0,
    )
  })

  it('returns 100 for very recently published', () => {
    expect(
      scoreMaintenance(
        makeMaintenanceData({ lastPublishedAt: new Date().toISOString() }),
      ),
    ).toBe(100)
  })

  it('returns 80 for ~6 months old', () => {
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000 - 1)
    const score = scoreMaintenance(
      makeMaintenanceData({ lastPublishedAt: sixMonthsAgo.toISOString() }),
    )
    expect(score).toBe(80)
  })

  it('returns 0 for very old packages', () => {
    const veryOld = new Date('2015-01-01')
    expect(
      scoreMaintenance(
        makeMaintenanceData({ lastPublishedAt: veryOld.toISOString() }),
      ),
    ).toBe(0)
  })
})

// ─── Size heuristic ──────────────────────────────────────────────────────────

describe('scoreSizeHeuristic', () => {
  it('gives near-perfect score for tiny packages', () => {
    expect(scoreSizeHeuristic(1_000)).toBe(95)
  })

  it('gives low score for very large packages', () => {
    expect(scoreSizeHeuristic(600_000)).toBe(5)
  })

  it('gives mid-range score for medium packages', () => {
    const score = scoreSizeHeuristic(50_000)
    expect(score).toBeGreaterThanOrEqual(50)
    expect(score).toBeLessThanOrEqual(70)
  })
})

// ─── Dep health ───────────────────────────────────────────────────────────────

function makeDepNode(
  name: string,
  totalBytes = 0,
  children: DepNode[] = [],
): DepNode {
  return {
    name,
    version: '1.0.0',
    ecosystem: 'npm',
    selfBytes: totalBytes,
    totalBytes,
    children,
  }
}

describe('scoreDepHealth', () => {
  it('returns 100 for an empty dep tree', () => {
    expect(scoreDepHealth([])).toBe(100)
  })

  it('penalizes large dep trees', () => {
    const many = Array.from({ length: 100 }, (_, i) => makeDepNode(`dep-${i}`))
    const score = scoreDepHealth(many)
    expect(score).toBeLessThan(50)
  })

  it('rewards deps with resolved sizes', () => {
    const withSize = [makeDepNode('a', 10_000), makeDepNode('b', 5_000)]
    const noSize = [makeDepNode('a', 0), makeDepNode('b', 0)]
    expect(scoreDepHealth(withSize)).toBeGreaterThan(scoreDepHealth(noSize))
  })
})

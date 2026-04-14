import { describe, expect, it } from 'vitest'
import { scoreSecurity } from '../security'
import { scoreMaintenance } from '../maintenance'
import { scoreSizeHeuristic } from '../size'
import type { MaintenanceData, Vulnerability } from '#/db/schema'

// ─── Security ────────────────────────────────────────────────────────────────

describe('scoreSecurity', () => {
  it('returns 100 with no vulnerabilities', () => {
    expect(scoreSecurity([])).toBe(100)
  })

  it('deducts 50 for a critical CVE', () => {
    const vulns: Vulnerability[] = [
      {
        id: 'CVE-2023-0001',
        summary: 'RCE',
        severity: 'critical',
        aliases: [],
      },
    ]
    expect(scoreSecurity(vulns)).toBe(50)
  })

  it('floors at 0 for multiple critical CVEs', () => {
    const vulns: Vulnerability[] = Array.from({ length: 5 }, (_, i) => ({
      id: `CVE-2023-000${i}`,
      summary: 'critical',
      severity: 'critical' as const,
      aliases: [],
    }))
    expect(scoreSecurity(vulns)).toBe(0)
  })

  it('accumulates deductions across severities', () => {
    const vulns: Vulnerability[] = [
      { id: 'a', summary: '', severity: 'high', aliases: [] },
      { id: 'b', summary: '', severity: 'medium', aliases: [] },
      { id: 'c', summary: '', severity: 'low', aliases: [] },
    ]
    // 100 - (30 + 10 + 2) = 58
    expect(scoreSecurity(vulns)).toBe(58)
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

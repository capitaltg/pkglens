import type { Vulnerability } from '#/db/schema'

const SEVERITY_WEIGHTS: Record<Vulnerability['severity'], number> = {
  critical: 50,
  high: 30,
  medium: 10,
  low: 2,
  unknown: 5,
}

/**
 * Score 0–100 based on OSV vulnerability list.
 * 100 = no known vulnerabilities. Each vuln deducts points by severity.
 */
export function scoreSecurity(vulns: Vulnerability[]): number {
  if (vulns.length === 0) return 100

  const deduction = vulns.reduce(
    (acc, v) => acc + (SEVERITY_WEIGHTS[v.severity] ?? 5),
    0,
  )
  return Math.max(0, 100 - deduction)
}

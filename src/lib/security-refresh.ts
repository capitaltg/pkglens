/**
 * Re-query vulnerabilities for an already-analyzed package version.
 *
 * Size/tree/bundle are immutable per version and cached permanently, but new
 * CVEs get filed against old versions — so security is refreshed on a TTL via
 * this metadata-only path (no install, no esbuild).
 */
import type { Vulnerability } from '#/db/schema'
import { getNpmVulnerabilities } from './analyzers/npm'
import { getPypiVulnerabilities } from './analyzers/pypi'
import { getMavenVulnerabilities } from './analyzers/maven'

export function getVulnerabilities(
  ecosystem: 'npm' | 'pypi' | 'maven',
  name: string,
  version: string,
): Promise<Vulnerability[]> {
  if (ecosystem === 'npm') return getNpmVulnerabilities(name, version)
  if (ecosystem === 'pypi') return getPypiVulnerabilities(name, version)
  return getMavenVulnerabilities(name, version)
}

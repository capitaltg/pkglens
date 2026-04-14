import type { MaintenanceData } from '#/db/schema'

/**
 * Score 0–100 for TypeScript support (npm packages only).
 * - Bundled types (types/typings field): 100
 * - @types/* package exists: 70
 * - No types: 30
 */
export function scoreTypescript(
  support: MaintenanceData['typescriptSupport'],
): number {
  if (support === 'bundled') return 100
  if (support === 'definitely-typed') return 70
  return 30
}

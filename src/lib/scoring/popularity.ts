/**
 * Score 0–100 based on weekly downloads.
 * Uses piece-wise logarithmic interpolation between anchor points.
 *
 * Anchors: 0→5, 100→10, 1K→30, 10K→50, 100K→70, 1M→85, 10M+→100
 */

const LOG_ANCHORS: [number, number][] = [
  [100, 10],
  [1_000, 30],
  [10_000, 50],
  [100_000, 70],
  [1_000_000, 85],
  [10_000_000, 100],
]

export function scorePopularity(weeklyDownloads: number): number {
  if (weeklyDownloads <= 0) return 5
  if (weeklyDownloads >= 10_000_000) return 100

  // Linear segment [0, 100] → [5, 10]
  if (weeklyDownloads <= 100) {
    return Math.round(5 + (weeklyDownloads / 100) * 5)
  }

  // Logarithmic segments
  for (let i = 0; i < LOG_ANCHORS.length - 1; i++) {
    const [lo, loScore] = LOG_ANCHORS[i]
    const [hi, hiScore] = LOG_ANCHORS[i + 1]
    if (weeklyDownloads <= hi) {
      const t =
        (Math.log10(weeklyDownloads) - Math.log10(lo)) /
        (Math.log10(hi) - Math.log10(lo))
      return Math.round(loScore + t * (hiScore - loScore))
    }
  }
  return 100
}

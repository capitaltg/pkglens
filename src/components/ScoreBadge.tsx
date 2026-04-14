import type { ScoreData } from '#/db/schema'
import { cn } from '#/lib/utils'

interface ScoreBadgeProps {
  score: ScoreData
  size?: 'sm' | 'md' | 'lg'
}

const gradeStyles: Record<ScoreData['grade'], string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  B: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800',
  C: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800',
  D: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  F: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
}

const sizeStyles = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-12 w-12 text-xl',
  lg: 'h-16 w-16 text-3xl',
}

export function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  return (
    <div
      className="flex flex-col items-center gap-1"
      aria-label={`Quality grade: ${score.grade}, composite score ${score.composite} out of 100`}
    >
      <div
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center rounded-xl border-2 font-bold font-mono',
          gradeStyles[score.grade],
          sizeStyles[size],
        )}
      >
        {score.grade}
      </div>
      <span aria-hidden="true" className="text-xs text-[var(--sea-ink-soft)]">
        {score.composite}/100
      </span>
    </div>
  )
}

interface ScoreBreakdownProps {
  score: ScoreData
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 70
      ? 'bg-emerald-500'
      : value >= 40
        ? 'bg-yellow-500'
        : 'bg-red-500'
  const labelId = `score-label-${label.toLowerCase()}`
  return (
    <div className="flex items-center gap-3">
      <span
        id={labelId}
        className="w-24 flex-shrink-0 text-right text-xs text-[var(--sea-ink-soft)]"
      >
        {label}
      </span>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${value} out of 100`}
        className="h-1.5 flex-1 rounded-full bg-[var(--line)]"
      >
        <div
          aria-hidden="true"
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span
        aria-hidden="true"
        className="w-8 text-right text-xs font-semibold text-[var(--sea-ink)]"
      >
        {value}
      </span>
    </div>
  )
}

export function ScoreBreakdown({ score }: ScoreBreakdownProps) {
  return (
    <div className="space-y-2">
      <ScoreBar label="Size" value={score.size} />
      <ScoreBar label="Security" value={score.security} />
      <ScoreBar label="Maintenance" value={score.maintenance} />
    </div>
  )
}

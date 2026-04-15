import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatVersion(version: string): string {
  if (!version || version === 'unknown') return version
  // Don't prefix version specifiers (>=, <=, ==, !=, ~=, <, >) or full PEP 508 strings
  if (/^[><=!~]/.test(version)) return version
  return version.startsWith('v') ? version : `v${version}`
}

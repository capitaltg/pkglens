import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatVersion(version: string): string {
  if (!version) return ''
  return version.startsWith('v') ? version : `v${version}`
}

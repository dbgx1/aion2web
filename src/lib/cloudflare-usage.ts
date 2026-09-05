export const FREE_LIMITS = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, storageBytes: 5_000_000_000 } as const

export type UsageDay = { date: string; requests: number | null; rowsRead: number | null; rowsWritten: number | null }
export type CloudflareUsage = {
  configured: boolean
  accountId: string | null
  fetchedAt: string
  refreshAfter: string
  today: string
  days: UsageDay[]
  storageBytes: number | null
  storageDatabases: number | null
  errors: string[]
}

export function usageDates(now: Date) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: 7 }, (_, i) => new Date(midnight - (6 - i) * 86_400_000).toISOString().slice(0, 10))
}

export function quotaState(value: number | null, limit: number) {
  if (value === null) return { level: 'unknown', percent: null, remaining: null, over: null } as const
  return {
    level: value >= limit ? 'exceeded' : value >= limit * 0.8 ? 'warning' : 'normal',
    percent: value / limit * 100,
    remaining: Math.max(0, limit - value),
    over: Math.max(0, value - limit),
  } as const
}

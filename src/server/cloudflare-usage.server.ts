import { env } from 'cloudflare:workers'
import { usageDates, type CloudflareUsage } from '#/lib/cloudflare-usage'

const CACHE_MS = 5 * 60_000
type Config = { accountId: string; token: string }
type Row = { dimensions?: { date?: string; databaseId?: string }; sum?: Record<string, unknown>; max?: Record<string, unknown> }
// Cache only completed values; do not share request-bound I/O promises across Workers requests.
let cached: { accountId: string; token: string; until: number; value: CloudflareUsage } | undefined

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Cloudflare 返回的统计字段不完整')
  return value
}

async function queryRows(config: Config, selection: string, dataset: string): Promise<Row[]> {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{viewer{accounts(filter:{accountTag:"${config.accountId}"}){${selection}}}}` }),
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 401 || response.status === 403) throw new Error('统计令牌无效或权限不足，请检查 Account Analytics Read 权限和账号范围')
  if (response.status === 429) throw new Error('Cloudflare 统计接口限流，请稍后刷新')
  if (!response.ok) throw new Error(`Cloudflare 统计接口暂不可用（HTTP ${response.status}）`)
  const body = await response.json() as { errors?: unknown[]; data?: { viewer?: { accounts?: Record<string, unknown>[] } } }
  // GraphQL can return HTTP 200 with errors or null data. Neither means zero usage.
  if (body.errors?.length) throw new Error('Cloudflare 未能返回统计，请检查令牌权限、账号范围及 Analytics API 可用性')
  const accounts = body.data?.viewer?.accounts
  if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(accounts[0]?.[dataset])) throw new Error('Cloudflare 未返回此账号的统计数据')
  return accounts[0][dataset] as Row[]
}

export async function collectCloudflareUsage(config: Config, now = new Date()): Promise<CloudflareUsage> {
  const dates = usageDates(now)
  const today = dates[6]
  const result: CloudflareUsage = {
    configured: true, accountId: config.accountId, today, fetchedAt: now.toISOString(),
    refreshAfter: new Date(now.getTime() + CACHE_MS).toISOString(),
    days: dates.map(date => ({ date, requests: null, rowsRead: null, rowsWritten: null })),
    storageBytes: null, storageDatabases: null, errors: [],
  }
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString()
  const selections = [
    ['Workers', 'workersInvocationsAdaptive', `workersInvocationsAdaptive(limit:8,filter:{datetime_geq:"${dates[0]}T00:00:00Z",datetime_lt:"${end}"}){dimensions{date}sum{requests}}`],
    ['D1 读写', 'd1AnalyticsAdaptiveGroups', `d1AnalyticsAdaptiveGroups(limit:8,filter:{date_geq:"${dates[0]}",date_leq:"${today}"}){dimensions{date}sum{rowsRead rowsWritten}}`],
    ['D1 存储', 'd1StorageAdaptiveGroups', `d1StorageAdaptiveGroups(limit:10000,filter:{date_geq:"${today}",date_leq:"${today}"}){dimensions{databaseId}max{databaseSizeBytes}}`],
  ] as const
  // Separate queries keep a failure in one dataset from hiding the other metrics.
  const responses = await Promise.allSettled(selections.map(async ([, dataset, selection], index) => {
    const rows = await queryRows(config, selection, dataset)
    if (index === 2) {
      if (!rows.length) throw new Error('今日尚无数据库容量上报')
      if (rows.length >= 10000) throw new Error('数据库容量结果可能被截断，无法计算完整合计')
      const ids = new Set<string>()
      const total = rows.reduce((sum, row) => {
        const id = row?.dimensions?.databaseId
        if (!id || ids.has(id)) throw new Error('数据库容量维度不完整')
        ids.add(id)
        return sum + count(row.max?.databaseSizeBytes)
      }, 0)
      result.storageBytes = total
      result.storageDatabases = ids.size
      return
    }
    const byDate = new Map<string, Row>()
    for (const row of rows) {
      const date = row?.dimensions?.date
      if (!date || !dates.includes(date) || byDate.has(date)) throw new Error('每日统计维度不完整')
      byDate.set(date, row)
    }
    // Validate the complete dataset before publishing any numbers.
    const values = dates.map(date => {
      const row = byDate.get(date)
      return index === 0
        ? { requests: row ? count(row.sum?.requests) : 0 }
        : { rowsRead: row ? count(row.sum?.rowsRead) : 0, rowsWritten: row ? count(row.sum?.rowsWritten) : 0 }
    })
    result.days.forEach((day, i) => Object.assign(day, values[i]))
  }))
  responses.forEach((response, i) => {
    if (response.status === 'rejected') {
      const message = response.reason instanceof Error && !['TimeoutError', 'AbortError', 'TypeError'].includes(response.reason.name)
        ? response.reason.message : '连接超时或网络暂不可用，请稍后刷新'
      result.errors.push(`${selections[i][0]}：${message}`)
    }
  })
  return result
}

export async function getCloudflareUsage(): Promise<CloudflareUsage> {
  const vars = env as unknown as Record<string, string | undefined>
  const accountId = vars.CLOUDFLARE_ACCOUNT_ID?.trim() || ''
  const token = vars.CLOUDFLARE_USAGE_API_TOKEN?.trim() || ''
  const now = new Date()
  const dates = usageDates(now)
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !token) return {
    configured: false, accountId: /^[a-f0-9]{32}$/i.test(accountId) ? accountId : null,
    today: dates[6], fetchedAt: now.toISOString(), refreshAfter: now.toISOString(),
    days: dates.map(date => ({ date, requests: null, rowsRead: null, rowsWritten: null })),
    storageBytes: null, storageDatabases: null, errors: [],
  }
  if (cached && cached.accountId === accountId && cached.token === token && cached.until > now.getTime() && cached.value.today === dates[6]) return cached.value
  const value = await collectCloudflareUsage({ accountId, token }, now)
  cached = { accountId, token, until: Date.parse(value.refreshAfter), value }
  return value
}

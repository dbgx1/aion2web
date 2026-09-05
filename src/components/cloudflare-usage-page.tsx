import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { FREE_LIMITS, quotaState, type CloudflareUsage } from '#/lib/cloudflare-usage'
import './cloudflare-usage.css'

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
const display = (value: number | null) => value === null ? '—' : number.format(value)
const levels = { unknown: '未取得数据', exceeded: '已达 / 超过免费额度', warning: '接近免费额度', normal: '低于免费额度' }

function QuotaCard({ label, value, limit, storage = false }: { label: string; value: number | null; limit: number; storage?: boolean }) {
  const state = quotaState(value, limit)
  const format = (amount: number | null) => storage && amount !== null ? `${(amount / 1e9).toFixed(3)} GB` : display(amount)
  return <article className={`usage-card usage-${state.level}`}>
    <div className="usage-card-label">{label}</div>
    <strong className="usage-value">{format(value)}</strong>
    <span className="usage-muted">免费额度 {storage ? '5 GB' : `${display(limit)} / 日`}</span>
    <div className="usage-meter" role="progressbar" aria-label={`${label}免费额度占比`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent === null ? undefined : Math.min(100, state.percent)} aria-valuetext={state.percent === null ? '未取得数据' : `${state.percent.toFixed(1)}%`}>
      <span style={{ width: `${Math.min(100, state.percent ?? 0)}%` }} />
    </div>
    <div className="usage-card-status"><b>{levels[state.level]}</b><b>{state.percent === null ? '—' : `${state.percent.toFixed(1)}%`}</b></div>
    <small>{value === null ? '数据缺失不代表没有消费' : state.over! > 0 ? `超出 ${format(state.over)}` : `剩余 ${format(state.remaining)}`}{storage && ' · 按上报峰值参考'}</small>
  </article>
}

export function CloudflareUsagePage({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return <section className="data-panel route-empty-state"><CircleAlert size={24} /><h2>仅管理员可查看费用统计</h2></section>
  return <AdminUsage />
}

function AdminUsage() {
  const [data, setData] = useState<CloudflareUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    setLoading(true)
    setError('')
    const timeout = window.setTimeout(() => controller.abort('timeout'), 25_000)
    try {
      const response = await fetch('/api/admin/cloudflare-usage', { headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' })
      const body = await response.json() as CloudflareUsage & { error?: string }
      if (!response.ok) {
        setData(null)
        throw new Error(body.error || '读取统计失败')
      }
      if (activeRequest.current === controller) setData(body as CloudflareUsage)
    } catch (cause) {
      if (activeRequest.current === controller) setError(controller.signal.aborted ? '统计请求超时，请稍后手动刷新。' : cause instanceof Error ? cause.message : '读取统计失败，请稍后刷新。')
    } finally {
      window.clearTimeout(timeout)
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false) }
    }
  }, [])
  useEffect(() => {
    void refresh()
    return () => { const controller = activeRequest.current; activeRequest.current = null; controller?.abort() }
  }, [refresh])
  const today = data?.days.find(day => day.date === data.today)
  const account = data?.accountId
  const billingUrl = account ? `https://dash.cloudflare.com/${account}/billing/billable-usage` : 'https://dash.cloudflare.com/'
  const exceeded = today && (['requests', 'rowsRead', 'rowsWritten'] as const).filter(key => today[key] !== null && today[key]! >= FREE_LIMITS[key])
  return <div className="usage-page">
    <section className="usage-heading">
      <div><span className="usage-eyebrow"><ShieldCheck size={15} /> ADMIN · CLOUDFLARE</span><h2>费用与免费额度</h2><p>查看整个账号的 Workers 和 D1 用量，及时发现超额。</p></div>
      <div className="usage-actions"><a href={billingUrl} target="_blank" rel="noreferrer">查看 Cloudflare 账单 <ExternalLink size={14} /></a><button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? '读取中' : '刷新统计'}</button></div>
    </section>
    {error && <div className="usage-notice usage-exceeded" role="alert">{error}{data && ' 下方保留的是上次取得的数据，请留意时间。'}</div>}
    {data && !data.configured && <section className="usage-notice" role="status"><h3>尚未接入 Cloudflare 统计</h3><p>配置只读统计令牌后，这里会展示真实用量。当前无法判断是否超额。</p><details><summary>查看管理员接入步骤</summary><ol><li>在 Cloudflare 创建仅限本账号的 API Token，权限选择 <b>Account → Account Analytics → Read</b>。</li><li>在 Worker 的 Settings → Variables and Secrets 添加 Secret：<code>CLOUDFLARE_USAGE_API_TOKEN</code>，值填入该令牌。</li><li>设置变量 <code>CLOUDFLARE_ACCOUNT_ID</code> 为目标账号 ID，保存并部署后刷新本页。</li></ol><p>令牌仅保存在 Worker 服务端，请勿填入聊天内容或前端代码。</p><a href="https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/" target="_blank" rel="noreferrer">Cloudflare 官方配置说明 ↗</a></details></section>}
    {!!exceeded?.length && <div className="usage-notice usage-exceeded" role="status"><b>今日有 {exceeded.length} 项用量已达到或超过免费日额度。</b> 免费套餐可能停止服务；付费套餐按其月度包含量计费，此提示不等于已产生额外账单。</div>}
    <section className="usage-period"><div><b>今日 · {data?.today || '读取中'}（UTC）</b><span>每日额度于北京时间 08:00 重置</span></div><span>{data?.configured ? `取数时间：${new Date(data.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 北京时间` : '等待统计接入'}</span></section>
    <div className="usage-cards">
      <QuotaCard label="Workers 请求" value={today?.requests ?? null} limit={FREE_LIMITS.requests} />
      <QuotaCard label="D1 读取行数" value={today?.rowsRead ?? null} limit={FREE_LIMITS.rowsRead} />
      <QuotaCard label="D1 写入行数" value={today?.rowsWritten ?? null} limit={FREE_LIMITS.rowsWritten} />
      <QuotaCard label="D1 今日数据库容量峰值合计" value={data?.storageBytes ?? null} limit={FREE_LIMITS.storageBytes} storage />
    </div>
    {!!data?.errors.length && <section className="usage-notice" role="alert"><b>部分数据暂不可用</b>{data.errors.map(message => <p key={message}>{message}</p>)}</section>}
    <section className="usage-history"><div className="usage-section-heading"><h3>近 7 天用量</h3><span>包含今天 · 超过免费日额度的数字标红</span></div><div className="usage-table-wrap"><table><thead><tr><th>日期（UTC）</th><th>Workers 请求</th><th>D1 读取行数</th><th>D1 写入行数</th></tr></thead><tbody>{data?.days.map(day => <tr key={day.date}><th>{day.date}{day.date === data.today && <small> 今日</small>}</th>{(['requests', 'rowsRead', 'rowsWritten'] as const).map(key => <td key={key} className={day[key] !== null && day[key]! >= FREE_LIMITS[key] ? 'usage-over' : ''}>{display(day[key])}</td>)}</tr>) || <tr><td colSpan={4}>{loading ? '正在读取统计…' : '暂无统计数据'}</td></tr>}</tbody></table></div></section>
    <section className="usage-notes"><h3>统计口径</h3><p>当前套餐和实际账单金额尚未接入。这里以 Workers Free 的额度作对照；付费套餐按订阅账期计算，超过免费日额度并不代表超过付费套餐包含量。</p><p>数据来自 Cloudflare Analytics，可能存在上报延迟或采样差异。Workers 请求统计用于趋势参考，不能直接换算为账单。D1 容量为今日已上报的 {data?.storageDatabases ?? '—'} 个数据库各自峰值之和，并非实时存储总量。</p><p>范围包含本账号其他项目的 Workers 和 D1；不含 R2、KV、日志等其他服务费用，也不含 OpenRouter 的 AI 费用。页面不自动轮询；服务端实例缓存 5 分钟，手动刷新在缓存期内可能仍显示同一份数据。</p><p><a href="https://developers.cloudflare.com/workers/platform/pricing/" target="_blank" rel="noreferrer">Workers 官方价格 ↗</a><a href="https://developers.cloudflare.com/d1/platform/pricing/" target="_blank" rel="noreferrer">D1 官方价格 ↗</a><span>额度核对日期：2026-09-04</span></p></section>
  </div>
}

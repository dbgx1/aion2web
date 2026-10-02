import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Star, X } from 'lucide-react'
import { trackingPriorities, trackingStatuses, type TrackingEntry, type TrackingMutation, type TrackingClaim } from '#/lib/character-tracking'
import type { GameCharacter } from '#/lib/game-characters'

type TrackingContextValue = {
  entries: TrackingEntry[]; claims: TrackingClaim[]; ready: boolean; busy: boolean; error: string;
  refresh: () => Promise<void>; mutate: (input: TrackingMutation) => Promise<boolean>;
}
const TrackingContext = createContext<TrackingContextValue | null>(null)

export function TrackingProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TrackingEntry[]>([])
  const [claims, setClaims] = useState<TrackingClaim[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const revision = useRef(0)
  async function refresh() {
    const current = ++revision.current
    try {
      const response = await fetch('/api/character-tracking', { cache: 'no-store' })
      const data = await response.json() as { ok: boolean; error?: string; entries: TrackingEntry[]; claims?: TrackingClaim[] }
      if (!response.ok || !data.ok) throw new Error(data.error || '读取重点名单失败')
      if (current !== revision.current) return
      setEntries(data.entries); setClaims(data.claims || []); setReady(true); setError('')
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : '读取重点名单失败')
    }
  }
  useEffect(() => {
    void refresh()
    const reload = () => { if (!document.hidden && !locked.current) void refresh() }
    const timer = setInterval(reload, 15000)
    window.addEventListener('focus', reload)
    window.addEventListener('aion:characters-changed', reload)
    return () => { ++revision.current; clearInterval(timer); window.removeEventListener('focus', reload); window.removeEventListener('aion:characters-changed', reload) }
  }, [])
  async function mutate(input: TrackingMutation) {
    if (locked.current) return false
    locked.current = true; setBusy(true); setError(''); ++revision.current
    try {
      const response = await fetch('/api/character-tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      const data = await response.json() as { ok: boolean; error?: string }
      if (!response.ok || !data.ok) {
        if (response.status === 409) await refresh()
        throw new Error(data.error || '保存失败')
      }
      await refresh()
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  return <TrackingContext.Provider value={{ entries, claims, ready, busy, error, refresh, mutate }}>{children}</TrackingContext.Provider>
}

export function TrackingStar({ character }: { character: GameCharacter }) {
  const tracking = useContext(TrackingContext)
  if (!tracking) return null
  const selected = tracking.entries.some(entry => entry.character.id === character.id)
  const occupied = tracking.claims.find(claim => claim.characterId === character.id && !claim.isMine)
  if (occupied) return <span className="tracking-claimed" title={`该角色已由 ${occupied.ownerName} 重点跟踪，取消后才能重新分配。`}>
    <button type="button" className="tracking-star is-selected" disabled aria-label={`已由 ${occupied.ownerName} 跟踪：${character.name}`}><Star size={17} fill="currentColor" /></button>
    <small>{occupied.ownerName} 跟踪中</small>
  </span>
  const label = `${selected ? '移出' : '加入'}重点跟踪：${character.name}`
  return <button type="button" className={`tracking-star${selected ? ' is-selected' : ''}`} aria-label={label} title={tracking.error || label}
    aria-pressed={selected} disabled={!tracking.ready || tracking.busy}
    onClick={() => void tracking.mutate({ action: selected ? 'remove' : 'add', characterId: Number(character.id) })}>
    <Star size={17} fill={selected ? 'currentColor' : 'none'} />
  </button>
}

export function TrackingButton({ onSelect }: { onSelect?: (character: GameCharacter) => void }) {
  const tracking = useContext(TrackingContext)
  const [open, setOpen] = useState(false)
  if (!tracking) return null
  return <>
    <button type="button" className="secondary-button tracking-entry" onClick={() => { setOpen(true); void tracking.refresh() }}>
      <Star size={16} />重点跟踪 <span>{tracking.ready ? tracking.entries.length : '…'}</span>
    </button>
    {tracking.error && <span className="tracking-error" role="alert">{tracking.error}<button type="button" onClick={() => void tracking.refresh()}>重试</button></span>}
    {open && <TrackingPanel tracking={tracking} onClose={() => setOpen(false)} onSelect={onSelect} />}
  </>
}

function localDateTime(value: number | null) {
  if (value === null) return ''
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function TrackingPanel({ tracking, onClose, onSelect }: { tracking: TrackingContextValue; onClose: () => void; onSelect?: (character: GameCharacter) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<TrackingEntry | null>(null)
  const [page, setPage] = useState(0)
  useEffect(() => { dialog.current?.showModal() }, [])
  const now = Date.now()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const entries = tracking.entries.filter(entry => {
    const c = entry.character
    if (search && !`${c.name} ${c.characterId} ${c.serverName} ${c.legionName} ${entry.notes}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'high') return entry.priority === 'high'
    if (filter === 'overdue') return entry.status !== 'closed' && entry.nextFollowUp !== null && entry.nextFollowUp < now
    if (filter === 'today') return entry.status !== 'closed' && entry.nextFollowUp !== null && entry.nextFollowUp >= today.getTime() && entry.nextFollowUp < tomorrow.getTime()
    return filter === 'all' || entry.status === filter
  }).sort((a, b) => (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0)
    || (a.nextFollowUp ?? Infinity) - (b.nextFollowUp ?? Infinity)
    || ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(entries.length / 50) - 1))
  return <dialog ref={dialog} className="tracking-dialog" aria-labelledby="tracking-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="tracking-heading"><div><h2 id="tracking-title">重点跟踪</h2><p>我的名单 · {tracking.entries.length} 个角色 · 备注仅自己可见，跟踪归属在区服内共享</p></div>
      <button type="button" className="icon-button" aria-label="关闭重点跟踪" onClick={onClose}><X size={20} /></button></header>
    {tracking.error && <p className="tracking-error" role="alert">{tracking.error}</p>}
    {editing ? <form className="tracking-editor" onSubmit={async event => {
      event.preventDefault()
      if (await tracking.mutate({ action: 'update', characterId: Number(editing.character.id), priority: editing.priority, status: editing.status, notes: editing.notes, nextFollowUp: editing.nextFollowUp })) setEditing(null)
    }}>
      <h3>{editing.character.name} · {editing.character.serverName}</h3>
      <label>优先级<select aria-label="优先级" value={editing.priority} onChange={event => setEditing({ ...editing, priority: event.target.value as TrackingEntry['priority'] })}>{Object.entries(trackingPriorities).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>跟进状态<select aria-label="跟进状态" value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value as TrackingEntry['status'] })}>{Object.entries(trackingStatuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>下次跟进时间（本地时间）<input type="datetime-local" value={localDateTime(editing.nextFollowUp)} onChange={event => setEditing({ ...editing, nextFollowUp: event.target.value ? new Date(event.target.value).getTime() : null })} /></label>
      <label>跟进备注<textarea rows={5} maxLength={4000} value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} placeholder="记录关注原因、沟通进展或下次要聊的内容" /></label>
      <div className="toolbar-actions"><button type="submit" className="primary-button" disabled={tracking.busy}>{tracking.busy ? '保存中…' : '保存跟进'}</button><button type="button" className="secondary-button" disabled={tracking.busy} onClick={() => setEditing(null)}>返回名单</button></div>
    </form> : <>
      <div className="tracking-filters"><input aria-label="搜索重点角色" placeholder="搜索角色、区服或备注" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} />
        <select aria-label="跟进筛选" value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">全部跟踪</option><option value="today">今天跟进</option><option value="overdue">已逾期</option><option value="high">高优先级</option>{Object.entries(trackingStatuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <button type="button" className="secondary-button" disabled={tracking.busy} onClick={() => void tracking.refresh()}>刷新</button></div>
      <div className="tracking-table-wrap"><table className="tracking-table"><thead><tr><th>角色 / 区服</th><th>军团</th><th>战斗力</th><th>优先级</th><th>跟进状态</th><th>下次跟进</th><th>备注</th><th>操作</th></tr></thead><tbody>
        {entries.slice(currentPage * 50, currentPage * 50 + 50).map(entry => <tr key={entry.character.id}>
          <td><strong>{entry.character.name}</strong><small>{entry.character.serverName} · {entry.character.characterId}</small></td><td>{entry.character.legionName || '—'}</td><td>{entry.character.combatPower?.toLocaleString() ?? '—'}</td>
          <td><span className={`tracking-priority ${entry.priority}`}>{trackingPriorities[entry.priority]}</span></td><td>{trackingStatuses[entry.status]}</td>
          <td className={entry.status !== 'closed' && entry.nextFollowUp !== null && entry.nextFollowUp < now ? 'tracking-overdue' : ''}>{entry.nextFollowUp === null ? '未安排' : new Date(entry.nextFollowUp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td className="tracking-note" title={entry.notes}>{entry.notes || '—'}</td><td><div className="toolbar-actions"><button type="button" className="secondary-button" onClick={() => setEditing(entry)}>跟进</button>{onSelect && <button type="button" className="secondary-button" onClick={() => { onSelect(entry.character); onClose() }}>打开聊天</button>}<TrackingStar character={entry.character} /></div></td>
        </tr>)}
      </tbody></table></div>
      {!entries.length && <p className="tracking-empty">{!tracking.ready ? '正在读取名单…' : tracking.entries.length ? '没有符合筛选条件的角色。' : '还没有重点角色。在角色列表或聊天窗口点击 ☆，即可加入。'}</p>}
      {entries.length > 50 && <div className="tracking-filters"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {Math.ceil(entries.length / 50)}</span><button type="button" disabled={(currentPage + 1) * 50 >= entries.length} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    </>}
  </dialog>
}

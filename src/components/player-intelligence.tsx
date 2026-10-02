import { useEffect, useState } from 'react'
import type { GameCharacter } from '#/lib/game-characters'
import { avatarColorFor } from '#/lib/game-characters'
import { useServerDirectory, toGameCharacter, type CharacterResponse } from '#/lib/use-character-directory'
import { aion2ServerName } from '#/lib/aion2-servers'
import { TrackingStar } from './character-tracking'
import { GuildTrackingProvider, GuildTrackingSummary, GuildClaimLabel, GuildTrackingButton } from './guild-tracking'

type View = 'directory' | 'players'
type Row = {
  id?: number; name: string; server_id: string; server_name: string; character_id?: string; legion_name?: string;
  level?: number; combat_power?: number | null; class_name?: string; faction?: string; avatar_url?: string; legion_position?: number | null;
  score: number; rank: number; member_count?: number; known_power_count?: number; average_power?: number | null; last_seen_at: number;
}
const views: { id: View; label: string; metrics: [string, string][] }[] = [
  { id: 'directory', label: '军团目录', metrics: [['members', '已收录人数'], ['name', '军团名称']] },
  { id: 'players', label: '角色排行榜', metrics: [['power', '战斗力'], ['level', '等级']] },
]
function character(row: Row): GameCharacter {
  return { id: String(row.id), characterId: row.character_id!, name: row.name, serverKey: row.server_id, serverName: aion2ServerName(row.server_id) || row.server_name || row.server_id,
    legionName: row.legion_name || '', legionPosition: row.legion_position ?? null, className: row.class_name || '', level: row.level || 0,
    combatPower: row.combat_power ?? null, faction: row.faction || '', avatarUrl: row.avatar_url || '', avatarColor: avatarColorFor(row.character_id!), lastSeenAt: row.last_seen_at }
}
type Filters = { view: View; metric: string; server: string; q: string; page: number }
const initial: Filters = { view: 'directory', metric: 'members', server: '', q: '', page: 0 }
export function PlayerIntelligence({ storageKey, onChat }: { storageKey: string; onChat: (character: GameCharacter) => void }) {
  const { servers, error: serverError } = useServerDirectory()
  const [filters, setFilters] = useState<Filters>(initial), [ready, setReady] = useState(false)
  const [rows, setRows] = useState<Row[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [revision, setRevision] = useState(0), [queriedAt, setQueriedAt] = useState(0)
  const [selected, setSelected] = useState<Row | null>(null)
  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); const v = views.find(v => v.id === saved?.view)
      if (v && v.metrics.some(m => m[0] === saved.metric) && typeof saved.server === 'string' && typeof saved.q === 'string') setFilters({ view: v.id, metric: saved.metric, server: saved.server, q: saved.q, page: Number.isInteger(saved.page) && saved.page >= 0 && saved.page <= 999999 ? saved.page : 0 })
    } catch { /* A damaged browser preference does not block the page. */ } setReady(true)
  }, [storageKey])
  useEffect(() => {
    if (!ready) return
    try { sessionStorage.setItem(storageKey, JSON.stringify(filters)) } catch { /* Storage may be disabled. */ }
    const controller = new AbortController(); setLoading(true); setError(''); setRows([]); setSelected(null)
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ ...filters, page: String(filters.page) })
        const response = await fetch(`/api/intelligence?${params}`, { signal: controller.signal })
        const data = await response.json() as { ok: boolean; error?: string; rows: Row[]; total: number; queriedAt: number }
        if (!response.ok || !data.ok) throw new Error(data.error || '读取失败')
        if (!controller.signal.aborted) { setRows(data.rows); setTotal(data.total); setQueriedAt(data.queriedAt); if (filters.view !== 'players') setSelected(data.rows[0] || null) }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, filters.q ? 250 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [filters, ready, revision, storageKey])
  const config = views.find(v => v.id === filters.view)!
  function update(value: Partial<Filters>) { setFilters(f => ({ ...f, ...value, page: 0 })) }
  return <GuildTrackingProvider><div className="page-stack intelligence-page">
    <section className="data-panel">
      <div className="panel-toolbar"><div><h3>玩家情报</h3><p>仅统计已收录且有权限查看的数据，不代表官方全服排名。</p></div><button className="secondary-button" disabled={loading} onClick={() => setRevision(r => r + 1)}>刷新</button></div>
      <GuildTrackingSummary onSelect={claim => setSelected({name:claim.legionName,server_id:claim.serverId,server_name:'',rank:0,score:0,last_seen_at:0})}/>
      <div className="intel-controls">{views.map(v => <button key={v.id} className={filters.view === v.id ? 'primary-button' : 'secondary-button'} aria-pressed={filters.view === v.id} onClick={() => update({ view: v.id, metric: v.metrics[0][0], q: '' })}>{v.label}</button>)}</div>
      <div className="intel-controls">
        <label>区服<select value={filters.server} onChange={e => update({ server: e.target.value })}><option value="">全部授权区服</option>{servers.map(s => <option key={s.serverId} value={s.serverId}>{s.serverName}</option>)}</select></label>
        <label>排列指标<select value={filters.metric} onChange={e => update({ metric: e.target.value })}>{config.metrics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>搜索<input type="search" maxLength={100} value={filters.q} placeholder={filters.view === 'players' ? '角色名称' : '军团名称'} onChange={e => update({ q: e.target.value })} /></label>
      </div>
      <p className="intel-note">{filters.view === 'directory' ? '同名军团按区服分别显示；未加入军团的角色请在角色数据库查看。' : '同分并列，搜索保留原排名；更换区服重新计算排名。'}{filters.metric === 'average' ? '平均战斗力仅计算已知数值，缺失不算 0。' : filters.metric === 'power' ? '缺少战斗力的角色不参与此榜单。' : ''}{queriedAt > 0 && ` 最近查询：${new Date(queriedAt).toLocaleString()}`}</p>
      {(error || serverError) && <p role="alert" className="intel-note">{error || serverError}<button className="secondary-button" onClick={() => setRevision(r => r + 1)}>重试</button></p>}
      <div className="intel-layout">
        <section aria-label={config.label}>
          {loading ? <p role="status">正在读取…</p> : !error && !rows.length ? <p>没有符合条件的数据，请调整筛选。</p> : filters.view === 'directory' ? <div className="intel-guild-list">{rows.map(row => <button className="intel-guild" key={`${row.server_id}:${row.name}`} aria-pressed={selected?.server_id === row.server_id && selected?.name === row.name} onClick={() => setSelected(row)}><strong>{row.name}</strong><span>{aion2ServerName(row.server_id) || row.server_name || row.server_id} · 已收录 {row.member_count} 人</span><GuildClaimLabel serverId={row.server_id} legionName={row.name}/></button>)}</div> : <div className="table-wrap"><table className="client-table"><thead><tr><th>排名</th><th>{filters.view === 'players' ? '角色' : '军团'}</th><th>区服</th><th>{config.metrics.find(m => m[0] === filters.metric)?.[1]}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id || `${row.server_id}:${row.name}`}><td>{row.rank}</td><td><button className="utility-link" onClick={() => setSelected(row)}>{row.name}</button></td><td>{aion2ServerName(row.server_id) || row.server_name || row.server_id}</td><td>{row.score.toLocaleString()}</td></tr>)}</tbody></table></div>}
          {!loading && !error && <div className="intel-controls"><span>共 {total} 项 · 第 {filters.page + 1} 页</span><button className="secondary-button" disabled={filters.page === 0} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>上一页</button><button className="secondary-button" disabled={(filters.page + 1) * 50 >= total} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>下一页</button></div>}
        </section>
        <aside className="intel-detail">{selected ? selected.id ? <CharacterDetail character={character(selected)} onChat={onChat} onGuild={() => { if (selected.legion_name) setSelected({ name: selected.legion_name, server_id: selected.server_id, server_name: selected.server_name, score: 0, rank: 0, last_seen_at: selected.last_seen_at }) }} /> : <GuildDetail key={`${selected.server_id}:${selected.name}`} row={selected} onChat={onChat} /> : <p>选择一个{filters.view === 'players' ? '角色' : '军团'}查看详情。</p>}</aside>
      </div>
    </section>
  </div></GuildTrackingProvider>
}
function CharacterDetail({ character: c, onChat, onGuild }: { character: GameCharacter; onChat: (c: GameCharacter) => void; onGuild?: () => void }) {
  return <div><h3>{c.name}</h3><p>{c.serverName} · {c.className || '职业未知'} · 等级 {c.level || '未知'}</p><p>战斗力：{c.combatPower?.toLocaleString() ?? '未收录'}</p><p>Character ID：{c.characterId}</p><p>最后采集：{new Date(c.lastSeenAt).toLocaleString()}</p><div className="intel-controls"><TrackingStar character={c} /><button className="secondary-button" onClick={() => onChat(c)}>打开私聊</button>{c.legionName && onGuild && <button className="secondary-button" onClick={onGuild}>查看所属军团</button>}</div></div>
}
function GuildDetail({ row, onChat }: { row: Row; onChat: (c: GameCharacter) => void }) {
  const [members, setMembers] = useState<GameCharacter[]>([]), [total, setTotal] = useState(0), [cursor, setCursor] = useState<number | string>(0), [next, setNext] = useState<number | string | null>(null)
  const [q, setQ] = useState(''), [sort, setSort] = useState('default'), [leaders, setLeaders] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [detail, setDetail] = useState<GameCharacter | null>(null)
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setMembers([]); setDetail(null)
    const timer = setTimeout(async () => { try {
      const params = new URLSearchParams({ serverId: row.server_id, legionName: row.name, q, sort, cursor: String(cursor), legionLeadersOnly: leaders ? '1' : '0' })
      const response = await fetch(`/api/characters?${params}`, { signal: abort.signal }); const data = await response.json() as CharacterResponse & { error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || '读取成员失败')
      if (!abort.signal.aborted) { setMembers(data.characters.map(toGameCharacter)); setNext(data.nextCursor); setTotal(data.totalCount || 0) }
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '读取成员失败') }
    finally { if (!abort.signal.aborted) setLoading(false) } }, q ? 250 : 0)
    return () => { clearTimeout(timer); abort.abort() }
  }, [row.server_id, row.name, cursor, q, sort, leaders, retry])
  return <div><h3>{row.name}</h3><p>{aion2ServerName(row.server_id) || row.server_name || row.server_id}{row.member_count !== undefined && ` · 已收录 ${row.member_count} 人`}</p><GuildTrackingButton serverId={row.server_id} legionName={row.name}/>{row.known_power_count !== undefined && <p>战斗力已知：{row.known_power_count} / {row.member_count} 人</p>}
    <div className="intel-controls"><label>查找成员<input type="search" value={q} maxLength={100} placeholder="角色名或 Character ID" onChange={e => { setQ(e.target.value); setCursor(0) }} /></label><label>成员排序<select value={sort} onChange={e => { setSort(e.target.value); setCursor(0) }}><option value="default">默认顺序</option><option value="power_desc">战斗力从高到低</option><option value="power_asc">战斗力从低到高</option></select></label><label><input type="checkbox" checked={leaders} onChange={e => { setLeaders(e.target.checked); setCursor(0) }} />仅军团长</label></div>
    {error && <p role="alert">{error}<button className="secondary-button" onClick={() => setRetry(r => r + 1)}>重试</button></p>}
    {loading ? <p role="status">正在读取成员…</p> : !error && <><p>当前条件共 {total} 人</p>{!members.length && <p>暂无符合条件的成员。</p>}{members.map(c => <div className="intel-member" key={c.id}><div><button className="utility-link" onClick={() => setDetail(c)}>{c.name}</button>{c.legionPosition != null && <span> · {['军团长', '军团干部', '军团成员', '雇佣兵'][c.legionPosition]}</span>}<small>{c.className || '职业未知'} · 等级 {c.level || '未知'} · 战力 {c.combatPower?.toLocaleString() ?? '未收录'}</small></div><div className="intel-controls"><TrackingStar character={c} /><button className="secondary-button" onClick={() => onChat(c)}>私聊</button></div></div>)}<div className="intel-controls"><button className="secondary-button" disabled={cursor === 0} onClick={() => setCursor(0)}>回到第一页</button><button className="secondary-button" disabled={next === null} onClick={() => next !== null && setCursor(next)}>下一页成员</button></div></>}
    {detail && <div className="intel-character-detail"><button className="utility-link" onClick={() => setDetail(null)}>收起资料</button><CharacterDetail character={detail} onChat={onChat} /></div>}
  </div>
}


import { useEffect, useState } from 'react'
import { Bot, BookOpenText, MessageSquareText, UsersRound, Plus, Trash2, RefreshCw } from 'lucide-react'
import { actionLabels, defaultReceptionSettings, receptionSettingsSchema, statusLabels,
  type ReceptionDecision, type ReceptionLine, type ReceptionProfile, type ReceptionSettings } from '#/lib/reception'
import { receptionRequest } from '#/lib/reception-client'
import { AiPersonaSettings } from './ai-persona-settings'

type AuditTurn = { id: string; status: string; decision: ReceptionDecision | null; issues: string[]; createdAt: number; history: ReceptionLine[] }
export function ReceptionPanel({ onOpenConversation }: { onOpenConversation?: (profile: ReceptionProfile) => void }) {
  const [tab, setTab] = useState<'queue' | 'library' | 'preview'>('queue')
  const [settings, setSettings] = useState<ReceptionSettings>(defaultReceptionSettings)
  const [profiles, setProfiles] = useState<ReceptionProfile[]>([])
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<ReceptionProfile | null>(null), [turns, setTurns] = useState<AuditTurn[]>([])
  const [filter, setFilter] = useState('all'), [playerText, setPlayerText] = useState(''), [history, setHistory] = useState<ReceptionLine[]>([])
  const [preview, setPreview] = useState<{ decision: ReceptionDecision; issues: string[] } | null>(null)
  const [simulation, setSimulation] = useState<unknown>(undefined)
  useEffect(() => {
    const openConfig = () => { if (window.location.hash === '#config') setTab('library') }
    openConfig()
    window.addEventListener('hashchange', openConfig)
    return () => window.removeEventListener('hashchange', openConfig)
  }, [])
  async function refresh(initial = false) {
    const response = await fetch('/api/ai/reception', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    const data = await response.json() as { ok: boolean; error?: string; settings: ReceptionSettings; profiles: ReceptionProfile[] }
    if (!response.ok || !data.ok) throw new Error(data.error || '读取接待台失败')
    setProfiles(data.profiles)
    setSelected(current => current ? data.profiles.find(p => p.serverId === current.serverId && p.characterId === current.characterId) || null : null)
    if (initial) { setSettings(data.settings); setLoaded(true) }
  }
  useEffect(() => {
    let active = true
    void refresh(true).catch(e => { if (active) setError(e.message) })
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(e => { if (active) setError(e.message) }) }, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  useEffect(() => {
    setTurns([])
    if (!selected) return
    const controller = new AbortController()
    const params = new URLSearchParams({ serverId: selected.serverId, characterId: selected.characterId })
    void fetch(`/api/ai/reception?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json() as { turns: AuditTurn[]; error?: string }
      if (!response.ok) throw new Error(data.error || '读取决策记录失败')
      setTurns(data.turns)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [selected?.serverId, selected?.characterId, selected?.updatedAt])
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  async function save() {
    const parsed = receptionSettingsSchema.safeParse(settings)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || '配置无效')
    await receptionRequest({ action: 'settings', settings: parsed.data }); setNotice('内容库已保存，下一轮接待立即使用。')
  }
  async function control(profile: ReceptionProfile, status: 'ai' | 'human' | 'closed') {
    await receptionRequest({ action: 'control', serverId: profile.serverId, characterId: profile.characterId, status, version: profile.version })
    await refresh(); setNotice(status === 'human' ? '已接管。请到实时消息中回复玩家；AI 停止该会话的自动发送。' : status === 'ai' ? '已交回 AI，下一条玩家消息触发接待。' : '会话已结束。')
  }
  async function simulate() {
    if (!playerText.trim()) return
    const next: ReceptionLine[] = [...history, { id: crypto.randomUUID(), direction: 'incoming' as const, content: playerText.trim(), time: new Date().toISOString() }].slice(-30)
    const result = await receptionRequest<{ decision: ReceptionDecision; issues: string[]; simulation: unknown }>({ action: 'preview', simulation, input: {
      serverId: 'preview', characterId: 'preview', characterName: '模拟玩家', instruction: '', history: next,
    } })
    setPreview(result); setSimulation(result.simulation); setPlayerText('')
    setHistory(result.decision.reply ? [...next, { id: crypto.randomUUID(), direction: 'outgoing', content: result.decision.reply, time: new Date().toISOString() }] : next)
  }
  function updateGuide(index: number, patch: Partial<ReceptionSettings['guides'][number]>) {
    setSettings(current => ({ ...current, guides: current.guides.map((guide, i) => i === index ? { ...guide, ...patch } : guide) }))
  }
  return <div className="reception-page">
    <header className="page-intro"><p className="eyebrow">PLAYER RECEPTION</p><h2>AI 接待台</h2><p>理解需求、自然交流、提供攻略，在合适时机交给真人。</p></header>
    <div className="reception-metrics"><div><strong>{profiles.filter(p => p.status === 'waiting').length}</strong><span>等待真人</span></div><div><strong>{profiles.filter(p => p.status === 'human').length}</strong><span>真人接管</span></div><div><strong>{settings.guides.filter(g => g.enabled).length}</strong><span>启用的攻略</span></div><div><strong>{settings.discordUrl ? '已配置' : '未配置'}</strong><span>Discord 入口</span></div></div>
    <nav className="reception-tabs" aria-label="接待台功能">
      <button type="button" aria-pressed={tab === 'queue'} onClick={() => setTab('queue')}><UsersRound size={17} />接待队列</button>
      <button type="button" aria-pressed={tab === 'library'} onClick={() => setTab('library')}><BookOpenText size={17} />AI 配置</button>
      <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}><MessageSquareText size={17} />模拟对话</button>
    </nav>
    {error && <p className="reception-alert" role="alert">{error}</p>}{notice && <p className="reception-notice" role="status">{notice}</p>}
    {!loaded && <p>正在读取接待配置… <button type="button" onClick={() => void perform(() => refresh(true))}>重试</button></p>}
    {loaded && tab === 'queue' && <div className="reception-columns">
      <section className="reception-card"><div className="reception-toolbar"><h3>玩家会话</h3><button type="button" aria-label="刷新接待队列" disabled={busy} onClick={() => void perform(() => refresh())}><RefreshCw size={16} /></button></div>
        <label>会话状态<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <p className="reception-muted">显示最近 200 个有权限的会话，等待真人优先。每 15 秒更新。</p>
        <div className="reception-list">{profiles.filter(p => filter === 'all' || p.status === filter).map(profile => <button type="button" key={`${profile.serverId}:${profile.characterId}`} className={selected?.serverId === profile.serverId && selected.characterId === profile.characterId ? 'selected' : ''} onClick={() => setSelected(profile)}>
          <span><strong>{profile.characterName}</strong><small>{profile.serverId} · {profile.decision?.need || '需求待确认'}</small></span><em>{statusLabels[profile.status]}</em>
        </button>)}</div>
        {!profiles.length && <p className="reception-empty">还没有接待记录。到“实时消息”开启智能接待，玩家回复后会自动出现在这里。</p>}
      </section>
      <section className="reception-card">{selected ? <>
        <div className="reception-toolbar"><h3>{selected.characterName}</h3><span>{statusLabels[selected.status]}</span></div>
        <p className="reception-muted">{selected.serverId} · {selected.characterId}{selected.assignedTo ? ` · 接待员 ${selected.assignedTo}` : ''}</p>
        {onOpenConversation && <button type="button" className="secondary-button compact" onClick={() => onOpenConversation(selected)}>打开玩家私聊</button>}
        <div className="reception-actions"><button className="primary-button compact" disabled={busy || selected.status === 'human'} onClick={() => void perform(() => control(selected,'human'))}>真人接管</button><button className="secondary-button compact" disabled={busy || selected.status === 'ai'} onClick={() => void perform(() => control(selected,'ai'))}>交回 AI</button><button className="secondary-button compact" disabled={busy || selected.status === 'closed'} onClick={() => void perform(() => control(selected,'closed'))}>结束会话</button></div>
        <h4>需求与交接摘要</h4><p className="reception-prewrap">{selected.memory || '尚无摘要'}</p>
        <p>{selected.discordDeclined ? '已拒绝 Discord · ' : ''}{selected.paidDeclined ? '不考虑付费 · ' : ''}已发攻略 {selected.sentGuides.length} 份</p>
        {selected.decision && <DecisionCard decision={selected.decision} />}
        <h4>最近决策与发送记录</h4>{turns.map(turn => <details key={turn.id} className="reception-audit"><summary>{turn.decision ? actionLabels[turn.decision.action] : '生成中 / 生成失败'} · {({sent:'已确认发送',sending:'发送中 / 待核对',uncertain:'结果未确认',ready:'待发送',skipped:'未发送',failed:'生成失败',generating:'生成中'} as Record<string,string>)[turn.status] || turn.status} · {new Date(turn.createdAt).toLocaleString()}</summary>
          {turn.status === 'uncertain' && <div className="reception-actions"><p>请先核对游戏聊天记录，再选择实际结果。</p>{(['sent','skipped'] as const).map(outcome => <button key={outcome} disabled={busy} className="secondary-button compact" onClick={() => void perform(async () => { await receptionRequest({ action:'resolve',turnId:turn.id,outcome }); await refresh(); setNotice('发送结果已人工核对，可交回 AI。') })}>{outcome === 'sent' ? '确认已送达' : '确认未送达'}</button>)}</div>}
          {turn.issues.map((issue,i) => <p key={i} className="reception-alert">{issue}</p>)}{turn.history.map(line => <p key={line.id}><strong>{line.direction === 'incoming' ? '玩家' : '回复'}：</strong>{line.content}</p>)}{turn.decision && <DecisionCard decision={turn.decision} />}
        </details>)}
      </> : <div className="reception-empty"><Bot size={32} /><h3>选择一个玩家</h3><p>查看需求、原话证据、发送记录，或接手对话。</p></div>}</section>
    </div>}
    {loaded && <div hidden={tab !== 'library'}><div className="reception-config">
      <AiPersonaSettings />
      <section className="reception-card reception-library">
      <div className="reception-toolbar"><div><h3>内容库与接待规则</h3><p className="reception-muted">配置按客服账号保存。玩家拒绝和接管状态在有权限的接待员之间共享。</p></div><button className="primary-button compact" disabled={busy} onClick={() => void perform(save)}>保存配置</button></div>
      <p className="reception-muted">以下内容仅用于智能接待，在通用人设基础上补充。真人接管、玩家拒绝和资源真实性规则始终优先。</p>
      <label>接待补充规则<textarea value={settings.style} maxLength={2000} onChange={e => setSettings({ ...settings, style: e.target.value })} /><span className="reception-muted">原接待“聊天风格”已保留在此；所有模式的共同说话风格请在上方设置。</span></label>
      <label>已确认的业务资料<textarea rows={5} placeholder="填写真实服务、适用条件、可公开价格和必须交给真人的问题。留空时 AI 不会假设存在付费服务。" maxLength={8000} value={settings.businessFacts} onChange={e => setSettings({ ...settings, businessFacts: e.target.value })} /></label>
      <div className="reception-columns"><label>Discord 邀请链接<input type="url" placeholder="https://discord.gg/..." value={settings.discordUrl} onChange={e => setSettings({ ...settings, discordUrl: e.target.value })} /></label><label>加入后能获得什么<input placeholder="例如：英语组队频道、职业讨论" value={settings.discordPurpose} onChange={e => setSettings({ ...settings, discordPurpose: e.target.value })} /></label></div>
      <div className="reception-toolbar"><h3>Guide 攻略库</h3><button className="secondary-button compact" disabled={settings.guides.length >= 50} onClick={() => setSettings({ ...settings, guides: [...settings.guides, { id: crypto.randomUUID(), title: '', url: '', needs: '', prerequisites: '', version: '', enabled: true }] })}><Plus size={16} />添加攻略</button></div>
      {!settings.guides.length && <p className="reception-empty">尚未添加攻略。AI 会先回答或澄清需求，不会编造攻略链接。</p>}
      {settings.guides.map((guide,index) => <fieldset key={guide.id} className="reception-guide"><legend>攻略 {index + 1}</legend><div className="reception-columns"><label>标题<input value={guide.title} onChange={e => updateGuide(index, { title: e.target.value })} /></label><label>链接<input type="url" value={guide.url} onChange={e => updateGuide(index, { url: e.target.value })} /></label><label>解决什么问题<textarea value={guide.needs} onChange={e => updateGuide(index, { needs: e.target.value })} /></label><label>适用前提<input placeholder="职业、等级、装备要求" value={guide.prerequisites} onChange={e => updateGuide(index, { prerequisites: e.target.value })} /><span>适用版本</span><input value={guide.version} onChange={e => updateGuide(index, { version: e.target.value })} /></label></div><div className="reception-toolbar"><label className="reception-checkbox"><input type="checkbox" checked={guide.enabled} onChange={e => updateGuide(index, { enabled: e.target.checked })} />允许推荐</label><button type="button" className="secondary-button compact" aria-label={`删除攻略 ${index + 1}`} onClick={() => setSettings({ ...settings, guides: settings.guides.filter((_,i) => i !== index) })}><Trash2 size={15} />删除</button></div></fieldset>)}
      <p className="reception-muted">固定规则：每轮一个主要动作；拒绝后不反复邀请；明确请求或同意后交接；真人接管后停发；发送回执成功后才记录已提供内容。</p>
    </section></div></div>}
    {loaded && tab === 'preview' && <div className="reception-columns"><section className="reception-card"><div className="reception-toolbar"><h3>模拟玩家对话</h3><button className="secondary-button compact" disabled={busy} onClick={() => { setHistory([]); setPreview(null); setSimulation(undefined) }}>清空对话</button></div><p className="reception-muted">使用已保存的配置调用 AI，不向游戏玩家发送消息，不创建真人工单。</p>
      <div className="reception-chat">{!history.length && <p className="reception-empty">试试 “My damage is terrible lol” 或 “Can I talk to a person?”</p>}{history.map(line => <div key={line.id} className={`reception-bubble ${line.direction}`}><small>{line.direction === 'incoming' ? '模拟玩家' : 'AI 候选回复'}</small><p>{line.content}</p></div>)}</div>
      <form onSubmit={e => { e.preventDefault(); void perform(simulate) }}><label>玩家消息<textarea aria-label="模拟玩家消息" maxLength={2000} value={playerText} onChange={e => setPlayerText(e.target.value)} /></label><button className="primary-button compact" disabled={busy || !playerText.trim()}>{busy ? '正在判断…' : '生成下一句'}</button></form>
    </section><section className="reception-card"><h3>本轮判断</h3>{preview ? <><DecisionCard decision={preview.decision} />{preview.issues.map((issue,i) => <p role="status" key={i} className="reception-alert">{issue}</p>)}</> : <p className="reception-empty">生成后显示动作、需求、证据和交接判断。</p>}</section></div>}
  </div>
}
function DecisionCard({ decision }: { decision: ReceptionDecision }) {
  return <dl className="reception-decision"><dt>下一步</dt><dd>{actionLabels[decision.action]}</dd><dt>玩家需求</dt><dd>{decision.need || '待确认'}</dd><dt>原话证据</dt><dd>{decision.evidence || '暂无'}</dd><dt>选择原因</dt><dd>{decision.reason}</dd><dt>商业 / 支持信号</dt><dd>{({none:'无商业信号',exploring:'了解付费选项',pricing:'询价',purchase:'购买意向',support:'支持问题'})[decision.intent]}</dd><dt>交接对象</dt><dd>{decision.handoffTo === 'sales' ? '销售' : decision.handoffTo === 'support' ? '客服支持' : '无需交接'}</dd>{decision.missing.length > 0 && <><dt>待确认</dt><dd>{decision.missing.join('、')}</dd></>}{decision.reply && <><dt>候选回复</dt><dd className="reception-prewrap">{decision.reply}</dd></>}</dl>
}

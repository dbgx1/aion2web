import { useEffect, useRef, useState } from 'react'
import type { ConsoleMessage } from '#/lib/use-aion-console'

type Snapshot = { taskId: string; revision: number; state: string; stage?: string; message?: string; accountRef: string; serverId: string; characterId: string; updatedAt: number; chatPaused?: boolean; error?: { message?: string } }
const labels: Record<string, string> = { sent: '指令已发送，等待客户端', received: '客户端已收到', queued: '登录进程已受理，排队中', running: '正在换号', waiting_user: '等待人工处理', succeeded: '换号成功', failed: '换号失败', cancelled: '已取消', unknown: '状态未确认' }
const stages: Record<string, string> = { logging_out: '退出当前账号', launching: '启动游戏', authenticating: '登录目标账号', selecting_server: '选择区服', selecting_character: '选择角色', entering_world: '进入游戏' }
const terminal = new Set(['succeeded', 'failed', 'cancelled'])

export function AccountSwitchPanel({ agentId, connected, messages, storageKey, onSend, supported = true }: {
  agentId: string; connected: boolean; messages: ConsoleMessage[]; storageKey: string; supported?: boolean;
  onSend: (agentId: string, command: Record<string, unknown>) => boolean
}) {
  const [account, setAccount] = useState(''), [server, setServer] = useState(''), [character, setCharacter] = useState('')
  const [task, setTask] = useState<Snapshot | null>(null), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now())
  const [observedAt, setObservedAt] = useState(0)
  const pending = useRef(new Set<string>())
  const seen = useRef(new Set<string>())
  const taskRef = useRef(task); taskRef.current = task
  const key = `${storageKey}:${agentId}`
  useEffect(() => {
    let saved: Snapshot | null = null
    try { const raw = localStorage.getItem(key); if (raw) { const value = JSON.parse(raw); if (typeof value.taskId === 'string' && typeof value.state === 'string') saved = value } } catch { /* no previous task */ }
    setTask(saved); taskRef.current = saved; setObservedAt(0); setNotice(''); seen.current.clear(); pending.current.clear()
  }, [key])
  function remember(next: Snapshot) {
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { setNotice('本机无法保存任务编号，请复制任务编号以便之后查询。') }
    taskRef.current = next; setTask(next)
  }
  function command(type: string, extra = {}) {
    const current = taskRef.current
    if (!current && type !== 'switchAccountStatus') return
    const requestId = crypto.randomUUID()
    pending.current.add(requestId)
    if (pending.current.size > 100) pending.current.delete(pending.current.values().next().value!)
    if (!onSend(agentId, { type, taskId: current?.taskId || '', requestId, ...extra })) setNotice('连接或回执订阅尚未就绪，请稍后查询。')
  }
  useEffect(() => {
    for (const message of messages) {
      if (message.agentId !== agentId || seen.current.has(message.id)) continue
      seen.current.add(message.id)
      const raw = message.raw
      if (raw.type === 'control_progress' && raw.command === 'switchAccount' && raw.switchTask && typeof raw.switchTask === 'object') {
        const next = raw.switchTask as Snapshot
        const current = taskRef.current
        if (typeof next.taskId !== 'string' || !Number.isInteger(next.revision) || !labels[next.state]) continue
        if (current && next.taskId !== current.taskId && (!terminal.has(current.state) || next.updatedAt < current.updatedAt)) continue
        if (current && next.taskId === current.taskId && next.revision < current.revision) continue
        remember(next); setObservedAt(Date.now()); setNotice('')
      } else if (raw.type === 'control_result' && typeof raw.requestId === 'string' && pending.current.has(raw.requestId) && raw.ok === false) {
        setNotice(typeof raw.error === 'string' ? raw.error : '操作未被客户端接受')
        if (raw.command === 'switchAccount' && taskRef.current?.state === 'sent') remember({ ...taskRef.current, state: 'failed', message: String(raw.error || '客户端拒绝执行'), updatedAt: Date.now() })
      }
    }
    if (seen.current.size > 3000) seen.current = new Set(messages.map(message => message.id))
  }, [messages, agentId])
  useEffect(() => {
    if (!agentId || !connected || !supported) return
    const refresh = () => { if (!taskRef.current || !terminal.has(taskRef.current.state) || !observedAt) command('switchAccountStatus') }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [agentId, connected, supported, key, Boolean(task), observedAt === 0])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const stale = Boolean(task && (!connected || (!terminal.has(task.state) && now - (observedAt || task.updatedAt) > 15000)))
  const active = Boolean(task && !terminal.has(task.state))
  function start() {
    if (!connected || !supported || !agentId || active) return
    const taskId = crypto.randomUUID(), requestId = crypto.randomUUID()
    const next: Snapshot = { taskId, revision: 0, state: 'sent', accountRef: account.trim(), serverId: server.trim(), characterId: character.trim(), updatedAt: Date.now(), chatPaused: true }
    // Store the task ID BEFORE dispatch so refresh cannot create a second login.
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { setNotice('无法保存任务编号，本次未发送换号指令。'); return }
    taskRef.current = next; setTask(next); setObservedAt(0); setNotice(''); pending.current.add(requestId)
    if (!onSend(agentId, { type: 'switchAccount', requestId, taskId, accountRef: next.accountRef, serverKey: next.serverId,
      characterId: next.characterId, timeoutSeconds: 180, expiresAt: Date.now() + 30000 })) {
      remember({ ...next, state: 'failed', message: '连接未就绪，本次没有发送', chatPaused: false }); setNotice('连接未就绪，本次没有发送')
    }
  }
  return <section className="reception-card reception-library" aria-label="远程换号">
    <h3>远程换号与实时状态</h3><p className="reception-muted">控制台 → 当前客户端 → 本机登录进程。账号引用需与登录进程中的配置一致。</p>
    <div className="reception-columns">
      <label>目标账号引用<input maxLength={128} value={account} onChange={e => setAccount(e.target.value)} placeholder="account-03" /></label>
      <label>目标区服 ID<input maxLength={128} value={server} onChange={e => setServer(e.target.value)} placeholder="1001" /></label>
      <label>目标角色 ID<input maxLength={128} value={character} onChange={e => setCharacter(e.target.value)} /></label>
    </div>
    {!supported && <p className="reception-alert">当前客户端尚未上报换号能力，请安装客户端更新并重启。</p>}
    <button className="primary-button compact" disabled={!supported || !connected || !agentId || active || !account.trim() || !server.trim() || !character.trim()} onClick={start}>发送换号指令</button>
    {task && <div aria-live="polite"><h4>{stale ? '状态未确认' : labels[task.state] || task.state}</h4>
      <p>{stale ? '连接中断或状态更新超时，保留原任务并查询，不会自动重复换号。' : task.error?.message || task.message || stages[task.stage || ''] || '等待下一次状态更新'}</p>
      <p>目标：{task.accountRef} · 区服 {task.serverId} · 角色 {task.characterId}</p>
      {task.stage && <p>阶段：{stages[task.stage] || task.stage}</p>}
      <p className="reception-muted">任务编号：<span style={{ overflowWrap: 'anywhere' }}>{task.taskId}</span><br />最后收到更新：{observedAt ? new Date(observedAt).toLocaleTimeString() : '尚未收到客户端状态'}</p>
      <div className="reception-actions"><button disabled={!connected} onClick={() => command('switchAccountStatus')}>查询实时状态</button>
        <button disabled={!connected || !active} onClick={() => { command('cancelSwitchAccount'); setNotice('已请求取消，等待登录进程确认。') }}>请求取消</button></div>
      {task.chatPaused && terminal.has(task.state) && <p className="reception-muted">聊天仍暂停。核对游戏中的当前角色后，在上方填写当前区服和角色 ID，再恢复聊天。</p>}
      {task.chatPaused && terminal.has(task.state) && <button disabled={!connected || !server.trim() || !character.trim()} onClick={() => { command('resumeAccountChat', { serverKey: server.trim(), characterId: character.trim() }); setNotice('正在核对客户端当前角色。') }}>已核对当前角色，恢复聊天</button>}
    </div>}
    {notice && <p role="status" className="reception-alert">{notice}</p>}
    <p className="reception-muted">需更新客户端并由登录进程实现 login.switch。接收指令不代表换号成功。</p>
  </section>
}

import { useRef, useState } from 'react'
import { Bot, Pause, Play, Square } from 'lucide-react'
import type { GameCharacter } from '#/lib/game-characters'
import type { ManagedChatController } from '#/lib/use-managed-chat'
import type { ManagedScope } from '#/lib/managed-chat'

export function ManagedChatSetup(props: {
  controller: ManagedChatController; canStart: boolean; selected?: GameCharacter; count: number
  start: (scope: ManagedScope, instruction: string, intervalMs: number, proactiveMs: number) => void
}) {
  const [scope, setScope] = useState<ManagedScope>('single')
  const [instruction, setInstruction] = useState('结合最近聊天自然交流，收到回复就接着聊，适当主动开启新话题。')
  const [interval, setInterval] = useState('30')
  const [proactive, setProactive] = useState('10')
  const intervalMs = Number(interval) * 1000
  const proactiveMs = Number(proactive) * 60000
  const intervalValid = interval.trim() !== '' && Number.isFinite(intervalMs) && intervalMs >= 0
  const proactiveValid = proactive.trim() !== '' && Number.isFinite(proactiveMs) && proactiveMs >= 0
  const details = useRef<HTMLDetailsElement>(null)
  const busy = props.controller.state.status !== 'idle'
  return <details className="managed-chat-setup" ref={details}>
    <summary><Bot size={16} aria-hidden="true" />持续托管模式</summary>
    <div>
      <label>托管范围<select aria-label="托管范围" value={scope} disabled={busy} onChange={event => setScope(event.target.value as ManagedScope)}>
        <option value="single">当前会话{props.selected ? ` · ${props.selected.name}` : '（请先选角色）'}</option>
        <option value="online">筛选后的在线角色</option>
        <option value="all">筛选后的全体 · {props.count} 人</option>
      </select></label>
      <label>聊天目标<textarea aria-label="托管聊天目标" value={instruction} disabled={busy} maxLength={2000} onChange={event => setInstruction(event.target.value)} /></label>
      <div className="managed-chat-intervals">
        <label>全局发送间隔（秒）<input aria-label="托管发送间隔秒" type="number" step="any" value={interval} disabled={busy} onChange={event => setInterval(event.target.value)} /></label>
        <label>每人主动聊天间隔（分钟）<input aria-label="托管主动聊天间隔分钟" type="number" step="any" value={proactive} disabled={busy} onChange={event => setProactive(event.target.value)} /></label>
      </div>
      {!intervalValid && <p role="alert">全局发送间隔请输入有效的非负数字。</p>}
      {!proactiveValid && <p role="alert">每人主动聊天间隔请输入有效的非负数字。</p>}
      <p>两个间隔均支持小数，无上限；0 表示不额外等待，仍按顺序处理查询、AI 生成和发送。</p>
      <p>新回复优先，每人独立上下文。在线模式自动分批查询筛选角色，确认在线后聊天；结果超过 3 分钟重新查询，离线或未知先跳过。筛选变化不会更改已启动任务。</p>
      <p>{scope === 'single' ? '单独会话收到私聊后直接回复，不查询在线状态。' : 'AI 可发送私聊和群发、编辑草稿、读取会话历史、查询在线状态及查看托管上下文。'}</p>
      <p>请保持此网页打开。切换会话或功能页继续运行，关闭或刷新网页结束托管。每轮 AI 调用会产生费用，批量按队列依次执行。</p>
      <button type="button" className="primary-button compact" disabled={busy || !props.canStart || (scope === 'single' && !props.selected) || !intervalValid || !proactiveValid}
        onClick={() => { props.start(scope, instruction.trim(), intervalMs, proactiveMs); if (details.current) details.current.open = false }}><Play size={14} aria-hidden="true" />开启持续托管</button>
    </div>
  </details>
}

export function ManagedChatStatus({ controller }: { controller: ManagedChatController }) {
  const { state } = controller
  if (state.status === 'idle') return state.notice ? <div className="managed-chat-status" role="status"><span>{state.notice}</span><button type="button" className="secondary-button compact" onClick={controller.stop}>关闭提示</button></div> : null
  return <section className="managed-chat-status" aria-label="持续托管任务">
    <Bot size={20} aria-hidden="true" />
    <div><strong>{state.status === 'paused' ? '托管已暂停' : state.status === 'loading' ? '准备托管' : '持续托管中'} · {state.config?.agentName} · {state.config?.label}</strong>
      <p>{state.total} 个角色 · 已确认发送 {state.sent} 条 · 已处理 {state.turns} 轮{state.current ? ` · 当前：${state.current}` : ''}</p>
      {state.config?.scope === 'online' && <p>筛选范围 {state.total} 人 · 已查询 {state.queried || 0} 人 · 当前确认在线 {state.online || 0} 人</p>}
      <p role="status">{state.notice}{state.retryAt ? `（${new Date(state.retryAt).toLocaleTimeString()} 后重试）` : ''}</p></div>
    <div className="managed-chat-actions">
      {state.status === 'paused' ? <button type="button" className="secondary-button compact" disabled={!state.total} onClick={controller.resume}><Play size={14} />恢复托管</button>
        : state.status !== 'loading' && <button type="button" className="secondary-button compact" onClick={controller.pause}><Pause size={14} />暂停托管</button>}
      <button type="button" className="secondary-button compact" onClick={controller.stop}><Square size={14} />停止托管</button>
    </div>
  </section>
}

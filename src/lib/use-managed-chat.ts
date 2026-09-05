import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConsoleMessage, OnlineAgent, ConnectionSettings } from './use-aion-console'
import type { GameChatGuard } from './game-chat-block'
import { gameChatBlockMessage } from './game-chat-block'
import { gameMessageIdFromRaw } from './chat-timeline'
import { ManagedChatRunner, managedKey, type ManagedConfig, type ManagedSnapshot, type ManagedLine } from './managed-chat'
import type { GameCharacter } from './game-characters'
import type { QueryPresence } from './presence-mqtt'
import type { StoredChatMessage } from './chat-storage'
import { runManagedAiTurn } from './managed-ai-turn'
import { queryManagedPresence } from './query-managed-presence'

type Props = {
  userKey: string; settings: ConnectionSettings; connectionState: string; agents: OnlineAgent[]
  locks: { agentId: string; userKey: string; acquiredAt: number }[]
  messages: ConsoleMessage[]; chatGuard?: GameChatGuard; bulkSending: boolean
  sendCommand: (agent: string, command: Record<string, unknown>) => boolean
  queryPresence: QueryPresence; controlDraft: (command: Record<string, unknown>) => void
  resolve: (message: ConsoleMessage) => { characterId: string; serverKey: string; direction: 'incoming' | 'outgoing' | 'system' } | null
}

export function useManagedChat(props: Props) {
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const [state, setState] = useState<ManagedSnapshot>({ status: 'idle', total: 0, sent: 0, turns: 0, current: '', notice: '', retryAt: 0 })
  const receipts = useRef(new Map<string, (error?: Error) => void>())
  const releaseLock = useRef<(() => void) | undefined>(undefined)
  const launchGeneration = useRef(0)
  const starting = useRef(false)
  const baseline = useRef(new Set<string>())
  const processed = useRef(new WeakSet<ConsoleMessage>())
  const runnerRef = useRef<ManagedChatRunner | undefined>(undefined)
  if (!runnerRef.current) runnerRef.current = new ManagedChatRunner({
    changed: setState,
    queryOnline: (characters, signal) => queryManagedPresence(characters, latest.current.queryPresence, signal),
    guard: config => {
      const value = latest.current
      if (value.settings.room !== config.room) return { message: '房间已改变，托管已暂停', permanent: true }
      const lock = value.locks.find(item => item.agentId === config.agentId)
      if (!lock || lock.userKey !== value.userKey || lock.acquiredAt !== config.acquiredAt) return { message: '客户端占用已改变，托管已暂停', permanent: true }
      const block = value.chatGuard?.get(config.agentId)
      if (block) return { message: gameChatBlockMessage(block), permanent: true }
      if (!navigator.onLine || value.connectionState !== 'connected' || !value.agents.some(agent => agent.agentId === config.agentId && Date.now() - agent.lastSeenAt < 45000)) return { message: '等待客户端连接恢复', permanent: false }
      if (value.bulkSending) return { message: '等待手动群发结束', permanent: false }
      return null
    },
    verify: async (config, signal) => {
      const response = await fetch('/api/client-locks', { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error(response.status === 401 ? '未登录' : '读取客户端占用失败')
      const result = await response.json() as { locks?: Props['locks'] }
      const lock = result.locks?.find(item => item.agentId === config.agentId)
      if (!lock || lock.userKey !== latest.current.userKey || lock.acquiredAt !== config.acquiredAt) throw new Error('客户端占用已改变')
    },
    run: turn => runManagedAiTurn(turn, {
      history: async () => {
        // Live messages are already captured in turn.history. A single-role reply
        // must not wait for another database read before answering that message.
        if (turn.config.scope === 'single' && turn.reason === 'reply') return []
        const params = new URLSearchParams({ serverId: turn.recipient.serverKey, characterId: turn.recipient.characterId, limit: '12' })
        const response = await fetch(`/api/messages?${params}`, { signal: AbortSignal.any([turn.signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw new Error('读取托管会话历史失败')
        const result = await response.json() as { ok?: boolean; messages?: StoredChatMessage[] }
        if (!result.ok || !Array.isArray(result.messages)) throw new Error('托管会话历史响应无效')
        return result.messages.filter(item => item.direction !== 'system').reverse().map(item => ({
          id: item.sourceMessageId || `stored:${item.id}`, direction: item.direction as ManagedLine['direction'],
          content: item.content.slice(0, 1000), time: new Date(item.sentAt).toISOString(),
        }))
      },
      presence: async () => {
        const cached = runnerRef.current?.cachedPresence(turn.recipient)
        if (cached) return JSON.stringify([cached])
        const results = await queryManagedPresence([turn.recipient], latest.current.queryPresence, turn.signal)
        turn.signal.throwIfAborted()
        runnerRef.current?.recordPresence([turn.recipient], results)
        return JSON.stringify(results)
      },
      controlDraft: command => latest.current.controlDraft(command),
      notice: notice => setState(current => ({ ...current, notice })),
    }),
    send: (config, character, content, signal) => new Promise<void>((resolve, reject) => {
      signal.throwIfAborted()
      const requestId = crypto.randomUUID()
      const finish = (error?: Error) => {
        clearTimeout(timer); signal.removeEventListener('abort', cancel); receipts.current.delete(requestId)
        error ? reject(error) : resolve()
      }
      const cancel = () => finish(new Error('托管已暂停；如消息已发出，请核对记录'))
      const timer = setTimeout(() => finish(new Error('发送结果未确认')), 45000)
      receipts.current.set(requestId, finish); signal.addEventListener('abort', cancel, { once: true })
      const sent = latest.current.sendCommand(config.agentId, { type: 'sendWhisper', requestId, serverKey: character.serverKey,
        characterId: character.characterId, targetName: character.name, content })
      if (!sent) finish(new Error('客户端未连接或发送命令被拒绝'))
    }),
  })
  const runner = runnerRef.current
  const ingest = () => {
    const config = runner.snapshot.config
    if (!config || !runner.recipients.size) return
    for (const message of [...latest.current.messages].reverse()) {
      if (message.agentId !== config.agentId) continue
      if (processed.current.has(message)) continue
      processed.current.add(message)
      if (message.type === 'control_result') {
        const requestId = String(message.raw.requestId || '')
        receipts.current.get(requestId)?.(message.raw.ok === true ? undefined : new Error(`客户端发送失败：${message.content.slice(0, 300)}`))
      }
      const target = latest.current.resolve(message)
      if (!target || target.direction === 'system') continue
      runner.observe(managedKey(target), { id: gameMessageIdFromRaw(message.raw) || message.id,
        direction: target.direction, content: message.content.slice(0, 1000), time: message.time }, !baseline.current.has(message.id))
    }
  }
  useEffect(ingest, [props.messages, state.total])
  useEffect(() => {
    const timer = setInterval(() => { void runner.tick() }, 1000)
    const stopForPage = () => { ++launchGeneration.current; runner.stop(); releaseLock.current?.() }
    window.addEventListener('pagehide', stopForPage)
    return () => { clearInterval(timer); window.removeEventListener('pagehide', stopForPage); stopForPage() }
  }, [runner])
  useEffect(() => props.chatGuard?.subscribe(() => {
    const config = runner.snapshot.config
    const block = config && props.chatGuard?.get(config.agentId)
    if (block && runner.snapshot.status !== 'idle') runner.pause(gameChatBlockMessage(block))
  }), [props.chatGuard, runner])
  function stop() { ++launchGeneration.current; runner.stop(); releaseLock.current?.(); releaseLock.current = undefined; starting.current = false }
  async function start(config: ManagedConfig, load: (signal: AbortSignal) => Promise<GameCharacter[]>) {
    if (starting.current || runner.snapshot.status !== 'idle') return
    starting.current = true
    const generation = ++launchGeneration.current
    baseline.current = new Set(latest.current.messages.map(message => message.id))
    processed.current = new WeakSet()
    if (!navigator.locks) { starting.current = false; setState(current => ({ ...current, notice: '浏览器不支持托管互斥，请使用新版 Edge 或 Chrome' })); return }
    try {
      await navigator.locks.request(`aion:managed:${config.room}:${config.agentId}`, { ifAvailable: true }, async lock => {
        if (generation !== launchGeneration.current) return
        if (!lock) { setState(current => ({ ...current, notice: '其他标签页正在托管此客户端，请先在那里停止' })); return }
        let unlock!: () => void
        const held = new Promise<void>(resolve => { unlock = resolve })
        releaseLock.current = unlock
        await runner.start(config, load)
        starting.current = false
        if (generation !== launchGeneration.current) { unlock(); return }
        ingest()
        await held
      })
    } catch (error) {
      if (generation === launchGeneration.current) setState(current => ({ ...current, notice: error instanceof Error ? error.message : '无法启动托管' }))
    } finally { if (generation === launchGeneration.current) starting.current = false }
  }
  async function resume() {
    const config = runner.snapshot.config
    if (!config || runner.snapshot.status !== 'paused') return
    try {
      const response = await fetch('/api/client-locks', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(response.status === 401 ? '未登录，请重新登录后启动托管' : '读取占用状态失败，请稍后恢复')
      const result = await response.json() as { locks?: Props['locks'] }
      if (runner.snapshot.config !== config || runner.snapshot.status !== 'paused') return
      const lock = result.locks?.find(item => item.agentId === config.agentId)
      if (!lock || lock.userKey !== latest.current.userKey) throw new Error('当前账号未占用此客户端，请先重新占用再恢复托管')
      const local = latest.current.locks.find(item => item.agentId === config.agentId)
      if (local?.userKey !== lock.userKey || local.acquiredAt !== lock.acquiredAt) throw new Error('占用状态正在同步，请稍后点击恢复托管')
      if (latest.current.settings.room !== config.room) throw new Error('房间已改变，请停止旧任务后重新开启托管')
      const block = latest.current.chatGuard?.get(config.agentId)
      if (block) throw new Error(gameChatBlockMessage(block))
      // Only an explicit user resume may adopt a new, server-verified generation.
      // Automatic ticks and every AI/send request still check the exact generation.
      runner.resume(lock.acquiredAt)
    } catch (error) {
      if (runner.snapshot.config === config && runner.snapshot.status === 'paused') runner.pause(error instanceof Error ? error.message : '恢复失败')
    }
  }
  return { state, start, stop, pause: () => runner.pause(), resume }
}

export type ManagedChatController = ReturnType<typeof useManagedChat>

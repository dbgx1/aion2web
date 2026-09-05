import type { GameCharacter } from './game-characters'
import type { PresenceResult } from './presence-mqtt'
import { ManagedPresence } from './managed-presence'

export type ManagedScope = 'single' | 'online' | 'all'
export type ManagedLine = { id: string; direction: 'incoming' | 'outgoing'; content: string; time: string }
export type ManagedConfig = {
  agentId: string; agentName: string; room: string; acquiredAt: number
  scope: ManagedScope; label: string; instruction: string
  intervalMs: number; proactiveMs: number
}
export type ManagedSnapshot = {
  status: 'idle' | 'loading' | 'running' | 'paused' | 'waiting'
  config?: ManagedConfig; total: number; sent: number; turns: number
  current: string; notice: string; retryAt: number
  online?: number; queried?: number
}
export type ManagedTurn = {
  recipient: GameCharacter; config: ManagedConfig; reason: 'reply' | 'proactive'
  signal: AbortSignal; history: ManagedLine[]
  send: (content: string) => Promise<boolean>
  queueGroup: (content: string, variants?: string[]) => number
}
type Dependencies = {
  now?: () => number
  guard: (config: ManagedConfig) => { message: string; permanent: boolean } | null
  verify: (config: ManagedConfig, signal: AbortSignal) => Promise<void>
  run: (turn: ManagedTurn) => Promise<void>
  send: (config: ManagedConfig, character: GameCharacter, content: string, signal: AbortSignal) => Promise<void>
  changed: (snapshot: ManagedSnapshot) => void
  queryOnline?: (characters: GameCharacter[], signal: AbortSignal) => Promise<PresenceResult[]>
}
export const managedKey = (character: Pick<GameCharacter, 'serverKey' | 'characterId'>) => JSON.stringify([character.serverKey, character.characterId])

/** One scheduler owns all recipients; no timer or AI instance per character. */
export class ManagedChatRunner {
  snapshot: ManagedSnapshot = { status: 'idle', total: 0, sent: 0, turns: 0, current: '', notice: '', retryAt: 0 }
  recipients = new Map<string, GameCharacter>()
  private order: string[] = []
  private cursor = 0
  private due = new Map<string, number>()
  private pending = new Map<string, number>()
  private history = new Map<string, ManagedLine[]>()
  private seen = new Set<string>()
  private revision = new Map<string, number>()
  private drafts = new Map<string, string>()
  private controller?: AbortController
  private presenceController?: AbortController
  private activeTurn?: { key: string; reason: string; published: boolean; controller: AbortController }
  private incomingAt = new Map<string, number>()
  private busy = false
  private nextAt = 0
  private failures = 0
  private generation = 0
  private groupQueued = false
  private presence?: ManagedPresence
  private nextPresenceAt = 0
  private presenceFailures = 0
  constructor(private deps: Dependencies) {}
  private now() { return this.deps.now?.() ?? Date.now() }
  private emit(update: Partial<ManagedSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update }; this.deps.changed(this.snapshot)
  }
  async start(config: ManagedConfig, load: (signal: AbortSignal) => Promise<GameCharacter[]>) {
    this.stop()
    const generation = this.generation
    const controller = new AbortController(); this.controller = controller
    this.emit({ status: 'loading', config, notice: '正在固定托管角色范围…' })
    try {
      await this.deps.verify(config, controller.signal)
      const characters = await load(controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      for (const character of characters) if (character.serverKey && character.characterId) this.recipients.set(managedKey(character), { ...character })
      if (!this.recipients.size) throw new Error('没有符合筛选条件的角色。')
      this.order = [...this.recipients.keys()]
      if (config.scope === 'online') this.presence = new ManagedPresence([...this.recipients.values()])
      this.nextAt = this.now() + 5000
      this.emit({ status: 'running', total: this.order.length, notice: this.presence ? '即将自动分批查询在线状态，确认在线后开始聊天' : '持续监听中，即将开始聊天' })
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) this.pause(error instanceof Error ? error.message : '启动失败')
    }
  }
  pause(notice = '已暂停，恢复后继续原角色范围') {
    ++this.generation; this.controller?.abort(); this.controller = undefined
    this.presenceController?.abort(); this.presenceController = undefined
    this.emit({ status: 'paused', notice, retryAt: 0 })
  }
  resume(acquiredAt?: number) {
    if (!this.order.length || !this.snapshot.config) return
    this.failures = 0; this.nextAt = this.now() + 5000
    this.emit({ status: 'running', notice: '已恢复持续监听', retryAt: 0,
      config: acquiredAt === undefined ? this.snapshot.config : { ...this.snapshot.config, acquiredAt } })
  }
  stop() {
    ++this.generation; this.controller?.abort(); this.controller = undefined
    this.presenceController?.abort(); this.presenceController = undefined; this.activeTurn = undefined
    this.incomingAt.clear(); this.presenceFailures = 0
    this.recipients.clear(); this.order = []; this.cursor = 0; this.due.clear(); this.pending.clear()
    this.history.clear(); this.seen.clear(); this.revision.clear(); this.drafts.clear(); this.groupQueued = false
    this.failures = 0; this.nextAt = 0
    this.presence = undefined; this.nextPresenceAt = 0
    this.emit({ status: 'idle', config: undefined, total: 0, sent: 0, turns: 0, current: '', notice: '', retryAt: 0, online: undefined, queried: undefined })
  }
  recordPresence(characters: GameCharacter[], results: PresenceResult[]) {
    this.presence?.record(characters, results, this.now())
    if (this.presence) this.emit({ online: this.presence.count(this.now()), queried: this.presence.queried })
  }
  cachedPresence(character: GameCharacter) { return this.presence?.result(managedKey(character), this.now()) }
  observe(key: string, line: ManagedLine, trigger = true) {
    if (!this.recipients.has(key) || this.seen.has(line.id)) return
    this.seen.add(line.id)
    // Bounded receipt deduplication; startup ingestion is baseline-only.
    if (this.seen.size > 20000) this.seen.delete(this.seen.values().next().value!)
    const recent = [...(this.history.get(key) || []), line].slice(-12)
    this.history.delete(key)
    this.history.set(key, recent)
    // Inactive conversations are read from stored history on their next turn.
    // Do not grow a full transcript cache for every member of a large directory.
    if (this.history.size > 1000) this.history.delete(this.history.keys().next().value!)
    if (!trigger) return
    this.revision.set(key, (this.revision.get(key) || 0) + 1)
    this.due.set(key, this.now() + (this.snapshot.config?.proactiveMs ?? 600000))
    if (line.direction === 'incoming') {
      // Briefly combine a burst, without restarting a five-second wait per line.
      this.pending.set(key, Math.min(this.pending.get(key) ?? Infinity, this.now() + 500))
      this.incomingAt.set(key, this.now())
      const active = this.activeTurn
      // Supersede an unsent draft, never interrupt a command awaiting receipt.
      if (active && !active.published && (active.key === key || active.reason === 'proactive')) active.controller.abort()
    }
    else this.pending.delete(key) // A human reply supersedes the queued AI reply.
  }
  async tick() {
    const config = this.snapshot.config
    if (!config || this.busy || !['running', 'waiting'].includes(this.snapshot.status)) return
    const blocked = this.deps.guard(config)
    if (blocked) {
      if (blocked.permanent) this.pause(blocked.message)
      else if (this.snapshot.notice !== blocked.message) this.emit({ status: 'waiting', notice: blocked.message })
      return
    }
    const now = this.now()
    if (now < this.nextAt) return
    // A fresh private message is sufficient to reply to that role in the fixed
    // scope. It does not change its queried presence badge or allow proactive sends.
    const replyEligible = (key: string) => !this.presence || this.presence.online(key, now)
      || now - (this.incomingAt.get(key) ?? -Infinity) <= 180000
    const readyReply = [...this.pending].find(([id, due]) => due <= now && replyEligible(id))?.[0]
    if (!readyReply && this.presence && !this.presenceController && now >= this.nextPresenceAt) {
      const batch = this.presence.batch(now, [...this.pending.keys()])
      if (batch.length) {
        const generation = this.generation, controller = new AbortController()
        this.presenceController = controller
        this.emit({ status: 'running', current: '', notice: `自动查询在线状态：本批 ${batch.length} 人，已查 ${this.presence.queried}/${this.order.length}` })
        try {
          await this.deps.verify(config, controller.signal)
          controller.signal.throwIfAborted()
          const block = this.deps.guard(config)
          if (block) throw new Error(block.message)
          if (!this.deps.queryOnline) throw new Error('在线查询服务不可用')
          const results = await this.deps.queryOnline(batch, controller.signal)
          if (generation !== this.generation || controller.signal.aborted) return
          this.recordPresence(batch, results)
          this.nextPresenceAt = this.now() + 30000
          this.presenceFailures = 0
          if (!this.busy && !this.snapshot.retryAt) this.emit({ notice: '在线状态已更新；新私聊优先回复' })
        } catch (error) {
          if (generation !== this.generation || controller.signal.aborted) return
          const message = error instanceof Error ? error.message : '在线查询失败'
          if (/占用|封禁|未登录|权限/.test(message)) this.pause(message)
          else {
            this.nextPresenceAt = this.now() + Math.min(900000, 60000 * 2 ** Math.min(this.presenceFailures++, 4))
            if (!this.busy && !this.snapshot.retryAt) this.emit({ status: 'waiting', notice: `在线查询失败，将退避后重试：${message}` })
          }
        } finally {
          if (this.presenceController === controller) this.presenceController = undefined
        }
        return
      }
      this.nextPresenceAt = now + 30000
    }
    const eligible = (key: string) => !this.presence || this.presence.online(key, now)
    let key = readyReply
    const reason = key ? 'reply' : 'proactive'
    if (!key) for (let index = 0; index < this.order.length; index++) {
      const candidate = this.order[this.cursor++ % this.order.length]
      if (!this.pending.has(candidate) && (this.due.get(candidate) || 0) <= now && eligible(candidate)) { key = candidate; break }
    }
    if (!key) {
      if (this.presence && this.snapshot.online !== this.presence.count(now)) this.emit({ online: this.presence.count(now) })
      return
    }
    const chosen = key, recipient = this.recipients.get(chosen)!
    const generation = this.generation, revision = this.revision.get(chosen) || 0
    const controller = new AbortController(); this.controller = controller; this.busy = true
    const activeTurn = { key: chosen, reason, published: false, controller }; this.activeTurn = activeTurn
    let published = false, sendClaimed = false
    const valid = () => {
      controller.signal.throwIfAborted()
      if (generation !== this.generation) throw new Error('托管任务已改变')
      const block = this.deps.guard(config)
      if (block) {
        if (block.permanent) this.pause(block.message)
        throw new Error(block.message)
      }
    }
    const send = async (content: string) => {
      valid()
      if (sendClaimed) return false // Tool replays cannot send twice in one turn.
      if ((this.revision.get(chosen) || 0) !== revision) return false // New reply/human send superseded this answer.
      if (!content.trim()) throw new Error('AI 返回了空消息')
      sendClaimed = true
      try { await this.deps.verify(config, controller.signal) }
      catch (error) { if (!controller.signal.aborted) this.pause(error instanceof Error ? error.message : '无法确认客户端占用'); throw error }
      valid()
      if ((this.revision.get(chosen) || 0) !== revision) return false
      const freshReply = reason === 'reply' && this.now() - (this.incomingAt.get(chosen) ?? -Infinity) <= 180000
      if (this.presence && !freshReply && !this.presence.online(chosen, this.now())) throw new Error('角色在线状态已过期或已离线，等待重新查询')
      // Once handed to transport, an uncertain result must never auto-retry.
      published = true; activeTurn.published = true
      try { await this.deps.send(config, recipient, content.trim().slice(0, 2000), controller.signal) }
      catch (error) {
        if (generation === this.generation) this.pause(`${error instanceof Error ? error.message : '发送失败'}；请核对聊天记录后恢复`)
        throw error
      }
      valid()
      this.nextAt = this.now() + config.intervalMs
      this.emit({ sent: this.snapshot.sent + 1 })
      return true
    }
    this.emit({ status: 'running', current: recipient.name, notice: reason === 'reply' ? '正在回复新消息' : '正在主动聊天', retryAt: 0 })
    try {
      await this.deps.verify(config, controller.signal); valid()
      // A queued broadcast must never stand in for an answer to a new question.
      if (reason === 'reply') this.drafts.delete(chosen)
      const draft = this.drafts.get(chosen)
      if (draft) await send(draft)
      else await this.deps.run({ recipient, config, reason, signal: controller.signal, history: this.history.get(chosen) || [], send,
        queueGroup: (content, variants) => {
          valid()
          if (this.groupQueued) return 0
          this.groupQueued = true
          const texts = (variants?.length ? variants : [content]).filter(item => item.trim())
          if (!texts.length) return 0
          this.order.forEach((id, index) => { this.drafts.set(id, texts[index % texts.length]); this.due.set(id, 0) })
          return this.order.length
        },
      })
      valid()
      if ((this.revision.get(chosen) || 0) === revision) this.pending.delete(chosen)
      if (draft || published) this.drafts.delete(chosen)
      this.due.set(chosen, this.drafts.has(chosen) ? 0 : this.now() + config.proactiveMs)
      if (!published) this.nextAt = this.now() + config.intervalMs
      this.failures = 0
      this.emit({ turns: this.snapshot.turns + 1, notice: '持续监听中；收到回复优先处理' })
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'AI 请求失败'
      if (published || /占用|封禁|未登录|权限/.test(message)) this.pause(`${message}；请核对聊天记录后恢复`)
      else {
        this.nextAt = this.now() + Math.min(900000, 60000 * 2 ** Math.min(this.failures++, 4))
        // Keep this recipient queued through backoff, rather than skipping it.
        this.pending.set(chosen, this.nextAt)
        this.emit({ status: 'waiting', notice: `请求失败，将退避后重试：${message}`, retryAt: this.nextAt })
      }
    } finally {
      this.busy = false
      if (this.activeTurn === activeTurn) this.activeTurn = undefined
      if (this.controller === controller) this.controller = undefined
    }
  }
}

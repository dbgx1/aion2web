export type GameChatBlock = { expiresAt: number | null; startAt: number | null; blockedType: string; reason: string }
const EMPTY: Record<string, GameChatBlock> = {}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null

function findBlock(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 7) return null
  if (typeof value === 'string') {
    if (value.length > 65_536) return null
    const text = value.replaceAll('\\_', '_')
    try { return findBlock(JSON.parse(text), depth + 1) } catch { /* HTTP prefix is common. */ }
    const start = text.indexOf('{'), end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return findBlock(JSON.parse(text.slice(start, end + 1)), depth + 1) } catch { /* Keep the explicit error marker below. */ }
    }
    return /\bNET_ERR_GAME_CHAT_BLOCKED\b/.test(text) ? { defined: 'NET_ERR_GAME_CHAT_BLOCKED' } : null
  }
  if (!record(value)) return null
  if (String(value.error) === '2011200' || value.defined === 'NET_ERR_GAME_CHAT_BLOCKED') return value
  // Never inspect chat content, outgoing commands, or arbitrary object keys.
  for (const key of ['error', 'result', 'response', 'body', 'data', 'message', 'details', 'detail', 'text']) {
    const found = findBlock(value[key], depth + 1)
    if (found) return found
  }
  return null
}

export function gameChatBlockFromEvent(event: unknown, now = Date.now()): GameChatBlock | null {
  if (!record(event) || event.type !== 'control_result') return null
  const blocked = findBlock(event)
  if (!blocked) return null
  const info = record(blocked.restrictInfo) ? blocked.restrictInfo : {}
  const expiresAt = timestamp(info.expirationTime)
  // Replayed receipts for an already expired restriction must not stop a new task.
  if (expiresAt !== null && expiresAt <= now) return null
  return { expiresAt, startAt: timestamp(info.startTime), blockedType: typeof info.blockedType === 'string' ? info.blockedType : '', reason: typeof info.reason === 'string' ? info.reason.slice(0, 500) : '' }
}

export function gameChatBlockMessage(block: GameChatBlock) {
  const until = block.expiresAt === null ? '游戏未提供解禁时间' : `预计解禁：${new Date(block.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`
  const reason = block.reason || (block.blockedType === 'BLOCKED_BY_ADMIN' ? '游戏管理员限制聊天' : '游戏端限制聊天')
  return `游戏聊天已被封禁，已停止群发并暂停聊天发送。${reason}；${until}。解除限制后请手动继续，不会自动重发。`
}

/** Per-browser, per-MQTT-room guard. Ref-backed checks run before every publish. */
export class GameChatGuard {
  private blocks: Record<string, GameChatBlock> = EMPTY
  private listeners = new Set<() => void>()
  storageKey = ''
  snapshot = () => this.blocks
  serverSnapshot = () => EMPTY
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { for (const listener of this.listeners) listener() }
  setScope(scope: string) {
    const key = `aion2:game-chat-blocks:v1:${scope}`
    if (key === this.storageKey) return
    this.storageKey = key
    this.blocks = EMPTY
    this.reload()
  }
  private read() {
    const result: Record<string, GameChatBlock> = Object.create(null)
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(this.storageKey) || '{}')
      if (record(raw)) for (const [agent, value] of Object.entries(raw)) {
        if (!record(value) || (value.expiresAt !== null && (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)))
          || (value.startAt !== null && typeof value.startAt !== 'number') || typeof value.reason !== 'string' || typeof value.blockedType !== 'string') continue
        const block = value as GameChatBlock
        if (block.expiresAt === null || block.expiresAt > Date.now()) result[agent] = block
      }
    } catch { /* Unavailable storage must not prevent stopping an active send. */ }
    return result
  }
  reload() {
    // Keep locally observed restrictions even if another tab clears storage.
    const next = { ...this.blocks }
    for (const [agent, block] of Object.entries(this.read())) {
      const previous = this.get(agent)
      if (!previous || (block.startAt ?? 0) > (previous.startAt ?? 0)
        || (block.expiresAt ?? Infinity) > (previous.expiresAt ?? Infinity)) next[agent] = block
    }
    this.blocks = next
    this.prune()
    this.notify()
  }
  get(agentId: string): GameChatBlock | null {
    const value = Object.hasOwn(this.blocks, agentId) ? this.blocks[agentId] : undefined
    return value && (value.expiresAt === null || value.expiresAt > Date.now()) ? value : null
  }
  accept(agentId: string, event: unknown) {
    if (!agentId) return
    const block = gameChatBlockFromEvent(event)
    if (!block) return
    const previous = this.get(agentId)
    if (previous && ((previous.startAt ?? 0) > (block.startAt ?? 0)
      || (previous.expiresAt !== null && block.expiresAt !== null && previous.expiresAt > block.expiresAt))) return
    this.blocks = { ...this.read(), ...this.blocks, [agentId]: block }
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.blocks)) } catch { /* Still enforce in memory. */ }
    this.notify()
  }
  prune() {
    if (!Object.values(this.blocks).some(block => block.expiresAt !== null && block.expiresAt <= Date.now())) return
    this.blocks = Object.fromEntries(Object.entries(this.blocks).filter(([, block]) => block.expiresAt === null || block.expiresAt > Date.now()))
    this.notify()
  }
}

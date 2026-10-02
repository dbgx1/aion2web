// Transport-independent state machine. The DO adapter must persist every transition
// before publishing its outbox; MQTT delivery is at-least-once, not execution-once.
export type Player = { serverId: string; characterId: string }
export type Result = Player & { status: 'online' | 'offline' | 'unknown'; checkedAt: number; error?: string }
export type Request = { requestId: string; userKey: string; serviceId: string; expiresAt: number; characters: Player[] }
export type Node = { clientId: string; sessionId: string; gameSessionId: string; serverId: string | null; boot: number; seq: number; seenAt: number; ready: boolean; nextAt: number; lastAssigned: number; attemptId?: string }
type Job = { id: string; player: Player; watchers: string[]; tries: number; excluded: string[]; attempt?: { id: string; clientId: string; sessionId: string; gameSessionId: string; leaseUntil: number } }
type Entry = Request & { results: Record<string, Result> }
export type Delivery = { id: string; topic: string; payload: Record<string, unknown>; expiresAt: number; resultsSaved?: boolean }
export type State = { version: 1; nodes: Record<string, Node>; jobs: Record<string, Job>; requests: Record<string, Entry>; cache: Record<string, Result>; outbox: Delivery[]; day: number; dispatched: number; lastUser: string }
export const defaults = { cooldownMs: 0, leaseMs: 25000, nodeStaleMs: 90000, cacheMs: 10000, dailyLimit: 20000, maxJobs: 1000, maxRequests: 100, maxNodes: 1000, perUser: 2, maxOutbox: 2000 }
export function emptyState(): State { return { version: 1, nodes: {}, jobs: {}, requests: {}, cache: {}, outbox: [], day: -1, dispatched: 0, lastUser: '' } }
const key = (p: Player) => `${p.serverId}:${p.characterId}`
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/
// The portable release embeds this credential in every installation. Its boot
// counter is local to a computer, so it cannot fence another computer's session.
export const sharedPortableClient = 'aion2pipe-local-20260930'
export const nodeKey = (clientId: string, sessionId: string) => clientId === sharedPortableClient ? `${clientId}:${sessionId}` : clientId
function validId(id: string) { if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Invalid identifier') }
function validPlayer(p: Player) { if (!p || !/^[1-9][0-9]{0,4}$/.test(p.serverId) || Number(p.serverId) > 65535 || !/^[1-9][0-9]{0,18}$/.test(p.characterId) || BigInt(p.characterId) > 9223372036854775807n) throw new Error('Invalid player') }
export class Scheduler {
  constructor(public state = emptyState(), public limits = defaults, private uuid = () => crypto.randomUUID()) {
    const legacy = state.nodes[sharedPortableClient]
    if (legacy) {
      state.nodes[nodeKey(legacy.clientId, legacy.sessionId)] ??= legacy
      delete state.nodes[sharedPortableClient]
    }
  }
  private emit(topic: string, payload: Record<string, unknown>, expiresAt: number) {
    if (this.state.outbox.length >= this.limits.maxOutbox) throw new Error('Delivery queue full')
    this.state.outbox.push({ id: this.uuid(), topic, payload, expiresAt })
  }
  acknowledgeDelivery(id: string) { this.state.outbox = this.state.outbox.filter(d => d.id !== id) }
  // Request identity and permissions must be loaded from the console's D1 record,
  // never trusted from a browser MQTT payload or its requested replyTopic.
  submit(input: Request, now: number) {
    validId(input.requestId); validId(input.serviceId)
    if (!input.userKey || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + 180000) throw new Error('Expired request')
    if (!Array.isArray(input.characters) || !input.characters.length || input.characters.length > 50) throw new Error('Invalid batch')
    input.characters.forEach(validPlayer)
    const old = this.state.requests[input.requestId]
    if (old) {
      if (old.userKey !== input.userKey || old.serviceId !== input.serviceId || old.expiresAt !== input.expiresAt || JSON.stringify(old.characters) !== JSON.stringify(input.characters)) throw new Error('Request identity conflict')
      if (Object.keys(old.results).length) this.reply(old, Object.values(old.results), now)
      return
    }
    this.expire(now)
    const active = Object.values(this.state.requests).filter(r => r.expiresAt > now && Object.keys(r.results).length < r.characters.length)
    if (Object.keys(this.state.requests).length >= this.limits.maxRequests || active.filter(r => r.userKey === input.userKey).length >= this.limits.perUser) throw new Error('Request queue full')
    const players = [...new Map(input.characters.map(p => [key(p), p])).values()]
    const missing = players.filter(p => !this.state.jobs[key(p)] && !this.cached(p, now)).length
    if (Object.keys(this.state.jobs).length + missing > this.limits.maxJobs) throw new Error('Player queue full')
    const request: Entry = { ...input, characters: players, results: {} }
    this.state.requests[input.requestId] = request
    for (const player of players) {
      const cached = this.cached(player, now)
      if (cached) { this.record(request, cached, now); continue }
      const k = key(player)
      const job = this.state.jobs[k] ??= { id: this.uuid(), player, watchers: [], tries: 0, excluded: [] }
      job.watchers.push(request.requestId)
    }
  }
  private cached(p: Player, now: number) { const r = this.state.cache[key(p)]; return r && r.checkedAt <= now && now - r.checkedAt < this.limits.cacheMs ? r : undefined }
  private reply(r: Entry, results: Result[], now: number) {
    this.emit(`aion2/presence/${r.serviceId}/results/${r.requestId}`, { type: 'presence_result', requestId: r.requestId, results }, Math.max(now + 1000, r.expiresAt + 10000))
  }
  private record(r: Entry, result: Result, now: number) {
    if (r.results[key(result)]) return
    r.results[key(result)] = result; this.reply(r, [result], now)
  }
  stateUpdate(input: Omit<Node, 'seenAt' | 'lastAssigned' | 'attemptId' | 'nextAt'> & { cooldownMs: number }, now: number) {
    validId(input.clientId); validId(input.sessionId); validId(input.gameSessionId)
    if (input.serverId !== null && (!/^[1-9][0-9]{0,4}$/.test(input.serverId) || Number(input.serverId) > 65535)) throw new Error('Invalid node server')
    if (!Number.isSafeInteger(input.boot) || input.boot < 1 || !Number.isSafeInteger(input.seq) || input.seq < 0 || typeof input.ready !== 'boolean' || (input.ready && input.serverId === null) || !Number.isFinite(input.cooldownMs) || input.cooldownMs < 0 || input.cooldownMs > 60000) throw new Error('Invalid node state')
    const identity = nodeKey(input.clientId, input.sessionId)
    const previous = this.state.nodes[identity]
    if (!previous && Object.keys(this.state.nodes).length >= this.limits.maxNodes) throw new Error('Node capacity reached')
    if (previous && (input.boot < previous.boot || (input.boot === previous.boot && (previous.sessionId !== input.sessionId || input.seq <= previous.seq)))) return
    // Preserve reservations even across reconnection: old execution may still finish.
    this.state.nodes[identity] = { ...input, seenAt: now, nextAt: Math.max(previous?.nextAt ?? 0, now + input.cooldownMs), lastAssigned: previous?.lastAssigned ?? 0, attemptId: previous?.attemptId }
  }
  tick(now: number) {
    this.expire(now)
    // No matching game connection can execute these targets. Report unknown
    // promptly instead of making the browser wait for its three-minute timeout.
    // Busy/cooling-down devices still count: their same-server jobs stay queued.
    const connectedServers = new Set(Object.values(this.state.nodes)
      .filter(n => n.serverId && now - n.seenAt < this.limits.nodeStaleMs).map(n => n.serverId))
    for (const job of Object.values(this.state.jobs)) {
      if (!job.attempt && !connectedServers.has(job.player.serverId)) {
        this.finish(job, { ...job.player, status: 'unknown', checkedAt: now,
          error: `区服 ${job.player.serverId} 当前没有在线查询客户端，请先连接该区服的查询客户端后重试` }, now)
      }
    }
    const day = Math.floor(now / 86400000)
    if (this.state.day !== day) { this.state.day = day; this.state.dispatched = 0 }
    const available = Object.values(this.state.nodes).filter(n => n.ready && !!n.serverId && !n.attemptId && n.nextAt <= now && now - n.seenAt < this.limits.nodeStaleMs).sort((a,b) => a.lastAssigned - b.lastAssigned || a.clientId.localeCompare(b.clientId))
    for (const node of available) {
      if (this.state.dispatched >= this.limits.dailyLimit || this.state.outbox.length >= this.limits.maxOutbox - 50) break
      const pending = Object.values(this.state.jobs).filter(j => j.player.serverId === node.serverId && !j.attempt && !j.excluded.includes(nodeKey(node.clientId, node.sessionId)) && Math.max(...j.watchers.map(id => this.state.requests[id]?.expiresAt ?? 0)) - now >= this.limits.leaseMs)
      const owner = (j: Job) => this.state.requests[j.watchers[0]]?.userKey ?? ''
      const users = [...new Set(pending.map(owner))].sort()
      const user = users.find(u => u > this.state.lastUser) ?? users[0]
      const job = pending.find(j => owner(j) === user)
      if (!job) continue
      const expires = Math.max(...job.watchers.map(id => this.state.requests[id]?.expiresAt ?? 0))
      if (expires - now < this.limits.leaseMs) continue
      const attempt = { id: this.uuid(), clientId: node.clientId, sessionId: node.sessionId, gameSessionId: node.gameSessionId, leaseUntil: now + this.limits.leaseMs }
      job.attempt = attempt; job.tries++; node.attemptId = attempt.id; node.lastAssigned = now
      this.state.lastUser = owner(job); this.state.dispatched++
      this.emit(`aion2/query-workers/${node.clientId}/${node.sessionId}/task`, { type: 'query_player_online', taskId: job.id, attemptId: attempt.id, gameSessionId: node.gameSessionId, ...job.player, expiresAt: attempt.leaseUntil }, attempt.leaseUntil)
    }
  }
  event(clientId: string, sessionId: string, event: { taskId: string; attemptId: string; gameSessionId: string; type: string; status?: Result['status']; error?: string }, now: number) {
    const job = Object.values(this.state.jobs).find(j => j.id === event.taskId)
    const a = job?.attempt
    if (!job || !a || a.id !== event.attemptId || a.clientId !== clientId || a.sessionId !== sessionId || a.gameSessionId !== event.gameSessionId || now >= a.leaseUntil) return false
    if (event.type === 'accepted' || event.type === 'sent') return true
    if (!['completed','rejected','failed'].includes(event.type)) throw new Error('Invalid event')
    if (event.type === 'completed' && !['online','offline','unknown'].includes(event.status ?? '')) throw new Error('Invalid result')
    const node = this.state.nodes[nodeKey(clientId, sessionId)]
    if (node?.attemptId === a.id) { node.attemptId = undefined; node.nextAt = Math.max(node.nextAt, now + this.limits.cooldownMs) }
    if (event.type === 'completed' && event.status !== 'unknown') {
      const result: Result = { ...job.player, status: event.status!, checkedAt: now }
      this.state.cache[key(job.player)] = result; this.finish(job, result, now)
    } else {
      // A nonzero ViewChar result is a terminal answer for this target, not a
      // broken connection. The client has consumed the response and can keep
      // serving other players. In particular, don't overwrite its newer ready
      // state when the state webhook arrives before this event webhook.
      const gameRejected = event.type === 'failed' && /^game_query_failed(?::[0-9]{1,5})?$/.test(event.error ?? '')
      if (gameRejected) {
        const code = event.error?.split(':')[1]
        const error = `游戏服务器拒绝查询该角色${code ? `（错误码 ${code}）` : ''}，请确认查询客户端与角色处于同一大区`
        const alternative = Object.values(this.state.nodes).some(n => n.serverId === job.player.serverId && nodeKey(n.clientId, n.sessionId) !== nodeKey(clientId, sessionId) && !job.excluded.includes(nodeKey(n.clientId, n.sessionId)) && now - n.seenAt < this.limits.nodeStaleMs && (n.ready || !!n.attemptId))
        if (job.tries >= 2 || !alternative) this.finish(job, { ...job.player, status: 'unknown', checkedAt: now, error }, now)
        else this.retry(job, now)
        return true
      }
      if (node) node.ready = false // Requires a newer state report before re-entry.
      this.retry(job, now)
    }
    return true
  }
  private finish(job: Job, result: Result, now: number) {
    for (const id of job.watchers) { const r = this.state.requests[id]; if (r && r.expiresAt > now) this.record(r, result, now) }
    delete this.state.jobs[key(job.player)]
  }
  private retry(job: Job, now: number) {
    if (job.attempt) job.excluded.push(nodeKey(job.attempt.clientId, job.attempt.sessionId))
    job.attempt = undefined
    if (job.tries >= 2) this.finish(job, { ...job.player, status: 'unknown', checkedAt: now, error: '查询失败，请稍后重试' }, now)
  }
  private expire(now: number) {
    this.state.outbox = this.state.outbox.filter(d => d.expiresAt > now)
    for (const [k,r] of Object.entries(this.state.cache)) if (now - r.checkedAt >= this.limits.cacheMs) delete this.state.cache[k]
    for (const r of Object.values(this.state.requests)) {
      if (r.expiresAt <= now) {
        for (const p of r.characters) if (!r.results[key(p)]) {
          const sameServer = Object.values(this.state.nodes).some(n => n.serverId === p.serverId && now - n.seenAt < this.limits.nodeStaleMs)
          this.record(r, { ...p, status: 'unknown', checkedAt: Math.min(now, r.expiresAt), error: sameServer ? '在线查询超时' : '当前没有同区服查询客户端' }, now)
        }
        if (now >= r.expiresAt + 10000) delete this.state.requests[r.requestId]
      }
    }
    for (const job of Object.values(this.state.jobs)) {
      job.watchers = job.watchers.filter(id => (this.state.requests[id]?.expiresAt ?? 0) > now)
      const a = job.attempt
      if (a && a.leaseUntil <= now) {
        const node = this.state.nodes[nodeKey(a.clientId, a.sessionId)]
        if (node?.attemptId === a.id) { node.attemptId = undefined; node.ready = false }
        this.retry(job, now)
      }
      if (!job.watchers.length && !job.attempt) delete this.state.jobs[key(job.player)]
    }
    for (const [id,n] of Object.entries(this.state.nodes)) if (!n.attemptId && now - n.seenAt > this.limits.nodeStaleMs) delete this.state.nodes[id]
  }
}

import { env } from 'cloudflare:workers'
import type { AdminPrincipal } from '#/server/admin-users.server'
import { PRESENCE_TIMEOUT_MS, presenceCharacterKey, type PresenceCharacter, type PresenceEnvelope } from '#/lib/presence-mqtt'

const DEFAULT_STALE_MS = 180_000
const MAX_STATUS_LOOKUP = 500
const REQUEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export type PresenceStatus = 'online' | 'offline' | 'stale' | 'unknown'
export type PresenceStatusLookup = { serverId: string; characterId: string }
type PresenceStatusRow = {
  server_id: string; character_id: string; character_name: string
  is_online: number; checked_at: number; updated_at: number; source_id: string | null
}
type RequestRow = {
  id: string; user_key: string; service_id: string; characters_json: string
  created_at: number; expires_at: number
}
function database() { return env.DB }
function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}
export class PresenceRequestError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function createPresenceRequest(characters: PresenceCharacter[], principal: AdminPrincipal) {
  const serviceId = (env as unknown as Record<string, string | undefined>).PRESENCE_SERVICE_ID || 'aion2web'
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(serviceId)) throw new PresenceRequestError('查询服务编号配置无效', 500)
  const requestId = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + PRESENCE_TIMEOUT_MS
  const unique = [...new Map(characters.map(character => [presenceCharacterKey(character), character])).values()]
  // Cleanup is driven by real requests, without permanent timers or idle polling.
  // Each admission removes a bounded batch; FK cascades remove old proof/receipt
  // rows while the latest character presence remains independently available.
  await database().prepare(`DELETE FROM presence_requests WHERE id IN (
    SELECT id FROM presence_requests WHERE expires_at < ? ORDER BY expires_at LIMIT 100
  )`).bind(now - REQUEST_RETENTION_MS).run()
  // The conditional insert enforces service-wide and per-operator capacity atomically.
  const inserted = await database().prepare(`
    INSERT INTO presence_requests (id, user_key, service_id, characters_json, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM presence_requests WHERE service_id = ? AND finished = 0 AND expires_at > ?) < 8
      AND (SELECT COUNT(*) FROM presence_requests WHERE user_key = ? AND finished = 0 AND expires_at > ?) < 2
  `).bind(requestId, principal.userKey, serviceId, JSON.stringify(unique), now, expiresAt,
    serviceId, now, principal.userKey, now).run()
  if (!inserted.meta.changes) throw new PresenceRequestError('查询服务繁忙，请稍后重试', 429)
  const base = `aion2/presence/${serviceId}`
  return {
    type: 'presence_query' as const, requestId, serviceId,
    requestTopic: `${base}/requests`, replyTopic: `${base}/results/${requestId}`,
    expiresAt, characters: unique,
  }
}

export async function finishPresenceRequest(requestId: string, principal: AdminPrincipal) {
  await database().prepare('UPDATE presence_requests SET finished = 1 WHERE id = ? AND user_key = ? AND finished = 0')
    .bind(requestId, principal.userKey).run()
}

export async function storeMqttPresenceResults(envelope: PresenceEnvelope, principal: AdminPrincipal) {
  const request = await database().prepare('SELECT * FROM presence_requests WHERE id = ? AND user_key = ?')
    .bind(envelope.requestId, principal.userKey).first<RequestRow>()
  if (!request) throw new PresenceRequestError('查询不存在或不属于当前客服', 403)
  const now = Date.now()
  if (now > request.expires_at + 300_000) throw new PresenceRequestError('查询结果保存期限已过', 410)
  const targets = new Map((JSON.parse(request.characters_json) as PresenceCharacter[])
    .map(character => [presenceCharacterKey(character), character]))
  for (const result of envelope.results) {
    if (!targets.has(presenceCharacterKey(result))) throw new PresenceRequestError('结果包含本次查询之外的角色', 400)
    if (result.checkedAt < request.created_at - 60_000 || result.checkedAt > request.expires_at + 60_000) {
      throw new PresenceRequestError('查询时间超出本次请求范围', 400)
    }
  }
  const verifiedRows = await database().prepare(
    'SELECT server_id,character_id,status,checked_at FROM presence_verified_results WHERE request_id=?'
  ).bind(request.id).all<{server_id:string;character_id:string;status:string;checked_at:number}>()
  const verified = new Map(verifiedRows.results.map(row => [`${row.server_id}\u0000${row.character_id}`,row]))
  const confirmedResults = envelope.results.filter(result => {
    const proof=verified.get(`${result.serverId}\u0000${result.characterId}`)
    // Browser-side timeouts are display-only, never authoritative observations.
    if (!proof && result.status==='unknown') return false
    if (!proof || proof.status!==result.status || proof.checked_at!==result.checkedAt) {
      throw new PresenceRequestError('查询结果尚未由调度器确认，或与实际结果不符', 409)
    }
    return true
  })
  if (!confirmedResults.length) return 0
  const statements = confirmedResults.flatMap(result => [
    database().prepare(`
      INSERT INTO character_presence (server_id, character_id, character_name, is_online, checked_at, updated_at, source_id)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM presence_request_results WHERE request_id = ? AND server_id = ? AND character_id = ?
      )
      ON CONFLICT(server_id, character_id) DO UPDATE SET
        character_name = excluded.character_name, is_online = excluded.is_online,
        checked_at = excluded.checked_at, updated_at = excluded.updated_at, source_id = excluded.source_id
      WHERE excluded.checked_at > character_presence.checked_at
        AND (excluded.is_online != -1 OR character_presence.is_online = -1)
    `).bind(result.serverId, result.characterId, targets.get(presenceCharacterKey(result))?.name || result.characterId,
      result.status === 'unknown' ? -1 : result.status === 'online' ? 1 : 0, result.checkedAt, now, request.service_id,
      request.id, result.serverId, result.characterId),
    database().prepare('INSERT OR IGNORE INTO presence_request_results (request_id, server_id, character_id) VALUES (?, ?, ?)')
      .bind(request.id, result.serverId, result.characterId),
  ])
  statements.push(database().prepare(`
    UPDATE presence_requests SET finished = 1 WHERE id = ? AND finished = 0
      AND (SELECT COUNT(*) FROM presence_request_results WHERE request_id = ?) >= json_array_length(characters_json)
  `).bind(request.id, request.id))
  const saved = await database().batch(statements)
  return saved.reduce((count, result, index) => count + (index < confirmedResults.length * 2 && index % 2 === 0 ? result.meta.changes || 0 : 0), 0)
}

export async function listPresenceStatus(items: PresenceStatusLookup[], maxAgeMs = DEFAULT_STALE_MS) {
  const cleanItems = items
    .map((item) => ({
      serverId: cleanText(item.serverId, 100),
      characterId: cleanText(item.characterId, 100),
    }))
    .filter((item) => item.serverId && item.characterId)
    .slice(0, MAX_STATUS_LOOKUP)
  if (cleanItems.length === 0) return []

  const uniqueItems = [...new Map(cleanItems.map(item => [presenceCharacterKey(item), item])).values()]
  const rows: PresenceStatusRow[] = []
  // D1 permits 100 bound parameters per statement: two per character.
  // Deduplicate reads while preserving the caller's result order below.
  for (let offset = 0; offset < uniqueItems.length; offset += 50) {
    const batch = uniqueItems.slice(offset, offset + 50)
    const filters = batch.map(() => '(server_id = ? AND character_id = ?)').join(' OR ')
    const result = await database().prepare(`
      SELECT server_id, character_id, character_name, is_online, checked_at, updated_at, source_id
      FROM character_presence
      WHERE ${filters}
    `).bind(...batch.flatMap(item => [item.serverId, item.characterId])).all<PresenceStatusRow>()
    rows.push(...result.results)
  }
  const now = Date.now()
  const statuses = new Map(rows.map((row) => [
    `${row.server_id}\u0000${row.character_id}`,
    {
      serverId: row.server_id,
      characterId: row.character_id,
      name: row.character_name,
      online: row.is_online === -1 ? null : row.is_online === 1,
      status: row.is_online === -1 ? 'unknown' as PresenceStatus
        : now - row.checked_at > maxAgeMs ? 'stale' as PresenceStatus
          : row.is_online === 0 ? 'offline' as PresenceStatus : 'online' as PresenceStatus,
      checkedAt: row.checked_at,
      updatedAt: row.updated_at,
      sourceId: row.source_id || '',
    },
  ]))
  return cleanItems.map((item) => statuses.get(`${item.serverId}\u0000${item.characterId}`) || {
    serverId: item.serverId,
    characterId: item.characterId,
    name: '',
    online: null,
    status: 'unknown' as PresenceStatus,
    checkedAt: null,
    updatedAt: null,
    sourceId: '',
  })
}

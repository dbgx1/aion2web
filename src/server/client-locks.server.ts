import { env } from 'cloudflare:workers'
import type { AdminPrincipal } from '#/server/admin-users.server'

export type ClientLock = {
  agentId: string
  userKey: string
  username: string
  acquiredAt: number
  expiresAt: number
  updatedAt: number
}

type ClientLockRow = {
  agent_id: string
  user_key: string
  username: string
  acquired_at: number
  expires_at: number
  updated_at: number
}

function database() {
  return env.DB
}

function toLock(row: ClientLockRow): ClientLock {
  return {
    agentId: row.agent_id,
    userKey: row.user_key,
    username: row.username,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  }
}

export async function listClientLocks() {
  try {
    const result = await database().prepare(`
      SELECT agent_id, user_key, username, acquired_at, expires_at, updated_at
      FROM client_locks
      ORDER BY updated_at DESC
    `).all<ClientLockRow>()
    return result.results.map(toLock)
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table')) return []
    throw cause
  }
}

export async function acquireClientLock(agentId: string, principal: AdminPrincipal) {
  const cleanAgentId = agentId.trim().slice(0, 200)
  if (!cleanAgentId) return { ok: false as const, error: '缺少客户端 ID。' }

  const now = Date.now()
  try {
    // Re-entering from another tab is idempotent for the same account. Only a
    // real release followed by acquisition creates a new fencing generation.
    await database().prepare(`
      INSERT INTO client_locks (agent_id, user_key, username, acquired_at, expires_at, updated_at)
      SELECT ?, ?, ?, ?, 0, ?
      WHERE NOT EXISTS (SELECT 1 FROM client_locks WHERE user_key = ? AND agent_id <> ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        user_key = excluded.user_key,
        username = excluded.username,
        acquired_at = client_locks.acquired_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      WHERE client_locks.user_key = ?
    `).bind(
      cleanAgentId,
      principal.userKey,
      principal.username,
      now,
      now,
      principal.userKey,
      cleanAgentId,
      principal.userKey,
    ).run()

    const row = await database().prepare(`
      SELECT agent_id, user_key, username, acquired_at, expires_at, updated_at
      FROM client_locks
      WHERE agent_id = ?
    `).bind(cleanAgentId).first<ClientLockRow>()
    if (!row) return { ok: false as const, error: '你已占用其他客户端，请先在该客户端的实时消息页主动退出。' }

    const lock = toLock(row)
    if (lock.userKey !== principal.userKey) {
      return { ok: false as const, error: `客户端正在由 ${lock.username} 操作。`, lock }
    }
    return { ok: true as const, lock }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table')) {
      return { ok: false as const, error: '客户端锁表尚未初始化，请先执行数据库迁移。' }
    }
    throw cause
  }
}

export async function releaseClientLock(agentId: string, principal: AdminPrincipal, acquiredAt: number) {
  const cleanAgentId = agentId.trim().slice(0, 200)
  if (!cleanAgentId) return
  try {
    await database().prepare(`
      DELETE FROM client_locks WHERE agent_id = ? AND user_key = ? AND acquired_at = ?
    `).bind(cleanAgentId, principal.userKey, acquiredAt).run()
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table')) return
    throw cause
  }
}

export async function releaseOfflineClientLock(agentId: string, offlineAt: number, principal: AdminPrincipal) {
  const now = Date.now()
  if (!Number.isFinite(offlineAt) || offlineAt < now - 60_000 || offlineAt > now + 5_000) return
  await database().prepare(`
    DELETE FROM client_locks WHERE agent_id = ? AND acquired_at <= ? AND user_key = ?
  `).bind(agentId, Math.min(now, offlineAt), principal.userKey).run()
}

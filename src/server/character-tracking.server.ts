import { env } from 'cloudflare:workers'
import { aion2ServerName } from '#/lib/aion2-servers'
import { avatarColorFor } from '#/lib/game-characters'
import type { TrackingEntry, TrackingMutation, TrackingClaim } from '#/lib/character-tracking'

export async function listTrackingClaims(owner: string, scope: string[] | null): Promise<TrackingClaim[]> {
  if (scope?.length === 0) return []
  const { results } = await env.DB.prepare(`SELECT t.character_db_id,
    COALESCE(NULLIF(u.display_name, ''), u.username,
      CASE WHEN t.owner_user_key LIKE 'env:%' THEN '管理员' ELSE '其他客服' END) AS owner_name,
    t.owner_user_key = ? AS is_mine
    FROM character_tracking t JOIN game_characters c ON c.id = t.character_db_id
    LEFT JOIN admin_users u ON t.owner_user_key = ('user:' || u.id)
    WHERE t.active = 1 ${scope ? `AND c.server_id IN (${scope.map(() => '?').join(',')})` : ''}`)
    .bind(owner, ...(scope || [])).all<{ character_db_id: number; owner_name: string; is_mine: number }>()
  return results.map(row => ({ characterId: String(row.character_db_id), ownerName: row.owner_name, isMine: row.is_mine === 1 }))
}

export async function listTracking(owner: string): Promise<TrackingEntry[]> {
  const { results } = await env.DB.prepare(`SELECT c.id, c.character_id, c.character_name, c.server_id,
    c.server_name, c.legion_name, c.legion_position, c.class_name, c.level, c.combat_power, c.avatar_url, c.faction,
    c.last_seen_at, t.priority, t.status, t.notes, t.next_follow_up, t.updated_at
    FROM character_tracking t JOIN game_characters c ON c.id = t.character_db_id
    WHERE t.owner_user_key = ? AND t.active = 1 ORDER BY t.updated_at DESC, c.id`).bind(owner).all<{
      id: number; character_id: string; character_name: string; server_id: string; server_name: string | null;
      legion_name: string | null; legion_position: number | null; class_name: string | null; level: number; combat_power: number | null;
      avatar_url: string | null; faction: string | null; last_seen_at: number;
      priority: TrackingEntry['priority']; status: TrackingEntry['status']; notes: string; next_follow_up: number | null; updated_at: number;
    }>()
  return results.map(row => ({ priority: row.priority, status: row.status, notes: row.notes,
    nextFollowUp: row.next_follow_up, updatedAt: row.updated_at,
    character: { id: String(row.id), characterId: row.character_id, name: row.character_name,
      serverKey: row.server_id, serverName: aion2ServerName(row.server_id) || row.server_name || row.server_id,
      legionName: row.legion_name || '', legionPosition: row.legion_position ?? null, className: row.class_name || '', level: row.level,
      combatPower: row.combat_power, avatarUrl: row.avatar_url || '', avatarColor: avatarColorFor(row.character_id),
      faction: row.faction || '', lastSeenAt: row.last_seen_at } }))
}

export async function mutateTracking(owner: string, input: TrackingMutation) {
  const now = Date.now()
  if (input.action === 'add') {
    const character = await env.DB.prepare('SELECT id FROM game_characters WHERE id = ?').bind(input.characterId).first()
    if (!character) return false
    const result = await env.DB.prepare(`INSERT INTO character_tracking(owner_user_key, character_db_id, created_at, updated_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM character_tracking WHERE character_db_id = ? AND active = 1 AND owner_user_key != ?)
      ON CONFLICT(owner_user_key, character_db_id) DO UPDATE SET active = 1, updated_at = excluded.updated_at`)
      .bind(owner, input.characterId, now, now, input.characterId, owner).run()
    return (result.meta.changes ?? 0) > 0
  }
  const result = input.action === 'remove'
    ? await env.DB.prepare('UPDATE character_tracking SET active = 0, updated_at = ? WHERE owner_user_key = ? AND character_db_id = ?')
      .bind(now, owner, input.characterId).run()
    : await env.DB.prepare(`UPDATE character_tracking SET priority = ?, status = ?, notes = ?, next_follow_up = ?, updated_at = ?
      WHERE owner_user_key = ? AND character_db_id = ? AND active = 1`)
      .bind(input.priority, input.status, input.notes, input.nextFollowUp, now, owner, input.characterId).run()
  return input.action === 'remove' || (result.meta.changes ?? 0) > 0
}

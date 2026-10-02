import { env } from 'cloudflare:workers'
import type { AdminPrincipal } from './admin-users.server'
import { allowedServerIds } from './server-access.server'
import { currentAdminPrincipal } from './admin-auth.server'
import { jsonError } from './api-auth.server'
import { parseGuildMutation, type GuildMutation } from '#/lib/guild-tracking'

export async function listGuildClaims(principal: AdminPrincipal, scope: string[] | null) {
  const { results } = await env.DB.prepare(`SELECT t.server_id AS serverId, t.legion_name AS legionName,
    COALESCE(NULLIF(u.display_name,''),u.username,CASE WHEN t.owner_user_key LIKE 'env:%' THEN '管理员' ELSE '其他客服' END) AS ownerName,
    t.owner_user_key = ? AS isMine, t.version, t.updated_at AS updatedAt
    FROM guild_tracking t LEFT JOIN admin_users u ON t.owner_user_key = ('user:' || u.id)
    WHERE t.owner_user_key IS NOT NULL ${scope === null ? '' : scope.length ? `AND t.server_id IN (${scope.map(() => '?').join(',')})` : 'AND 0=1'}
    ORDER BY t.updated_at DESC, t.server_id, t.legion_name`).bind(principal.userKey, ...(scope || [])).all<{serverId: string; legionName: string; ownerName: string; isMine: number; version: number; updatedAt: number}>()
  return results.map(row => ({ ...row, isMine: !!row.isMine }))
}
export async function mutateGuild(principal: AdminPrincipal, input: GuildMutation) {
  const { userKey } = principal, now = Date.now()
  if (input.action === 'claim') {
    // No read-then-write ownership race: existence and occupancy checked in one write.
    const result = await env.DB.prepare(`INSERT INTO guild_tracking(server_id,legion_name,owner_user_key,version,updated_by,updated_at)
      SELECT ?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM game_characters WHERE server_id=? AND legion_name=?)
      ON CONFLICT(server_id,legion_name) DO UPDATE SET owner_user_key=excluded.owner_user_key,
        version=guild_tracking.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE guild_tracking.owner_user_key IS NULL`)
      .bind(input.serverId,input.legionName,userKey,userKey,now,input.serverId,input.legionName).run()
    if (result.meta.changes) return true
    // Retrying an already successful claim by the same owner is idempotent.
    return !!await env.DB.prepare('SELECT 1 FROM guild_tracking WHERE server_id=? AND legion_name=? AND owner_user_key=?').bind(input.serverId,input.legionName,userKey).first()
  }
  const result = await env.DB.prepare(`UPDATE guild_tracking SET owner_user_key=NULL,version=version+1,updated_by=?,updated_at=?
    WHERE server_id=? AND legion_name=? AND version=? AND owner_user_key IS NOT NULL AND (owner_user_key=? OR ?=1)`)
    .bind(userKey,now,input.serverId,input.legionName,input.version,userKey,principal.role === 'admin' ? 1 : 0).run()
  return !!result.meta.changes
}
export async function guildTrackingResponse(request: Request) {
  const principal = await currentAdminPrincipal(request)
  if (!principal) return jsonError('未登录',401)
  const scope = await allowedServerIds(principal)
  if (request.method === 'GET') return Response.json({ok:true,claims:await listGuildClaims(principal,scope),canManage:principal.role==='admin'},{headers:{'Cache-Control':'no-store'}})
  if (request.headers.get('origin') !== new URL(request.url).origin) return jsonError('请求来源无效',403)
  if (Number(request.headers.get('content-length')) > 8192) return jsonError('请求体过大',413)
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > 8192) return jsonError('请求体过大',413)
  let value: unknown
  try { value=JSON.parse(raw) } catch { return jsonError('请求格式无效',400) }
  const input=parseGuildMutation(value)
  if (!input) return jsonError('军团或操作参数无效',400)
  if (scope !== null && !scope.includes(input.serverId)) return jsonError('无权管理该区服的军团',403)
  if (!await mutateGuild(principal,input)) return jsonError(input.action==='claim'?'军团已被其他客服跟踪，或军团已不在目录中，请刷新。':'跟踪归属已变化或你无权释放，请刷新后重试。',409)
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}})
}

import { env } from 'cloudflare:workers'
import { currentAdminPrincipal } from './admin-auth.server'
import { allowedServerIds } from './server-access.server'
import { jsonError } from './api-auth.server'

export async function editCharacter(request: Request, remove = false) {
  const principal = await currentAdminPrincipal(request)
  if (!principal) return jsonError('未登录', 401)
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return jsonError('请求来源无效', 403)
  const raw = await request.text()
  if (raw.length > 8192) return jsonError('请求体过大', 413)
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return jsonError('请求格式无效', 400) }
  if (!body || typeof body !== 'object' || !Number.isSafeInteger(body.id) || Number(body.id) < 1) return jsonError('角色编号无效', 400)
  const scope = await allowedServerIds(principal)
  const scopeSql = scope === null ? '' : scope.length ? ` AND server_id IN (${scope.map(() => '?').join(',')})` : ' AND 0=1'
  const where = `id = ?${scopeSql} AND NOT EXISTS (SELECT 1 FROM character_tracking t WHERE t.character_db_id = game_characters.id AND t.active = 1 AND t.owner_user_key != ?)`
  const args = [body.id, ...(scope || []), principal.userKey]
  let result
  if (remove) {
    if (body.confirm !== true) return jsonError('请确认删除角色及关联聊天、跟踪记录', 400)
    result = await env.DB.prepare(`DELETE FROM game_characters WHERE ${where}`).bind(...args).run()
  } else {
    for (const key of ['name', 'legionName', 'className', 'faction']) {
      if (typeof body[key] !== 'string' || (body[key] as string).length > 100) return jsonError('文字字段最多 100 字', 400)
    }
    if (!(body.name as string).trim() || (body.legionPosition !== null && (!Number.isInteger(body.legionPosition) || Number(body.legionPosition) < 0 || Number(body.legionPosition) > 3))
      || !Number.isSafeInteger(body.level) || Number(body.level) < 0 || Number(body.level) > 999
      || (body.combatPower !== null && (!Number.isSafeInteger(body.combatPower) || Number(body.combatPower) < 0))) return jsonError('请检查名称、职位、等级和战斗力', 400)
    result = await env.DB.prepare(`UPDATE game_characters SET character_name=?, legion_name=?, class_name=?, faction=?, level=?, combat_power=?, legion_position=?, updated_at=? WHERE ${where}`)
      .bind((body.name as string).trim(), (body.legionName as string).trim(), (body.className as string).trim(), (body.faction as string).trim(), body.level, body.combatPower, body.legionPosition, Date.now(), ...args).run()
  }
  if (!result.meta.changes) return jsonError('角色不存在，或已由其他客服重点跟踪，请刷新后重试', 409)
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

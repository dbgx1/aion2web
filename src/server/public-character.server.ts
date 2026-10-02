import { env } from 'cloudflare:workers'
import { currentAdminPrincipal } from './admin-auth.server'
import { allowedServerIds } from './server-access.server'
import { jsonError } from './api-auth.server'
import { readLimitedBody } from './request-body.server'
import { listCharacters } from './characters.server'

// Public chat only supplies identity. Never run the full character uploader:
// its defaults would erase previously collected profile fields.
export async function addPublicCharacter(request: Request) {
  const principal = await currentAdminPrincipal(request)
  if (!principal) return jsonError('未登录', 401)
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return jsonError('请求来源无效', 403)
  const raw = await readLimitedBody(request, 8192)
  if (raw === null) return jsonError('请求体过大', 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return jsonError('请求格式无效', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('角色信息无效', 400)
  const data = body as Record<string, unknown>
  for (const key of ['characterName', 'characterId', 'serverId']) {
    if (typeof data[key] !== 'string' || !(data[key] as string).trim() || (data[key] as string).length > 100) {
      return jsonError('公屏消息缺少有效的角色名称、角色 ID 或区服，无法加入角色数据库', 400)
    }
  }
  const characterName = (data.characterName as string).trim()
  const characterId = (data.characterId as string).trim()
  const serverId = (data.serverId as string).trim()
  const scope = await allowedServerIds(principal)
  if (scope !== null && !scope.includes(serverId)) return jsonError('无权访问该区服', 403)
  const now = Date.now()
  const inserted = await env.DB.prepare(`INSERT INTO game_characters
    (character_name, character_id, server_id, metadata_json, first_seen_at, last_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(server_id, character_id) DO NOTHING`)
    .bind(characterName, characterId, serverId, JSON.stringify({ source: 'public_chat', addedBy: principal.userKey }), now, now, now).run()
  const result = await listCharacters({ allowedServerIds: scope, serverId, characterId, legionName: '', withoutLegion: false,
    search: '', cursor: 0, limit: 1, includeTotal: false })
  if (!result.characters[0]) return jsonError('角色读取失败，请重试', 409)
  return Response.json({ ok: true, created: Boolean(inserted.meta.changes), character: result.characters[0] },
    { headers: { 'Cache-Control': 'no-store' } })
}

import { allowedServerIds, canAccessCharacter } from '#/server/server-access.server'
import { createFileRoute } from '@tanstack/react-router'
import { parseTrackingMutation } from '#/lib/character-tracking'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { listTracking, listTrackingClaims, mutateTracking } from '#/server/character-tracking.server'

export const Route = createFileRoute('/api/character-tracking')({ server: { handlers: {
  GET: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    const scope = await allowedServerIds(principal)
    const [ownEntries, claims] = await Promise.all([listTracking(principal.userKey), listTrackingClaims(principal.userKey, scope)])
    const entries = ownEntries.filter(entry => scope === null || scope.includes(entry.character.serverKey))
    return Response.json({ ok: true, entries, claims }, { headers: { 'Cache-Control': 'no-store' } })
  },
  POST: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    if (Number(request.headers.get('content-length')) > 32768) return jsonError('请求体过大', 413)
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > 32768) return jsonError('请求体过大', 413)
    let body: unknown
    try { body = JSON.parse(raw) } catch { return jsonError('请求格式无效', 400) }
    const input = parseTrackingMutation(body)
    if (!input) return jsonError('跟进内容无效，备注最多 4000 字', 400)
    if (!await canAccessCharacter(principal, input.characterId)) return jsonError('无权访问该角色', 403)
    if (!await mutateTracking(principal.userKey, input)) {
      if (input.action === 'add') {
        const claims = await listTrackingClaims(principal.userKey, await allowedServerIds(principal))
        const claim = claims.find(item => item.characterId === String(input.characterId) && !item.isMine)
        if (claim) return jsonError(`该角色已由 ${claim.ownerName} 重点跟踪，不能重复添加。`, 409)
      }
      return jsonError('角色或跟踪记录不存在，请刷新', 404)
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  },
} } })
